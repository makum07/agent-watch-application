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

export interface SessionSearchResult {
  sessionId: string;
  title: string;
  project: string;
  lastOpened: string;
  /** Surrounding text from the matched prompt/response, with … wrapping the hit — null for title matches. */
  snippet: string | null;
  matchType: 'title' | 'content';
}
