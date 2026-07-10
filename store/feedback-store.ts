'use client';

import { create } from 'zustand';
import type { FeedbackItem, ImprovementCycle, FeedbackCategory, StreamEntry, DetectedSkill } from '@/types/feedback';
import type { SessionEvent, StreamEvent, ContentBlock } from '@/types/events';

interface FeedbackStore {
  items: FeedbackItem[];
  cycles: ImprovementCycle[];
  isLoading: boolean;
  isApplying: boolean;
  isPanelOpen: boolean;
  lastError: string | null;
  lastCycle: ImprovementCycle | null;
  autoDetectedSkills: DetectedSkill[];

  // Live streaming state for the active cycle
  streamEntries: StreamEntry[];
  pendingApprovals: Map<string, { toolName: string; toolInput: Record<string, unknown> }>;

  loadFeedback: (sessionId: string) => Promise<void>;
  addFeedback: (payload: {
    sessionId: string;
    agentId: string;
    agentName: string | null;
    category: FeedbackCategory;
    text: string;
    messageId?: string;
    artifactId?: string;
  }) => Promise<FeedbackItem | null>;
  updateFeedback: (sessionId: string, itemId: string, updates: { text?: string; category?: FeedbackCategory }) => Promise<void>;
  deleteFeedback: (sessionId: string, itemId: string) => Promise<void>;
  previewPrompt: (sessionId: string, skillIds?: string[]) => Promise<string | null>;
  applyImprovements: (sessionId: string, customPrompt?: string, skillIds?: string[]) => Promise<ImprovementCycle | null>;
  rewindCycle: (sessionId: string, cycleId: string) => Promise<{ ok: boolean; error?: string }>;
  deleteCycle: (sessionId: string, cycleId: string) => Promise<void>;
  clearRewoundCycles: (sessionId: string) => Promise<void>;
  loadCycles: (sessionId: string) => Promise<void>;
  handleStreamEvent: (event: SessionEvent) => void;
  setPanelOpen: (open: boolean) => void;
  clearError: () => void;
  clearStream: () => void;
  reset: () => void;
}

let streamIdCounter = 0;

