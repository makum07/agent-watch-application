'use client';

import { create } from 'zustand';
import type { ExecutionAnalysisCycle } from '@/types/analytics';
import type { SessionEvent, StreamEvent, ContentBlock } from '@/types/events';
import type { StreamEntry } from '@/types/feedback';

interface ExecutionAnalysisStore {
  cycles: ExecutionAnalysisCycle[];
  isAnalyzing: boolean;
  isLoading: boolean;
  lastError: string | null;
  streamEntries: StreamEntry[];
  activeCycleId: string | null;

  loadCycles: (sessionId: string) => Promise<void>;
  previewPrompt: (sessionId: string) => Promise<string | null>;
  triggerAnalysis: (sessionId: string, customPrompt?: string) => Promise<ExecutionAnalysisCycle | null>;
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
  isLoading: false,
  lastError: null,
  streamEntries: [],
  activeCycleId: null,

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
      const body: Record<string, unknown> = {};
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
    isLoading: false,
    lastError: null,
    streamEntries: [],
    activeCycleId: null,
  }),
}));
