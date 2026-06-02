'use client';

import { create } from 'zustand';
import type { FeedbackItem, ImprovementCycle, FeedbackCategory } from '@/types/feedback';

interface FeedbackStore {
  items: FeedbackItem[];
  cycles: ImprovementCycle[];
  isLoading: boolean;
  isApplying: boolean;
  isPanelOpen: boolean;
  lastError: string | null;
  lastCycle: ImprovementCycle | null;

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
  previewPrompt: (sessionId: string) => Promise<string | null>;
  applyImprovements: (sessionId: string, customPrompt?: string) => Promise<ImprovementCycle | null>;
  loadCycles: (sessionId: string) => Promise<void>;
  setPanelOpen: (open: boolean) => void;
  clearError: () => void;
  reset: () => void;
}

export const useFeedbackStore = create<FeedbackStore>((set, get) => ({
  items: [],
  cycles: [],
  isLoading: false,
  isApplying: false,
  isPanelOpen: false,
  lastError: null,
  lastCycle: null,

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

  previewPrompt: async (sessionId) => {
    try {
      const res = await fetch(`/api/v2/sessions/${sessionId}/improvements/preview`);
      if (!res.ok) throw new Error(await res.text());
      const data = await res.json();
      return data.prompt as string;
    } catch (e) {
      set({ lastError: String(e) });
      return null;
    }
  },

  applyImprovements: async (sessionId, customPrompt) => {
    set({ isApplying: true, lastError: null });
    try {
      const res = await fetch(`/api/v2/sessions/${sessionId}/improvements`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(customPrompt ? { customPrompt } : {}),
      });
      if (!res.ok) throw new Error(await res.text());
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

  setPanelOpen: (open) => set({ isPanelOpen: open }),
  clearError: () => set({ lastError: null }),
  reset: () => set({
    items: [], cycles: [], isLoading: false, isApplying: false,
    isPanelOpen: false, lastError: null, lastCycle: null,
  }),
}));
