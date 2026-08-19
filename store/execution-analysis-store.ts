'use client';

import { create } from 'zustand';
import type { ExecutionAnalysisCycle } from '@/types/analytics';
import type { SessionEvent, StreamEvent, ContentBlock } from '@/types/events';
import type { StreamEntry } from '@/types/feedback';
import { DEFAULT_CLAUDE_CLI_MODEL, type ClaudeCliModel } from '@/lib/claude-models';

interface ExecutionAnalysisStore {
  cycles: ExecutionAnalysisCycle[];
  isAnalyzing: boolean;
  isStopping: boolean;
  isLoading: boolean;
  lastError: string | null;
  streamEntries: StreamEntry[];
  activeCycleId: string | null;
  model: ClaudeCliModel;

  setModel: (model: ClaudeCliModel) => void;
  loadCycles: (sessionId: string) => Promise<void>;
  previewPrompt: (sessionId: string) => Promise<string | null>;
  triggerAnalysis: (sessionId: string, customPrompt?: string) => Promise<ExecutionAnalysisCycle | null>;
  stopAnalysis: (sessionId: string) => Promise<void>;
  deleteCycle: (sessionId: string, cycleId: string) => Promise<void>;
  handleStreamEvent: (event: SessionEvent) => void;
  clearError: () => void;
  clearStream: () => void;
  reset: () => void;
}

let streamIdCounter = 0;

