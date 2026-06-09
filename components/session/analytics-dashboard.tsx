'use client';

import { useState, useEffect } from 'react';
import {
  Users, Zap, Clock, DollarSign, Activity, Gauge, BarChart3, Database,
  ChevronRight, Loader2, ArrowRight, Download,
} from 'lucide-react';
import { ScrollArea } from '@/components/ui/scroll-area';
import { useWorkspaceStore } from '@/store/workspace-store';
import { useSessionStore } from '@/store/session-store';
import { formatTokens, formatDuration, formatCost, cn } from '@/lib/utils';
import { getAgentDisplay } from '@/lib/agent-display';
import { CostBreakdown } from '@/components/session/cost-breakdown';
import { DebugAlerts } from '@/components/session/debug-alerts';
import type { SessionAnalytics } from '@/types/analytics';
import type { PaneTab, LayoutNode } from '@/types/workspace';

interface AnalyticsDashboardProps {
  sessionId: string;
  paneId?: string;
  isSingleTab?: boolean;
}

export function AnalyticsDashboard({ sessionId, paneId }: AnalyticsDashboardProps) {
  const [analytics, setAnalytics] = useState<SessionAnalytics | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [sortField, setSortField] = useState<'cost' | 'tokens' | 'durationMs'>('cost');
  const { agentMap } = useSessionStore();

  useEffect(() => {
    setLoading(true);
    setError(null);
    fetch(`/api/v2/sessions/${sessionId}/analytics`)
      .then(r => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return r.json();
      })
      .then(data => setAnalytics(data))
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

  const agentNameMap = new Map<string, string>();
  for (const [id, agent] of agentMap) {
    agentNameMap.set(id, getAgentDisplay(agent).shortName);
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center h-full text-[#6e7681]">
        <Loader2 className="h-5 w-5 animate-spin mr-2" />
        <span className="text-sm">Loading analytics…</span>
      </div>
    );
  }

  if (error || !analytics) {
    return (
      <div className="flex items-center justify-center h-full text-[#f85149] text-sm">
        {error || 'Failed to load analytics'}
      </div>
    );
  }

  const { summary, costBreakdown, criticalPath, alerts } = analytics;

  const sortedAgents = [...costBreakdown.byAgent].sort((a, b) => b[sortField] - a[sortField]);

  return (
    <ScrollArea className="h-full">
      <div className="p-5 space-y-8 max-w-5xl">
        {/* ── Summary Metrics ───────────────────────────────── */}
        <section>
          <SectionHeader title="Summary" icon={<BarChart3 className="h-4 w-4" />} />
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <StatCard icon={<Users className="h-3.5 w-3.5 text-[#58a6ff]" />} label="Agents" value={String(summary.totalAgents)} />
            <StatCard icon={<Zap className="h-3.5 w-3.5 text-[#d29922]" />} label="Tokens" value={formatTokens(summary.totalTokens)} />
            <StatCard icon={<DollarSign className="h-3.5 w-3.5 text-[#3fb950]" />} label="Est. Cost" value={formatCost(summary.totalCost)} />
            <StatCard icon={<Clock className="h-3.5 w-3.5 text-[#bc8cff]" />} label="Wall Clock" value={formatDuration(summary.wallClock)} />
            <StatCard icon={<Activity className="h-3.5 w-3.5 text-[#f0883e]" />} label="Agent Time" value={formatDuration(summary.agentTime)} />
            <StatCard icon={<Gauge className="h-3.5 w-3.5 text-[#f778ba]" />} label="Parallelism" value={`${summary.parallelismFactor.toFixed(1)}×`} />
            <StatCard icon={<Database className="h-3.5 w-3.5 text-[#79c0ff]" />} label="Cache Eff." value={`${(summary.cacheEfficiency * 100).toFixed(0)}%`} />
            <StatCard icon={<Zap className="h-3.5 w-3.5 text-[#8b949e]" />} label="Avg Tokens" value={formatTokens(summary.avgTokensPerAgent)} sub="per agent" />
          </div>
        </section>

        {/* ── Debug Alerts ───────────────────────────────────── */}
        <section>
          <SectionHeader
            title="Debug Alerts"
            icon={<Activity className="h-4 w-4" />}
            badge={alerts.length > 0 ? String(alerts.length) : undefined}
          />
          <DebugAlerts
            alerts={alerts}
            agentNames={agentNameMap}
            onAgentClick={openAgent}
          />
        </section>

        {/* ── Cost Breakdown ─────────────────────────────────── */}
        <section>
          <SectionHeader title="Cost Breakdown" icon={<DollarSign className="h-4 w-4" />} />
          <CostBreakdown costBreakdown={costBreakdown} onAgentClick={openAgent} />
        </section>

        {/* ── Critical Path ──────────────────────────────────── */}
        {criticalPath.length > 1 && (
          <section>
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

        {/* ── Top Agents Table ────────────────────────────────── */}
        <section>
          <SectionHeader title="Agents by Cost" icon={<Users className="h-4 w-4" />} />
          <div className="flex items-center gap-1 mb-3 text-[10px]">
            <span className="text-[#6e7681] mr-1">Sort:</span>
            {(['cost', 'tokens', 'durationMs'] as const).map(f => (
              <button
                key={f}
                onClick={() => setSortField(f)}
                className={cn(
                  'px-2 py-0.5 rounded transition-colors',
                  sortField === f
                    ? 'bg-[#21262d] text-[#e6edf3]'
                    : 'text-[#6e7681] hover:text-[#c9d1d9]'
                )}
              >
                {f === 'durationMs' ? 'Duration' : f.charAt(0).toUpperCase() + f.slice(1)}
              </button>
            ))}
          </div>
          <div className="space-y-1">
            {sortedAgents.slice(0, 20).map((entry, i) => {
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
        </section>

        {/* ── Export ──────────────────────────────────────────── */}
        <section>
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
        <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-[#d29922]/15 text-[#d29922] font-medium">
          {badge}
        </span>
      )}
    </div>
  );
}

function StatCard({ icon, label, value, sub }: { icon: React.ReactNode; label: string; value: string; sub?: string }) {
  return (
    <div className="p-3 rounded-lg border border-[#21262d] bg-[#161b22]">
      <div className="flex items-center gap-1.5 mb-1">
        {icon}
        <span className="text-[10px] text-[#8b949e]">{label}</span>
      </div>
      <div className="text-lg font-semibold text-[#e6edf3] leading-tight">{value}</div>
      {sub && <div className="text-[9px] text-[#484f58] mt-0.5">{sub}</div>}
    </div>
  );
}

function findOtherPane(node: LayoutNode, excludePaneId: string): string | null {
  if (node.type === 'pane') {
    return node.id !== excludePaneId ? node.id : null;
  }
  return findOtherPane(node.children[0], excludePaneId) || findOtherPane(node.children[1], excludePaneId);
}
