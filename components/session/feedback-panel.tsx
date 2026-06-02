'use client';

import { useEffect, useRef, useState } from 'react';
import { X, Trash2, Zap, Loader2, ChevronDown, ChevronRight, MessageSquare, AlertCircle, Pencil, Check, FileText } from 'lucide-react';
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

export function FeedbackPanel({ sessionId, onClose }: FeedbackPanelProps) {
  const { items, cycles, isLoading, isApplying, lastError, lastCycle, loadFeedback, loadCycles, deleteFeedback, updateFeedback, previewPrompt, applyImprovements, clearError } = useFeedbackStore();
  const agentMap = useSessionStore(s => s.agentMap);

  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const [activeTab, setActiveTab] = useState<'feedback' | 'history'>('feedback');
  const [expandedCycleId, setExpandedCycleId] = useState<string | null>(lastCycle?.id ?? null);

  // Apply flow: idle → loading-preview → editing-prompt → applying
  const [applyStep, setApplyStep] = useState<'idle' | 'loading-preview' | 'editing-prompt' | 'applying'>('idle');
  const [promptDraft, setPromptDraft] = useState('');

  // Inline edit for panel items
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editText, setEditText] = useState('');
  const [editCategory, setEditCategory] = useState<FeedbackCategory>('other');
  const [showEditCatMenu, setShowEditCatMenu] = useState(false);
  const editTextareaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => { loadFeedback(sessionId); loadCycles(sessionId); }, [sessionId]);

  useEffect(() => { if (lastCycle) setExpandedCycleId(lastCycle.id); }, [lastCycle?.id]);

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

  const expandedCycle = expandedCycleId ? (cycles.find(c => c.id === expandedCycleId) ?? null) : null;

  // Group items by agent
  const byAgent = new Map<string, typeof items>();
  for (const item of items) {
    if (!byAgent.has(item.agentId)) byAgent.set(item.agentId, []);
    byAgent.get(item.agentId)!.push(item);
  }
  const catCounts = new Map<string, number>();
  for (const item of items) catCounts.set(item.category, (catCounts.get(item.category) ?? 0) + 1);
  const topCats = Array.from(catCounts.entries()).sort((a, b) => b[1] - a[1]).slice(0, 5);

  async function handlePreview() {
    setApplyStep('loading-preview');
    const p = await previewPrompt(sessionId);
    if (p) { setPromptDraft(p); setApplyStep('editing-prompt'); }
    else setApplyStep('idle');
  }

  async function handleApply() {
    setApplyStep('applying');
    const cycle = await applyImprovements(sessionId, promptDraft);
    if (cycle) { setExpandedCycleId(cycle.id); setActiveTab('history'); }
    setApplyStep('idle');
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
          <span className="text-[10px] bg-[#58a6ff]/15 text-[#58a6ff] border border-[#58a6ff]/30 px-1.5 py-0.5 rounded-full font-medium">{items.length}</span>
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
            className={cn('flex-1 py-2 text-xs font-medium transition-colors border-b-2', activeTab === tab ? 'text-[#58a6ff] border-[#58a6ff]' : 'text-[#8b949e] border-transparent hover:text-[#e6edf3]')}
          >
            {tab === 'feedback' ? 'Feedback' : `History${cycles.length > 0 ? ` (${cycles.length})` : ''}`}
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
            <div className="flex items-center justify-center h-32 text-[#8b949e]"><Loader2 className="h-4 w-4 animate-spin" /></div>
          ) : items.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-full gap-3 text-[#484f58] py-16">
              <MessageSquare className="h-8 w-8 opacity-30" />
              <div className="text-center px-4">
                <p className="text-xs font-medium text-[#8b949e]">No feedback collected yet</p>
                <p className="text-[11px] mt-1 leading-relaxed">Open the <strong className="text-[#c9d1d9]">Feedback</strong> tab in any agent pane to add notes while reviewing</p>
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
                          <div className="absolute inset-y-0 left-0 rounded" style={{ width: `${pct}%`, backgroundColor: `${meta?.color ?? '#8b949e'}25` }} />
                          <span className="absolute inset-0 flex items-center px-2 text-[10px]" style={{ color: meta?.color ?? '#8b949e' }}>{meta?.label ?? cat}</span>
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
                        {isOpen ? <ChevronDown className="h-3 w-3 text-[#8b949e] shrink-0" /> : <ChevronRight className="h-3 w-3 text-[#8b949e] shrink-0" />}
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
                                  {/* Edit category dropdown */}
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
                                          <button key={c.value} onClick={() => { setEditCategory(c.value); setShowEditCatMenu(false); }}
                                            className={cn('w-full flex items-center gap-1.5 px-2 py-1 text-[10px] hover:bg-[#21262d] text-left', editCategory === c.value && 'bg-[#21262d]')}>
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
                                    onKeyDown={e => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) saveEdit(item.id); if (e.key === 'Escape') cancelEdit(); }}
                                  />
                                  <div className="flex gap-1">
                                    <button onClick={() => saveEdit(item.id)} disabled={!editText.trim()}
                                      className="flex items-center gap-1 px-2 py-0.5 rounded bg-[#238636] hover:bg-[#2ea043] disabled:opacity-40 text-white text-[10px] transition-colors">
                                      <Check className="h-2.5 w-2.5" /> Save
                                    </button>
                                    <button onClick={cancelEdit}
                                      className="flex items-center gap-1 px-2 py-0.5 rounded border border-[#30363d] text-[#8b949e] hover:text-[#e6edf3] text-[10px] transition-colors">
                                      <X className="h-2.5 w-2.5" /> Cancel
                                    </button>
                                  </div>
                                </div>
                              );
                            }

                            return (
                              <div key={item.id} className="group flex items-start gap-2 px-3 py-2">
                                <div className="flex-1 min-w-0">
                                  <span className="inline-block text-[9px] px-1 py-0.5 rounded font-medium mb-1"
                                    style={{ color: cat?.color ?? '#8b949e', backgroundColor: `${cat?.color ?? '#8b949e'}18` }}>
                                    {cat?.label ?? item.category}
                                  </span>
                                  <p className="text-[11px] text-[#c9d1d9] leading-relaxed">{item.text}</p>
                                </div>
                                <div className="flex gap-0.5 shrink-0 opacity-0 group-hover:opacity-100 transition-all mt-0.5">
                                  <button onClick={() => startEdit(item.id, item.text, item.category as FeedbackCategory)}
                                    className="p-1 rounded text-[#484f58] hover:text-[#58a6ff] transition-colors" title="Edit">
                                    <Pencil className="h-2.5 w-2.5" />
                                  </button>
                                  <button onClick={() => deleteFeedback(sessionId, item.id)}
                                    className="p-1 rounded text-[#484f58] hover:text-[#ff7b72] transition-colors" title="Delete">
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
          <div className="p-3 space-y-3">
            {expandedCycle && <ImprovementResultCard cycle={expandedCycle} />}
            {cycles.filter(c => c.id !== expandedCycleId).map(cycle => (
              <button key={cycle.id} onClick={() => setExpandedCycleId(cycle.id)}
                className="w-full text-left p-2.5 bg-[#161b22] border border-[#21262d] rounded hover:border-[#30363d] transition-colors">
                <div className="flex items-center gap-2">
                  <span className="text-xs font-medium text-[#e6edf3]">Cycle #{cycle.cycleNumber}</span>
                  <StatusBadge status={cycle.status} />
                  <span className="text-[10px] text-[#8b949e] ml-auto">
                    {new Date(cycle.createdAt).toLocaleDateString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}
                  </span>
                </div>
              </button>
            ))}
            {cycles.length === 0 && <div className="text-center py-12 text-[#484f58] text-xs">No improvement cycles yet</div>}
          </div>
        )}
      </div>

      {/* Apply improvements footer */}
      <div className="shrink-0 border-t border-[#21262d] bg-[#0d1117]">
        {applyStep === 'editing-prompt' ? (
          <div className="p-3 space-y-2">
            <div className="flex items-center gap-1.5 text-[11px] font-medium text-[#c9d1d9]">
              <FileText className="h-3.5 w-3.5 text-[#58a6ff]" />
              Review & Edit Prompt
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
                <Zap className="h-3 w-3" />
                Apply
              </button>
              <button
                onClick={() => setApplyStep('idle')}
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

function StatusBadge({ status }: { status: string }) {
  const map: Record<string, { label: string; color: string }> = {
    applying:  { label: 'Applying…', color: '#58a6ff' },
    completed: { label: 'Completed', color: '#3fb950' },
    failed:    { label: 'Failed',    color: '#ff7b72' },
  };
  const s = map[status] ?? { label: status, color: '#8b949e' };
  return (
    <span className="text-[10px] px-1.5 py-0.5 rounded font-medium" style={{ color: s.color, backgroundColor: `${s.color}18` }}>
      {s.label}
    </span>
  );
}

function ImprovementResultCard({ cycle }: { cycle: ImprovementCycle }) {
  const [showPrompt, setShowPrompt] = useState(false);

  return (
    <div className="bg-[#161b22] border border-[#21262d] rounded overflow-hidden">
      <div className="flex items-center gap-2 px-3 py-2.5 border-b border-[#21262d]">
        <Zap className="h-3.5 w-3.5 text-[#58a6ff]" />
        <span className="text-xs font-semibold text-[#e6edf3] flex-1">Cycle #{cycle.cycleNumber}</span>
        <StatusBadge status={cycle.status} />
      </div>

      {/* Prompt — collapsible */}
      <div className="border-b border-[#21262d]">
        <button
          onClick={() => setShowPrompt(v => !v)}
          className="w-full flex items-center gap-2 px-3 py-2 text-[11px] text-[#8b949e] hover:bg-[#21262d] transition-colors text-left"
        >
          {showPrompt ? <ChevronDown className="h-3 w-3 shrink-0" /> : <ChevronRight className="h-3 w-3 shrink-0" />}
          Generated Prompt
          <span className="text-[10px] text-[#484f58] ml-auto">{cycle.generatedPrompt.length} chars</span>
        </button>
        {showPrompt && (
          <div className="px-3 pb-3">
            <pre className="text-[10px] text-[#8b949e] whitespace-pre-wrap leading-relaxed max-h-48 overflow-y-auto font-mono bg-[#0d1117] p-2.5 rounded border border-[#21262d]">
              {cycle.generatedPrompt}
            </pre>
          </div>
        )}
      </div>

      {/* Response — markdown rendered */}
      <div className="px-3 py-2.5">
        <div className="text-[11px] font-medium text-[#8b949e] mb-2">Claude Response</div>
        {cycle.status === 'applying' ? (
          <div className="flex items-center gap-2 text-[11px] text-[#58a6ff]">
            <Loader2 className="h-3 w-3 animate-spin" />
            Running improvement cycle…
          </div>
        ) : cycle.claudeResponse ? (
          <div className="max-h-[480px] overflow-y-auto pr-1">
            <MarkdownRenderer content={cycle.claudeResponse} size="sm" />
          </div>
        ) : (
          <p className="text-[11px] text-[#484f58]">No response captured</p>
        )}
      </div>

      {cycle.completedAt && (
        <div className="px-3 pb-2.5 text-[10px] text-[#484f58]">
          Completed {new Date(cycle.completedAt).toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}
        </div>
      )}
    </div>
  );
}