export const useExecutionAnalysisStore = create<ExecutionAnalysisStore>((set, get) => ({
  cycles: [],
  isAnalyzing: false,
  isStopping: false,
  isLoading: false,
  lastError: null,
  streamEntries: [],
  activeCycleId: null,
  model: DEFAULT_CLAUDE_CLI_MODEL,

  setModel: (model) => set({ model }),

  loadCycles: async (sessionId) => {
    set({ isLoading: true, lastError: null });
    try {
      const res = await fetch(`/api/v2/sessions/${sessionId}/analysis`);
      if (!res.ok) throw new Error(await res.text());
      const data = await res.json();
      const cycles = data.cycles as ExecutionAnalysisCycle[];
      const stillAnalyzing = cycles.some(c => c.status === 'analyzing');
      set(s => ({
        cycles,
        isLoading: false,
        isAnalyzing: stillAnalyzing ? s.isAnalyzing : false,
      }));
    } catch (err) {
      set({ lastError: String(err), isLoading: false });
    }
  },

  previewPrompt: async (sessionId) => {
    try {
      const res = await fetch(`/api/v2/sessions/${sessionId}/analysis?preview=1`);
      if (!res.ok) throw new Error(await res.text());
      const data = await res.json();
      return data.prompt as string;
    } catch (err) {
      set({ lastError: String(err) });
      return null;
    }
  },

  triggerAnalysis: async (sessionId, customPrompt?) => {
    set({ isAnalyzing: true, lastError: null, streamEntries: [] });
    try {
      const body: Record<string, unknown> = { model: get().model };
      if (customPrompt) body.customPrompt = customPrompt;

      const res = await fetch(`/api/v2/sessions/${sessionId}/analysis`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      if (!res.ok) throw new Error(await res.text());
      const cycle = await res.json() as ExecutionAnalysisCycle;
      set(s => ({
        activeCycleId: cycle.id,
        cycles: [cycle, ...s.cycles],
      }));
      return cycle;
    } catch (err) {
      set({ lastError: String(err), isAnalyzing: false });
      return null;
    }
  },

  stopAnalysis: async (sessionId) => {
    const cycleId = get().activeCycleId;
    if (!cycleId) return;
    set({ isStopping: true });
    try {
      const res = await fetch(`/api/v2/sessions/${sessionId}/analysis/${cycleId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'cancel' }),
      });
      if (!res.ok) throw new Error(await res.text());
    } catch (err) {
      set({ lastError: String(err) });
    } finally {
      set({ isStopping: false });
    }
  },

  deleteCycle: async (sessionId, cycleId) => {
    try {
      await fetch(`/api/v2/sessions/${sessionId}/analysis?cycleId=${cycleId}`, { method: 'DELETE' });
      set(state => ({
        cycles: state.cycles.filter(c => c.id !== cycleId),
      }));
    } catch (err) {
      set({ lastError: String(err) });
    }
  },

  handleStreamEvent: (event: SessionEvent) => {
    if (event.type === 'execution_analysis_started') {
      set({ streamEntries: [], isAnalyzing: true });
      return;
    }

    if (event.type === 'execution_analysis_stream_event') {
      const streamEvent = (event as unknown as { event: StreamEvent }).event;
      const entries: StreamEntry[] = [];

      if (streamEvent.type === 'assistant') {
        const msg = streamEvent.message as { content?: ContentBlock[] };
        if (msg?.content) {
          for (const block of msg.content) {
            if ('text' in block && block.text) {
              entries.push({
                id: `ea-${++streamIdCounter}`,
                kind: 'text',
                timestamp: Date.now(),
                text: block.text,
              });
            }
            if ('thinking' in block) {
              entries.push({
                id: `ea-${++streamIdCounter}`,
                kind: 'thinking',
                timestamp: Date.now(),
                text: (block as { thinking: string }).thinking,
              });
            }
            if (block.type === 'tool_use') {
              const tu = block as { id: string; name: string; input: Record<string, unknown> };
              entries.push({
                id: `ea-${++streamIdCounter}`,
                kind: 'tool_use',
                timestamp: Date.now(),
                toolName: tu.name,
                toolInput: tu.input,
                toolUseId: tu.id,
              });
            }
          }
        }
      }

      if (streamEvent.type === 'user') {
        const userMsg = streamEvent.message as { content?: Array<{ type: string; tool_use_id?: string; content?: string; is_error?: boolean }> };
        if (userMsg?.content) {
          for (const block of userMsg.content) {
            if (block.type === 'tool_result') {
              entries.push({
                id: `ea-${++streamIdCounter}`,
                kind: 'tool_result',
                timestamp: Date.now(),
                toolUseId: block.tool_use_id,
                content: typeof block.content === 'string' ? block.content : JSON.stringify(block.content),
                isError: block.is_error ?? false,
              });
            }
          }
        }
      }

      // Confirms the model picker's choice actually took effect, and captures
      // this new one-shot session's own id (unlike the improvement loop,
      // this always starts a fresh session rather than resuming one) — both
      // come from the CLI's own init event.
      if (streamEvent.type === 'system' && streamEvent.subtype === 'init') {
        const resolvedModel = (streamEvent as { model?: string }).model;
        const cliSessionId = (streamEvent as { session_id?: string }).session_id;
        entries.push({
          id: `ea-${++streamIdCounter}`,
          kind: 'system',
          timestamp: Date.now(),
          text: `Session initialized (model: ${resolvedModel ?? 'unknown'}${cliSessionId ? `, session: ${cliSessionId}` : ''})`,
        });
        if (resolvedModel || cliSessionId) {
          const activeId = get().activeCycleId;
          set(s => ({
            cycles: s.cycles.map(c => c.id === activeId
              ? { ...c, model: resolvedModel ?? c.model, cliSessionId: cliSessionId ?? c.cliSessionId }
              : c),
          }));
        }
      }

      if (entries.length > 0) {
        set(state => ({ streamEntries: [...state.streamEntries, ...entries] }));
      }
      return;
    }

    if (event.type === 'execution_analysis_complete') {
      const sessionId = (event as unknown as { sessionId: string }).sessionId;
      set({ isAnalyzing: false });
      get().loadCycles(sessionId);
      return;
    }

    if (event.type === 'execution_analysis_failed') {
      const error = (event as unknown as { error: string }).error;
      const sessionId = (event as unknown as { sessionId: string }).sessionId;
      set({ isAnalyzing: false, lastError: error });
      get().loadCycles(sessionId);
      return;
    }
  },

  clearError: () => set({ lastError: null }),
  clearStream: () => set({ streamEntries: [] }),
  reset: () => set({
    cycles: [],
    isAnalyzing: false,
    isStopping: false,
    isLoading: false,
    lastError: null,
    streamEntries: [],
    activeCycleId: null,
  }),
}));
