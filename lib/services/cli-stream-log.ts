// Shared stream-json → StreamEntry translation and cycle-broadcast plumbing.
//
// Every feature that drives the `claude` CLI in stream-json mode (execution
// analysis, skill self-healing, the improvement loop) parses the same
// `assistant` text/thinking/tool_use blocks and `user` tool_result blocks
// into StreamEntry log rows, and broadcasts over the same
// `{ type, ...correlation, ...payload }` shape. This module is that shared
// layer; `system`/`result` event handling and all persistence/business
// logic differ per caller and stay there.

import { getWsServer } from '@/lib/websocket/ws-server';
import type { StreamEntry } from '@/types/feedback';

type StreamEntryDraft = Omit<StreamEntry, 'id' | 'timestamp'>;

/** Translates one raw stream-json event into the StreamEntry rows it produces. */
export function translateStreamEvent(event: Record<string, unknown>): StreamEntryDraft[] {
  const entries: StreamEntryDraft[] = [];
  const eventType = event.type as string;

  if (eventType === 'assistant') {
    const msg = event.message as {
      content?: Array<{ type: string; text?: string; thinking?: string; id?: string; name?: string; input?: Record<string, unknown> }>;
    } | undefined;
    for (const block of msg?.content ?? []) {
      if (block.type === 'text' && block.text) {
        entries.push({ kind: 'text', text: block.text });
      }
      if (block.type === 'thinking' && block.thinking) {
        entries.push({ kind: 'thinking', text: block.thinking });
      }
      if (block.type === 'tool_use') {
        entries.push({ kind: 'tool_use', toolName: block.name, toolInput: block.input, toolUseId: block.id });
      }
    }
  }

  if (eventType === 'user') {
    const userMsg = event.message as {
      content?: Array<{ type: string; tool_use_id?: string; content?: string; is_error?: boolean }>;
    } | undefined;
    for (const block of userMsg?.content ?? []) {
      if (block.type === 'tool_result') {
        entries.push({
          kind: 'tool_result',
          toolUseId: block.tool_use_id,
          content: typeof block.content === 'string' ? block.content : JSON.stringify(block.content),
          isError: block.is_error ?? false,
        });
      }
    }
  }

  return entries;
}

/** Owns the `${prefix}-N` id counter and timestamp stamping for a cycle's stream log. */
export function createStreamLogger(prefix: string) {
  const entries: StreamEntry[] = [];
  let counter = 0;
  const push = (entry: StreamEntryDraft): StreamEntry => {
    const full: StreamEntry = { id: `${prefix}-${++counter}`, timestamp: Date.now(), ...entry };
    entries.push(full);
    return full;
  };
  return { entries, push };
}

/** The `{ type, ...correlation, ...payload }` broadcast shape shared by every cycle-based feature. */
export function createCycleBroadcaster(correlation: Record<string, unknown>) {
  const wss = getWsServer();
  return (type: string, payload: Record<string, unknown> = {}) => {
    wss?.broadcast({ type, ...correlation, ...payload } as never);
  };
}

/**
 * Extracts and parses the ` ```json ... ``` ` fence every analysis prompt
 * asks Claude to end its response with. Returns the raw parsed object (or
 * null if there's no fence or it doesn't parse) — callers read their own
 * expected fields off it, so no per-feature response shape is baked in here.
 */
export function extractJsonFence(text: string): Record<string, unknown> | null {
  const match = text.match(/```json\s*([\s\S]*?)```/);
  if (!match) return null;
  try {
    return JSON.parse(match[1]);
  } catch {
    return null;
  }
}
