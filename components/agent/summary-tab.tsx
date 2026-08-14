'use client';

import { useState } from 'react';
import { ChevronDown, ChevronRight, Zap } from 'lucide-react';
import { formatTokens, formatDuration, formatCost, estimateAgentCost, cn } from '@/lib/utils';
import { getStatusDisplay, getAgentDisplay } from '@/lib/agent-display';
import { useSessionStore } from '@/store/session-store';
import { useWorkspaceStore } from '@/store/workspace-store';
import { MarkdownRenderer } from '@/components/shared/markdown-renderer';
import type { Agent } from '@/types/session';

interface SummaryTabProps {
  agent: Agent;
  paneId: string;
}

export function SummaryTab({ agent, paneId }: SummaryTabProps) {
  const status = getStatusDisplay(agent);
  const agentMap = useSessionStore(s => s.agentMap);
  const getAncestors = useSessionStore(s => s.getAncestors);
  const { addTabToPane, setFocusedPane } = useWorkspaceStore();

  const cost = estimateAgentCost(agent.tokenUsage, agent.model ?? 'sonnet');
  const ancestors = getAncestors(agent.id);
  const children = agent.children.map(id => agentMap.get(id)).filter((a): a is Agent => !!a);

  const openAgent = (id: string, label: string) => {
    addTabToPane(paneId, { type: 'agent', agentId: id, label });
    setFocusedPane(paneId);
  };

  return (
    <div className="p-4 space-y-4">
      <section>
        <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-2">Identity</h3>
        <div className="space-y-1.5 text-sm">
          <Row label="Type" value={agent.subagentType || agent.type} />
          <Row label="Model" value={agent.model || '—'} />
          <Row label="Status" value={status.title} />
          {agent.deniedToolCount > 0 && <Row label="Denied tool calls" value={String(agent.deniedToolCount)} />}
          {agent.errorToolCount > 0 && <Row label="Failed tool calls" value={String(agent.errorToolCount)} />}
          <Row label="Depth" value={String(agent.depth)} />
          {agent.isolation && <Row label="Isolation" value={agent.isolation} />}
        </div>
      </section>

      {ancestors.length > 0 && (
        <section>
          <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-2">Lineage</h3>
          <div className="flex items-center gap-1 flex-wrap">
            {ancestors.map((a, i) => (
              <span key={a.id} className="flex items-center gap-1">
                <AgentChip agent={a} onClick={() => openAgent(a.id, getAgentDisplay(a).shortName)} />
                {i < ancestors.length - 1 && <ChevronRight className="h-3 w-3 text-muted-foreground shrink-0" />}
              </span>
            ))}
          </div>
        </section>
      )}

      {(agent.description || agent.prompt || agent.response) && (
        <section>
          <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-2">Task</h3>
          <div className="space-y-2.5">
            {agent.description && (
              <p className="text-sm text-foreground/90 font-medium leading-snug">{agent.description}</p>
            )}
            {agent.prompt && <ExpandableText label="Prompt" text={agent.prompt} />}
            {agent.response && <ExpandableText label="Response" text={agent.response} defaultOpen />}
          </div>
        </section>
      )}

      <section>
        <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-2">Timing</h3>
        <div className="space-y-1.5 text-sm">
          <Row label="Start" value={formatTimestamp(agent.startTime)} />
          <Row label="End" value={agent.endTime ? formatTimestamp(agent.endTime) : '—'} />
          <Row label="Duration" value={formatDuration(agent.durationMs)} />
        </div>
      </section>

      <section>
        <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-2">Tokens &amp; Cost</h3>
        <div className="space-y-1.5 text-sm">
          <Row label="Input" value={formatTokens(agent.tokenUsage.input)} />
          <Row label="Output" value={formatTokens(agent.tokenUsage.output)} />
          <Row label="Cache Created" value={formatTokens(agent.tokenUsage.cacheCreation)} />
          <Row label="Cache Read" value={formatTokens(agent.tokenUsage.cacheRead)} />
          <Row label="Total" value={formatTokens(agent.tokenUsage.total)} />
          <Row label="Estimated cost" value={formatCost(cost)} />
        </div>
      </section>

      {agent.skillInvocations.length > 0 && (
        <section>
          <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-2">Skills Invoked</h3>
          <div className="space-y-1.5">
            {agent.skillInvocations.map(si => (
              <div key={si.id} className="flex items-start gap-2 text-sm">
                <Zap className="h-3.5 w-3.5 text-[var(--aw-amber)] shrink-0 mt-0.5" />
                <div className="flex-1 min-w-0">
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-mono text-xs font-medium">{si.skill}</span>
                    {si.durationMs !== null && (
                      <span className="text-[10px] text-muted-foreground font-mono shrink-0">{formatDuration(si.durationMs)}</span>
                    )}
                  </div>
                  {si.args && <span className="text-[11px] text-muted-foreground font-mono truncate block">{si.args}</span>}
                </div>
              </div>
            ))}
          </div>
        </section>
      )}

      {agent.toolCalls.length > 0 && (
        <section>
          <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-2">Tool Usage</h3>
          <div className="space-y-1.5 text-sm">
            {agent.toolCalls.map(tc => (
              <Row key={tc.name} label={tc.name} value={String(tc.count)} />
            ))}
          </div>
        </section>
      )}

      {children.length > 0 && (
        <section>
          <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-2">
            Children ({children.length})
          </h3>
          <div className="space-y-1">
            {children.map(child => {
              const { name, initials, color } = getAgentDisplay(child);
              const childStatus = getStatusDisplay(child);
              return (
                <button
                  key={child.id}
                  onClick={() => openAgent(child.id, getAgentDisplay(child).shortName)}
                  className="w-full flex items-center gap-2 px-2 py-1.5 rounded hover:bg-muted/50 transition-colors text-left"
                >
                  <div
                    className="w-5 h-5 rounded flex items-center justify-center text-[8px] font-bold shrink-0 border"
                    style={{ backgroundColor: color.bg, color: color.text, borderColor: color.border }}
                  >
                    {initials.slice(0, 2)}
                  </div>
                  <span className="text-xs truncate flex-1">{name}</span>
                  <span
                    className="w-1.5 h-1.5 rounded-full shrink-0"
                    style={{ backgroundColor: childStatus.hex }}
                    title={childStatus.title}
                  />
                  <span className="text-[10px] text-muted-foreground font-mono shrink-0">
                    {formatTokens(child.tokenUsage.total)}
                  </span>
                </button>
              );
            })}
          </div>
        </section>
      )}
    </div>
  );
}

