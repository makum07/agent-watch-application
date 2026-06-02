'use client';

import { useState } from 'react';
import { ChevronLeft, ChevronRight, ChevronDown, Users, Search, GripVertical, Clock, Zap } from 'lucide-react';
import { ScrollArea } from '@/components/ui/scroll-area';
import { useWorkspaceStore } from '@/store/workspace-store';
import { useSessionStore } from '@/store/session-store';
import { cn, formatTokens, formatDuration } from '@/lib/utils';
import { getAgentDisplay } from '@/lib/agent-display';
import type { Agent } from '@/types/session';
import type { PaneTab, LayoutNode } from '@/types/workspace';
import type { PanelImperativeHandle } from 'react-resizable-panels';

interface AgentSidebarProps {
  sessionId: string;
  panelRef?: React.RefObject<PanelImperativeHandle | null>;
}

/**
 * Group subagents into "rounds" based on time gaps.
 * If two consecutive agents (sorted by startTime) have a gap > GAP_MS between them,
 * they belong to different rounds.
 */
function groupAgentsByRound(agents: Agent[], GAP_MS = 15 * 60 * 1000): Agent[][] {
  const subagents = agents
    .filter(a => a.type !== 'orchestrator')
    .sort((a, b) => new Date(a.startTime).getTime() - new Date(b.startTime).getTime());

  if (subagents.length === 0) return [];

  const groups: Agent[][] = [[subagents[0]]];

  for (let i = 1; i < subagents.length; i++) {
    const prev = new Date(subagents[i - 1].startTime).getTime();
    const curr = new Date(subagents[i].startTime).getTime();
    if (curr - prev > GAP_MS) {
      groups.push([subagents[i]]);
    } else {
      groups[groups.length - 1].push(subagents[i]);
    }
  }

  return groups;
}

const ROUND_COLORS = [
  { border: '#2d5a8c', bg: '#1c3556', text: '#58a6ff', label: 'Round' },
  { border: '#2d6b47', bg: '#1a3d2a', text: '#39d353', label: 'Round' },
  { border: '#6b4a1a', bg: '#3d2a0e', text: '#f0883e', label: 'Round' },
  { border: '#4d3470', bg: '#2d1f45', text: '#bc8cff', label: 'Round' },
  { border: '#6b3530', bg: '#3d1f1a', text: '#ff9a85', label: 'Round' },
];

export function AgentSidebar({ sessionId, panelRef }: AgentSidebarProps) {
  const { sidebarCollapsed, setSidebarCollapsed, addTabToPane, setLayout, focusedPaneId, layout } = useWorkspaceStore();
  const { session, agentMap } = useSessionStore();
  const [search, setSearch] = useState('');
  const [collapsedRounds, setCollapsedRounds] = useState<Set<number>>(new Set());

  const orchestrator = session?.agents.find(a => a.type === 'orchestrator');
  const rounds = session ? groupAgentsByRound(session.agents) : [];

  const toggleRound = (i: number) => {
    setCollapsedRounds(prev => {
      const next = new Set(prev);
      if (next.has(i)) next.delete(i);
      else next.add(i);
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

  // Search filters across all agents
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
          onClick={() => panelRef?.current?.expand()}
          className="mt-3 p-1.5 text-[#8b949e] hover:text-[#e6edf3] hover:bg-[#21262d] rounded"
        >
          <ChevronRight className="h-4 w-4" />
        </button>
        <div className="mt-4 text-[10px] text-[#484f58]" style={{ writingMode: 'vertical-lr', transform: 'rotate(180deg)' }}>
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
            <button onClick={() => panelRef?.current?.collapse()} className="text-[#8b949e] hover:text-[#e6edf3] p-0.5 rounded shrink-0">
              <ChevronLeft className="h-3.5 w-3.5" />
            </button>
          </div>
          <div className="flex items-center gap-3 text-[11px] text-[#8b949e]">
            <span className="flex items-center gap-1"><Users className="h-3 w-3" />{session.totalAgents}</span>
            <span className="flex items-center gap-1"><Zap className="h-3 w-3" />{formatTokens(session.totalTokens)}</span>
            <span className="flex items-center gap-1"><Clock className="h-3 w-3" />{formatDuration(session.duration.wallClock)}</span>
          </div>
        </div>
      )}

      {/* Search */}
      <div className="px-2 py-2 border-b border-[#21262d]">
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
      </div>

      <ScrollArea className="flex-1">
        <div className="py-1">
          {/* Orchestrator — always at top */}
          {orchestrator && (!hasSearch || matchSearch(orchestrator)) && (
            <AgentRow agent={orchestrator} onOpen={openAgent} isOrchestrator />
          )}

          {/* When searching, show flat filtered list */}
          {hasSearch ? (
            session?.agents.filter(a => a.type !== 'orchestrator' && matchSearch(a)).map(agent => (
              <AgentRow key={agent.id} agent={agent} onOpen={openAgent} />
            ))
          ) : (
            /* Normal view: rounds with collapsible groups */
            rounds.map((roundAgents, ri) => {
              const color = ROUND_COLORS[ri % ROUND_COLORS.length];
              const isCollapsed = collapsedRounds.has(ri);
              const totalTokens = roundAgents.reduce((s, a) => s + a.tokenUsage.total, 0);

              return (
                <div key={ri} className="mb-1">
                  {/* Round header */}
                  <button
                    onClick={() => toggleRound(ri)}
                    className="w-full flex items-center gap-2 px-3 py-2 hover:bg-[#161b22] transition-colors group"
                  >
                    {/* Round label */}
                    <div
                      className="flex items-center gap-1.5 px-2 py-0.5 rounded text-[10px] font-bold tracking-wide"
                      style={{ backgroundColor: color.bg, color: color.text, border: `1px solid ${color.border}` }}
                    >
                      <span>Round {ri + 1}</span>
                    </div>

                    {/* Count + tokens */}
                    <span className="text-[10px] text-[#484f58]">
                      {roundAgents.length} agent{roundAgents.length !== 1 ? 's' : ''}
                    </span>
                    <span className="text-[10px] text-[#484f58] ml-auto">
                      {formatTokens(totalTokens)}
                    </span>

                    <ChevronDown
                      className={cn('h-3 w-3 text-[#484f58] transition-transform shrink-0', isCollapsed && '-rotate-90')}
                    />
                  </button>

                  {/* Agents in this round */}
                  {!isCollapsed && (
                    <div
                      className="ml-3 border-l-2 pl-0"
                      style={{ borderColor: color.border }}
                    >
                      {roundAgents.map(agent => (
                        <AgentRow key={agent.id} agent={agent} onOpen={openAgent} indented />
                      ))}
                    </div>
                  )}
                </div>
              );
            })
          )}

          {session?.agents.length === 0 && (
            <div className="px-3 py-4 text-xs text-[#484f58] text-center">Loading agents…</div>
          )}
        </div>
      </ScrollArea>

      {/* Drag hint */}
      <div className="px-3 py-2 border-t border-[#21262d]">
        <div className="flex items-center gap-1.5 text-[10px] text-[#484f58]">
          <GripVertical className="h-3 w-3" />
          Drag into panes · click to open
        </div>
      </div>
    </div>
  );
}

