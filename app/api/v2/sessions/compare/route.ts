import { NextRequest, NextResponse } from 'next/server';
import { ingestSession } from '@/lib/services/session-ingester';
import { analyzeSession, findCriticalPath } from '@/lib/services/debug-analyzer';
import { estimateAgentCost } from '@/lib/utils';
import type { SessionAnalytics, SessionComparisonData } from '@/types/analytics';
import type { Session, Agent } from '@/types/session';

const GAP_MS = 5 * 60 * 1000;

function groupAgentsByRound(agents: Agent[]): Agent[][] {
  const subagents = agents
    .filter(a => a.type !== 'orchestrator')
    .sort((a, b) => new Date(a.startTime).getTime() - new Date(b.startTime).getTime());
  if (subagents.length === 0) return [];
  const groups: Agent[][] = [[subagents[0]]];
  for (let i = 1; i < subagents.length; i++) {
    const prev = subagents[i - 1];
    const prevEnd = prev.endTime
      ? new Date(prev.endTime).getTime()
      : new Date(prev.startTime).getTime() + (prev.durationMs || 0);
    const currStart = new Date(subagents[i].startTime).getTime();
    if (currStart - prevEnd > GAP_MS) groups.push([subagents[i]]);
    else groups[groups.length - 1].push(subagents[i]);
  }
  return groups;
}

function agentDisplayName(agent: Agent): string {
  if (agent.description) return agent.description.slice(0, 50);
  return agent.subagentType || agent.type;
}

function buildAnalytics(session: Session): SessionAnalytics {
  const alerts = analyzeSession(session);
  const criticalPathAgents = findCriticalPath(session);

  const modelMap = new Map<string, { cost: number; tokens: number; agentCount: number }>();
  for (const a of session.agents) {
    const cost = estimateAgentCost(a.tokenUsage, a.model);
    const entry = modelMap.get(a.model) || { cost: 0, tokens: 0, agentCount: 0 };
    entry.cost += cost;
    entry.tokens += a.tokenUsage.total;
    entry.agentCount += 1;
    modelMap.set(a.model, entry);
  }

  const byModel = [...modelMap.entries()]
    .map(([model, v]) => ({ model, ...v }))
    .sort((a, b) => b.cost - a.cost);

  const byAgent = session.agents
    .map(a => ({
      agentId: a.id,
      name: agentDisplayName(a),
      cost: estimateAgentCost(a.tokenUsage, a.model),
      tokens: a.tokenUsage.total,
      durationMs: a.durationMs,
    }))
    .sort((a, b) => b.cost - a.cost);

  const rounds = groupAgentsByRound(session.agents);
  const byPhase = rounds.map((roundAgents, i) => {
    let cost = 0, tokens = 0;
    for (const a of roundAgents) {
      cost += estimateAgentCost(a.tokenUsage, a.model);
      tokens += a.tokenUsage.total;
    }
    return { phase: `Round ${i + 1}`, cost, tokens, agentCount: roundAgents.length, agentIds: roundAgents.map(a => a.id) };
  });

  const totalToolCalls = session.agents.reduce((s, a) => s + a.toolCalls.reduce((t, tc) => t + tc.count, 0), 0);
  const totalCacheRead = session.agents.reduce((s, a) => s + a.tokenUsage.cacheRead, 0);
  const totalInput = session.agents.reduce((s, a) => s + a.tokenUsage.input, 0);

  return {
    summary: {
      totalAgents: session.totalAgents,
      totalTokens: session.totalTokens,
      totalToolCalls,
      totalCost: session.estimatedCost.total,
      wallClock: session.duration.wallClock,
      agentTime: session.duration.agentTime,
      parallelismFactor: session.duration.parallelismFactor,
      avgTokensPerAgent: session.totalAgents > 0 ? Math.round(session.totalTokens / session.totalAgents) : 0,
      avgDurationPerAgent: session.totalAgents > 0 ? Math.round(session.duration.agentTime / session.totalAgents) : 0,
      avgToolCallsPerAgent: session.totalAgents > 0 ? Math.round(totalToolCalls / session.totalAgents) : 0,
      cacheEfficiency: (totalInput + totalCacheRead) > 0 ? totalCacheRead / (totalInput + totalCacheRead) : 0,
    },
    costBreakdown: { byModel, byAgent, byPhase },
    criticalPath: criticalPathAgents.map(a => ({
      agentId: a.id,
      name: agentDisplayName(a),
      durationMs: a.durationMs,
      depth: a.depth,
    })),
    alerts,
  };
}

function pctDelta(a: number, b: number): number {
  if (a === 0) return b === 0 ? 0 : 100;
  return ((b - a) / a) * 100;
}

export async function GET(req: NextRequest) {
  try {
    const idA = req.nextUrl.searchParams.get('a');
    const idB = req.nextUrl.searchParams.get('b');

    if (!idA || !idB) {
      return NextResponse.json({ error: 'Both ?a= and ?b= session IDs are required' }, { status: 400 });
    }

    const sessionA = ingestSession(idA);
    const sessionB = ingestSession(idB);

    if (!sessionA) return NextResponse.json({ error: `Session A (${idA}) not found` }, { status: 404 });
    if (!sessionB) return NextResponse.json({ error: `Session B (${idB}) not found` }, { status: 404 });

    const analyticsA = buildAnalytics(sessionA);
    const analyticsB = buildAnalytics(sessionB);

    const comparison: SessionComparisonData = {
      sessionA: { ...analyticsA, id: sessionA.id, project: sessionA.project, created: sessionA.created },
      sessionB: { ...analyticsB, id: sessionB.id, project: sessionB.project, created: sessionB.created },
      deltas: {
        costDelta: pctDelta(analyticsA.summary.totalCost, analyticsB.summary.totalCost),
        tokenDelta: pctDelta(analyticsA.summary.totalTokens, analyticsB.summary.totalTokens),
        durationDelta: pctDelta(analyticsA.summary.wallClock, analyticsB.summary.wallClock),
        agentCountDelta: pctDelta(analyticsA.summary.totalAgents, analyticsB.summary.totalAgents),
      },
    };

    return NextResponse.json(comparison);
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