export const useFeedbackStore = create<FeedbackStore>((set, get) => ({
  items: [],
  cycles: [],
  isLoading: false,
  isApplying: false,
  isPanelOpen: false,
  lastError: null,
  lastCycle: null,
  autoDetectedSkills: [],
  streamEntries: [],
  pendingApprovals: new Map(),

  loadFeedback: async (sessionId) => {
    set({ isLoading: true, lastError: null });
    try {
      const res = await fetch(`/api/v2/sessions/${sessionId}/feedback`);
      if (!res.ok) throw new Error(await res.text());
      const data = await res.json();
      set({ items: data.items ?? [] });
    } catch (e) {
      set({ lastError: String(e) });
    } finally {
      set({ isLoading: false });
    }
  },

  addFeedback: async (payload) => {
    try {
      const res = await fetch(`/api/v2/sessions/${payload.sessionId}/feedback`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      if (!res.ok) throw new Error(await res.text());
      const created: FeedbackItem = await res.json();
      set(s => ({ items: [...s.items, created] }));
      return created;
    } catch (e) {
      set({ lastError: String(e) });
      return null;
    }
  },

  updateFeedback: async (sessionId, itemId, updates) => {
    // Optimistic update
    set(s => ({
      items: s.items.map(i => i.id === itemId ? { ...i, ...updates } : i),
    }));
    try {
      const res = await fetch(`/api/v2/sessions/${sessionId}/feedback?itemId=${itemId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(updates),
      });
      if (!res.ok) throw new Error(await res.text());
      const updated: FeedbackItem = await res.json();
      set(s => ({ items: s.items.map(i => i.id === itemId ? updated : i) }));
    } catch (e) {
      set({ lastError: String(e) });
      // Reload to restore true server state
      await get().loadFeedback(sessionId);
    }
  },

  deleteFeedback: async (sessionId, itemId) => {
    set(s => ({ items: s.items.filter(i => i.id !== itemId) }));
    try {
      const res = await fetch(`/api/v2/sessions/${sessionId}/feedback?itemId=${itemId}`, {
        method: 'DELETE',
      });
      if (!res.ok) throw new Error(await res.text());
    } catch (e) {
      set({ lastError: String(e) });
      await get().loadFeedback(sessionId);
    }
  },

  previewPrompt: async (sessionId, skillIds = []) => {
    try {
      const qs = skillIds.length ? `?skills=${encodeURIComponent(skillIds.join(','))}` : '';
      const res = await fetch(`/api/v2/sessions/${sessionId}/improvements/preview${qs}`);
      if (!res.ok) throw new Error(await res.text());
      const data = await res.json();
      set({ autoDetectedSkills: data.autoDetectedSkills ?? [] });
      return data.prompt as string;
    } catch (e) {
      set({ lastError: String(e) });
      return null;
    }
  },

  applyImprovements: async (sessionId, customPrompt, skillIds) => {
    set({ isApplying: true, lastError: null });
    try {
      const res = await fetch(`/api/v2/sessions/${sessionId}/improvements`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...(customPrompt ? { customPrompt } : {}),
          ...(skillIds?.length ? { skillIds } : {}),
        }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => null);
        throw new Error(err?.error ?? res.statusText);
      }
      const cycle: ImprovementCycle = await res.json();
      set(s => ({ cycles: [cycle, ...s.cycles], lastCycle: cycle }));
      return cycle;
    } catch (e) {
      set({ lastError: String(e) });
      return null;
    } finally {
      set({ isApplying: false });
    }
  },

  deleteCycle: async (sessionId, cycleId) => {
    set(s => ({ cycles: s.cycles.filter(c => c.id !== cycleId) }));
    try {
      const res = await fetch(`/api/v2/sessions/${sessionId}/improvements?cycleId=${cycleId}`, { method: 'DELETE' });
      if (!res.ok) throw new Error(await res.text());
    } catch (e) {
      set({ lastError: String(e) });
      await get().loadCycles(sessionId);
    }
  },

  clearRewoundCycles: async (sessionId) => {
    set(s => ({ cycles: s.cycles.filter(c => c.status !== 'rewound') }));
    try {
      const res = await fetch(`/api/v2/sessions/${sessionId}/improvements?clearRewound=true`, { method: 'DELETE' });
      if (!res.ok) throw new Error(await res.text());
    } catch (e) {
      set({ lastError: String(e) });
      await get().loadCycles(sessionId);
    }
  },

  loadCycles: async (sessionId) => {
    try {
      const res = await fetch(`/api/v2/sessions/${sessionId}/improvements`);
      if (!res.ok) throw new Error(await res.text());
      const data = await res.json();
      set({ cycles: data.cycles ?? [] });
    } catch (e) {
      set({ lastError: String(e) });
    }
  },

  rewindCycle: async (sessionId, cycleId) => {
    try {
      const res = await fetch(`/api/v2/sessions/${sessionId}/improvements?rewind=${cycleId}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: res.statusText }));
        return { ok: false, error: err.error ?? res.statusText };
      }
      // Refresh cycles — rewound ones will now show 'rewound' status
      await get().loadCycles(sessionId);
      return { ok: true };
    } catch (e) {
      return { ok: false, error: String(e) };
    }
  },

  handleStreamEvent: (event: SessionEvent) => {
    if (event.type === 'improvement_started') {
      set({ streamEntries: [], pendingApprovals: new Map() });
      return;
    }

    if (event.type === 'improvement_stream_event') {
      const se = (event as { event: StreamEvent }).event;
      const entries: StreamEntry[] = [];

      if (se.type === 'system') {
        if (se.subtype === 'init') {
          entries.push({ id: `s-${++streamIdCounter}`, kind: 'system', timestamp: Date.now(), text: `Session initialized (model: ${se.model ?? 'unknown'})` });
        }
      } else if (se.type === 'assistant') {
        const content = se.message?.content ?? [];
        for (const block of content as ContentBlock[]) {
          if (block.type === 'text') {
            entries.push({ id: `s-${++streamIdCounter}`, kind: 'text', timestamp: Date.now(), text: block.text });
          } else if (block.type === 'thinking') {
            entries.push({ id: `s-${++streamIdCounter}`, kind: 'thinking', timestamp: Date.now(), text: block.thinking ?? '' });
          } else if (block.type === 'tool_use') {
            entries.push({
              id: `s-${++streamIdCounter}`, kind: 'tool_use', timestamp: Date.now(),
              toolName: block.name, toolInput: block.input, toolUseId: block.id,
            });
          }
        }
      } else if (se.type === 'user') {
        const content = se.message?.content ?? [];
        for (const block of content as Array<{ type: string; tool_use_id?: string; content?: string; is_error?: boolean }>) {
          if (block.type === 'tool_result') {
            entries.push({
              id: `s-${++streamIdCounter}`, kind: 'tool_result', timestamp: Date.now(),
              toolUseId: block.tool_use_id, content: typeof block.content === 'string' ? block.content : JSON.stringify(block.content),
              isError: block.is_error ?? false,
            });
          }
        }
      }

      if (entries.length > 0) {
        set(s => ({ streamEntries: [...s.streamEntries, ...entries] }));
      }
      return;
    }

    if (event.type === 'improvement_permission_request') {
      const { requestId, toolName, toolInput } = event as { requestId: string; toolName: string; toolInput: Record<string, unknown> };
      set(s => {
        const next = new Map(s.pendingApprovals);
        next.set(requestId, { toolName, toolInput });
        const entry: StreamEntry = {
          id: `s-${++streamIdCounter}`, kind: 'permission_request', timestamp: Date.now(),
          requestId, toolName, toolInput, approved: null,
        };
        return { pendingApprovals: next, streamEntries: [...s.streamEntries, entry] };
      });
      return;
    }

    if (event.type === 'improvement_permission_resolved') {
      const { requestId, approved } = event as { requestId: string; approved: boolean };
      set(s => {
        const next = new Map(s.pendingApprovals);
        next.delete(requestId);
        const entries = s.streamEntries.map(e =>
          e.requestId === requestId ? { ...e, approved } : e
        );
        return { pendingApprovals: next, streamEntries: entries };
      });
      return;
    }

    if (event.type === 'improvement_complete') {
      const { sessionId: sid } = event as { sessionId: string };
      get().loadCycles(sid);
      return;
    }
  },

  setPanelOpen: (open) => set({ isPanelOpen: open }),
  clearError: () => set({ lastError: null }),
  clearStream: () => set({ streamEntries: [], pendingApprovals: new Map() }),
  reset: () => set({
    items: [], cycles: [], isLoading: false, isApplying: false,
    isPanelOpen: false, lastError: null, lastCycle: null, autoDetectedSkills: [],
    streamEntries: [], pendingApprovals: new Map(),
  }),
}));
