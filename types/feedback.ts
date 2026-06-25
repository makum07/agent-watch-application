export type FeedbackCategory =
  | 'missing_context'
  | 'incorrect_assumption'
  | 'hallucinated_conclusion'
  | 'weak_validation'
  | 'missing_edge_case'
  | 'missing_artifact'
  | 'missing_code_exploration'
  | 'missing_test_coverage'
  | 'workflow_improvement'
  | 'other';

export interface FeedbackCategoryMeta {
  value: FeedbackCategory;
  label: string;
  color: string;
}

export const FEEDBACK_CATEGORIES: FeedbackCategoryMeta[] = [
  { value: 'missing_context',         label: 'Missing Context',         color: '#f0883e' },
  { value: 'incorrect_assumption',    label: 'Incorrect Assumption',    color: '#ff7b72' },
  { value: 'hallucinated_conclusion', label: 'Hallucinated Conclusion', color: '#ff7b72' },
  { value: 'weak_validation',         label: 'Weak Validation',         color: '#d2a8ff' },
  { value: 'missing_edge_case',       label: 'Missing Edge Case',       color: '#ffa657' },
  { value: 'missing_artifact',        label: 'Missing Artifact',        color: '#79c0ff' },
  { value: 'missing_code_exploration',label: 'Missing Code Exploration',color: '#56d364' },
  { value: 'missing_test_coverage',   label: 'Missing Test Coverage',   color: '#3fb950' },
  { value: 'workflow_improvement',    label: 'Workflow Improvement',    color: '#58a6ff' },
  { value: 'other',                   label: 'Other',                   color: '#8b949e' },
];

export interface FeedbackItem {
  id: string;
  sessionId: string;
  agentId: string;
  messageId: string | null;
  artifactId: string | null;
  category: FeedbackCategory;
  text: string;
  agentName: string | null;
  createdAt: string;
}

export interface FileChange {
  filePath: string;
  type: 'create' | 'modify' | 'delete';
  additions: number;
  deletions: number;
  diff: string;
}

export interface ImprovementCycle {
  id: string;
  sessionId: string;
  cycleNumber: number;
  feedbackIds: string[];
  generatedPrompt: string;
  claudeResponse: string | null;
  status: 'applying' | 'completed' | 'failed' | 'rewound';
  createdAt: string;
  completedAt: string | null;
  snapshotSize: number | null;
  fileChanges: FileChange[] | null;
  streamEntries: StreamEntry[] | null;
}

// Live streaming state for an active improvement cycle
export interface StreamEntry {
  id: string;
  kind: 'text' | 'thinking' | 'tool_use' | 'tool_result' | 'system' | 'permission_request';
  timestamp: number;
  // For text/thinking
  text?: string;
  // For tool_use
  toolName?: string;
  toolInput?: Record<string, unknown>;
  toolUseId?: string;
  // For tool_result
  content?: string;
  isError?: boolean;
  // For permission_request
  requestId?: string;
  approved?: boolean | null; // null = pending
}
