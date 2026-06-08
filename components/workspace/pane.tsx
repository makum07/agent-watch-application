'use client';

import { useState, useRef, useEffect } from 'react';
import { X, Plus, SplitSquareHorizontal, SplitSquareVertical, Search } from 'lucide-react';
import { cn } from '@/lib/utils';
import { AgentView } from '@/components/agent/agent-view';
import { useWorkspaceStore } from '@/store/workspace-store';
import { useSessionStore } from '@/store/session-store';
import { getAgentDisplay } from '@/lib/agent-display';
import type { PaneTab } from '@/types/workspace';

interface PaneProps {
  paneId: string;
  tabs: PaneTab[];
  activeTab: number;
  sessionId: string;
}

export function Pane({ paneId, tabs, activeTab, sessionId }: PaneProps) {
  const { setActiveTab, closeTab, closePane, setFocusedPane, focusedPaneId, splitPane, addTabToPane } = useWorkspaceStore();
  const isFocused = focusedPaneId === paneId;
  const [showPicker, setShowPicker] = useState(false);

  const currentTab = tabs[activeTab];

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    const agentId = e.dataTransfer.getData('agentId');
    const agentLabel = e.dataTransfer.getData('agentLabel');
    if (!agentId) return;
    const tab: PaneTab = { type: 'agent', agentId, label: agentLabel || 'Agent' };
    useWorkspaceStore.getState().addTabToPane(paneId, tab);
    setFocusedPane(paneId);
  };

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
  };

  if (tabs.length === 0) {
    return (
      <div
        className={cn(
          'flex flex-col h-full border border-[#30363d] rounded-sm bg-[#0d1117]',
          isFocused && 'border-[#58a6ff]/50'
        )}
        onClick={() => setFocusedPane(paneId)}
        onDrop={handleDrop}
        onDragOver={handleDragOver}
      >
        <div className="flex items-center justify-center h-full text-[#6e7681] text-sm flex-col gap-3">
          <Plus className="h-8 w-8 opacity-20" />
          <span className="text-xs opacity-50">Drop an agent here</span>
          <div className="flex gap-2">
            <button
              onClick={() => {
                const store = useWorkspaceStore.getState();
                const session = useSessionStore.getState().session;
                if (session?.agents[0]) {
                  const a = session.agents[0];
                  store.addTabToPane(paneId, { type: 'agent', agentId: a.id, label: a.subagentType || 'Agent' });
                }
              }}
              className="text-xs text-[#58a6ff] hover:underline"
            >
              Open first agent
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div
      className={cn(
        'flex flex-col h-full border border-[#30363d] rounded-sm overflow-hidden',
        isFocused ? 'border-[#58a6ff]/50' : 'border-[#30363d]'
      )}
      onClick={() => setFocusedPane(paneId)}
      onDrop={handleDrop}
      onDragOver={handleDragOver}
    >
      {/* Tab bar — shown when multiple tabs */}
      {tabs.length > 1 && (
        <div className="flex items-center bg-[#0d1117] border-b border-[#21262d] overflow-x-auto shrink-0 relative">
          {tabs.map((tab, i) => (
            <div
              key={`${tab.type}-${i}`}
              className={cn(
                'flex items-center gap-1.5 px-3 py-1.5 text-xs cursor-pointer border-r border-[#21262d] shrink-0 max-w-[140px]',
                i === activeTab
                  ? 'bg-[#161b22] text-[#e6edf3] border-b-0'
                  : 'text-[#8b949e] hover:text-[#e6edf3] hover:bg-[#161b22]'
              )}
              onClick={e => { e.stopPropagation(); setActiveTab(paneId, i); }}
            >
              <span className="truncate">{tab.label}</span>
              <button
                onClick={e => { e.stopPropagation(); closeTab(paneId, i); }}
                className="hover:text-[#e6edf3] opacity-50 hover:opacity-100 shrink-0"
              >
                <X className="h-3 w-3" />
              </button>
            </div>
          ))}
          {/* Add tab button */}
          <button
            onClick={e => { e.stopPropagation(); setShowPicker(p => !p); }}
            className="p-1.5 text-[#484f58] hover:text-[#c9d1d9] hover:bg-[#161b22] transition-colors border-r border-[#21262d] shrink-0"
            title="Add tab"
          >
            <Plus className="h-3 w-3" />
          </button>
          <div className="ml-auto flex items-center gap-1 px-2">
            <SplitButton paneId={paneId} tabs={tabs} activeTab={activeTab} />
            <button
              onClick={() => closePane(paneId)}
              className="text-[#c9d1d9] hover:text-[#e6edf3] p-1 rounded hover:bg-[#21262d]"
              title="Close pane"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          </div>
          {/* Agent picker dropdown */}
          {showPicker && (
            <AgentPickerDropdown
              paneId={paneId}
              existingTabs={tabs}
              onClose={() => setShowPicker(false)}
            />
          )}
        </div>
      )}

      {/* Single tab — no tab bar, but show close + split in the agent view header area */}
      <div className="flex-1 overflow-hidden min-h-0 min-w-0">
        {currentTab && renderTabContent(currentTab, sessionId, paneId, tabs.length === 1)}
      </div>
    </div>
  );
}

