'use client';

import { useEffect, useRef, useState, useCallback } from 'react';
import {
  X, Trash2, Zap, Loader2, ChevronDown, ChevronRight,
  MessageSquare, AlertCircle, Pencil, Check, FileText, RotateCcw,
  Terminal, Brain, Wrench, ShieldCheck, ShieldX, Eye, FileCode2,
} from 'lucide-react';
import { useFeedbackStore } from '@/store/feedback-store';
import { useSessionStore } from '@/store/session-store';
import { useWebSocket } from '@/hooks/use-websocket';
import { FEEDBACK_CATEGORIES, type FeedbackCategory, type FileChange, type StreamEntry } from '@/types/feedback';
import type { SessionEvent, ClientMessage } from '@/types/events';
import { getAgentDisplay } from '@/lib/agent-display';
import { MarkdownRenderer } from '@/components/shared/markdown-renderer';
import { cn } from '@/lib/utils';
import type { ImprovementCycle } from '@/types/feedback';

interface FeedbackPanelProps {
  sessionId: string;
  onClose: () => void;
}

const STATUS_META: Record<string, { label: string; color: string }> = {
  applying:  { label: 'Applying…', color: '#58a6ff' },
  completed: { label: 'Completed', color: '#3fb950' },
  failed:    { label: 'Failed',    color: '#ff7b72' },
  rewound:   { label: 'Rewound',   color: '#6e7681' },
};

