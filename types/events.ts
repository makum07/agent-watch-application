export type SessionEvent =
  | { type: 'session_update'; sessionId: string }
  | { type: 'agent_message'; sessionId: string; agentId: string }
  | { type: 'tool_call'; sessionId: string; agentId: string; toolName: string }
  | { type: 'artifact_created'; sessionId: string; agentId: string; filePath: string }
  | { type: 'session_ingested'; sessionId: string }
  // Legacy improvement events (kept for backwards compat)
  | { type: 'improvement_started'; sessionId: string; cycleId: string }
  | { type: 'improvement_chunk'; sessionId: string; cycleId: string; chunk: string }
  | { type: 'improvement_complete'; sessionId: string; cycleId: string; status: string; response: string; fileChanges?: import('@/types/feedback').FileChange[] }
  | { type: 'improvement_failed'; sessionId: string; cycleId: string; error: string }
  // Structured streaming events (from --output-format stream-json)
  | { type: 'improvement_stream_event'; sessionId: string; cycleId: string; event: StreamEvent }
  // Edit approval gate
  | { type: 'improvement_permission_request'; sessionId: string; cycleId: string; requestId: string; toolName: string; toolInput: Record<string, unknown> }
  | { type: 'improvement_permission_resolved'; sessionId: string; cycleId: string; requestId: string; approved: boolean }
  // Skill analysis events
  | { type: 'skill_analysis_started'; skillId: string; cycleId: string }
  | { type: 'skill_analysis_stream_event'; skillId: string; cycleId: string; event: StreamEvent }
  | { type: 'skill_analysis_complete'; skillId: string; cycleId: string; status: string }
  | { type: 'skill_analysis_failed'; skillId: string; cycleId: string; error: string }
  | { type: 'skill_analysis_permission_request'; skillId: string; cycleId: string; requestId: string; toolName: string; toolInput: Record<string, unknown> }
  | { type: 'skill_analysis_permission_resolved'; skillId: string; cycleId: string; requestId: string; approved: boolean }
  | { type: 'ping' };

// Client-to-server messages (sent from browser via WebSocket)
export type ClientMessage =
  | { type: 'permission_response'; sessionId: string; cycleId: string; requestId: string; approved: boolean }
  | { type: 'skill_analysis_permission_response'; skillId: string; cycleId: string; requestId: string; approved: boolean };

// Claude Code --output-format stream-json event types
export type StreamEvent =
  | { type: 'system'; subtype: string; session_id?: string; [key: string]: unknown }
  | { type: 'assistant'; message: AssistantMessage; session_id?: string; [key: string]: unknown }
  | { type: 'user'; message: { role: 'user'; content: ToolResultContent[] }; session_id?: string; tool_use_result?: unknown; [key: string]: unknown }
  | { type: 'result'; subtype: string; result?: string; is_error?: boolean; duration_ms?: number; total_cost_usd?: number; permission_denials?: PermissionDenial[]; [key: string]: unknown };

export interface AssistantMessage {
  id?: string;
  model?: string;
  role: 'assistant';
  content: ContentBlock[];
  stop_reason?: string | null;
  usage?: { input_tokens?: number; output_tokens?: number; [key: string]: unknown };
  [key: string]: unknown;
}

export type ContentBlock =
  | { type: 'text'; text: string }
  | { type: 'thinking'; thinking: string; signature?: string }
  | { type: 'tool_use'; id: string; name: string; input: Record<string, unknown>; caller?: unknown };

export type ToolResultContent =
  | { type: 'tool_result'; tool_use_id: string; content: string | unknown[]; is_error?: boolean };

export interface PermissionDenial {
  tool_name: string;
  tool_use_id: string;
  tool_input: Record<string, unknown>;
}
