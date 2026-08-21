export type SelfHealingMode = 'analysis_only' | 'analysis_and_fix' | 'fully_automatic';
export type AnalysisTrigger = 'manual' | 'auto_threshold';
export type AnalysisStatus = 'pending' | 'analyzing' | 'awaiting_review' | 'applying' | 'completed' | 'failed' | 'cancelled';

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
  currentStatus: string | null;
  growthOpportunities: SkillGrowthOpportunity[] | null;
  phaseGrowthOpportunities: PhaseGrowthOpportunity[] | null;
  status: AnalysisStatus;
  createdAt: string;
  completedAt: string | null;
  streamEntries: import('@/types/feedback').StreamEntry[] | null;
  /** Model the CLI actually reported running (from its init stream-json event), not just what was requested. */
  model: string | null;
  /** The new one-shot CLI session's own id — unlike the improvement loop, this always starts a fresh session rather than resuming one. Resumable via `claude --resume <id>`. */
  cliSessionId: string | null;
}

export interface AnalysisRecommendation {
  severity: 'critical' | 'high' | 'medium' | 'low';
  title: string;
  rootCause: string;
  affectedComponent: string;
  proposedChange: string;
  selfCorrectionSignal: string;
  evidence: string[];
  confidence: 'high' | 'medium' | 'low';
}

// Forward-looking, non-bugfix suggestions for evolving a skill's role in the
// SDLC — distinct from `AnalysisRecommendation`, which targets a specific
// defect. Populated from the maturity/audit framework in an attached
// context document when one identifies a relevant gap or next stage.
export interface SkillGrowthOpportunity {
  title: string;
  currentState: string;
  targetState: string;
  rationale: string;
  sdlcImpact: string;
  suggestedChange: string;
  impact: 'high' | 'medium' | 'low';
  sourceDocument: string | null;
  /** The specific entry, condition, score, sheet, or section within sourceDocument this opportunity traces back to — preserves the audit-to-opportunity link structurally instead of only in prose. */
  sourceEvidence: string | null;
}

// Forward-looking, phase-scoped counterpart to `SkillGrowthOpportunity` —
// where that type asks "what can this skill itself develop," this one asks
// "what does this skill's whole SDLC phase/domain still lack, once this
// skill's own growth opportunities are realized." Populated only when an
// attached audit/maturity document gives enough evidence to reason about the
// phase as a whole, not just this skill's slice of it.
export interface PhaseGrowthOpportunity {
  /** The SDLC phase/domain this opportunity belongs to, e.g. "Testing & QA". */
  phase: string;
  title: string;
  /** What this skill contributes to the phase today. */
  currentContribution: string;
  /** What the phase gains once this skill's own Growth Opportunities are implemented — the bridge from skill-level to phase-level. */
  afterSkillImprovements: string;
  /** What the phase still lacks per the audit/maturity document, beyond what this skill could ever cover. */
  remainingGap: string;
  /** Why this specific skill can't or shouldn't own that remaining gap. */
  whyOutOfScope: string;
  /** The next capability, skill, process, or automation the team would need to build to close the remaining gap. */
  recommendedNextCapability: string;
  impact: 'high' | 'medium' | 'low';
  sourceDocument: string | null;
  /** The specific entry, condition, score, sheet, or section within sourceDocument this opportunity traces back to. */
  sourceEvidence: string | null;
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

export interface SkillContextFile {
  id: string;
  skillId: string;
  filename: string;
  mimeType: string;
  fileSize: number;
  textPath: string | null;
  extractedText: string;
  createdAt: string;
}

export type SkillContextFileSummary = Omit<SkillContextFile, 'extractedText'>;

// Shared across every skill in the same project — uploaded once instead of
// per-skill. Same shape as SkillContextFile, scoped by `project` instead of
// `skillId`.
export interface ProjectContextFile {
  id: string;
  project: string;
  filename: string;
  mimeType: string;
  fileSize: number;
  textPath: string | null;
  extractedText: string;
  createdAt: string;
}

export type ProjectContextFileSummary = Omit<ProjectContextFile, 'extractedText'>;

export interface SkillDetailData {
  skill: SkillSummary;
  recentExecutions: SkillExecution[];
  feedbackItems: SkillFeedbackItem[];
  feedbackByCategory: SkillFeedbackAggregate[];
  feedbackByAgent: Array<{ agentName: string; count: number }>;
  analysisCycles: SkillAnalysisCycle[];
  improvementCycles: ImprovementCycle[];
  projectContextFiles: ProjectContextFile[];
  contextFiles: SkillContextFile[];
  executionsBySession: Array<{
    sessionId: string;
    timestamp: string;
    agentId: string;
    agentName: string | null;
    durationMs: number | null;
    feedbackCount: number;
  }>;
}
