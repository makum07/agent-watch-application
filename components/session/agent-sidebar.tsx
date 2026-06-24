'use client';

import { useState, useMemo } from 'react';
import { ChevronLeft, ChevronRight, ChevronDown, Users, Search, GripVertical, Clock, Zap, Files, Activity, GitFork, Network, List, CornerDownRight, BarChart3 } from 'lucide-react';
import { ScrollArea } from '@/components/ui/scroll-area';
import { useWorkspaceStore } from '@/store/workspace-store';
import { useSessionStore } from '@/store/session-store';
import { cn, formatTokens, formatDuration } from '@/lib/utils';
import { getAgentDisplay, getStatusDisplay } from '@/lib/agent-display';
import { ExportHierarchyMenu } from './export-hierarchy-menu';
import type { Agent } from '@/types/session';
import type { PaneTab, LayoutNode } from '@/types/workspace';
import type { PanelImperativeHandle } from 'react-resizable-panels';

type ViewMode = 'tree' | 'timeline';

interface AgentSidebarProps {
  sessionId: string;
  panelRef?: React.RefObject<PanelImperativeHandle | null>;
}

/** Flat chronological list of subagents (no artificial bucketing — just start order). */
function timelineAgents(agents: Agent[]): Agent[] {
  return agents
    .filter(a => a.type !== 'orchestrator')
    .sort((a, b) => new Date(a.startTime).getTime() - new Date(b.startTime).getTime());
}

function getSubtreeTokens(agent: Agent, agentMap: Map<string, Agent>): number {
  let total = agent.tokenUsage.total;
  for (const childId of agent.children) {
    const child = agentMap.get(childId);
    if (child) total += getSubtreeTokens(child, agentMap);
  }
  return total;
}

function getSubtreeAgentCount(agent: Agent, agentMap: Map<string, Agent>): number {
  let count = 0;
  for (const childId of agent.children) {
    const child = agentMap.get(childId);
    if (child) count += 1 + getSubtreeAgentCount(child, agentMap);
  }
  return count;
}

const DEPTH_COLORS = [
  '#58a6ff', // depth 0 — blue (orchestrator)
  '#bc8cff', // depth 1 — purple
  '#39d353', // depth 2 — green
  '#f0883e', // depth 3 — orange
  '#ff9a85', // depth 4+ — salmon
];

function getDepthColor(depth: number): string {
  return DEPTH_COLORS[Math.min(depth, DEPTH_COLORS.length - 1)];
}

function getParentLabel(parent: Agent): string {
  if (parent.type === 'orchestrator') return 'Orchestrator';
  // Use the parent's resolved identity (agent name) — not its task description
  const { name } = getAgentDisplay(parent);
  return name.length > 28 ? name.slice(0, 27) + '…' : name;
}