function AgentChip({ agent, onClick }: { agent: Agent; onClick: () => void }) {
  const { shortName, initials, color } = getAgentDisplay(agent);
  return (
    <button
      onClick={onClick}
      className="flex items-center gap-1.5 pl-1 pr-2 py-0.5 rounded-full border hover:brightness-110 transition-all"
      style={{ backgroundColor: color.bg, borderColor: color.border }}
    >
      <span
        className="w-4 h-4 rounded-full flex items-center justify-center text-[7px] font-bold shrink-0"
        style={{ color: color.text }}
      >
        {initials.slice(0, 2)}
      </span>
      <span className="text-[11px]" style={{ color: color.text }}>{shortName}</span>
    </button>
  );
}

function ExpandableText({ label, text, defaultOpen = false }: { label: string; text: string; defaultOpen?: boolean }) {
  const [expanded, setExpanded] = useState(defaultOpen);
  const isLong = text.split('\n').length > 12 || text.length > 600;

  return (
    <div className="rounded border border-[var(--aw-bg-3)] bg-[var(--aw-bg-1)]/40 overflow-hidden">
      <button
        onClick={() => setExpanded(v => !v)}
        className="w-full flex items-center gap-1.5 px-2.5 py-1.5 text-[11px] font-medium text-muted-foreground hover:text-foreground transition-colors"
      >
        {expanded ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
        {label}
      </button>
      {expanded && (
        <div className={cn('px-3 pb-2.5', isLong && 'max-h-64 overflow-y-auto')}>
          <MarkdownRenderer content={text} size="sm" />
        </div>
      )}
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between">
      <span className="text-muted-foreground">{label}</span>
      <span className="font-mono text-xs">{value}</span>
    </div>
  );
}

function formatTimestamp(iso: string): string {
  try {
    return new Date(iso).toLocaleString([], {
      month: 'short', day: 'numeric',
      hour: '2-digit', minute: '2-digit', second: '2-digit',
    });
  } catch {
    return iso;
  }
}
