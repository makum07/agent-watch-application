import type { Session, Agent } from '@/types/session';
import type { DebugAlert, AlertSeverity } from '@/types/analytics';

let alertCounter = 0;
function nextId(): string {
  return `alert-${++alertCounter}`;
}

function median(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

function detectBottlenecks(session: Session): DebugAlert[] {
  const alerts: DebugAlert[] = [];
  const durations = session.agents.filter(a => a.durationMs > 0).map(a => a.durationMs);
  if (durations.length < 3) return alerts;

  const med = median(durations);
  if (med === 0) return alerts;

  for (const agent of session.agents) {
    if (agent.durationMs <= 0) continue;
    const ratio = agent.durationMs / med;

    if (ratio > 5) {
      alerts.push({
        id: nextId(),
        category: 'bottleneck',
        severity: 'critical',
        title: `Agent "${agentName(agent)}" is a severe bottleneck`,
        description: `Took ${formatMs(agent.durationMs)} — ${ratio.toFixed(1)}x the median agent duration (${formatMs(med)}).`,
        agentIds: [agent.id],
        metric: agent.durationMs,
        threshold: med * 5,
      });
    } else if (ratio > 2) {
      alerts.push({
        id: nextId(),
        category: 'bottleneck',
        severity: 'warning',
        title: `Agent "${agentName(agent)}" is slower than most`,
        description: `Took ${formatMs(agent.durationMs)} — ${ratio.toFixed(1)}x the median agent duration (${formatMs(med)}).`,
        agentIds: [agent.id],
        metric: agent.durationMs,
        threshold: med * 2,
      });
    }
  }
  return alerts;
}

function detectLoops(session: Session): DebugAlert[] {
  const alerts: DebugAlert[] = [];

  for (const agent of session.agents) {
    for (const tc of agent.toolCalls) {
      if (tc.count > 10) {
        alerts.push({
          id: nextId(),
          category: 'loop',
          severity: tc.count > 30 ? 'critical' : 'warning',
          title: `Agent "${agentName(agent)}" called ${tc.name} ${tc.count} times`,
          description: `Repeated tool calls may indicate a retry loop or inefficient strategy.`,
          agentIds: [agent.id],
          metric: tc.count,
          threshold: 10,
        });
      }
    }
  }

  return alerts;
}

function detectDuplicateWork(session: Session): DebugAlert[] {
  const alerts: DebugAlert[] = [];
  const agentsByDepth = new Map<number, Agent[]>();

  for (const agent of session.agents) {
    const group = agentsByDepth.get(agent.depth) || [];
    group.push(agent);
    agentsByDepth.set(agent.depth, group);
  }

  for (const [depth, agents] of agentsByDepth) {
    if (agents.length < 2) continue;

    for (let i = 0; i < agents.length; i++) {
      for (let j = i + 1; j < agents.length; j++) {
        const a = agents[i];
        const b = agents[j];
        const overlap = toolCallOverlap(a, b);

        if (overlap > 0.6) {
          alerts.push({
            id: nextId(),
            category: 'duplicate-work',
            severity: 'warning',
            title: `Agents "${agentName(a)}" and "${agentName(b)}" may duplicate work`,
            description: `${(overlap * 100).toFixed(0)}% tool call overlap at depth ${depth}. They may be performing similar tasks.`,
            agentIds: [a.id, b.id],
            metric: overlap,
            threshold: 0.6,
          });
        }
      }
    }
  }

  return alerts;
}

function detectExcessiveToolUsage(session: Session): DebugAlert[] {
  const alerts: DebugAlert[] = [];

  for (const agent of session.agents) {
    const totalCalls = agent.toolCalls.reduce((s, t) => s + t.count, 0);

    if (totalCalls > 100) {
      alerts.push({
        id: nextId(),
        category: 'excessive-tools',
        severity: 'warning',
        title: `Agent "${agentName(agent)}" made ${totalCalls} tool calls`,
        description: `High tool call count may indicate thrashing or an overly broad search strategy.`,
        agentIds: [agent.id],
        metric: totalCalls,
        threshold: 100,
      });
    } else if (totalCalls > 50) {
      alerts.push({
        id: nextId(),
        category: 'excessive-tools',
        severity: 'info',
        title: `Agent "${agentName(agent)}" made ${totalCalls} tool calls`,
        description: `Above-average tool usage. May be normal for complex tasks.`,
        agentIds: [agent.id],
        metric: totalCalls,
        threshold: 50,
      });
    }

    // Check for single-tool dominance
    if (totalCalls > 10) {
      for (const tc of agent.toolCalls) {
        if (tc.count / totalCalls > 0.8) {
          alerts.push({
            id: nextId(),
            category: 'excessive-tools',
            severity: 'info',
            title: `Agent "${agentName(agent)}" relies heavily on ${tc.name}`,
            description: `${tc.name} accounts for ${((tc.count / totalCalls) * 100).toFixed(0)}% of all tool calls (${tc.count}/${totalCalls}).`,
            agentIds: [agent.id],
            metric: tc.count / totalCalls,
            threshold: 0.8,
          });
        }
      }
    }
  }

  return alerts;
}

function detectContextBloat(session: Session): DebugAlert[] {
  const alerts: DebugAlert[] = [];

  for (const agent of session.agents) {
    const { input, output, cacheCreation, cacheRead } = agent.tokenUsage;
    if (output === 0) continue;

    const ioRatio = input / output;
    if (ioRatio > 10 && input > 10000) {
      alerts.push({
        id: nextId(),
        category: 'context-bloat',
        severity: 'warning',
        title: `Agent "${agentName(agent)}" has bloated context`,
        description: `Input/output ratio is ${ioRatio.toFixed(1)}:1 (${fmtTokens(input)} in, ${fmtTokens(output)} out). The agent is reading much more than it produces.`,
        agentIds: [agent.id],
        metric: ioRatio,
        threshold: 10,
      });
    }

    // High cache creation with low cache read
    if (cacheCreation > 50000 && cacheRead < cacheCreation * 0.1) {
      alerts.push({
        id: nextId(),
        category: 'context-bloat',
        severity: 'info',
        title: `Agent "${agentName(agent)}" creates cache but rarely reads it`,
        description: `${fmtTokens(cacheCreation)} cache tokens created but only ${fmtTokens(cacheRead)} read back. The cached content may not be reused.`,
        agentIds: [agent.id],
        metric: cacheCreation,
        threshold: 50000,
      });
    }
  }

  return alerts;
}

function detectLongChains(session: Session): DebugAlert[] {
  const alerts: DebugAlert[] = [];
  const maxDepth = Math.max(...session.agents.map(a => a.depth), 0);

  if (maxDepth > 5) {
    const deepest = session.agents.filter(a => a.depth >= 5);
    alerts.push({
      id: nextId(),
      category: 'long-chain',
      severity: 'warning',
      title: `Agent hierarchy reaches depth ${maxDepth}`,
      description: `${deepest.length} agent${deepest.length !== 1 ? 's' : ''} at depth 5+. Deep chains increase latency and context overhead.`,
      agentIds: deepest.map(a => a.id),
      metric: maxDepth,
      threshold: 5,
    });
  } else if (maxDepth > 3) {
    alerts.push({
      id: nextId(),
      category: 'long-chain',
      severity: 'info',
      title: `Agent hierarchy reaches depth ${maxDepth}`,
      description: `Moderately deep agent chain. Consider whether the delegation is necessary.`,
      agentIds: session.agents.filter(a => a.depth === maxDepth).map(a => a.id),
      metric: maxDepth,
      threshold: 3,
    });
  }

  return alerts;
}

// ── Critical path ───────────────────────────────────────────────────────

export function findCriticalPath(session: Session): Agent[] {
  const agentMap = new Map(session.agents.map(a => [a.id, a]));
  const root = session.agents.find(a => a.parentId === null);
  if (!root) return [];

  function longestPath(agent: Agent): Agent[] {
    if (agent.children.length === 0) return [agent];

    let best: Agent[] = [];
    let bestDuration = 0;

    for (const childId of agent.children) {
      const child = agentMap.get(childId);
      if (!child) continue;
      const childPath = longestPath(child);
      const childDuration = childPath.reduce((s, a) => s + a.durationMs, 0);
      if (childDuration > bestDuration) {
        bestDuration = childDuration;
        best = childPath;
      }
    }

    return [agent, ...best];
  }

  return longestPath(root);
}

// ── Main export ─────────────────────────────────────────────────────────

export function analyzeSession(session: Session): DebugAlert[] {
  alertCounter = 0;

  return [
    ...detectBottlenecks(session),
    ...detectLoops(session),
    ...detectDuplicateWork(session),
    ...detectExcessiveToolUsage(session),
    ...detectContextBloat(session),
    ...detectLongChains(session),
  ].sort((a, b) => severityOrder(a.severity) - severityOrder(b.severity));
}

// ── Helpers ─────────────────────────────────────────────────────────────

function severityOrder(s: AlertSeverity): number {
  return s === 'critical' ? 0 : s === 'warning' ? 1 : 2;
}

function agentName(agent: Agent): string {
  if (agent.description) return agent.description.slice(0, 40);
  return agent.subagentType || agent.type;
}

function toolCallOverlap(a: Agent, b: Agent): number {
  const setA = new Set(a.toolCalls.map(t => t.name));
  const setB = new Set(b.toolCalls.map(t => t.name));
  if (setA.size === 0 && setB.size === 0) return 0;
  const intersection = [...setA].filter(t => setB.has(t)).length;
  const union = new Set([...setA, ...setB]).size;
  return union > 0 ? intersection / union : 0;
}

function formatMs(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)}s`;
  return `${Math.floor(ms / 60000)}m ${Math.floor((ms % 60000) / 1000)}s`;
}

function fmtTokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}k`;
  return String(n);
}
