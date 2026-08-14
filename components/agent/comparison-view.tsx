'use client';

import { useState } from 'react';
import { ArrowLeftRight, ArrowUp, ArrowDown } from 'lucide-react';
import { useSessionStore } from '@/store/session-store';
import { getAgentDisplay, getStatusDisplay } from '@/lib/agent-display';
import { formatTokens, formatDuration, formatCost, estimateAgentCost, cn } from '@/lib/utils';
import { MarkdownRenderer } from '@/components/shared/markdown-renderer';
import { ScrollArea } from '@/components/ui/scroll-area';
import { ConversationTab } from './conversation-tab';
import type { Agent } from '@/types/session';

type CompareTab = 'conversation' | 'metrics' | 'prompts' | 'tools';
type Better = 'lower' | 'higher' | 'neutral';

interface ComparisonViewProps {
  sessionId: string;
  agentAId: string;
  agentBId: string;
  paneId?: string;
}

const TABS: { id: CompareTab; label: string }[] = [
  { id: 'conversation', label: 'Conversation' },
  { id: 'metrics', label: 'Metrics' },
  { id: 'prompts', label: 'Prompts' },
  { id: 'tools', label: 'Tools' },
];

// Fixed two-slot categorical pair (dataviz palette, dark surface) — identity for
// "A" vs "B" never varies with the agents' own type colors, so a comparison never
// accidentally reads as green-vs-red ("good vs bad") or collides when both agents
// happen to share a type color.
const SLOT_A = '#3987e5'; // categorical slot 1 — blue
const SLOT_B = '#d95926'; // categorical slot 2 — orange
const WARN = '#fab219';   // status: warning (used only for the "lagging side" delta chip)

// ─── Building blocks ────────────────────────────────────────────────────────

// Label rail stays narrow; the two value columns share whatever width is left
// (so text values get real room instead of truncating); delta stays fixed-width.
// Every row below shares this template so the table lines up.
const ROW_GRID = 'grid-cols-[112px_minmax(0,1fr)_minmax(0,1fr)_52px]';

function SectionHeader({ label }: { label: string }) {
  return <div className="text-[10px] font-semibold uppercase tracking-wide text-[var(--aw-text-3)] mt-4 mb-1.5 first:mt-0">{label}</div>;
}

/** Column headings for a metrics/tools table — the only place agent identity is named per-column. */
function TableHead({ a, b }: { a: Agent; b: Agent }) {
  const dispA = getAgentDisplay(a);
  const dispB = getAgentDisplay(b);
  return (
    <div className={cn('grid items-center gap-2 pb-1.5 mb-1 border-b border-[var(--aw-bg-2)]', ROW_GRID)}>
      <span />
      <span className="flex items-center justify-end gap-1 min-w-0 text-[10px] font-medium" style={{ color: SLOT_A }}>
        <span className="truncate">{dispA.shortName}</span>
        <span className="w-1.5 h-1.5 rounded-full shrink-0" style={{ backgroundColor: SLOT_A }} />
      </span>
      <span className="flex items-center justify-end gap-1 min-w-0 text-[10px] font-medium" style={{ color: SLOT_B }}>
        <span className="truncate">{dispB.shortName}</span>
        <span className="w-1.5 h-1.5 rounded-full shrink-0" style={{ backgroundColor: SLOT_B }} />
      </span>
      <span />
    </div>
  );
}

/**
 * A numeric metric as two plain right-aligned values plus one delta arrow.
 * `better` controls whether the arrow appears at all — 'neutral' metrics (e.g.
 * message count) show the two numbers only, never a value judgment.
 */
