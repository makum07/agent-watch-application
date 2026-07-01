'use client';

import { useState, useEffect, useRef } from 'react';
import {
  ChevronDown, ChevronRight, Play, Check, X, AlertTriangle, Clock,
  Loader2, Trash2, FileText, Brain, Terminal, Wrench, Eye, MessageSquare,
} from 'lucide-react';
import { useSkillStore } from '@/store/skill-store';
import { MarkdownRenderer } from '@/components/shared/markdown-renderer';
import { cn } from '@/lib/utils';
import type { SkillAnalysisCycle, AnalysisRecommendation } from '@/types/skills';
import type { StreamEntry } from '@/types/feedback';

interface AnalysisHistoryProps {
  skillId: string;
  cycles: SkillAnalysisCycle[];
}

const STATUS_CONFIG: Record<string, { color: string; icon: React.ReactNode; label: string }> = {
  pending: { color: 'var(--aw-text-2)', icon: <Clock className="h-3 w-3" />, label: 'Pending' },
  analyzing: { color: 'var(--aw-purple-light)', icon: <Loader2 className="h-3 w-3 animate-spin" />, label: 'Analyzing' },
  awaiting_review: { color: 'var(--aw-orange-bright)', icon: <AlertTriangle className="h-3 w-3" />, label: 'Awaiting Review' },
  applying: { color: 'var(--aw-blue)', icon: <Loader2 className="h-3 w-3 animate-spin" />, label: 'Applying' },
  completed: { color: 'var(--aw-green)', icon: <Check className="h-3 w-3" />, label: 'Completed' },
  failed: { color: 'var(--aw-red-bright)', icon: <X className="h-3 w-3" />, label: 'Failed' },
};

const SEVERITY_COLORS: Record<string, string> = {
  critical: 'border-l-[var(--aw-red-bright)] bg-[var(--aw-red-bright)]/5',
  high: 'border-l-[var(--aw-orange-bright)] bg-[var(--aw-orange-bright)]/5',
  medium: 'border-l-[var(--aw-purple-light)] bg-[var(--aw-purple-light)]/5',
  low: 'border-l-[var(--aw-text-2)] bg-[var(--aw-text-2)]/5',
};


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

