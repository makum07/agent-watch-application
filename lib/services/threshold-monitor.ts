import fs from 'fs';
import path from 'path';
import { randomUUID } from 'crypto';
import { getDatabase } from '@/lib/db/database';
import { getSources } from '@/lib/sources';
import { getWsServer } from '@/lib/websocket/ws-server';
import { getPreference } from '@/lib/services/preferences';
import { computeCostFromJsonl } from '@/lib/session-cost';
import type { ThresholdAlert } from '@/types/events';

const ACTIVE_WINDOW_MS = 6 * 60 * 60 * 1000;
const CHECK_INTERVAL_MS = parseInt(process.env.ALERT_CHECK_INTERVAL_MS || '120000', 10);

function getThresholds() {
  const costThreshold = getPreference('alertCostThreshold');
  const durationHours = getPreference('alertDurationThresholdHours');
  return { costThreshold, durationThresholdMs: durationHours * 3_600_000 };
}

let intervalHandle: ReturnType<typeof setInterval> | null = null;

export function startThresholdMonitor() {
  if (intervalHandle) return;

  const { costThreshold, durationThresholdMs } = getThresholds();
  const parts = [`cost: $${costThreshold}`];
  if (durationThresholdMs > 0) parts.push(`duration: ${durationThresholdMs / 3_600_000}h`);
  else parts.push('duration: disabled');
  parts.push(`interval: ${CHECK_INTERVAL_MS / 1000}s`);
  console.log(`> Threshold monitor started (${parts.join(', ')})`);

  setTimeout(checkThresholds, 5_000);
  intervalHandle = setInterval(checkThresholds, CHECK_INTERVAL_MS);
}

export function stopThresholdMonitor() {
  if (intervalHandle) {
    clearInterval(intervalHandle);
    intervalHandle = null;
  }
}

interface BreachingSession {
  sessionId: string;
  source: string;
  project: string;
  title: string;
  thresholdType: 'cost' | 'duration';
  thresholdValue: number;
  actualValue: number;
  cost: number;
  tokens: number;
  durationMs: number;
}

function checkThresholds() {
  try {
    const { costThreshold, durationThresholdMs } = getThresholds();
    if (costThreshold <= 0 && durationThresholdMs <= 0) return;

    const sources = getSources();
    const db = getDatabase();
    const now = Date.now();
    const activeSessionIds = new Set<string>();
    const breachingSessions: BreachingSession[] = [];

    for (const source of sources) {
      const projectsDir = path.join(source.path, 'projects');
      if (!fs.existsSync(projectsDir)) continue;

      let projectDirs: string[];
      try { projectDirs = fs.readdirSync(projectsDir); } catch { continue; }

      for (const proj of projectDirs) {
        const projPath = path.join(projectsDir, proj);
        let files: string[];
        try { files = fs.readdirSync(projPath).filter(f => f.endsWith('.jsonl')); } catch { continue; }

        for (const file of files) {
          const filePath = path.join(projPath, file);
          let stat: fs.Stats;
          try { stat = fs.statSync(filePath); } catch { continue; }

          if (now - stat.mtimeMs > ACTIVE_WINDOW_MS) continue;

          const sessionId = file.replace('.jsonl', '');
          const result = computeCostFromJsonl(filePath);

          if (!result.isActive) continue;
          activeSessionIds.add(sessionId);

          const projectName = proj.replace(/^-/, '').replace(/-/g, '/');
          const displayName = projectName.split('/').filter(Boolean).pop() ?? proj;

          if (costThreshold > 0 && result.cost >= costThreshold) {
            upsertAlert(db, {
              sessionId,
              source: source.label,
              project: displayName,
              title: result.title || displayName,
              thresholdType: 'cost',
              thresholdValue: costThreshold,
              actualValue: result.cost,
              sessionCost: result.cost,
              sessionTokens: result.tokens,
              sessionDurationMs: result.durationMs,
            });
            breachingSessions.push({
              sessionId,
              source: source.label,
              project: displayName,
              title: result.title || displayName,
              thresholdType: 'cost',
              thresholdValue: costThreshold,
              actualValue: result.cost,
              cost: result.cost,
              tokens: result.tokens,
              durationMs: result.durationMs,
            });
          }

          if (durationThresholdMs > 0 && result.durationMs >= durationThresholdMs) {
            upsertAlert(db, {
              sessionId,
              source: source.label,
              project: displayName,
              title: result.title || displayName,
              thresholdType: 'duration',
              thresholdValue: durationThresholdMs,
              actualValue: result.durationMs,
              sessionCost: result.cost,
              sessionTokens: result.tokens,
              sessionDurationMs: result.durationMs,
            });
            breachingSessions.push({
              sessionId,
              source: source.label,
              project: displayName,
              title: result.title || displayName,
              thresholdType: 'duration',
              thresholdValue: durationThresholdMs,
              actualValue: result.durationMs,
              cost: result.cost,
              tokens: result.tokens,
              durationMs: result.durationMs,
            });
          }
        }
      }
    }

    autoResolveAlerts(db, activeSessionIds);

    if (breachingSessions.length > 0) {
      sendConsolidatedTeamsNotification(breachingSessions, costThreshold, durationThresholdMs);
    }
  } catch (err) {
    console.error('Threshold monitor error:', err);
  }
}

