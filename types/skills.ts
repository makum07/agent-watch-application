export type SelfHealingMode = 'analysis_only' | 'analysis_and_fix' | 'fully_automatic';
export type AnalysisTrigger = 'manual' | 'auto_threshold';
export type AnalysisStatus = 'pending' | 'analyzing' | 'awaiting_review' | 'applying' | 'completed' | 'failed';

export interface Skill {
  id: string;
  project: string;
  name: string;
  description: string | null;
  version: number;
  selfHealingEnabled: boolean;
  selfHealingMode: SelfHealingMode;
  selfHealingThreshold: number;
  executionsSinceLastCycle: number;
  createdAt: string;
  updatedAt: string;
}

export interface SkillSummary extends Skill {
  totalExecutions: number;
  totalSessions: number;
  totalFeedback: number;
  avgDurationMs: number;
  lastExecutionAt: string | null;
  lastAnalysisAt: string | null;
  lastAnalysisStatus: AnalysisStatus | null;
}

export interface SkillExecution {
  id: string;
  skillId: string;
  sessionId: string;
  agentId: string;
  invocationId: string;
  timestamp: string;
  durationMs: number | null;
  args: string | null;
  feedbackCount: number;
}

export interface SkillAnalysisCycle {
  id: string;
  skillId: string;
  cycleNumber: number;
  triggerType: AnalysisTrigger;
  sessionsAnalyzed: string[];
  feedbackAnalyzed: string[];
  analysisPrompt: string;
  analysisResponse: string | null;
  fixPrompt: string | null;
  recommendations: AnalysisRecommendation[] | null;
  status: AnalysisStatus;
  createdAt: string;
  completedAt: string | null;
  streamEntries: import('@/types/feedback').StreamEntry[] | null;
}

export interface AnalysisRecommendation {
  severity: 'critical' | 'high' | 'medium' | 'low';
  title: string;
  rootCause: string;
  affectedComponent: string;
  proposedChange: string;
  selfCorrectionSignal: string;
}

export interface SkillFeedbackAggregate {
  category: string;
  label: string;
  count: number;
  percentage: number;
  color: string;
}

export interface SkillFeedbackItem {
  id: string;
  sessionId: string;
  agentId: string;
  agentName: string | null;
  category: string;
  categoryLabel: string;
  categoryColor: string;
  text: string;
  createdAt: string;
}

export interface ImprovementCycle {
  id: string;
  sessionId: string;
  cycleNumber: number;
  feedbackIds: string[];
  generatedPrompt: string;
  claudeResponse: string | null;
  status: string;
  createdAt: string;
  completedAt: string | null;
  fileChanges: string | null;
}

export interface SkillDetailData {
  skill: SkillSummary;
  recentExecutions: SkillExecution[];
  feedbackItems: SkillFeedbackItem[];
  feedbackByCategory: SkillFeedbackAggregate[];
  feedbackByAgent: Array<{ agentName: string; count: number }>;
  analysisCycles: SkillAnalysisCycle[];
  improvementCycles: ImprovementCycle[];
  executionsBySession: Array<{
    sessionId: string;
    timestamp: string;
    agentId: string;
    agentName: string | null;
    durationMs: number | null;
    feedbackCount: number;
  }>;
}