function MetricRow({
  label, aValue, bValue, format, better = 'neutral',
}: {
  label: string; aValue: number; bValue: number; format: (n: number) => string; better?: Better;
}) {
  let delta: { pct: number; aHigher: boolean } | null = null;
  if (better !== 'neutral' && aValue !== bValue) {
    const base = Math.min(aValue, bValue) || Math.max(aValue, bValue) || 1;
    const pct = Math.round((Math.abs(aValue - bValue) / base) * 100);
    if (pct >= 5) delta = { pct, aHigher: aValue > bValue };
  }
  const Arrow = delta?.aHigher ? ArrowUp : ArrowDown;

  return (
    <div className={cn('grid items-center gap-2 py-1.5 border-b border-[var(--aw-bg-2)]/40 last:border-0', ROW_GRID)}>
      <span className="text-[11px] text-[var(--aw-text-3)] truncate" title={label}>{label}</span>
      <span className="font-mono text-xs text-[var(--aw-text-1)] text-right tabular-nums">{format(aValue)}</span>
      <span className="font-mono text-xs text-[var(--aw-text-1)] text-right tabular-nums">{format(bValue)}</span>
      <span className="flex items-center justify-end gap-0.5">
        {delta && (
          <>
            <Arrow className="h-2.5 w-2.5 shrink-0" style={{ color: WARN }} />
            <span className="text-[10px] font-medium tabular-nums" style={{ color: WARN }}>{delta.pct}%</span>
          </>
        )}
      </span>
    </div>
  );
}

/** A non-numeric metric — plain text on each side, no marks. */
function TextRow({ label, a, b }: { label: string; a: string; b: string }) {
  return (
    <div className={cn('grid items-center gap-2 py-1 border-b border-[var(--aw-bg-2)]/40 last:border-0', ROW_GRID)}>
      <span className="text-[11px] text-[var(--aw-text-3)] truncate" title={label}>{label}</span>
      <span className="col-span-2 grid grid-cols-2 gap-2 text-xs font-mono text-[var(--aw-text-1)] min-w-0">
        <span className="truncate" title={a}>{a}</span>
        <span className="truncate" title={b}>{b}</span>
      </span>
      <span />
    </div>
  );
}

function AgentTag({ agent, color }: { agent: Agent; color: string }) {
  const { shortName, initials } = getAgentDisplay(agent);
  return (
    <span className="inline-flex items-center gap-1.5 shrink-0 min-w-0">
      <span
        className="w-4 h-4 rounded flex items-center justify-center text-[7px] font-bold shrink-0"
        style={{ backgroundColor: `${color}25`, color }}
      >
        {initials.slice(0, 2)}
      </span>
      <span className="text-[11px] font-medium truncate" style={{ color }}>{shortName}</span>
    </span>
  );
}

// ─── Tabs ───────────────────────────────────────────────────────────────────

function ConversationCompareTab({ sessionId, a, b, paneId }: { sessionId: string; a: Agent; b: Agent; paneId: string }) {
  const columns = [{ agent: a, color: SLOT_A }, { agent: b, color: SLOT_B }];
  return (
    <div className="grid grid-cols-2 h-full">
      {columns.map(({ agent, color }, i) => (
        <div key={agent.id} className={cn('flex flex-col h-full overflow-hidden min-w-0', i === 0 && 'border-r border-[var(--aw-bg-2)]')}>
          <div className="shrink-0 px-3 py-2 border-b border-[var(--aw-bg-2)] bg-[var(--aw-bg-1)]">
            <AgentTag agent={agent} color={color} />
          </div>
          <div className="flex-1 min-h-0 overflow-hidden">
            <ConversationTab sessionId={sessionId} agentId={agent.id} paneId={paneId} />
          </div>
        </div>
      ))}
    </div>
  );
}