export function AnalysisHistory({ skillId, cycles }: AnalysisHistoryProps) {
  const { triggerAnalysis, approveFixPrompt, deleteAnalysisCycle, previewPrompt, isAnalyzing, streamEntries } = useSkillStore();
  const [expandedCycles, setExpandedCycles] = useState<Set<string>>(new Set());
  const [editingFixPrompt, setEditingFixPrompt] = useState<string | null>(null);
  const [fixPromptText, setFixPromptText] = useState('');

  // Prompt preview/edit flow
  const [promptStep, setPromptStep] = useState<'idle' | 'loading' | 'editing'>('idle');
  const [promptDraft, setPromptDraft] = useState('');
  const [promptViewMode, setPromptViewMode] = useState<'preview' | 'edit'>('preview');

  // Auto-expand latest analyzing/active cycle
  useEffect(() => {
    const activeCycle = cycles.find(c => c.status === 'analyzing' || c.status === 'applying');
    if (activeCycle) {
      setExpandedCycles(prev => {
        const next = new Set(prev);
        next.add(activeCycle.id);
        return next;
      });
    }
  }, [cycles]);

  const toggleExpand = (cycleId: string) => {
    const next = new Set(expandedCycles);
    if (next.has(cycleId)) next.delete(cycleId);
    else next.add(cycleId);
    setExpandedCycles(next);
  };

  const handlePreview = async () => {
    setPromptStep('loading');
    const p = await previewPrompt(skillId);
    if (p) { setPromptDraft(p); setPromptViewMode('preview'); setPromptStep('editing'); }
    else setPromptStep('idle');
  };

  const handleTrigger = async () => {
    const customPrompt = promptStep === 'editing' ? promptDraft : undefined;
    setPromptStep('idle');
    const cycle = await triggerAnalysis(skillId, customPrompt);
    if (cycle) {
      setExpandedCycles(prev => {
        const next = new Set(prev);
        next.add(cycle.id);
        return next;
      });
    }
  };

  const handleApprove = async (cycleId: string) => {
    const prompt = editingFixPrompt === cycleId ? fixPromptText : undefined;
    await approveFixPrompt(skillId, cycleId, prompt);
    setEditingFixPrompt(null);
  };

  const handleDelete = async (cycleId: string) => {
    await deleteAnalysisCycle(skillId, cycleId);
  };

  // Prompt editor view
  if (promptStep === 'editing') {
    return (
      <div className="space-y-3">
        {/* Editor header */}
        <div className="flex items-center gap-2 px-3 py-2.5 rounded-t-lg bg-[var(--aw-bg-1)] border border-[var(--aw-bg-3)]">
          <FileText className="h-3.5 w-3.5 text-[var(--aw-purple-light)] shrink-0" />
          <span className="text-xs font-semibold text-[var(--aw-text-0)] flex-1">Review & Edit Analysis Prompt</span>
          {/* Preview / Edit toggle */}
          <div className="flex items-center shrink-0 rounded border border-[var(--aw-bg-3)] overflow-hidden text-[10px]">
            <button
              onClick={() => setPromptViewMode('preview')}
              className={cn(
                'px-2 py-0.5 transition-colors',
                promptViewMode === 'preview'
                  ? 'bg-[var(--aw-blue)] text-white'
                  : 'text-[var(--aw-text-2)] hover:text-[var(--aw-text-0)]',
              )}
            >
              Preview
            </button>
            <button
              onClick={() => setPromptViewMode('edit')}
              className={cn(
                'px-2 py-0.5 transition-colors border-l border-[var(--aw-bg-3)]',
                promptViewMode === 'edit'
                  ? 'bg-[var(--aw-blue)] text-white'
                  : 'text-[var(--aw-text-2)] hover:text-[var(--aw-text-0)]',
              )}
            >
              Edit
            </button>
          </div>
          <span className="shrink-0 text-[10px] text-[var(--aw-text-4)] font-mono tabular-nums">
            {promptDraft.length.toLocaleString()} chars
          </span>
        </div>

        {/* Content */}
        {promptViewMode === 'preview' ? (
          <div className="px-4 py-3 bg-[var(--aw-bg-0)] border border-[var(--aw-bg-3)] rounded overflow-y-auto max-h-[500px]">
            <MarkdownRenderer content={promptDraft} size="sm" />
          </div>
        ) : (
          <textarea
            value={promptDraft}
            onChange={e => setPromptDraft(e.target.value)}
            className="w-full h-[500px] px-3 py-2.5 bg-[var(--aw-bg-0)] border border-[var(--aw-bg-3)] rounded text-[11px] text-[var(--aw-text-1)] font-mono leading-relaxed focus:outline-none focus:border-[var(--aw-purple-light)]/50 resize-y"
            onKeyDown={e => {
              if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) handleTrigger();
              if (e.key === 'Escape') setPromptStep('idle');
            }}
          />
        )}

        {/* Actions */}
        <div className="flex items-center gap-2">
          <button
            onClick={handleTrigger}
            disabled={!promptDraft.trim() || isAnalyzing}
            className="flex items-center gap-1.5 px-4 py-2 rounded bg-[var(--aw-green-3)] hover:bg-[var(--aw-green-2)] disabled:opacity-40 text-white text-xs font-semibold transition-colors"
          >
            {isAnalyzing ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Play className="h-3.5 w-3.5" />}
            {isAnalyzing ? 'Analyzing...' : 'Run Analysis'}
          </button>
          <button
            onClick={() => setPromptStep('idle')}
            className="px-4 py-2 rounded border border-[var(--aw-bg-3)] text-[var(--aw-text-2)] hover:text-[var(--aw-text-0)] text-xs transition-colors"
          >
            Cancel
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <span className="text-xs text-[var(--aw-text-2)]">
          {cycles.length} analysis cycle{cycles.length !== 1 ? 's' : ''}
        </span>
        <div className="flex items-center gap-2">
          <button
            onClick={handlePreview}
            disabled={isAnalyzing || promptStep === 'loading'}
            className="flex items-center gap-1.5 text-xs px-3 py-1.5 rounded border border-[var(--aw-bg-3)] bg-[var(--aw-bg-2)] hover:bg-[var(--aw-bg-3)] text-[var(--aw-text-1)] transition-colors font-medium disabled:opacity-50"
          >
            {promptStep === 'loading' ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <FileText className="h-3.5 w-3.5" />
            )}
            {promptStep === 'loading' ? 'Loading...' : 'Preview Prompt'}
          </button>
          <button
            onClick={() => triggerAnalysis(skillId)}
            disabled={isAnalyzing}
            className="flex items-center gap-1.5 text-xs px-3 py-1.5 rounded bg-[var(--aw-green-3)] hover:bg-[var(--aw-green-2)] text-white transition-colors font-medium disabled:opacity-50"
          >
            {isAnalyzing ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <Play className="h-3.5 w-3.5" />
            )}
            {isAnalyzing ? 'Analyzing...' : 'Quick Analysis'}
          </button>
        </div>
      </div>

      {/* Live stream viewer during analysis */}
      {isAnalyzing && streamEntries.length > 0 && (
        <div className="border border-[var(--aw-purple-light)]/30 rounded-lg bg-[var(--aw-bg-0)] overflow-hidden">
          <div className="flex items-center gap-2 px-3 py-2 bg-[var(--aw-purple-light)]/5 border-b border-[var(--aw-purple-light)]/20">
            <Loader2 className="h-3.5 w-3.5 animate-spin text-[var(--aw-purple-light)]" />
            <span className="text-xs font-medium text-[var(--aw-purple-light)]">Live Analysis Stream</span>
            <span className="text-[10px] text-[var(--aw-text-4)] ml-auto">{streamEntries.length} events</span>
          </div>
          <div className="p-3">
            <StreamLog entries={streamEntries} isLive />
          </div>
        </div>
      )}

      {isAnalyzing && streamEntries.length === 0 && (
        <div className="border border-[var(--aw-purple-light)]/30 rounded-lg bg-[var(--aw-bg-0)] p-4 flex items-center gap-2 text-xs text-[var(--aw-purple-light)]">
          <Loader2 className="h-3.5 w-3.5 animate-spin" />
          Starting analysis...
        </div>
      )}

      {/* Cycle list */}
      {cycles.map(cycle => (
        <AnalysisCycleCard
          key={cycle.id}
          cycle={cycle}
          isExpanded={expandedCycles.has(cycle.id)}
          onToggle={() => toggleExpand(cycle.id)}
          onDelete={() => handleDelete(cycle.id)}
          onApprove={() => handleApprove(cycle.id)}
          editingFixPrompt={editingFixPrompt}
          fixPromptText={fixPromptText}
          onStartEditFixPrompt={(text) => { setFixPromptText(text); setEditingFixPrompt(cycle.id); }}
          onCancelEditFixPrompt={() => setEditingFixPrompt(null)}
          onFixPromptChange={setFixPromptText}
          liveStreamEntries={streamEntries}
          isAnalyzing={isAnalyzing}
        />
      ))}

      {cycles.length === 0 && !isAnalyzing && (
        <div className="text-center py-12 text-[var(--aw-text-4)]">
          <Brain className="h-8 w-8 mx-auto mb-3 opacity-30" />
          <p className="text-xs font-medium text-[var(--aw-text-2)]">No analysis cycles yet</p>
          <p className="text-[11px] mt-1 text-[var(--aw-text-4)]">
            Click "Preview Prompt" to review the generated analysis prompt, or "Quick Analysis" to start immediately.
          </p>
        </div>
      )}
    </div>
  );
}

