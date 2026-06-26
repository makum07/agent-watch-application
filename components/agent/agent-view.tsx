'use client';

import { useState, useRef, useEffect } from 'react';
import { X, SplitSquareHorizontal, SplitSquareVertical, Columns2, Search } from 'lucide-react';
import { ConversationTab } from './conversation-tab';
import { ArtifactsTab } from './artifacts-tab';
import { ContextTab } from './context-tab';
import { ToolsTab } from './tools-tab';
import { SummaryTab } from './summary-tab';
import { FeedbackTab } from './feedback-tab';
import { useFeedbackStore } from '@/store/feedback-store';
import { useSessionStore } from '@/store/session-store';
import { useWorkspaceStore } from '@/store/workspace-store';
import { cn, formatTokens, formatDuration, formatCost, estimateAgentCost } from '@/lib/utils';
import { getAgentDisplay, getStatusDisplay } from '@/lib/agent-display';
import { findOtherPane, getFirstPaneId } from '@/lib/workspace-utils';
import type { AgentSubTab } from '@/types/workspace';

interface AgentViewProps {
  sessionId: string;
  agentId: string;
  paneId: string;
  isSingleTab?: boolean;
  activeSubTab?: AgentSubTab;
  onSubTabChange?: (tab: AgentSubTab) => void;
}

const TABS: { id: AgentSubTab; label: string }[] = [
  { id: 'conversation', label: 'Conversation' },
  { id: 'artifacts', label: 'Artifacts' },
  { id: 'context', label: 'Context' },
  { id: 'tools', label: 'Tools' },
  { id: 'summary', label: 'Summary' },
  { id: 'feedback', label: 'Feedback' },
];

