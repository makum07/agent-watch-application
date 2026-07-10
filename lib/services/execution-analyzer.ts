import { spawn } from 'child_process';
import type { Session, Agent } from '@/types/session';
import type {
  AgentOutcome,
  AgentReportCard,
  AgentIssue,
  IssueCategory,
  IssueSeverity,
  DelegationDetail,
  DelegationAssessment,
  ExecutionPhase,
  ExecutionNarrative,
  ImprovementRecommendation,
  EnhancedSummary,
  EnhancedSessionAnalytics,
  ExecutionRecommendation,
  ExecutionFacts,
} from '@/types/analytics';
import { analyzeSession, findCriticalPath } from './debug-analyzer';
import { estimateAgentCost } from '@/lib/utils';
import { getDatabase } from '@/lib/db/database';
import { getWsServer } from '@/lib/websocket/ws-server';
import type { StreamEntry } from '@/types/feedback';

// ── Helpers ─────────────────────────────────────────────────────────────

let issueCounter = 0;
let recCounter = 0;

function nextIssueId(): string { return `issue-${++issueCounter}`; }
function nextRecId(): string { return `rec-${++recCounter}`; }

function agentDisplayName(agent: Agent): string {
  if (agent.description) return agent.description.slice(0, 60);
  return agent.subagentType || agent.type;
}

function totalToolCalls(agent: Agent): number {
  return agent.toolCalls.reduce((s, t) => s + t.count, 0);
}

