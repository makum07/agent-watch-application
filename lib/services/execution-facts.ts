import path from 'path';
import fs from 'fs';
import type { Session, Agent } from '@/types/session';
import type { ExecutionFacts, AgentFacts, AgentTypeGroup } from '@/types/analytics';
import { estimateAgentCost } from '@/lib/utils';
import { getDatabase } from '@/lib/db/database';
import { parseJsonlFile, resolveToolCalls } from '@/lib/parser/jsonl-parser';

function agentDisplayName(agent: Agent): string {
  if (agent.description) return agent.description.slice(0, 80);
  return agent.subagentType || agent.type;
}

function buildAgentFacts(agent: Agent, parentAgent: Agent | null): AgentFacts {
  const totalToolCalls = agent.toolCalls.reduce((s, t) => s + t.count, 0);
  const failed = agent.errorToolCount ?? 0;
  const denied = agent.deniedToolCount ?? 0;

  return {
    agentId: agent.id,
    name: agentDisplayName(agent),
    parentId: agent.parentId,
    parentName: parentAgent ? agentDisplayName(parentAgent) : null,
    type: agent.type,
    subagentType: agent.subagentType,
    model: agent.model,
    status: agent.status,
    depth: agent.depth,
    startTime: agent.startTime,
    endTime: agent.endTime,
    durationMs: agent.durationMs,

    tokenUsage: { ...agent.tokenUsage },
    estimatedCost: estimateAgentCost(agent.tokenUsage, agent.model),
    messageCount: agent.messageCount,

    totalToolCalls,
    successfulToolCalls: Math.max(0, totalToolCalls - failed - denied),
    failedToolCalls: failed,
    deniedToolCalls: denied,
    toolBreakdown: [...agent.toolCalls].sort((a, b) => b.count - a.count),

    childrenIds: [...agent.children],
    childrenCount: agent.children.length,
    promptLength: agent.prompt?.length ?? 0,
    responseLength: agent.response?.length ?? 0,

    skillInvocations: agent.skillInvocations.map(si => ({
      skill: si.skill,
      args: si.args,
      durationMs: si.durationMs,
    })),
  };
}

export function computeExecutionFacts(session: Session): ExecutionFacts {
  const agentById = new Map<string, Agent>();
  for (const a of session.agents) agentById.set(a.id, a);

  const agentFacts: AgentFacts[] = session.agents.map(a =>
    buildAgentFacts(a, a.parentId ? agentById.get(a.parentId) ?? null : null)
  );

  // Orchestrator
  const rootAgent = agentById.get(session.rootAgentId);
  const orchestrator = rootAgent
    ? buildAgentFacts(rootAgent, null)
    : null;

  // Group by resolved type
  const typeMap = new Map<string, AgentFacts[]>();
  for (const af of agentFacts) {
    const key = af.type === 'orchestrator' ? 'orchestrator' : (af.subagentType || af.type);
    const list = typeMap.get(key) || [];
    list.push(af);
    typeMap.set(key, list);
  }

  const agentTypeGroups: AgentTypeGroup[] = [...typeMap.entries()]
    .map(([type, agents]) => ({
      type,
      agents: agents.sort((a, b) => b.estimatedCost - a.estimatedCost),
      totalCost: agents.reduce((s, a) => s + a.estimatedCost, 0),
      totalTokens: agents.reduce((s, a) => s + a.tokenUsage.total, 0),
      totalDuration: agents.reduce((s, a) => s + a.durationMs, 0),
      agentCount: agents.length,
    }))
    .sort((a, b) => b.totalCost - a.totalCost);

  // Models used
  const modelCounts = new Map<string, { cost: number; tokens: number; count: number }>();
  for (const af of agentFacts) {
    const m = modelCounts.get(af.model) || { cost: 0, tokens: 0, count: 0 };
    m.cost += af.estimatedCost;
    m.tokens += af.tokenUsage.total;
    m.count++;
    modelCounts.set(af.model, m);
  }

  const costByModel = [...modelCounts.entries()]
    .map(([model, d]) => ({ model, cost: d.cost, tokens: d.tokens, agentCount: d.count }))
    .sort((a, b) => b.cost - a.cost);

  const costByAgent = agentFacts
    .map(af => ({ agentId: af.agentId, name: af.name, cost: af.estimatedCost, tokens: af.tokenUsage.total, durationMs: af.durationMs }))
    .sort((a, b) => b.cost - a.cost);

  // Summary
  const totalCost = agentFacts.reduce((s, a) => s + a.estimatedCost, 0);
  const totalTokens = agentFacts.reduce((s, a) => s + a.tokenUsage.total, 0);
  const totalToolCalls = agentFacts.reduce((s, a) => s + a.totalToolCalls, 0);
  const totalFailed = agentFacts.reduce((s, a) => s + a.failedToolCalls, 0);
  const totalDenied = agentFacts.reduce((s, a) => s + a.deniedToolCalls, 0);
  const cacheTokens = agentFacts.reduce((s, a) => s + a.tokenUsage.cacheRead, 0);
  const maxDepth = agentFacts.reduce((m, a) => Math.max(m, a.depth), 0);

  // Critical path
  const criticalPath = findCriticalPath(session.agents, session.rootAgentId, agentById);

  // Timeline
  const timeline = agentFacts
    .filter(af => af.startTime)
    .sort((a, b) => new Date(a.startTime).getTime() - new Date(b.startTime).getTime())
    .map(af => ({
      agentId: af.agentId,
      name: af.name,
      type: af.type,
      subagentType: af.subagentType,
      startTime: af.startTime,
      endTime: af.endTime,
      durationMs: af.durationMs,
      depth: af.depth,
      parentId: af.parentId,
    }));

  const failedToolCategories = totalFailed > 0
    ? computeFailedToolCategories(session)
    : [];

  return {
    summary: {
      totalAgents: agentFacts.length,
      totalTokens,
      totalToolCalls,
      totalCost,
      wallClock: session.duration.wallClock,
      agentTime: session.duration.agentTime,
      parallelismFactor: session.duration.parallelismFactor,
      cacheEfficiency: totalTokens > 0 ? cacheTokens / totalTokens : 0,
      modelsUsed: [...modelCounts.keys()],
      maxDepth,
      totalFailedToolCalls: totalFailed,
      totalDeniedToolCalls: totalDenied,
    },
    orchestrator,
    agentFacts,
    agentTypeGroups,
    costBreakdown: { byModel: costByModel, byAgent: costByAgent },
    criticalPath,
    timeline,
    failedToolCategories,
  };
}

