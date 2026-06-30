import { NextRequest, NextResponse } from 'next/server';
import { getDatabase } from '@/lib/db/database';
import { getSources } from '@/lib/sources';

interface DigestRow {
  session_id: string;
  title: string;
  project: string;
  total_tokens: number;
  total_tool_calls: number;
  duration_ms: number;
  estimated_cost: number;
  primary_model: string;
  agent_count: number;
}

export async function GET(req: NextRequest) {
  const url = new URL(req.url);
  const since = url.searchParams.get('since');
  const sinceMs = since
    ? new Date(since).getTime()
    : Date.now() - 2 * 60 * 60 * 1000;

  const sources = getSources();

  let totalSessions = 0;
  let totalCost = 0;
  let totalTokens = 0;
  let totalToolCalls = 0;
  let totalDurationMs = 0;
  const projectCounts: Record<string, number> = {};
  const modelCounts: Record<string, number> = {};
  const sourceBreakdown: Array<{ source: string; sessions: number }> = [];
  const sessionDetails: Array<{
    sessionId: string;
    title: string;
    project: string;
    cost: number;
    tokens: number;
    toolCalls: number;
    durationMs: number;
    agentCount: number;
    model: string;
    source: string;
  }> = [];

  for (const source of sources) {
    try {
      const db = getDatabase(source.id);
      const rows = db.prepare(`
        SELECT session_id, title, project, total_tokens, total_tool_calls,
               duration_ms, estimated_cost, primary_model, agent_count
        FROM session_history
        WHERE session_created >= ?
        ORDER BY estimated_cost DESC
      `).all(sinceMs) as DigestRow[];

      sourceBreakdown.push({ source: source.label, sessions: rows.length });
      totalSessions += rows.length;

      for (const row of rows) {
        totalCost += row.estimated_cost || 0;
        totalTokens += row.total_tokens || 0;
        totalToolCalls += row.total_tool_calls || 0;
        totalDurationMs += row.duration_ms || 0;

        const projectName = row.project.split(/[/\\]/).filter(Boolean).pop() || row.project;
        projectCounts[projectName] = (projectCounts[projectName] || 0) + 1;

        if (row.primary_model) {
          modelCounts[row.primary_model] = (modelCounts[row.primary_model] || 0) + 1;
        }

        sessionDetails.push({
          sessionId: row.session_id,
          title: row.title,
          project: projectName,
          cost: row.estimated_cost || 0,
          tokens: row.total_tokens || 0,
          toolCalls: row.total_tool_calls || 0,
          durationMs: row.duration_ms || 0,
          agentCount: row.agent_count || 0,
          model: row.primary_model,
          source: source.label,
        });
      }
    } catch {
      // source DB not available — skip
    }
  }

  if (totalSessions === 0) {
    return NextResponse.json({ sessions: 0 });
  }

  const topProjects = Object.entries(projectCounts)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([name, count]) => ({ name, count }));

  const topModel = Object.entries(modelCounts)
    .sort((a, b) => b[1] - a[1])[0]?.[0] ?? 'unknown';

  return NextResponse.json({
    sessions: totalSessions,
    since: new Date(sinceMs).toISOString(),
    totalCost,
    totalTokens,
    totalToolCalls,
    avgDurationMs: Math.round(totalDurationMs / totalSessions),
    topProjects,
    topModel,
    sourceBreakdown,
    sessionDetails,
  });
}
