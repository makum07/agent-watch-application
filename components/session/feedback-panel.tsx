'use client';

import { useEffect, useRef, useState } from 'react';
import {
  X, Trash2, Zap, Loader2, ChevronDown, ChevronRight,
  MessageSquare, AlertCircle, Pencil, Check, FileText, RotateCcw,
} from 'lucide-react';
import { useFeedbackStore } from '@/store/feedback-store';
import { useSessionStore } from '@/store/session-store';
import { FEEDBACK_CATEGORIES, type FeedbackCategory } from '@/types/feedback';
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
    loadFeedback, loadCycles, deleteFeedback, updateFeedback,
    previewPrompt, applyImprovements, rewindCycle, deleteCycle, clearRewoundCycles,
    clearError,
  } = useFeedbackStore();
  const agentMap = useSessionStore(s => s.agentMap);

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
                isLatest={cycle.id === latestActiveCycleId}
                isExpanded={expandedCycleId === cycle.id}
                onToggle={() => setExpandedCycleId(expandedCycleId === cycle.id ? null : cycle.id)}
                onRewind={() => handleRewind(cycle)}
                onDelete={() => deleteCycle(sessionId, cycle.id)}
              />
            ))}

            {cycles.length === 0 && (
              <div className="text-center py-12 text-[#484f58] text-xs">No improvement cycles yet</div>
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

      {/* Apply / prompt-editor footer */}
      <div className="shrink-0 border-t border-[#21262d] bg-[#0d1117]">
        {applyStep === 'editing-prompt' ? (
          <div className="p-3 space-y-2">
            <div className="flex items-center gap-1.5 text-[11px] font-medium text-[#c9d1d9]">
              {rewindFromCycle !== null
                ? <><RotateCcw className="h-3.5 w-3.5 text-[#f0883e]" /> Rewinding Cycle #{rewindFromCycle} — edit &amp; retry</>
                : <><FileText className="h-3.5 w-3.5 text-[#58a6ff]" /> Review &amp; Edit Prompt</>}
            </div>
            <textarea
              value={promptDraft}
              onChange={e => setPromptDraft(e.target.value)}
              rows={10}
              className="w-full px-2.5 py-2 rounded bg-[#161b22] border border-[#30363d] text-[11px] text-[#c9d1d9] font-mono leading-relaxed focus:outline-none focus:border-[#58a6ff]/50 resize-none"
            />
            <div className="flex gap-2">
              <button
                onClick={handleApply}
                disabled={!promptDraft.trim() || isApplying}
                className="flex-1 flex items-center justify-center gap-1.5 px-3 py-1.5 rounded bg-[#1f6feb] hover:bg-[#388bfd] disabled:opacity-40 text-white text-xs font-medium transition-colors"
              >
                <Zap className="h-3 w-3" /> Apply
              </button>
              <button
                onClick={() => { setApplyStep('idle'); setRewindFromCycle(null); }}
                className="px-3 py-1.5 rounded border border-[#30363d] text-[#8b949e] hover:text-[#e6edf3] text-xs transition-colors"
              >
                Cancel
              </button>
            </div>
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
  isLatest: boolean;
  isExpanded: boolean;
  onToggle: () => void;
  onRewind: () => void;
  onDelete: () => void;
}

function CycleCard({ cycle, isLatest, isExpanded, onToggle, onRewind, onDelete }: CycleCardProps) {
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

          {/* Response */}
          <div className="border-t border-[#21262d] px-2.5 py-2.5">
            {cycle.status === 'applying' ? (
              <div className="flex items-center gap-2 text-[11px] text-[#58a6ff]">
                <Loader2 className="h-3 w-3 animate-spin" /> Running improvement cycle…
              </div>
            ) : cycle.claudeResponse ? (
              <div className="max-h-[420px] overflow-y-auto pr-0.5">
                <MarkdownRenderer content={cycle.claudeResponse} size="sm" />
              </div>
            ) : (
              <p className="text-[11px] text-[#484f58]">No response captured</p>
            )}
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