function MetricsTab({ a, b }: { a: Agent; b: Agent }) {
  const costA = estimateAgentCost(a.tokenUsage, a.model ?? 'sonnet');
  const costB = estimateAgentCost(b.tokenUsage, b.model ?? 'sonnet');

  return (
    <div className="p-4">
      <TableHead a={a} b={b} />
      <SectionHeader label="Identity" />
      <TextRow label="Type" a={a.subagentType || a.type} b={b.subagentType || b.type} />
      <TextRow label="Model" a={a.model || '—'} b={b.model || '—'} />
      <TextRow label="Status" a={getStatusDisplay(a).title} b={getStatusDisplay(b).title} />
      <TextRow label="Depth" a={String(a.depth)} b={String(b.depth)} />

      <SectionHeader label="Timing & Scope" />
      <MetricRow label="Duration" aValue={a.durationMs} bValue={b.durationMs} format={formatDuration} better="lower" />
      <MetricRow label="Messages" aValue={a.messageCount} bValue={b.messageCount} format={String} />
      <MetricRow label="Children" aValue={a.children.length} bValue={b.children.length} format={String} />

      <SectionHeader label="Tokens & Cost" />
      <MetricRow label="Input" aValue={a.tokenUsage.input} bValue={b.tokenUsage.input} format={formatTokens} better="lower" />
      <MetricRow label="Output" aValue={a.tokenUsage.output} bValue={b.tokenUsage.output} format={formatTokens} better="lower" />
      <MetricRow label="Cache Created" aValue={a.tokenUsage.cacheCreation} bValue={b.tokenUsage.cacheCreation} format={formatTokens} />
      <MetricRow label="Cache Read" aValue={a.tokenUsage.cacheRead} bValue={b.tokenUsage.cacheRead} format={formatTokens} />
      <MetricRow label="Total tokens" aValue={a.tokenUsage.total} bValue={b.tokenUsage.total} format={formatTokens} better="lower" />
      <MetricRow label="Est. cost" aValue={costA} bValue={costB} format={formatCost} better="lower" />

      <SectionHeader label="Reliability" />
      <MetricRow label="Failed calls" aValue={a.errorToolCount} bValue={b.errorToolCount} format={String} better="lower" />
      <MetricRow label="Denied calls" aValue={a.deniedToolCount} bValue={b.deniedToolCount} format={String} better="lower" />
    </div>
  );
}

function PromptsTab({ a, b }: { a: Agent; b: Agent }) {
  const columns = [{ agent: a, color: SLOT_A }, { agent: b, color: SLOT_B }];
  return (
    <div className="grid grid-cols-2 gap-0 h-full">
      {columns.map(({ agent, color }, i) => (
        <div key={agent.id} className={cn('overflow-y-auto', i === 0 && 'border-r border-[var(--aw-bg-2)]')}>
          <div className="p-3 space-y-4">
            <div className="pb-2 border-b border-[var(--aw-bg-2)]">
              <AgentTag agent={agent} color={color} />
            </div>
            {agent.prompt && (
              <div>
                <div className="text-[10px] font-semibold uppercase tracking-wide text-[var(--aw-text-3)] mb-1.5">Prompt</div>
                <div className="rounded-md bg-[var(--aw-blue-bg-deep)] border border-[var(--aw-blue-bg)]/30 p-3">
                  <MarkdownRenderer content={agent.prompt} />
                </div>
              </div>
            )}
            {agent.response && (
              <div>
                <div className="text-[10px] font-semibold uppercase tracking-wide text-[var(--aw-text-3)] mb-1.5">Response</div>
                <div className="rounded-md bg-[var(--aw-green-bg-deep)] border border-[var(--aw-green-bg-2)]/30 p-3">
                  <MarkdownRenderer content={agent.response} />
                </div>
              </div>
            )}
            {!agent.prompt && !agent.response && (
              <div className="text-xs text-[var(--aw-text-4)] italic pt-2">No prompt / response recorded</div>
            )}
          </div>
        </div>
      ))}
    </div>
  );
}

function ToolsTab({ a, b }: { a: Agent; b: Agent }) {
  const allTools = new Set([...a.toolCalls.map(t => t.name), ...b.toolCalls.map(t => t.name)]);
  const sortedTools = [...allTools].sort();
  const aMap = new Map(a.toolCalls.map(t => [t.name, t.count]));
  const bMap = new Map(b.toolCalls.map(t => [t.name, t.count]));

  if (allTools.size === 0) {
    return <div className="p-4 text-sm text-[var(--aw-text-4)] italic">Neither agent made tool calls</div>;
  }

  return (
    <div className="p-4">
      <TableHead a={a} b={b} />
      {sortedTools.map(tool => (
        <MetricRow key={tool} label={tool} aValue={aMap.get(tool) ?? 0} bValue={bMap.get(tool) ?? 0} format={String} />
      ))}
    </div>
  );
}

