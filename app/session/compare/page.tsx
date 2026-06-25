'use client';

import { useState, useEffect } from 'react';
import { useSearchParams } from 'next/navigation';
import Link from 'next/link';
import {
  Layers, Loader2, Search, ArrowUpRight, ArrowDownRight, Minus,
  Users, Zap, Clock, DollarSign,
} from 'lucide-react';
import { ScrollArea } from '@/components/ui/scroll-area';
import { formatTokens, formatDuration, formatCost, cn } from '@/lib/utils';
import type { SessionComparisonData } from '@/types/analytics';

interface DiscoveredSession {
  id: string;
  projectDisplayName: string;
  lastModified: string;
}

export default function ComparePage() {
  const searchParams = useSearchParams();
  const [sessionIdA, setSessionIdA] = useState(searchParams.get('a') || '');
  const [sessionIdB, setSessionIdB] = useState(searchParams.get('b') || '');
  const [sessions, setSessions] = useState<DiscoveredSession[]>([]);
  const [comparison, setComparison] = useState<SessionComparisonData | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch('/api/v2/sessions')
      .then(r => r.json())
      .then(d => setSessions(d.sessions ?? []))
      .catch(() => {});
  }, []);

  useEffect(() => {
    if (!sessionIdA || !sessionIdB || sessionIdA === sessionIdB) {
      setComparison(null);
      return;
    }
    setLoading(true);
    setError(null);
    fetch(`/api/v2/sessions/compare?a=${sessionIdA}&b=${sessionIdB}`)
      .then(r => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return r.json();
      })
      .then(data => setComparison(data))
      .catch(err => setError(String(err)))
      .finally(() => setLoading(false));
  }, [sessionIdA, sessionIdB]);

  return (
    <div className="h-screen bg-[#0d1117] flex flex-col">
      <header className="border-b border-[#21262d] shrink-0">
        <div className="max-w-5xl mx-auto px-6 py-3 flex items-center gap-3">
          <Link href="/" className="text-[#8b949e] hover:text-[#e6edf3]"><Layers className="h-4 w-4" /></Link>
          <span className="text-[#484f58]">/</span>
          <span className="text-sm font-medium text-[#e6edf3]">Session Comparison</span>
        </div>
      </header>

      <div className="flex-1 overflow-hidden">
        <ScrollArea className="h-full">
          <div className="max-w-5xl mx-auto px-6 py-6 space-y-6">
            {/* Session pickers */}
            <div className="grid grid-cols-2 gap-4">
              <SessionPicker
                label="Session A"
                sessions={sessions}
                value={sessionIdA}
                onChange={setSessionIdA}
              />
              <SessionPicker
                label="Session B"
                sessions={sessions}
                value={sessionIdB}
                onChange={setSessionIdB}
              />
            </div>

            {loading && (
              <div className="flex items-center justify-center py-12 text-[#6e7681]">
                <Loader2 className="h-5 w-5 animate-spin mr-2" />
                Comparing sessions…
              </div>
            )}

            {error && (
              <div className="text-center py-8 text-[#f85149] text-sm">{error}</div>
            )}

            {!loading && !error && !comparison && sessionIdA && sessionIdB && sessionIdA !== sessionIdB && (
              <div className="text-center py-8 text-[#6e7681] text-sm">Select two different sessions to compare</div>
            )}

            {comparison && (
              <>
                {/* Delta cards */}
                <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                  <DeltaCard
                    icon={<DollarSign className="h-3.5 w-3.5" />}
                    label="Cost"
                    valueA={formatCost(comparison.sessionA.summary.totalCost)}
                    valueB={formatCost(comparison.sessionB.summary.totalCost)}
                    delta={comparison.deltas.costDelta}
                    invertColor
                  />
                  <DeltaCard
                    icon={<Zap className="h-3.5 w-3.5" />}
                    label="Tokens"
                    valueA={formatTokens(comparison.sessionA.summary.totalTokens)}
                    valueB={formatTokens(comparison.sessionB.summary.totalTokens)}
                    delta={comparison.deltas.tokenDelta}
                    invertColor
                  />
                  <DeltaCard
                    icon={<Clock className="h-3.5 w-3.5" />}
                    label="Duration"
                    valueA={formatDuration(comparison.sessionA.summary.wallClock)}
                    valueB={formatDuration(comparison.sessionB.summary.wallClock)}
                    delta={comparison.deltas.durationDelta}
                    invertColor
                  />
                  <DeltaCard
                    icon={<Users className="h-3.5 w-3.5" />}
                    label="Agents"
                    valueA={String(comparison.sessionA.summary.totalAgents)}
                    valueB={String(comparison.sessionB.summary.totalAgents)}
                    delta={comparison.deltas.agentCountDelta}
                  />
                </div>

                {/* Side-by-side metrics */}
                <div className="grid grid-cols-2 gap-4">
                  <MetricsPanel label="Session A" data={comparison.sessionA} />
                  <MetricsPanel label="Session B" data={comparison.sessionB} />
                </div>

                {/* Alert comparison */}
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <h3 className="text-xs font-semibold text-[#8b949e] uppercase tracking-wide mb-2">
                      Alerts — Session A ({comparison.sessionA.alerts.length})
                    </h3>
                    <AlertList alerts={comparison.sessionA.alerts} />
                  </div>
                  <div>
                    <h3 className="text-xs font-semibold text-[#8b949e] uppercase tracking-wide mb-2">
                      Alerts — Session B ({comparison.sessionB.alerts.length})
                    </h3>
                    <AlertList alerts={comparison.sessionB.alerts} />
                  </div>
                </div>
              </>
            )}
          </div>
        </ScrollArea>
      </div>
    </div>
  );
}

