import { create } from 'zustand';
import type { Session, Agent } from '@/types/session';

interface SessionStore {
  session: Session | null;
  agentMap: Map<string, Agent>;
  isLoading: boolean;
  error: string | null;

  setSession: (session: Session) => void;
  setLoading: (loading: boolean) => void;
  setError: (error: string | null) => void;
  getAgent: (id: string) => Agent | undefined;
  getRootAgent: () => Agent | undefined;
  getChildAgents: (parentId: string) => Agent[];
  getAncestors: (agentId: string) => Agent[];
}

export const useSessionStore = create<SessionStore>((set, get) => ({
  session: null,
  agentMap: new Map(),
  isLoading: false,
  error: null,

  setSession: (session) => {
    const agentMap = new Map<string, Agent>();
    for (const agent of session.agents) {
      agentMap.set(agent.id, agent);
    }
    set({ session, agentMap, error: null });
  },

  setLoading: (isLoading) => set({ isLoading }),
  setError: (error) => set({ error }),

  getAgent: (id) => get().agentMap.get(id),

  getRootAgent: () => {
    const { session, agentMap } = get();
    if (!session) return undefined;
    return agentMap.get(session.rootAgentId);
  },

  getChildAgents: (parentId) => {
    const { session, agentMap } = get();
    if (!session) return [];
    const parent = agentMap.get(parentId);
    if (!parent) return [];
    return parent.children.map(id => agentMap.get(id)).filter(Boolean) as Agent[];
  },

  getAncestors: (agentId) => {
    const { agentMap } = get();
    const ancestors: Agent[] = [];
    let currentId = agentMap.get(agentId)?.parentId ?? null;
    while (currentId) {
      const parent = agentMap.get(currentId);
      if (!parent) break;
      ancestors.unshift(parent);
      currentId = parent.parentId;
    }
    return ancestors;
  },
}));
