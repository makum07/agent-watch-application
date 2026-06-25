import { create } from 'zustand';
import { subscribeWithSelector } from 'zustand/middleware';
import type { LayoutNode, PaneTab, PaneState, TabViewState, FilterState } from '@/types/workspace';

function makeId() {
  return Math.random().toString(36).slice(2, 10);
}

function splitNodeInTree(node: LayoutNode, paneId: string, direction: 'horizontal' | 'vertical', content: PaneTab): LayoutNode {
  if (node.type === 'pane' && node.id === paneId) {
    const newPaneId = makeId();
    return {
      type: 'split',
      id: makeId(),
      direction,
      ratio: 0.5,
      children: [
        node,
        { type: 'pane', id: newPaneId, tabs: [content], activeTab: 0 },
      ],
    };
  }
  if (node.type === 'split') {
    return {
      ...node,
      children: [
        splitNodeInTree(node.children[0], paneId, direction, content),
        splitNodeInTree(node.children[1], paneId, direction, content),
      ],
    };
  }
  return node;
}

function removeNodeFromTree(node: LayoutNode, paneId: string): LayoutNode | null {
  if (node.type === 'pane') {
    return node.id === paneId ? null : node;
  }
  const left = removeNodeFromTree(node.children[0], paneId);
  const right = removeNodeFromTree(node.children[1], paneId);
  if (!left) return right;
  if (!right) return left;
  return { ...node, children: [left, right] };
}

function updateRatioInTree(node: LayoutNode, splitId: string, ratio: number): LayoutNode {
  if (node.type === 'pane') return node;
  if (node.id === splitId) return { ...node, ratio };
  return {
    ...node,
    children: [
      updateRatioInTree(node.children[0], splitId, ratio),
      updateRatioInTree(node.children[1], splitId, ratio),
    ],
  };
}

function addTabToPane(node: LayoutNode, paneId: string, tab: PaneTab): LayoutNode {
  if (node.type === 'pane' && node.id === paneId) {
    const exists = node.tabs.findIndex(t => tabKey(t) === tabKey(tab));
    if (exists >= 0) return { ...node, activeTab: exists };
    return { ...node, tabs: [...node.tabs, tab], activeTab: node.tabs.length };
  }
  if (node.type === 'split') {
    return {
      ...node,
      children: [
        addTabToPane(node.children[0], paneId, tab),
        addTabToPane(node.children[1], paneId, tab),
      ],
    };
  }
  return node;
}

function setActiveTabInTree(node: LayoutNode, paneId: string, index: number): LayoutNode {
  if (node.type === 'pane' && node.id === paneId) {
    return { ...node, activeTab: index };
  }
  if (node.type === 'split') {
    return {
      ...node,
      children: [
        setActiveTabInTree(node.children[0], paneId, index),
        setActiveTabInTree(node.children[1], paneId, index),
      ],
    };
  }
  return node;
}

function tabKey(tab: PaneTab): string {
  if (tab.type === 'agent') return `agent:${tab.agentId}`;
  if (tab.type === 'context') return `context:${tab.agentId}`;
  if (tab.type === 'artifact-content') return `artifact:${tab.artifactId}`;
  if (tab.type === 'comparison') return `comparison:${tab.agentAId}:${tab.agentBId}`;
  return tab.type;
}

export interface WorkspaceStore {
  sessionId: string | null;
  layout: LayoutNode | null;
  focusedPaneId: string | null;
  maximizedPaneId: string | null;
  paneStates: Record<string, PaneState>;
  sidebarCollapsed: boolean;
  sidebarWidth: number;
  globalSearchQuery: string;
  activeFilters: FilterState;
  scrollSyncEnabled: boolean;
  scrollSyncTimestamp: string | null;
  refreshToken: number;

  setSessionId: (id: string) => void;
  incrementRefreshToken: () => void;
  setLayout: (layout: LayoutNode | null) => void;
  splitPane: (paneId: string, direction: 'horizontal' | 'vertical', content: PaneTab) => void;
  closePane: (paneId: string) => void;
  setFocusedPane: (paneId: string) => void;
  maximizePane: (paneId: string) => void;
  restorePane: () => void;
  updateRatio: (node: LayoutNode, sizes: number[]) => void;
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  addTabToPane: (paneId: string, tab: PaneTab) => void;
  setActiveTab: (paneId: string, index: number) => void;
  closeTab: (paneId: string, index: number) => void;
  updatePaneState: (paneId: string, updates: Partial<PaneState>) => void;
  updateTabState: (paneId: string, tabKey: string, updates: Partial<TabViewState>) => void;
  setSidebarCollapsed: (collapsed: boolean) => void;
  setSidebarWidth: (width: number) => void;
  setGlobalSearchQuery: (query: string) => void;
  setActiveFilters: (filters: FilterState) => void;
  toggleScrollSync: () => void;
  broadcastScrollTimestamp: (timestamp: string) => void;
  reset: () => void;
}

