import type { Session } from '@/types/session';
import type { CrossSessionPattern } from '@/types/analytics';

export function detectPatterns(sessions: Session[]): CrossSessionPattern[] {
  if (sessions.length < 2) return [];

  return [
    ...detectCommonToolSequences(sessions),
    ...detectRecurringTopologies(sessions),
    ...detectCostOutliers(sessions),
    ...detectPerformanceRegressions(sessions),
  ];
}

function detectCommonToolSequences(sessions: Session[]): CrossSessionPattern[] {
  const patterns: CrossSessionPattern[] = [];

  // Build tool bigrams per session
  const sessionBigrams = new Map<string, Set<string>>();
  for (const session of sessions) {
    const orchestrator = session.agents.find(a => a.parentId === null);
    if (!orchestrator) continue;
    const tools = orchestrator.toolCalls.map(tc => tc.name);
    const bigrams = new Set<string>();
    for (let i = 0; i < tools.length - 1; i++) {
      bigrams.add(`${tools[i]}→${tools[i + 1]}`);
    }
    sessionBigrams.set(session.id, bigrams);
  }

  // Count bigram frequency across sessions
  const bigramCounts = new Map<string, string[]>();
  for (const [sessionId, bigrams] of sessionBigrams) {
    for (const bg of bigrams) {
      const list = bigramCounts.get(bg) || [];
      list.push(sessionId);
      bigramCounts.set(bg, list);
    }
  }

  const threshold = Math.max(2, Math.floor(sessions.length * 0.5));
  const common = [...bigramCounts.entries()]
    .filter(([, ids]) => ids.length >= threshold)
    .sort((a, b) => b[1].length - a[1].length);

  if (common.length > 0) {
    const topSequences = common.slice(0, 5).map(([bg, ids]) => ({
      sequence: bg,
      count: ids.length,
    }));

    patterns.push({
      patternType: 'common-tool-sequence',
      description: `Common tool sequences found across ${sessions.length} sessions: ${topSequences.map(s => s.sequence).join(', ')}`,
      sessionIds: [...new Set(common.flatMap(([, ids]) => ids))],
      confidence: common[0][1].length / sessions.length,
      details: { sequences: topSequences },
    });
  }

  return patterns;
}

function detectRecurringTopologies(sessions: Session[]): CrossSessionPattern[] {
  const patterns: CrossSessionPattern[] = [];

  // Hash topology: depth profile + agent types at each level
  function topoHash(session: Session): string {
    const depthCounts = new Map<number, number>();
    const depthTypes = new Map<number, Set<string>>();
    for (const a of session.agents) {
      depthCounts.set(a.depth, (depthCounts.get(a.depth) || 0) + 1);
      const types = depthTypes.get(a.depth) || new Set();
      types.add(a.subagentType || a.type);
      depthTypes.set(a.depth, types);
    }
    const parts: string[] = [];
    for (const [d, count] of [...depthCounts.entries()].sort((a, b) => a[0] - b[0])) {
      const types = [...(depthTypes.get(d) || [])].sort().join(',');
      parts.push(`${d}:${count}[${types}]`);
    }
    return parts.join('|');
  }

  const hashGroups = new Map<string, string[]>();
  for (const session of sessions) {
    const hash = topoHash(session);
    const list = hashGroups.get(hash) || [];
    list.push(session.id);
    hashGroups.set(hash, list);
  }

  for (const [hash, ids] of hashGroups) {
    if (ids.length >= 2) {
      patterns.push({
        patternType: 'recurring-agent-topology',
        description: `${ids.length} sessions share the same agent topology structure`,
        sessionIds: ids,
        confidence: ids.length / sessions.length,
        details: { topologyHash: hash, count: ids.length },
      });
    }
  }

  return patterns;
}

function detectCostOutliers(sessions: Session[]): CrossSessionPattern[] {
  const patterns: CrossSessionPattern[] = [];
  if (sessions.length < 3) return patterns;

  const costs = sessions.map(s => s.estimatedCost.total);
  const mean = costs.reduce((s, c) => s + c, 0) / costs.length;
  const variance = costs.reduce((s, c) => s + (c - mean) ** 2, 0) / costs.length;
  const stdDev = Math.sqrt(variance);

  if (stdDev === 0) return patterns;

  for (const session of sessions) {
    const zScore = (session.estimatedCost.total - mean) / stdDev;
    if (Math.abs(zScore) > 2) {
      patterns.push({
        patternType: 'cost-outlier',
        description: `Session "${session.project}" (${session.id.slice(0, 8)}) cost is ${zScore > 0 ? 'unusually high' : 'unusually low'} — ${zScore.toFixed(1)} standard deviations from the mean`,
        sessionIds: [session.id],
        confidence: Math.min(1, Math.abs(zScore) / 3),
        details: {
          cost: session.estimatedCost.total,
          mean,
          stdDev,
          zScore,
        },
      });
    }
  }

  return patterns;
}

function detectPerformanceRegressions(sessions: Session[]): CrossSessionPattern[] {
  const patterns: CrossSessionPattern[] = [];

  // Group by project
  const byProject = new Map<string, Session[]>();
  for (const s of sessions) {
    const list = byProject.get(s.project) || [];
    list.push(s);
    byProject.set(s.project, list);
  }

  for (const [project, projectSessions] of byProject) {
    if (projectSessions.length < 2) continue;

    const sorted = [...projectSessions].sort(
      (a, b) => new Date(a.created).getTime() - new Date(b.created).getTime()
    );

    for (let i = 1; i < sorted.length; i++) {
      const prev = sorted[i - 1];
      const curr = sorted[i];

      const costIncrease = prev.estimatedCost.total > 0
        ? (curr.estimatedCost.total - prev.estimatedCost.total) / prev.estimatedCost.total
        : 0;
      const durationIncrease = prev.duration.wallClock > 0
        ? (curr.duration.wallClock - prev.duration.wallClock) / prev.duration.wallClock
        : 0;

      if (costIncrease > 0.5 || durationIncrease > 0.5) {
        patterns.push({
          patternType: 'performance-regression',
          description: `"${project}" — later session costs ${(costIncrease * 100).toFixed(0)}% more and takes ${(durationIncrease * 100).toFixed(0)}% longer`,
          sessionIds: [prev.id, curr.id],
          confidence: Math.min(1, Math.max(costIncrease, durationIncrease)),
          details: {
            project,
            costIncrease,
            durationIncrease,
            prevSessionId: prev.id,
            currSessionId: curr.id,
          },
        });
      }
    }
  }

  return patterns;
}