function median(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
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

function formatCostUsd(usd: number): string {
  if (usd < 0.01) return `$${(usd * 100).toFixed(2)}¢`;
  return `$${usd.toFixed(4)}`;
}

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

// ── 1. Determine Agent Outcome ──────────────────────────────────────────

function determineOutcome(agent: Agent): { outcome: AgentOutcome; reason: string } {
  if (agent.status === 'running') {
    return { outcome: 'running', reason: 'Agent is still running' };
  }

  if (agent.status === 'errored') {
    return { outcome: 'failed', reason: `Agent errored (${agent.errorToolCount} tool errors)` };
  }

  if (agent.status === 'completed_with_errors') {
    if (agent.deniedToolCount > 0 && agent.errorToolCount > 0) {
      return { outcome: 'partial_success', reason: `Completed with ${agent.errorToolCount} tool errors and ${agent.deniedToolCount} permission denials` };
    }
    if (agent.errorToolCount > 0) {
      return { outcome: 'partial_success', reason: `Completed with ${agent.errorToolCount} tool errors` };
    }
    return { outcome: 'partial_success', reason: 'Completed with errors' };
  }

  if (agent.status === 'completed') {
    if (agent.deniedToolCount > 0) {
      return { outcome: 'partial_success', reason: `Completed but ${agent.deniedToolCount} tool calls were denied` };
    }
    if (agent.errorToolCount > 2) {
      return { outcome: 'partial_success', reason: `Completed but encountered ${agent.errorToolCount} tool errors during execution` };
    }
    return { outcome: 'success', reason: 'Completed successfully' };
  }

  if (agent.response) {
    return { outcome: 'unknown', reason: 'Agent produced a response but status is unclear' };
  }

  return { outcome: 'unknown', reason: 'Unable to determine outcome' };
}

// ── 2. Enhanced Summary ─────────────────────────────────────────────────

function computeEnhancedSummary(session: Session): EnhancedSummary {
  const agents = session.agents;
  const totalTC = agents.reduce((s, a) => s + totalToolCalls(a), 0);
  const totalCacheRead = agents.reduce((s, a) => s + a.tokenUsage.cacheRead, 0);
  const totalInput = agents.reduce((s, a) => s + a.tokenUsage.input, 0);
  const cacheEfficiency = (totalInput + totalCacheRead) > 0
    ? totalCacheRead / (totalInput + totalCacheRead) : 0;

  const outcomes = agents.map(a => determineOutcome(a).outcome);
  const successCount = outcomes.filter(o => o === 'success').length;
  const totalWithDenials = agents.filter(a => a.deniedToolCount > 0).length;
  const totalWithErrors = agents.filter(a => a.errorToolCount > 0).length;

  const modelsUsed = [...new Set(agents.map(a => a.model))];
  const maxDepth = Math.max(...agents.map(a => a.depth), 0);
  const orchestratorCount = agents.filter(a => a.type === 'orchestrator').length;
  const leafAgentCount = agents.filter(a => a.children.length === 0).length;

  return {
    totalAgents: session.totalAgents,
    totalTokens: session.totalTokens,
    totalToolCalls: totalTC,
    totalCost: session.estimatedCost.total,
    wallClock: session.duration.wallClock,
    agentTime: session.duration.agentTime,
    parallelismFactor: session.duration.parallelismFactor,
    avgTokensPerAgent: agents.length > 0 ? Math.round(session.totalTokens / agents.length) : 0,
    avgDurationPerAgent: agents.length > 0 ? Math.round(session.duration.agentTime / agents.length) : 0,
    avgToolCallsPerAgent: agents.length > 0 ? Math.round(totalTC / agents.length) : 0,
    cacheEfficiency,
    successRate: agents.length > 0 ? successCount / agents.length : 0,
    errorRate: agents.length > 0 ? totalWithErrors / agents.length : 0,
    denialRate: agents.length > 0 ? totalWithDenials / agents.length : 0,
    modelsUsed,
    maxDepth,
    orchestratorCount,
    leafAgentCount,
  };
}

// ── 3. Agent Report Cards ───────────────────────────────────────────────

function buildAgentReportCards(session: Session): AgentReportCard[] {
  const agents = session.agents;
  const agentMap = new Map(agents.map(a => [a.id, a]));
  const durations = agents.filter(a => a.durationMs > 0).map(a => a.durationMs);
  const medianDuration = median(durations);

  return agents.map(agent => {
    const { outcome, reason } = determineOutcome(agent);
    const tc = totalToolCalls(agent);
    const cost = estimateAgentCost(agent.tokenUsage, agent.model);
    const tokenEff = agent.tokenUsage.total > 0
      ? agent.tokenUsage.output / agent.tokenUsage.total : 0;
    const durationRatio = medianDuration > 0 ? agent.durationMs / medianDuration : 1;

    const childAgents = agent.children.map(id => agentMap.get(id)).filter(Boolean) as Agent[];
    const childOutcomes = childAgents.map(c => determineOutcome(c).outcome);

    const task = agent.prompt ? agent.prompt.slice(0, 200) : null;
    const taskFull = agent.prompt || null;
    const responsePreview = agent.response ? agent.response.slice(0, 300) : null;

    const skills = agent.skillInvocations.map(s => s.skill);

    return {
      agentId: agent.id,
      agentName: agentDisplayName(agent),
      agentType: agent.type,
      subagentType: agent.subagentType,
      parentId: agent.parentId,
      depth: agent.depth,
      task,
      taskFull,
      outcome,
      outcomeReason: reason,
      responsePreview,
      errorToolCount: agent.errorToolCount,
      deniedToolCount: agent.deniedToolCount,
      totalToolCalls: tc,
      toolCallBreakdown: agent.toolCalls,
      durationMs: agent.durationMs,
      durationVsMedianRatio: Math.round(durationRatio * 100) / 100,
      tokenEfficiency: Math.round(tokenEff * 1000) / 1000,
      cost,
      childCount: childAgents.length,
      childSuccessCount: childOutcomes.filter(o => o === 'success').length,
      childFailureCount: childOutcomes.filter(o => o === 'failed').length,
      childPartialCount: childOutcomes.filter(o => o === 'partial_success').length,
      skillsUsed: skills,
      issues: [],
    };
  });
}

// ── 4. Issue Detection ──────────────────────────────────────────────────

function detectIssues(session: Session, reportCards: AgentReportCard[]): AgentIssue[] {
  const issues: AgentIssue[] = [];
  const agents = session.agents;
  const agentMap = new Map(agents.map(a => [a.id, a]));
  const durations = agents.filter(a => a.durationMs > 0).map(a => a.durationMs);
  const medianDuration = median(durations);

  for (const agent of agents) {
    const name = agentDisplayName(agent);
    const tc = totalToolCalls(agent);

    // Error handling issues
    if (agent.errorToolCount > 0) {
      const sev: IssueSeverity = agent.errorToolCount > 5 ? 'critical'
        : agent.errorToolCount > 2 ? 'warning' : 'info';
      issues.push({
        id: nextIssueId(),
        category: 'error_handling',
        severity: sev,
        title: `${name}: ${agent.errorToolCount} tool errors`,
        explanation: `This agent encountered ${agent.errorToolCount} tool errors during execution, indicating failed operations that may have impacted the final result.`,
        rootCause: agent.errorToolCount > 5
          ? 'Agent is repeatedly attempting operations that fail — possible misconfiguration, wrong file paths, or unsupported tool usage patterns.'
          : 'Some tool calls failed during execution. This may indicate edge cases in the agent\'s approach.',
        agentIds: [agent.id],
        metric: agent.errorToolCount,
        recommendation: `Review the agent's tool call patterns. ${agent.errorToolCount > 5 ? 'Consider adding error recovery logic or better input validation to the prompt.' : 'Check if the errors were transient or systematic.'}`,
      });
    }

    // Permission denial issues
    if (agent.deniedToolCount > 0) {
      const sev: IssueSeverity = agent.deniedToolCount > 3 ? 'critical'
        : agent.deniedToolCount > 1 ? 'warning' : 'info';
      issues.push({
        id: nextIssueId(),
        category: 'permission_denial',
        severity: sev,
        title: `${name}: ${agent.deniedToolCount} permission denials`,
        explanation: `${agent.deniedToolCount} tool calls were denied by the user/permission system. The agent attempted operations it wasn't authorized to perform.`,
        rootCause: 'The agent\'s prompt or workflow led it to attempt actions outside its permitted scope. This wastes tokens and time on denied operations.',
        agentIds: [agent.id],
        metric: agent.deniedToolCount,
        recommendation: 'Update the agent prompt to clarify permitted operations, or adjust permission settings if the denied operations are legitimately needed.',
      });
    }

    // Retry loop detection
    for (const tc_item of agent.toolCalls) {
      if (tc_item.count > 15) {
        issues.push({
          id: nextIssueId(),
          category: 'retry_loop',
          severity: tc_item.count > 30 ? 'critical' : 'warning',
          title: `${name}: ${tc_item.name} called ${tc_item.count} times`,
          explanation: `Unusually high repetition of a single tool call suggests the agent is stuck in a retry loop or using an inefficient search strategy.`,
          rootCause: `The agent called ${tc_item.name} ${tc_item.count} times. This typically happens when the agent keeps retrying a failing operation or iteratively searching without converging.`,
          agentIds: [agent.id],
          metric: tc_item.count,
          recommendation: `Add explicit instructions in the prompt to limit retries, try alternative approaches after failures, or break down the task into smaller steps.`,
        });
      }
    }

    // Context bloat
    const { input, output } = agent.tokenUsage;
    if (output > 0 && input / output > 10 && input > 10000) {
      issues.push({
        id: nextIssueId(),
        category: 'context_bloat',
        severity: 'warning',
        title: `${name}: bloated context (${fmtTokens(input)} in / ${fmtTokens(output)} out)`,
        explanation: `The agent consumed ${fmtTokens(input)} input tokens but only produced ${fmtTokens(output)} output. It is reading far more than it produces, wasting cost on unused context.`,
        rootCause: 'The agent is reading large files or receiving excessive context that it doesn\'t need for its task. This inflates cost without improving output quality.',
        agentIds: [agent.id],
        metric: input / output,
        recommendation: 'Reduce the context provided to the agent — use targeted file reads, limit search scope, or split the task so each sub-agent only receives relevant context.',
      });
    }

    // Slow execution
    if (medianDuration > 0 && agent.durationMs > medianDuration * 5 && agent.durationMs > 30000) {
      issues.push({
        id: nextIssueId(),
        category: 'slow_execution',
        severity: 'warning',
        title: `${name}: ${formatMs(agent.durationMs)} (${(agent.durationMs / medianDuration).toFixed(1)}x median)`,
        explanation: `This agent took ${formatMs(agent.durationMs)}, which is ${(agent.durationMs / medianDuration).toFixed(1)}x the median agent duration of ${formatMs(medianDuration)}. It is a bottleneck on the critical path.`,
        rootCause: 'The agent is either handling an overly complex task, stuck in retry loops, or waiting on slow operations.',
        agentIds: [agent.id],
        metric: agent.durationMs,
        recommendation: 'Consider splitting this agent\'s task into parallel sub-agents, or investigate whether slow tool calls can be optimized.',
      });
    }

    // Empty result
    if (agent.status === 'completed' && !agent.response && agent.type !== 'orchestrator') {
      issues.push({
        id: nextIssueId(),
        category: 'empty_result',
        severity: 'warning',
        title: `${name}: completed but produced no response`,
        explanation: 'The agent completed execution but did not produce a response. This may indicate the agent silently failed or the task was trivial.',
        rootCause: 'The agent finished without generating output text, which means its work products may not have been captured or communicated back to the orchestrator.',
        agentIds: [agent.id],
        recommendation: 'Ensure the agent prompt explicitly asks for a summary or result. Check if the agent\'s work was captured via side effects (file writes) rather than response text.',
      });
    }

    // No tool usage for subagents (suspicious for code-working agents)
    if (agent.type === 'subagent' && tc === 0 && agent.tokenUsage.total > 1000) {
      issues.push({
        id: nextIssueId(),
        category: 'no_tool_usage',
        severity: 'info',
        title: `${name}: no tool calls despite significant token usage`,
        explanation: `This agent used ${fmtTokens(agent.tokenUsage.total)} tokens but made no tool calls. It may have been reasoning without taking action, or the task might not have required tools.`,
        rootCause: 'The agent consumed tokens in reasoning but never invoked tools. This could be intentional (pure analysis) or indicate the agent was confused about its capabilities.',
        agentIds: [agent.id],
        recommendation: 'If the agent should have used tools, ensure the prompt includes clear instructions for tool usage. If analysis-only, this may be expected.',
      });
    }

    // Excessive output
    if (agent.tokenUsage.output > 20000) {
      issues.push({
        id: nextIssueId(),
        category: 'excessive_output',
        severity: 'info',
        title: `${name}: very high output (${fmtTokens(agent.tokenUsage.output)} tokens)`,
        explanation: `This agent produced ${fmtTokens(agent.tokenUsage.output)} output tokens. High output may indicate verbose responses or large generated artifacts.`,
        rootCause: 'The agent produced more output than typical, which costs more and may indicate verbosity or unnecessarily detailed responses.',
        agentIds: [agent.id],
        metric: agent.tokenUsage.output,
        recommendation: 'Consider adding instructions to be concise, or breaking the task so output is naturally shorter.',
      });
    }
  }

  // Deep nesting
  const maxDepth = Math.max(...agents.map(a => a.depth), 0);
  if (maxDepth > 4) {
    const deepAgents = agents.filter(a => a.depth >= 4);
    issues.push({
      id: nextIssueId(),
      category: 'deep_nesting',
      severity: maxDepth > 6 ? 'critical' : 'warning',
      title: `Agent hierarchy reaches depth ${maxDepth}`,
      explanation: `${deepAgents.length} agent(s) are at depth 4+. Deep delegation chains increase latency, context overhead, and reduce traceability.`,
      rootCause: 'The orchestration design uses too many levels of delegation, where intermediate agents add overhead without proportional value.',
      agentIds: deepAgents.map(a => a.id),
      metric: maxDepth,
      recommendation: 'Flatten the hierarchy by having the orchestrator delegate directly to leaf agents where possible, or combine intermediate delegation steps.',
    });
  }

  // Duplicate work detection
  const agentsByDepth = new Map<number, Agent[]>();
  for (const agent of agents) {
    const group = agentsByDepth.get(agent.depth) || [];
    group.push(agent);
    agentsByDepth.set(agent.depth, group);
  }
  for (const [depth, group] of agentsByDepth) {
    if (group.length < 2) continue;
    for (let i = 0; i < group.length; i++) {
      for (let j = i + 1; j < group.length; j++) {
        const a = group[i], b = group[j];
        const setA = new Set(a.toolCalls.map(t => t.name));
        const setB = new Set(b.toolCalls.map(t => t.name));
        if (setA.size === 0 && setB.size === 0) continue;
        const intersection = [...setA].filter(t => setB.has(t)).length;
        const union = new Set([...setA, ...setB]).size;
        const overlap = union > 0 ? intersection / union : 0;
        if (overlap > 0.6) {
          issues.push({
            id: nextIssueId(),
            category: 'duplicate_work',
            severity: 'warning',
            title: `"${agentDisplayName(a)}" and "${agentDisplayName(b)}" may duplicate work`,
            explanation: `${(overlap * 100).toFixed(0)}% tool call overlap at depth ${depth}. These agents are using similar tools in similar patterns, suggesting redundant work.`,
            rootCause: 'The orchestrator delegated overlapping tasks to multiple agents, or their prompts are not sufficiently differentiated.',
            agentIds: [a.id, b.id],
            metric: overlap,
            recommendation: 'Differentiate agent prompts more clearly, or combine them into a single agent if the tasks are truly the same.',
          });
        }
      }
    }
  }

  // Delegation failure detection
  for (const agent of agents) {
    if (agent.children.length === 0) continue;
    const childAgents = agent.children.map(id => agentMap.get(id)).filter(Boolean) as Agent[];
    const childOutcomes = childAgents.map(c => determineOutcome(c));
    const failedChildren = childOutcomes.filter(o => o.outcome === 'failed').length;
    if (failedChildren > 0 && failedChildren >= childAgents.length * 0.5) {
      issues.push({
        id: nextIssueId(),
        category: 'delegation_failure',
        severity: failedChildren === childAgents.length ? 'critical' : 'warning',
        title: `${agentDisplayName(agent)}: ${failedChildren}/${childAgents.length} delegated agents failed`,
        explanation: `${failedChildren} out of ${childAgents.length} child agents failed. This indicates problems with how tasks were delegated — either the prompts were unclear, the tasks were impossible, or the wrong agent types were used.`,
        rootCause: 'The orchestrator delegated tasks that child agents could not complete successfully. This may be due to unclear prompts, wrong agent type selection, or impossible subtasks.',
        agentIds: [agent.id, ...childAgents.filter((_, i) => childOutcomes[i].outcome === 'failed').map(c => c.id)],
        metric: failedChildren,
        recommendation: 'Review the prompts given to failed child agents. Ensure tasks are well-scoped, achievable, and assigned to appropriate agent types.',
      });
    }
  }

  // Model mismatch heuristic
  for (const agent of agents) {
    const model = agent.model.toLowerCase();
    const isOpus = model.includes('opus');
    const agentTC = totalToolCalls(agent);
    if (isOpus && agentTC < 5 && agent.tokenUsage.total < 5000 && agent.type === 'subagent') {
      issues.push({
        id: nextIssueId(),
        category: 'model_mismatch',
        severity: 'info',
        title: `${agentDisplayName(agent)}: Opus used for simple task`,
        explanation: `This agent used Opus (most expensive model) but only made ${agentTC} tool calls and used ${fmtTokens(agent.tokenUsage.total)} tokens. A cheaper model like Sonnet may have been sufficient.`,
        rootCause: 'The agent was assigned a high-cost model for a task that didn\'t require the full capability, wasting budget.',
        agentIds: [agent.id],
        metric: estimateAgentCost(agent.tokenUsage, agent.model),
        recommendation: 'Consider using Sonnet or Haiku for simpler tasks to reduce cost without sacrificing quality.',
      });
    }
  }

  // Attach issues to report cards
  for (const issue of issues) {
    for (const rc of reportCards) {
      if (issue.agentIds.includes(rc.agentId)) {
        rc.issues.push(issue);
      }
    }
  }

  return issues.sort((a, b) => severityOrder(a.severity) - severityOrder(b.severity));
}

function severityOrder(s: IssueSeverity): number {
  return s === 'critical' ? 0 : s === 'warning' ? 1 : 2;
}

// ── 5. Delegation Analysis ──────────────────────────────────────────────

function analyzeDelegation(session: Session): DelegationAssessment[] {
  const agents = session.agents;
  const agentMap = new Map(agents.map(a => [a.id, a]));
  const assessments: DelegationAssessment[] = [];

  for (const agent of agents) {
    if (agent.children.length === 0) continue;

    const delegations: DelegationDetail[] = [];
    let successCount = 0;
    let failedCount = 0;

    for (const childId of agent.children) {
      const child = agentMap.get(childId);
      if (!child) continue;

      const promptLen = child.prompt?.length ?? 0;
      let promptQuality: DelegationDetail['promptQuality'];
      let promptQualityReason: string;
      if (promptLen === 0) {
        promptQuality = 'none';
        promptQualityReason = 'No prompt was provided to this agent.';
      } else if (promptLen < 50) {
        promptQuality = 'sparse';
        promptQualityReason = `Prompt is only ${promptLen} characters — likely too vague for reliable execution.`;
      } else if (promptLen < 200) {
        promptQuality = 'adequate';
        promptQualityReason = `Prompt is ${promptLen} characters — provides some direction but could be more specific.`;
      } else {
        promptQuality = 'detailed';
        promptQualityReason = `Prompt is ${promptLen} characters — provides detailed instructions.`;
      }

      const agentTypeMatch = assessAgentTypeMatch(child);
      const childOutcome = determineOutcome(child);
      const childCost = estimateAgentCost(child.tokenUsage, child.model);

      if (childOutcome.outcome === 'success') successCount++;
      if (childOutcome.outcome === 'failed') failedCount++;

      const issues: string[] = [];
      if (promptQuality === 'none' || promptQuality === 'sparse') {
        issues.push('Insufficient prompt detail for reliable delegation');
      }
      if (agentTypeMatch.match === 'questionable') {
        issues.push(agentTypeMatch.reason);
      }
      if (childOutcome.outcome === 'failed') {
        issues.push(`Child agent failed: ${childOutcome.reason}`);
      }

      delegations.push({
        childAgentId: child.id,
        childName: agentDisplayName(child),
        childType: child.subagentType,
        promptLength: promptLen,
        promptQuality,
        promptQualityReason,
        agentTypeMatch: agentTypeMatch.match,
        agentTypeMatchReason: agentTypeMatch.reason,
        childOutcome: childOutcome.outcome,
        childCost,
        childDurationMs: child.durationMs,
        issues,
      });
    }

    const totalDel = delegations.length;
    let overallScore: DelegationAssessment['overallScore'];
    const successRate = totalDel > 0 ? successCount / totalDel : 0;
    if (successRate >= 0.8) overallScore = 'good';
    else if (successRate >= 0.5) overallScore = 'needs_improvement';
    else overallScore = 'poor';

    const notes: string[] = [];
    if (overallScore === 'poor') {
      notes.push(`Only ${successCount}/${totalDel} delegated tasks succeeded.`);
    }
    const sparsePrompts = delegations.filter(d => d.promptQuality === 'none' || d.promptQuality === 'sparse');
    if (sparsePrompts.length > 0) {
      notes.push(`${sparsePrompts.length} delegation(s) had sparse or missing prompts.`);
    }
    const questionableTypes = delegations.filter(d => d.agentTypeMatch === 'questionable');
    if (questionableTypes.length > 0) {
      notes.push(`${questionableTypes.length} delegation(s) may have used a mismatched agent type.`);
    }

    assessments.push({
      orchestratorId: agent.id,
      orchestratorName: agentDisplayName(agent),
      totalDelegations: totalDel,
      successfulDelegations: successCount,
      failedDelegations: failedCount,
      delegations,
      overallScore,
      overallNotes: notes,
    });
  }

  return assessments;
}

function assessAgentTypeMatch(child: Agent): { match: 'appropriate' | 'questionable' | 'unknown'; reason: string } {
  const subType = child.subagentType?.toLowerCase() ?? '';
  const prompt = child.prompt?.toLowerCase() ?? '';

  if (!subType || subType === 'fork') {
    return { match: 'unknown', reason: 'No specific agent type was assigned (fork or untyped).' };
  }

  const typeHints: Record<string, string[]> = {
    'explore': ['search', 'find', 'look', 'locate', 'grep', 'where', 'list'],
    'code-reviewer': ['review', 'audit', 'check', 'verify', 'quality'],
    'plan': ['plan', 'design', 'architect', 'strategy', 'approach'],
  };

  for (const [expectedType, keywords] of Object.entries(typeHints)) {
    if (subType.includes(expectedType)) {
      return { match: 'appropriate', reason: `Agent type "${subType}" matches its role.` };
    }
    if (keywords.some(kw => prompt.includes(kw)) && subType.includes(expectedType)) {
      return { match: 'appropriate', reason: `Agent type "${subType}" aligns with prompt intent.` };
    }
  }

  return { match: 'unknown', reason: `Agent type "${subType}" — unable to assess fit automatically.` };
}

// ── 6. Execution Narrative ──────────────────────────────────────────────

function buildExecutionNarrative(session: Session): ExecutionNarrative {
  const agents = session.agents;
  const rounds = groupAgentsByRound(agents);

  const phases: ExecutionPhase[] = rounds.map((roundAgents, i) => {
    let cost = 0;
    let tokens = 0;
    const starts: number[] = [];
    const ends: number[] = [];

    for (const a of roundAgents) {
      cost += estimateAgentCost(a.tokenUsage, a.model);
      tokens += a.tokenUsage.total;
      starts.push(new Date(a.startTime).getTime());
      if (a.endTime) ends.push(new Date(a.endTime).getTime());
    }

    const startTime = new Date(Math.min(...starts)).toISOString();
    const endTime = ends.length > 0
      ? new Date(Math.max(...ends)).toISOString()
      : new Date(Math.min(...starts) + roundAgents.reduce((s, a) => s + a.durationMs, 0)).toISOString();
    const durationMs = new Date(endTime).getTime() - new Date(startTime).getTime();

    const outcomes = roundAgents.map(a => {
      const o = determineOutcome(a);
      return `${agentDisplayName(a)}: ${o.outcome}`;
    });

    const agentTypes = roundAgents.map(a => a.subagentType || a.type);
    const uniqueTypes = [...new Set(agentTypes)];
    const label = uniqueTypes.length <= 3
      ? uniqueTypes.join(', ')
      : `${uniqueTypes.slice(0, 2).join(', ')} + ${uniqueTypes.length - 2} more`;

    return {
      phaseNumber: i + 1,
      label: `Round ${i + 1}: ${label}`,
      description: `${roundAgents.length} agent(s) executed in parallel. Types: ${uniqueTypes.join(', ')}.`,
      agents: roundAgents.map(a => a.id),
      startTime,
      endTime,
      durationMs,
      cost,
      outcomeDescription: outcomes.join('; '),
    };
  });

  const allOutcomes = agents.map(a => determineOutcome(a).outcome);
  const successCount = allOutcomes.filter(o => o === 'success').length;
  const failedCount = allOutcomes.filter(o => o === 'failed').length;

  let outcome: string;
  if (failedCount === 0) {
    outcome = `Execution completed successfully. All ${agents.length} agents finished their tasks.`;
  } else if (failedCount < agents.length / 2) {
    outcome = `Execution completed with issues. ${successCount}/${agents.length} agents succeeded, ${failedCount} failed.`;
  } else {
    outcome = `Execution had significant failures. ${failedCount}/${agents.length} agents failed.`;
  }

  const root = agents.find(a => a.parentId === null);
  const summaryParts: string[] = [];
  summaryParts.push(`Session "${session.project}" executed with ${agents.length} agents across ${phases.length} round(s).`);
  if (root) {
    summaryParts.push(`The orchestrator (${agentDisplayName(root)}) delegated to ${root.children.length} top-level agents.`);
  }
  summaryParts.push(`Total cost: ${formatCostUsd(session.estimatedCost.total)}, wall clock: ${formatMs(session.duration.wallClock)}.`);

  return {
    summary: summaryParts.join(' '),
    phases,
    outcome,
  };
}

// ── 7. Recommendations ─────────────────────────────────────────────────

function generateRecommendations(
  session: Session,
  issues: AgentIssue[],
  delegations: DelegationAssessment[],
  reportCards: AgentReportCard[]
): ImprovementRecommendation[] {
  const recs: ImprovementRecommendation[] = [];

  // From critical issues — high priority
  const criticalIssues = issues.filter(i => i.severity === 'critical');
  for (const issue of criticalIssues) {
    recs.push({
      id: nextRecId(),
      priority: 'high',
      target: issueToTarget(issue.category),
      targetName: issue.agentIds.length > 0 ? agentDisplayName(session.agents.find(a => a.id === issue.agentIds[0])!) : 'system',
      title: `Fix: ${issue.title}`,
      problem: issue.explanation,
      recommendation: issue.recommendation,
      evidence: [`${issue.category}: ${issue.explanation}`],
      relatedAgentIds: issue.agentIds,
    });
  }

  // From delegation failures
  for (const da of delegations) {
    if (da.overallScore === 'poor') {
      recs.push({
        id: nextRecId(),
        priority: 'high',
        target: 'orchestrator',
        targetName: da.orchestratorName,
        title: `Improve delegation strategy for ${da.orchestratorName}`,
        problem: `Only ${da.successfulDelegations}/${da.totalDelegations} delegated tasks succeeded.`,
        recommendation: da.overallNotes.join(' ') + ' Review and improve the orchestrator\'s delegation prompts and agent type selection.',
        evidence: da.delegations.filter(d => d.issues.length > 0).map(d => `${d.childName}: ${d.issues.join(', ')}`),
        relatedAgentIds: [...new Set([da.orchestratorId, ...da.delegations.map(d => d.childAgentId)])],
      });
    }
  }

  // From warning-level patterns — medium priority
  const warningIssues = issues.filter(i => i.severity === 'warning');
  const issuesByCategory = new Map<IssueCategory, AgentIssue[]>();
  for (const issue of warningIssues) {
    const list = issuesByCategory.get(issue.category) || [];
    list.push(issue);
    issuesByCategory.set(issue.category, list);
  }

  for (const [category, categoryIssues] of issuesByCategory) {
    if (categoryIssues.length >= 2) {
      recs.push({
        id: nextRecId(),
        priority: 'medium',
        target: issueToTarget(category),
        targetName: `${categoryIssues.length} agents`,
        title: `Address recurring ${category.replace(/_/g, ' ')} pattern`,
        problem: `${categoryIssues.length} agents share the same issue: ${category.replace(/_/g, ' ')}.`,
        recommendation: categoryIssues[0].recommendation,
        evidence: categoryIssues.map(i => i.title),
        relatedAgentIds: [...new Set(categoryIssues.flatMap(i => i.agentIds))],
      });
    }
  }

  // Cost optimization
  const costByAgent = reportCards
    .filter(rc => rc.cost > 0)
    .sort((a, b) => b.cost - a.cost);
  if (costByAgent.length > 0) {
    const topCost = costByAgent[0];
    const totalCost = session.estimatedCost.total;
    if (totalCost > 0 && topCost.cost / totalCost > 0.4) {
      recs.push({
        id: nextRecId(),
        priority: 'medium',
        target: 'agent_type',
        targetName: topCost.agentName,
        title: `Optimize cost for ${topCost.agentName}`,
        problem: `This agent accounts for ${((topCost.cost / totalCost) * 100).toFixed(0)}% of total session cost (${formatCostUsd(topCost.cost)}).`,
        recommendation: 'Consider whether a cheaper model, reduced context, or task decomposition could lower cost without sacrificing quality.',
        evidence: [`Cost: ${formatCostUsd(topCost.cost)}`, `Tokens: ${fmtTokens(topCost.totalToolCalls)} tool calls`, `Duration: ${formatMs(topCost.durationMs)}`],
        relatedAgentIds: [topCost.agentId],
      });
    }
  }

  // Parallelism recommendation
  if (session.duration.parallelismFactor < 1.5 && session.totalAgents > 3) {
    recs.push({
      id: nextRecId(),
      priority: 'low',
      target: 'architecture',
      targetName: 'workflow',
      title: 'Low parallelism — consider concurrent execution',
      problem: `Parallelism factor is ${session.duration.parallelismFactor.toFixed(2)}. With ${session.totalAgents} agents, more work could run concurrently.`,
      recommendation: 'Restructure the workflow to run independent tasks in parallel rather than sequentially. Group related work and delegate in batches.',
      evidence: [`Wall clock: ${formatMs(session.duration.wallClock)}`, `Agent time: ${formatMs(session.duration.agentTime)}`],
      relatedAgentIds: [],
    });
  }

  return recs.sort((a, b) => priorityOrder(a.priority) - priorityOrder(b.priority));
}

function issueToTarget(category: IssueCategory): ImprovementRecommendation['target'] {
  switch (category) {
    case 'delegation_failure': return 'orchestrator';
    case 'permission_denial': return 'permissions';
    case 'model_mismatch': return 'agent_type';
    case 'deep_nesting': return 'architecture';
    default: return 'agent_type';
  }
}

function priorityOrder(p: ImprovementRecommendation['priority']): number {
  return p === 'high' ? 0 : p === 'medium' ? 1 : 2;
}

// ── 8. Copyable Analysis Text ───────────────────────────────────────────

function generateCopyableAnalysis(
  session: Session,
  summary: EnhancedSummary,
  issues: AgentIssue[],
  reportCards: AgentReportCard[],
  delegations: DelegationAssessment[],
  recommendations: ImprovementRecommendation[],
  narrative: ExecutionNarrative
): string {
  const lines: string[] = [];
  const date = new Date(session.created).toISOString().slice(0, 10);

  lines.push(`# Execution Analysis — ${session.project} — ${date}`);
  lines.push('');

  // Summary
  lines.push('## Summary');
  lines.push(`- **Agents:** ${summary.totalAgents} (${summary.orchestratorCount} orchestrators, ${summary.leafAgentCount} leaf agents)`);
  lines.push(`- **Success Rate:** ${(summary.successRate * 100).toFixed(0)}%`);
  lines.push(`- **Error Rate:** ${(summary.errorRate * 100).toFixed(0)}%`);
  lines.push(`- **Denial Rate:** ${(summary.denialRate * 100).toFixed(0)}%`);
  lines.push(`- **Total Cost:** ${formatCostUsd(summary.totalCost)}`);
  lines.push(`- **Total Tokens:** ${fmtTokens(summary.totalTokens)}`);
  lines.push(`- **Wall Clock:** ${formatMs(summary.wallClock)}`);
  lines.push(`- **Parallelism:** ${summary.parallelismFactor.toFixed(2)}x`);
  lines.push(`- **Max Depth:** ${summary.maxDepth}`);
  lines.push(`- **Models Used:** ${summary.modelsUsed.join(', ')}`);
  lines.push(`- **Cache Efficiency:** ${(summary.cacheEfficiency * 100).toFixed(0)}%`);
  lines.push('');

  // Execution narrative
  lines.push('## Execution Flow');
  lines.push(narrative.summary);
  lines.push('');
  for (const phase of narrative.phases) {
    lines.push(`### ${phase.label}`);
    lines.push(`- Duration: ${formatMs(phase.durationMs)} | Cost: ${formatCostUsd(phase.cost)}`);
    lines.push(`- Outcome: ${phase.outcomeDescription}`);
    lines.push('');
  }
  lines.push(`**Overall Outcome:** ${narrative.outcome}`);
  lines.push('');

  // Issues
  const criticalIssues = issues.filter(i => i.severity === 'critical');
  const warningIssues = issues.filter(i => i.severity === 'warning');
  const infoIssues = issues.filter(i => i.severity === 'info');

  if (issues.length > 0) {
    lines.push('## Issues Found');
    lines.push('');

    if (criticalIssues.length > 0) {
      lines.push('### Critical');
      for (const issue of criticalIssues) {
        lines.push(`- **${issue.title}**`);
        lines.push(`  - Root Cause: ${issue.rootCause}`);
        lines.push(`  - Recommendation: ${issue.recommendation}`);
      }
      lines.push('');
    }
    if (warningIssues.length > 0) {
      lines.push('### Warnings');
      for (const issue of warningIssues) {
        lines.push(`- **${issue.title}**`);
        lines.push(`  - Root Cause: ${issue.rootCause}`);
        lines.push(`  - Recommendation: ${issue.recommendation}`);
      }
      lines.push('');
    }
    if (infoIssues.length > 0) {
      lines.push('### Info');
      for (const issue of infoIssues) {
        lines.push(`- **${issue.title}**: ${issue.rootCause}`);
      }
      lines.push('');
    }
  }

  // Problem agent report cards (top 20 by issue count, cost, errors)
  const problemAgents = [...reportCards]
    .filter(rc => rc.issues.length > 0 || rc.outcome === 'failed' || rc.outcome === 'partial_success')
    .sort((a, b) => {
      const scoreA = a.issues.length * 10 + (a.outcome === 'failed' ? 100 : 0) + a.errorToolCount + a.deniedToolCount;
      const scoreB = b.issues.length * 10 + (b.outcome === 'failed' ? 100 : 0) + b.errorToolCount + b.deniedToolCount;
      return scoreB - scoreA;
    })
    .slice(0, 20);

  if (problemAgents.length > 0) {
    lines.push('## Agent Report Cards (problematic agents)');
    lines.push('');
    for (const rc of problemAgents) {
      lines.push(`### ${rc.agentName} (${rc.agentType}${rc.subagentType ? `/${rc.subagentType}` : ''})`);
      lines.push(`- **Outcome:** ${rc.outcome} — ${rc.outcomeReason}`);
      lines.push(`- **Cost:** ${formatCostUsd(rc.cost)} | Duration: ${formatMs(rc.durationMs)} (${rc.durationVsMedianRatio}x median)`);
      lines.push(`- **Tool Calls:** ${rc.totalToolCalls} | Errors: ${rc.errorToolCount} | Denials: ${rc.deniedToolCount}`);
      if (rc.task) {
        lines.push(`- **Task:** ${rc.task}`);
      }
      if (rc.issues.length > 0) {
        lines.push(`- **Issues:** ${rc.issues.map(i => i.title).join('; ')}`);
      }
      lines.push('');
    }
  }

  // Delegation quality
  const problemDelegations = delegations.filter(d => d.overallScore !== 'good');
  if (problemDelegations.length > 0) {
    lines.push('## Delegation Quality');
    lines.push('');
    for (const da of problemDelegations) {
      lines.push(`### ${da.orchestratorName} — ${da.overallScore.replace(/_/g, ' ')}`);
      lines.push(`- ${da.successfulDelegations}/${da.totalDelegations} delegations succeeded`);
      for (const note of da.overallNotes) {
        lines.push(`- ${note}`);
      }
      lines.push('');
    }
  }

  // Recommendations
  if (recommendations.length > 0) {
    lines.push('## Recommendations');
    lines.push('');
    for (const rec of recommendations) {
      lines.push(`### [${rec.priority.toUpperCase()}] ${rec.title}`);
      lines.push(`- **Problem:** ${rec.problem}`);
      lines.push(`- **Recommendation:** ${rec.recommendation}`);
      if (rec.evidence.length > 0) {
        lines.push(`- **Evidence:** ${rec.evidence.join('; ')}`);
      }
      lines.push('');
    }
  }

  return lines.join('\n');
}

// ── Main Entry Point ────────────────────────────────────────────────────

export function analyzeExecution(session: Session): EnhancedSessionAnalytics {
  issueCounter = 0;
  recCounter = 0;

  const enhancedSummary = computeEnhancedSummary(session);
  const agentReportCards = buildAgentReportCards(session);
  const issues = detectIssues(session, agentReportCards);
  const delegationAssessments = analyzeDelegation(session);
  const executionNarrative = buildExecutionNarrative(session);
  const recommendations = generateRecommendations(session, issues, delegationAssessments, agentReportCards);
  const copyableAnalysis = generateCopyableAnalysis(
    session, enhancedSummary, issues, agentReportCards,
    delegationAssessments, recommendations, executionNarrative
  );

  // Legacy compatibility: compute original SessionAnalytics fields
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
    let cost = 0;
    let tokens = 0;
    for (const a of roundAgents) {
      cost += estimateAgentCost(a.tokenUsage, a.model);
      tokens += a.tokenUsage.total;
    }
    return {
      phase: `Round ${i + 1}`,
      cost, tokens,
      agentCount: roundAgents.length,
      agentIds: roundAgents.map(a => a.id),
    };
  });

  return {
    summary: {
      totalAgents: session.totalAgents,
      totalTokens: session.totalTokens,
      totalToolCalls: enhancedSummary.totalToolCalls,
      totalCost: session.estimatedCost.total,
      wallClock: session.duration.wallClock,
      agentTime: session.duration.agentTime,
      parallelismFactor: session.duration.parallelismFactor,
      avgTokensPerAgent: enhancedSummary.avgTokensPerAgent,
      avgDurationPerAgent: enhancedSummary.avgDurationPerAgent,
      avgToolCallsPerAgent: enhancedSummary.avgToolCallsPerAgent,
      cacheEfficiency: enhancedSummary.cacheEfficiency,
    },
    costBreakdown: { byModel, byAgent, byPhase },
    criticalPath: criticalPathAgents.map(a => ({
      agentId: a.id,
      name: agentDisplayName(a),
      durationMs: a.durationMs,
      depth: a.depth,
    })),
    alerts,
    enhancedSummary,
    executionNarrative,
    agentReportCards,
    issues,
    delegationAssessments,
    recommendations,
    copyableAnalysis,
  };
}