export const useWorkspaceStore = create<WorkspaceStore>()(
  subscribeWithSelector((set, get) => ({
    sessionId: null,
    layout: null,
    focusedPaneId: null,
    maximizedPaneId: null,
    paneStates: {},
    sidebarCollapsed: false,
    sidebarWidth: 280,
    globalSearchQuery: '',
    activeFilters: { agentTypes: [], tools: [], timeRange: null, messageRoles: [] },
    scrollSyncEnabled: false,
    scrollSyncTimestamp: null,
    refreshToken: 0,

    setSessionId: (id) => set({ sessionId: id }),
    incrementRefreshToken: () => set(s => ({ refreshToken: s.refreshToken + 1 })),

    setLayout: (layout) => set({ layout }),

    maximizePane: (paneId) => set({ maximizedPaneId: paneId }),
    restorePane: () => set({ maximizedPaneId: null }),

    splitPane: (paneId, direction, content) => {
      const { layout } = get();
      if (!layout) return;
      set({ layout: splitNodeInTree(layout, paneId, direction, content) });
    },

    closePane: (paneId) => {
      const { layout, paneStates } = get();
      if (!layout) return;
      const newLayout = removeNodeFromTree(layout, paneId);
      const newStates = { ...paneStates };
      delete newStates[paneId];
      set({ layout: newLayout, paneStates: newStates });
    },

    setFocusedPane: (paneId) => set({ focusedPaneId: paneId }),

    updateRatio: (node, sizes) => {
      const { layout } = get();
      if (!layout || node.type !== 'split') return;
      const ratio = sizes[0] / 100;
      set({ layout: updateRatioInTree(layout, node.id, ratio) });
    },

    addTabToPane: (paneId, tab) => {
      const { layout } = get();
      if (!layout) return;
      set({ layout: addTabToPane(layout, paneId, tab) });
    },

    setActiveTab: (paneId, index) => {
      const { layout } = get();
      if (!layout) return;
      set({ layout: setActiveTabInTree(layout, paneId, index) });
    },

    closeTab: (paneId, index) => {
      const { layout } = get();
      if (!layout) return;

      function closeTabInTree(node: LayoutNode): LayoutNode {
        if (node.type === 'pane' && node.id === paneId) {
          const newTabs = node.tabs.filter((_, i) => i !== index);
          if (newTabs.length === 0) return node;
          const activeTab = Math.min(node.activeTab, newTabs.length - 1);
          return { ...node, tabs: newTabs, activeTab };
        }
        if (node.type === 'split') {
          return { ...node, children: [closeTabInTree(node.children[0]), closeTabInTree(node.children[1])] };
        }
        return node;
      }

      set({ layout: closeTabInTree(layout) });
    },

    updatePaneState: (paneId, updates) => {
      set(state => ({
        paneStates: {
          ...state.paneStates,
          [paneId]: { ...(state.paneStates[paneId] || { paneId, tabs: [], activeTabIndex: 0, tabStates: {} }), ...updates },
        },
      }));
    },

    updateTabState: (paneId, key, updates) => {
      set(state => {
        const pane = state.paneStates[paneId] || { paneId, tabs: [], activeTabIndex: 0, tabStates: {} };
        return {
          paneStates: {
            ...state.paneStates,
            [paneId]: {
              ...pane,
              tabStates: { ...pane.tabStates, [key]: { ...pane.tabStates[key], ...updates } },
            },
          },
        };
      });
    },

    setSidebarCollapsed: (collapsed) => set({ sidebarCollapsed: collapsed }),
    setSidebarWidth: (width) => set({ sidebarWidth: width }),
    setGlobalSearchQuery: (query) => set({ globalSearchQuery: query }),
    setActiveFilters: (filters) => set({ activeFilters: filters }),
    toggleScrollSync: () => set(s => ({ scrollSyncEnabled: !s.scrollSyncEnabled, scrollSyncTimestamp: null })),
    broadcastScrollTimestamp: (timestamp) => set({ scrollSyncTimestamp: timestamp }),

    reset: () => set({
      sessionId: null, layout: null, focusedPaneId: null, maximizedPaneId: null,
      paneStates: {}, globalSearchQuery: '',
      activeFilters: { agentTypes: [], tools: [], timeRange: null, messageRoles: [] },
      scrollSyncEnabled: false, scrollSyncTimestamp: null,
    }),
  }))
);