export function FeedbackPanel({ sessionId, onClose }: FeedbackPanelProps) {
  const {
    items, cycles, isLoading, isApplying, lastError, lastCycle,
    streamEntries, pendingApprovals,
    loadFeedback, loadCycles, deleteFeedback, updateFeedback,
    previewPrompt, applyImprovements, rewindCycle, deleteCycle, clearRewoundCycles,
    clearError, handleStreamEvent,
  } = useFeedbackStore();
  const agentMap = useSessionStore(s => s.agentMap);

  // WebSocket: receive stream events and send approval responses
  const onWsEvent = useCallback((event: SessionEvent) => {
    if (
      event.type === 'improvement_stream_event' ||
      event.type === 'improvement_permission_request' ||
      event.type === 'improvement_permission_resolved' ||
      event.type === 'improvement_started' ||
      event.type === 'improvement_complete' ||
      event.type === 'improvement_failed'
    ) {
      handleStreamEvent(event);
    }
  }, [handleStreamEvent]);

  const { send: wsSend } = useWebSocket(onWsEvent);

  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const [activeTab, setActiveTab] = useState<'feedback' | 'history'>('feedback');

  // Which cycle is inline-expanded in the history list
  const [expandedCycleId, setExpandedCycleId] = useState<string | null>(null);

  // Apply flow
  const [applyStep, setApplyStep] = useState<'idle' | 'loading-preview' | 'editing-prompt' | 'applying'>('idle');
  const [promptDraft, setPromptDraft] = useState('');
  const [rewindFromCycle, setRewindFromCycle] = useState<number | null>(null);

  // Rewind confirmation
  const [rewindConfirm, setRewindConfirm] = useState<ImprovementCycle | null>(null);
  const [isRewinding, setIsRewinding] = useState(false);

  // Inline edit
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editText, setEditText] = useState('');
  const [editCategory, setEditCategory] = useState<FeedbackCategory>('other');
  const [showEditCatMenu, setShowEditCatMenu] = useState(false);
  const editTextareaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => { loadFeedback(sessionId); loadCycles(sessionId); }, [sessionId]);

  // Auto-expand the latest non-rewound cycle when history loads
  useEffect(() => {
    if (expandedCycleId) return;
    const latest = cycles.find(c => c.status !== 'rewound');
    if (latest) setExpandedCycleId(latest.id);
  }, [cycles.length]);

  // Switch to history and expand when a new cycle is created
  useEffect(() => {
    if (!lastCycle) return;
    setActiveTab('history');
    setExpandedCycleId(lastCycle.id);
  }, [lastCycle?.id]);

  // Poll while any cycle is applying
  const hasApplying = cycles.some(c => c.status === 'applying');
  useEffect(() => {
    if (!hasApplying) return;
    const t = setInterval(() => loadCycles(sessionId), 3000);
    return () => clearInterval(t);
  }, [hasApplying, sessionId]);

  useEffect(() => {
    if (editingId) editTextareaRef.current?.focus();
  }, [editingId]);

  // Group feedback items by agent
  const byAgent = new Map<string, typeof items>();
  for (const item of items) {
    if (!byAgent.has(item.agentId)) byAgent.set(item.agentId, []);
    byAgent.get(item.agentId)!.push(item);
  }
  const catCounts = new Map<string, number>();
  for (const item of items) catCounts.set(item.category, (catCounts.get(item.category) ?? 0) + 1);
  const topCats = Array.from(catCounts.entries()).sort((a, b) => b[1] - a[1]).slice(0, 5);

  const rewoundCount = cycles.filter(c => c.status === 'rewound').length;
  // Latest cycle that is not rewound (the "current" state)
  const latestActiveCycleId = cycles.find(c => c.status !== 'rewound')?.id ?? null;

  async function handlePreview() {
    setApplyStep('loading-preview');
    setRewindFromCycle(null);
    const p = await previewPrompt(sessionId);
    if (p) { setPromptDraft(p); setApplyStep('editing-prompt'); }
    else setApplyStep('idle');
  }

  async function handleApply() {
    setApplyStep('applying');
    const cycle = await applyImprovements(sessionId, promptDraft);
    if (cycle) setExpandedCycleId(cycle.id);
    setApplyStep('idle');
    setRewindFromCycle(null);
  }

  function handleRewind(cycle: ImprovementCycle) {
    setRewindConfirm(cycle);
  }

  async function confirmRewind() {
    if (!rewindConfirm) return;
    setIsRewinding(true);
    const result = await rewindCycle(sessionId, rewindConfirm.id);
    setIsRewinding(false);
    setRewindConfirm(null);
    if (!result.ok) {
      useFeedbackStore.setState({ lastError: result.error ?? 'Rewind failed' });
      return;
    }
    setPromptDraft(rewindConfirm.generatedPrompt);
    setRewindFromCycle(rewindConfirm.cycleNumber);
    setApplyStep('editing-prompt');
  }

  function startEdit(id: string, text: string, cat: FeedbackCategory) {
    setEditingId(id); setEditText(text); setEditCategory(cat); setShowEditCatMenu(false);
  }
  function cancelEdit() { setEditingId(null); setShowEditCatMenu(false); }
  async function saveEdit(id: string) {
    if (!editText.trim()) return;
    await updateFeedback(sessionId, id, { text: editText.trim(), category: editCategory });
    setEditingId(null);
  }

  return (
    <div className="flex flex-col h-full bg-[#0d1117] border-l border-[#21262d] overflow-hidden">
      {/* Header */}
      <div className="shrink-0 flex items-center gap-2 px-3 py-2.5 border-b border-[#21262d] bg-[#161b22]">
        <MessageSquare className="h-4 w-4 text-[#58a6ff]" />
        <span className="text-sm font-semibold text-[#e6edf3] flex-1">Feedback Review</span>
        {items.length > 0 && (
          <span className="text-[10px] bg-[#58a6ff]/15 text-[#58a6ff] border border-[#58a6ff]/30 px-1.5 py-0.5 rounded-full font-medium">
            {items.length}
          </span>
        )}
        <button onClick={onClose} className="p-1 rounded text-[#8b949e] hover:text-[#e6edf3] hover:bg-[#21262d] transition-colors">
          <X className="h-3.5 w-3.5" />
        </button>
      </div>

      {/* Tab rail */}
      <div className="shrink-0 flex border-b border-[#21262d] bg-[#0d1117]">
        {(['feedback', 'history'] as const).map(tab => (
          <button
            key={tab}
            onClick={() => setActiveTab(tab)}
            className={cn(
              'flex-1 py-2 text-xs font-medium transition-colors border-b-2',
              activeTab === tab
                ? 'text-[#58a6ff] border-[#58a6ff]'
                : 'text-[#8b949e] border-transparent hover:text-[#e6edf3]',
            )}
          >
            {tab === 'feedback'
              ? 'Feedback'
              : `History${cycles.length > 0 ? ` (${cycles.length})` : ''}`}
          </button>
        ))}
      </div>

      {/* Error banner */}
      {lastError && (
        <div className="shrink-0 flex items-center gap-2 px-3 py-2 bg-[#ff7b72]/10 border-b border-[#ff7b72]/30">
          <AlertCircle className="h-3.5 w-3.5 text-[#ff7b72] shrink-0" />
          <p className="text-[11px] text-[#ff7b72] flex-1 truncate">{lastError}</p>
          <button onClick={clearError} className="text-[11px] text-[#ff7b72] hover:text-[#ffa198] shrink-0">✕</button>
        </div>
      )}

      {/* Content */}
      <div className="flex-1 overflow-hidden flex flex-col">
        {applyStep === 'editing-prompt' ? (
          /* ── Prompt editor — takes over the full content area ── */
          <div className="flex flex-col flex-1 overflow-hidden">
            {/* Editor context bar */}
            <div className="shrink-0 flex items-center gap-2 px-3 py-2 border-b border-[#21262d] bg-[#161b22]">
              {rewindFromCycle !== null ? (
                <>
                  <RotateCcw className="h-3.5 w-3.5 text-[#f0883e] shrink-0" />
                  <span className="text-xs font-semibold text-[#e6edf3] flex-1">
                    Rewind Cycle #{rewindFromCycle} — Edit &amp; Re-apply
                  </span>
                </>
              ) : (
                <>
                  <FileText className="h-3.5 w-3.5 text-[#58a6ff] shrink-0" />
                  <span className="text-xs font-semibold text-[#e6edf3] flex-1">Review &amp; Edit Prompt</span>
                </>
              )}
              <span className="shrink-0 text-[10px] text-[#484f58] font-mono tabular-nums">
                {promptDraft.length.toLocaleString()} chars
              </span>
            </div>
            {/* Hint */}
            <div className="shrink-0 px-3 py-1.5 bg-[#0d1117] border-b border-[#21262d]">
              <p className="text-[10px] text-[#484f58] leading-snug">
                This prompt will be sent to Claude to evolve agent and workflow designs.
                Edit freely — changes apply only to this cycle.
              </p>
            </div>
            {/* Textarea — fills remaining space */}
            <textarea
              value={promptDraft}
              onChange={e => setPromptDraft(e.target.value)}
              className="flex-1 w-full px-3 py-2.5 bg-[#0d1117] text-[11px] text-[#c9d1d9] font-mono leading-relaxed focus:outline-none resize-none border-0"
              placeholder="Improvement prompt will appear here…"
              onKeyDown={e => {
                if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) handleApply();
                if (e.key === 'Escape') { setApplyStep('idle'); setRewindFromCycle(null); }
              }}
            />
          </div>
        ) : (
          <div className="flex-1 overflow-y-auto">
          {activeTab === 'feedback' ? (
          isLoading ? (
            <div className="flex items-center justify-center h-32 text-[#8b949e]">
              <Loader2 className="h-4 w-4 animate-spin" />
            </div>
          ) : items.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-full gap-3 text-[#484f58] py-16">
              <MessageSquare className="h-8 w-8 opacity-30" />
              <div className="text-center px-4">
                <p className="text-xs font-medium text-[#8b949e]">No feedback collected yet</p>
                <p className="text-[11px] mt-1 leading-relaxed">
                  Open the <strong className="text-[#c9d1d9]">Feedback</strong> tab in any agent pane to add notes while reviewing
                </p>
              </div>
            </div>
          ) : (
            <div className="p-3 space-y-4">
              {/* Stats */}
              <div className="grid grid-cols-2 gap-2">
                <div className="bg-[#161b22] border border-[#21262d] rounded p-2.5">
                  <div className="text-lg font-bold text-[#e6edf3]">{items.length}</div>
                  <div className="text-[11px] text-[#8b949e]">Total items</div>
                </div>
                <div className="bg-[#161b22] border border-[#21262d] rounded p-2.5">
                  <div className="text-lg font-bold text-[#e6edf3]">{byAgent.size}</div>
                  <div className="text-[11px] text-[#8b949e]">Agents reviewed</div>
                </div>
              </div>

              {topCats.length > 0 && (
                <div className="space-y-1">
                  <div className="text-[11px] font-medium text-[#8b949e] uppercase tracking-wide">By Category</div>
                  {topCats.map(([cat, count]) => {
                    const meta = FEEDBACK_CATEGORIES.find(c => c.value === cat);
                    const pct = Math.round((count / items.length) * 100);
                    return (
                      <div key={cat} className="flex items-center gap-2">
                        <div className="flex-1 relative h-5 bg-[#161b22] rounded overflow-hidden">
                          <div
                            className="absolute inset-y-0 left-0 rounded"
                            style={{ width: `${pct}%`, backgroundColor: `${meta?.color ?? '#8b949e'}25` }}
                          />
                          <span className="absolute inset-0 flex items-center px-2 text-[10px]" style={{ color: meta?.color ?? '#8b949e' }}>
                            {meta?.label ?? cat}
                          </span>
                        </div>
                        <span className="text-[11px] text-[#8b949e] w-5 text-right shrink-0">{count}</span>
                      </div>
                    );
                  })}
                </div>
              )}

              {/* By agent with inline edit */}
              <div className="space-y-2">
                <div className="text-[11px] font-medium text-[#8b949e] uppercase tracking-wide">By Agent</div>
                {Array.from(byAgent.entries()).map(([agentId, agentItems]) => {
                  const agent = agentMap.get(agentId);
                  const { name } = agent ? getAgentDisplay(agent) : { name: agentItems[0]?.agentName || agentId.slice(0, 8) };
                  const isOpen = !collapsed.has(agentId);
                  return (
                    <div key={agentId} className="bg-[#161b22] border border-[#21262d] rounded overflow-hidden">
                      <button
                        onClick={() => setCollapsed(s => { const n = new Set(s); n.has(agentId) ? n.delete(agentId) : n.add(agentId); return n; })}
                        className="w-full flex items-center gap-2 px-3 py-2 hover:bg-[#21262d] transition-colors text-left"
                      >
                        {isOpen
                          ? <ChevronDown className="h-3 w-3 text-[#8b949e] shrink-0" />
                          : <ChevronRight className="h-3 w-3 text-[#8b949e] shrink-0" />}
                        <span className="text-xs font-medium text-[#e6edf3] flex-1 truncate">{name}</span>
                        <span className="text-[10px] text-[#8b949e] shrink-0">{agentItems.length}</span>
                      </button>

                      {isOpen && (
                        <div className="border-t border-[#21262d] divide-y divide-[#21262d]">
                          {agentItems.map(item => {
                            const cat = FEEDBACK_CATEGORIES.find(c => c.value === item.category);
                            const isEditing = editingId === item.id;

                            if (isEditing) {
                              const ec = FEEDBACK_CATEGORIES.find(c => c.value === editCategory)!;
                              return (
                                <div key={item.id} className="px-3 py-2 space-y-1.5 bg-[#0d1117]/60">
                                  <div className="relative">
                                    <button
                                      onClick={() => setShowEditCatMenu(v => !v)}
                                      className="w-full flex items-center justify-between gap-1.5 px-2 py-1 rounded bg-[#21262d] border border-[#30363d] text-[10px]"
                                    >
                                      <div className="flex items-center gap-1.5">
                                        <span className="w-1.5 h-1.5 rounded-full" style={{ backgroundColor: ec.color }} />
                                        <span style={{ color: ec.color }}>{ec.label}</span>
                                      </div>
                                      <ChevronDown className="h-2.5 w-2.5 text-[#8b949e]" />
                                    </button>
                                    {showEditCatMenu && (
                                      <div className="absolute top-full left-0 right-0 z-20 mt-0.5 bg-[#161b22] border border-[#30363d] rounded shadow-xl overflow-hidden">
                                        {FEEDBACK_CATEGORIES.map(c => (
                                          <button
                                            key={c.value}
                                            onClick={() => { setEditCategory(c.value); setShowEditCatMenu(false); }}
                                            className={cn('w-full flex items-center gap-1.5 px-2 py-1 text-[10px] hover:bg-[#21262d] text-left', editCategory === c.value && 'bg-[#21262d]')}
                                          >
                                            <span className="w-1.5 h-1.5 rounded-full" style={{ backgroundColor: c.color }} />
                                            <span style={{ color: c.color }}>{c.label}</span>
                                          </button>
                                        ))}
                                      </div>
                                    )}
                                  </div>
                                  <textarea
                                    ref={editTextareaRef}
                                    value={editText}
                                    onChange={e => setEditText(e.target.value)}
                                    rows={2}
                                    className="w-full px-2 py-1 rounded bg-[#21262d] border border-[#30363d] text-[11px] text-[#e6edf3] focus:outline-none focus:border-[#58a6ff]/50 resize-none"
                                    onKeyDown={e => {
                                      if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) saveEdit(item.id);
                                      if (e.key === 'Escape') cancelEdit();
                                    }}
                                  />
                                  <div className="flex gap-1">
                                    <button
                                      onClick={() => saveEdit(item.id)} disabled={!editText.trim()}
                                      className="flex items-center gap-1 px-2 py-0.5 rounded bg-[#238636] hover:bg-[#2ea043] disabled:opacity-40 text-white text-[10px] transition-colors"
                                    >
                                      <Check className="h-2.5 w-2.5" /> Save
                                    </button>
                                    <button
                                      onClick={cancelEdit}
                                      className="flex items-center gap-1 px-2 py-0.5 rounded border border-[#30363d] text-[#8b949e] hover:text-[#e6edf3] text-[10px] transition-colors"
                                    >
                                      <X className="h-2.5 w-2.5" /> Cancel
                                    </button>
                                  </div>
                                </div>
                              );
                            }

                            return (
                              <div key={item.id} className="group flex items-start gap-2 px-3 py-2">
                                <div className="flex-1 min-w-0">
                                  <span
                                    className="inline-block text-[9px] px-1 py-0.5 rounded font-medium mb-1"
                                    style={{ color: cat?.color ?? '#8b949e', backgroundColor: `${cat?.color ?? '#8b949e'}18` }}
                                  >
                                    {cat?.label ?? item.category}
                                  </span>
                                  <p className="text-[11px] text-[#c9d1d9] leading-relaxed">{item.text}</p>
                                </div>
                                <div className="flex gap-0.5 shrink-0 opacity-0 group-hover:opacity-100 transition-all mt-0.5">
                                  <button
                                    onClick={() => startEdit(item.id, item.text, item.category as FeedbackCategory)}
                                    className="p-1 rounded text-[#484f58] hover:text-[#58a6ff] transition-colors" title="Edit"
                                  >
                                    <Pencil className="h-2.5 w-2.5" />
                                  </button>
                                  <button
                                    onClick={() => deleteFeedback(sessionId, item.id)}
                                    className="p-1 rounded text-[#484f58] hover:text-[#ff7b72] transition-colors" title="Delete"
                                  >
                                    <Trash2 className="h-2.5 w-2.5" />
                                  </button>
                                </div>
                              </div>
                            );
                          })}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          )
        ) : (
          /* ── History tab ── */
          <div className="p-3 space-y-2">
            {/* History header */}
            {cycles.length > 0 && (
              <div className="flex items-center justify-between mb-1">
                <span className="text-[11px] text-[#484f58]">
                  {cycles.length} cycle{cycles.length !== 1 ? 's' : ''}
                </span>
                {rewoundCount > 0 && (
                  <button
                    onClick={() => clearRewoundCycles(sessionId)}
                    className="flex items-center gap-1 text-[10px] text-[#484f58] hover:text-[#ff7b72] transition-colors px-1.5 py-0.5 rounded hover:bg-[#ff7b72]/10"
                  >
                    <Trash2 className="h-2.5 w-2.5" />
                    Clear {rewoundCount} rewound
                  </button>
                )}
              </div>
            )}

            {cycles.map(cycle => (
              <CycleCard
                key={cycle.id}
                cycle={cycle}
                sessionId={sessionId}
                isLatest={cycle.id === latestActiveCycleId}
                isExpanded={expandedCycleId === cycle.id}
                onToggle={() => setExpandedCycleId(expandedCycleId === cycle.id ? null : cycle.id)}
                onRewind={() => handleRewind(cycle)}
                onDelete={() => deleteCycle(sessionId, cycle.id)}
                streamEntries={streamEntries}
                pendingApprovals={pendingApprovals}
                onApprove={(requestId) => wsSend({ type: 'permission_response', sessionId, cycleId: cycle.id, requestId, approved: true })}
                onDeny={(requestId) => wsSend({ type: 'permission_response', sessionId, cycleId: cycle.id, requestId, approved: false })}
              />
            ))}

            {cycles.length === 0 && (
              <div className="text-center py-12 text-[#484f58] text-xs">No improvement cycles yet</div>
            )}
          </div>
        )}
          </div>
        )}
      </div>

      {/* Rewind confirmation overlay */}
      {rewindConfirm && (
        <div className="shrink-0 border-t border-[#f0883e]/40 bg-[#f0883e]/5 p-3 space-y-2">
          <div className="flex items-start gap-2">
            <RotateCcw className="h-3.5 w-3.5 text-[#f0883e] shrink-0 mt-0.5" />
            <div className="flex-1">
              <p className="text-[11px] font-medium text-[#e6edf3]">Rewind Cycle #{rewindConfirm.cycleNumber}?</p>
              <p className="text-[10px] text-[#8b949e] mt-0.5 leading-relaxed">
                The session JSONL will be truncated to the snapshot recorded before this
                cycle ran — removing its messages exactly as Claude Code&apos;s{' '}
                <code className="bg-[#21262d] px-1 rounded font-mono">/rewind</code> does.
                The editor will then open so you can refine the prompt and re-apply.
              </p>
            </div>
          </div>
          <div className="flex gap-2">
            <button
              onClick={confirmRewind}
              disabled={isRewinding}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded bg-[#f0883e] hover:bg-[#f0883e]/80 disabled:opacity-40 text-white text-xs font-medium transition-colors"
            >
              {isRewinding ? <Loader2 className="h-3 w-3 animate-spin" /> : <RotateCcw className="h-3 w-3" />}
              {isRewinding ? 'Rewinding…' : 'Confirm Rewind'}
            </button>
            <button
              onClick={() => setRewindConfirm(null)}
              disabled={isRewinding}
              className="px-3 py-1.5 rounded border border-[#30363d] text-[#8b949e] hover:text-[#e6edf3] text-xs transition-colors"
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {/* Footer */}
      <div className="shrink-0 border-t border-[#21262d] bg-[#0d1117]">
        {applyStep === 'editing-prompt' ? (
          /* Slim action bar — editor lives in the content area above */
          <div className="flex items-center gap-2 px-3 py-2.5">
            <button
              onClick={handleApply}
              disabled={!promptDraft.trim() || isApplying}
              className="flex-1 flex items-center justify-center gap-1.5 px-3 py-2 rounded bg-[#1f6feb] hover:bg-[#388bfd] disabled:opacity-40 text-white text-xs font-semibold transition-colors"
            >
              {isApplying
                ? <><Loader2 className="h-3 w-3 animate-spin" /> Applying…</>
                : <><Zap className="h-3 w-3" /> Apply Improvements</>}
            </button>
            <button
              onClick={() => { setApplyStep('idle'); setRewindFromCycle(null); }}
              className="px-3 py-2 rounded border border-[#30363d] text-[#8b949e] hover:text-[#e6edf3] hover:border-[#484f58] text-xs transition-colors"
            >
              Cancel
            </button>
          </div>
        ) : (
          <div className="p-3">
            <button
              onClick={handlePreview}
              disabled={items.length === 0 || applyStep !== 'idle'}
              className="w-full flex items-center justify-center gap-2 px-3 py-2 rounded bg-[#1f6feb] hover:bg-[#388bfd] disabled:opacity-30 disabled:cursor-not-allowed text-white text-sm font-medium transition-colors"
            >
              {applyStep === 'loading-preview' || applyStep === 'applying'
                ? <Loader2 className="h-4 w-4 animate-spin" />
                : <Zap className="h-4 w-4" />}
              {applyStep === 'loading-preview' ? 'Generating prompt…'
                : applyStep === 'applying' ? 'Applying…'
                : <>Apply Improvements{items.length > 0 && <span className="text-xs opacity-75 ml-1">({items.length})</span>}</>}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

// ── CycleCard ──────────────────────────────────────────────────────────────────

interface CycleCardProps {
  cycle: ImprovementCycle;
  sessionId: string;
  isLatest: boolean;
  isExpanded: boolean;
  onToggle: () => void;
  onRewind: () => void;
  onDelete: () => void;
  streamEntries: StreamEntry[];
  pendingApprovals: Map<string, { toolName: string; toolInput: Record<string, unknown> }>;
  onApprove: (requestId: string) => void;
  onDeny: (requestId: string) => void;
}

function CycleCard({ cycle, sessionId, isLatest, isExpanded, onToggle, onRewind, onDelete, streamEntries, pendingApprovals, onApprove, onDeny }: CycleCardProps) {
  const [showPrompt, setShowPrompt] = useState(false);
  const s = STATUS_META[cycle.status] ?? STATUS_META.completed;
  const canExpand = cycle.status !== 'rewound';
  const canRewind = cycle.status === 'completed' || cycle.status === 'failed';

  const date = new Date(cycle.createdAt).toLocaleDateString([], {
    month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit',
  });

  return (
    <div
      className={cn(
        'rounded border overflow-hidden transition-colors',
        cycle.status === 'rewound'
          ? 'border-[#21262d] bg-[#0d1117] opacity-50'
          : isLatest
            ? 'border-[#21262d] bg-[#161b22] ring-1 ring-[#3fb950]/20'
            : 'border-[#21262d] bg-[#161b22]',
      )}
      style={{ borderLeftColor: s.color, borderLeftWidth: '3px' }}
    >
      {/* ── Header row ── */}
      <div
        className={cn(
          'flex items-center gap-2 px-2.5 pt-2 pb-1.5',
          canExpand && 'cursor-pointer hover:bg-[#21262d]/40 transition-colors',
        )}
        onClick={canExpand ? onToggle : undefined}
      >
        <span className="text-[11px] font-bold text-[#e6edf3] shrink-0 w-6">#{cycle.cycleNumber}</span>

        <span
          className="text-[10px] font-medium px-1.5 py-0.5 rounded shrink-0"
          style={{ color: s.color, background: `${s.color}18` }}
        >
          {s.label}
        </span>

        {isLatest && (
          <span className="text-[9px] font-bold uppercase tracking-wider shrink-0" style={{ color: '#3fb950' }}>
            Current
          </span>
        )}

        <span className="flex-1" />

        <span className="text-[10px] text-[#484f58] shrink-0">{date}</span>

        {canExpand && (
          isExpanded
            ? <ChevronDown className="h-3 w-3 text-[#484f58] shrink-0" />
            : <ChevronRight className="h-3 w-3 text-[#484f58] shrink-0" />
        )}
      </div>

      {/* ── Action row ── */}
      <div className="flex items-center gap-1 px-2 pb-2">
        {canRewind && (
          <button
            onClick={e => { e.stopPropagation(); onRewind(); }}
            className="flex items-center gap-1 text-[10px] text-[#8b949e] hover:text-[#f0883e] transition-colors px-1.5 py-0.5 rounded hover:bg-[#f0883e]/10"
            title="Rewind — restore conversation to before this cycle"
          >
            <RotateCcw className="h-2.5 w-2.5" /> Rewind
          </button>
        )}
        <button
          onClick={e => { e.stopPropagation(); onDelete(); }}
          className="flex items-center gap-1 text-[10px] text-[#484f58] hover:text-[#ff7b72] transition-colors px-1.5 py-0.5 rounded hover:bg-[#ff7b72]/10 ml-auto"
          title="Delete this cycle record"
        >
          <Trash2 className="h-2.5 w-2.5" />
        </button>
      </div>

      {/* ── Expanded content ── */}
      {isExpanded && canExpand && (
        <div className="border-t border-[#21262d]">
          {/* Prompt toggle */}
          <button
            onClick={e => { e.stopPropagation(); setShowPrompt(v => !v); }}
            className="w-full flex items-center gap-1.5 px-2.5 py-1.5 text-[10px] text-[#8b949e] hover:bg-[#21262d]/50 transition-colors text-left"
          >
            {showPrompt
              ? <ChevronDown className="h-2.5 w-2.5 shrink-0" />
              : <ChevronRight className="h-2.5 w-2.5 shrink-0" />}
            Generated Prompt
            <span className="text-[#484f58] ml-auto">{cycle.generatedPrompt.length.toLocaleString()} chars</span>
          </button>
          {showPrompt && (
            <div className="px-2.5 pb-2.5">
              <pre className="text-[10px] text-[#8b949e] whitespace-pre-wrap max-h-40 overflow-y-auto font-mono bg-[#0d1117] p-2 rounded border border-[#21262d] leading-relaxed">
                {cycle.generatedPrompt}
              </pre>
            </div>
          )}

          {/* Files touched summary — extracted from stream entries */}
          {cycle.streamEntries && cycle.streamEntries.length > 0 && (
            <TouchedFilesSummary entries={cycle.streamEntries} sessionId={sessionId} />
          )}

          {/* File changes (structured diff) */}
          {cycle.fileChanges && cycle.fileChanges.length > 0 && (
            <div className="border-t border-[#21262d]">
              <FileDiffViewer changes={cycle.fileChanges} sessionId={sessionId} />
            </div>
          )}

          {/* Fallback: extract file references from response when no structured data */}
          {!cycle.fileChanges?.length && !cycle.streamEntries?.length && cycle.claudeResponse && (
            <ReferencedFiles sessionId={sessionId} responseText={cycle.claudeResponse} />
          )}

          {/* Response — collapsible stream log (live or persisted) */}
          <div className="border-t border-[#21262d]">
            <CycleResponseView
              cycle={cycle}
              sessionId={sessionId}
              streamEntries={streamEntries}
              pendingApprovals={pendingApprovals}
              onApprove={onApprove}
              onDeny={onDeny}
            />
          </div>

          {cycle.completedAt && (
            <div className="px-2.5 pb-2 text-[10px] text-[#484f58]">
              Completed {new Date(cycle.completedAt).toLocaleString([], {
                month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit',
              })}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ── TouchedFilesSummary ──────────────────────────────────────────────────────

function TouchedFilesSummary({ entries, sessionId }: { entries: StreamEntry[]; sessionId: string }) {
  const [expandedFile, setExpandedFile] = useState<string | null>(null);

  const files: { path: string; toolName: string; approved?: boolean }[] = [];
  const seen = new Set<string>();
  for (const e of entries) {
    if (e.kind === 'tool_use' && e.toolInput?.file_path) {
      const fp = String(e.toolInput.file_path);
      if (!seen.has(fp)) {
        seen.add(fp);
        files.push({ path: fp, toolName: e.toolName ?? 'Unknown' });
      }
    }
    // Approval results logged as tool_result with filePath
    if (e.kind === 'tool_result' && (e as Record<string, unknown>).filePath) {
      const fp = String((e as Record<string, unknown>).filePath);
      const approved = (e as Record<string, unknown>).approved as boolean | undefined;
      if (!seen.has(fp)) {
        seen.add(fp);
        files.push({ path: fp, toolName: String((e as Record<string, unknown>).toolName ?? 'Edit'), approved });
      }
    }
  }

  if (files.length === 0) return null;

  return (
    <div className="border-t border-[#21262d]">
      <div className="px-2.5 py-1.5 text-[10px] text-[#8b949e] font-semibold uppercase tracking-wider flex items-center gap-1.5">
        <FileCode2 className="h-3 w-3" />
        Files Touched ({files.length})
      </div>
      <div className="space-y-0.5 px-2.5 pb-2">
        {files.map(f => {
          const fileName = f.path.split(/[/\\]/).pop() ?? f.path;
          const isExpanded = expandedFile === f.path;
          const isWrite = f.toolName === 'Edit' || f.toolName === 'Write';
          const color = isWrite ? '#f0883e' : '#79c0ff';

          return (
            <div key={f.path} className="rounded border overflow-hidden" style={{ borderColor: `${color}30` }}>
              <button
                className="w-full flex items-center gap-1.5 px-2 py-1 hover:bg-[#161b22] transition-colors text-left"
                onClick={() => setExpandedFile(isExpanded ? null : f.path)}
              >
                <FileCode2 className="h-3 w-3 shrink-0" style={{ color }} />
                <span className="text-[10px] font-mono text-[#c9d1d9] truncate flex-1">{f.path}</span>
                <span className="text-[9px] px-1.5 py-0.5 rounded shrink-0" style={{ color, background: `${color}15` }}>
                  {f.toolName}
                </span>
                {f.approved !== undefined && (
                  <span className={cn(
                    'text-[9px] px-1.5 py-0.5 rounded shrink-0',
                    f.approved ? 'text-[#3fb950] bg-[#3fb950]/10' : 'text-[#ff7b72] bg-[#ff7b72]/10',
                  )}>
                    {f.approved ? 'approved' : 'denied'}
                  </span>
                )}
                <ChevronRight className={cn('h-2.5 w-2.5 text-[#484f58] shrink-0 transition-transform', isExpanded && 'rotate-90')} />
              </button>
              {isExpanded && (
                <FileContentViewer sessionId={sessionId} filePath={f.path} />
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ── CycleResponseView (collapsible wrapper for stream log / markdown) ────────

function CycleResponseView({
  cycle,
  sessionId,
  streamEntries,
  pendingApprovals,
  onApprove,
  onDeny,
}: {
  cycle: ImprovementCycle;
  sessionId: string;
  streamEntries: StreamEntry[];
  pendingApprovals: Map<string, { toolName: string; toolInput: Record<string, unknown> }>;
  onApprove: (requestId: string) => void;
  onDeny: (requestId: string) => void;
}) {
  const [showLog, setShowLog] = useState(cycle.status === 'applying');
  const hasStreamLog = (cycle.streamEntries && cycle.streamEntries.length > 0) || cycle.status === 'applying';
  const label = cycle.status === 'applying' ? 'Live Stream' : hasStreamLog ? 'Activity Log' : 'Response';
  const entryCount = cycle.status === 'applying'
    ? streamEntries.length
    : cycle.streamEntries?.length ?? 0;

  return (
    <>
      <button
        onClick={e => { e.stopPropagation(); setShowLog(v => !v); }}
        className="w-full flex items-center gap-1.5 px-2.5 py-1.5 text-[10px] text-[#8b949e] hover:bg-[#21262d]/50 transition-colors text-left"
      >
        {showLog
          ? <ChevronDown className="h-2.5 w-2.5 shrink-0" />
          : <ChevronRight className="h-2.5 w-2.5 shrink-0" />}
        {label}
        {entryCount > 0 && (
          <span className="text-[#484f58] ml-1">({entryCount} events)</span>
        )}
        {cycle.status === 'applying' && (
          <Loader2 className="h-2.5 w-2.5 animate-spin text-[#58a6ff] ml-auto" />
        )}
      </button>
      {showLog && (
        <div className="px-2.5 pb-2.5">
          {cycle.status === 'applying' ? (
            <CollapsibleStreamLog
              entries={streamEntries}
              sessionId={sessionId}
              pendingApprovals={pendingApprovals}
              onApprove={onApprove}
              onDeny={onDeny}
              isLive
            />
          ) : cycle.streamEntries && cycle.streamEntries.length > 0 ? (
            <CollapsibleStreamLog
              entries={cycle.streamEntries}
              sessionId={sessionId}
            />
          ) : cycle.claudeResponse ? (
            <div className="max-h-[420px] overflow-y-auto pr-0.5">
              <MarkdownRenderer content={cycle.claudeResponse} size="sm" />
            </div>
          ) : (
            <p className="text-[11px] text-[#484f58]">No response captured</p>
          )}
        </div>
      )}
    </>
  );
}

// ── Collapsible Stream Log ───────────────────────────────────────────────────

const TOOL_COLORS: Record<string, { border: string; icon: string }> = {
  Bash:  { border: '#39d353', icon: '#39d353' },
  Read:  { border: '#79c0ff', icon: '#79c0ff' },
  Edit:  { border: '#f0883e', icon: '#f0883e' },
  Write: { border: '#f0883e', icon: '#f0883e' },
  Grep:  { border: '#d2a8ff', icon: '#d2a8ff' },
  Glob:  { border: '#d2a8ff', icon: '#d2a8ff' },
  Agent: { border: '#58a6ff', icon: '#58a6ff' },
};

function getToolColor(name: string) {
  return TOOL_COLORS[name] ?? { border: '#30363d', icon: '#c9d1d9' };
}

function getToolSummaryText(toolName: string, toolInput: Record<string, unknown>): string {
  if (toolName === 'Bash') return String(toolInput?.command ?? '').slice(0, 80);
  if (toolName === 'Read') return String(toolInput?.file_path ?? '').split(/[/\\]/).slice(-2).join('/');
  if (toolName === 'Edit') return String(toolInput?.file_path ?? '').split(/[/\\]/).slice(-2).join('/') + ' (edit)';
  if (toolName === 'Write') return String(toolInput?.file_path ?? '').split(/[/\\]/).slice(-2).join('/') + ' (write)';
  if (toolName === 'Grep') return `"${String(toolInput?.pattern ?? '').slice(0, 40)}"`;
  if (toolName === 'Glob') return String(toolInput?.pattern ?? '').slice(0, 40);
  if (toolName === 'Agent') return String(toolInput?.description ?? toolInput?.prompt ?? '').slice(0, 60);
  return JSON.stringify(toolInput).slice(0, 60);
}

function formatToolInput(toolName: string, toolInput: Record<string, unknown>): string {
  if (toolName === 'Bash') return String(toolInput?.command ?? '');
  if (toolName === 'Read') return String(toolInput?.file_path ?? '');
  if (toolName === 'Edit') {
    const fp = String(toolInput?.file_path ?? '');
    const old = String(toolInput?.old_string ?? '');
    const nw = String(toolInput?.new_string ?? '');
    return `File: ${fp}\n\n--- old\n${old}\n+++ new\n${nw}`;
  }
  if (toolName === 'Write') {
    const fp = String(toolInput?.file_path ?? '');
    const content = String(toolInput?.content ?? '');
    return `File: ${fp}\n\n${content.slice(0, 2000)}${content.length > 2000 ? '\n...(truncated)' : ''}`;
  }
  if (toolName === 'Grep') return `pattern: ${toolInput?.pattern ?? ''}\npath: ${toolInput?.path ?? '.'}`;
  return JSON.stringify(toolInput, null, 2);
}

function ThinkingEntry({ entry }: { entry: StreamEntry }) {
  const [expanded, setExpanded] = useState(false);
  const text = entry.text ?? '';
  const hasContent = text.length > 0 && text !== 'Thinking...';
  const preview = hasContent ? text.slice(0, 80) + (text.length > 80 ? '...' : '') : 'Thinking...';

  return (
    <div className="rounded border border-[#d2a8ff]/20 bg-[#d2a8ff]/5 overflow-hidden">
      <button
        className="w-full flex items-center gap-1.5 px-2 py-1.5 hover:bg-[#d2a8ff]/10 transition-colors text-left"
        onClick={() => hasContent && setExpanded(v => !v)}
      >
        <Brain className="h-3 w-3 text-[#d2a8ff] shrink-0" />
        <span className="text-[10px] font-semibold text-[#d2a8ff]">Thinking</span>
        <span className="text-[10px] text-[#8b949e] italic truncate flex-1">{preview}</span>
        {hasContent && (
          <ChevronRight className={cn('h-2.5 w-2.5 text-[#484f58] shrink-0 transition-transform', expanded && 'rotate-90')} />
        )}
      </button>
      {expanded && hasContent && (
        <div className="border-t border-[#d2a8ff]/15 px-2 py-1.5">
          <pre className="text-[10px] text-[#c9d1d9] font-mono whitespace-pre-wrap max-h-60 overflow-y-auto leading-relaxed">
            {text}
          </pre>
        </div>
      )}
    </div>
  );
}

function ToolCallEntry({ entry, result, sessionId }: { entry: StreamEntry; result?: StreamEntry; sessionId: string }) {
  const [expanded, setExpanded] = useState(false);
  const [showFile, setShowFile] = useState(false);
  const toolName = entry.toolName ?? 'Unknown';
  const toolInput = entry.toolInput ?? {};
  const colors = getToolColor(toolName);
  const summary = getToolSummaryText(toolName, toolInput);
  const filePath = String(toolInput?.file_path ?? '');
  const hasFile = filePath && ['Read', 'Edit', 'Write', 'Glob'].includes(toolName);

  const resultContent = result?.content ?? '';
  const isError = result?.isError ?? false;
  const isPermDenied = isError && resultContent.includes('requested permissions');

  const resultBadge = isPermDenied ? 'denied'
    : isError ? 'error'
    : result ? 'done'
    : null;

  const ToolIcon = toolName === 'Bash' ? Terminal
    : toolName === 'Read' ? Eye
    : (toolName === 'Edit' || toolName === 'Write') ? Wrench
    : (toolName === 'Grep' || toolName === 'Glob') ? Eye
    : Wrench;

  return (
    <div className="rounded border overflow-hidden" style={{ borderColor: `${colors.border}40`, backgroundColor: `${colors.border}08` }}>
      <button
        className="w-full flex items-center gap-1.5 px-2 py-1.5 hover:bg-[#161b22] transition-colors text-left"
        onClick={() => setExpanded(v => !v)}
      >
        <ToolIcon className="h-3 w-3 shrink-0" style={{ color: colors.icon }} />
        <span className="text-[10px] font-semibold" style={{ color: colors.icon }}>{toolName}</span>
        <span className="text-[10px] text-[#8b949e] font-mono truncate flex-1">{summary}</span>
        {hasFile && (
          <button
            onClick={e => { e.stopPropagation(); setShowFile(v => !v); }}
            className={cn(
              'text-[9px] flex items-center gap-0.5 px-1.5 py-0.5 rounded transition-colors shrink-0',
              showFile ? 'text-[#58a6ff] bg-[#58a6ff]/10' : 'text-[#484f58] hover:text-[#8b949e]',
            )}
          >
            <FileCode2 className="h-2.5 w-2.5" /> {showFile ? 'Hide' : 'View'}
          </button>
        )}
        {resultBadge && (
          <span className={cn(
            'text-[9px] font-medium px-1.5 py-0.5 rounded shrink-0',
            isPermDenied ? 'text-[#f0883e] bg-[#f0883e]/10'
            : isError ? 'text-[#ff7b72] bg-[#ff7b72]/10'
            : 'text-[#3fb950] bg-[#3fb950]/10',
          )}>
            {resultBadge}
          </span>
        )}
        <ChevronRight className={cn('h-2.5 w-2.5 text-[#484f58] shrink-0 transition-transform', expanded && 'rotate-90')} />
      </button>

      {showFile && hasFile && (
        <div className="border-t" style={{ borderColor: `${colors.border}20` }}>
          <FileContentViewer sessionId={sessionId} filePath={filePath} />
        </div>
      )}

      {expanded && (
        <div className="border-t space-y-1.5 px-2 py-1.5" style={{ borderColor: `${colors.border}20` }}>
          <div>
            <div className="text-[9px] text-[#6e7681] font-semibold uppercase tracking-wider mb-0.5">Input</div>
            <pre className="text-[10px] font-mono text-[#c9d1d9] bg-[#0d1117] rounded p-1.5 overflow-x-auto max-h-40 whitespace-pre-wrap leading-relaxed">
              {formatToolInput(toolName, toolInput)}
            </pre>
          </div>
          {result && !isPermDenied && (
            <div>
              <div className={cn(
                'text-[9px] font-semibold uppercase tracking-wider mb-0.5',
                isError ? 'text-[#ff7b72]' : 'text-[#3fb950]',
              )}>
                {isError ? 'Error' : 'Output'}
              </div>
              <pre className={cn(
                'text-[10px] font-mono rounded p-1.5 overflow-x-auto max-h-40 whitespace-pre-wrap leading-relaxed',
                isError ? 'text-[#ff7b72] bg-[#f85149]/5' : 'text-[#c9d1d9] bg-[#0d1117]',
              )}>
                {resultContent.length > 2000 ? resultContent.slice(0, 2000) + '\n...(truncated)' : resultContent || '(empty)'}
              </pre>
            </div>
          )}
          {isPermDenied && (
            <div className="flex items-center gap-1.5 text-[10px] text-[#f0883e]">
              <ShieldX className="h-3 w-3 shrink-0" />
              <span>Permission denied — awaiting review approval</span>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function TextEntry({ entry }: { entry: StreamEntry }) {
  const [expanded, setExpanded] = useState(true);
  const text = entry.text ?? '';
  const isLong = text.length > 300;

  return (
    <div className="rounded border border-[#21262d] bg-[#161b22] overflow-hidden">
      <button
        className="w-full flex items-center gap-1.5 px-2 py-1.5 hover:bg-[#21262d]/50 transition-colors text-left"
        onClick={() => setExpanded(v => !v)}
      >
        <MessageSquare className="h-3 w-3 text-[#c9d1d9] shrink-0" />
        <span className="text-[10px] font-semibold text-[#c9d1d9]">Response</span>
        {!expanded && (
          <span className="text-[10px] text-[#8b949e] truncate flex-1">{text.slice(0, 60)}...</span>
        )}
        <ChevronRight className={cn('h-2.5 w-2.5 text-[#484f58] shrink-0 transition-transform', expanded && 'rotate-90')} />
      </button>
      {expanded && (
        <div className="border-t border-[#21262d] px-2 py-1.5">
          <div className={cn('text-[11px] text-[#c9d1d9]', isLong && 'max-h-80 overflow-y-auto')}>
            <MarkdownRenderer content={text} size="sm" />
          </div>
        </div>
      )}
    </div>
  );
}

function CollapsibleStreamLog({
  entries,
  sessionId,
  pendingApprovals,
  onApprove,
  onDeny,
  isLive = false,
}: {
  entries: StreamEntry[];
  sessionId: string;
  pendingApprovals?: Map<string, { toolName: string; toolInput: Record<string, unknown> }>;
  onApprove?: (requestId: string) => void;
  onDeny?: (requestId: string) => void;
  isLive?: boolean;
}) {
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (isLive) scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' });
  }, [entries.length, isLive]);

  if (entries.length === 0 && isLive) {
    return (
      <div className="flex items-center gap-2 text-[11px] text-[#58a6ff]">
        <Loader2 className="h-3 w-3 animate-spin" /> Starting improvement cycle...
      </div>
    );
  }

  if (entries.length === 0) return null;

  // Build a map of tool_use_id -> tool_result for pairing
  const resultMap = new Map<string, StreamEntry>();
  for (const e of entries) {
    if (e.kind === 'tool_result' && e.toolUseId) {
      resultMap.set(e.toolUseId, e);
    }
  }

  return (
    <div ref={scrollRef} className={cn('overflow-y-auto space-y-1.5 pr-0.5', isLive ? 'max-h-[500px]' : 'max-h-[600px]')}>
      {entries.map(entry => {
        if (entry.kind === 'system') {
          return (
            <div key={entry.id} className="flex items-center gap-1.5 text-[10px] text-[#484f58]">
              <Terminal className="h-3 w-3 shrink-0" />
              <span>{entry.text}</span>
            </div>
          );
        }

        if (entry.kind === 'thinking') {
          return <ThinkingEntry key={entry.id} entry={entry} />;
        }

        if (entry.kind === 'tool_use') {
          const result = entry.toolUseId ? resultMap.get(entry.toolUseId) : undefined;
          return <ToolCallEntry key={entry.id} entry={entry} result={result} sessionId={sessionId} />;
        }

        // Skip standalone tool_result — already paired with tool_use above
        if (entry.kind === 'tool_result') {
          if (entry.toolUseId && resultMap.has(entry.toolUseId)) return null;
          // Orphan result — show standalone
          const isError = entry.isError;
          const content = entry.content ?? '';
          return (
            <div key={entry.id} className="pl-4">
              <div className={cn(
                'text-[10px] font-mono rounded px-2 py-1 max-h-20 overflow-y-auto',
                isError ? 'text-[#ff7b72] bg-[#3d0a0a]/30' : 'text-[#8b949e] bg-[#0d1117]',
              )}>
                {content.length > 300 ? content.slice(0, 300) + '...' : content}
              </div>
            </div>
          );
        }

        if (entry.kind === 'permission_request' && onApprove && onDeny) {
          return (
            <ApprovalCard
              key={entry.id}
              entry={entry}
              sessionId={sessionId}
              onApprove={() => entry.requestId && onApprove(entry.requestId)}
              onDeny={() => entry.requestId && onDeny(entry.requestId)}
            />
          );
        }

        if (entry.kind === 'text') {
          return <TextEntry key={entry.id} entry={entry} />;
        }

        return null;
      })}
      {isLive && pendingApprovals && pendingApprovals.size > 0 && (
        <div className="flex items-center gap-2 text-[11px] text-[#f0883e] pt-1">
          <Loader2 className="h-3 w-3 animate-spin" /> Waiting for approval...
        </div>
      )}
      {isLive && pendingApprovals && pendingApprovals.size === 0 && entries.length > 0 && entries[entries.length - 1].kind !== 'text' && (
        <div className="flex items-center gap-2 text-[11px] text-[#58a6ff] pt-1">
          <Loader2 className="h-3 w-3 animate-spin" /> Processing...
        </div>
      )}
    </div>
  );
}

function ApprovalCard({ entry, sessionId, onApprove, onDeny }: { entry: StreamEntry; sessionId: string; onApprove: () => void; onDeny: () => void }) {
  const [viewMode, setViewMode] = useState<'diff' | 'file'>('diff');
  const filePath = String(entry.toolInput?.file_path ?? 'unknown');
  const fileName = filePath.split(/[/\\]/).pop() ?? filePath;
  const isPending = entry.approved === null;
  const isApproved = entry.approved === true;

  const diffPreview = entry.toolName === 'Write'
    ? buildWriteDiff(String(entry.toolInput?.content ?? ''))
    : entry.toolName === 'Edit'
      ? buildEditDiff(String(entry.toolInput?.old_string ?? ''), String(entry.toolInput?.new_string ?? ''))
      : null;

  return (
    <div className={cn(
      'rounded border overflow-hidden',
      isPending
        ? 'border-[#f0883e]/50 bg-[#f0883e]/5 ring-1 ring-[#f0883e]/20'
        : isApproved
          ? 'border-[#3fb950]/30 bg-[#3fb950]/5'
          : 'border-[#ff7b72]/30 bg-[#ff7b72]/5',
    )}>
      {/* Header */}
      <div className="flex items-center gap-2 px-2.5 py-2">
        {isPending ? (
          <ShieldCheck className="h-4 w-4 text-[#f0883e] shrink-0" />
        ) : isApproved ? (
          <Check className="h-4 w-4 text-[#3fb950] shrink-0" />
        ) : (
          <ShieldX className="h-4 w-4 text-[#ff7b72] shrink-0" />
        )}
        <div className="flex-1 min-w-0">
          <div className="text-[11px] font-semibold text-[#e6edf3]">
            {isPending ? 'Approve Change?' : isApproved ? 'Approved' : 'Denied'}
          </div>
          <div className="text-[10px] text-[#8b949e] truncate">
            {entry.toolName} — {fileName}
          </div>
        </div>
        <div className="flex items-center gap-1">
          {diffPreview && (
            <button
              onClick={() => setViewMode(viewMode === 'diff' ? 'file' : 'diff')}
              className={cn(
                'text-[10px] flex items-center gap-1 px-1.5 py-0.5 rounded transition-colors',
                viewMode === 'file'
                  ? 'text-[#58a6ff] bg-[#58a6ff]/10'
                  : 'text-[#8b949e] hover:text-[#e6edf3]',
              )}
            >
              <FileCode2 className="h-3 w-3" /> {viewMode === 'file' ? 'Diff' : 'File'}
            </button>
          )}
        </div>
      </div>

      {/* Content: diff or full file */}
      {viewMode === 'diff' && diffPreview && (
        <div className="border-t border-[#21262d] bg-[#010409]">
          <div className="px-2.5 py-1 text-[9px] font-mono text-[#484f58] border-b border-[#21262d] truncate">
            {filePath}
          </div>
          <DiffLines diff={diffPreview} />
        </div>
      )}
      {viewMode === 'file' && (
        <div className="border-t border-[#21262d]">
          <FileContentViewer sessionId={sessionId} filePath={filePath} />
        </div>
      )}

      {/* Action buttons */}
      {isPending && (
        <div className="border-t border-[#21262d] flex gap-2 px-2.5 py-2">
          <button
            onClick={onApprove}
            className="flex-1 flex items-center justify-center gap-1.5 px-3 py-1.5 rounded bg-[#238636] hover:bg-[#2ea043] text-white text-[11px] font-medium transition-colors"
          >
            <Check className="h-3 w-3" /> Approve
          </button>
          <button
            onClick={onDeny}
            className="flex-1 flex items-center justify-center gap-1.5 px-3 py-1.5 rounded border border-[#ff7b72]/40 text-[#ff7b72] hover:bg-[#ff7b72]/10 text-[11px] font-medium transition-colors"
          >
            <X className="h-3 w-3" /> Deny
          </button>
        </div>
      )}
    </div>
  );
}

function buildWriteDiff(content: string): string {
  const lines = content.split('\n');
  return `@@ -0,0 +1,${lines.length} @@\n` + lines.map(l => `+${l}`).join('\n');
}

function buildEditDiff(oldStr: string, newStr: string): string {
  const oldLines = oldStr.split('\n');
  const newLines = newStr.split('\n');
  const removed = oldLines.map(l => `-${l}`).join('\n');
  const added = newLines.map(l => `+${l}`).join('\n');
  return `@@ -1,${oldLines.length} +1,${newLines.length} @@\n${removed}\n${added}`;
}

// ── ReferencedFiles (fallback for cycles without stream entries) ──────────────

function extractFilePathsFromText(text: string): string[] {
  const paths = new Set<string>();
  // Match file paths with extensions (e.g., src/foo/bar.ts, .claude/skills/agent.md)
  const fileRegex = /(?:^|\s|`|"|\()([a-zA-Z0-9_./-]+\/[a-zA-Z0-9_.-]+\.[a-zA-Z]{1,10})(?:\s|`|"|,|\)|$)/gm;
  let m;
  while ((m = fileRegex.exec(text)) !== null) {
    const fp = m[1].trim();
    // Filter out URLs and very short matches
    if (!fp.includes('://') && fp.length > 3 && !fp.startsWith('http')) {
      paths.add(fp);
    }
  }
  return Array.from(paths);
}

function ReferencedFiles({ sessionId, responseText }: { sessionId: string; responseText: string }) {
  const [expandedFile, setExpandedFile] = useState<string | null>(null);
  const filePaths = extractFilePathsFromText(responseText);

  if (filePaths.length === 0) return null;

  return (
    <div className="border-t border-[#21262d]">
      <div className="px-2.5 py-1.5 text-[10px] text-[#8b949e] font-semibold uppercase tracking-wider flex items-center gap-1.5">
        <FileCode2 className="h-3 w-3" />
        Files Referenced ({filePaths.length})
      </div>
      <div className="space-y-0.5 px-2.5 pb-2">
        {filePaths.map(fp => {
          const fileName = fp.split(/[/\\]/).pop() ?? fp;
          const isExpanded = expandedFile === fp;
          return (
            <div key={fp} className="rounded border border-[#21262d] overflow-hidden">
              <button
                className="w-full flex items-center gap-1.5 px-2 py-1 hover:bg-[#161b22] transition-colors text-left"
                onClick={() => setExpandedFile(isExpanded ? null : fp)}
              >
                <FileCode2 className="h-3 w-3 text-[#79c0ff] shrink-0" />
                <span className="text-[10px] font-mono text-[#c9d1d9] truncate flex-1">{fp}</span>
                <span className="text-[9px] text-[#484f58] shrink-0">{fileName}</span>
                <ChevronRight className={cn('h-2.5 w-2.5 text-[#484f58] shrink-0 transition-transform', isExpanded && 'rotate-90')} />
              </button>
              {isExpanded && (
                <FileContentViewer sessionId={sessionId} filePath={fp} />
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ── FileContentViewer ─────────────────────────────────────────────────────────

function FileContentViewer({ sessionId, filePath }: { sessionId: string; filePath: string }) {
  const [content, setContent] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setLoading(true);
    setError(null);
    setContent(null);
    fetch(`/api/v2/sessions/${sessionId}/file?path=${encodeURIComponent(filePath)}`)
      .then(async res => {
        if (!res.ok) {
          const data = await res.json().catch(() => ({ error: res.statusText }));
          throw new Error(data.error ?? `HTTP ${res.status}`);
        }
        return res.json();
      })
      .then(data => setContent(data.content))
      .catch(e => setError(String(e.message ?? e)))
      .finally(() => setLoading(false));
  }, [sessionId, filePath]);

  if (loading) {
    return (
      <div className="flex items-center gap-2 px-3 py-3 text-[10px] text-[#58a6ff]">
        <Loader2 className="h-3 w-3 animate-spin" /> Loading file...
      </div>
    );
  }

  if (error) {
    return (
      <div className="px-3 py-2 text-[10px] text-[#ff7b72]">{error}</div>
    );
  }

  const lines = (content ?? '').split('\n');
  return (
    <div className="bg-[#010409] overflow-x-auto max-h-80 overflow-y-auto">
      <div className="px-2.5 py-1 text-[9px] font-mono text-[#484f58] border-b border-[#21262d] truncate flex items-center gap-1.5">
        <FileCode2 className="h-3 w-3 shrink-0" />
        {filePath}
        <span className="ml-auto text-[#30363d]">{lines.length} lines</span>
      </div>
      <table className="w-full border-collapse text-[11px] font-mono leading-5">
        <tbody>
          {lines.map((line, i) => (
            <tr key={i} className="hover:bg-[#161b22]">
              <td className="select-none text-right pr-2 pl-2 text-[#30363d] border-r border-[#21262d] w-10 shrink-0">
                {i + 1}
              </td>
              <td className="px-3 py-0 whitespace-pre text-[#c9d1d9] break-all">
                {line}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ── FileDiffViewer ─────────────────────────────────────────────────────────────

function detectLang(filePath: string): string {
  const ext = filePath.split('.').pop()?.toLowerCase() ?? '';
  const map: Record<string, string> = {
    ts: 'ts', tsx: 'tsx', js: 'js', jsx: 'jsx',
    py: 'py', go: 'go', rs: 'rs', rb: 'rb',
    md: 'md', mdx: 'md', json: 'json',
    yaml: 'yaml', yml: 'yaml', toml: 'toml',
    css: 'css', scss: 'scss', html: 'html', sh: 'sh',
  };
  return map[ext] || ext || 'txt';
}

function FileDiffViewer({ changes, sessionId }: { changes: FileChange[]; sessionId: string }) {
  const [expandedFiles, setExpandedFiles] = useState<Set<string>>(new Set());
  const [fileViewMode, setFileViewMode] = useState<Record<string, 'diff' | 'file'>>({});

  const totalAdd = changes.reduce((s, c) => s + c.additions, 0);
  const totalDel = changes.reduce((s, c) => s + c.deletions, 0);

  const toggle = (fp: string) =>
    setExpandedFiles(prev => {
      const next = new Set(prev);
      next.has(fp) ? next.delete(fp) : next.add(fp);
      return next;
    });

  return (
    <div>
      {/* Section header */}
      <div className="flex items-center gap-2 px-2.5 py-1.5 bg-[#0d1117]">
        <span className="text-[10px] font-semibold text-[#8b949e] uppercase tracking-wide">
          Files Changed
        </span>
        <span className="text-[10px] text-[#484f58]">{changes.length}</span>
        <span className="ml-auto flex items-center gap-1.5 text-[10px] font-mono">
          {totalAdd > 0 && <span className="text-[#3fb950]">+{totalAdd}</span>}
          {totalDel > 0 && <span className="text-[#ff7b72]">−{totalDel}</span>}
        </span>
      </div>

      {/* Per-file rows */}
      <div className="divide-y divide-[#21262d]">
        {changes.map(fc => {
          const isExpanded = expandedFiles.has(fc.filePath);
          const fileName = fc.filePath.split(/[/\\]/).pop() ?? fc.filePath;
          const lang = detectLang(fc.filePath);
          const typeColor =
            fc.type === 'create' ? '#3fb950' :
            fc.type === 'delete' ? '#ff7b72' : '#f0883e';
          const typeBg =
            fc.type === 'create' ? '#3fb950' :
            fc.type === 'delete' ? '#ff7b72' : '#f0883e';
          const typeLabel =
            fc.type === 'create' ? '+ Create' :
            fc.type === 'delete' ? '✕ Delete' : '✎ Modify';

          return (
            <div key={fc.filePath}>
              {/* File header row */}
              <button
                onClick={() => toggle(fc.filePath)}
                className="w-full flex items-center gap-2 px-2.5 py-1.5 hover:bg-[#161b22] transition-colors text-left"
              >
                {isExpanded
                  ? <ChevronDown className="h-2.5 w-2.5 text-[#484f58] shrink-0" />
                  : <ChevronRight className="h-2.5 w-2.5 text-[#484f58] shrink-0" />}

                {/* Type badge */}
                <span
                  className="shrink-0 text-[9px] font-bold px-1 py-0.5 rounded border"
                  style={{ color: typeColor, borderColor: `${typeBg}40`, backgroundColor: `${typeBg}12` }}
                >
                  {typeLabel}
                </span>

                {/* File name */}
                <span className="text-[11px] font-semibold text-[#e6edf3] truncate flex-1">{fileName}</span>
                <span className="text-[9px] text-[#484f58] font-mono shrink-0">{lang}</span>

                {/* +/- stats */}
                <span className="shrink-0 flex items-center gap-1.5 font-mono text-[10px]">
                  {fc.additions > 0 && <span className="text-[#3fb950]">+{fc.additions}</span>}
                  {fc.deletions > 0 && <span className="text-[#ff7b72]">−{fc.deletions}</span>}
                </span>
              </button>

              {/* Full path (shown when collapsed, as a subtitle) */}
              {!isExpanded && fc.filePath !== fileName && (
                <div className="px-8 pb-1 text-[9px] text-[#30363d] font-mono truncate">
                  {fc.filePath}
                </div>
              )}

              {/* Expanded: diff or file view */}
              {isExpanded && (() => {
                const mode = fileViewMode[fc.filePath] ?? 'diff';
                return (
                  <div className="border-t border-[#21262d]">
                    <div className="flex items-center gap-1.5 px-3 py-1 bg-[#010409] border-b border-[#21262d]">
                      <span className="text-[9px] font-mono text-[#484f58] truncate flex-1">{fc.filePath}</span>
                      <button
                        onClick={e => { e.stopPropagation(); setFileViewMode(prev => ({ ...prev, [fc.filePath]: mode === 'diff' ? 'file' : 'diff' })); }}
                        className={cn(
                          'text-[9px] flex items-center gap-1 px-1.5 py-0.5 rounded transition-colors',
                          mode === 'file'
                            ? 'text-[#58a6ff] bg-[#58a6ff]/10'
                            : 'text-[#484f58] hover:text-[#8b949e]',
                        )}
                      >
                        <FileCode2 className="h-2.5 w-2.5" /> {mode === 'file' ? 'Diff' : 'View File'}
                      </button>
                    </div>
                    {mode === 'diff' ? (
                      fc.diff
                        ? <DiffLines diff={fc.diff} />
                        : <p className="px-3 py-2 text-[10px] text-[#484f58]">No diff available</p>
                    ) : (
                      <FileContentViewer sessionId={sessionId} filePath={fc.filePath} />
                    )}
                  </div>
                );
              })()}
            </div>
          );
        })}
      </div>
    </div>
  );
}

function DiffLines({ diff }: { diff: string }) {
  const lines = diff.split('\n');

  return (
    <div className="overflow-x-auto max-h-80 overflow-y-auto">
      <table className="w-full border-collapse text-[11px] font-mono leading-5">
        <tbody>
          {lines.map((line, i) => {
            const isAdd = line.startsWith('+') && !line.startsWith('+++');
            const isDel = line.startsWith('-') && !line.startsWith('---');
            const isHunk = line.startsWith('@@');

            if (isHunk) {
              return (
                <tr key={i} className="bg-[#1c2333]">
                  <td className="px-3 py-0.5 text-[#79c0ff] select-none w-full" colSpan={2}>
                    {line}
                  </td>
                </tr>
              );
            }

            return (
              <tr key={i} className={isAdd ? 'bg-[#0d4429]' : isDel ? 'bg-[#3d0a0a]' : ''}>
                <td className={cn(
                  'select-none text-center w-5 shrink-0 pl-2 pr-1 border-r',
                  isAdd
                    ? 'text-[#3fb950] border-[#3fb950]/20'
                    : isDel
                      ? 'text-[#ff7b72] border-[#ff7b72]/20'
                      : 'text-[#30363d] border-[#21262d]',
                )}>
                  {isAdd ? '+' : isDel ? '−' : ' '}
                </td>
                <td className={cn(
                  'px-3 py-0 whitespace-pre break-all',
                  isAdd ? 'text-[#aff5b4]' : isDel ? 'text-[#ffa198]' : 'text-[#8b949e]',
                )}>
                  {line.slice(1)}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
