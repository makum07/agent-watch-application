#!/usr/bin/env node
// Fetches a 2-hour session digest from AgentWatch and posts to Teams.
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
    .replace(/<[^>]*>/g, '')    // complete tags <foo>
    .replace(/<[^>]*$/g, '')    // incomplete tag at end (no closing >)
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
  const windowMs = parseInt(process.env.DIGEST_WINDOW_MS || String(2 * 60 * 60 * 1000));
  const since = new Date(Date.now() - windowMs).toISOString();
  const res = await fetch(`${API_BASE}/api/v2/analytics/digest?since=${encodeURIComponent(since)}`);

  if (!res.ok) {
    console.error(`Digest API returned ${res.status}`);
    process.exit(1);
  }

  const data = await res.json();

  if (!data.sessions || data.sessions === 0) {
    console.log('No sessions in last 2h — skipping notification');
    process.exit(0);
  }

  const now = new Date();
  const twoHoursAgo = new Date(now - 2 * 60 * 60 * 1000);
  const sameDay = fmtDate(twoHoursAgo) === fmtDate(now);
  const timeRange = sameDay
    ? `${fmtDate(now)}  ${fmtTime(twoHoursAgo)} → ${fmtTime(now)}`
    : `${fmtDate(twoHoursAgo)} ${fmtTime(twoHoursAgo)} → ${fmtDate(now)} ${fmtTime(now)}`;

  const sourceList = data.sourceBreakdown
    .filter(s => s.sessions > 0)
    .map(s => `${s.source} ${s.sessions}`)
    .join('  ·  ');

  const projectList = data.topProjects
    .slice(0, 3)
    .map(p => `${p.name} (${p.count})`)
    .join(',  ') || '—';

  // ── Summary section ──────────────────────────────────────────────
  const cardBody = [
    {
      type: 'TextBlock',
      text: '🤖  AgentWatch · 2h digest',
      weight: 'Bolder',
      size: 'Large',
      wrap: false,
    },
    {
      type: 'TextBlock',
      text: timeRange,
      size: 'Small',
      isSubtle: true,
      spacing: 'None',
      wrap: false,
    },
    { type: 'Container', spacing: 'Medium', style: 'emphasis', bleed: false, items: [
      {
        type: 'ColumnSet',
        columns: [
          { type: 'Column', width: 'stretch', items: [
            { type: 'TextBlock', text: fmtCost(data.totalCost), weight: 'Bolder', size: 'ExtraLarge', wrap: false },
            { type: 'TextBlock', text: 'total cost', size: 'Small', isSubtle: true, spacing: 'None', wrap: false },
          ]},
          { type: 'Column', width: 'stretch', items: [
            { type: 'TextBlock', text: String(data.sessions), weight: 'Bolder', size: 'ExtraLarge', wrap: false },
            { type: 'TextBlock', text: 'sessions', size: 'Small', isSubtle: true, spacing: 'None', wrap: false },
          ]},
          { type: 'Column', width: 'stretch', items: [
            { type: 'TextBlock', text: fmtTokens(data.totalTokens), weight: 'Bolder', size: 'ExtraLarge', wrap: false },
            { type: 'TextBlock', text: 'tokens', size: 'Small', isSubtle: true, spacing: 'None', wrap: false },
          ]},
        ],
      },
    ]},
    {
      type: 'FactSet',
      spacing: 'Small',
      facts: [
        { title: 'Tool calls', value: String(data.totalToolCalls) },
        { title: 'Avg duration', value: fmtDuration(data.avgDurationMs) },
        { title: 'Model', value: data.topModel },
        { title: 'Projects', value: projectList },
        ...(sourceList ? [{ title: 'Sources', value: sourceList }] : []),
      ],
    },
  ];

  // ── Session breakdown (cost > $5) ────────────────────────────────
  if (data.totalCost > 5 && data.sessionDetails?.length > 0) {
    cardBody.push({
      type: 'TextBlock',
      text: '─────────────────────',
      isSubtle: true,
      spacing: 'Medium',
      wrap: false,
    });
    cardBody.push({
      type: 'TextBlock',
      text: 'Session breakdown',
      weight: 'Bolder',
      size: 'Medium',
      spacing: 'None',
      wrap: false,
    });

    for (const s of data.sessionDetails) {
      const title = stripTags(s.title) || s.project;
      const truncated = title.length > 55 ? title.slice(0, 52) + '…' : title;
      const meta = `${fmtCost(s.cost)}  ·  ${fmtTokens(s.tokens)} tokens  ·  ${s.agentCount} agents  ·  ${fmtDuration(s.durationMs)}  ·  ${s.source}`;
      const sessionUrl = `${AGENTWATCH_PUBLIC}/session/${s.sessionId}/workspace`;

      cardBody.push({
        type: 'Container',
        spacing: 'Small',
        selectAction: { type: 'Action.OpenUrl', url: sessionUrl },
        style: 'emphasis',
        items: [
          { type: 'TextBlock', text: `🔗 ${truncated}`, weight: 'Bolder', size: 'Small', wrap: false, color: 'Accent' },
          { type: 'TextBlock', text: meta, size: 'Small', isSubtle: true, spacing: 'None', wrap: true },
        ],
      });
    }
  }

  const alertsUrl = `${AGENTWATCH_PUBLIC}/alerts`;

  const payload = {
    type: 'AdaptiveCard',
    $schema: 'http://adaptivecards.io/schemas/adaptive-card.json',
    version: '1.4',
    body: cardBody,
    actions: [
      {
        type: 'Action.OpenUrl',
        title: '📊 Open AgentWatch Alerts',
        url: alertsUrl,
      },
    ],
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

  // Persist digest run to DB for the in-app Alerts tab
  try {
    await fetch(`${API_BASE}/api/v2/analytics/digest/save`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        windowStart: since,
        windowEnd: now.toISOString(),
        totalSessions: data.sessions,
        totalCost: data.totalCost,
        totalTokens: data.totalTokens,
        totalToolCalls: data.totalToolCalls,
        avgDurationMs: data.avgDurationMs,
        topModel: data.topModel,
        sessionDetails: data.sessionDetails ?? [],
        sourceBreakdown: data.sourceBreakdown ?? [],
      }),
    });
  } catch {
    // non-fatal — Teams post already succeeded
  }

  console.log(`Digest sent — ${data.sessions} session(s), cost ${fmtCost(data.totalCost)}`);
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
