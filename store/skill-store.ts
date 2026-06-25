'use client';

import { create } from 'zustand';
import type {
  SkillSummary,
  SkillDetailData,
  SkillAnalysisCycle,
  SelfHealingMode,
} from '@/types/skills';
import type { SessionEvent, StreamEvent, ContentBlock } from '@/types/events';
import type { StreamEntry } from '@/types/feedback';

interface SkillStore {
  skills: SkillSummary[];
  selectedSkill: SkillDetailData | null;
  analysisCycles: SkillAnalysisCycle[];
  isLoading: boolean;
  isSyncing: boolean;
  isAnalyzing: boolean;
  lastError: string | null;

  streamEntries: StreamEntry[];

  loadSkills: (project?: string) => Promise<void>;
  syncSkills: () => Promise<number>;
  loadSkillDetail: (skillId: string) => Promise<void>;
  updateSkillConfig: (skillId: string, updates: {
    selfHealingEnabled?: boolean;
    selfHealingMode?: SelfHealingMode;
    selfHealingThreshold?: number;
    description?: string;
  }) => Promise<void>;
  loadAnalysisCycles: (skillId: string) => Promise<void>;
  previewPrompt: (skillId: string) => Promise<string | null>;
  triggerAnalysis: (skillId: string, customPrompt?: string) => Promise<SkillAnalysisCycle | null>;
  approveFixPrompt: (skillId: string, cycleId: string, fixPrompt?: string) => Promise<void>;
  deleteAnalysisCycle: (skillId: string, cycleId: string) => Promise<void>;
  handleStreamEvent: (event: SessionEvent) => void;
  clearError: () => void;
  clearStream: () => void;
  reset: () => void;
}

let streamIdCounter = 0;

export const useSkillStore = create<SkillStore>((set, get) => ({
  skills: [],
  selectedSkill: null,
  analysisCycles: [],
  isLoading: false,
  isSyncing: false,
  isAnalyzing: false,
  lastError: null,
  streamEntries: [],

  loadSkills: async (project?) => {
    set({ isLoading: true, lastError: null });
    try {
      const url = project ? `/api/v2/skills?project=${encodeURIComponent(project)}` : '/api/v2/skills';
      const res = await fetch(url);
      if (!res.ok) throw new Error(await res.text());
      const data = await res.json();
      set({ skills: data.skills, isLoading: false });
    } catch (err) {
      set({ lastError: String(err), isLoading: false });
    }
  },

  syncSkills: async () => {
    set({ isSyncing: true, lastError: null });
    try {
      const res = await fetch('/api/v2/skills', { method: 'POST' });
      if (!res.ok) throw new Error(await res.text());
      const data = await res.json();
      await get().loadSkills();
      set({ isSyncing: false });
      return data.synced;
    } catch (err) {
      set({ lastError: String(err), isSyncing: false });
      return 0;
    }
  },

  loadSkillDetail: async (skillId) => {
    set({ isLoading: true, lastError: null });
    try {
      const res = await fetch(`/api/v2/skills/${skillId}`);
      if (!res.ok) throw new Error(await res.text());
      const data = await res.json();
      set({ selectedSkill: data, isLoading: false });
    } catch (err) {
      set({ lastError: String(err), isLoading: false });
    }
  },

  updateSkillConfig: async (skillId, updates) => {
    set({ lastError: null });
    try {
      const res = await fetch(`/api/v2/skills/${skillId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(updates),
      });
      if (!res.ok) throw new Error(await res.text());
      await get().loadSkillDetail(skillId);
    } catch (err) {
      set({ lastError: String(err) });
    }
  },

  loadAnalysisCycles: async (skillId) => {
    try {
      const res = await fetch(`/api/v2/skills/${skillId}/analysis`);
      if (!res.ok) throw new Error(await res.text());
      const data = await res.json();
      set({ analysisCycles: data.cycles });
    } catch (err) {
      set({ lastError: String(err) });
    }
  },

  previewPrompt: async (skillId) => {
    try {
      const res = await fetch(`/api/v2/skills/${skillId}/analysis?preview=1`);
      if (!res.ok) throw new Error(await res.text());
      const data = await res.json();
      return data.prompt as string;
    } catch (err) {
      set({ lastError: String(err) });
      return null;
    }
  },

  triggerAnalysis: async (skillId, customPrompt?) => {
    set({ isAnalyzing: true, lastError: null, streamEntries: [] });
    try {
      const body: Record<string, unknown> = {};
      if (customPrompt) body.customPrompt = customPrompt;

      const res = await fetch(`/api/v2/skills/${skillId}/analysis`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      if (!res.ok) throw new Error(await res.text());
      const cycle = await res.json();
      return cycle;
    } catch (err) {
      set({ lastError: String(err), isAnalyzing: false });
      return null;
    }
  },

  approveFixPrompt: async (skillId, cycleId, fixPrompt?) => {
    set({ isAnalyzing: true, lastError: null });
    try {
      const body: Record<string, unknown> = {};
      if (fixPrompt) body.fixPrompt = fixPrompt;

      const res = await fetch(`/api/v2/skills/${skillId}/analysis/${cycleId}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      if (!res.ok) throw new Error(await res.text());
      await get().loadAnalysisCycles(skillId);
    } catch (err) {
      set({ lastError: String(err), isAnalyzing: false });
    }
  },

  deleteAnalysisCycle: async (skillId, cycleId) => {
    try {
      await fetch(`/api/v2/skills/${skillId}/analysis/${cycleId}`, { method: 'DELETE' });
      set(state => ({
        analysisCycles: state.analysisCycles.filter(c => c.id !== cycleId),
      }));
    } catch (err) {
      set({ lastError: String(err) });
    }
  },

  handleStreamEvent: (event: SessionEvent) => {
    if (event.type === 'skill_analysis_started') {
      set({ streamEntries: [], isAnalyzing: true });
      return;
    }

    if (event.type === 'skill_analysis_stream_event') {
      const streamEvent = (event as unknown as { event: StreamEvent }).event;
      const entries: StreamEntry[] = [];

      if (streamEvent.type === 'assistant') {
        const msg = streamEvent.message as { content?: ContentBlock[] };
        if (msg?.content) {
          for (const block of msg.content) {
            if ('text' in block && block.text) {
              entries.push({
                id: `sk-${++streamIdCounter}`,
                kind: 'text',
                timestamp: Date.now(),
                text: block.text,
              });
            }
            if ('thinking' in block) {
              entries.push({
                id: `sk-${++streamIdCounter}`,
                kind: 'thinking',
                timestamp: Date.now(),
                text: (block as { thinking: string }).thinking,
              });
            }
            if (block.type === 'tool_use') {
              const tu = block as { id: string; name: string; input: Record<string, unknown> };
              entries.push({
                id: `sk-${++streamIdCounter}`,
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
                id: `sk-${++streamIdCounter}`,
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

    if (event.type === 'skill_analysis_complete') {
      set({ isAnalyzing: false });
      const skillId = (event as unknown as { skillId: string }).skillId;
      get().loadAnalysisCycles(skillId);
      get().loadSkillDetail(skillId);
      return;
    }

    if (event.type === 'skill_analysis_failed') {
      const error = (event as unknown as { error: string }).error;
      set({ isAnalyzing: false, lastError: error });
      return;
    }
  },

  clearError: () => set({ lastError: null }),
  clearStream: () => set({ streamEntries: [] }),
  reset: () => set({
    skills: [],
    selectedSkill: null,
    analysisCycles: [],
    isLoading: false,
    isSyncing: false,
    isAnalyzing: false,
    lastError: null,
    streamEntries: [],
  }),
}));
