export type SessionEvent =
  | { type: 'session_update'; sessionId: string }
  | { type: 'agent_message'; sessionId: string; agentId: string }
  | { type: 'tool_call'; sessionId: string; agentId: string; toolName: string }
  | { type: 'artifact_created'; sessionId: string; agentId: string; filePath: string }
  | { type: 'session_ingested'; sessionId: string }
  | { type: 'ping' };