function SplitButton({ paneId, tabs, activeTab }: { paneId: string; tabs: PaneTab[]; activeTab: number }) {
  const { splitPane } = useWorkspaceStore();
  const currentTab = tabs[activeTab];

  const doSplit = (dir: 'horizontal' | 'vertical') => {
    const newTab: PaneTab = { type: 'pane' as never, label: 'Empty' } as PaneTab;
    splitPane(paneId, dir, { type: 'agent' as const, agentId: '', label: 'Drop agent here' });
  };

  return (
    <>
      <button
        onClick={() => splitPane(paneId, 'horizontal', { type: 'agent' as const, agentId: '', label: '' })}
        className="text-[#c9d1d9] hover:text-[#e6edf3] p-1 rounded hover:bg-[#21262d]"
        title="Split right"
      >
        <SplitSquareHorizontal className="h-3.5 w-3.5" />
      </button>
      <button
        onClick={() => splitPane(paneId, 'vertical', { type: 'agent' as const, agentId: '', label: '' })}
        className="text-[#c9d1d9] hover:text-[#e6edf3] p-1 rounded hover:bg-[#21262d]"
        title="Split down"
      >
        <SplitSquareVertical className="h-3.5 w-3.5" />
      </button>
    </>
  );
}

function renderTabContent(tab: PaneTab, sessionId: string, paneId: string, isSingleTab: boolean) {
  if (tab.type === 'agent' && !tab.agentId) {
    // Empty agent slot — show drop zone
    return (
      <div className="flex items-center justify-center h-full flex-col gap-3 text-[#6e7681]">
        <div className="text-4xl opacity-20">⊞</div>
        <p className="text-xs">Drop an agent here from the sidebar</p>
      </div>
    );
  }

  if (tab.type === 'agent') {
    return (
      <AgentView
        sessionId={sessionId}
        agentId={tab.agentId}
        activeSubTab={tab.activeSubTab || 'conversation'}
        paneId={paneId}
        isSingleTab={isSingleTab}
        onSubTabChange={subTab => {
          const store = useWorkspaceStore.getState();
          store.updateTabState(paneId, `agent:${tab.agentId}`, { activeSubTab: subTab });
          const layout = store.layout;
          if (layout) {
            store.setLayout(updateTabSubTab(layout, paneId, tab.agentId, subTab));
          }
        }}
      />
    );
  }
  // Execution timeline
  if (tab.type === 'timeline') {
    const { ExecutionTimeline } = require('@/components/session/execution-timeline');
    return <ExecutionTimeline sessionId={sessionId} paneId={paneId} isSingleTab={isSingleTab} />;
  }

  // Agent hierarchy graph
  if (tab.type === 'graph') {
    const { AgentHierarchyGraph } = require('@/components/session/agent-hierarchy-graph');
    return <AgentHierarchyGraph sessionId={sessionId} paneId={paneId} isSingleTab={isSingleTab} />;
  }

  // Session-wide artifact explorer
  if (tab.type === 'artifacts') {
    const { SessionArtifactsPane } = require('@/components/session/session-artifacts-pane');
    return <SessionArtifactsPane sessionId={sessionId} paneId={paneId} isSingleTab={isSingleTab} />;
  }

  // Artifact content pane
  if (tab.type === 'artifact-content') {
    const { ArtifactPaneView } = require('@/components/agent/artifact-pane-view');
    return <ArtifactPaneView artifactId={tab.artifactId} />;
  }

  // Cross-agent search
  if (tab.type === 'search') {
    const { CrossAgentSearch } = require('@/components/session/cross-agent-search');
    return <CrossAgentSearch sessionId={sessionId} paneId={paneId} isSingleTab={isSingleTab} />;
  }

  // Context flow view
  if (tab.type === 'context-flow') {
    const { ContextFlow } = require('@/components/session/context-flow');
    return <ContextFlow sessionId={sessionId} paneId={paneId} isSingleTab={isSingleTab} />;
  }

  // Agent comparison
  if (tab.type === 'comparison') {
    const { ComparisonView } = require('@/components/agent/comparison-view');
    return <ComparisonView sessionId={sessionId} agentAId={tab.agentAId} agentBId={tab.agentBId} paneId={paneId} />;
  }

  // Workflow visualization
  if (tab.type === 'workflow') {
    const { AgentHierarchyGraph } = require('@/components/session/agent-hierarchy-graph');
    return <AgentHierarchyGraph sessionId={sessionId} paneId={paneId} isSingleTab={isSingleTab} showWorkflowPhases />;
  }

  return (
    <div className="flex items-center justify-center h-full text-[#6e7681] text-sm">
      {tab.type} view
    </div>
  );
}

