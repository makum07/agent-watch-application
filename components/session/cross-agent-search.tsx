'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import { Search, Loader2, ChevronDown, ChevronRight, ExternalLink } from 'lucide-react';
import { useSessionStore } from '@/store/session-store';
import { useWorkspaceStore } from '@/store/workspace-store';
import { getAgentDisplay } from '@/lib/agent-display';
import { findOtherPane, getFirstPaneId } from '@/lib/workspace-utils';
import { cn } from '@/lib/utils';
import type { SearchResult } from '@/types/session';
import type { PaneTab } from '@/types/workspace';

interface CrossAgentSearchProps {
  sessionId: string;
  paneId?: string;
  isSingleTab?: boolean;
}

const ROLE_OPTIONS = [
  { value: 'user', label: 'User' },
  { value: 'assistant', label: 'Assistant' },
  { value: 'tool', label: 'Tool' },
];

const AGENT_TYPE_OPTIONS = [
  { value: 'orchestrator', label: 'Orchestrator' },
  { value: 'subagent', label: 'Subagent' },
  { value: 'workflow', label: 'Workflow' },
];

function highlightSnippet(snippet: string, matchOffset: number, query: string): React.ReactNode {
  if (matchOffset < 0 || !query) return <span>{snippet}</span>;
  const before = snippet.slice(0, matchOffset);
  const match = snippet.slice(matchOffset, matchOffset + query.length);
  const after = snippet.slice(matchOffset + query.length);
  return (
    <>
      <span className="text-[var(--aw-text-2)]">{before}</span>
      <mark className="bg-yellow-500/30 text-yellow-200 rounded-sm px-0.5">{match}</mark>
      <span className="text-[var(--aw-text-2)]">{after}</span>
    </>
  );
}

