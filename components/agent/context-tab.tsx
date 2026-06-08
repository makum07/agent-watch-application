'use client';

import React, { useCallback } from 'react';
import { ChevronRight, ArrowUpRight } from 'lucide-react';
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

export function ContextTab({ agent, paneId }: ContextTabProps) {
  const agentMap = useSessionStore(s => s.agentMap);
  const getAncestors = useSessionStore(s => s.getAncestors);
  const ancestors = getAncestors(agent.id);
  const parentAgent = agent.parentId ? (agentMap.get(agent.parentId) ?? null) : null;

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

        {/* Invocation Chain — shown when there are 2+ ancestors (depth ≥ 2) */}
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

        {/* Called from — shown for any agent with a known parent */}
        {parentAgent && (
          <section>
            <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-2">
              Called from
            </div>
            {(() => {
              const { shortName, color, typeLabel, initials } = getAgentDisplay(parentAgent);
              return (
                <button
                  onClick={() => openAgent(parentAgent.id)}
                  className="flex items-center gap-2 rounded-md border border-[#21262d] bg-[#161b22] hover:bg-[#21262d] px-3 py-2 transition-colors w-full text-left group"
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
