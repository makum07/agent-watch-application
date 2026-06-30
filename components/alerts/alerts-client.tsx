'use client';

import { useEffect, useState } from 'react';
import { Layers, Bell, ChevronDown, ChevronRight, ExternalLink, Clock, DollarSign } from 'lucide-react';
import Link from 'next/link';
import { SessionSearch } from '@/components/home/session-search';
import { ThemeToggle } from '@/components/theme-toggle';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';
import {
  SidebarInset, SidebarProvider, SidebarTrigger,
} from '@/components/ui/sidebar';

interface SessionDetail {
  sessionId: string;
  title: string;
  project: string;
  cost: number;
  tokens: number;
  toolCalls: number;
  durationMs: number;
  agentCount: number;
  model: string;
  source: string;
}

interface DigestRun {
  id: number;
  runAt: string;
  windowStart: string;
  windowEnd: string;
  totalSessions: number;
  totalCost: number;
  totalTokens: number;
  totalToolCalls: number;
  avgDurationMs: number;
  topModel: string;
  sessionDetails: SessionDetail[];
  sourceBreakdown: { source: string; sessions: number }[];
}

function stripTags(str: string) {
  return (str || '')
    .replace(/<[^>]*>/g, '')   // complete tags
    .replace(/<[^>]*$/g, '')   // incomplete tag truncated at end
    .replace(/\s+/g, ' ')
    .trim();
}

function fmtCost(n: number) { return `$${n.toFixed(2)}`; }
function fmtTokens(n: number) { return n >= 1000 ? `${(n / 1000).toFixed(1)}k` : String(n); }
function fmtDuration(ms: number) {
  if (ms >= 3600000) return `${Math.round(ms / 3600000)}h`;
  if (ms >= 60000) return `${Math.round(ms / 60000)}m`;
  return `${Math.round(ms / 1000)}s`;
}
function fmtWindow(start: string, end: string) {
  const s = new Date(start);
  const e = new Date(end);
  const sameDay = s.toDateString() === e.toDateString();
  const dateStr = s.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
  const startTime = s.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', timeZone: 'UTC' });
  const endTime = e.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', timeZone: 'UTC' });
  return sameDay
    ? `${dateStr} · ${startTime} → ${endTime} UTC`
    : `${s.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })} ${startTime} → ${e.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })} ${endTime} UTC`;
}
function timeAgo(iso: string) {
  const diff = Date.now() - new Date(iso).getTime();
  if (diff < 3600000) return `${Math.round(diff / 60000)}m ago`;
  if (diff < 86400000) return `${Math.round(diff / 3600000)}h ago`;
  return `${Math.round(diff / 86400000)}d ago`;
}

function DigestCard({ run, defaultOpen }: { run: DigestRun; defaultOpen: boolean }) {
  const [open, setOpen] = useState(defaultOpen);
  const sourceList = run.sourceBreakdown.filter(s => s.sessions > 0).map(s => `${s.source} ${s.sessions}`).join(' · ');

  return (
    <div className="border border-border rounded-lg overflow-hidden">
      {/* Header row */}
      <button
        onClick={() => setOpen(o => !o)}
        className="w-full flex items-center gap-3 px-4 py-3 bg-muted/30 hover:bg-muted/50 transition-colors text-left"
      >
        {open
          ? <ChevronDown className="h-4 w-4 text-muted-foreground shrink-0" />
          : <ChevronRight className="h-4 w-4 text-muted-foreground shrink-0" />}
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-sm font-medium">{fmtWindow(run.windowStart, run.windowEnd)}</span>
            <span className="text-xs text-muted-foreground">{timeAgo(run.runAt)}</span>
          </div>
          {sourceList && (
            <div className="text-xs text-muted-foreground mt-0.5">{sourceList}</div>
          )}
        </div>
        {/* Headline stats */}
        <div className="flex items-center gap-4 shrink-0">
          <div className="text-right">
            <div className="text-sm font-semibold text-primary">{fmtCost(run.totalCost)}</div>
            <div className="text-[10px] text-muted-foreground">cost</div>
          </div>
          <div className="text-right">
            <div className="text-sm font-semibold">{run.totalSessions}</div>
            <div className="text-[10px] text-muted-foreground">sessions</div>
          </div>
          <div className="text-right hidden sm:block">
            <div className="text-sm font-semibold">{fmtTokens(run.totalTokens)}</div>
            <div className="text-[10px] text-muted-foreground">tokens</div>
          </div>
        </div>
      </button>

      {/* Expanded session list */}
      {open && (
        <div className="divide-y divide-border">
          {run.sessionDetails.length === 0 ? (
            <div className="px-4 py-3 text-sm text-muted-foreground">No session details available.</div>
          ) : (
            run.sessionDetails.map((s) => {
              const title = stripTags(s.title) || s.project;
              const truncated = title.length > 70 ? title.slice(0, 67) + '…' : title;
              return (
                <Link
                  key={s.sessionId}
                  href={`/session/${s.sessionId}/workspace`}
                  className="flex items-center gap-3 px-4 py-3 hover:bg-muted/40 transition-colors group"
                >
                  <div className="flex-1 min-w-0">
                    <div className="text-sm font-medium truncate group-hover:text-primary transition-colors">
                      {truncated}
                    </div>
                    <div className="flex items-center gap-3 mt-0.5 text-xs text-muted-foreground">
                      <span>{s.project}</span>
                      <span>·</span>
                      <span>{s.agentCount} agents</span>
                      <span>·</span>
                      <span>{fmtDuration(s.durationMs)}</span>
                      <span>·</span>
                      <span>{s.source}</span>
                    </div>
                  </div>
                  <div className="flex items-center gap-3 shrink-0">
                    <div className="text-right">
                      <div className="text-sm font-medium">{fmtCost(s.cost)}</div>
                      <div className="text-[10px] text-muted-foreground">{fmtTokens(s.tokens)}</div>
                    </div>
                    <ExternalLink className="h-3.5 w-3.5 text-muted-foreground opacity-0 group-hover:opacity-100 transition-opacity" />
                  </div>
                </Link>
              );
            })
          )}
          {/* Summary row */}
          <div className="px-4 py-2 bg-muted/20 flex items-center gap-4 text-xs text-muted-foreground">
            <span><Clock className="h-3 w-3 inline mr-1" />avg {fmtDuration(run.avgDurationMs)}</span>
            <span>{run.totalToolCalls} tool calls</span>
            <span>{run.topModel}</span>
          </div>
        </div>
      )}
    </div>
  );
}