export function CrossAgentSearch({ sessionId, paneId, isSingleTab }: CrossAgentSearchProps) {
  const { session, agentMap } = useSessionStore();
  const [query, setQuery] = useState('');
  const [debouncedQuery, setDebouncedQuery] = useState('');
  const [selectedRoles, setSelectedRoles] = useState<string[]>([]);
  const [selectedAgentTypes, setSelectedAgentTypes] = useState<string[]>([]);
  const [results, setResults] = useState<SearchResult[]>([]);
  const [total, setTotal] = useState(0);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});
  const inputRef = useRef<HTMLInputElement>(null);

  // Debounce the query
  useEffect(() => {
    const t = setTimeout(() => setDebouncedQuery(query), 350);
    return () => clearTimeout(t);
  }, [query]);

  // Fetch results when debouncedQuery or filters change
  useEffect(() => {
    if (!debouncedQuery.trim()) {
      setResults([]);
      setTotal(0);
      return;
    }

    setIsLoading(true);
    setError(null);

    const params = new URLSearchParams({ q: debouncedQuery, limit: '100' });
    selectedRoles.forEach(r => params.append('roles', r));
    selectedAgentTypes.forEach(t => params.append('agentTypes', t));

    fetch(`/api/v2/sessions/${sessionId}/search?${params}`)
      .then(r => r.json())
      .then(data => {
        if (data.error) throw new Error(data.error);
        setResults(data.results ?? []);
        setTotal(data.total ?? 0);
      })
      .catch(e => setError(e.message))
      .finally(() => setIsLoading(false));
  }, [debouncedQuery, selectedRoles, selectedAgentTypes, sessionId]);

  const openResult = useCallback((result: SearchResult) => {
    const agent = agentMap.get(result.agentId);
    if (!agent) return;
    const { shortName } = getAgentDisplay(agent);
    const tab: PaneTab = { type: 'agent', agentId: agent.id, label: shortName, activeSubTab: 'conversation' };
    const store = useWorkspaceStore.getState();
    const l = store.layout;
    if (!l) return;

    let targetPane: string | null = null;
    if (paneId) {
      targetPane = findOtherPane(l, paneId) ?? paneId;
    } else {
      targetPane = store.focusedPaneId ?? getFirstPaneId(l);
    }
    if (!targetPane) return;

    store.addTabToPane(targetPane, tab);
    store.updateTabState(targetPane, `agent:${agent.id}`, {
      activeSubTab: 'conversation',
      scrollToMessageId: result.messageId,
    });
  }, [agentMap, paneId]);

  // Group results by agentId
  const grouped = results.reduce<Record<string, SearchResult[]>>((acc, r) => {
    if (!acc[r.agentId]) acc[r.agentId] = [];
    acc[r.agentId].push(r);
    return acc;
  }, {});

  const toggleRole = (role: string) => {
    setSelectedRoles(prev => prev.includes(role) ? prev.filter(r => r !== role) : [...prev, role]);
  };

  const toggleAgentType = (type: string) => {
    setSelectedAgentTypes(prev => prev.includes(type) ? prev.filter(t => t !== type) : [...prev, type]);
  };

  return (
    <div className="flex flex-col h-full bg-[var(--aw-bg-0)]">
      {/* Header */}
      <div className="shrink-0 border-b border-[var(--aw-bg-2)] px-3 py-2.5">
        <div className="flex items-center gap-2 mb-2">
          <Search className="h-3.5 w-3.5 text-[var(--aw-text-4)] shrink-0" />
          <input
            ref={inputRef}
            type="text"
            value={query}
            onChange={e => setQuery(e.target.value)}
            placeholder="Search across all agents…"
            className="flex-1 text-sm bg-transparent text-[var(--aw-text-0)] placeholder-[var(--aw-text-4)] outline-none"
            autoFocus
          />
          {isLoading && <Loader2 className="h-3.5 w-3.5 animate-spin text-[var(--aw-text-4)] shrink-0" />}
        </div>

        {/* Filters */}
        <div className="flex flex-wrap gap-2">
          <div className="flex items-center gap-1">
            <span className="text-[10px] text-[var(--aw-text-3)] uppercase tracking-wide">Role</span>
            {ROLE_OPTIONS.map(({ value, label }) => (
              <button
                key={value}
                onClick={() => toggleRole(value)}
                className={cn(
                  'text-[10px] px-1.5 py-0.5 rounded border transition-colors',
                  selectedRoles.includes(value)
                    ? 'border-[var(--aw-blue)] bg-[var(--aw-blue)]/15 text-[var(--aw-blue)]'
                    : 'border-[var(--aw-bg-3)] text-[var(--aw-text-3)] hover:border-[var(--aw-text-4)]'
                )}
              >
                {label}
              </button>
            ))}
          </div>
          <div className="flex items-center gap-1">
            <span className="text-[10px] text-[var(--aw-text-3)] uppercase tracking-wide">Type</span>
            {AGENT_TYPE_OPTIONS.map(({ value, label }) => (
              <button
                key={value}
                onClick={() => toggleAgentType(value)}
                className={cn(
                  'text-[10px] px-1.5 py-0.5 rounded border transition-colors',
                  selectedAgentTypes.includes(value)
                    ? 'border-[var(--aw-purple)] bg-[var(--aw-purple)]/15 text-[var(--aw-purple)]'
                    : 'border-[var(--aw-bg-3)] text-[var(--aw-text-3)] hover:border-[var(--aw-text-4)]'
                )}
              >
                {label}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Results */}
      <div className="flex-1 overflow-y-auto">
        {!debouncedQuery.trim() && (
          <div className="flex flex-col items-center justify-center h-full gap-3 text-[var(--aw-text-4)]">
            <Search className="h-8 w-8 opacity-30" />
            <p className="text-sm">Type to search across all agent messages</p>
          </div>
        )}

        {debouncedQuery && !isLoading && results.length === 0 && !error && (
          <div className="flex items-center justify-center h-32 text-[var(--aw-text-4)] text-sm">
            No results for "{debouncedQuery}"
          </div>
        )}

        {error && (
          <div className="p-4 text-sm text-red-400">{error}</div>
        )}

        {results.length > 0 && (
          <div className="py-1">
            <div className="px-3 py-1.5 text-[10px] text-[var(--aw-text-3)]">
              {total} match{total !== 1 ? 'es' : ''}
            </div>
            {Object.entries(grouped).map(([agentId, agentResults]) => {
              const agent = agentMap.get(agentId);
              const { shortName, color, initials, typeLabel } = agent
                ? getAgentDisplay(agent)
                : { shortName: agentResults[0].agentName, color: { bg: 'var(--aw-bg-2)', text: 'var(--aw-text-2)', border: 'var(--aw-bg-3)' }, initials: '?', typeLabel: agentResults[0].agentType };
              const isCollapsed = collapsed[agentId] ?? false;

              return (
                <div key={agentId} className="border-b border-[var(--aw-bg-1)] last:border-b-0">
                  {/* Agent header */}
                  <button
                    onClick={() => setCollapsed(p => ({ ...p, [agentId]: !isCollapsed }))}
                    className="w-full flex items-center gap-2 px-3 py-2 hover:bg-[var(--aw-bg-1)] transition-colors text-left"
                  >
                    {isCollapsed
                      ? <ChevronRight className="w-3.5 h-3.5 text-[var(--aw-text-4)] shrink-0" />
                      : <ChevronDown className="w-3.5 h-3.5 text-[var(--aw-text-4)] shrink-0" />
                    }
                    <span
                      className="w-5 h-5 rounded text-[9px] font-bold flex items-center justify-center shrink-0"
                      style={{ backgroundColor: color.bg, color: color.text }}
                    >
                      {initials.slice(0, 2)}
                    </span>
                    <span className="text-xs font-medium truncate flex-1" style={{ color: color.text }}>
                      {shortName}
                    </span>
                    <span className="text-[10px] text-[var(--aw-text-3)] shrink-0">{typeLabel}</span>
                    <span className="text-[10px] text-[var(--aw-text-4)] shrink-0 ml-1">
                      {agentResults.length} match{agentResults.length !== 1 ? 'es' : ''}
                    </span>
                  </button>

                  {/* Results for this agent */}
                  {!isCollapsed && (
                    <div className="pb-1">
                      {agentResults.map((result) => (
                        <button
                          key={`${result.messageId}-${result.messageIndex}`}
                          onClick={() => openResult(result)}
                          className="w-full flex items-start gap-2 px-4 py-2 hover:bg-[var(--aw-bg-1)] transition-colors text-left group"
                        >
                          <span className={cn(
                            'text-[9px] px-1 py-0.5 rounded shrink-0 mt-0.5 font-medium',
                            result.role === 'assistant' ? 'bg-[var(--aw-phase-blue)] text-[var(--aw-blue)]' :
                            result.role === 'user' ? 'bg-[var(--aw-green-bg)] text-[var(--aw-green)]' :
                            'bg-[var(--aw-bg-2)] text-[var(--aw-text-3)]'
                          )}>
                            {result.role[0].toUpperCase()}
                          </span>
                          <div className="flex-1 min-w-0">
                            <p className="text-xs text-[var(--aw-text-1)] leading-relaxed break-words line-clamp-3">
                              {highlightSnippet(result.snippet, result.matchOffset, debouncedQuery)}
                            </p>
                          </div>
                          <ExternalLink className="w-3 h-3 text-[var(--aw-text-4)] group-hover:text-[var(--aw-text-2)] shrink-0 mt-0.5 transition-colors" />
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
