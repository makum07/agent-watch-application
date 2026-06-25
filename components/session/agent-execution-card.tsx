'use client';

import { useState, useEffect } from 'react';
import {
  ChevronRight, ChevronDown, Clock, DollarSign, Wrench,
  MessageSquare, Users, AlertTriangle, Shield, List, Loader2,
  Terminal, GitBranch,
} from 'lucide-react';
import { cn, formatDuration, formatCost, formatTokens } from '@/lib/utils';
import type { AgentFacts, ToolTimelineEntry } from '@/types/analytics';

interface AgentExecutionCardProps {
  agent: AgentFacts;
  sessionId: string;
  onAgentClick: (id: string) => void;
}

const statusConfig: Record<string, { color: string; bg: string; label: string }> = {
  completed:             { color: 'text-[var(--aw-green)]', bg: 'bg-[var(--aw-green)]/10', label: 'Completed' },
  completed_with_errors: { color: 'text-[var(--aw-yellow)]', bg: 'bg-[var(--aw-yellow)]/10', label: 'Errors' },
  errored:               { color: 'text-[var(--aw-red)]', bg: 'bg-[var(--aw-red)]/10', label: 'Errored' },
  running:               { color: 'text-[var(--aw-purple)]', bg: 'bg-[var(--aw-purple)]/10', label: 'Running' },
  unknown:               { color: 'text-[var(--aw-text-2)]', bg: 'bg-[var(--aw-bg-2)]',    label: 'Unknown' },
};

