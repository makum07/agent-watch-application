'use client';

import { useState, useEffect } from 'react';
import {
  Users, Zap, Clock, DollarSign, Gauge, BarChart3, Database,
  ChevronRight, Loader2, ArrowRight, Download,
  Layers, Sparkles, Wrench, AlertTriangle, Shield,
} from 'lucide-react';
import { ScrollArea } from '@/components/ui/scroll-area';
import { useWorkspaceStore } from '@/store/workspace-store';
import { useSessionStore } from '@/store/session-store';
import { formatTokens, formatDuration, formatCost, cn } from '@/lib/utils';
import { getAgentDisplay } from '@/lib/agent-display';
import { AgentExecutionCard } from '@/components/session/agent-execution-card';
import { ExecutionAnalysis } from '@/components/session/execution-analysis';
import type { ExecutionFacts, AgentFacts } from '@/types/analytics';
import type { PaneTab, LayoutNode } from '@/types/workspace';

interface AnalyticsDashboardProps {
  sessionId: string;
  paneId?: string;
  isSingleTab?: boolean;
}

export function AnalyticsDashboard({ sessionId, paneId }: AnalyticsDashboardProps) {
  const [facts, setFacts] = useState<ExecutionFacts | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const { agentMap } = useSessionStore();

  useEffect(() => {
    setLoading(true);
    setError(null);
    fetch(`/api/v2/sessions/${sessionId}/analytics`)
      .then(r => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return r.json();
      })
      .then(data => setFacts(data))
      .catch(err => setError(String(err)))
      .finally(() => setLoading(false));
  }, [sessionId]);

  const openAgent = (agentId: string) => {
    const agent = agentMap.get(agentId);
    if (!agent) return;
    const { shortName } = getAgentDisplay(agent);
    const tab: PaneTab = { type: 'agent', agentId, label: shortName };
    const store = useWorkspaceStore.getState();

    if (paneId && store.layout) {
      const otherId = findOtherPane(store.layout, paneId);
      if (otherId) {
        store.addTabToPane(otherId, tab);
        return;
      }
    }
    if (store.focusedPaneId) {
      store.addTabToPane(store.focusedPaneId, tab);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-full text-[#6e7681]">
        <Loader2 className="h-5 w-5 animate-spin mr-2" />
        <span className="text-sm">Loading analytics…</span>
      </div>
    );
  }

  if (error || !facts) {
    return (
      <div className="flex items-center justify-center h-full text-[#f85149] text-sm">
        {error || 'Failed to load analytics'}
      </div>
    );
  }

  const { summary, orchestrator, agentFacts, costBreakdown, criticalPath, failedToolCategories } = facts;

  const sections = [
    { id: 'summary', label: 'Summary', icon: <BarChart3 className="h-3 w-3" /> },
    { id: 'hierarchy', label: 'Execution', icon: <Layers className="h-3 w-3" />, badge: summary.totalAgents },
    { id: 'cost', label: 'Cost', icon: <DollarSign className="h-3 w-3" /> },
    { id: 'path', label: 'Path', icon: <ArrowRight className="h-3 w-3" /> },
    { id: 'ai', label: 'AI Analysis', icon: <Sparkles className="h-3 w-3" /> },
    { id: 'export', label: 'Export', icon: <Download className="h-3 w-3" /> },
  ];

  return (
    <ScrollArea className="h-full">
      <div className="p-5 space-y-8 max-w-5xl">
        {/* ── Section Nav ───────────────────────────────────── */}
        <div className="flex items-center gap-1 flex-wrap pb-2 border-b border-[#21262d]">
          {sections.map(s => (
            <a
              key={s.id}
              href={`#analytics-${s.id}`}
              className="flex items-center gap-1 px-2 py-1 rounded text-[10px] text-[#8b949e] hover:text-[#e6edf3] hover:bg-[#21262d] transition-colors"
            >
              {s.icon}
              {s.label}
              {'badge' in s && s.badge != null && s.badge > 0 && (
                <span className="text-[9px] px-1 py-0.5 rounded-full bg-[#21262d] text-[#c9d1d9] font-medium">
                  {s.badge}
                </span>
              )}
            </a>
          ))}
        </div>

        {/* ── Session Summary ───────────────────────────────── */}
        <section id="analytics-summary">
          <SectionHeader title="Session Summary" icon={<BarChart3 className="h-4 w-4" />} />
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <StatCard icon={<Users className="h-3.5 w-3.5 text-[#58a6ff]" />} label="Agents" value={String(summary.totalAgents)} />
            <StatCard icon={<Zap className="h-3.5 w-3.5 text-[#d29922]" />} label="Tokens" value={formatTokens(summary.totalTokens)} />
            <StatCard icon={<DollarSign className="h-3.5 w-3.5 text-[#3fb950]" />} label="Est. Cost" value={formatCost(summary.totalCost)} />
            <StatCard icon={<Clock className="h-3.5 w-3.5 text-[#bc8cff]" />} label="Wall Clock" value={formatDuration(summary.wallClock)} />
            <StatCard icon={<Wrench className="h-3.5 w-3.5 text-[#79c0ff]" />} label="Tool Calls" value={String(summary.totalToolCalls)} />
            <StatCard icon={<Gauge className="h-3.5 w-3.5 text-[#f778ba]" />} label="Parallelism" value={`${summary.parallelismFactor.toFixed(1)}×`} />
            <StatCard icon={<Database className="h-3.5 w-3.5 text-[#79c0ff]" />} label="Cache Eff." value={`${(summary.cacheEfficiency * 100).toFixed(0)}%`} />
            <StatCard icon={<Layers className="h-3.5 w-3.5 text-[#f0883e]" />} label="Max Depth" value={String(summary.maxDepth)} />
            {summary.totalFailedToolCalls > 0 && (
              <FailedToolsDrilldown
                total={summary.totalFailedToolCalls}
                categories={failedToolCategories}
              />
            )}
            {summary.totalDeniedToolCalls > 0 && (
              <StatCard
                icon={<Shield className="h-3.5 w-3.5 text-[#d29922]" />}
                label="Denied Tools"
                value={String(summary.totalDeniedToolCalls)}
              />
            )}
          </div>
          {summary.modelsUsed.length > 0 && (
            <div className="mt-3 flex items-center gap-1 flex-wrap">
              <span className="text-[10px] text-[#6e7681]">Models:</span>
              {summary.modelsUsed.map(m => (
                <span key={m} className="text-[9px] px-1.5 py-0.5 rounded bg-[#21262d] text-[#8b949e]">{m}</span>
              ))}
            </div>
          )}
        </section>

        {/* ── Agent Executions (execution order) ─────────── */}
        <section id="analytics-hierarchy">
          <SectionHeader
            title="Execution Flow"
            icon={<Layers className="h-4 w-4" />}
            badge={String(summary.totalAgents)}
          />
          <p className="text-xs text-[#8b949e] mb-3">Agents listed in execution order. Indentation shows spawn depth.</p>
          <div className="space-y-1">
            {[...agentFacts]
              .sort((a, b) => new Date(a.startTime).getTime() - new Date(b.startTime).getTime())
              .map(agent => (
                <div key={agent.agentId} style={{ marginLeft: agent.depth * 20 }}>
                  <AgentExecutionCard agent={agent} sessionId={sessionId} onAgentClick={openAgent} />
                </div>
              ))}
          </div>
        </section>

        {/* ── Cost Breakdown ─────────────────────────────────── */}
        <section id="analytics-cost">
          <SectionHeader title="Cost Breakdown" icon={<DollarSign className="h-4 w-4" />} />
          <CostByModel data={costBreakdown.byModel} />
          <div className="mt-4">
            <h3 className="text-[10px] text-[#6e7681] uppercase tracking-wide mb-2">Top Agents by Cost</h3>
            <div className="space-y-1">
              {costBreakdown.byAgent.slice(0, 15).map((entry, i) => {
                const agent = agentMap.get(entry.agentId);
                const display = agent ? getAgentDisplay(agent) : null;
                return (
                  <button
                    key={entry.agentId}
                    onClick={() => openAgent(entry.agentId)}
                    className="w-full flex items-center gap-2.5 px-3 py-2 rounded hover:bg-[#161b22] transition-colors text-left group"
                  >
                    <span className="text-[10px] text-[#484f58] w-5 text-right font-mono">{i + 1}</span>
                    {display && (
                      <div
                        className="w-5 h-5 rounded flex items-center justify-center text-[8px] font-bold border shrink-0"
                        style={{ backgroundColor: display.color.bg, color: display.color.text, borderColor: display.color.border }}
                      >
                        {display.initials.slice(0, 2)}
                      </div>
                    )}
                    <span className="text-xs text-[#c9d1d9] truncate flex-1 group-hover:text-[#e6edf3]">
                      {entry.name}
                    </span>
                    <span className="text-[10px] font-mono text-[#8b949e] w-16 text-right">{formatTokens(entry.tokens)}</span>
                    <span className="text-[10px] font-mono text-[#8b949e] w-14 text-right">{formatDuration(entry.durationMs)}</span>
                    <span className="text-[10px] font-mono text-[#e6edf3] w-16 text-right">{formatCost(entry.cost)}</span>
                  </button>
                );
              })}
            </div>
          </div>
        </section>

        {/* ── Critical Path ──────────────────────────────────── */}
        {criticalPath.length > 1 && (
          <section id="analytics-path">
            <SectionHeader title="Critical Path" icon={<ArrowRight className="h-4 w-4" />} />
            <p className="text-xs text-[#8b949e] mb-3">
              Longest execution chain from root to leaf — the bottleneck for overall session duration.
            </p>
            <div className="flex items-center gap-1 overflow-x-auto pb-2">
              {criticalPath.map((node, i) => {
                const agent = agentMap.get(node.agentId);
                const display = agent ? getAgentDisplay(agent) : null;
                return (
                  <div key={node.agentId} className="flex items-center gap-1 shrink-0">
                    <button
                      onClick={() => openAgent(node.agentId)}
                      className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-md border border-[#30363d] bg-[#161b22] hover:bg-[#21262d] hover:border-[#58a6ff]/30 transition-colors"
                    >
                      {display && (
                        <div
                          className="w-5 h-5 rounded flex items-center justify-center text-[8px] font-bold border"
                          style={{ backgroundColor: display.color.bg, color: display.color.text, borderColor: display.color.border }}
                        >
                          {display.initials.slice(0, 2)}
                        </div>
                      )}
                      <div className="text-left">
                        <div className="text-[10px] text-[#e6edf3] font-medium leading-tight">
                          {node.name.length > 20 ? node.name.slice(0, 18) + '…' : node.name}
                        </div>
                        <div className="text-[9px] text-[#8b949e] font-mono">{formatDuration(node.durationMs)}</div>
                      </div>
                    </button>
                    {i < criticalPath.length - 1 && (
                      <ChevronRight className="h-3 w-3 text-[#484f58] shrink-0" />
                    )}
                  </div>
                );
              })}
            </div>
            <div className="mt-2 text-xs text-[#6e7681]">
              Total critical path: {formatDuration(criticalPath.reduce((s, n) => s + n.durationMs, 0))}
            </div>
          </section>
        )}

        {/* ── AI Analysis ────────────────────────────────────── */}
        <section id="analytics-ai">
          <SectionHeader title="AI Analysis" icon={<Sparkles className="h-4 w-4" />} />
          <p className="text-xs text-[#8b949e] mb-3">
            Deep analysis powered by Claude. Requires WebSocket server running (<code className="text-[10px] px-1 py-0.5 rounded bg-[#21262d] text-[#c9d1d9]">npm run dev:server</code>).
          </p>
          <ExecutionAnalysis sessionId={sessionId} />
        </section>

        {/* ── Export ──────────────────────────────────────────── */}
        <section id="analytics-export">
          <SectionHeader title="Export" icon={<Download className="h-4 w-4" />} />
          <div className="flex items-center gap-2">
            {(['json', 'markdown', 'html'] as const).map(fmt => (
              <a
                key={fmt}
                href={`/api/v2/sessions/${sessionId}/export?format=${fmt}`}
                download
                className="flex items-center gap-1.5 px-3 py-2 rounded-md border border-[#30363d] bg-[#161b22] hover:bg-[#21262d] hover:border-[#58a6ff]/30 text-xs text-[#c9d1d9] hover:text-[#e6edf3] transition-colors"
              >
                <Download className="h-3 w-3" />
                {fmt.toUpperCase()}
              </a>
            ))}
          </div>
        </section>
      </div>
    </ScrollArea>
  );
}

// ── Sub-components ──────────────────────────────────────────────────────

function SectionHeader({ title, icon, badge }: { title: string; icon: React.ReactNode; badge?: string }) {
  return (
    <div className="flex items-center gap-2 mb-3">
      <span className="text-[#6e7681]">{icon}</span>
      <h2 className="text-sm font-semibold text-[#e6edf3]">{title}</h2>
      {badge && (
        <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-[#21262d] text-[#c9d1d9] font-medium">
          {badge}
        </span>
      )}
    </div>
  );
}

function StatCard({ icon, label, value }: { icon: React.ReactNode; label: string; value: string }) {
  return (
    <div className="p-3 rounded-lg border border-[#21262d] bg-[#161b22]">
      <div className="flex items-center gap-1.5 mb-1">
        {icon}
        <span className="text-[10px] text-[#8b949e]">{label}</span>
      </div>
      <div className="text-lg font-semibold text-[#e6edf3] leading-tight">{value}</div>
    </div>
  );
}

function CostByModel({ data }: { data: ExecutionFacts['costBreakdown']['byModel'] }) {
  if (data.length === 0) return null;

  const MODEL_COLORS = ['#58a6ff', '#bc8cff', '#3fb950', '#f0883e', '#ff9a85', '#f778ba'];
  const total = data.reduce((s, d) => s + d.cost, 0);

  return (
    <div>
      <h3 className="text-[10px] text-[#6e7681] uppercase tracking-wide mb-2">By Model</h3>
      <div className="space-y-2">
        {data.map((d, i) => {
          const pct = total > 0 ? (d.cost / total) * 100 : 0;
          return (
            <div key={d.model}>
              <div className="flex items-center gap-2 mb-0.5">
                <div className="w-2.5 h-2.5 rounded-sm shrink-0" style={{ backgroundColor: MODEL_COLORS[i % MODEL_COLORS.length] }} />
                <span className="text-xs text-[#c9d1d9] truncate flex-1">{d.model}</span>
                <span className="text-[10px] text-[#8b949e]">{d.agentCount} agent{d.agentCount !== 1 ? 's' : ''}</span>
                <span className="text-[10px] font-mono text-[#8b949e]">{formatTokens(d.tokens)}</span>
                <span className="text-[10px] font-mono text-[#e6edf3]">{formatCost(d.cost)}</span>
              </div>
              <div className="ml-4.5 h-1.5 rounded-full bg-[#21262d] overflow-hidden">
                <div
                  className="h-full rounded-full transition-all"
                  style={{ width: `${pct}%`, backgroundColor: MODEL_COLORS[i % MODEL_COLORS.length] }}
                />
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function FailedToolsDrilldown({
  total,
  categories,
}: {
  total: number;
  categories: ExecutionFacts['failedToolCategories'];
}) {
  const [open, setOpen] = useState(false);

  return (
    <div className="p-3 rounded-lg border border-[#21262d] bg-[#161b22]">
      <button
        onClick={() => setOpen(v => !v)}
        className="w-full text-left"
      >
        <div className="flex items-center gap-1.5 mb-1">
          <AlertTriangle className="h-3.5 w-3.5 text-[#f85149]" />
          <span className="text-[10px] text-[#8b949e]">Failed Tools</span>
          {categories.length > 0 && (
            <ChevronRight className={cn('h-3 w-3 text-[#484f58] ml-auto transition-transform', open && 'rotate-90')} />
          )}
        </div>
        <div className="text-lg font-semibold text-[#e6edf3] leading-tight">{total}</div>
      </button>
      {open && categories.length > 0 && (
        <div className="mt-2 pt-2 border-t border-[#21262d] space-y-1">
          {categories.map(cat => (
            <div key={cat.category} className="flex items-center gap-2 text-[10px]">
              <span className="text-[#c9d1d9] flex-1">{cat.category}</span>
              <span className="font-mono text-[#f85149]">{cat.count}</span>
              <span className="text-[#484f58]">
                {cat.agentIds.length} agent{cat.agentIds.length !== 1 ? 's' : ''}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function findOtherPane(node: LayoutNode, excludePaneId: string): string | null {
  if (node.type === 'pane') {
    return node.id !== excludePaneId ? node.id : null;
  }
  return findOtherPane(node.children[0], excludePaneId) || findOtherPane(node.children[1], excludePaneId);
}
