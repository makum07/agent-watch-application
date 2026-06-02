export type SessionEvent =
  | { type: 'session_update'; sessionId: string }
  | { type: 'agent_message'; sessionId: string; agentId: string }
  | { type: 'tool_call'; sessionId: string; agentId: string; toolName: string }
  | { type: 'artifact_created'; sessionId: string; agentId: string; filePath: string }
  | { type: 'session_ingested'; sessionId: string }
  | { type: 'improvement_started'; sessionId: string; cycleId: string }
  | { type: 'improvement_chunk'; sessionId: string; cycleId: string; chunk: string }
  | { type: 'improvement_complete'; sessionId: string; cycleId: string; status: string; response: string }
  | { type: 'improvement_failed'; sessionId: string; cycleId: string; error: string }
  | { type: 'ping' };