function categorizeFailure(toolName: string, result: unknown): string {
  const text = typeof result === 'string' ? result : JSON.stringify(result ?? '');
  const lower = text.toLowerCase();

  if (toolName.startsWith('mcp__')) return 'MCP error';

  if (lower.includes('permission') || lower.includes('denied') || lower.includes('eperm') || lower.includes('eacces')) {
    return 'Permission denied';
  }
  if (lower.includes('timeout') || lower.includes('etimedout')) {
    return 'Timeout';
  }
  if (lower.includes('not found') || lower.includes('enoent') || lower.includes('does not exist') || lower.includes('no such file')) {
    return 'File not found';
  }
  if (toolName === 'Bash' || toolName === 'PowerShell') {
    return 'Command failed';
  }
  return 'Other';
}

function resolveAgentJsonlPath(agentId: string, sessionId: string): string | null {
  const db = getDatabase();
  const agent = db.prepare('SELECT conversation_id, jsonl_path FROM agents WHERE id = ?').get(agentId) as
    | { conversation_id: string; jsonl_path?: string }
    | undefined;
  if (!agent) return null;

  if (agent.jsonl_path && fs.existsSync(agent.jsonl_path)) {
    return agent.jsonl_path;
  }

  const conv = db.prepare('SELECT file_path FROM conversations WHERE id = ?').get(sessionId) as
    | { file_path: string }
    | undefined;
  if (!conv) return null;

  const p = path.join(path.dirname(conv.file_path), `${agent.conversation_id}.jsonl`);
  return fs.existsSync(p) ? p : null;
}

function computeFailedToolCategories(session: Session): Array<{ category: string; count: number; agentIds: string[] }> {
  const categoryMap = new Map<string, { count: number; agentIds: Set<string> }>();

  for (const agent of session.agents) {
    if ((agent.errorToolCount ?? 0) === 0) continue;

    const convPath = resolveAgentJsonlPath(agent.id, session.id);
    if (!convPath) continue;

    try {
      const parsed = parseJsonlFile(convPath);
      const resolved = resolveToolCalls(parsed.messages);

      for (const tc of resolved) {
        if (!tc.isError) continue;
        const cat = categorizeFailure(tc.name, tc.result);
        const entry = categoryMap.get(cat) || { count: 0, agentIds: new Set<string>() };
        entry.count++;
        entry.agentIds.add(agent.id);
        categoryMap.set(cat, entry);
      }
    } catch {
      // Skip agents whose JSONL can't be parsed
    }
  }

  return [...categoryMap.entries()]
    .map(([category, { count, agentIds }]) => ({ category, count, agentIds: [...agentIds] }))
    .sort((a, b) => b.count - a.count);
}

function findCriticalPath(
  agents: Agent[],
  rootId: string,
  agentById: Map<string, Agent>,
): Array<{ agentId: string; name: string; durationMs: number; depth: number }> {
  const childMap = new Map<string, string[]>();
  for (const a of agents) {
    if (a.parentId) {
      const siblings = childMap.get(a.parentId) || [];
      siblings.push(a.id);
      childMap.set(a.parentId, siblings);
    }
  }

  function longest(id: string): Array<{ agentId: string; name: string; durationMs: number; depth: number }> {
    const agent = agentById.get(id);
    if (!agent) return [];
    const node = { agentId: id, name: agentDisplayName(agent), durationMs: agent.durationMs, depth: agent.depth };
    const children = childMap.get(id) || [];
    if (children.length === 0) return [node];

    let best: typeof node[] = [];
    let bestDur = 0;
    for (const cid of children) {
      const path = longest(cid);
      const dur = path.reduce((s, n) => s + n.durationMs, 0);
      if (dur > bestDur) { best = path; bestDur = dur; }
    }
    return [node, ...best];
  }

  return longest(rootId);
}