// ── Analysis Cycle Card ─────────────────────────────────────────────────────────

interface AnalysisCycleCardProps {
  cycle: SkillAnalysisCycle;
  isExpanded: boolean;
  onToggle: () => void;
  onDelete: () => void;
  onApprove: () => void;
  editingFixPrompt: string | null;
  fixPromptText: string;
  onStartEditFixPrompt: (text: string) => void;
  onCancelEditFixPrompt: () => void;
  onFixPromptChange: (text: string) => void;
  liveStreamEntries: StreamEntry[];
  isAnalyzing: boolean;
}

function AnalysisCycleCard({
  cycle, isExpanded, onToggle, onDelete, onApprove,
  editingFixPrompt, fixPromptText, onStartEditFixPrompt, onCancelEditFixPrompt, onFixPromptChange,
  liveStreamEntries, isAnalyzing,
}: AnalysisCycleCardProps) {
  const [showPrompt, setShowPrompt] = useState(false);
  const [showStream, setShowStream] = useState(false);
  const [showResponse, setShowResponse] = useState(false);
  const isStaleAnalyzing = (cycle.status === 'analyzing' || cycle.status === 'applying') && !isAnalyzing;
  const displayStatus = isStaleAnalyzing ? 'failed' : cycle.status;
  const status = STATUS_CONFIG[displayStatus] ?? STATUS_CONFIG.pending;

  const date = new Date(cycle.createdAt).toLocaleDateString([], {
    month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit',
  });

  const hasStream = (cycle.streamEntries && cycle.streamEntries.length > 0) ||
    (cycle.status === 'analyzing' && isAnalyzing);
  const streamEntries = cycle.status === 'analyzing' && isAnalyzing
    ? liveStreamEntries
    : cycle.streamEntries ?? [];

  return (
    <div
      className="rounded-lg border overflow-hidden transition-colors"
      style={{ borderColor: `${status.color}30`, borderLeftWidth: '3px', borderLeftColor: status.color }}
    >
      {/* Header */}
      <div
        className="flex items-center gap-2 px-3 py-2.5 cursor-pointer hover:bg-[var(--aw-bg-1)] transition-colors"
        onClick={onToggle}
      >
        {isExpanded ? (
          <ChevronDown className="h-3.5 w-3.5 text-[var(--aw-text-2)] shrink-0" />
        ) : (
          <ChevronRight className="h-3.5 w-3.5 text-[var(--aw-text-2)] shrink-0" />
        )}
        <span className="text-xs font-bold text-[var(--aw-text-0)]">Cycle #{cycle.cycleNumber}</span>
        <span
          className="flex items-center gap-1 text-[10px] font-medium px-1.5 py-0.5 rounded"
          style={{ color: status.color, background: `${status.color}18` }}
        >
          {status.icon}
          {status.label}
        </span>
        <span className="text-[11px] text-[var(--aw-text-4)] ml-auto">
          {cycle.triggerType === 'auto_threshold' ? 'Auto' : 'Manual'}
          {' · '}
          {date}
        </span>
        <button
          onClick={e => { e.stopPropagation(); onDelete(); }}
          className="p-1 rounded hover:bg-[var(--aw-bg-2)] text-[var(--aw-text-4)] hover:text-[var(--aw-red-bright)]"
          title="Delete cycle"
        >
          <Trash2 className="h-3 w-3" />
        </button>
      </div>

      {/* Expanded content */}
      {isExpanded && (
        <div className="border-t border-[var(--aw-bg-2)]">
          {/* Stats */}
          <div className="grid grid-cols-2 gap-4 px-3 py-2 text-xs bg-[var(--aw-bg-0)]">
            <div>
              <span className="text-[var(--aw-text-2)]">Sessions analyzed:</span>{' '}
              <span className="text-[var(--aw-text-1)] font-medium">{cycle.sessionsAnalyzed.length}</span>
            </div>
            <div>
              <span className="text-[var(--aw-text-2)]">Feedback analyzed:</span>{' '}
              <span className="text-[var(--aw-text-1)] font-medium">{cycle.feedbackAnalyzed.length}</span>
            </div>
          </div>

          {/* Generated Prompt (collapsible) */}
          <div className="border-t border-[var(--aw-bg-2)]">
            <button
              onClick={e => { e.stopPropagation(); setShowPrompt(v => !v); }}
              className="w-full flex items-center gap-1.5 px-3 py-2 text-[11px] text-[var(--aw-text-2)] hover:bg-[var(--aw-bg-1)] transition-colors text-left"
            >
              {showPrompt
                ? <ChevronDown className="h-2.5 w-2.5 shrink-0" />
                : <ChevronRight className="h-2.5 w-2.5 shrink-0" />}
              <FileText className="h-3 w-3 shrink-0 text-[var(--aw-purple-light)]" />
              <span className="font-medium">Generated Prompt</span>
              <span className="text-[var(--aw-text-4)] ml-auto font-mono">{cycle.analysisPrompt.length.toLocaleString()} chars</span>
            </button>
            {showPrompt && (
              <div className="px-3 pb-3">
                <pre className="text-[10px] text-[var(--aw-text-2)] whitespace-pre-wrap max-h-[400px] overflow-y-auto font-mono bg-[var(--aw-bg-4)] p-3 rounded border border-[var(--aw-bg-2)] leading-relaxed">
                  {cycle.analysisPrompt}
                </pre>
              </div>
            )}
          </div>

          {/* Stream / Activity Log (collapsible) */}
          {(hasStream || streamEntries.length > 0) && (
            <div className="border-t border-[var(--aw-bg-2)]">
              <button
                onClick={e => { e.stopPropagation(); setShowStream(v => !v); }}
                className="w-full flex items-center gap-1.5 px-3 py-2 text-[11px] text-[var(--aw-text-2)] hover:bg-[var(--aw-bg-1)] transition-colors text-left"
              >
                {showStream
                  ? <ChevronDown className="h-2.5 w-2.5 shrink-0" />
                  : <ChevronRight className="h-2.5 w-2.5 shrink-0" />}
                <Terminal className="h-3 w-3 shrink-0 text-[var(--aw-blue)]" />
                <span className="font-medium">
                  {cycle.status === 'analyzing' && isAnalyzing ? 'Live Stream' : 'Activity Log'}
                </span>
                <span className="text-[var(--aw-text-4)] ml-1">({streamEntries.length} events)</span>
                {cycle.status === 'analyzing' && isAnalyzing && (
                  <Loader2 className="h-2.5 w-2.5 animate-spin text-[var(--aw-blue)] ml-auto" />
                )}
              </button>
              {showStream && (
                <div className="px-3 pb-3">
                  <StreamLog
                    entries={streamEntries}
                    isLive={cycle.status === 'analyzing' && isAnalyzing}
                  />
                </div>
              )}
            </div>
          )}

          {/* Analysis Response (collapsible) */}
          {cycle.analysisResponse && (
            <div className="border-t border-[var(--aw-bg-2)]">
              <button
                onClick={e => { e.stopPropagation(); setShowResponse(v => !v); }}
                className="w-full flex items-center gap-1.5 px-3 py-2 text-[11px] text-[var(--aw-text-2)] hover:bg-[var(--aw-bg-1)] transition-colors text-left"
              >
                {showResponse
                  ? <ChevronDown className="h-2.5 w-2.5 shrink-0" />
                  : <ChevronRight className="h-2.5 w-2.5 shrink-0" />}
                <MessageSquare className="h-3 w-3 shrink-0 text-[var(--aw-green)]" />
                <span className="font-medium">Analysis Report</span>
              </button>
              {showResponse && (
                <div className="px-3 pb-3">
                  <div className="max-h-[600px] overflow-y-auto bg-[var(--aw-bg-4)] rounded border border-[var(--aw-bg-2)] p-4">
                    <MarkdownRenderer content={cycle.analysisResponse} size="sm" />
                  </div>
                </div>
              )}
            </div>
          )}

          {/* Recommendations */}
          {cycle.recommendations && cycle.recommendations.length > 0 && (
            <div className="border-t border-[var(--aw-bg-2)] px-3 py-3">
              <div className="text-[11px] font-medium text-[var(--aw-text-2)] mb-2 uppercase tracking-wider">
                Recommendations ({cycle.recommendations.length})
              </div>
              <div className="space-y-2">
                {cycle.recommendations.map((rec, i) => (
                  <RecommendationCard key={i} rec={rec} />
                ))}
              </div>
            </div>
          )}

          {/* Fix Prompt */}
          {cycle.fixPrompt && (
            <div className="border-t border-[var(--aw-bg-2)] px-3 py-3">
              <div className="text-[11px] font-medium text-[var(--aw-text-2)] mb-2">Fix Prompt</div>
              {editingFixPrompt === cycle.id ? (
                <textarea
                  value={fixPromptText}
                  onChange={e => onFixPromptChange(e.target.value)}
                  className="w-full h-40 text-[11px] bg-[var(--aw-bg-4)] border border-[var(--aw-bg-3)] rounded p-2.5 text-[var(--aw-text-1)] font-mono resize-y focus:outline-none focus:border-[var(--aw-blue)]/50"
                />
              ) : (
                <pre className="bg-[var(--aw-bg-4)] rounded border border-[var(--aw-bg-2)] p-3 text-[10px] text-[var(--aw-text-1)] max-h-[200px] overflow-y-auto whitespace-pre-wrap font-mono leading-relaxed">
                  {cycle.fixPrompt}
                </pre>
              )}
            </div>
          )}

          {/* Actions for awaiting_review */}
          {cycle.status === 'awaiting_review' && cycle.fixPrompt && (
            <div className="border-t border-[var(--aw-bg-2)] px-3 py-2.5 flex items-center gap-2 bg-[var(--aw-orange-bright)]/5">
              {editingFixPrompt === cycle.id ? (
                <>
                  <button
                    onClick={onApprove}
                    className="flex items-center gap-1 text-xs px-3 py-1.5 rounded bg-[var(--aw-green-3)] hover:bg-[var(--aw-green-2)] text-white font-medium"
                  >
                    <Check className="h-3.5 w-3.5" />
                    Apply Edited Prompt
                  </button>
                  <button
                    onClick={onCancelEditFixPrompt}
                    className="text-xs px-3 py-1.5 rounded bg-[var(--aw-bg-2)] hover:bg-[var(--aw-bg-3)] text-[var(--aw-text-1)]"
                  >
                    Cancel
                  </button>
                </>
              ) : (
                <>
                  <button
                    onClick={onApprove}
                    className="flex items-center gap-1 text-xs px-3 py-1.5 rounded bg-[var(--aw-green-3)] hover:bg-[var(--aw-green-2)] text-white font-medium"
                  >
                    <Check className="h-3.5 w-3.5" />
                    Approve & Apply
                  </button>
                  <button
                    onClick={() => onStartEditFixPrompt(cycle.fixPrompt!)}
                    className="text-xs px-3 py-1.5 rounded bg-[var(--aw-bg-2)] hover:bg-[var(--aw-bg-3)] text-[var(--aw-text-1)]"
                  >
                    Edit Fix Prompt
                  </button>
                </>
              )}
            </div>
          )}

          {/* Completed timestamp */}
          {cycle.completedAt && (
            <div className="border-t border-[var(--aw-bg-2)] px-3 py-2 text-[10px] text-[var(--aw-text-4)]">
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

// ── Stream Log ──────────────────────────────────────────────────────────────────

function StreamLog({ entries, isLive = false }: { entries: StreamEntry[]; isLive?: boolean }) {
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (isLive) scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' });
  }, [entries.length, isLive]);

  if (entries.length === 0 && isLive) {
    return (
      <div className="flex items-center gap-2 text-[11px] text-[var(--aw-blue)]">
        <Loader2 className="h-3 w-3 animate-spin" /> Starting analysis...
      </div>
    );
  }

  if (entries.length === 0) return null;

  const resultMap = new Map<string, StreamEntry>();
  for (const e of entries) {
    if (e.kind === 'tool_result' && e.toolUseId) {
      resultMap.set(e.toolUseId, e);
    }
  }

  return (
    <div
      ref={scrollRef}
      className={cn('overflow-y-auto pr-0.5', isLive ? 'max-h-[500px]' : 'max-h-[600px]')}
    >
      {entries.map(entry => {
        if (entry.kind === 'system') {
          return (
            <div key={entry.id} className="flex items-center gap-1.5 py-0.5 text-[9px] text-[var(--aw-text-4)]">
              <Terminal className="h-2.5 w-2.5 shrink-0" />
              <span>{entry.text}</span>
            </div>
          );
        }

        if (entry.kind === 'thinking') {
          return <ThinkingEntry key={entry.id} entry={entry} />;
        }

        if (entry.kind === 'tool_use') {
          const result = entry.toolUseId ? resultMap.get(entry.toolUseId) : undefined;
          return <ToolCallEntry key={entry.id} entry={entry} result={result} />;
        }

        if (entry.kind === 'tool_result') {
          if (entry.toolUseId && resultMap.has(entry.toolUseId)) return null;
          const isError = entry.isError;
          const content = entry.content ?? '';
          return (
            <div key={entry.id} className="ml-4 py-0.5">
              <div className={cn(
                'text-[9px] font-mono rounded px-1.5 py-0.5 max-h-16 overflow-y-auto',
                isError ? 'text-[var(--aw-red-bright)]' : 'text-[var(--aw-text-4)]',
              )}>
                {content.length > 200 ? content.slice(0, 200) + '…' : content}
              </div>
            </div>
          );
        }

        if (entry.kind === 'text') {
          return <TextEntry key={entry.id} entry={entry} />;
        }

        return null;
      })}
      {isLive && (
        <div className="flex items-center gap-2 text-[10px] text-[var(--aw-blue)] pt-1">
          <Loader2 className="h-3 w-3 animate-spin" /> Processing...
        </div>
      )}
    </div>
  );
}

// ── Stream Entry Components ─────────────────────────────────────────────────────

function ThinkingEntry({ entry }: { entry: StreamEntry }) {
  const [expanded, setExpanded] = useState(false);
  const text = entry.text ?? '';
  const hasContent = text.length > 0 && text !== 'Thinking...';
  const preview = hasContent ? text.slice(0, 100) + (text.length > 100 ? '…' : '') : 'Thinking...';

  return (
    <div className="group">
      <button
        className="w-full flex items-center gap-1.5 px-1.5 py-1 hover:bg-[var(--aw-bg-2)]/30 rounded transition-colors text-left"
        onClick={() => hasContent && setExpanded(v => !v)}
      >
        <Brain className="h-2.5 w-2.5 text-[var(--aw-text-4)] shrink-0" />
        <span className="text-[9px] text-[var(--aw-text-4)]">thinking</span>
        <span className="text-[9px] text-[var(--aw-text-4)] italic truncate flex-1 opacity-70">{preview}</span>
        {hasContent && (
          <ChevronRight className={cn('h-2 w-2 text-[var(--aw-text-4)] shrink-0 transition-transform opacity-0 group-hover:opacity-100', expanded && 'rotate-90')} />
        )}
      </button>
      {expanded && hasContent && (
        <div className="ml-4 mt-0.5 mb-1">
          <pre className="text-[9px] text-[var(--aw-text-3)] font-mono whitespace-pre-wrap max-h-48 overflow-y-auto leading-relaxed bg-[var(--aw-bg-0)] rounded px-2 py-1.5 border border-[var(--aw-bg-2)]">
            {text}
          </pre>
        </div>
      )}
    </div>
  );
}

function ToolCallEntry({ entry, result }: { entry: StreamEntry; result?: StreamEntry }) {
  const [expanded, setExpanded] = useState(false);
  const toolName = entry.toolName ?? 'Unknown';
  const toolInput = entry.toolInput ?? {};
  const summary = getToolSummaryText(toolName, toolInput);

  const resultContent = result?.content ?? '';
  const isError = result?.isError ?? false;

  const resultBadge = isError ? 'error' : result ? 'ok' : null;

  const ToolIcon = toolName === 'Bash' ? Terminal
    : toolName === 'Read' ? Eye
    : (toolName === 'Edit' || toolName === 'Write') ? Wrench
    : (toolName === 'Grep' || toolName === 'Glob') ? Eye
    : Wrench;

  return (
    <div className="group">
      <button
        className="w-full flex items-center gap-1.5 px-1.5 py-1 hover:bg-[var(--aw-bg-2)]/30 rounded transition-colors text-left"
        onClick={() => setExpanded(v => !v)}
      >
        <ToolIcon className="h-2.5 w-2.5 shrink-0 text-[var(--aw-text-4)]" />
        <span className="text-[9px] font-medium text-[var(--aw-text-3)]">{toolName}</span>
        <span className="text-[9px] text-[var(--aw-text-4)] font-mono truncate flex-1">{summary}</span>
        {resultBadge && (
          <span className={cn(
            'text-[8px] px-1 py-0.5 rounded shrink-0',
            isError ? 'text-[var(--aw-red-bright)]' : 'text-[var(--aw-text-4)]',
          )}>
            {resultBadge}
          </span>
        )}
        <ChevronRight className={cn('h-2 w-2 text-[var(--aw-text-4)] shrink-0 transition-transform opacity-0 group-hover:opacity-100', expanded && 'rotate-90 opacity-100')} />
      </button>

      {expanded && (
        <div className="ml-4 mt-0.5 mb-1 space-y-1.5">
          <div>
            <div className="text-[8px] text-[var(--aw-text-4)] uppercase tracking-wider mb-0.5">Input</div>
            <pre className="text-[9px] font-mono text-[var(--aw-text-2)] bg-[var(--aw-bg-0)] rounded p-1.5 overflow-x-auto max-h-32 whitespace-pre-wrap leading-relaxed border border-[var(--aw-bg-2)]">
              {formatToolInput(toolName, toolInput)}
            </pre>
          </div>
          {result && (
            <div>
              <div className={cn(
                'text-[8px] uppercase tracking-wider mb-0.5',
                isError ? 'text-[var(--aw-red-bright)]' : 'text-[var(--aw-text-4)]',
              )}>
                {isError ? 'Error' : 'Output'}
              </div>
              <pre className={cn(
                'text-[9px] font-mono rounded p-1.5 overflow-x-auto max-h-32 whitespace-pre-wrap leading-relaxed border',
                isError ? 'text-[var(--aw-red-bright)] bg-[var(--aw-red)]/5 border-[var(--aw-red)]/20' : 'text-[var(--aw-text-2)] bg-[var(--aw-bg-0)] border-[var(--aw-bg-2)]',
              )}>
                {resultContent.length > 2000 ? resultContent.slice(0, 2000) + '\n...(truncated)' : resultContent || '(empty)'}
              </pre>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function TextEntry({ entry }: { entry: StreamEntry }) {
  const text = entry.text ?? '';
  const isLong = text.length > 500;

  return (
    <div className="rounded-md border-l-2 border-l-[var(--aw-blue)] bg-[var(--aw-bg-0)] px-3 py-2 my-1">
      <div className={cn('text-[11px] text-[var(--aw-text-0)] leading-relaxed', isLong && 'max-h-[500px] overflow-y-auto')}>
        <MarkdownRenderer content={text} size="sm" />
      </div>
    </div>
  );
}

// ── Recommendation Card ─────────────────────────────────────────────────────────

function RecommendationCard({ rec }: { rec: AnalysisRecommendation }) {
  const [expanded, setExpanded] = useState(false);
  const colorClass = SEVERITY_COLORS[rec.severity] ?? SEVERITY_COLORS.low;

  return (
    <div className={cn('border-l-2 rounded-r overflow-hidden', colorClass)}>
      <button
        className="w-full flex items-center gap-2 p-3 hover:bg-[var(--aw-bg-1)]/50 transition-colors text-left"
        onClick={() => setExpanded(v => !v)}
      >
        <span className="text-[10px] uppercase font-semibold tracking-wider text-[var(--aw-text-2)] shrink-0 w-14">
          {rec.severity}
        </span>
        <span className="text-xs font-medium text-[var(--aw-text-0)] flex-1">{rec.title}</span>
        <ChevronRight className={cn('h-3 w-3 text-[var(--aw-text-4)] shrink-0 transition-transform', expanded && 'rotate-90')} />
      </button>
      {expanded && (
        <div className="px-3 pb-3 space-y-1.5 text-[11px] text-[var(--aw-text-1)]">
          <div><span className="text-[var(--aw-text-2)] font-medium">Root cause:</span> {rec.rootCause}</div>
          <div><span className="text-[var(--aw-text-2)] font-medium">Component:</span> {rec.affectedComponent}</div>
          <div><span className="text-[var(--aw-text-2)] font-medium">Proposed change:</span> {rec.proposedChange}</div>
          {rec.selfCorrectionSignal && (
            <div><span className="text-[var(--aw-text-2)] font-medium">Self-correction:</span> {rec.selfCorrectionSignal}</div>
          )}
        </div>
      )}
    </div>
  );
}
