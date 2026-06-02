'use client';

import { useState, useEffect, useRef } from 'react';
import { Trash2, Plus, MessageSquarePlus, ChevronDown, Pencil, Check, X } from 'lucide-react';
import { useFeedbackStore } from '@/store/feedback-store';
import { FEEDBACK_CATEGORIES, type FeedbackCategory } from '@/types/feedback';
import { useSessionStore } from '@/store/session-store';
import { getAgentDisplay } from '@/lib/agent-display';
import { cn } from '@/lib/utils';

interface FeedbackTabProps {
  sessionId: string;
  agentId: string;
}

export function FeedbackTab({ sessionId, agentId }: FeedbackTabProps) {
  const agent = useSessionStore(s => s.agentMap.get(agentId));
  const { items, isLoading, loadFeedback, addFeedback, updateFeedback, deleteFeedback } = useFeedbackStore();

  const [text, setText] = useState('');
  const [category, setCategory] = useState<FeedbackCategory>('missing_context');
  const [isSaving, setIsSaving] = useState(false);
  const [showCategoryMenu, setShowCategoryMenu] = useState(false);

  const [editingId, setEditingId] = useState<string | null>(null);
  const [editText, setEditText] = useState('');
  const [editCategory, setEditCategory] = useState<FeedbackCategory>('other');
  const [showEditCatMenu, setShowEditCatMenu] = useState(false);
  const editTextareaRef = useRef<HTMLTextAreaElement>(null);

  const agentItems = items.filter(i => i.agentId === agentId);
  const { name } = agent ? getAgentDisplay(agent) : { name: agentId.slice(0, 8) };

  useEffect(() => {
    if (!isLoading && items.length === 0) loadFeedback(sessionId);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessionId]);

  useEffect(() => {
    if (editingId) editTextareaRef.current?.focus();
  }, [editingId]);

  const selectedCat = FEEDBACK_CATEGORIES.find(c => c.value === category)!;

  async function handleAdd() {
    if (!text.trim()) return;
    setIsSaving(true);
    await addFeedback({ sessionId, agentId, agentName: name, category, text: text.trim() });
    setText('');
    setIsSaving(false);
  }

  function startEdit(id: string, currentText: string, currentCategory: FeedbackCategory) {
    setEditingId(id);
    setEditText(currentText);
    setEditCategory(currentCategory);
    setShowEditCatMenu(false);
  }

  function cancelEdit() {
    setEditingId(null);
    setShowEditCatMenu(false);
  }

  async function saveEdit(id: string) {
    if (!editText.trim()) return;
    await updateFeedback(sessionId, id, { text: editText.trim(), category: editCategory });
    setEditingId(null);
  }

  return (
    <div className="flex flex-col h-full overflow-hidden">
      {/* Add feedback form */}
      <div className="shrink-0 p-3 border-b border-[#21262d] bg-[#0d1117] space-y-2">
        <div className="text-[11px] font-medium text-[#8b949e] uppercase tracking-wide">Add Feedback</div>

        <div className="relative">
          <button
            onClick={() => setShowCategoryMenu(v => !v)}
            className="w-full flex items-center justify-between gap-2 px-2.5 py-1.5 rounded bg-[#21262d] border border-[#30363d] hover:border-[#58a6ff]/50 transition-colors text-xs"
          >
            <div className="flex items-center gap-2">
              <span className="w-2 h-2 rounded-full shrink-0" style={{ backgroundColor: selectedCat.color }} />
              <span style={{ color: selectedCat.color }}>{selectedCat.label}</span>
            </div>
            <ChevronDown className="h-3 w-3 text-[#8b949e] shrink-0" />
          </button>
          {showCategoryMenu && (
            <div className="absolute top-full left-0 right-0 z-20 mt-1 bg-[#161b22] border border-[#30363d] rounded-md shadow-xl overflow-hidden">
              {FEEDBACK_CATEGORIES.map(cat => (
                <button
                  key={cat.value}
                  onClick={() => { setCategory(cat.value); setShowCategoryMenu(false); }}
                  className={cn('w-full flex items-center gap-2 px-2.5 py-1.5 text-xs hover:bg-[#21262d] transition-colors text-left', category === cat.value && 'bg-[#21262d]')}
                >
                  <span className="w-2 h-2 rounded-full shrink-0" style={{ backgroundColor: cat.color }} />
                  <span style={{ color: cat.color }}>{cat.label}</span>
                </button>
              ))}
            </div>
          )}
        </div>

        <textarea
          value={text}
          onChange={e => setText(e.target.value)}
          placeholder="Describe the issue or improvement…"
          rows={3}
          className="w-full px-2.5 py-1.5 rounded bg-[#21262d] border border-[#30363d] text-xs text-[#e6edf3] placeholder-[#484f58] focus:outline-none focus:border-[#58a6ff]/50 resize-none"
          onKeyDown={e => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) handleAdd(); }}
        />

        <button
          onClick={handleAdd}
          disabled={!text.trim() || isSaving}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded bg-[#238636] hover:bg-[#2ea043] disabled:opacity-40 disabled:cursor-not-allowed text-white text-xs font-medium transition-colors"
        >
          <Plus className="h-3.5 w-3.5" />
          {isSaving ? 'Saving…' : 'Add Feedback'}
          <span className="text-[10px] opacity-60 ml-1">(⌘↵)</span>
        </button>
      </div>

      {/* Feedback list */}
      <div className="flex-1 overflow-y-auto">
        {agentItems.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full gap-3 text-[#484f58] py-12">
            <MessageSquarePlus className="h-8 w-8 opacity-40" />
            <div className="text-center">
              <p className="text-xs font-medium text-[#8b949e]">No feedback yet</p>
              <p className="text-[11px] mt-0.5">Add notes while reviewing this agent</p>
            </div>
          </div>
        ) : (
          <div className="p-3 space-y-2">
            <div className="text-[11px] text-[#8b949e] mb-1">{agentItems.length} item{agentItems.length !== 1 ? 's' : ''}</div>
            {agentItems.map(item => {
              const cat = FEEDBACK_CATEGORIES.find(c => c.value === item.category);
              const isEditing = editingId === item.id;

              if (isEditing) {
                const editCat = FEEDBACK_CATEGORIES.find(c => c.value === editCategory)!;
                return (
                  <div key={item.id} className="p-2.5 rounded bg-[#161b22] border border-[#58a6ff]/40 space-y-2">
                    {/* Edit category */}
                    <div className="relative">
                      <button
                        onClick={() => setShowEditCatMenu(v => !v)}
                        className="w-full flex items-center justify-between gap-2 px-2 py-1 rounded bg-[#21262d] border border-[#30363d] text-xs"
                      >
                        <div className="flex items-center gap-1.5">
                          <span className="w-2 h-2 rounded-full" style={{ backgroundColor: editCat.color }} />
                          <span style={{ color: editCat.color }}>{editCat.label}</span>
                        </div>
                        <ChevronDown className="h-3 w-3 text-[#8b949e]" />
                      </button>
                      {showEditCatMenu && (
                        <div className="absolute top-full left-0 right-0 z-20 mt-1 bg-[#161b22] border border-[#30363d] rounded shadow-xl overflow-hidden">
                          {FEEDBACK_CATEGORIES.map(c => (
                            <button
                              key={c.value}
                              onClick={() => { setEditCategory(c.value); setShowEditCatMenu(false); }}
                              className={cn('w-full flex items-center gap-2 px-2.5 py-1.5 text-xs hover:bg-[#21262d] text-left', editCategory === c.value && 'bg-[#21262d]')}
                            >
                              <span className="w-2 h-2 rounded-full" style={{ backgroundColor: c.color }} />
                              <span style={{ color: c.color }}>{c.label}</span>
                            </button>
                          ))}
                        </div>
                      )}
                    </div>
                    {/* Edit text */}
                    <textarea
                      ref={editTextareaRef}
                      value={editText}
                      onChange={e => setEditText(e.target.value)}
                      rows={3}
                      className="w-full px-2 py-1.5 rounded bg-[#21262d] border border-[#30363d] text-xs text-[#e6edf3] focus:outline-none focus:border-[#58a6ff]/50 resize-none"
                      onKeyDown={e => {
                        if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) saveEdit(item.id);
                        if (e.key === 'Escape') cancelEdit();
                      }}
                    />
                    <div className="flex gap-1.5">
                      <button
                        onClick={() => saveEdit(item.id)}
                        disabled={!editText.trim()}
                        className="flex items-center gap-1 px-2.5 py-1 rounded bg-[#238636] hover:bg-[#2ea043] disabled:opacity-40 text-white text-xs font-medium transition-colors"
                      >
                        <Check className="h-3 w-3" /> Save
                      </button>
                      <button
                        onClick={cancelEdit}
                        className="flex items-center gap-1 px-2.5 py-1 rounded border border-[#30363d] text-[#8b949e] hover:text-[#e6edf3] text-xs transition-colors"
                      >
                        <X className="h-3 w-3" /> Cancel
                      </button>
                    </div>
                  </div>
                );
              }

              return (
                <div key={item.id} className="group flex items-start gap-2 p-2.5 rounded bg-[#161b22] border border-[#21262d] hover:border-[#30363d] transition-colors">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-1.5 mb-1">
                      <span
                        className="text-[10px] px-1.5 py-0.5 rounded font-medium"
                        style={{ color: cat?.color ?? '#8b949e', backgroundColor: `${cat?.color ?? '#8b949e'}18`, border: `1px solid ${cat?.color ?? '#8b949e'}40` }}
                      >
                        {cat?.label ?? item.category}
                      </span>
                    </div>
                    <p className="text-xs text-[#c9d1d9] leading-relaxed">{item.text}</p>
                    <p className="text-[10px] text-[#484f58] mt-1">
                      {new Date(item.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                    </p>
                  </div>
                  <div className="flex flex-col gap-0.5 shrink-0 opacity-0 group-hover:opacity-100 transition-all">
                    <button
                      onClick={() => startEdit(item.id, item.text, item.category as FeedbackCategory)}
                      className="p-1 rounded text-[#484f58] hover:text-[#58a6ff] hover:bg-[#58a6ff]/10 transition-colors"
                      title="Edit"
                    >
                      <Pencil className="h-3 w-3" />
                    </button>
                    <button
                      onClick={() => deleteFeedback(sessionId, item.id)}
                      className="p-1 rounded text-[#484f58] hover:text-[#ff7b72] hover:bg-[#ff7b72]/10 transition-colors"
                      title="Delete"
                    >
                      <Trash2 className="h-3 w-3" />
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
