'use client';

import { useState } from 'react';
import { ArrowLeftRight } from 'lucide-react';
import { useSessionStore } from '@/store/session-store';
import { useWorkspaceStore } from '@/store/workspace-store';
import { getAgentDisplay, getStatusDisplay } from '@/lib/agent-display';
import { formatTokens, formatDuration, formatCost, cn } from '@/lib/utils';
import { MarkdownRenderer } from '@/components/shared/markdown-renderer';
import { ScrollArea } from '@/components/ui/scroll-area';
import type { Agent } from '@/types/session';

type CompareTab = 'metrics' | 'prompts' | 'tools';

interface ComparisonViewProps {
  sessionId: string;
  agentAId: string;
  agentBId: string;
  paneId?: string;
}

const TABS: { id: CompareTab; label: string }[] = [
  { id: 'metrics', label: 'Metrics' },
  { id: 'prompts', label: 'Prompts' },
  { id: 'tools', label: 'Tools' },
];

function formatTimestamp(iso: string): string {
  try {
    return new Date(iso).toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit', second: '2-digit' });
  } catch { return iso; }
}

function diffClass(a: number, b: number): string {
  if (a === 0 && b === 0) return '';
  const pct = b === 0 ? Infinity : Math.abs(a - b) / b;
  if (pct < 0.2) return '';
  return a > b ? 'text-red-400' : 'text-green-400';
}

function DiffRow({ label, a, b, format }: { label: string; a: string; b: string; format?: 'number' }) {
  const aNum = format === 'number' ? parseFloat(a.replace(/,/g, '')) : NaN;
  const bNum = format === 'number' ? parseFloat(b.replace(/,/g, '')) : NaN;
  const aClass = !isNaN(aNum) && !isNaN(bNum) ? diffClass(aNum, bNum) : '';
  const bClass = !isNaN(aNum) && !isNaN(bNum) ? diffClass(bNum, aNum) : '';

  return (
    <div className="flex items-center text-sm">
      <span className="text-[var(--aw-text-3)] text-xs w-28 shrink-0">{label}</span>
      <span className={cn('font-mono text-xs flex-1 text-right pr-4', aClass || 'text-[var(--aw-text-1)]')}>{a}</span>
      <span className={cn('font-mono text-xs flex-1 text-right', bClass || 'text-[var(--aw-text-1)]')}>{b}</span>
    </div>
  );
}

function SectionHeader({ label }: { label: string }) {
  return <div className="text-[10px] font-semibold uppercase tracking-wide text-[var(--aw-text-3)] mt-4 mb-1.5 first:mt-0">{label}</div>;
}

function MetricsTab({ a, b }: { a: Agent; b: Agent }) {
  return (
    <div className="p-4 space-y-0.5">
      <SectionHeader label="Identity" />
      <DiffRow label="Type" a={a.subagentType || a.type} b={b.subagentType || b.type} />
      <DiffRow label="Model" a={a.model || '—'} b={b.model || '—'} />
      <DiffRow label="Status" a={getStatusDisplay(a).title} b={getStatusDisplay(b).title} />
      <DiffRow label="Depth" a={String(a.depth)} b={String(b.depth)} />

      <SectionHeader label="Timing" />
      <DiffRow label="Duration" a={formatDuration(a.durationMs)} b={formatDuration(b.durationMs)} format="number" />
      <DiffRow label="Messages" a={String(a.messageCount)} b={String(b.messageCount)} format="number" />
      <DiffRow label="Children" a={String(a.children.length)} b={String(b.children.length)} format="number" />

      <SectionHeader label="Tokens" />
      <DiffRow label="Input" a={formatTokens(a.tokenUsage.input)} b={formatTokens(b.tokenUsage.input)} format="number" />
      <DiffRow label="Output" a={formatTokens(a.tokenUsage.output)} b={formatTokens(b.tokenUsage.output)} format="number" />
      <DiffRow label="Cache Created" a={formatTokens(a.tokenUsage.cacheCreation)} b={formatTokens(b.tokenUsage.cacheCreation)} format="number" />
      <DiffRow label="Cache Read" a={formatTokens(a.tokenUsage.cacheRead)} b={formatTokens(b.tokenUsage.cacheRead)} format="number" />
      <DiffRow label="Total" a={formatTokens(a.tokenUsage.total)} b={formatTokens(b.tokenUsage.total)} format="number" />
    </div>
  );
}