// ═══════════════════════════════════════════════════════════════════════
// Part B: AI Analysis — Claude Code-powered deep analysis
// ═══════════════════════════════════════════════════════════════════════


function formatDate(iso: string): string {
  const d = new Date(iso);
  return d.toISOString().slice(0, 19).replace('T', ' ') + ' UTC';
}

export interface PromptToolCall {
  name: string;
  inputSummary: string;
  isError: boolean;
  errorMessage?: string;
  durationMs: number | null;
}

export interface DefinitionContent {
  name: string;
  path: string;
  content: string;
}

export interface AnalysisPromptData {
  session: Session;
  projectDir: string;
  externalSkillDirs?: string[];
  facts?: ExecutionFacts;
  agentJsonlPaths?: Map<string, string>;
  agentToolTimelines?: Map<string, PromptToolCall[]>;
  artifacts?: Array<Record<string, unknown>>;
  feedbackItems?: Array<Record<string, unknown>>;
  improvementCycles?: Array<Record<string, unknown>>;
  skillDefinitionPaths?: Map<string, string>;
  skillDefinitions?: DefinitionContent[];
  agentDefinitions?: DefinitionContent[];
}

export function generateExecutionAnalysisPrompt(data: AnalysisPromptData): string {
  const { session, projectDir, facts, agentJsonlPaths, agentToolTimelines, artifacts, feedbackItems, improvementCycles, skillDefinitionPaths } = data;
  const lines: string[] = [];

  const agentMap = new Map(session.agents.map(a => [a.id, a]));
  const root = session.agents.find(a => a.parentId === null);

  // ── Purpose ─────────────────────────────────────────────────────────

  lines.push(`# Session Analysis — ${session.project}\n`);
  lines.push(`You are analyzing a completed multi-agent session running as Claude Code inside \`${projectDir}\`. Your goal is to surface specific observations the user can quickly review and add as feedback — not to produce a comprehensive report.\n`);
  lines.push(`For each agent, read its definition file (skill or agent type), then read its JSONL conversation, and identify where the agent's actual behavior differed from what its definition instructs. Only surface findings grounded in a specific instruction the agent was given.\n`);

  // ── Session metadata ─────────────────────────────────────────────────

  lines.push(`## Session\n`);
  lines.push(`| | |`);
  lines.push(`|---|---|`);
  lines.push(`| Project | ${session.project} |`);
  lines.push(`| Status | ${session.status} |`);
  lines.push(`| Created | ${formatDate(session.created)} |`);
  lines.push(`| Agents | ${session.totalAgents} |`);
  lines.push(`| Primary model | ${session.primaryModel} |`);
  lines.push(`| Wall clock | ${formatMs(session.duration.wallClock)} |`);
  lines.push(`| Agent time | ${formatMs(session.duration.agentTime)} |`);
  lines.push(`| Parallelism | ${session.duration.parallelismFactor.toFixed(2)}x |`);
  lines.push(`| Total cost | ${formatCostUsd(session.estimatedCost.total)} |`);
  lines.push(`| Total tokens | ${fmtTokens(session.totalTokens)} |`);

  if (facts) {
    const s = facts.summary;
    const errored = facts.agentFacts.filter(a => a.status === 'errored').length;
    lines.push(`| Success rate | ${s.totalAgents > 0 ? (((s.totalAgents - errored) / s.totalAgents) * 100).toFixed(0) : 0}% |`);
    lines.push(`| Cache efficiency | ${(s.cacheEfficiency * 100).toFixed(0)}% |`);
    lines.push(`| Tool calls | ${s.totalToolCalls} total, ${s.totalFailedToolCalls} failed, ${s.totalDeniedToolCalls} denied |`);
    lines.push(`| Max depth | ${s.maxDepth} |`);
    if (s.modelsUsed.length > 1) {
      lines.push(`| Models used | ${s.modelsUsed.join(', ')} |`);
    }
  }

  // ── Execution tree ───────────────────────────────────────────────────
  // Each agent is listed with its definition path and JSONL path inline,
  // so the read-definition → read-JSONL → compare flow is self-contained
  // per agent. Flags (⚑) mark agents that warrant closer investigation.

  lines.push(`\n## Agents\n`);
  lines.push(`For each agent: read its definition, then read its JSONL, and compare. Flags (⚑) mark agents worth prioritizing.\n`);

  // Pre-compute analytics to flag inline
  const costRanked = facts
    ? [...facts.costBreakdown.byAgent].sort((a, b) => b.cost - a.cost)
    : [];
  const topCostIds = new Set(costRanked.slice(0, 3).filter(a => a.cost > 0).map(a => a.agentId));
  const criticalPathIds = new Set((facts?.criticalPath ?? []).map(n => n.agentId));
  const failedAgentCategories = new Map<string, string[]>();
  if (facts) {
    for (const cat of facts.failedToolCategories) {
      for (const id of cat.agentIds) {
        const cats = failedAgentCategories.get(id) || [];
        if (!cats.includes(cat.category)) cats.push(cat.category);
        failedAgentCategories.set(id, cats);
      }
    }
  }

  // Build external definition directories set (for read-access note)
  const definitionDirs = new Set<string>();
  if (skillDefinitionPaths && skillDefinitionPaths.size > 0) {
    for (const skillPath of skillDefinitionPaths.values()) {
      if (!skillPath) continue;
      const dir = skillPath.replace(/[\\/][^\\/]+$/, '');
      const normalized = dir.replace(/[\\/]\.claude[\\/]skills$/, '').replace(/[\\/]\.claude[\\/]agents$/, '');
      if (normalized && normalized.toLowerCase() !== projectDir.toLowerCase()) {
        definitionDirs.add(normalized);
      }
    }
  }

  function renderAgent(agent: Agent, indent: string): void {
    const cost = estimateAgentCost(agent.tokenUsage, agent.model);
    const tc = totalToolCalls(agent);
    const status = agent.status === 'completed' && agent.errorToolCount === 0 && agent.deniedToolCount === 0
      ? 'OK' : agent.status === 'errored' ? 'FAIL' : agent.status;

    const flags: string[] = [];
    if (agent.status === 'errored') flags.push('errored');
    if (agent.errorToolCount > 0) flags.push(`${agent.errorToolCount} tool errors`);
    if (agent.deniedToolCount > 0) flags.push(`${agent.deniedToolCount} tool denials`);
    if (topCostIds.has(agent.id)) flags.push('top cost');
    if (criticalPathIds.has(agent.id)) flags.push('critical path');
    const failCats = failedAgentCategories.get(agent.id);
    if (failCats) flags.push(`failures: ${failCats.join(', ')}`);
    const flagStr = flags.length > 0 ? ` ⚑ ${flags.join(' | ')}` : '';

    lines.push(`${indent}**${agentDisplayName(agent)}** [${status}]${flagStr}`);
    lines.push(`${indent}  type: ${agent.subagentType || agent.type} | model: ${agent.model} | id: ${agent.id}`);
    lines.push(`${indent}  ${formatMs(agent.durationMs)} | ${formatCostUsd(cost)} | ${fmtTokens(agent.tokenUsage.input)}in / ${fmtTokens(agent.tokenUsage.output)}out / ${fmtTokens(agent.tokenUsage.cacheRead)}cache`);

    // Definition paths inline — what to read before evaluating this agent
    for (const si of agent.skillInvocations) {
      const defPath = skillDefinitionPaths?.get(si.skill);
      if (defPath) lines.push(`${indent}  skill definition: \`${defPath}\``);
      else lines.push(`${indent}  skill: ${si.skill} — find in .claude/skills/`);
    }
    if (agent.subagentType && agent.subagentType !== 'fork') {
      lines.push(`${indent}  agent definition: ${agent.subagentType} — read in .claude/agents/${agent.subagentType}.md`);
    }

    // JSONL path — primary evidence for what the agent actually did
    const jsonlPath = agentJsonlPaths?.get(agent.id);
    if (jsonlPath) lines.push(`${indent}  conversation: \`${jsonlPath}\``);

    // Tool summary — compact unless failures exist
    let timeline = agentToolTimelines?.get(agent.id);
    if (timeline && agent.subagentType === 'fork' && agent.parentId) {
      const parentTimeline = agentToolTimelines?.get(agent.parentId);
      if (parentTimeline && parentTimeline.length === timeline.length
        && parentTimeline.every((t, i) => t.name === timeline![i].name && t.isError === timeline![i].isError)) {
        lines.push(`${indent}  tools: (same as parent — fork inherits context)`);
        timeline = undefined;
      }
    }
    const hasFailures = timeline && timeline.some(t => t.isError);

    if (timeline && hasFailures) {
      const WINDOW = 10;
      const includeIdx = new Set<number>();
      for (let i = 0; i < timeline.length; i++) {
        if (timeline[i].isError) {
          for (let j = Math.max(0, i - WINDOW); j <= Math.min(timeline.length - 1, i + WINDOW); j++) {
            includeIdx.add(j);
          }
        }
      }
      const failCount = timeline.filter(t => t.isError).length;
      lines.push(`${indent}  tool calls (${timeline.length} total, ${failCount} failed — context around failures):`);
      let lastPrinted = -1;
      for (let i = 0; i < timeline.length; i++) {
        if (!includeIdx.has(i)) continue;
        if (lastPrinted !== -1 && i > lastPrinted + 1) {
          lines.push(`${indent}    … (${i - lastPrinted - 1} calls omitted)`);
        }
        const t = timeline[i];
        const dur = t.durationMs != null ? ` (${formatMs(t.durationMs)})` : '';
        const marker = t.isError ? '✗' : '→';
        lines.push(`${indent}    ${i + 1}. ${marker} ${t.name}${dur} ${t.inputSummary}`);
        if (t.isError && t.errorMessage) {
          lines.push(`${indent}       error: ${t.errorMessage}`);
        }
        lastPrinted = i;
      }
      if (lastPrinted < timeline.length - 1) {
        lines.push(`${indent}    … (${timeline.length - 1 - lastPrinted} calls omitted)`);
      }
    } else if (tc > 0) {
      const toolSummary = [...agent.toolCalls].sort((a, b) => b.count - a.count).map(t => `${t.name}(${t.count})`).join(', ');
      lines.push(`${indent}  tools(${tc}): ${toolSummary}`);
    }

    lines.push('');
    for (const childId of agent.children) {
      const child = agentMap.get(childId);
      if (child) renderAgent(child, indent + '  ');
    }
  }

  if (root) renderAgent(root, '');

  if (definitionDirs.size > 0) {
    lines.push(`**External definition directories** (read access granted — use absolute paths):`);
    for (const dir of definitionDirs) lines.push(`- \`${dir}\``);
    lines.push('');
  }

  // ── Artifacts ───────────────────────────────────────────────────────

  if (artifacts && artifacts.length > 0) {
    const uniqueArtifacts = new Map<string, { type: string; agentName: string }>();
    for (const art of artifacts) {
      const fp = art.file_path as string;
      const agentName = art.agent_id
        ? session.agents.find(a => a.id === art.agent_id)?.description?.slice(0, 40) || (art.agent_id as string).slice(0, 12)
        : 'unknown';
      uniqueArtifacts.set(fp, { type: art.type as string, agentName });
    }
    lines.push(`## Artifacts (${uniqueArtifacts.size} files produced)\n`);
    let count = 0;
    for (const [fp, { type, agentName }] of uniqueArtifacts) {
      if (count >= 40) { lines.push(`…and ${uniqueArtifacts.size - 40} more`); break; }
      lines.push(`- \`${fp}\` (${type}) — ${agentName}`);
      count++;
    }
    lines.push('');
  }

  // ── AgentWatch supplementary data ────────────────────────────────────
  // Not in session JSONLs — use as clues, not primary evidence

  if ((feedbackItems && feedbackItems.length > 0) || (improvementCycles && improvementCycles.length > 0)) {
    lines.push(`## Prior Context\n`);
    lines.push(`This data is from AgentWatch — not in session JSONLs. Use as supplementary clues.\n`);

    if (feedbackItems && feedbackItems.length > 0) {
      lines.push(`**Feedback already recorded (${feedbackItems.length}) — do not duplicate:**`);
      for (const fb of feedbackItems) {
        lines.push(`- [${fb.category}] ${fb.text} *(${fb.agent_name || 'unknown'})*`);
      }
      lines.push('');
    }

    if (improvementCycles && improvementCycles.length > 0) {
      lines.push(`**Prior improvement cycles (${improvementCycles.length}) — do not re-recommend what was already addressed:**`);
      for (const cycle of improvementCycles) {
        const p = cycle.generated_prompt as string | undefined;
        lines.push(`- Cycle #${cycle.cycle_number} (${cycle.status})${p ? ': ' + p.slice(0, 200) + (p.length > 200 ? '…' : '') : ''}`);
      }
      lines.push('');
    }
  }

  // ── What constitutes a finding worth surfacing ───────────────────────

  lines.push(`## What to Look For\n`);
  lines.push(`A finding is worth surfacing when a specific instruction in a skill or agent definition was not followed, or when an agent's output contradicts its defined responsibility. For each finding, establish:\n`);
  lines.push(`- Which instruction in which definition file was not followed`);
  lines.push(`- What the agent actually did (cite from the JSONL)`);
  lines.push(`- Whether the deviation likely affected the result\n`);
  lines.push(`Skip agents that executed cleanly against their definitions. Do not flag general observations not grounded in a specific instruction the agent was given.\n`);

  // ── Output ───────────────────────────────────────────────────────────

  lines.push(`## Output\n`);
  lines.push(`Write one short observation per finding — specific enough that the user can immediately decide whether to add it as feedback. Group by agent. Each observation should name the instruction that was not followed, describe what actually happened, and state whether it mattered.\n`);
  lines.push(`If no meaningful deviations were found, say so directly.\n`);
  lines.push(`End with:\n`);
  lines.push('```json');
  lines.push(`{"recommendations": [{"severity": "high|medium|low", "title": "...", "category": "prompt|agent_type|workflow|permissions|cost|skill_design", "agentId": "optional", "observation": "...", "rootCause": "...", "evidence": "...", "confidence": "high|medium|low", "recommendation": "..."}]}`);
  lines.push('```');

  return lines.join('\n');
}

