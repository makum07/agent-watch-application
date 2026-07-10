'use client';

import { useState } from 'react';
import Link from 'next/link';
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Cell } from 'recharts';
import { ChevronDown, ChevronRight, Clock, ArrowUpDown, RefreshCw, CheckCircle, XCircle, AlertCircle, FileText, MessageSquare, Wand2 } from 'lucide-react';
import { cn, formatRelativeTime } from '@/lib/utils';
import type { SkillFeedbackAggregate, SkillFeedbackItem, SkillAnalysisCycle, ImprovementCycle } from '@/types/skills';

type SortField = 'date' | 'category' | 'session';
type SortDir = 'asc' | 'desc';
type ViewMode = 'by-session' | 'by-category' | 'history';

interface FeedbackAnalyticsProps {
  feedbackItems: SkillFeedbackItem[];
  feedbackByCategory: SkillFeedbackAggregate[];
  feedbackByAgent: Array<{ agentName: string; count: number }>;
  totalFeedback: number;
  analysisCycles: SkillAnalysisCycle[];
  improvementCycles: ImprovementCycle[];
}

export function FeedbackAnalytics({
  feedbackItems,
  feedbackByCategory,
  feedbackByAgent,
  totalFeedback,
  analysisCycles,
  improvementCycles,
}: FeedbackAnalyticsProps) {
  const [viewMode, setViewMode] = useState<ViewMode>('by-session');
  const [sortField, setSortField] = useState<SortField>('date');
  const [sortDir, setSortDir] = useState<SortDir>('desc');
  const [expandedSessions, setExpandedSessions] = useState<Set<string>>(new Set());
  const [expandedHistory, setExpandedHistory] = useState<Set<string>>(new Set());

  if (totalFeedback === 0 && analysisCycles.length === 0 && improvementCycles.length === 0) {
    return (
      <div className="text-center py-12 text-[var(--aw-text-2)] text-xs">
        No feedback or analysis history for this skill yet
      </div>
    );
  }

  function toggleSort(field: SortField) {
    if (sortField === field) {
      setSortDir(d => d === 'asc' ? 'desc' : 'asc');
    } else {
      setSortField(field);
      setSortDir('desc');
    }
  }

  function toggleSession(sessionId: string) {
    setExpandedSessions(prev => {
      const next = new Set(prev);
      if (next.has(sessionId)) next.delete(sessionId);
      else next.add(sessionId);
      return next;
    });
  }

  function toggleHistoryItem(id: string) {
    setExpandedHistory(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  const sorted = [...feedbackItems].sort((a, b) => {
    const dir = sortDir === 'asc' ? 1 : -1;
    if (sortField === 'date') return dir * (new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime());
    if (sortField === 'category') return dir * a.categoryLabel.localeCompare(b.categoryLabel);
    if (sortField === 'session') return dir * a.sessionId.localeCompare(b.sessionId);
    return 0;
  });

  const groupedBySession = new Map<string, SkillFeedbackItem[]>();
  for (const item of sorted) {
    if (!groupedBySession.has(item.sessionId)) groupedBySession.set(item.sessionId, []);
    groupedBySession.get(item.sessionId)!.push(item);
  }

  const sessionEntries = [...groupedBySession.entries()].sort((a, b) => {
    const aLatest = Math.max(...a[1].map(i => new Date(i.createdAt).getTime()));
    const bLatest = Math.max(...b[1].map(i => new Date(i.createdAt).getTime()));
    return sortDir === 'desc' ? bLatest - aLatest : aLatest - bLatest;
  });

  // Build feedback lookup for resolving IDs in improvement cycles
  const feedbackById = new Map(feedbackItems.map(f => [f.id, f]));

  // Compute addressed (closed) feedback IDs — map each ID to the cycle that addressed it
  const addressedByMap = new Map<string, ImprovementCycle>();
  for (const ic of improvementCycles) {
    if (ic.status === 'completed' || ic.status === 'rewound') {
      for (const fbId of ic.feedbackIds) {
        if (!addressedByMap.has(fbId)) addressedByMap.set(fbId, ic);
      }
    }
  }

  // Sort improvement cycles by date
  const sortedImprovements = [...improvementCycles].sort(
    (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
  );

  // Sort analysis cycles by date
  const sortedAnalysisCycles = [...analysisCycles].sort(
    (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
  );

  // Split feedback items into open and closed, sorted by date desc
  const sortedFeedbackDesc = [...feedbackItems].sort(
    (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
  );
  const openFeedback = sortedFeedbackDesc.filter(f => !addressedByMap.has(f.id));
  const closedFeedback = sortedFeedbackDesc.filter(f => addressedByMap.has(f.id));

  return (
    <div className="space-y-6">
      {/* View mode tabs */}
      <div className="flex gap-1 bg-[var(--aw-bg-1)] border border-[var(--aw-bg-3)] rounded-lg p-0.5 w-fit">
        {([
          ['by-session', 'By Session'],
          ['by-category', 'By Category'],
          ['history', 'History'],
        ] as [ViewMode, string][]).map(([mode, label]) => (
          <button
            key={mode}
            onClick={() => setViewMode(mode)}
            className={cn(
              'px-3 py-1.5 text-xs rounded-md transition-colors',
              viewMode === mode
                ? 'bg-[var(--aw-bg-2)] text-[var(--aw-text-0)]'
                : 'text-[var(--aw-text-2)] hover:text-[var(--aw-text-1)]'
            )}
          >
            {label}
          </button>
        ))}
      </div>

      {viewMode === 'by-session' && (
        <div className="space-y-4">
          {/* Sort controls + open/closed summary */}
          <div className="flex items-center gap-3">
            <span className="text-xs text-[var(--aw-text-2)]">{feedbackItems.length} feedback item{feedbackItems.length !== 1 ? 's' : ''}</span>
            {openFeedback.length > 0 && (
              <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-[var(--aw-orange-bright)]/10 text-[var(--aw-orange-bright)]">
                {openFeedback.length} open
              </span>
            )}
            {closedFeedback.length > 0 && (
              <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-green-400/10 text-green-400">
                {closedFeedback.length} closed
              </span>
            )}
            <button
              onClick={() => toggleSort('date')}
              className={cn('flex items-center gap-1 text-xs', sortField === 'date' ? 'text-[var(--aw-text-0)]' : 'text-[var(--aw-text-2)] hover:text-[var(--aw-text-1)]')}
            >
              <ArrowUpDown className="h-3 w-3" />
              Date {sortField === 'date' && (sortDir === 'desc' ? '↓' : '↑')}
            </button>
          </div>

          {/* Session groups */}
          {sessionEntries.map(([sessionId, items]) => {
            const isExpanded = expandedSessions.has(sessionId);
            const latestDate = items[0]?.createdAt;

            return (
              <div key={sessionId} className="border border-[var(--aw-bg-3)] rounded-lg overflow-hidden">
                <button
                  onClick={() => toggleSession(sessionId)}
                  className="w-full flex items-center gap-3 px-4 py-3 bg-[var(--aw-bg-1)] hover:bg-[var(--aw-bg-5)] transition-colors text-left"
                >
                  {isExpanded
                    ? <ChevronDown className="h-3.5 w-3.5 text-[var(--aw-text-2)] shrink-0" />
                    : <ChevronRight className="h-3.5 w-3.5 text-[var(--aw-text-2)] shrink-0" />
                  }
                  <Link
                    href={`/session/${sessionId}/workspace`}
                    onClick={e => e.stopPropagation()}
                    className="text-xs font-mono text-[var(--aw-blue)] hover:underline"
                  >
                    {sessionId}
                  </Link>
                  <span className="text-xs text-[var(--aw-text-2)] flex-1 flex items-center gap-2">
                    {items.length} feedback item{items.length !== 1 ? 's' : ''}
                    {(() => {
                      const open = items.filter(i => !addressedByMap.has(i.id)).length;
                      const closed = items.length - open;
                      return (
                        <>
                          {open > 0 && <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-[var(--aw-orange-bright)]/10 text-[var(--aw-orange-bright)]">{open} open</span>}
                          {closed > 0 && <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-green-400/10 text-green-400">{closed} closed</span>}
                        </>
                      );
                    })()}
                  </span>
                  <div className="flex gap-1">
                    {[...new Set(items.map(i => i.category))].map(cat => {
                      const item = items.find(i => i.category === cat);
                      return (
                        <div
                          key={cat}
                          className="h-2 w-2 rounded-full shrink-0"
                          style={{ backgroundColor: item?.categoryColor }}
                          title={item?.categoryLabel}
                        />
                      );
                    })}
                  </div>
                  <span className="text-[11px] text-[var(--aw-text-3)] shrink-0">
                    {latestDate && formatRelativeTime(latestDate)}
                  </span>
                </button>

                {isExpanded && (
                  <div className="divide-y divide-[var(--aw-bg-2)]">
                    {items.map(item => {
                      const addressedBy = addressedByMap.get(item.id);
                      const isClosed = !!addressedBy;
                      return (
                        <div key={item.id} className="px-4 py-3 flex gap-3">
                          <div
                            className="h-2.5 w-2.5 rounded-full mt-1 shrink-0"
                            style={{ backgroundColor: item.categoryColor }}
                            title={item.categoryLabel}
                          />
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-2 mb-1">
                              <span className="text-[11px] font-medium text-[var(--aw-text-1)]">{item.categoryLabel}</span>
                              <span className="text-[10px] text-[var(--aw-text-4)]">&middot;</span>
                              <span className="text-[11px] text-[var(--aw-text-3)]">{item.agentName}</span>
                              {isClosed ? (
                                <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-green-400/10 text-green-400 inline-flex items-center gap-1">
                                  <CheckCircle className="h-2.5 w-2.5" />
                                  closed · cycle #{addressedBy.cycleNumber}
                                </span>
                              ) : (
                                <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-[var(--aw-orange-bright)]/10 text-[var(--aw-orange-bright)] inline-flex items-center gap-1">
                                  <AlertCircle className="h-2.5 w-2.5" />
                                  open
                                </span>
                              )}
                            </div>
                            <p className="text-xs text-[var(--aw-text-1)] leading-relaxed">{item.text}</p>
                            <span className="text-[10px] text-[var(--aw-text-4)] mt-1 block">
                              {new Date(item.createdAt).toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}
                            </span>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            );
          })}

          {sessionEntries.length === 0 && (
            <div className="text-center py-8 text-[var(--aw-text-2)] text-xs">No feedback collected yet</div>
          )}
        </div>
      )}

      {viewMode === 'by-category' && (
        <div className="space-y-6">
          {/* Chart */}
          {feedbackByCategory.length > 0 && (
            <div className="h-[240px]">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart
                  data={feedbackByCategory}
                  layout="vertical"
                  margin={{ left: 140, right: 20, top: 5, bottom: 5 }}
                >
                  <XAxis type="number" tick={{ fill: 'var(--aw-text-2)', fontSize: 11 }} />
                  <YAxis type="category" dataKey="label" tick={{ fill: 'var(--aw-text-1)', fontSize: 11 }} width={130} />
                  <Tooltip
                    contentStyle={{ backgroundColor: 'var(--aw-bg-1)', border: '1px solid var(--aw-bg-3)', borderRadius: 6, fontSize: 11 }}
                    labelStyle={{ color: 'var(--aw-text-0)' }}
                    itemStyle={{ color: 'var(--aw-text-1)' }}
                    formatter={(value: unknown, _name: unknown, entry: unknown) => {
                      const v = value as number;
                      const e = entry as { payload: SkillFeedbackAggregate };
                      return [`${v} (${e.payload.percentage}%)`, 'Count'];
                    }}
                  />
                  <Bar dataKey="count" radius={[0, 4, 4, 0]}>
                    {feedbackByCategory.map((entry, i) => (
                      <Cell key={i} fill={entry.color} />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>
          )}

          {/* Category table */}
          <div className="space-y-1">
            {feedbackByCategory.map(fb => (
              <div key={fb.category} className="flex items-center gap-2 py-1.5 px-2 rounded hover:bg-[var(--aw-bg-1)]">
                <div className="h-2.5 w-2.5 rounded-sm shrink-0" style={{ backgroundColor: fb.color }} />
                <span className="text-xs text-[var(--aw-text-1)] flex-1">{fb.label}</span>
                <span className="text-xs font-mono text-[var(--aw-text-0)]">{fb.count}</span>
                <span className="text-[11px] text-[var(--aw-text-2)] w-10 text-right">{fb.percentage}%</span>
              </div>
            ))}
          </div>

          {/* Agent breakdown */}
          {feedbackByAgent.length > 0 && (
            <div>
              <h3 className="text-xs font-medium text-[var(--aw-text-2)] mb-3 uppercase tracking-wide">
                Top Agents by Feedback
              </h3>
              <div className="space-y-1">
                {feedbackByAgent.map((agent, i) => (
                  <div key={i} className="flex items-center gap-2 py-1.5 px-2 rounded hover:bg-[var(--aw-bg-1)]">
                    <span className="text-xs text-[var(--aw-text-1)] flex-1 truncate">{agent.agentName}</span>
                    <span className="text-xs font-mono text-[var(--aw-text-0)]">{agent.count}</span>
                    <div className="w-20">
                      <div className="h-1.5 rounded-full bg-[var(--aw-bg-2)] overflow-hidden">
                        <div
                          className="h-full rounded-full bg-[var(--aw-blue)]"
                          style={{ width: `${Math.round((agent.count / totalFeedback) * 100)}%` }}
                        />
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {viewMode === 'history' && (
        <div className="space-y-8">
          {/* ── Improvement Cycles section ── */}
          <div>
            <div className="flex items-center gap-2 mb-4">
              <RefreshCw className="h-3.5 w-3.5 text-[var(--aw-green)]" />
              <h3 className="text-xs font-medium text-[var(--aw-text-0)] uppercase tracking-wide">
                Improvement Cycles
              </h3>
              <span className="text-[11px] text-[var(--aw-text-4)]">({sortedImprovements.length})</span>
            </div>

            {sortedImprovements.length === 0 ? (
              <div className="text-center py-6 text-[var(--aw-text-2)] text-xs border border-[var(--aw-bg-2)] rounded-lg bg-[var(--aw-bg-0)]">
                No improvement cycles yet
              </div>
            ) : (
              <div className="space-y-3">
                {sortedImprovements.map(ic => (
                  <ImprovementCycleCard
                    key={ic.id}
                    cycle={ic}
                    feedbackById={feedbackById}
                    isExpanded={expandedHistory.has(ic.id)}
                    onToggle={() => toggleHistoryItem(ic.id)}
                  />
                ))}
              </div>
            )}
          </div>

          {/* ── Skill Analysis Cycles section ── */}
          {sortedAnalysisCycles.length > 0 && (
            <div>
              <div className="flex items-center gap-2 mb-4">
                <Wand2 className="h-3.5 w-3.5 text-primary" />
                <h3 className="text-xs font-medium text-[var(--aw-text-0)] uppercase tracking-wide">
                  Skill Analysis Cycles
                </h3>
                <span className="text-[11px] text-[var(--aw-text-4)]">({sortedAnalysisCycles.length})</span>
              </div>
              <div className="space-y-3">
                {sortedAnalysisCycles.map(cycle => (
                  <div key={cycle.id} className="rounded-lg border border-[var(--aw-purple-light)]/30 bg-[var(--aw-bg-1)] p-3">
                    <div className="flex items-center gap-2 mb-1.5">
                      <span className="text-[11px] font-medium text-primary">
                        Analysis Cycle #{cycle.cycleNumber}
                      </span>
                      <StatusBadge status={cycle.status} />
                      <span className="text-[10px] text-[var(--aw-text-3)]">
                        {cycle.triggerType === 'auto_threshold' ? 'auto-triggered' : 'manual'}
                      </span>
                      <span className="text-[10px] text-[var(--aw-text-3)] ml-auto flex items-center gap-1">
                        <Clock className="h-2.5 w-2.5" />
                        {formatRelativeTime(cycle.createdAt)}
                      </span>
                    </div>
                    <div className="text-xs text-[var(--aw-text-2)]">
                      Analyzed {cycle.sessionsAnalyzed.length} session{cycle.sessionsAnalyzed.length !== 1 ? 's' : ''}, {cycle.feedbackAnalyzed.length} feedback item{cycle.feedbackAnalyzed.length !== 1 ? 's' : ''}
                    </div>
                    {cycle.recommendations && cycle.recommendations.length > 0 && (
                      <div className="mt-2 space-y-1">
                        {cycle.recommendations.slice(0, 3).map((rec, ri) => (
                          <div key={ri} className="flex items-start gap-1.5">
                            <span className={cn(
                              'text-[10px] px-1 py-0.5 rounded shrink-0 mt-0.5',
                              rec.severity === 'critical' && 'bg-red-400/10 text-red-400',
                              rec.severity === 'high' && 'bg-orange-400/10 text-orange-400',
                              rec.severity === 'medium' && 'bg-yellow-400/10 text-yellow-400',
                              rec.severity === 'low' && 'bg-gray-400/10 text-gray-400',
                            )}>
                              {rec.severity}
                            </span>
                            <span className="text-[11px] text-[var(--aw-text-1)]">{rec.title}</span>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* ── Feedback Items section ── */}
          <div>
            <div className="flex items-center gap-2 mb-4">
              <MessageSquare className="h-3.5 w-3.5 text-[var(--aw-blue)]" />
              <h3 className="text-xs font-medium text-[var(--aw-text-0)] uppercase tracking-wide">
                Feedback Items
              </h3>
              <span className="text-[11px] text-[var(--aw-text-4)]">({sortedFeedbackDesc.length})</span>
              {openFeedback.length > 0 && (
                <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-[var(--aw-orange-bright)]/10 text-[var(--aw-orange-bright)]">
                  {openFeedback.length} open
                </span>
              )}
              {closedFeedback.length > 0 && (
                <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-green-400/10 text-green-400">
                  {closedFeedback.length} closed
                </span>
              )}
            </div>

            {sortedFeedbackDesc.length === 0 ? (
              <div className="text-center py-6 text-[var(--aw-text-2)] text-xs border border-[var(--aw-bg-2)] rounded-lg bg-[var(--aw-bg-0)]">
                No feedback items yet
              </div>
            ) : (
              <div className="space-y-5">
                {/* Open feedback */}
                {openFeedback.length > 0 && (
                  <div>
                    <div className="flex items-center gap-2 mb-2">
                      <AlertCircle className="h-3 w-3 text-[var(--aw-orange-bright)]" />
                      <span className="text-[11px] font-medium text-[var(--aw-orange-bright)]">Open ({openFeedback.length})</span>
                    </div>
                    <div className="space-y-2">
                      {openFeedback.map(fb => (
                        <FeedbackItemCard key={fb.id} item={fb} />
                      ))}
                    </div>
                  </div>
                )}

                {/* Closed feedback */}
                {closedFeedback.length > 0 && (
                  <div>
                    <div className="flex items-center gap-2 mb-2">
                      <CheckCircle className="h-3 w-3 text-green-400" />
                      <span className="text-[11px] font-medium text-green-400">Closed ({closedFeedback.length})</span>
                    </div>
                    <div className="space-y-2">
                      {closedFeedback.map(fb => {
                        const cycle = addressedByMap.get(fb.id);
                        return (
                          <FeedbackItemCard key={fb.id} item={fb} addressedByCycle={cycle} />
                        );
                      })}
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function StatusBadge({ status }: { status: string }) {
  const config: Record<string, { bg: string; text: string; icon?: React.ReactNode }> = {
    completed: { bg: 'bg-green-400/10', text: 'text-green-400', icon: <CheckCircle className="h-2.5 w-2.5" /> },
    failed: { bg: 'bg-red-400/10', text: 'text-red-400', icon: <XCircle className="h-2.5 w-2.5" /> },
    analyzing: { bg: 'bg-yellow-400/10', text: 'text-yellow-400', icon: <RefreshCw className="h-2.5 w-2.5 animate-spin" /> },
    running: { bg: 'bg-yellow-400/10', text: 'text-yellow-400', icon: <RefreshCw className="h-2.5 w-2.5 animate-spin" /> },
    awaiting_review: { bg: 'bg-blue-400/10', text: 'text-blue-400', icon: <AlertCircle className="h-2.5 w-2.5" /> },
    applying: { bg: 'bg-purple-400/10', text: 'text-purple-400', icon: <RefreshCw className="h-2.5 w-2.5 animate-spin" /> },
    pending: { bg: 'bg-gray-400/10', text: 'text-gray-400' },
  };
  const c = config[status] ?? config.pending!;
  return (
    <span className={cn('text-[10px] px-1.5 py-0.5 rounded-full inline-flex items-center gap-1', c.bg, c.text)}>
      {c.icon}
      {status}
    </span>
  );
}

function ImprovementCycleCard({
  cycle,
  feedbackById,
  isExpanded,
  onToggle,
}: {
  cycle: ImprovementCycle;
  feedbackById: Map<string, SkillFeedbackItem>;
  isExpanded: boolean;
  onToggle: () => void;
}) {
  const duration = cycle.completedAt
    ? Math.round((new Date(cycle.completedAt).getTime() - new Date(cycle.createdAt).getTime()) / 1000)
    : null;

  let fileChanges: Array<{ file: string; action: string }> | null = null;
  if (cycle.fileChanges) {
    try { fileChanges = JSON.parse(cycle.fileChanges); } catch { /* ignore */ }
  }

  const resolvedFeedback = cycle.feedbackIds
    .map(id => feedbackById.get(id))
    .filter((f): f is SkillFeedbackItem => f != null);

  return (
    <div className="rounded-lg border border-[var(--aw-green)]/30 bg-[var(--aw-bg-1)] overflow-hidden">
      <button
        onClick={onToggle}
        className="w-full p-3 text-left hover:bg-[var(--aw-bg-5)] transition-colors"
      >
        <div className="flex items-center gap-2 mb-1">
          {isExpanded
            ? <ChevronDown className="h-3 w-3 text-[var(--aw-text-2)] shrink-0" />
            : <ChevronRight className="h-3 w-3 text-[var(--aw-text-2)] shrink-0" />
          }
          <RefreshCw className="h-3 w-3 text-[var(--aw-green)] shrink-0" />
          <span className="text-[11px] font-medium text-[var(--aw-green)]">
            Improvement Cycle #{cycle.cycleNumber}
          </span>
          <StatusBadge status={cycle.status} />
          <Link
            href={`/session/${cycle.sessionId}/workspace`}
            onClick={e => e.stopPropagation()}
            className="text-[11px] font-mono text-[var(--aw-blue)] hover:underline"
          >
            {cycle.sessionId}
          </Link>
          <span className="text-[10px] text-[var(--aw-text-3)] ml-auto flex items-center gap-1">
            <Clock className="h-2.5 w-2.5" />
            {formatRelativeTime(cycle.createdAt)}
          </span>
        </div>
        <div className="flex items-center gap-3 ml-5 text-xs text-[var(--aw-text-2)]">
          <span>{cycle.feedbackIds.length} feedback item{cycle.feedbackIds.length !== 1 ? 's' : ''} addressed</span>
          {duration !== null && <span>&middot; {duration < 60 ? `${duration}s` : `${Math.round(duration / 60)}m`}</span>}
          {fileChanges && <span>&middot; {fileChanges.length} file{fileChanges.length !== 1 ? 's' : ''} changed</span>}
        </div>
      </button>

      {isExpanded && (
        <div className="border-t border-[var(--aw-bg-2)]">
          {/* Feedback addressed */}
          {resolvedFeedback.length > 0 && (
            <div className="p-3 border-b border-[var(--aw-bg-2)]">
              <div className="flex items-center gap-1.5 mb-2">
                <MessageSquare className="h-3 w-3 text-[var(--aw-blue)]" />
                <span className="text-[11px] font-medium text-[var(--aw-text-2)] uppercase tracking-wide">
                  Feedback Addressed
                </span>
              </div>
              <div className="space-y-2">
                {resolvedFeedback.map(fb => (
                  <div key={fb.id} className="flex gap-2 bg-[var(--aw-bg-0)] rounded p-2.5">
                    <div
                      className="h-2 w-2 rounded-full mt-1 shrink-0"
                      style={{ backgroundColor: fb.categoryColor }}
                    />
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 mb-0.5">
                        <span className="text-[10px] font-medium text-[var(--aw-text-1)]">{fb.categoryLabel}</span>
                        <span className="text-[10px] text-[var(--aw-text-4)]">&middot;</span>
                        <span className="text-[10px] text-[var(--aw-text-3)]">{fb.agentName}</span>
                      </div>
                      <p className="text-[11px] text-[var(--aw-text-2)] leading-relaxed">{fb.text}</p>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Generated prompt */}
          <div className="p-3 border-b border-[var(--aw-bg-2)]">
            <div className="flex items-center gap-1.5 mb-2">
              <FileText className="h-3 w-3 text-[var(--aw-text-2)]" />
              <span className="text-[11px] font-medium text-[var(--aw-text-2)] uppercase tracking-wide">Generated Prompt</span>
            </div>
            <pre className="text-xs text-[var(--aw-text-1)] bg-[var(--aw-bg-0)] rounded p-3 overflow-x-auto max-h-[200px] overflow-y-auto whitespace-pre-wrap leading-relaxed">
              {cycle.generatedPrompt}
            </pre>
          </div>

          {/* Claude response */}
          {cycle.claudeResponse && (
            <div className="p-3 border-b border-[var(--aw-bg-2)]">
              <div className="flex items-center gap-1.5 mb-2">
                <Wand2 className="h-3 w-3 text-primary" />
                <span className="text-[11px] font-medium text-[var(--aw-text-2)] uppercase tracking-wide">Claude Response</span>
              </div>
              <pre className="text-xs text-[var(--aw-text-1)] bg-[var(--aw-bg-0)] rounded p-3 overflow-x-auto max-h-[300px] overflow-y-auto whitespace-pre-wrap leading-relaxed">
                {cycle.claudeResponse}
              </pre>
            </div>
          )}

          {/* File changes */}
          {fileChanges && fileChanges.length > 0 && (
            <div className="p-3">
              <div className="flex items-center gap-1.5 mb-2">
                <span className="text-[11px] font-medium text-[var(--aw-text-2)] uppercase tracking-wide">File Changes</span>
              </div>
              <div className="space-y-1">
                {fileChanges.map((fc, i) => (
                  <div key={i} className="flex items-center gap-2 text-xs">
                    <span className={cn(
                      'px-1.5 py-0.5 rounded text-[10px]',
                      fc.action === 'created' && 'bg-green-400/10 text-green-400',
                      fc.action === 'modified' && 'bg-yellow-400/10 text-yellow-400',
                      fc.action === 'deleted' && 'bg-red-400/10 text-red-400',
                    )}>
                      {fc.action}
                    </span>
                    <span className="text-[var(--aw-text-1)] font-mono truncate">{fc.file}</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* No response (failed/pending) */}
          {!cycle.claudeResponse && cycle.status === 'failed' && (
            <div className="p-3 text-xs text-red-400/70">
              This improvement cycle failed without producing a response.
            </div>
          )}
          {!cycle.claudeResponse && cycle.status === 'pending' && (
            <div className="p-3 text-xs text-[var(--aw-text-2)]">
              This improvement cycle is pending execution.
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function FeedbackItemCard({
  item,
  addressedByCycle,
}: {
  item: SkillFeedbackItem;
  addressedByCycle?: ImprovementCycle;
}) {
  const isClosed = !!addressedByCycle;

  return (
    <div className={cn(
      'rounded-lg border bg-[var(--aw-bg-1)] p-3',
      isClosed ? 'border-green-400/20' : 'border-[var(--aw-orange-bright)]/20',
    )}>
      <div className="flex items-center gap-2 mb-1.5">
        <div
          className="h-2 w-2 rounded-full shrink-0"
          style={{ backgroundColor: item.categoryColor }}
        />
        <span className="text-[11px] font-medium text-[var(--aw-text-1)]">{item.categoryLabel}</span>
        <span className="text-[10px] text-[var(--aw-text-4)]">&middot;</span>
        <Link
          href={`/session/${item.sessionId}/workspace`}
          className="text-[11px] font-mono text-[var(--aw-blue)] hover:underline"
        >
          {item.sessionId}
        </Link>
        <span className="text-[10px] text-[var(--aw-text-4)]">&middot;</span>
        <span className="text-[11px] text-[var(--aw-text-3)]">{item.agentName}</span>
        <span className="text-[10px] text-[var(--aw-text-3)] ml-auto flex items-center gap-1">
          <Clock className="h-2.5 w-2.5" />
          {formatRelativeTime(item.createdAt)}
        </span>
      </div>
      <p className="text-xs text-[var(--aw-text-1)] leading-relaxed">{item.text}</p>
      {isClosed && addressedByCycle && (
        <div className="mt-2 flex items-center gap-1.5 text-[10px] text-green-400/70">
          <CheckCircle className="h-2.5 w-2.5" />
          Addressed in Improvement Cycle #{addressedByCycle.cycleNumber}
          {addressedByCycle.completedAt && (
            <span className="text-[var(--aw-text-4)]">&middot; {formatRelativeTime(addressedByCycle.completedAt)}</span>
          )}
        </div>
      )}
    </div>
  );
}