function PromptsTab({ a, b }: { a: Agent; b: Agent }) {
  return (
    <div className="grid grid-cols-2 gap-0 h-full">
      <div className="border-r border-[var(--aw-bg-2)] overflow-y-auto">
        <div className="p-3 space-y-4">
          {a.prompt && (
            <div>
              <div className="text-[10px] font-semibold uppercase tracking-wide text-[var(--aw-text-3)] mb-1.5">Prompt</div>
              <div className="rounded-md bg-[var(--aw-blue-bg-deep)] border border-[var(--aw-blue-bg)]/30 p-3">
                <MarkdownRenderer content={a.prompt} />
              </div>
            </div>
          )}
          {a.response && (
            <div>
              <div className="text-[10px] font-semibold uppercase tracking-wide text-[var(--aw-text-3)] mb-1.5">Response</div>
              <div className="rounded-md bg-[var(--aw-green-bg-deep)] border border-[var(--aw-green-bg-2)]/30 p-3">
                <MarkdownRenderer content={a.response} />
              </div>
            </div>
          )}
          {!a.prompt && !a.response && (
            <div className="text-xs text-[var(--aw-text-4)] italic pt-2">No prompt / response recorded</div>
          )}
        </div>
      </div>
      <div className="overflow-y-auto">
        <div className="p-3 space-y-4">
          {b.prompt && (
            <div>
              <div className="text-[10px] font-semibold uppercase tracking-wide text-[var(--aw-text-3)] mb-1.5">Prompt</div>
              <div className="rounded-md bg-[var(--aw-blue-bg-deep)] border border-[var(--aw-blue-bg)]/30 p-3">
                <MarkdownRenderer content={b.prompt} />
              </div>
            </div>
          )}
          {b.response && (
            <div>
              <div className="text-[10px] font-semibold uppercase tracking-wide text-[var(--aw-text-3)] mb-1.5">Response</div>
              <div className="rounded-md bg-[var(--aw-green-bg-deep)] border border-[var(--aw-green-bg-2)]/30 p-3">
                <MarkdownRenderer content={b.response} />
              </div>
            </div>
          )}
          {!b.prompt && !b.response && (
            <div className="text-xs text-[var(--aw-text-4)] italic pt-2">No prompt / response recorded</div>
          )}
        </div>
      </div>
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
    <div className="p-4 space-y-0.5">
      <div className="flex items-center text-[10px] text-[var(--aw-text-4)] mb-2">
        <span className="w-28 shrink-0">Tool</span>
        <span className="flex-1 text-right pr-4">A</span>
        <span className="flex-1 text-right">B</span>
      </div>
      {sortedTools.map(tool => (
        <DiffRow
          key={tool}
          label={tool}
          a={aMap.has(tool) ? String(aMap.get(tool)) : '—'}
          b={bMap.has(tool) ? String(bMap.get(tool)) : '—'}
          format="number"
        />
      ))}
    </div>
  );
}

export function ComparisonView({ sessionId, agentAId, agentBId, paneId }: ComparisonViewProps) {
  const { agentMap } = useSessionStore();
  const [activeTab, setActiveTab] = useState<CompareTab>('metrics');
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
      {/* Header: two agent columns */}
      <div className="shrink-0 border-b border-[var(--aw-bg-2)] bg-[var(--aw-bg-1)]">
        <div className="grid grid-cols-2">
          <div className="flex items-center gap-2 px-3 py-2.5 border-r border-[var(--aw-bg-2)]">
            <span className="w-6 h-6 rounded text-[10px] font-bold flex items-center justify-center shrink-0" style={{ backgroundColor: dispA.color.bg, color: dispA.color.text }}>
              {dispA.initials.slice(0, 2)}
            </span>
            <div className="min-w-0 flex-1">
              <div className="text-xs font-semibold truncate" style={{ color: dispA.color.text }}>{dispA.shortName}</div>
              <div className="text-[10px] text-[var(--aw-text-3)]">{dispA.typeLabel}</div>
            </div>
          </div>
          <div className="flex items-center gap-2 px-3 py-2.5">
            <span className="w-6 h-6 rounded text-[10px] font-bold flex items-center justify-center shrink-0" style={{ backgroundColor: dispB.color.bg, color: dispB.color.text }}>
              {dispB.initials.slice(0, 2)}
            </span>
            <div className="min-w-0 flex-1">
              <div className="text-xs font-semibold truncate" style={{ color: dispB.color.text }}>{dispB.shortName}</div>
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
