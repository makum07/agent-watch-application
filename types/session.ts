export interface Session {
  id: string;
  project: string;
  created: string;
  lastModified: string;
  status: 'active' | 'idle' | 'completed' | 'errored';
  totalMessages: number;
  totalTokens: number;
  totalAgents: number;
  totalToolCalls: number;
  primaryModel: string;
  duration: {
    wallClock: number;
    agentTime: number;
    parallelismFactor: number;
  };
  estimatedCost: {
    total: number;
    byModel: Record<string, number>;
  };
  agents: Agent[];
  rootAgentId: string;
}

export interface Agent {
  id: string;
  sessionId: string;
  conversationId: string;
  parentId: string | null;
  parentConversationId: string | null;
  toolUseId: string | null;
  type: 'orchestrator' | 'subagent' | 'workflow';
  subagentType: string | null;
  model: string;
  status: 'running' | 'completed' | 'errored' | 'unknown';
  startTime: string;
  endTime: string | null;
  durationMs: number;
  prompt: string | null;
  description: string | null;
  response: string | null;
  schema: object | null;
  isolation: 'worktree' | null;
  messageCount: number;
  tokenUsage: {
    input: number;
    output: number;
    cacheCreation: number;
    cacheRead: number;
    total: number;
  };
  toolCalls: ToolCallSummary[];
  skillInvocations: SkillInvocation[];
  children: string[];
  depth: number;
}

export interface ToolCallSummary {
  name: string;
  count: number;
}

export interface SkillInvocation {
  id: string;
  skill: string;
  args: string | null;
  startTime: string;
  endTime: string | null;
  durationMs: number | null;
}

export interface Message {
  id: string;
  agentId: string;
  role: 'user' | 'assistant' | 'tool';
  timestamp: string;
  content: ContentBlock[];
  model?: string;
  stopReason?: string;
  tokenUsage?: {
    input: number;
    output: number;
    cacheCreation: number;
    cacheRead: number;
  };
  isPrompt: boolean;
  isResponse: boolean;
  toolCalls: ResolvedToolCall[];
}

export type ContentBlock =
  | { type: 'text'; text: string }
  | { type: 'tool_use'; id: string; name: string; input: Record<string, unknown> }
  | { type: 'tool_result'; tool_use_id: string; content: ContentBlock[]; is_error?: boolean };

export interface ResolvedToolCall {
  id: string;
  name: string;
  input: Record<string, unknown>;
  result: unknown;
  isError: boolean;
  durationMs: number | null;
  isAgentSpawn: boolean;
  childAgentId: string | null;
}

export interface Artifact {
  id: string;
  sessionId: string;
  agentId: string;
  type: 'create' | 'modify' | 'delete';
  filePath: string;
  toolName: string;
  timestamp: string;
  contentPreview: string | null;
  contentSize: number;
  createdBy: string;
  modifiedBy: string[];
  consumedBy: string[];
}

export interface TimelineEvent {
  id: number;
  sessionId: string;
  agentId: string;
  eventType: 'agent_start' | 'agent_end' | 'tool_call' | 'tool_result' | 'artifact_create' | 'artifact_modify';
  timestamp: string;
  details: {
    toolName?: string;
    filePath?: string;
    status?: string;
    tokenCount?: number;
  };
}
