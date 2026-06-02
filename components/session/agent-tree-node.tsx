'use client';

import { useState } from 'react';
import { ChevronRight, GripVertical } from 'lucide-react';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { cn, formatTokens } from '@/lib/utils';
import { useWorkspaceStore } from '@/store/workspace-store';
import { useSessionStore } from '@/store/session-store';
import type { Agent } from '@/types/session';
import type { PaneTab, LayoutNode } from '@/types/workspace';

const AGENT_COLORS: Record<string, { bg: string; text: string; dot: string }> = {
  Explore:          { bg: '#3fb950/15', text: '#3fb950', dot: '#3fb950' },
  Plan:             { bg: '#f0883e/15', text: '#f0883e', dot: '#f0883e' },
  'general-purpose':{ bg: '#bc8cff/15', text: '#bc8cff', dot: '#bc8cff' },
  'code-reviewer':  { bg: '#f85149/15', text: '#f85149', dot: '#f85149' },
  orchestrator:     { bg: '#58a6ff/15', text: '#58a6ff', dot: '#58a6ff' },
  workflow:         { bg: '#39d353/15', text: '#39d353', dot: '#39d353' },
};

function getAgentColor(subagentType: string | null, type: string) {
  return AGENT_COLORS[subagentType || ''] || AGENT_COLORS[type] || { bg: '#8b949e/15', text: '#8b949e', dot: '#8b949e' };
}

interface AgentTreeNodeProps {
  agent: Agent;
  depth: number;
  sessionId: string;
}

export function AgentTreeNode({ agent, depth, sessionId }: AgentTreeNodeProps) {
  const [isOpen, setIsOpen] = useState(depth < 2);
  const hasChildren = agent.children.length > 0;
  const { addTabToPane, setLayout, focusedPaneId, layout } = useWorkspaceStore();
  const { agentMap } = useSessionStore();

  const childAgents = agent.children.map(id => agentMap.get(id)).filter(Boolean) as Agent[];
  const color = getAgentColor(agent.subagentType, agent.type);
  const label = agent.subagentType || (agent.depth === 0 ? 'Orchestrator' : 'Agent');
  const shortDesc = agent.description?.slice(0, 32) || '';

  const handleDragStart = (e: React.DragEvent) => {
    e.dataTransfer.setData('agentId', agent.id);
    e.dataTransfer.setData('agentLabel', shortDesc || label);
    e.dataTransfer.effectAllowed = 'move';
  };

  const openInPane = () => {
    const tab: PaneTab = {
      type: 'agent',
      agentId: agent.id,
      label: shortDesc?.slice(0, 25) || label,
    };

    if (focusedPaneId && layout) {
      addTabToPane(focusedPaneId, tab);
    } else if (layout) {
      addTabToPane(getFirstPaneId(layout)!, tab);
    } else {
      setLayout({ type: 'pane', id: 'main', tabs: [tab], activeTab: 0 });
    }
  };

  return (
    <Collapsible open={isOpen} onOpenChange={setIsOpen}>
      <div
        className={cn(
          'group flex items-center gap-1.5 py-1.5 pr-2 cursor-pointer select-none',
          'hover:bg-[#21262d] rounded mx-1 transition-colors'
        )}
        style={{ paddingLeft: `${depth * 14 + 8}px` }}
        draggable
        onDragStart={handleDragStart}
        onClick={openInPane}
      >
        {/* Drag handle */}
        <GripVertical className="h-3 w-3 text-[#484f58] shrink-0 opacity-0 group-hover:opacity-100 transition-opacity cursor-grab" />

        {/* Collapse toggle */}
        {hasChildren ? (
          <CollapsibleTrigger asChild onClick={e => e.stopPropagation()}>
            <button className="shrink-0 p-0">
              <ChevronRight className={cn(
                'h-3 w-3 text-[#484f58] transition-transform',
                isOpen && 'rotate-90'
              )} />
            </button>
          </CollapsibleTrigger>
        ) : (
          <div className="w-3 h-3 shrink-0 flex items-center justify-center">
            <div className="w-1 h-1 rounded-full" style={{ backgroundColor: color.dot }} />
          </div>
        )}

        {/* Agent info */}
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-1.5">
            <span
              className="text-[11px] font-medium px-1.5 py-0.5 rounded-sm shrink-0"
              style={{ color: color.text, backgroundColor: `color-mix(in srgb, ${color.dot} 15%, transparent)` }}
            >
              {label}
            </span>
            {shortDesc && (
              <span className="text-[11px] text-[#8b949e] truncate">{shortDesc}</span>
            )}
          </div>
          <div className="flex items-center gap-2 mt-0.5">
            {agent.model && (
              <span className="text-[10px] text-[#484f58] font-mono truncate">
                {agent.model.replace('claude-', '').slice(0, 12)}
              </span>
            )}
            <span className="text-[10px] text-[#484f58]">{formatTokens(agent.tokenUsage.total)}</span>
          </div>
        </div>
      </div>

      {hasChildren && (
        <CollapsibleContent>
          {childAgents.map(child => (
            <AgentTreeNode
              key={child.id}
              agent={child}
              depth={depth + 1}
              sessionId={sessionId}
            />
          ))}
        </CollapsibleContent>
      )}
    </Collapsible>
  );
}

function getFirstPaneId(node: LayoutNode): string | null {
  if (node.type === 'pane') return node.id;
  return getFirstPaneId(node.children[0]);
}
