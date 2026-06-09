import { NextRequest, NextResponse } from 'next/server';
import { ingestSession } from '@/lib/services/session-ingester';
import { analyzeSession, findCriticalPath } from '@/lib/services/debug-analyzer';
import { estimateAgentCost } from '@/lib/utils';
import type { Agent } from '@/types/session';
import type { SessionAnalytics } from '@/types/analytics';

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
    if (currStart - prevEnd > GAP_MS) {
      groups.push([subagents[i]]);
    } else {
      groups[groups.length - 1].push(subagents[i]);
    }
  }
  return groups;
}

function agentDisplayName(agent: Agent): string {
  if (agent.description) return agent.description.slice(0, 50);
  return agent.subagentType || agent.type;
}

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const session = ingestSession(id);

    if (!session) {
      return NextResponse.json({ error: 'Session not found' }, { status: 404 });
    }

    const alerts = analyzeSession(session);
    const criticalPathAgents = findCriticalPath(session);

    // Cost breakdown by model
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

    // Cost breakdown by agent
    const byAgent = session.agents
      .map(a => ({
        agentId: a.id,
        name: agentDisplayName(a),
        cost: estimateAgentCost(a.tokenUsage, a.model),
        tokens: a.tokenUsage.total,
        durationMs: a.durationMs,
      }))
      .sort((a, b) => b.cost - a.cost);

    // Cost breakdown by phase (round grouping)
    const rounds = groupAgentsByRound(session.agents);
    const byPhase = rounds.map((roundAgents, i) => {
      let cost = 0;
      let tokens = 0;
      for (const a of roundAgents) {
        cost += estimateAgentCost(a.tokenUsage, a.model);
        tokens += a.tokenUsage.total;
      }
      return {
        phase: `Round ${i + 1}`,
        cost,
        tokens,
        agentCount: roundAgents.length,
        agentIds: roundAgents.map(a => a.id),
      };
    });

    // Summary
    const totalToolCalls = session.agents.reduce(
      (s, a) => s + a.toolCalls.reduce((t, tc) => t + tc.count, 0), 0
    );
    const totalCacheRead = session.agents.reduce((s, a) => s + a.tokenUsage.cacheRead, 0);
    const totalInput = session.agents.reduce((s, a) => s + a.tokenUsage.input, 0);
    const cacheEfficiency = (totalInput + totalCacheRead) > 0
      ? totalCacheRead / (totalInput + totalCacheRead)
      : 0;

    const analytics: SessionAnalytics = {
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
        cacheEfficiency,
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

    return NextResponse.json(analytics);
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