export function ComparisonView({ sessionId, agentAId, agentBId, paneId = '' }: ComparisonViewProps) {
  const { agentMap } = useSessionStore();
  const [activeTab, setActiveTab] = useState<CompareTab>('conversation');
  const [flipped, setFlipped] = useState(false);

  const rawA = agentMap.get(agentAId);
  const rawB = agentMap.get(agentBId);

  if (!rawA || !rawB) {
    return (
      <div className="flex items-center justify-center h-full text-[var(--aw-text-4)] text-sm">
        Agent not found
      </div>
    );
  }

  const a = flipped ? rawB : rawA;
  const b = flipped ? rawA : rawB;
  const dispA = getAgentDisplay(a);
  const dispB = getAgentDisplay(b);

  return (
    <div className="flex flex-col h-full overflow-hidden bg-[var(--aw-bg-0)]">
      {/* Header: two agent columns — this is the legend for every bar/dot below */}
      <div className="shrink-0 border-b border-[var(--aw-bg-2)] bg-[var(--aw-bg-1)]">
        <div className="grid grid-cols-2">
          <div className="flex items-center gap-2 px-3 py-2.5 border-r border-[var(--aw-bg-2)]">
            <span className="w-6 h-6 rounded text-[10px] font-bold flex items-center justify-center shrink-0" style={{ backgroundColor: `${SLOT_A}25`, color: SLOT_A }}>
              {dispA.initials.slice(0, 2)}
            </span>
            <div className="min-w-0 flex-1">
              <div className="text-xs font-semibold truncate" style={{ color: SLOT_A }}>{dispA.shortName}</div>
              <div className="text-[10px] text-[var(--aw-text-3)]">{dispA.typeLabel}</div>
            </div>
          </div>
          <div className="flex items-center gap-2 px-3 py-2.5">
            <span className="w-6 h-6 rounded text-[10px] font-bold flex items-center justify-center shrink-0" style={{ backgroundColor: `${SLOT_B}25`, color: SLOT_B }}>
              {dispB.initials.slice(0, 2)}
            </span>
            <div className="min-w-0 flex-1">
              <div className="text-xs font-semibold truncate" style={{ color: SLOT_B }}>{dispB.shortName}</div>
              <div className="text-[10px] text-[var(--aw-text-3)]">{dispB.typeLabel}</div>
            </div>
            <button onClick={() => setFlipped(f => !f)} title="Swap agents" className="p-1 rounded text-[var(--aw-text-4)] hover:text-[var(--aw-text-0)] hover:bg-[var(--aw-bg-2)] transition-colors shrink-0">
              <ArrowLeftRight className="h-3.5 w-3.5" />
            </button>
          </div>
        </div>

        {/* Sub-tabs */}
        <div className="flex border-t border-[var(--aw-bg-2)]">
          {TABS.map(tab => (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              className={cn(
                'flex-1 text-xs py-1.5 transition-colors border-b-2',
                activeTab === tab.id
                  ? 'text-[var(--aw-text-0)] border-[var(--aw-blue)] bg-[var(--aw-bg-0)]'
                  : 'text-[var(--aw-text-3)] border-transparent hover:text-[var(--aw-text-1)] hover:bg-[var(--aw-bg-0)]/50'
              )}
            >
              {tab.label}
            </button>
          ))}
        </div>
      </div>

      {/* Tab content */}
      <div className="flex-1 overflow-hidden min-h-0">
        {activeTab === 'conversation' && <ConversationCompareTab sessionId={sessionId} a={a} b={b} paneId={paneId} />}
        {activeTab === 'metrics' && (
          <ScrollArea className="h-full">
            <MetricsTab a={a} b={b} />
          </ScrollArea>
        )}
        {activeTab === 'prompts' && <PromptsTab a={a} b={b} />}
        {activeTab === 'tools' && (
          <ScrollArea className="h-full">
            <ToolsTab a={a} b={b} />
          </ScrollArea>
        )}
      </div>
    </div>
  );
}
