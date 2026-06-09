export type AlertSeverity = 'critical' | 'warning' | 'info';

export type AlertCategory =
  | 'bottleneck'
  | 'loop'
  | 'duplicate-work'
  | 'excessive-tools'
  | 'context-bloat'
  | 'long-chain';

export interface DebugAlert {
  id: string;
  category: AlertCategory;
  severity: AlertSeverity;
  title: string;
  description: string;
  agentIds: string[];
  metric?: number;
  threshold?: number;
}

export interface SessionAnalytics {
  summary: {
    totalAgents: number;
    totalTokens: number;
    totalToolCalls: number;
    totalCost: number;
    wallClock: number;
    agentTime: number;
    parallelismFactor: number;
    avgTokensPerAgent: number;
    avgDurationPerAgent: number;
    avgToolCallsPerAgent: number;
    cacheEfficiency: number;
  };
  costBreakdown: {
    byModel: Array<{ model: string; cost: number; tokens: number; agentCount: number }>;
    byAgent: Array<{ agentId: string; name: string; cost: number; tokens: number; durationMs: number }>;
    byPhase: Array<{ phase: string; cost: number; tokens: number; agentCount: number; agentIds: string[] }>;
  };
  criticalPath: Array<{ agentId: string; name: string; durationMs: number; depth: number }>;
  alerts: DebugAlert[];
}

export interface SessionComparisonData {
  sessionA: SessionAnalytics & { id: string; project: string; created: string };
  sessionB: SessionAnalytics & { id: string; project: string; created: string };
  deltas: {
    costDelta: number;
    tokenDelta: number;
    durationDelta: number;
    agentCountDelta: number;
  };
}

export interface CrossSessionPattern {
  patternType: 'common-tool-sequence' | 'recurring-agent-topology' | 'cost-outlier' | 'performance-regression';
  description: string;
  sessionIds: string[];
  confidence: number;
  details: Record<string, unknown>;
}
