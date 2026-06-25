'use client';

import React, { useCallback, useEffect, useState } from 'react';
import { ChevronRight, ArrowUpRight, ArrowDown, ArrowUp } from 'lucide-react';
import { MarkdownRenderer } from '@/components/shared/markdown-renderer';
import { ScrollArea } from '@/components/ui/scroll-area';
import { useSessionStore } from '@/store/session-store';
import { useWorkspaceStore } from '@/store/workspace-store';
import { getAgentDisplay } from '@/lib/agent-display';
import { findOtherPane, getFirstPaneId } from '@/lib/workspace-utils';
import type { Agent } from '@/types/session';
import type { PaneTab } from '@/types/workspace';

interface ContextTabProps {
  agent: Agent;
  paneId?: string;
}

interface AgentContextEntry {
  round: number | null;
  delegatedBy: string[];
  consumedBy: string[];
}

// Module-level cache so the graph is fetched once per session across all context tab instances
const _graphCache = new Map<string, Record<string, AgentContextEntry>>();

function AgentPill({
  agent,
  round,
  onClick,
}: {
  agent: Agent;
  round: number | null;
  onClick: (id: string) => void;
}) {
  const { shortName, color, initials } = getAgentDisplay(agent);
  return (
    <button
      onClick={() => onClick(agent.id)}
      className="flex items-center gap-1.5 rounded-md border px-2 py-1 text-xs font-medium hover:opacity-75 transition-opacity"
      style={{ backgroundColor: color.bg, color: color.text, borderColor: color.border }}
    >
      {round !== null && (
        <span
          className="text-[9px] font-bold px-1 rounded shrink-0"
          style={{ backgroundColor: `${color.text}30`, color: color.text }}
          title={`Orchestration round ${round}`}
        >
          R{round}
        </span>
      )}
      <span
        className="w-4 h-4 rounded flex items-center justify-center text-[8px] font-bold shrink-0"
        style={{ backgroundColor: `${color.text}25` }}
      >
        {initials.slice(0, 2)}
      </span>
      <span className="truncate max-w-[120px]">{shortName}</span>
    </button>
  );
}