// ─── Agent Picker Dropdown ─────────────────────────────────────────────────────

function AgentPickerDropdown({
  paneId,
  existingTabs,
  onClose,
}: {
  paneId: string;
  existingTabs: PaneTab[];
  onClose: () => void;
}) {
  const { addTabToPane } = useWorkspaceStore();
  const { session } = useSessionStore();
  const [search, setSearch] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  // Agents not already open in this pane
  const openAgentIds = new Set(existingTabs.filter(t => t.type === 'agent').map(t => (t as { agentId: string }).agentId));
  const available = (session?.agents ?? []).filter(a => !openAgentIds.has(a.id));

  const filtered = search.trim()
    ? available.filter(a => {
        const { name } = getAgentDisplay(a);
        return name.toLowerCase().includes(search.toLowerCase()) ||
          (a.subagentType || '').toLowerCase().includes(search.toLowerCase());
      })
    : available;

  const addAgent = (agentId: string, label: string) => {
    addTabToPane(paneId, { type: 'agent', agentId, label });
    onClose();
  };

  return (
    <>
      <div className="fixed inset-0 z-40" onClick={onClose} />
      <div className="absolute left-0 top-full z-50 mt-0.5 bg-[#161b22] border border-[#30363d] rounded-md shadow-xl w-64">
        <div className="flex items-center gap-1.5 px-2 py-1.5 border-b border-[#21262d]">
          <Search className="h-3 w-3 text-[#484f58] shrink-0" />
          <input
            ref={inputRef}
            type="text"
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Search agents…"
            className="flex-1 text-xs bg-transparent text-[#e6edf3] placeholder-[#484f58] outline-none"
            onKeyDown={e => { if (e.key === 'Escape') onClose(); }}
          />
        </div>
        <div className="max-h-52 overflow-y-auto py-1">
          {filtered.length === 0 ? (
            <div className="px-3 py-3 text-xs text-[#6e7681] text-center">
              {available.length === 0 ? 'All agents are already open' : 'No matching agents'}
            </div>
          ) : (
            filtered.map(agent => {
              const { shortName, color, initials } = getAgentDisplay(agent);
              return (
                <button
                  key={agent.id}
                  onClick={() => addAgent(agent.id, shortName)}
                  className="w-full flex items-center gap-2 px-2 py-1.5 hover:bg-[#21262d] transition-colors text-left"
                >
                  <div
                    className="w-5 h-5 rounded flex items-center justify-center text-[8px] font-bold shrink-0 border"
                    style={{ backgroundColor: color.bg, color: color.text, borderColor: color.border }}
                  >
                    {initials.slice(0, 2)}
                  </div>
                  <span className="text-xs text-[#c9d1d9] truncate flex-1">{shortName}</span>
                  <span className={cn('text-[8px] px-1 rounded shrink-0',
                    agent.status === 'completed' ? 'text-[#3fb950] bg-[#3fb950]/10' :
                    agent.status === 'running'   ? 'text-[#58a6ff] bg-[#58a6ff]/10' :
                    'text-[#8b949e] bg-[#21262d]'
                  )}>
                    {agent.status[0].toUpperCase()}
                  </span>
                </button>
              );
            })
          )}
        </div>
        <div className="border-t border-[#21262d] px-2 py-1 flex flex-wrap gap-1">
          {([
            { type: 'timeline' as const, label: 'Timeline' },
            { type: 'graph' as const, label: 'Graph' },
            { type: 'artifacts' as const, label: 'Files' },
            { type: 'search' as const, label: 'Search' },
            { type: 'context-flow' as const, label: 'Flow' },
            { type: 'workflow' as const, label: 'Workflow' },
          ] as const).map(({ type, label }) => (
            <button
              key={type}
              onClick={() => { addTabToPane(paneId, { type, label }); onClose(); }}
              className="flex-1 text-[10px] py-1 rounded text-[#8b949e] hover:text-[#e6edf3] hover:bg-[#21262d] transition-colors min-w-[40px]"
            >
              {label}
            </button>
          ))}
        </div>
      </div>
    </>
  );
}

function updateTabSubTab(
  node: import('@/types/workspace').LayoutNode,
  paneId: string,
  agentId: string,
  subTab: import('@/types/workspace').AgentSubTab
): import('@/types/workspace').LayoutNode {
  if (node.type === 'pane' && node.id === paneId) {
    return {
      ...node,
      tabs: node.tabs.map(t =>
        t.type === 'agent' && t.agentId === agentId ? { ...t, activeSubTab: subTab } : t
      ),
    };
  }
  if (node.type === 'split') {
    return {
      ...node,
      children: [
        updateTabSubTab(node.children[0], paneId, agentId, subTab),
        updateTabSubTab(node.children[1], paneId, agentId, subTab),
      ],
    };
  }
  return node;
}