function SessionPicker({ label, sessions, value, onChange }: {
  label: string;
  sessions: DiscoveredSession[];
  value: string;
  onChange: (id: string) => void;
}) {
  const [search, setSearch] = useState('');
  const [open, setOpen] = useState(false);

  const filtered = search.trim()
    ? sessions.filter(s =>
        s.projectDisplayName.toLowerCase().includes(search.toLowerCase()) ||
        s.id.toLowerCase().includes(search.toLowerCase())
      )
    : sessions;

  const selected = sessions.find(s => s.id === value);

  return (
    <div className="relative">
      <label className="text-[10px] text-[#8b949e] uppercase tracking-wide font-semibold mb-1 block">{label}</label>
      <button
        onClick={() => setOpen(!open)}
        className="w-full text-left px-3 py-2 rounded-md border border-[#30363d] bg-[#161b22] hover:border-[#484f58] transition-colors"
      >
        {selected ? (
          <div>
            <div className="text-xs text-[#e6edf3] truncate">{selected.projectDisplayName}</div>
            <div className="text-[10px] text-[#6e7681] font-mono">{selected.id.slice(0, 16)}…</div>
          </div>
        ) : (
          <span className="text-xs text-[#484f58]">Select session…</span>
        )}
      </button>

      {open && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setOpen(false)} />
          <div className="absolute left-0 right-0 top-full mt-1 z-50 bg-[#161b22] border border-[#30363d] rounded-md shadow-xl max-h-64 overflow-hidden flex flex-col">
            <div className="flex items-center gap-1.5 px-3 py-2 border-b border-[#21262d]">
              <Search className="h-3 w-3 text-[#484f58]" />
              <input
                type="text"
                autoFocus
                value={search}
                onChange={e => setSearch(e.target.value)}
                placeholder="Search sessions…"
                className="flex-1 text-xs bg-transparent text-[#e6edf3] placeholder-[#484f58] outline-none"
                onKeyDown={e => { if (e.key === 'Escape') setOpen(false); }}
              />
            </div>
            <div className="overflow-y-auto py-1">
              {filtered.slice(0, 50).map(s => (
                <button
                  key={s.id}
                  onClick={() => { onChange(s.id); setOpen(false); setSearch(''); }}
                  className={cn(
                    'w-full text-left px-3 py-2 hover:bg-[#21262d] transition-colors',
                    s.id === value && 'bg-[#21262d]'
                  )}
                >
                  <div className="text-xs text-[#c9d1d9] truncate">{s.projectDisplayName}</div>
                  <div className="text-[10px] text-[#6e7681] font-mono">{s.id.slice(0, 16)}</div>
                </button>
              ))}
              {filtered.length === 0 && (
                <div className="px-3 py-4 text-xs text-[#484f58] text-center">No sessions found</div>
              )}
            </div>
          </div>
        </>
      )}
    </div>
  );
}