export function ContextTab({ agent, paneId }: ContextTabProps) {
  const agentMap = useSessionStore(s => s.agentMap);
  const getAncestors = useSessionStore(s => s.getAncestors);
  const ancestors = getAncestors(agent.id);
  const parentAgent = agent.parentId ? (agentMap.get(agent.parentId) ?? null) : null;

  const [thisRound, setThisRound] = useState<number | null>(null);
  const [delegatedBy, setDelegatedBy] = useState<Array<{ agent: Agent; round: number | null }>>([]);
  const [consumedBy, setConsumedBy] = useState<Array<{ agent: Agent; round: number | null }>>([]);

  // Fetch (and cache) the context graph for this session
  useEffect(() => {
    if (agent.depth === 0) return;

    const { sessionId } = agent;

    const applyGraph = (graph: Record<string, AgentContextEntry>) => {
      const info = graph[agent.id];
      setThisRound(info?.round ?? null);
      setDelegatedBy(
        (info?.delegatedBy ?? [])
          .map(id => ({ agent: agentMap.get(id), round: graph[id]?.round ?? null }))
          .filter((e): e is { agent: Agent; round: number | null } => !!e.agent)
      );
      setConsumedBy(
        (info?.consumedBy ?? [])
          .map(id => ({ agent: agentMap.get(id), round: graph[id]?.round ?? null }))
          .filter((e): e is { agent: Agent; round: number | null } => !!e.agent)
      );
    };

    if (_graphCache.has(sessionId)) {
      applyGraph(_graphCache.get(sessionId)!);
      return;
    }

    fetch(`/api/v2/sessions/${sessionId}/context-graph`)
      .then(r => r.json())
      .then(data => {
        if (data.graph) {
          _graphCache.set(sessionId, data.graph);
          applyGraph(data.graph);
        }
      })
      .catch(() => {});
  }, [agent.id, agent.sessionId, agent.depth, agentMap]);

  const openAgent = useCallback((targetId: string) => {
    const a = agentMap.get(targetId);
    if (!a) return;
    const { shortName } = getAgentDisplay(a);
    const tab: PaneTab = { type: 'agent', agentId: a.id, label: shortName };
    const store = useWorkspaceStore.getState();
    const l = store.layout;
    if (!l) return;
    if (paneId) {
      const other = findOtherPane(l, paneId);
      store.addTabToPane(other ?? paneId, tab);
    } else {
      const dest = store.focusedPaneId ?? getFirstPaneId(l);
      if (dest) store.addTabToPane(dest, tab);
    }
  }, [agentMap, paneId]);

  return (
    <ScrollArea className="h-full">
      <div className="p-4 space-y-6">

        {/* Invocation Chain — shown when depth ≥ 2 */}
        {ancestors.length >= 2 && (
          <section>
            <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-2">
              Invocation Chain
            </div>
            <div className="flex flex-wrap items-center gap-1">
              {ancestors.map((ancestor) => {
                const { shortName, color } = getAgentDisplay(ancestor);
                return (
                  <React.Fragment key={ancestor.id}>
                    <button
                      onClick={() => openAgent(ancestor.id)}
                      className="text-xs px-2 py-0.5 rounded border font-medium hover:opacity-75 transition-opacity"
                      style={{ backgroundColor: color.bg, color: color.text, borderColor: color.border }}
                    >
                      {shortName}
                    </button>
                    <ChevronRight className="w-3 h-3 text-muted-foreground shrink-0" />
                  </React.Fragment>
                );
              })}
              {(() => {
                const { shortName, color } = getAgentDisplay(agent);
                return (
                  <span
                    className="text-xs px-2 py-0.5 rounded border font-medium"
                    style={{ backgroundColor: color.bg, color: color.text, borderColor: color.border }}
                  >
                    {shortName}
                  </span>
                );
              })()}
            </div>
          </section>
        )}

        {/* Called from — the orchestrator that directly spawned this agent */}
        {parentAgent && (
          <section>
            <div className="flex items-center justify-between mb-2">
              <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                Called from
              </div>
              {thisRound !== null && (
                <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full bg-[var(--aw-bg-2)] text-[var(--aw-text-2)]">
                  Round {thisRound}
                </span>
              )}
            </div>
            {(() => {
              const { shortName, color, typeLabel, initials } = getAgentDisplay(parentAgent);
              return (
                <button
                  onClick={() => openAgent(parentAgent.id)}
                  className="flex items-center gap-2 rounded-md border border-[var(--aw-bg-2)] bg-[var(--aw-bg-1)] hover:bg-[var(--aw-bg-2)] px-3 py-2 transition-colors w-full text-left group"
                >
                  <span
                    className="w-6 h-6 rounded text-[10px] font-bold flex items-center justify-center shrink-0"
                    style={{ backgroundColor: color.bg, color: color.text }}
                  >
                    {initials}
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="text-sm font-medium truncate" style={{ color: color.text }}>
                      {shortName}
                    </div>
                    <div className="text-xs text-muted-foreground">{typeLabel}</div>
                  </div>
                  <ArrowUpRight className="w-3.5 h-3.5 text-muted-foreground group-hover:text-foreground shrink-0 transition-colors" />
                </button>
              );
            })()}
            {agent.toolUseId && (
              <div className="mt-1.5 text-xs text-muted-foreground font-mono pl-1 truncate">
                via {agent.toolUseId}
              </div>
            )}
          </section>
        )}

        {/* Delegated by — agents whose response text was forwarded into this prompt */}
        {delegatedBy.length > 0 && (
          <section>
            <div className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-2">
              <ArrowDown className="w-3 h-3 text-[var(--aw-orange)]" />
              Informed by
            </div>
            <p className="text-[11px] text-muted-foreground mb-2">
              Their output was forwarded verbatim into this agent's prompt by the orchestrator.
            </p>
            <div className="flex flex-wrap gap-1.5">
              {delegatedBy.map(({ agent: a, round }) => (
                <AgentPill key={a.id} agent={a} round={round} onClick={openAgent} />
              ))}
            </div>
          </section>
        )}

        {/* Consumed by — agents whose prompts contain this agent's response text */}
        {consumedBy.length > 0 && (
          <section>
            <div className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-2">
              <ArrowUp className="w-3 h-3 text-[var(--aw-green)]" />
              Output forwarded to
            </div>
            <p className="text-[11px] text-muted-foreground mb-2">
              The orchestrator included this agent's output verbatim in their prompts.
            </p>
            <div className="flex flex-wrap gap-1.5">
              {consumedBy.map(({ agent: a, round }) => (
                <AgentPill key={a.id} agent={a} round={round} onClick={openAgent} />
              ))}
            </div>
          </section>
        )}

        {/* Prompt from Parent */}
        <section>
          <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-2">
            Prompt from Parent
          </div>
          {agent.prompt ? (
            <div className="rounded-md bg-muted/30 border border-border p-3">
              <MarkdownRenderer content={agent.prompt} />
            </div>
          ) : (
            <div className="text-sm text-muted-foreground italic">
              {agent.depth === 0 ? 'Root orchestrator — no parent prompt' : 'No prompt recorded'}
            </div>
          )}
        </section>

        {agent.description && (
          <section>
            <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-2">
              Description
            </div>
            <div className="text-sm">{agent.description}</div>
          </section>
        )}

        {agent.schema && (
          <section>
            <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-2">
              Output Schema
            </div>
            <pre className="text-xs font-mono bg-muted/30 rounded-md p-3 overflow-x-auto">
              {JSON.stringify(agent.schema, null, 2)}
            </pre>
          </section>
        )}

        <section>
          <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-2">
            Response to Parent
          </div>
          {agent.response ? (
            <div className="rounded-md bg-muted/30 border border-border p-3">
              <MarkdownRenderer content={agent.response} />
            </div>
          ) : (
            <div className="text-sm text-muted-foreground italic">No response recorded</div>
          )}
        </section>
      </div>
    </ScrollArea>
  );
}
