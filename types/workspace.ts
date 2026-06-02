export type AgentSubTab = 'conversation' | 'artifacts' | 'context' | 'tools' | 'summary';

export type PaneTab =
  | { type: 'agent'; agentId: string; label: string; activeSubTab?: AgentSubTab }
  | { type: 'timeline'; label: string }
  | { type: 'graph'; label: string }
  | { type: 'artifacts'; label: string }
  | { type: 'analytics'; label: string }
  | { type: 'context'; agentId: string; label: string }
  | { type: 'artifact-content'; artifactId: string; label: string };

export type LayoutNode =
  | {
      type: 'split';
      id: string;
      direction: 'horizontal' | 'vertical';
      ratio: number;
      children: [LayoutNode, LayoutNode];
    }
  | {
      type: 'pane';
      id: string;
      tabs: PaneTab[];
      activeTab: number;
    };

export interface PaneState {
  paneId: string;
  tabs: PaneTab[];
  activeTabIndex: number;
  tabStates: Record<string, TabViewState>;
}

export interface TabViewState {
  activeSubTab?: AgentSubTab;
  scrollPosition?: number;
  expandedToolCalls?: string[];
  expandedArtifacts?: string[];
  searchQuery?: string;
}

export interface FilterState {
  agentTypes: string[];
  tools: string[];
  timeRange: { start: string; end: string } | null;
  messageRoles: string[];
}

export interface WorkspaceSnapshot {
  id: string;
  sessionId: string;
  savedAt: string;
  isAutoSave: boolean;
  name: string | null;
  layout: LayoutNode;
  paneStates: Record<string, PaneState>;
  sidebarCollapsed: boolean;
  sidebarWidth: number;
  globalSearchQuery: string | null;
  activeFilters: FilterState;
}