function DeltaCard({ icon, label, valueA, valueB, delta, invertColor = false }: {
  icon: React.ReactNode;
  label: string;
  valueA: string;
  valueB: string;
  delta: number;
  invertColor?: boolean;
}) {
  const isUp = delta > 1;
  const isDown = delta < -1;
  const neutral = !isUp && !isDown;

  const color = neutral
    ? '#8b949e'
    : (invertColor ? (isUp ? '#f85149' : '#3fb950') : (isUp ? '#3fb950' : '#f85149'));

  return (
    <div className="p-3 rounded-lg border border-[#21262d] bg-[#161b22]">
      <div className="flex items-center gap-1.5 mb-2">
        <span className="text-[#6e7681]">{icon}</span>
        <span className="text-[10px] text-[#8b949e]">{label}</span>
      </div>
      <div className="flex items-baseline justify-between gap-2">
        <div>
          <div className="text-xs text-[#8b949e]">A: <span className="text-[#c9d1d9] font-mono">{valueA}</span></div>
          <div className="text-xs text-[#8b949e]">B: <span className="text-[#c9d1d9] font-mono">{valueB}</span></div>
        </div>
        <div className="flex items-center gap-0.5" style={{ color }}>
          {isUp && <ArrowUpRight className="h-3.5 w-3.5" />}
          {isDown && <ArrowDownRight className="h-3.5 w-3.5" />}
          {neutral && <Minus className="h-3.5 w-3.5" />}
          <span className="text-sm font-semibold">{Math.abs(delta).toFixed(0)}%</span>
        </div>
      </div>
    </div>
  );
}

function MetricsPanel({ label, data }: {
  label: string;
  data: SessionComparisonData['sessionA'];
}) {
  return (
    <div className="rounded-lg border border-[#21262d] bg-[#161b22] p-4">
      <h3 className="text-xs font-semibold text-[#e6edf3] mb-3">{label}: {data.project}</h3>
      <div className="space-y-1.5 text-xs">
        <MetricRow label="Agents" value={String(data.summary.totalAgents)} />
        <MetricRow label="Tokens" value={formatTokens(data.summary.totalTokens)} />
        <MetricRow label="Cost" value={formatCost(data.summary.totalCost)} />
        <MetricRow label="Wall Clock" value={formatDuration(data.summary.wallClock)} />
        <MetricRow label="Agent Time" value={formatDuration(data.summary.agentTime)} />
        <MetricRow label="Parallelism" value={`${data.summary.parallelismFactor.toFixed(1)}×`} />
        <MetricRow label="Tool Calls" value={String(data.summary.totalToolCalls)} />
        <MetricRow label="Cache Eff." value={`${(data.summary.cacheEfficiency * 100).toFixed(0)}%`} />
        <MetricRow label="Models" value={data.costBreakdown.byModel.map(m => m.model.replace('claude-', '')).join(', ')} />
      </div>
    </div>
  );
}

function MetricRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between">
      <span className="text-[#8b949e]">{label}</span>
      <span className="font-mono text-[#c9d1d9]">{value}</span>
    </div>
  );
}

function AlertList({ alerts }: { alerts: SessionComparisonData['sessionA']['alerts'] }) {
  if (alerts.length === 0) {
    return <div className="text-xs text-[#3fb950] py-2">No issues detected</div>;
  }
  return (
    <div className="space-y-1">
      {alerts.map(alert => (
        <div
          key={alert.id}
          className="px-2 py-1.5 rounded text-xs border"
          style={{
            borderColor: alert.severity === 'critical' ? '#f8514930' : alert.severity === 'warning' ? '#d2992230' : '#58a6ff20',
            backgroundColor: alert.severity === 'critical' ? '#f8514908' : alert.severity === 'warning' ? '#d2992208' : '#58a6ff08',
          }}
        >
          <span
            className="font-medium"
            style={{ color: alert.severity === 'critical' ? '#f85149' : alert.severity === 'warning' ? '#d29922' : '#58a6ff' }}
          >
            {alert.title}
          </span>
        </div>
      ))}
    </div>
  );
}