export function AgentView({ sessionId, agentId, paneId, isSingleTab, activeSubTab = 'conversation', onSubTabChange }: AgentViewProps) {
  const agent = useSessionStore(s => s.agentMap.get(agentId));
  const session = useSessionStore(s => s.session);
  const agentMap = useSessionStore(s => s.agentMap);
  const { closePane, splitPane } = useWorkspaceStore();
  const feedbackCount = useFeedbackStore(s => s.items.filter(i => i.agentId === agentId).length);
  const [showCompareMenu, setShowCompareMenu] = useState(false);
  const [compareSearch, setCompareSearch] = useState('');
  const compareInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (showCompareMenu) compareInputRef.current?.focus();
  }, [showCompareMenu]);

  if (!agent) {
    return (
      <div className="flex items-center justify-center h-full text-[var(--aw-text-2)] text-sm">
        Agent not found
      </div>
    );
  }

  const { name, typeLabel, color } = getAgentDisplay(agent);
  const status = getStatusDisplay(agent);
  const toolCount = agent.toolCalls.reduce((s, t) => s + t.count, 0);
  const artifactCount = agent.toolCalls
    .filter(t => t.name === 'Write' || t.name === 'Edit' || t.name === 'NotebookEdit')
    .reduce((s, t) => s + t.count, 0);

  return (
    <div className="flex flex-col h-full overflow-hidden bg-[var(--aw-bg-0)]">
      {/* Pane header — agent identity */}
      <div className="shrink-0 border-b border-[var(--aw-bg-2)]">

        {/* Top row: colored name + controls */}
        <div className="flex items-center gap-2.5 px-3 py-2 bg-[var(--aw-bg-1)]">
          {/* Color swatch */}
          <div
            className="w-2.5 h-2.5 rounded-sm shrink-0"
            style={{ backgroundColor: color.text, boxShadow: `0 0 6px ${color.text}60` }}
          />
          {/* Agent identity — resolved agent name primary, task description secondary */}
          <div className="flex-1 min-w-0">
            <span
              className="text-sm font-bold break-words leading-snug"
              style={{ color: color.text }}
            >
              {name}
            </span>
            {agent.description && agent.description !== name && (
              <div className="text-[11px] text-[var(--aw-text-2)] truncate leading-snug" title={agent.description}>
                {agent.description}
              </div>
            )}
          </div>
          {/* Controls */}
          <div className="flex items-center gap-0.5 shrink-0 relative">
            <button
              onClick={() => splitPane(paneId, 'horizontal', { type: 'agent', agentId: '', label: '' })}
              className="p-1.5 rounded text-[var(--aw-text-1)] hover:text-[var(--aw-text-0)] hover:bg-[var(--aw-bg-2)] transition-colors"
              title="Split right"
            >
              <SplitSquareHorizontal className="h-3.5 w-3.5" />
            </button>
            <button
              onClick={() => splitPane(paneId, 'vertical', { type: 'agent', agentId: '', label: '' })}
              className="p-1.5 rounded text-[var(--aw-text-1)] hover:text-[var(--aw-text-0)] hover:bg-[var(--aw-bg-2)] transition-colors"
              title="Split down"
            >
              <SplitSquareVertical className="h-3.5 w-3.5" />
            </button>
            <button
              onClick={() => setShowCompareMenu(v => !v)}
              className="p-1.5 rounded text-[var(--aw-text-1)] hover:text-[var(--aw-text-0)] hover:bg-[var(--aw-bg-2)] transition-colors"
              title="Compare with another agent"
            >
              <Columns2 className="h-3.5 w-3.5" />
            </button>
            <button
              onClick={() => closePane(paneId)}
              className="p-1.5 rounded text-[var(--aw-text-1)] hover:text-[var(--aw-text-0)] hover:bg-[var(--aw-bg-2)] transition-colors"
              title="Close pane"
            >
              <X className="h-3.5 w-3.5" />
            </button>

            {/* Compare picker dropdown */}
            {showCompareMenu && (
              <>
                <div className="fixed inset-0 z-40" onClick={() => setShowCompareMenu(false)} />
                <div className="absolute right-0 top-full z-50 mt-0.5 bg-[var(--aw-bg-1)] border border-[var(--aw-bg-3)] rounded-md shadow-xl w-56">
                  <div className="flex items-center gap-1.5 px-2 py-1.5 border-b border-[var(--aw-bg-2)]">
                    <Search className="h-3 w-3 text-[var(--aw-text-4)] shrink-0" />
                    <input
                      ref={compareInputRef}
                      type="text"
                      value={compareSearch}
                      onChange={e => setCompareSearch(e.target.value)}
                      placeholder="Pick agent to compare…"
                      className="flex-1 text-xs bg-transparent text-[var(--aw-text-0)] placeholder-[var(--aw-text-4)] outline-none"
                      onKeyDown={e => { if (e.key === 'Escape') setShowCompareMenu(false); }}
                    />
                  </div>
                  <div className="max-h-48 overflow-y-auto py-1">
                    {(session?.agents ?? [])
                      .filter(a => a.id !== agentId)
                      .filter(a => {
                        if (!compareSearch.trim()) return true;
                        const { name } = getAgentDisplay(a);
                        return name.toLowerCase().includes(compareSearch.toLowerCase());
                      })
                      .map(a => {
                        const { shortName, color, initials } = getAgentDisplay(a);
                        return (
                          <button
                            key={a.id}
                            onClick={() => {
                              const store = useWorkspaceStore.getState();
                              const l = store.layout;
                              if (!l) return;
                              const tab = { type: 'comparison' as const, agentAId: agentId, agentBId: a.id, label: 'Compare' };
                              const other = findOtherPane(l, paneId);
                              store.addTabToPane(other ?? paneId, tab);
                              setShowCompareMenu(false);
                              setCompareSearch('');
                            }}
                            className="w-full flex items-center gap-2 px-2 py-1.5 hover:bg-[var(--aw-bg-2)] transition-colors text-left"
                          >
                            <div className="w-5 h-5 rounded flex items-center justify-center text-[8px] font-bold shrink-0 border" style={{ backgroundColor: color.bg, color: color.text, borderColor: color.border }}>
                              {initials.slice(0, 2)}
                            </div>
                            <span className="text-xs text-[var(--aw-text-1)] truncate flex-1">{shortName}</span>
                          </button>
                        );
                      })
                    }
                  </div>
                </div>
              </>
            )}
          </div>
        </div>

        {/* Second row: metadata strip */}
        <div
          className="flex items-center gap-3 px-3 py-1 text-[11px]"
          style={{ backgroundColor: `${color.bg}60` }}
        >
          <span
            className="px-1.5 py-0.5 rounded text-[10px] font-medium"
            style={{ backgroundColor: color.bg, color: color.text, border: `1px solid ${color.border}` }}
          >
            {typeLabel}
          </span>
          <span className="text-[var(--aw-text-1)] font-mono">{agent.model?.replace('claude-', '') || '—'}</span>
          <span className="text-[var(--aw-text-1)]">{formatTokens(agent.tokenUsage.total)}</span>
          <span className="text-[var(--aw-text-1)]">{formatDuration(agent.durationMs)}</span>
          <span
            className="ml-auto px-1.5 py-0.5 rounded text-[10px] font-medium"
            style={{ color: status.hex, backgroundColor: `${status.hex}1a` }}
            title={status.title}
          >
            {status.label}
          </span>
        </div>

        {/* Tab rail — scrolls horizontally when the pane is narrow instead of clipping */}
        <div className="flex items-center px-1 bg-[var(--aw-bg-0)] border-t border-[var(--aw-bg-2)] overflow-x-auto">
          {TABS.map(tab => {
            const isActive = activeSubTab === tab.id;
            const count = tab.id === 'tools' ? toolCount : tab.id === 'artifacts' ? artifactCount : 0;
            return (
              <button
                key={tab.id}
                onClick={() => onSubTabChange?.(tab.id)}
                className={cn(
                  'flex items-center gap-1 px-3 py-2 text-xs transition-colors border-b-2 shrink-0 whitespace-nowrap',
                  isActive
                    ? 'border-b-2 font-medium'
                    : 'text-[var(--aw-text-2)] border-transparent hover:text-[var(--aw-text-0)] hover:border-[var(--aw-text-2)]'
                )}
                style={isActive ? { color: color.text, borderColor: color.text } : {}}
              >
                {tab.label}
                {count > 0 && (
                  <span
                    className="text-[10px] px-1 rounded-full font-medium"
                    style={isActive ? { backgroundColor: `${color.bg}`, color: color.text } : { backgroundColor: 'var(--aw-bg-2)', color: 'var(--aw-text-2)' }}
                  >
                    {count}
                  </span>
                )}
                {tab.id === 'feedback' && feedbackCount > 0 && count === 0 && (
                  <span className="text-[10px] px-1 rounded-full font-medium bg-[var(--aw-blue)]/15 text-[var(--aw-blue)]">
                    {feedbackCount}
                  </span>
                )}
              </button>
            );
          })}
        </div>
      </div>

      {/* Tab content */}
      <div className="flex-1 overflow-hidden min-h-0">
        {activeSubTab === 'conversation' && <ConversationTab sessionId={sessionId} agentId={agentId} paneId={paneId} />}
        {activeSubTab === 'artifacts'    && <ArtifactsTab sessionId={sessionId} agentId={agentId} />}
        {activeSubTab === 'context'      && <ContextTab agent={agent} paneId={paneId} />}
        {activeSubTab === 'tools'        && <ToolsTab sessionId={sessionId} agentId={agentId} />}
        {activeSubTab === 'summary'      && <SummaryTab agent={agent} />}
        {activeSubTab === 'feedback'     && <FeedbackTab sessionId={sessionId} agentId={agentId} />}
      </div>

      {/* Persistent stats footer */}
      <div className="shrink-0 border-t border-[var(--aw-bg-2)] bg-[var(--aw-bg-0)] px-3 py-1.5 flex items-center gap-0 text-[11px] overflow-hidden">
        <StatPill label="in" value={formatTokens(agent.tokenUsage.input)} />
        <Dot />
        <StatPill label="out" value={formatTokens(agent.tokenUsage.output)} />
        {agent.tokenUsage.cacheRead > 0 && (
          <>
            <Dot />
            <StatPill label="cache" value={formatTokens(agent.tokenUsage.cacheRead)} />
          </>
        )}
        <Dot />
        <StatPill label="dur" value={formatDuration(agent.durationMs)} />
        <Dot />
        <StatPill label="msgs" value={String(agent.messageCount)} />
        {toolCount > 0 && (
          <>
            <Dot />
            <StatPill label="tools" value={String(toolCount)} />
          </>
        )}
        <Dot />
        <StatPill
          label="~cost"
          value={formatCost(estimateAgentCost(agent.tokenUsage, agent.model ?? 'sonnet'))}
          highlight
        />
      </div>
    </div>
  );
}

function StatPill({ label, value, highlight }: { label: string; value: string; highlight?: boolean }) {
  return (
    <span className="flex items-center gap-1 px-1.5 py-0.5">
      <span className="text-[var(--aw-text-2)]">{label}</span>
      <span className={cn('font-mono', highlight ? 'text-[var(--aw-orange)]' : 'text-[var(--aw-text-1)]')}>{value}</span>
    </span>
  );
}

function Dot() {
  return <span className="text-[var(--aw-bg-3)] select-none">·</span>;
}