// ─── DB Helpers for Execution Analysis Cycles ───────────────────────────

export function getNextExecutionCycleNumber(sessionId: string): number {
  const db = getDatabase();
  const row = db.prepare(
    'SELECT MAX(cycle_number) as maxNum FROM execution_analysis_cycles WHERE session_id = ?'
  ).get(sessionId) as { maxNum: number | null } | undefined;
  return (row?.maxNum ?? 0) + 1;
}

export function createExecutionAnalysisCycle(
  sessionId: string,
  cycleNumber: number,
  prompt: string
): { id: string } {
  const db = getDatabase();
  const id = `eac-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const now = Date.now();
  db.prepare(`
    INSERT INTO execution_analysis_cycles (id, session_id, cycle_number, analysis_prompt, status, created_at)
    VALUES (?, ?, ?, ?, 'pending', ?)
  `).run(id, sessionId, cycleNumber, prompt, now);
  return { id };
}

export function updateExecutionAnalysisCycle(
  cycleId: string,
  updates: {
    status?: string;
    analysisResponse?: string | null;
    recommendations?: ExecutionRecommendation[] | null;
    streamEntries?: StreamEntry[] | null;
  }
): void {
  const db = getDatabase();
  const sets: string[] = [];
  const values: unknown[] = [];

  if (updates.status !== undefined) {
    sets.push('status = ?');
    values.push(updates.status);
    if (updates.status === 'completed' || updates.status === 'failed') {
      sets.push('completed_at = ?');
      values.push(Date.now());
    }
  }
  if (updates.analysisResponse !== undefined) {
    sets.push('analysis_response = ?');
    values.push(updates.analysisResponse);
  }
  if (updates.recommendations !== undefined) {
    sets.push('recommendations = ?');
    values.push(updates.recommendations ? JSON.stringify(updates.recommendations) : null);
  }
  if (updates.streamEntries !== undefined) {
    sets.push('stream_entries = ?');
    values.push(updates.streamEntries ? JSON.stringify(updates.streamEntries) : null);
  }

  if (sets.length === 0) return;
  values.push(cycleId);
  db.prepare(`UPDATE execution_analysis_cycles SET ${sets.join(', ')} WHERE id = ?`).run(...values);
}

export function getExecutionAnalysisCycles(sessionId: string): import('@/types/analytics').ExecutionAnalysisCycle[] {
  const db = getDatabase();
  const rows = db.prepare(
    'SELECT * FROM execution_analysis_cycles WHERE session_id = ? ORDER BY cycle_number DESC'
  ).all(sessionId) as Array<Record<string, unknown>>;

  return rows.map(row => ({
    id: row.id as string,
    sessionId: row.session_id as string,
    cycleNumber: row.cycle_number as number,
    analysisPrompt: row.analysis_prompt as string,
    analysisResponse: (row.analysis_response as string) || null,
    recommendations: row.recommendations ? JSON.parse(row.recommendations as string) : null,
    status: row.status as 'pending' | 'analyzing' | 'completed' | 'failed',
    streamEntries: row.stream_entries ? JSON.parse(row.stream_entries as string) : null,
    createdAt: new Date(row.created_at as number).toISOString(),
    completedAt: row.completed_at ? new Date(row.completed_at as number).toISOString() : null,
  }));
}

export function deleteExecutionAnalysisCycle(cycleId: string): void {
  const db = getDatabase();
  db.prepare('DELETE FROM execution_analysis_cycles WHERE id = ?').run(cycleId);
}

// ─── Run AI Analysis ────────────────────────────────────────────────────

export async function runExecutionAnalysis(
  cycleId: string,
  sessionId: string,
  prompt: string,
  cwd?: string,
  externalSkillDirs: string[] = [],
): Promise<void> {
  const wss = getWsServer();

  const broadcast = (type: string, payload: Record<string, unknown>) => {
    wss?.broadcast({ type, sessionId, cycleId, ...payload } as never);
  };

  const streamLog: StreamEntry[] = [];
  let streamIdCounter = 0;

  try {
    broadcast('execution_analysis_started', {});
    updateExecutionAnalysisCycle(cycleId, { status: 'analyzing' });

    streamLog.push({
      id: `ea-${++streamIdCounter}`,
      kind: 'system',
      timestamp: Date.now(),
      text: `Starting execution analysis for session ${sessionId.slice(0, 12)}...`,
    });

    const cliArgs = [
      '-p',
      '--output-format', 'stream-json',
      '--input-format', 'stream-json',
      '--verbose',
      '--model', 'claude-sonnet-4-6',
      '--dangerously-skip-permissions',
    ];

    // Grant read access to external skill/agent directories (quoted for paths with spaces)
    for (const dir of externalSkillDirs) {
      cliArgs.push('--add-dir', `"${dir}"`);
    }

    const child = spawn('claude', cliArgs, {
      shell: true,
      cwd: cwd || undefined,
      env: { ...process.env },
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    const userMsg = JSON.stringify({
      type: 'user',
      message: { role: 'user', content: [{ type: 'text', text: prompt }] },
    });
    child.stdin.write(userMsg + '\n', 'utf8');
    child.stdin.end();

    const responseChunks: string[] = [];
    let stdoutBuffer = '';

    function handleStreamEvent(line: string) {
      let event: Record<string, unknown>;
      try { event = JSON.parse(line); } catch { return; }

      broadcast('execution_analysis_stream_event', { event });

      const eventType = event.type as string;

      if (eventType === 'assistant') {
        const msg = event.message as {
          content?: Array<{ type: string; text?: string; thinking?: string; id?: string; name?: string; input?: Record<string, unknown> }>;
        } | undefined;
        if (!msg?.content) return;

        for (const block of msg.content) {
          if (block.type === 'text' && block.text) {
            responseChunks.push(block.text);
            streamLog.push({
              id: `ea-${++streamIdCounter}`,
              kind: 'text',
              timestamp: Date.now(),
              text: block.text,
            });
          }
          if (block.type === 'thinking' && block.thinking) {
            streamLog.push({
              id: `ea-${++streamIdCounter}`,
              kind: 'thinking',
              timestamp: Date.now(),
              text: block.thinking,
            });
          }
          if (block.type === 'tool_use') {
            streamLog.push({
              id: `ea-${++streamIdCounter}`,
              kind: 'tool_use',
              timestamp: Date.now(),
              toolName: block.name,
              toolInput: block.input,
              toolUseId: block.id,
            });
          }
        }
      }

      if (eventType === 'user') {
        const userMsg = event.message as { content?: Array<{ type: string; tool_use_id?: string; content?: string; is_error?: boolean }> };
        if (userMsg?.content) {
          for (const block of userMsg.content) {
            if (block.type === 'tool_result') {
              streamLog.push({
                id: `ea-${++streamIdCounter}`,
                kind: 'tool_result',
                timestamp: Date.now(),
                toolUseId: block.tool_use_id,
                content: typeof block.content === 'string' ? block.content : JSON.stringify(block.content),
                isError: block.is_error ?? false,
              });
            }
          }
        }
      }
    }

    child.stdout.on('data', (chunk: Buffer) => {
      stdoutBuffer += chunk.toString();
      const lines = stdoutBuffer.split('\n');
      stdoutBuffer = lines.pop() ?? '';
      for (const line of lines) {
        if (line.trim()) handleStreamEvent(line.trim());
      }
    });

    let stderr = '';
    child.stderr.on('data', (chunk: Buffer) => {
      stderr += chunk.toString();
    });

    const ANALYSIS_TIMEOUT_MS = 10 * 60 * 1000;
    const exitCode = await new Promise<number>((resolve) => {
      const timer = setTimeout(() => {
        try { child.kill(); } catch { /* already dead */ }
        resolve(124);
      }, ANALYSIS_TIMEOUT_MS);

      child.on('close', (code) => { clearTimeout(timer); resolve(code ?? 0); });
      child.on('error', () => { clearTimeout(timer); resolve(1); });
    });

    if (stdoutBuffer.trim()) {
      handleStreamEvent(stdoutBuffer.trim());
    }

    if (exitCode === 124) {
      streamLog.push({
        id: `ea-${++streamIdCounter}`,
        kind: 'system',
        timestamp: Date.now(),
        text: 'Analysis timed out after 10 minutes.',
      });
      updateExecutionAnalysisCycle(cycleId, {
        status: 'failed',
        analysisResponse: responseChunks.join('') || null,
        streamEntries: streamLog.length > 0 ? streamLog : null,
      });
      broadcast('execution_analysis_failed', { error: 'Analysis timed out after 10 minutes' });
      return;
    }

    if (exitCode !== 0) {
      const errorDetail = stderr.trim() || `Process exited with code ${exitCode}`;
      streamLog.push({
        id: `ea-${++streamIdCounter}`,
        kind: 'system',
        timestamp: Date.now(),
        text: `Analysis process failed (exit code ${exitCode}): ${errorDetail.slice(0, 500)}`,
      });
      updateExecutionAnalysisCycle(cycleId, {
        status: 'failed',
        analysisResponse: responseChunks.join('') || null,
        streamEntries: streamLog.length > 0 ? streamLog : null,
      });
      broadcast('execution_analysis_failed', { error: errorDetail.slice(0, 300) });
      return;
    }

    const fullResponse = responseChunks.join('');

    if (!fullResponse.trim()) {
      const hint = stderr.trim() ? `stderr: ${stderr.trim().slice(0, 300)}` : 'No output received from Claude';
      streamLog.push({
        id: `ea-${++streamIdCounter}`,
        kind: 'system',
        timestamp: Date.now(),
        text: `Analysis produced no output. ${hint}`,
      });
      updateExecutionAnalysisCycle(cycleId, {
        status: 'failed',
        streamEntries: streamLog.length > 0 ? streamLog : null,
      });
      broadcast('execution_analysis_failed', { error: 'Analysis produced no output' });
      return;
    }

    let recommendations: ExecutionRecommendation[] | null = null;
    const jsonMatch = fullResponse.match(/```json\s*([\s\S]*?)```/);
    if (jsonMatch) {
      try {
        const parsed = JSON.parse(jsonMatch[1]);
        if (Array.isArray(parsed.recommendations)) {
          recommendations = parsed.recommendations;
        }
      } catch { /* non-fatal */ }
    }

    streamLog.push({
      id: `ea-${++streamIdCounter}`,
      kind: 'system',
      timestamp: Date.now(),
      text: `Analysis completed. ${recommendations?.length ?? 0} recommendations generated.`,
    });

    updateExecutionAnalysisCycle(cycleId, {
      status: 'completed',
      analysisResponse: fullResponse,
      recommendations,
      streamEntries: streamLog.length > 0 ? streamLog : null,
    });

    broadcast('execution_analysis_complete', { status: 'completed' });
  } catch (err) {
    streamLog.push({
      id: `ea-${++streamIdCounter}`,
      kind: 'system',
      timestamp: Date.now(),
      text: `Analysis failed: ${String(err)}`,
    });

    try {
      updateExecutionAnalysisCycle(cycleId, {
        status: 'failed',
        streamEntries: streamLog.length > 0 ? streamLog : null,
      });
    } catch {
      try {
        getDatabase().prepare('UPDATE execution_analysis_cycles SET status = ?, completed_at = ? WHERE id = ?')
          .run('failed', Date.now(), cycleId);
      } catch { /* best effort */ }
    }
    broadcast('execution_analysis_failed', { error: String(err) });
  }
}
