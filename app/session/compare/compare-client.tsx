'use client';

export const dynamic = 'force-dynamic';

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

export function CompareClient() {
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
    <div className="h-screen bg-[var(--aw-bg-0)] flex flex-col">
      <header className="border-b border-[var(--aw-bg-2)] shrink-0">
        <div className="max-w-5xl mx-auto px-6 py-3 flex items-center gap-3">
          <Link href="/" className="text-[var(--aw-text-2)] hover:text-[var(--aw-text-0)]"><Layers className="h-4 w-4" /></Link>
          <span className="text-[var(--aw-text-4)]">/</span>
          <span className="text-sm font-medium text-[var(--aw-text-0)]">Session Comparison</span>
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
              <div className="flex items-center justify-center py-12 text-[var(--aw-text-3)]">
                <Loader2 className="h-5 w-5 animate-spin mr-2" />
                Comparing sessions…
              </div>
            )}

            {error && (
              <div className="text-center py-8 text-[var(--aw-red)] text-sm">{error}</div>
            )}

            {!loading && !error && !comparison && sessionIdA && sessionIdB && sessionIdA !== sessionIdB && (
              <div className="text-center py-8 text-[var(--aw-text-3)] text-sm">Select two different sessions to compare</div>
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
                    <h3 className="text-xs font-semibold text-[var(--aw-text-2)] uppercase tracking-wide mb-2">
                      Alerts — Session A ({comparison.sessionA.alerts.length})
                    </h3>
                    <AlertList alerts={comparison.sessionA.alerts} />
                  </div>
                  <div>
                    <h3 className="text-xs font-semibold text-[var(--aw-text-2)] uppercase tracking-wide mb-2">
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
      <label className="text-[10px] text-[var(--aw-text-2)] uppercase tracking-wide font-semibold mb-1 block">{label}</label>
      <button
        onClick={() => setOpen(!open)}
        className="w-full text-left px-3 py-2 rounded-md border border-[var(--aw-bg-3)] bg-[var(--aw-bg-1)] hover:border-[var(--aw-text-4)] transition-colors"
      >
        {selected ? (
          <div>
            <div className="text-xs text-[var(--aw-text-0)] truncate">{selected.projectDisplayName}</div>
            <div className="text-[10px] text-[var(--aw-text-3)] font-mono">{selected.id.slice(0, 16)}…</div>
          </div>
        ) : (
          <span className="text-xs text-[var(--aw-text-4)]">Select session…</span>
        )}
      </button>

      {open && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setOpen(false)} />
          <div className="absolute left-0 right-0 top-full mt-1 z-50 bg-[var(--aw-bg-1)] border border-[var(--aw-bg-3)] rounded-md shadow-xl max-h-64 overflow-hidden flex flex-col">
            <div className="flex items-center gap-1.5 px-3 py-2 border-b border-[var(--aw-bg-2)]">
              <Search className="h-3 w-3 text-[var(--aw-text-4)]" />
              <input
                type="text"
                autoFocus
                value={search}
                onChange={e => setSearch(e.target.value)}
                placeholder="Search sessions…"
                className="flex-1 text-xs bg-transparent text-[var(--aw-text-0)] placeholder-[var(--aw-text-4)] outline-none"
                onKeyDown={e => { if (e.key === 'Escape') setOpen(false); }}
              />
            </div>
            <div className="overflow-y-auto py-1">
              {filtered.slice(0, 50).map(s => (
                <button
                  key={s.id}
                  onClick={() => { onChange(s.id); setOpen(false); setSearch(''); }}
                  className={cn(
                    'w-full text-left px-3 py-2 hover:bg-[var(--aw-bg-2)] transition-colors',
                    s.id === value && 'bg-[var(--aw-bg-2)]'
                  )}
                >
                  <div className="text-xs text-[var(--aw-text-1)] truncate">{s.projectDisplayName}</div>
                  <div className="text-[10px] text-[var(--aw-text-3)] font-mono">{s.id.slice(0, 16)}</div>
                </button>
              ))}
              {filtered.length === 0 && (
                <div className="px-3 py-4 text-xs text-[var(--aw-text-4)] text-center">No sessions found</div>
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
    ? 'var(--aw-text-2)'
    : (invertColor ? (isUp ? 'var(--aw-red)' : 'var(--aw-green)') : (isUp ? 'var(--aw-green)' : 'var(--aw-red)'));

  return (
    <div className="p-3 rounded-lg border border-[var(--aw-bg-2)] bg-[var(--aw-bg-1)]">
      <div className="flex items-center gap-1.5 mb-2">
        <span className="text-[var(--aw-text-3)]">{icon}</span>
        <span className="text-[10px] text-[var(--aw-text-2)]">{label}</span>
      </div>
      <div className="flex items-baseline justify-between gap-2">
        <div>
          <div className="text-xs text-[var(--aw-text-2)]">A: <span className="text-[var(--aw-text-1)] font-mono">{valueA}</span></div>
          <div className="text-xs text-[var(--aw-text-2)]">B: <span className="text-[var(--aw-text-1)] font-mono">{valueB}</span></div>
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
    <div className="rounded-lg border border-[var(--aw-bg-2)] bg-[var(--aw-bg-1)] p-4">
      <h3 className="text-xs font-semibold text-[var(--aw-text-0)] mb-3">{label}: {data.project}</h3>
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
      <span className="text-[var(--aw-text-2)]">{label}</span>
      <span className="font-mono text-[var(--aw-text-1)]">{value}</span>
    </div>
  );
}

function AlertList({ alerts }: { alerts: SessionComparisonData['sessionA']['alerts'] }) {
  if (alerts.length === 0) {
    return <div className="text-xs text-[var(--aw-green)] py-2">No issues detected</div>;
  }
  return (
    <div className="space-y-1">
      {alerts.map(alert => (
        <div
          key={alert.id}
          className="px-2 py-1.5 rounded text-xs border"
          style={{
            borderColor: alert.severity === 'critical' ? 'var(--aw-red)30' : alert.severity === 'warning' ? 'var(--aw-yellow)30' : 'var(--aw-blue)20',
            backgroundColor: alert.severity === 'critical' ? 'var(--aw-red)08' : alert.severity === 'warning' ? 'var(--aw-yellow)08' : 'var(--aw-blue)08',
          }}
        >
          <span
            className="font-medium"
            style={{ color: alert.severity === 'critical' ? 'var(--aw-red)' : alert.severity === 'warning' ? 'var(--aw-yellow)' : 'var(--aw-blue)' }}
          >
            {alert.title}
          </span>
        </div>
      ))}
    </div>
  );
}