export function AgentExecutionCard({ agent, sessionId, onAgentClick }: AgentExecutionCardProps) {
  const [expanded, setExpanded] = useState(false);
  const [toolTimeline, setToolTimeline] = useState<ToolTimelineEntry[] | null>(null);
  const [timelineLoading, setTimelineLoading] = useState(false);
  const sc = statusConfig[agent.status] || statusConfig.unknown;

  useEffect(() => {
    if (!expanded || toolTimeline !== null || timelineLoading) return;
    setTimelineLoading(true);
    fetch(`/api/v2/sessions/${sessionId}/agents/${agent.agentId}/tool-timeline`)
      .then(r => r.ok ? r.json() : [])
      .then(data => setToolTimeline(data))
      .catch(() => setToolTimeline([]))
      .finally(() => setTimelineLoading(false));
  }, [expanded, sessionId, agent.agentId, toolTimeline, timelineLoading]);

  return (
    <div className="rounded-md border border-[var(--aw-bg-2)] bg-[var(--aw-bg-1)] overflow-hidden">
      {/* ── Collapsed Row ──────────────────────────────────── */}
      <button
        onClick={() => setExpanded(v => !v)}
        className="w-full flex items-center gap-2 px-3 py-2 text-left hover:bg-[var(--aw-bg-2)]/50 transition-colors"
      >
        {expanded
          ? <ChevronDown className="h-3 w-3 text-[var(--aw-text-3)] shrink-0" />
          : <ChevronRight className="h-3 w-3 text-[var(--aw-text-3)] shrink-0" />}

        <span className={cn('text-[9px] px-1.5 py-0.5 rounded font-medium shrink-0', sc.bg, sc.color)}>
          {sc.label}
        </span>

        <span className="text-xs text-[var(--aw-text-1)] truncate flex-1">{agent.name}</span>

        {agent.subagentType && (
          <span className="text-[9px] px-1 py-0.5 rounded bg-[var(--aw-bg-2)] text-[var(--aw-text-2)] shrink-0">
            {agent.subagentType}
          </span>
        )}

        <span className="text-[9px] text-[var(--aw-text-3)] shrink-0">{agent.model.replace('claude-', '')}</span>

        <span className="text-[9px] text-[var(--aw-text-2)] font-mono shrink-0 w-14 text-right">
          {formatDuration(agent.durationMs)}
        </span>

        <span className="text-[9px] text-[var(--aw-text-2)] font-mono shrink-0 w-14 text-right">
          {formatCost(agent.estimatedCost)}
        </span>

        <span className="text-[9px] font-mono shrink-0 w-12 text-right flex items-center justify-end gap-0.5">
          <Wrench className="h-2.5 w-2.5 text-[var(--aw-text-3)]" />
          <span className="text-[var(--aw-text-2)]">{agent.totalToolCalls}</span>
          {agent.failedToolCalls > 0 && (
            <span className="text-[var(--aw-red)]">/{agent.failedToolCalls}</span>
          )}
        </span>

        <span className="text-[9px] text-[var(--aw-text-2)] font-mono shrink-0 w-14 text-right">
          {formatTokens(agent.tokenUsage.total)}
        </span>
      </button>

      {/* ── Expanded Details ───────────────────────────────── */}
      {expanded && (
        <div className="border-t border-[var(--aw-bg-2)]">
          <div className="px-3 py-3 grid grid-cols-1 md:grid-cols-2 gap-4">
            {/* Execution Info */}
            <div>
              <SectionLabel icon={<Clock className="h-3 w-3" />} label="Execution Info" />
              <div className="space-y-1 mt-1.5">
                <FactRow label="Start" value={formatTime(agent.startTime)} />
                <FactRow label="End" value={agent.endTime ? formatTime(agent.endTime) : 'N/A'} />
                <FactRow label="Duration" value={formatDuration(agent.durationMs)} />
                <FactRow label="Model" value={agent.model} />
                <FactRow label="Status" value={agent.status} valueClass={sc.color} />
                <FactRow label="Depth" value={String(agent.depth)} />
                {agent.parentId && (
                  <div className="flex items-center gap-1.5 text-[10px]">
                    <span className="text-[var(--aw-text-3)] w-20 shrink-0">Parent</span>
                    <button
                      onClick={(e) => { e.stopPropagation(); onAgentClick(agent.parentId!); }}
                      className="text-[var(--aw-blue)] hover:underline truncate"
                    >
                      {agent.parentName || agent.parentId.slice(0, 12)}
                    </button>
                  </div>
                )}
              </div>
            </div>

            {/* Token & Cost */}
            <div>
              <SectionLabel icon={<DollarSign className="h-3 w-3" />} label="Token & Cost" />
              <div className="space-y-1 mt-1.5">
                <FactRow label="Input" value={formatTokens(agent.tokenUsage.input)} mono />
                <FactRow label="Output" value={formatTokens(agent.tokenUsage.output)} mono />
                <FactRow label="Cache Create" value={formatTokens(agent.tokenUsage.cacheCreation)} mono />
                <FactRow label="Cache Read" value={formatTokens(agent.tokenUsage.cacheRead)} mono />
                <FactRow label="Total" value={formatTokens(agent.tokenUsage.total)} mono highlight />
                <FactRow label="Est. Cost" value={formatCost(agent.estimatedCost)} mono highlight />
                <FactRow label="Messages" value={String(agent.messageCount)} mono />
              </div>
            </div>

            {/* Tool Usage Summary */}
            <div>
              <SectionLabel icon={<Wrench className="h-3 w-3" />} label="Tool Usage" />
              <div className="space-y-1 mt-1.5">
                <FactRow label="Total" value={String(agent.totalToolCalls)} mono />
                <FactRow label="Successful" value={String(agent.successfulToolCalls)} mono />
                {agent.failedToolCalls > 0 && (
                  <FactRow
                    label="Failed"
                    value={String(agent.failedToolCalls)}
                    mono
                    valueClass="text-[var(--aw-red)]"
                    icon={<AlertTriangle className="h-2.5 w-2.5 text-[var(--aw-red)]" />}
                  />
                )}
                {agent.deniedToolCalls > 0 && (
                  <FactRow
                    label="Denied"
                    value={String(agent.deniedToolCalls)}
                    mono
                    valueClass="text-[var(--aw-yellow)]"
                    icon={<Shield className="h-2.5 w-2.5 text-[var(--aw-yellow)]" />}
                  />
                )}
              </div>
            </div>

            {/* Communication */}
            <div>
              <SectionLabel icon={<MessageSquare className="h-3 w-3" />} label="Communication" />
              <div className="space-y-1 mt-1.5">
                {agent.parentId && (
                  <div className="flex items-center gap-1.5 text-[10px]">
                    <span className="text-[var(--aw-text-3)] w-20 shrink-0">Parent</span>
                    <button
                      onClick={(e) => { e.stopPropagation(); onAgentClick(agent.parentId!); }}
                      className="text-[var(--aw-blue)] hover:underline truncate"
                    >
                      {agent.parentName || agent.parentId.slice(0, 12)}
                    </button>
                  </div>
                )}
                <FactRow label="Children" value={String(agent.childrenCount)} mono />
                {agent.childrenIds.length > 0 && (
                  <div className="flex items-center gap-1 flex-wrap mt-0.5">
                    {agent.childrenIds.slice(0, 8).map(cid => (
                      <button
                        key={cid}
                        onClick={(e) => { e.stopPropagation(); onAgentClick(cid); }}
                        className="text-[9px] text-[var(--aw-blue)] hover:underline font-mono"
                      >
                        {cid.slice(0, 8)}
                      </button>
                    ))}
                    {agent.childrenIds.length > 8 && (
                      <span className="text-[9px] text-[var(--aw-text-4)]">+{agent.childrenIds.length - 8} more</span>
                    )}
                  </div>
                )}
                <FactRow label="Prompt" value={agent.promptLength > 0 ? `${agent.promptLength.toLocaleString()} chars` : 'None'} />
                <FactRow label="Response" value={agent.responseLength > 0 ? `${agent.responseLength.toLocaleString()} chars` : 'None'} />
                {agent.skillInvocations.length > 0 && (
                  <div className="mt-2">
                    <span className="text-[9px] text-[var(--aw-text-3)] uppercase tracking-wide">Skills Used</span>
                    <div className="flex flex-wrap gap-1 mt-1">
                      {agent.skillInvocations.map((si, i) => (
                        <span key={i} className="text-[9px] px-1.5 py-0.5 rounded bg-[var(--aw-bg-2)] text-[var(--aw-text-2)]">
                          {si.skill}
                          {si.durationMs != null && (
                            <span className="text-[var(--aw-text-3)] ml-1">{formatDuration(si.durationMs)}</span>
                          )}
                        </span>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            </div>
          </div>

          {/* ── Tool Execution Timeline (collapsible) ─────── */}
          <ToolTimeline
            timeline={toolTimeline}
            loading={timelineLoading}
            totalToolCalls={agent.totalToolCalls}
            failedToolCalls={agent.failedToolCalls}
          />
        </div>
      )}
    </div>
  );
}

function ToolTimeline({
  timeline,
  loading,
  totalToolCalls,
  failedToolCalls,
}: {
  timeline: ToolTimelineEntry[] | null;
  loading: boolean;
  totalToolCalls: number;
  failedToolCalls: number;
}) {
  const [open, setOpen] = useState(false);

  return (
    <div className="border-t border-[var(--aw-bg-2)] px-3 py-2">
      <button
        onClick={() => setOpen(v => !v)}
        className="w-full flex items-center gap-1.5 text-left"
      >
        <span className="text-[var(--aw-text-3)]">
          {open ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
        </span>
        <List className="h-3 w-3 text-[var(--aw-text-3)]" />
        <span className="text-[10px] font-semibold text-[var(--aw-text-0)] uppercase tracking-wide">Tool Execution Timeline</span>
        <span className="text-[9px] text-[var(--aw-text-2)] font-mono ml-1">{totalToolCalls} calls</span>
        {failedToolCalls > 0 && (
          <span className="text-[9px] text-[var(--aw-red)] font-mono">{failedToolCalls} failed</span>
        )}
        {loading && <Loader2 className="h-3 w-3 animate-spin text-[var(--aw-text-3)] ml-auto" />}
      </button>
      {open && loading && (
        <div className="flex items-center gap-1.5 mt-2 text-[10px] text-[var(--aw-text-3)]">
          <Loader2 className="h-3 w-3 animate-spin" />
          Loading tool calls…
        </div>
      )}
      {open && timeline && timeline.length === 0 && (
        <div className="mt-2 text-[10px] text-[var(--aw-text-4)]">No tool calls recorded.</div>
      )}
      {open && timeline && timeline.length > 0 && (
        <div className="mt-2 space-y-0">
          {timeline.map((tc, i) => (
                  <div
                    key={tc.id}
                    className={cn(
                      'flex items-start gap-2 py-1 px-1.5 rounded text-[10px]',
                      tc.isError && 'bg-[var(--aw-red)]/5',
                    )}
                  >
                    <span className="text-[var(--aw-text-4)] font-mono w-5 text-right shrink-0 pt-0.5">
                      {i + 1}
                    </span>
                    <div className="shrink-0 pt-0.5">
                      {tc.isError ? (
                        <AlertTriangle className="h-3 w-3 text-[var(--aw-red)]" />
                      ) : tc.isAgentSpawn ? (
                        <GitBranch className="h-3 w-3 text-[var(--aw-purple)]" />
                      ) : (
                        <Terminal className="h-3 w-3 text-[var(--aw-text-4)]" />
                      )}
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-1.5">
                        <span className={cn(
                          'font-semibold',
                          tc.isError ? 'text-[var(--aw-red)]' : 'text-[var(--aw-text-1)]',
                        )}>
                          {tc.name}
                        </span>
                        {tc.durationMs != null && tc.durationMs > 0 && (
                          <span className="text-[var(--aw-text-4)] font-mono">{formatDuration(tc.durationMs)}</span>
                        )}
                      </div>
                      <div className="text-[var(--aw-text-3)] truncate">{tc.inputSummary}</div>
                      {tc.isError && tc.resultPreview && (
                        <div className="text-[var(--aw-red)]/80 mt-0.5 whitespace-pre-wrap break-words text-[9px] leading-tight max-h-16 overflow-hidden">
                          {tc.resultPreview}
                        </div>
                      )}
                    </div>
                  </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ── Helpers ──────────────────────────────────────────────────────────────

function SectionLabel({ icon, label }: { icon: React.ReactNode; label: string }) {
  return (
    <div className="flex items-center gap-1.5">
      <span className="text-[var(--aw-text-3)]">{icon}</span>
      <span className="text-[10px] font-semibold text-[var(--aw-text-0)] uppercase tracking-wide">{label}</span>
    </div>
  );
}

function FactRow({
  label, value, mono, highlight, valueClass, icon,
}: {
  label: string;
  value: string;
  mono?: boolean;
  highlight?: boolean;
  valueClass?: string;
  icon?: React.ReactNode;
}) {
  return (
    <div className="flex items-center gap-1.5 text-[10px]">
      <span className="text-[var(--aw-text-3)] w-20 shrink-0">{label}</span>
      {icon}
      <span className={cn(
        mono && 'font-mono',
        highlight ? 'text-[var(--aw-text-0)]' : 'text-[var(--aw-text-1)]',
        valueClass,
      )}>
        {value}
      </span>
    </div>
  );
}

function formatTime(iso: string): string {
  try {
    return new Date(iso).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit', second: '2-digit' });
  } catch {
    return iso;
  }
}
