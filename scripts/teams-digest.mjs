#!/usr/bin/env node
// Checks for active Claude Code sessions exceeding the cost threshold and posts to Teams.
// Run by the digest-cron Docker service every 2 hours.

const API_BASE = process.env.AGENTWATCH_URL || 'http://agentwatch:3456';
const AGENTWATCH_PUBLIC = process.env.AGENTWATCH_PUBLIC_URL || 'http://localhost:3457';
const WEBHOOK = process.env.TEAMS_WEBHOOK_URL;

if (!WEBHOOK) {
  console.error('TEAMS_WEBHOOK_URL not set — skipping');
  process.exit(0);
}

function stripTags(str) {
  return (str || '')
    .replace(/<[^>]*>/g, '')
    .replace(/<[^>]*$/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function fmtCost(n) { return `$${n.toFixed(2)}`; }
function fmtTokens(n) { return n >= 1000 ? `${(n / 1000).toFixed(1)}k` : String(n); }
function fmtDuration(ms) {
  if (ms >= 3600000) return `${Math.round(ms / 3600000)}h`;
  if (ms >= 60000) return `${Math.round(ms / 60000)}m`;
  return `${Math.round(ms / 1000)}s`;
}
function fmtTime(d) {
  return d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', timeZone: 'UTC' }) + ' UTC';
}
function fmtDate(d) {
  return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', timeZone: 'UTC' });
}

async function main() {
  const res = await fetch(`${API_BASE}/api/v2/analytics/active-alert`);

  if (!res.ok) {
    console.error(`Active alert API returned ${res.status}`);
    process.exit(1);
  }

  const data = await res.json();
  const sessions = data.activeSessions ?? [];

  if (sessions.length === 0) {
    console.log(`No active sessions above $${data.threshold} threshold — skipping`);
    process.exit(0);
  }

  const now = new Date();
  const checkedAt = `${fmtDate(now)}  ${fmtTime(now)}`;
  const totalCost = sessions.reduce((s, x) => s + x.cost, 0);

  // ── Card body ────────────────────────────────────────────────────────────
  const cardBody = [
    {
      type: 'TextBlock',
      text: `🔴  Active Sessions Alert`,
      weight: 'Bolder',
      size: 'Large',
      wrap: false,
    },
    {
      type: 'TextBlock',
      text: `Checked at ${checkedAt}  ·  threshold $${data.threshold}`,
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
            { type: 'TextBlock', text: String(sessions.length), weight: 'Bolder', size: 'ExtraLarge', wrap: false },
            { type: 'TextBlock', text: sessions.length === 1 ? 'active session' : 'active sessions', size: 'Small', isSubtle: true, spacing: 'None', wrap: false },
          ]},
        ],
      }],
    },

    // Separator + section header
    { type: 'TextBlock', text: '─────────────────────', isSubtle: true, spacing: 'Medium', wrap: false },
    { type: 'TextBlock', text: 'Running sessions', weight: 'Bolder', size: 'Medium', spacing: 'None', wrap: false },
  ];

  // ── Per-session rows ─────────────────────────────────────────────────────
  for (const s of sessions) {
    const title = stripTags(s.title) || s.project;
    const trunc = title.length > 55 ? title.slice(0, 52) + '…' : title;
    const meta = `${fmtCost(s.cost)}  ·  ${fmtTokens(s.tokens)} tokens  ·  ${fmtDuration(s.durationMs)}  ·  ${s.source}`;
    const sessionUrl = `${AGENTWATCH_PUBLIC}/session/${s.sessionId}/workspace`;

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
    actions: [{
      type: 'Action.OpenUrl',
      title: '📊 Open AgentWatch Alerts',
      url: `${AGENTWATCH_PUBLIC}/alerts`,
    }],
  };

  const post = await fetch(WEBHOOK, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });

  if (!post.ok) {
    const body = await post.text();
    console.error(`Teams webhook failed ${post.status}: ${body}`);
    process.exit(1);
  }

  // Save to digest_runs for in-app Alerts tab
  try {
    await fetch(`${API_BASE}/api/v2/analytics/digest/save`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        windowStart: new Date(Date.now() - 6 * 60 * 60 * 1000).toISOString(),
        windowEnd: new Date().toISOString(),
        totalSessions: sessions.length,
        totalCost,
        totalTokens: sessions.reduce((s, x) => s + x.tokens, 0),
        totalToolCalls: 0,
        avgDurationMs: Math.round(sessions.reduce((s, x) => s + x.durationMs, 0) / sessions.length),
        topModel: 'claude-sonnet-4-6',
        sessionDetails: sessions.map(s => ({
          sessionId: s.sessionId,
          title: s.title,
          project: s.project,
          cost: s.cost,
          tokens: s.tokens,
          toolCalls: 0,
          durationMs: s.durationMs,
          agentCount: 0,
          model: 'claude-sonnet-4-6',
          source: s.source,
        })),
        sourceBreakdown: [],
      }),
    });
  } catch { /* non-fatal */ }

  console.log(`Active session alert sent — ${sessions.length} session(s), total ${fmtCost(totalCost)}`);
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