interface AlertData {
  sessionId: string;
  source: string;
  project: string;
  title: string;
  thresholdType: 'cost' | 'duration';
  thresholdValue: number;
  actualValue: number;
  sessionCost: number;
  sessionTokens: number;
  sessionDurationMs: number;
}

function upsertAlert(db: ReturnType<typeof getDatabase>, data: AlertData) {
  const dismissed = db.prepare(
    `SELECT id FROM threshold_alerts WHERE session_id = ? AND threshold_type = ? AND status = 'dismissed'`,
  ).get(data.sessionId, data.thresholdType);
  if (dismissed) return;

  const existing = db.prepare(
    `SELECT id, actual_value, created_at FROM threshold_alerts WHERE session_id = ? AND threshold_type = ? AND status = 'active'`,
  ).get(data.sessionId, data.thresholdType) as { id: string; actual_value: number; created_at: number } | undefined;

  const now = Date.now();

  if (existing) {
    db.prepare(
      `UPDATE threshold_alerts SET actual_value = ?, session_cost = ?, session_tokens = ?, session_duration_ms = ?, updated_at = ? WHERE id = ?`,
    ).run(data.actualValue, data.sessionCost, data.sessionTokens, data.sessionDurationMs, now, existing.id);

    const alert: ThresholdAlert = {
      id: existing.id,
      sessionId: data.sessionId,
      source: data.source,
      project: data.project,
      title: data.title,
      thresholdType: data.thresholdType,
      thresholdValue: data.thresholdValue,
      actualValue: data.actualValue,
      status: 'active',
      createdAt: existing.created_at,
      updatedAt: now,
      sessionCost: data.sessionCost,
      sessionTokens: data.sessionTokens,
      sessionDurationMs: data.sessionDurationMs,
    };

    const wss = getWsServer();
    wss?.broadcast({ type: 'threshold_alert_updated', alert });
    return;
  }

  const id = randomUUID();
  db.prepare(
    `INSERT INTO threshold_alerts (id, session_id, source, project, title, threshold_type, threshold_value, actual_value, status, created_at, updated_at, session_cost, session_tokens, session_duration_ms, notified_teams)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'active', ?, ?, ?, ?, ?, 0)`,
  ).run(id, data.sessionId, data.source, data.project, data.title, data.thresholdType, data.thresholdValue, data.actualValue, now, now, data.sessionCost, data.sessionTokens, data.sessionDurationMs);

  const alert: ThresholdAlert = {
    id,
    sessionId: data.sessionId,
    source: data.source,
    project: data.project,
    title: data.title,
    thresholdType: data.thresholdType,
    thresholdValue: data.thresholdValue,
    actualValue: data.actualValue,
    status: 'active',
    createdAt: now,
    updatedAt: now,
    sessionCost: data.sessionCost,
    sessionTokens: data.sessionTokens,
    sessionDurationMs: data.sessionDurationMs,
  };

  const wss = getWsServer();
  wss?.broadcast({ type: 'threshold_alert_created', alert });
}

