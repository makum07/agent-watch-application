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
  completed:             { color: 'text-[#3fb950]', bg: 'bg-[#3fb950]/10', label: 'Completed' },
  completed_with_errors: { color: 'text-[#d29922]', bg: 'bg-[#d29922]/10', label: 'Errors' },
  errored:               { color: 'text-[#f85149]', bg: 'bg-[#f85149]/10', label: 'Errored' },
  running:               { color: 'text-[#bc8cff]', bg: 'bg-[#bc8cff]/10', label: 'Running' },
  unknown:               { color: 'text-[#8b949e]', bg: 'bg-[#21262d]',    label: 'Unknown' },
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
    <div className="rounded-md border border-[#21262d] bg-[#161b22] overflow-hidden">
      {/* ── Collapsed Row ──────────────────────────────────── */}
      <button
        onClick={() => setExpanded(v => !v)}
        className="w-full flex items-center gap-2 px-3 py-2 text-left hover:bg-[#21262d]/50 transition-colors"
      >
        {expanded
          ? <ChevronDown className="h-3 w-3 text-[#6e7681] shrink-0" />
          : <ChevronRight className="h-3 w-3 text-[#6e7681] shrink-0" />}

        <span className={cn('text-[9px] px-1.5 py-0.5 rounded font-medium shrink-0', sc.bg, sc.color)}>
          {sc.label}
        </span>

        <span className="text-xs text-[#c9d1d9] truncate flex-1">{agent.name}</span>

        {agent.subagentType && (
          <span className="text-[9px] px-1 py-0.5 rounded bg-[#21262d] text-[#8b949e] shrink-0">
            {agent.subagentType}
          </span>
        )}

        <span className="text-[9px] text-[#6e7681] shrink-0">{agent.model.replace('claude-', '')}</span>

        <span className="text-[9px] text-[#8b949e] font-mono shrink-0 w-14 text-right">
          {formatDuration(agent.durationMs)}
        </span>

        <span className="text-[9px] text-[#8b949e] font-mono shrink-0 w-14 text-right">
          {formatCost(agent.estimatedCost)}
        </span>

        <span className="text-[9px] font-mono shrink-0 w-12 text-right flex items-center justify-end gap-0.5">
          <Wrench className="h-2.5 w-2.5 text-[#6e7681]" />
          <span className="text-[#8b949e]">{agent.totalToolCalls}</span>
          {agent.failedToolCalls > 0 && (
            <span className="text-[#f85149]">/{agent.failedToolCalls}</span>
          )}
        </span>

        <span className="text-[9px] text-[#8b949e] font-mono shrink-0 w-14 text-right">
          {formatTokens(agent.tokenUsage.total)}
        </span>
      </button>

      {/* ── Expanded Details ───────────────────────────────── */}
      {expanded && (
        <div className="border-t border-[#21262d]">
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
                    <span className="text-[#6e7681] w-20 shrink-0">Parent</span>
                    <button
                      onClick={(e) => { e.stopPropagation(); onAgentClick(agent.parentId!); }}
                      className="text-[#58a6ff] hover:underline truncate"
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
                    valueClass="text-[#f85149]"
                    icon={<AlertTriangle className="h-2.5 w-2.5 text-[#f85149]" />}
                  />
                )}
                {agent.deniedToolCalls > 0 && (
                  <FactRow
                    label="Denied"
                    value={String(agent.deniedToolCalls)}
                    mono
                    valueClass="text-[#d29922]"
                    icon={<Shield className="h-2.5 w-2.5 text-[#d29922]" />}
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
                    <span className="text-[#6e7681] w-20 shrink-0">Parent</span>
                    <button
                      onClick={(e) => { e.stopPropagation(); onAgentClick(agent.parentId!); }}
                      className="text-[#58a6ff] hover:underline truncate"
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
                        className="text-[9px] text-[#58a6ff] hover:underline font-mono"
                      >
                        {cid.slice(0, 8)}
                      </button>
                    ))}
                    {agent.childrenIds.length > 8 && (
                      <span className="text-[9px] text-[#484f58]">+{agent.childrenIds.length - 8} more</span>
                    )}
                  </div>
                )}
                <FactRow label="Prompt" value={agent.promptLength > 0 ? `${agent.promptLength.toLocaleString()} chars` : 'None'} />
                <FactRow label="Response" value={agent.responseLength > 0 ? `${agent.responseLength.toLocaleString()} chars` : 'None'} />
                {agent.skillInvocations.length > 0 && (
                  <div className="mt-2">
                    <span className="text-[9px] text-[#6e7681] uppercase tracking-wide">Skills Used</span>
                    <div className="flex flex-wrap gap-1 mt-1">
                      {agent.skillInvocations.map((si, i) => (
                        <span key={i} className="text-[9px] px-1.5 py-0.5 rounded bg-[#21262d] text-[#8b949e]">
                          {si.skill}
                          {si.durationMs != null && (
                            <span className="text-[#6e7681] ml-1">{formatDuration(si.durationMs)}</span>
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
    <div className="border-t border-[#21262d] px-3 py-2">
      <button
        onClick={() => setOpen(v => !v)}
        className="w-full flex items-center gap-1.5 text-left"
      >
        <span className="text-[#6e7681]">
          {open ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
        </span>
        <List className="h-3 w-3 text-[#6e7681]" />
        <span className="text-[10px] font-semibold text-[#e6edf3] uppercase tracking-wide">Tool Execution Timeline</span>
        <span className="text-[9px] text-[#8b949e] font-mono ml-1">{totalToolCalls} calls</span>
        {failedToolCalls > 0 && (
          <span className="text-[9px] text-[#f85149] font-mono">{failedToolCalls} failed</span>
        )}
        {loading && <Loader2 className="h-3 w-3 animate-spin text-[#6e7681] ml-auto" />}
      </button>
      {open && loading && (
        <div className="flex items-center gap-1.5 mt-2 text-[10px] text-[#6e7681]">
          <Loader2 className="h-3 w-3 animate-spin" />
          Loading tool calls…
        </div>
      )}
      {open && timeline && timeline.length === 0 && (
        <div className="mt-2 text-[10px] text-[#484f58]">No tool calls recorded.</div>
      )}
      {open && timeline && timeline.length > 0 && (
        <div className="mt-2 space-y-0">
          {timeline.map((tc, i) => (
                  <div
                    key={tc.id}
                    className={cn(
                      'flex items-start gap-2 py-1 px-1.5 rounded text-[10px]',
                      tc.isError && 'bg-[#f85149]/5',
                    )}
                  >
                    <span className="text-[#484f58] font-mono w-5 text-right shrink-0 pt-0.5">
                      {i + 1}
                    </span>
                    <div className="shrink-0 pt-0.5">
                      {tc.isError ? (
                        <AlertTriangle className="h-3 w-3 text-[#f85149]" />
                      ) : tc.isAgentSpawn ? (
                        <GitBranch className="h-3 w-3 text-[#bc8cff]" />
                      ) : (
                        <Terminal className="h-3 w-3 text-[#484f58]" />
                      )}
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-1.5">
                        <span className={cn(
                          'font-semibold',
                          tc.isError ? 'text-[#f85149]' : 'text-[#c9d1d9]',
                        )}>
                          {tc.name}
                        </span>
                        {tc.durationMs != null && tc.durationMs > 0 && (
                          <span className="text-[#484f58] font-mono">{formatDuration(tc.durationMs)}</span>
                        )}
                      </div>
                      <div className="text-[#6e7681] truncate">{tc.inputSummary}</div>
                      {tc.isError && tc.resultPreview && (
                        <div className="text-[#f85149]/80 mt-0.5 whitespace-pre-wrap break-words text-[9px] leading-tight max-h-16 overflow-hidden">
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
      <span className="text-[#6e7681]">{icon}</span>
      <span className="text-[10px] font-semibold text-[#e6edf3] uppercase tracking-wide">{label}</span>
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
      <span className="text-[#6e7681] w-20 shrink-0">{label}</span>
      {icon}
      <span className={cn(
        mono && 'font-mono',
        highlight ? 'text-[#e6edf3]' : 'text-[#c9d1d9]',
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