export function AlertsClient() {
  const [runs, setRuns] = useState<DigestRun[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [offset, setOffset] = useState(0);
  const LIMIT = 30;

  useEffect(() => {
    fetch(`/api/v2/analytics/digest/history?limit=${LIMIT}&offset=0`)
      .then(r => r.json())
      .then(d => {
        setRuns(d.runs ?? []);
        setTotal(d.total ?? 0);
        setLoading(false);
      });

    // Mark as read
    fetch('/api/v2/analytics/digest/read', { method: 'POST' });
  }, []);

  function loadMore() {
    const newOffset = offset + LIMIT;
    fetch(`/api/v2/analytics/digest/history?limit=${LIMIT}&offset=${newOffset}`)
      .then(r => r.json())
      .then(d => {
        setRuns(prev => [...prev, ...(d.runs ?? [])]);
        setOffset(newOffset);
      });
  }

  return (
    <SidebarProvider>
      <SidebarInset className="flex flex-col h-screen overflow-hidden">
        {/* Navbar — same pattern as home */}
        <header className="border-b border-border shrink-0 bg-background/95 backdrop-blur z-10">
          <div className="px-4 py-3 grid grid-cols-3 items-center gap-4">
            <div className="flex items-center gap-2 min-w-0">
              <SidebarTrigger className="shrink-0" />
              <div className="h-4 w-px bg-border shrink-0" />
              <Link href="/" className="flex items-center gap-1.5 shrink-0 hover:opacity-80 transition-opacity">
                <Layers className="h-4 w-4 text-primary" />
                <span className="font-semibold text-sm">AgentWatch</span>
              </Link>
              <div className="h-4 w-px bg-border mx-1 shrink-0" />
              <Link href="/skills" className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground px-2 py-1 rounded hover:bg-muted transition-colors shrink-0">
                Skills
              </Link>
              <span className="flex items-center gap-1 text-xs text-foreground px-2 py-1 rounded bg-muted shrink-0">
                <Bell className="h-3 w-3 text-primary" />
                Alerts
              </span>
            </div>
            <div className="flex justify-center">
              <div className="w-full max-w-sm">
                <SessionSearch />
              </div>
            </div>
            <div className="flex items-center justify-end gap-2">
              <ThemeToggle />
            </div>
          </div>
        </header>

        {/* Content */}
        <div className="flex-1 overflow-y-auto">
          <div className="max-w-3xl mx-auto px-6 py-8">
            <div className="flex items-center justify-between mb-6">
              <div>
                <h1 className="text-lg font-semibold">Digest Alerts</h1>
                <p className="text-sm text-muted-foreground mt-0.5">
                  2-hour session digests — click a session to open workspace
                </p>
              </div>
              {total > 0 && (
                <Badge variant="secondary">{total} digest{total !== 1 ? 's' : ''}</Badge>
              )}
            </div>

            {loading ? (
              <div className="space-y-3">
                {[1, 2, 3].map(i => (
                  <div key={i} className="h-16 rounded-lg bg-muted/30 animate-pulse" />
                ))}
              </div>
            ) : runs.length === 0 ? (
              <div className="text-center py-16 text-muted-foreground">
                <Bell className="h-8 w-8 mx-auto mb-3 opacity-20" />
                <p className="text-sm">No digests yet</p>
                <p className="text-xs mt-1">Digests appear here after the 2-hour cron runs</p>
              </div>
            ) : (
              <div className="space-y-3">
                {runs.map((run, i) => (
                  <DigestCard key={run.id} run={run} defaultOpen={i === 0} />
                ))}
                {runs.length < total && (
                  <button
                    onClick={loadMore}
                    className="w-full py-2 text-sm text-muted-foreground hover:text-foreground transition-colors"
                  >
                    Load more ({total - runs.length} remaining)
                  </button>
                )}
              </div>
            )}
          </div>
        </div>
      </SidebarInset>
    </SidebarProvider>
  );
}
