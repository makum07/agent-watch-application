export interface SessionHistory {
  sessionId: string;
  title: string;
  summary: string | null;
  project: string;
  sessionCreated: string;
  firstOpened: string;
  lastOpened: string;
  openCount: number;
  agentCount: number;
  artifactCount: number;
  totalTokens: number;
  totalToolCalls: number;
  durationMs: number;
  primaryModel: string;
  estimatedCost: number;
  isPinned: boolean;
  isFavorite: boolean;
  tags: string[];
  notes: string | null;
  sourceExists: boolean;
  lastIndexed: string;
}

export interface SessionHistoryUpdate {
  title?: string;
  summary?: string;
  isPinned?: boolean;
  isFavorite?: boolean;
  tags?: string[];
  notes?: string;
}