export function AgentSidebar({ sessionId, panelRef }: AgentSidebarProps) {
  const { sidebarCollapsed, setSidebarCollapsed, addTabToPane, setLayout, focusedPaneId, layout } = useWorkspaceStore();
  const { session, agentMap } = useSessionStore();
  const [search, setSearch] = useState('');
  const [viewMode, setViewMode] = useState<ViewMode>('tree');
  const [collapsedNodes, setCollapsedNodes] = useState<Set<string>>(new Set());

  const orchestrator = session?.agents.find(a => a.type === 'orchestrator');
  const timeline = session ? timelineAgents(session.agents) : [];

  const maxDepth = useMemo(() => {
    if (!session) return 0;
    return Math.max(...session.agents.map(a => a.depth));
  }, [session]);

  const toggleNode = (agentId: string) => {
    setCollapsedNodes(prev => {
      const next = new Set(prev);
      if (next.has(agentId)) next.delete(agentId);
      else next.add(agentId);
      return next;
    });
  };

  const openAgent = (agent: Agent) => {
    const { shortName } = getAgentDisplay(agent);
    const tab: PaneTab = { type: 'agent', agentId: agent.id, label: shortName };
    if (focusedPaneId && layout) addTabToPane(focusedPaneId, tab);
    else if (layout) addTabToPane(getFirstPaneId(layout)!, tab);
    else setLayout({ type: 'pane', id: 'main', tabs: [tab], activeTab: 0 });
  };

  const matchSearch = (agent: Agent) => {
    if (!search) return true;
    const { name } = getAgentDisplay(agent);
    return name.toLowerCase().includes(search.toLowerCase()) ||
      (agent.description || '').toLowerCase().includes(search.toLowerCase());
  };

  const hasSearch = !!search.trim();

  if (sidebarCollapsed) {
    return (
      <div className="flex flex-col items-center w-full h-full border-r border-[#30363d] bg-[#0d1117]">
        <button
          onClick={() => { panelRef?.current?.expand(); setSidebarCollapsed(false); }}
          className="mt-3 p-1.5 text-[#c9d1d9] hover:text-[#e6edf3] hover:bg-[#21262d] rounded"
          title="Expand sidebar"
        >
          <ChevronRight className="h-4 w-4" />
        </button>
        <div className="mt-4 text-[10px] text-[#6e7681]" style={{ writingMode: 'vertical-lr', transform: 'rotate(180deg)' }}>
          {session?.totalAgents ?? 0} agents
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col w-full h-full border-r border-[#30363d] bg-[#0d1117] overflow-hidden">
      {/* Session info header */}
      {session && (
        <div className="px-3 pt-3 pb-2 border-b border-[#21262d]">
          <div className="flex items-center justify-between mb-1">
            <span className="text-xs font-semibold text-[#e6edf3] truncate">
              {session.project.split(/[/\\]/).filter(Boolean).slice(-2).join('/')}
            </span>
            <button onClick={() => panelRef?.current?.collapse()} className="text-[#c9d1d9] hover:text-[#e6edf3] p-0.5 rounded shrink-0">
              <ChevronLeft className="h-3.5 w-3.5" />
            </button>
          </div>
          <div className="flex items-center gap-3 text-[11px] text-[#c9d1d9]">
            <span className="flex items-center gap-1"><Users className="h-3 w-3" />{session.totalAgents}</span>
            <span className="flex items-center gap-1"><Zap className="h-3 w-3" />{formatTokens(session.totalTokens)}</span>
            <span className="flex items-center gap-1"><Clock className="h-3 w-3" />{formatDuration(session.duration.wallClock)}</span>
          </div>
          {maxDepth > 1 && (
            <div className="flex items-center gap-1 mt-1.5 text-[10px] text-[#6e7681]">
              <Network className="h-3 w-3" />
              <span>{maxDepth} levels deep</span>
            </div>
          )}
        </div>
      )}

      {/* Search + View toggle */}
      <div className="px-2 py-2 border-b border-[#21262d] space-y-1.5">
        <div className="flex items-center gap-1.5 px-2 py-1.5 rounded bg-[#21262d] border border-[#30363d]">
          <Search className="h-3 w-3 text-[#484f58] shrink-0" />
          <input
            type="text"
            placeholder="Search agents…"
            value={search}
            onChange={e => setSearch(e.target.value)}
            className="flex-1 bg-transparent text-xs text-[#e6edf3] placeholder:text-[#484f58] outline-none"
          />
        </div>
        <div className="flex items-center gap-1.5">
          <div className="flex gap-0.5 p-0.5 rounded bg-[#161b22] border border-[#21262d] flex-1 min-w-0">
            <button
              onClick={() => setViewMode('tree')}
              className={cn(
                'flex-1 flex items-center justify-center gap-1 py-1 rounded text-[10px] font-medium transition-colors',
                viewMode === 'tree'
                  ? 'bg-[#21262d] text-[#e6edf3] shadow-sm'
                  : 'text-[#6e7681] hover:text-[#c9d1d9]'
              )}
            >
              <Network className="h-3 w-3" />
              Tree
            </button>
            <button
              onClick={() => setViewMode('timeline')}
              className={cn(
                'flex-1 flex items-center justify-center gap-1 py-1 rounded text-[10px] font-medium transition-colors',
                viewMode === 'timeline'
                  ? 'bg-[#21262d] text-[#e6edf3] shadow-sm'
                  : 'text-[#6e7681] hover:text-[#c9d1d9]'
              )}
              title="Subagents in start-time order"
            >
              <List className="h-3 w-3" />
              Sequence
            </button>
          </div>
          <ExportHierarchyMenu
            rootAgent={orchestrator ?? session?.agents[0]}
            agentMap={agentMap}
            collapsedNodes={collapsedNodes}
            title={session?.project.split(/[/\\]/).filter(Boolean).slice(-1)[0] || 'Session'}
          />
        </div>
      </div>

      {/* Force the Radix viewport's inner wrapper to block (it defaults to display:table,
          which shrink-to-fits the widest row and overflows the fixed-width sidebar). */}
      <ScrollArea className="flex-1 [&_[data-radix-scroll-area-viewport]>div]:!block">
        <div className="py-1">
          {/* When searching, show flat filtered list with parent attribution */}
          {hasSearch ? (
            session?.agents.filter(a => matchSearch(a)).map(agent => (
              <AgentRow
                key={agent.id}
                agent={agent}
                onOpen={openAgent}
                isOrchestrator={agent.type === 'orchestrator'}
                depth={0}
                agentMap={agentMap}
                showParentLabel
              />
            ))
          ) : viewMode === 'tree' ? (
            /* Tree view: recursive hierarchy */
            orchestrator && (
              <TreeNode
                agent={orchestrator}
                agentMap={agentMap}
                onOpen={openAgent}
                collapsedNodes={collapsedNodes}
                toggleNode={toggleNode}
                depth={0}
                isLast
                parentLineDepths={[]}
              />
            )
          ) : (
            /* Sequence view: orchestrator + subagents in start-time order, with parent attribution */
            <>
              {orchestrator && (
                <AgentRow agent={orchestrator} onOpen={openAgent} isOrchestrator agentMap={agentMap} />
              )}
              {timeline.map(agent => (
                <AgentRow
                  key={agent.id}
                  agent={agent}
                  onOpen={openAgent}
                  depth={Math.max(1, agent.depth)}
                  agentMap={agentMap}
                  showParentLabel
                />
              ))}
            </>
          )}

          {session?.agents.length === 0 && (
            <div className="px-3 py-4 text-xs text-[#484f58] text-center">Loading agents…</div>
          )}
        </div>
      </ScrollArea>

      {/* Session-level views */}
      <div className="px-2 py-1.5 border-t border-[#21262d] flex flex-wrap gap-1">
        {([
          { type: 'timeline',     label: 'Timeline', icon: <Activity className="h-3.5 w-3.5 text-[#58a6ff]" /> },
          { type: 'graph',        label: 'Graph',    icon: <GitFork  className="h-3.5 w-3.5 text-[#bc8cff]" /> },
          { type: 'artifacts',    label: 'Files',    icon: <Files    className="h-3.5 w-3.5 text-[#f0883e]" /> },
          { type: 'search',       label: 'Search',   icon: <Search   className="h-3.5 w-3.5 text-[#3fb950]" /> },
          { type: 'context-flow', label: 'Flow',     icon: <GitFork  className="h-3.5 w-3.5 text-[#39d353]" /> },
          { type: 'analytics',    label: 'Analytics', icon: <BarChart3 className="h-3.5 w-3.5 text-[#f778ba]" /> },
        ] as const).map(({ type, label, icon }) => {
          const tabLabels: Record<string, string> = {
            timeline: 'Timeline', graph: 'Agent Graph', artifacts: 'Session Files',
            search: 'Search', 'context-flow': 'Context Flow', analytics: 'Analytics',
          };
          return (
            <button
              key={type}
              onClick={() => {
                const store = useWorkspaceStore.getState();
                const tab: PaneTab = { type, label: tabLabels[type] ?? label } as PaneTab;
                if (store.focusedPaneId && store.layout) {
                  store.addTabToPane(store.focusedPaneId, tab);
                } else if (store.layout) {
                  store.addTabToPane(getFirstPaneId(store.layout)!, tab);
                } else {
                  store.setLayout({ type: 'pane', id: 'main', tabs: [tab], activeTab: 0 });
                }
              }}
              className="flex-1 flex items-center justify-center gap-1 px-1 py-1.5 rounded text-[10px] text-[#c9d1d9] hover:text-[#e6edf3] hover:bg-[#161b22] transition-colors min-w-[44px]"
              title={`Open ${label}`}
            >
              {icon}
              <span>{label}</span>
            </button>
          );
        })}
      </div>

      {/* Drag hint */}
      <div className="px-3 py-2 border-t border-[#21262d]">
        <div className="flex items-center gap-1.5 text-[10px] text-[#6e7681]">
          <GripVertical className="h-3 w-3" />
          Drag into panes · click to open
        </div>
      </div>
    </div>
  );
}

function TreeNode({
  agent,
  agentMap,
  onOpen,
  collapsedNodes,
  toggleNode,
  depth,
  isLast,
  parentLineDepths,
}: {
  agent: Agent;
  agentMap: Map<string, Agent>;
  onOpen: (a: Agent) => void;
  collapsedNodes: Set<string>;
  toggleNode: (id: string) => void;
  depth: number;
  isLast: boolean;
  parentLineDepths: number[];
}) {
  const children = agent.children
    .map(id => agentMap.get(id))
    .filter(Boolean) as Agent[];
  const hasChildren = children.length > 0;
  const isCollapsed = collapsedNodes.has(agent.id);
  const subtreeTokens = hasChildren ? getSubtreeTokens(agent, agentMap) : 0;
  const subtreeCount = hasChildren ? getSubtreeAgentCount(agent, agentMap) : 0;

  const sortedChildren = [...children].sort(
    (a, b) => new Date(a.startTime).getTime() - new Date(b.startTime).getTime()
  );

  return (
    <div>
      {/* The agent row itself */}
      <div className="relative">
        {/* Vertical continuation lines from ancestor levels */}
        {parentLineDepths.map(d => (
          <div
            key={d}
            className="absolute top-0 bottom-0 w-px"
            style={{
              left: 10 + d * 16,
              backgroundColor: '#3d444d',
            }}
          />
        ))}

        {/* Horizontal connector to this node from parent */}
        {depth > 0 && (
          <>
            <div
              className="absolute w-px"
              style={{
                left: 10 + (depth - 1) * 16,
                top: 0,
                height: '50%',
                backgroundColor: '#3d444d',
              }}
            />
            <div
              className="absolute h-px"
              style={{
                left: 10 + (depth - 1) * 16,
                top: '50%',
                width: 14,
                backgroundColor: '#3d444d',
              }}
            />
          </>
        )}

        <AgentRow
          agent={agent}
          onOpen={onOpen}
          isOrchestrator={agent.type === 'orchestrator'}
          depth={depth}
          agentMap={agentMap}
          hasChildren={hasChildren}
          isCollapsed={isCollapsed}
          onToggle={() => toggleNode(agent.id)}
          subtreeTokens={subtreeTokens}
          subtreeCount={subtreeCount}
          treeMode
        />
      </div>

      {/* Children */}
      {hasChildren && !isCollapsed && (
        <div className="relative">
          {/* Continuation lines from ancestor levels */}
          {parentLineDepths.map(d => (
            <div
              key={d}
              className="absolute top-0 bottom-0 w-px"
              style={{
                left: 10 + d * 16,
                backgroundColor: getDepthColor(d),
                opacity: 0.2,
              }}
            />
          ))}
          {/* This node's continuation line */}
          {!isLast && (
            <div
              className="absolute top-0 bottom-0 w-px"
              style={{
                left: 10 + (depth) * 16,
                backgroundColor: '#3d444d',
              }}
            />
          )}

          {sortedChildren.map((child, i) => {
            const childIsLast = i === sortedChildren.length - 1;
            const nextLineDepths = isLast
              ? [...parentLineDepths]
              : [...parentLineDepths, depth];
            // Only add current depth's line if it's not the last child
            if (!childIsLast || sortedChildren.length > 1) {
              // The depth line is drawn per-child in the TreeNode
            }
            return (
              <TreeNode
                key={child.id}
                agent={child}
                agentMap={agentMap}
                onOpen={onOpen}
                collapsedNodes={collapsedNodes}
                toggleNode={toggleNode}
                depth={depth + 1}
                isLast={childIsLast}
                parentLineDepths={isLast ? parentLineDepths : [...parentLineDepths, depth]}
              />
            );
          })}
        </div>
      )}
    </div>
  );
}

function AgentRow({
  agent,
  onOpen,
  isOrchestrator = false,
  depth = 0,
  agentMap,
  showParentLabel = false,
  hasChildren = false,
  isCollapsed = false,
  onToggle,
  subtreeTokens = 0,
  subtreeCount = 0,
  treeMode = false,
}: {
  agent: Agent;
  onOpen: (a: Agent) => void;
  isOrchestrator?: boolean;
  depth?: number;
  agentMap: Map<string, Agent>;
  showParentLabel?: boolean;
  hasChildren?: boolean;
  isCollapsed?: boolean;
  onToggle?: () => void;
  subtreeTokens?: number;
  subtreeCount?: number;
  treeMode?: boolean;
}) {
  const { name, shortName, color, initials } = getAgentDisplay(agent);

  const parentAgent = agent.parentId ? agentMap.get(agent.parentId) : null;

  const handleDragStart = (e: React.DragEvent) => {
    e.dataTransfer.setData('agentId', agent.id);
    e.dataTransfer.setData('agentLabel', shortName);
    e.dataTransfer.effectAllowed = 'move';
  };

  const paddingLeft = treeMode
    ? 6 + depth * 16 + (depth > 0 ? 14 : 0)
    : isOrchestrator ? 8 : 8 + depth * 12;

  const depthColor = getDepthColor(agent.depth);

  return (
    <div className={cn('border-b border-[#0d1117]', isOrchestrator && !treeMode && 'border-b-2 border-b-[#21262d] mb-1')}>
      <div
        className="group flex items-center gap-1.5 py-2 pr-2 hover:bg-[#161b22] cursor-grab active:cursor-grabbing select-none transition-colors"
        style={{ paddingLeft }}
        draggable
        onDragStart={handleDragStart}
        onClick={() => onOpen(agent)}
      >
        {/* Tree expand/collapse toggle */}
        {treeMode && hasChildren && (
          <button
            className="shrink-0 p-0.5 rounded hover:bg-[#30363d] transition-colors"
            onClick={e => { e.stopPropagation(); onToggle?.(); }}
          >
            <ChevronDown
              className={cn('h-3 w-3 transition-transform', isCollapsed && '-rotate-90')}
              style={{ color: depthColor }}
            />
          </button>
        )}
        {treeMode && !hasChildren && depth > 0 && (
          <div className="shrink-0 w-4" />
        )}

        {/* Depth connector line (sequence mode) */}
        {!treeMode && depth > 0 && (
          <div className="shrink-0 flex items-center self-stretch" style={{ width: 12, marginLeft: -8 }}>
            <div className="w-px h-full bg-[#30363d]" />
            <div className="w-2 h-px bg-[#30363d]" />
          </div>
        )}

        {/* Color avatar with depth ring */}
        <div className="relative shrink-0">
          <div
            className="w-7 h-7 rounded-md flex items-center justify-center text-[10px] font-bold border"
            style={{ backgroundColor: color.bg, color: color.text, borderColor: color.border }}
          >
            {initials}
          </div>
          {/* Depth indicator dot */}
          {treeMode && depth > 0 && (
            <div
              className="absolute -top-0.5 -right-0.5 w-2 h-2 rounded-full border border-[#0d1117]"
              style={{ backgroundColor: depthColor }}
              title={`Depth ${depth}`}
            />
          )}
        </div>

        {/* Info */}
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-1.5 min-w-0">
            <span className="text-xs font-semibold text-[#e6edf3] leading-tight truncate min-w-0 flex-1" title={name}>{name}</span>
            {hasChildren && treeMode && (
              <span
                className="text-[9px] px-1 py-0 rounded font-mono shrink-0"
                style={{ color: depthColor, backgroundColor: `${depthColor}15` }}
                title={`${subtreeCount} descendant${subtreeCount !== 1 ? 's' : ''} · ${formatTokens(subtreeTokens)} total`}
              >
                {subtreeCount}
              </span>
            )}
            {(() => {
              // Compact status dot — never clips, and green/amber/red still flags issues at a glance.
              const st = getStatusDisplay(agent);
              return (
                <span
                  className={cn('shrink-0 w-2 h-2 rounded-full', st.tone === 'running' && 'animate-pulse')}
                  style={{ backgroundColor: st.hex }}
                  title={st.title}
                />
              );
            })()}
          </div>

          {/* Parent attribution — only in flat (Sequence/Search) views; the tree shows parentage structurally */}
          {showParentLabel && !treeMode && parentAgent && agent.depth > 0 && (
            <div className="flex items-center gap-1 mt-0.5">
              <CornerDownRight className="h-2.5 w-2.5 shrink-0" style={{ color: getDepthColor(Math.max(0, depth - 1)) }} />
              <span
                className="text-[9px] truncate"
                style={{ color: getDepthColor(Math.max(0, depth - 1)) }}
              >
                from {getParentLabel(parentAgent)}
              </span>
            </div>
          )}

          <div className="flex items-center gap-2 text-[10px] text-[#c9d1d9] mt-0.5 whitespace-nowrap overflow-hidden">
            <span className="font-mono shrink-0">{agent.model?.replace('claude-', '').slice(0, 12) || '—'}</span>
            <span className="shrink-0">{formatTokens(agent.tokenUsage.total)}</span>
            <span className="shrink-0">{formatDuration(agent.durationMs)}</span>
          </div>
        </div>

        <GripVertical className="h-3.5 w-3.5 text-[#484f58] shrink-0 opacity-20 group-hover:opacity-100 transition-opacity" />
      </div>
    </div>
  );
}

function getFirstPaneId(node: LayoutNode): string | null {
  if (node.type === 'pane') return node.id;
  return getFirstPaneId(node.children[0]);
}