function AgentRow({
  agent,
  onOpen,
  isOrchestrator = false,
  indented = false,
}: {
  agent: Agent;
  onOpen: (a: Agent) => void;
  isOrchestrator?: boolean;
  indented?: boolean;
}) {
  const { name, shortName, typeLabel, color, initials } = getAgentDisplay(agent);

  const handleDragStart = (e: React.DragEvent) => {
    e.dataTransfer.setData('agentId', agent.id);
    e.dataTransfer.setData('agentLabel', shortName);
    e.dataTransfer.effectAllowed = 'move';
  };

  return (
    <div
      className={cn(
        'group flex items-center gap-2 py-2 pr-3 hover:bg-[#161b22] cursor-pointer transition-colors border-b border-[#0d1117]',
        isOrchestrator && 'border-b-2 border-b-[#21262d] mb-1',
      )}
      style={{ paddingLeft: indented ? '12px' : '8px' }}
      draggable
      onDragStart={handleDragStart}
      onClick={() => onOpen(agent)}
    >
      {/* Color avatar */}
      <div
        className="w-7 h-7 rounded-md flex items-center justify-center text-[10px] font-bold shrink-0 border"
        style={{ backgroundColor: color.bg, color: color.text, borderColor: color.border }}
      >
        {initials}
      </div>

      {/* Info */}
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-1.5 mb-0.5">
          <span className="text-xs font-semibold text-[#e6edf3] truncate leading-tight">{name}</span>
          <span className={cn(
            'text-[9px] px-1 py-0.5 rounded shrink-0 font-medium ml-auto',
            agent.status === 'completed' ? 'text-[#3fb950] bg-[#3fb950]/10' :
            agent.status === 'running'   ? 'text-[#58a6ff] bg-[#58a6ff]/10' :
            agent.status === 'errored'   ? 'text-[#f85149] bg-[#f85149]/10' :
            'text-[#8b949e] bg-[#21262d]'
          )}>
            {agent.status}
          </span>
        </div>
        <div className="flex items-center gap-2 text-[10px] text-[#484f58]">
          <span className="font-mono">{agent.model?.replace('claude-', '').slice(0, 12) || '—'}</span>
          <span>{formatTokens(agent.tokenUsage.total)}</span>
          <span>{formatDuration(agent.durationMs)}</span>
        </div>
      </div>

      {/* Drag handle */}
      <GripVertical className="h-3.5 w-3.5 text-[#484f58] shrink-0 opacity-0 group-hover:opacity-100 cursor-grab" />
    </div>
  );
}

function getFirstPaneId(node: LayoutNode): string | null {
  if (node.type === 'pane') return node.id;
  return getFirstPaneId(node.children[0]);
}