function autoResolveAlerts(db: ReturnType<typeof getDatabase>, activeSessionIds: Set<string>) {
  const activeAlerts = db.prepare(
    `SELECT id, session_id FROM threshold_alerts WHERE status = 'active'`,
  ).all() as { id: string; session_id: string }[];

  const now = Date.now();
  const wss = getWsServer();

  for (const row of activeAlerts) {
    if (activeSessionIds.has(row.session_id)) continue;

    db.prepare(
      `UPDATE threshold_alerts SET status = 'resolved', resolved_at = ?, updated_at = ? WHERE id = ?`,
    ).run(now, now, row.id);

    if (wss) {
      const full = db.prepare(`SELECT * FROM threshold_alerts WHERE id = ?`).get(row.id) as Record<string, unknown> | undefined;
      if (full) {
        wss.broadcast({ type: 'threshold_alert_updated', alert: mapAlertRow(full) });
      }
    }
  }
}

export function mapAlertRow(row: Record<string, unknown>): ThresholdAlert {
  return {
    id: row.id as string,
    sessionId: row.session_id as string,
    source: row.source as string,
    project: row.project as string,
    title: row.title as string,
    thresholdType: row.threshold_type as 'cost' | 'duration',
    thresholdValue: row.threshold_value as number,
    actualValue: row.actual_value as number,
    status: row.status as 'active' | 'resolved' | 'dismissed',
    createdAt: row.created_at as number,
    updatedAt: row.updated_at as number,
    resolvedAt: (row.resolved_at as number) ?? null,
    sessionCost: row.session_cost as number,
    sessionTokens: row.session_tokens as number,
    sessionDurationMs: row.session_duration_ms as number,
  };
}

function stripTags(str: string) {
  return (str || '').replace(/<[^>]*>/g, '').replace(/<[^>]*$/g, '').replace(/\s+/g, ' ').trim();
}

function fmtCost(n: number) { return `$${n.toFixed(2)}`; }
function fmtTokens(n: number) { return n >= 1000 ? `${(n / 1000).toFixed(1)}k` : String(n); }
function fmtDuration(ms: number) {
  if (ms >= 3_600_000) return `${Math.round(ms / 3_600_000)}h`;
  if (ms >= 60_000) return `${Math.round(ms / 60_000)}m`;
  return `${Math.round(ms / 1000)}s`;
}
function fmtTime(d: Date) {
  return d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', timeZone: 'UTC' }) + ' UTC';
}
function fmtDate(d: Date) {
  return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', timeZone: 'UTC' });
}

