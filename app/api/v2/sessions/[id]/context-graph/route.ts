import { NextRequest, NextResponse } from 'next/server';
import { getDatabase } from '@/lib/db/database';
import { resolveSessionSource } from '@/lib/api/resolve-source';

export interface AgentContextInfo {
  round: number | null;
  delegatedBy: string[];
  consumedBy: string[];
}

const GAP_MS = 5 * 60 * 1000; // same threshold as agent-sidebar.tsx

/**
 * Assign round numbers to sub-agents using the same time-based algorithm
 * as the sidebar: sort by startTime, then increment round whenever the
 * gap between one agent's END and the next agent's START exceeds GAP_MS.
 * This matches exactly what the user sees in the sidebar groupings.
 */
function assignRounds(
  agents: Array<{ id: string; start_time: number | null; end_time: number | null; duration_ms: number | null }>
): Map<string, number> {
  const sorted = [...agents]
    .filter(a => a.start_time != null)
    .sort((a, b) => (a.start_time ?? 0) - (b.start_time ?? 0));

  const roundMap = new Map<string, number>();
  if (sorted.length === 0) return roundMap;

  let round = 1;
  roundMap.set(sorted[0].id, round);

  for (let i = 1; i < sorted.length; i++) {
    const prev = sorted[i - 1];
    const curr = sorted[i];

    const prevEnd = prev.end_time ?? ((prev.start_time ?? 0) + (prev.duration_ms ?? 0));
    const currStart = curr.start_time ?? 0;

    if (currStart - prevEnd > GAP_MS) round++;
    roundMap.set(curr.id, round);
  }

  return roundMap;
}

/**
 * Sliding-window substring check: true if any `windowSize`-char chunk of
 * `source` (sampled every `step` chars) appears literally in `target`.
 * Catches verbatim excerpts the orchestrator forwarded into a new agent's prompt.
 */
function containsExcerpt(source: string, target: string, windowSize = 60, step = 40): boolean {
  if (!source || !target || source.length < windowSize) return false;
  const src = source.toLowerCase();
  const tgt = target.toLowerCase();
  for (let i = 0; i <= src.length - windowSize; i += step) {
    if (tgt.includes(src.slice(i, i + windowSize))) return true;
  }
  return false;
}

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;

  try {
    const sourceId = await resolveSessionSource(req, id);
    const db = getDatabase(sourceId);

    // Load every non-root agent with timing + content fields
    const rows = db.prepare(`
      SELECT id, prompt, response, start_time, end_time, duration_ms
      FROM agents
      WHERE session_id = ? AND depth > 0
      ORDER BY start_time ASC NULLS LAST
    `).all(id) as Array<{
      id: string;
      prompt: string | null;
      response: string | null;
      start_time: number | null;
      end_time: number | null;
      duration_ms: number | null;
    }>;

    if (rows.length === 0) return NextResponse.json({ graph: {} });

    // ── 1. Time-based round assignment (matches sidebar grouping) ────────────
    const roundMap = assignRounds(rows);

    // ── 2. Content-based delegation/consumption via text overlap ─────────────
    const graph: Record<string, AgentContextInfo> = {};
    const ensure = (agentId: string) => {
      if (!graph[agentId]) {
        graph[agentId] = { round: roundMap.get(agentId) ?? null, delegatedBy: [], consumedBy: [] };
      }
    };

    for (let i = 0; i < rows.length; i++) {
      const agent = rows[i];
      ensure(agent.id);
      if (!agent.prompt) continue;

      for (let j = 0; j < i; j++) {
        const prev = rows[j];
        if (!prev.response) continue;

        if (containsExcerpt(prev.response, agent.prompt)) {
          ensure(prev.id);
          graph[agent.id].delegatedBy.push(prev.id);
          graph[prev.id].consumedBy.push(agent.id);
        }
      }
    }

    // Ensure all agents have an entry even with no relationships
    for (const row of rows) ensure(row.id);

    return NextResponse.json({ graph });
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