async function sendConsolidatedTeamsNotification(sessions: BreachingSession[], costThreshold: number, durationThresholdMs: number) {
  const webhook = getPreference('teamsWebhookUrl');
  if (!webhook) return;

  const publicUrl = process.env.AGENTWATCH_PUBLIC_URL || `http://localhost:${process.env.PORT || 3456}`;
  const now = new Date();
  const checkedAt = `${fmtDate(now)}  ${fmtTime(now)}`;
  const totalCost = sessions.reduce((s, x) => s + x.cost, 0);

  const thresholdParts: string[] = [];
  if (costThreshold > 0) thresholdParts.push(`cost $${costThreshold}`);
  if (durationThresholdMs > 0) thresholdParts.push(`duration ${durationThresholdMs / 3_600_000}h`);
  const thresholdText = thresholdParts.join(', ');

  const uniqueSessions = new Map<string, BreachingSession>();
  for (const s of sessions) {
    const existing = uniqueSessions.get(s.sessionId);
    if (!existing || s.cost > existing.cost) {
      uniqueSessions.set(s.sessionId, s);
    }
  }
  const deduped = Array.from(uniqueSessions.values());

  const cardBody: Record<string, unknown>[] = [
    {
      type: 'TextBlock',
      text: '🔴  Active Sessions Alert',
      weight: 'Bolder',
      size: 'Large',
      wrap: false,
    },
    {
      type: 'TextBlock',
      text: `Checked at ${checkedAt}  ·  threshold ${thresholdText}`,
      size: 'Small',
      isSubtle: true,
      spacing: 'None',
      wrap: false,
    },
    {
      type: 'Container',
      spacing: 'Medium',
      style: 'emphasis',
      items: [{
        type: 'ColumnSet',
        columns: [
          { type: 'Column', width: 'stretch', items: [
            { type: 'TextBlock', text: fmtCost(totalCost), weight: 'Bolder', size: 'ExtraLarge', wrap: false },
            { type: 'TextBlock', text: 'total cost', size: 'Small', isSubtle: true, spacing: 'None', wrap: false },
          ]},
          { type: 'Column', width: 'stretch', items: [
            { type: 'TextBlock', text: String(deduped.length), weight: 'Bolder', size: 'ExtraLarge', wrap: false },
            { type: 'TextBlock', text: deduped.length === 1 ? 'active session' : 'active sessions', size: 'Small', isSubtle: true, spacing: 'None', wrap: false },
          ]},
        ],
      }],
    },
    { type: 'TextBlock', text: '─────────────────────', isSubtle: true, spacing: 'Medium', wrap: false },
    { type: 'TextBlock', text: 'Running sessions', weight: 'Bolder', size: 'Medium', spacing: 'None', wrap: false },
  ];

  for (const s of deduped) {
    const title = stripTags(s.title) || s.project;
    const trunc = title.length > 55 ? title.slice(0, 52) + '…' : title;
    const meta = `${fmtCost(s.cost)}  ·  ${fmtTokens(s.tokens)} tokens  ·  ${fmtDuration(s.durationMs)}  ·  ${s.source}`;
    const sessionUrl = `${publicUrl}/session/${s.sessionId}/workspace`;

    cardBody.push({
      type: 'Container',
      spacing: 'Small',
      selectAction: { type: 'Action.OpenUrl', url: sessionUrl },
      style: 'emphasis',
      items: [
        { type: 'TextBlock', text: `🔗 ${trunc}`, weight: 'Bolder', size: 'Small', wrap: false, color: 'Accent' },
        { type: 'TextBlock', text: meta, size: 'Small', isSubtle: true, spacing: 'None', wrap: true },
      ],
    });
  }

  const payload = {
    type: 'AdaptiveCard',
    $schema: 'http://adaptivecards.io/schemas/adaptive-card.json',
    version: '1.4',
    body: cardBody,
    actions: [{ type: 'Action.OpenUrl', title: '📊 Open AgentWatch Alerts', url: `${publicUrl}/alerts` }],
  };

  try {
    const res = await fetch(webhook, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });

    if (res.ok) {
      const db = getDatabase();
      const ids = sessions.map(s => s.sessionId);
      const placeholders = ids.map(() => '?').join(',');
      db.prepare(
        `UPDATE threshold_alerts SET notified_teams = 1 WHERE session_id IN (${placeholders}) AND status = 'active'`,
      ).run(...ids);
      console.log(`> Teams alert sent — ${deduped.length} session(s), total ${fmtCost(totalCost)}`);
    } else {
      console.error(`Teams alert notification failed ${res.status}: ${await res.text()}`);
    }
  } catch (err) {
    console.error('Teams alert notification error:', err);
  }
}
