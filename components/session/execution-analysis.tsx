'use client';

import { useState, useEffect, useCallback } from 'react';
import {
  Sparkles, Play, Loader2, ChevronDown, ChevronRight,
  Copy, Check, Trash2, Eye, EyeOff, MessageSquarePlus,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { useExecutionAnalysisStore } from '@/store/execution-analysis-store';
import { useFeedbackStore } from '@/store/feedback-store';
import { useSessionStore } from '@/store/session-store';
import { useWebSocket } from '@/hooks/use-websocket';
import { MarkdownRenderer } from '@/components/shared/markdown-renderer';
import { CollapsibleStreamLog } from '@/components/shared/collapsible-stream-log';
import { ModelSelect } from '@/components/shared/model-select';
import { StopButton } from '@/components/shared/stop-button';
import { CopyableSessionId } from '@/components/shared/copyable-session-id';
import type { SessionEvent } from '@/types/events';
import type { ExecutionAnalysisCycle, ExecutionRecommendation } from '@/types/analytics';
import { FEEDBACK_CATEGORIES, type FeedbackCategory } from '@/types/feedback';

interface ExecutionAnalysisProps {
  sessionId: string;
}

const STATUS_META: Record<string, { label: string; color: string }> = {
  analyzing:  { label: 'Analyzing…', color: 'var(--aw-blue)' },
  completed:  { label: 'Completed',  color: 'var(--aw-green)' },
  failed:     { label: 'Failed',     color: 'var(--aw-red-bright)' },
  cancelled:  { label: 'Cancelled',  color: 'var(--aw-text-3)' },
  pending:    { label: 'Pending',    color: 'var(--aw-text-3)' },
};

export function ExecutionAnalysis({ sessionId }: ExecutionAnalysisProps) {
  const {
    cycles, isAnalyzing, isStopping, lastError, streamEntries, model,
    loadCycles, previewPrompt, triggerAnalysis, stopAnalysis, deleteCycle, handleStreamEvent,
    clearError, clearStream, setModel,
  } = useExecutionAnalysisStore();

  const [showPromptPreview, setShowPromptPreview] = useState(false);
  const [promptText, setPromptText] = useState<string | null>(null);
  const [loadingPrompt, setLoadingPrompt] = useState(false);
  const [promptViewMode, setPromptViewMode] = useState<'preview' | 'edit'>('preview');
  const [expandedCycleId, setExpandedCycleId] = useState<string | null>(null);

  useEffect(() => {
    loadCycles(sessionId);
  }, [sessionId, loadCycles]);

  // Poll while analyzing — catches completion if WebSocket drops
  useEffect(() => {
    if (!isAnalyzing) return;
    const interval = setInterval(() => loadCycles(sessionId), 10_000);
    return () => clearInterval(interval);
  }, [isAnalyzing, sessionId, loadCycles]);

  useEffect(() => {
    if (expandedCycleId) return;
    const latest = cycles.find(c => c.status === 'completed' || c.status === 'analyzing');
    if (latest) setExpandedCycleId(latest.id);
  }, [cycles.length]);

  const onWsEvent = useCallback((event: SessionEvent) => {
    if (
      event.type === 'execution_analysis_started' ||
      event.type === 'execution_analysis_stream_event' ||
      event.type === 'execution_analysis_complete' ||
      event.type === 'execution_analysis_failed'
    ) {
      handleStreamEvent(event);
    }
  }, [handleStreamEvent]);

  useWebSocket(onWsEvent);

  const handlePreviewPrompt = async () => {
    if (showPromptPreview && promptText) {
      setShowPromptPreview(false);
      return;
    }
    setLoadingPrompt(true);
    const prompt = await previewPrompt(sessionId);
    setPromptText(prompt);
    setPromptViewMode('preview');
    setShowPromptPreview(true);
    setLoadingPrompt(false);
  };

  const handleRunAnalysis = async (customPrompt?: string) => {
    clearError();
    clearStream();
    const cycle = await triggerAnalysis(sessionId, customPrompt || undefined);
    if (cycle) setExpandedCycleId(cycle.id);
  };

  return (
    <div className="space-y-4">
      {/* Action Bar */}
      <div className="flex items-center gap-2 flex-wrap">
        <button
          onClick={() => handleRunAnalysis(showPromptPreview ? promptText || undefined : undefined)}
          disabled={isAnalyzing}
          className={cn(
            'flex items-center gap-1.5 px-3 py-2 rounded-md text-xs font-medium transition-colors',
            isAnalyzing
              ? 'bg-[var(--aw-bg-2)] text-[var(--aw-text-3)] cursor-not-allowed'
              : 'bg-[var(--aw-green-3)] hover:bg-[var(--aw-green-2)] text-white'
          )}
        >
          {isAnalyzing
            ? <><Loader2 className="h-3 w-3 animate-spin" /> Analyzing...</>
            : <><Sparkles className="h-3 w-3" /> Run AI Analysis</>
          }
        </button>
        <ModelSelect value={model} onChange={setModel} disabled={isAnalyzing} />
        {isAnalyzing && (
          <StopButton onClick={() => stopAnalysis(sessionId)} stopping={isStopping} />
        )}
        <button
          onClick={handlePreviewPrompt}
          disabled={loadingPrompt}
          className="flex items-center gap-1 px-2 py-2 rounded-md text-[10px] text-[var(--aw-text-2)] hover:text-[var(--aw-text-1)] transition-colors border border-[var(--aw-bg-3)] hover:border-[var(--aw-text-4)]"
        >
          {loadingPrompt
            ? <Loader2 className="h-3 w-3 animate-spin" />
            : showPromptPreview ? <EyeOff className="h-3 w-3" /> : <Eye className="h-3 w-3" />
          }
          {showPromptPreview ? 'Hide Prompt' : 'Preview Prompt'}
        </button>
      </div>

      {lastError && (
        <div className="p-3 rounded-md border border-[var(--aw-red)]/30 bg-[var(--aw-red)]/10 text-xs text-[var(--aw-red)]">
          {lastError}
          <button onClick={clearError} className="ml-2 underline">dismiss</button>
        </div>
      )}

      {/* Prompt Preview */}
      {showPromptPreview && promptText && (
        <div className="rounded-md border border-[var(--aw-bg-3)] bg-[var(--aw-bg-0)]">
          <div className="flex items-center gap-2 px-3 py-2 border-b border-[var(--aw-bg-2)]">
            <span className="text-[10px] text-[var(--aw-text-2)] flex-1">Analysis Prompt</span>
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
            <span className="text-[10px] text-[var(--aw-text-4)] font-mono tabular-nums shrink-0">
              {promptText.length.toLocaleString()} chars
            </span>
            <button
              onClick={() => handleRunAnalysis(promptText)}
              disabled={isAnalyzing}
              className="flex items-center gap-1 px-2 py-1 rounded text-[10px] bg-[var(--aw-green-3)] hover:bg-[var(--aw-green-2)] text-white disabled:opacity-50 shrink-0"
            >
              <Play className="h-2.5 w-2.5" /> Run
            </button>
          </div>
          {promptViewMode === 'preview' ? (
            <div className="px-4 py-3 overflow-y-auto max-h-[500px]">
              <MarkdownRenderer content={promptText} size="sm" />
            </div>
          ) : (
            <textarea
              value={promptText}
              onChange={e => setPromptText(e.target.value)}
              className="w-full p-3 bg-transparent text-[10px] text-[var(--aw-text-1)] font-mono resize-y min-h-[200px] max-h-[500px] outline-none"
              rows={15}
            />
          )}
        </div>
      )}

      {/* Analysis Cycles */}
      {(cycles.length > 0 || isAnalyzing) && (
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <h4 className="text-[11px] text-[var(--aw-text-2)] uppercase tracking-wide">Analysis History</h4>
            {cycles.length > 0 && (
              <span className="text-[10px] text-[var(--aw-text-4)]">
                {cycles.length} cycle{cycles.length !== 1 ? 's' : ''}
              </span>
            )}
          </div>
          {cycles.map(cycle => (
            <CycleCard
              key={cycle.id}
              cycle={cycle}
              sessionId={sessionId}
              isExpanded={expandedCycleId === cycle.id}
              onToggle={() => setExpandedCycleId(expandedCycleId === cycle.id ? null : cycle.id)}
              onDelete={() => deleteCycle(sessionId, cycle.id)}
              liveStreamEntries={cycle.status === 'analyzing' ? streamEntries : []}
              isLive={cycle.status === 'analyzing' && isAnalyzing}
            />
          ))}
        </div>
      )}
    </div>
  );
}

// ── Cycle Card ────────────────────────────────────────────────────────────

function CycleCard({
  cycle, sessionId, isExpanded, onToggle, onDelete, liveStreamEntries, isLive,
}: {
  cycle: ExecutionAnalysisCycle;
  sessionId: string;
  isExpanded: boolean;
  onToggle: () => void;
  onDelete: () => void;
  liveStreamEntries: import('@/types/feedback').StreamEntry[];
  isLive: boolean;
}) {
  const [copied, setCopied] = useState(false);
  const [showPrompt, setShowPrompt] = useState(false);
  const [showStream, setShowStream] = useState(isLive);

  useEffect(() => {
    if (isLive) setShowStream(true);
  }, [isLive]);

  const s = STATUS_META[cycle.status] ?? STATUS_META.pending;

  const handleCopy = async () => {
    if (cycle.analysisResponse) {
      await navigator.clipboard.writeText(cycle.analysisResponse);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  };

  const date = new Date(cycle.createdAt).toLocaleDateString([], {
    month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit',
  });

  const hasStreamLog = (cycle.streamEntries && cycle.streamEntries.length > 0) || isLive;
  const streamLabel = isLive ? 'Live Stream' : hasStreamLog ? 'Activity Log' : 'Response';
  const entryCount = isLive
    ? liveStreamEntries.length
    : cycle.streamEntries?.length ?? 0;

  return (
    <div
      className={cn(
        'rounded border overflow-hidden transition-colors',
        cycle.status === 'analyzing'
          ? 'border-[var(--aw-bg-2)] bg-[var(--aw-bg-1)] ring-1 ring-[var(--aw-blue)]/20'
          : 'border-[var(--aw-bg-2)] bg-[var(--aw-bg-1)]',
      )}
      style={{ borderLeftColor: s.color, borderLeftWidth: '3px' }}
    >
      {/* Header row */}
      <div
        className="flex items-center gap-2 px-2.5 pt-2 pb-1.5 cursor-pointer hover:bg-[var(--aw-bg-2)]/40 transition-colors"
        onClick={onToggle}
      >
        <span className="text-[11px] font-bold text-[var(--aw-text-0)] shrink-0 w-6">#{cycle.cycleNumber}</span>

        <Sparkles className="h-3 w-3 text-[var(--aw-purple)] shrink-0" />

        <span
          className="text-[10px] font-medium px-1.5 py-0.5 rounded shrink-0"
          style={{ color: s.color, background: `${s.color}18` }}
        >
          {s.label}
        </span>

        {cycle.model && (
          <span
            className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-[var(--aw-bg-3)] text-[var(--aw-text-2)] shrink-0"
            title="Model the CLI actually ran with"
          >
            {cycle.model}
          </span>
        )}

        {cycle.cliSessionId && <CopyableSessionId sessionId={cycle.cliSessionId} />}

        <span className="flex-1" />

        <span className="text-[10px] text-[var(--aw-text-4)] shrink-0">{date}</span>

        {isExpanded
          ? <ChevronDown className="h-3 w-3 text-[var(--aw-text-4)] shrink-0" />
          : <ChevronRight className="h-3 w-3 text-[var(--aw-text-4)] shrink-0" />
        }
      </div>

      {/* Action row */}
      <div className="flex items-center gap-1 px-2 pb-2">
        {cycle.analysisResponse && (
          <button
            onClick={e => { e.stopPropagation(); handleCopy(); }}
            className="flex items-center gap-1 text-[10px] text-[var(--aw-text-2)] hover:text-[var(--aw-text-0)] transition-colors px-1.5 py-0.5 rounded hover:bg-[var(--aw-bg-2)]"
          >
            {copied ? <Check className="h-2.5 w-2.5 text-[var(--aw-green)]" /> : <Copy className="h-2.5 w-2.5" />}
            {copied ? 'Copied' : 'Copy'}
          </button>
        )}
        <button
          onClick={e => { e.stopPropagation(); onDelete(); }}
          className="flex items-center gap-1 text-[10px] text-[var(--aw-text-4)] hover:text-[var(--aw-red-bright)] transition-colors px-1.5 py-0.5 rounded hover:bg-[var(--aw-red-bright)]/10 ml-auto"
          title="Delete this cycle"
        >
          <Trash2 className="h-2.5 w-2.5" />
        </button>
      </div>

      {/* Expanded content */}
      {isExpanded && (
        <div className="border-t border-[var(--aw-bg-2)]">
          {/* Prompt toggle */}
          <button
            onClick={e => { e.stopPropagation(); setShowPrompt(v => !v); }}
            className="w-full flex items-center gap-1.5 px-2.5 py-1.5 text-[10px] text-[var(--aw-text-2)] hover:bg-[var(--aw-bg-2)]/50 transition-colors text-left"
          >
            {showPrompt
              ? <ChevronDown className="h-2.5 w-2.5 shrink-0" />
              : <ChevronRight className="h-2.5 w-2.5 shrink-0" />}
            Analysis Prompt
            <span className="text-[var(--aw-text-4)] ml-auto">{cycle.analysisPrompt.length.toLocaleString()} chars</span>
          </button>
          {showPrompt && (
            <div className="px-2.5 pb-2.5">
              <pre className="text-[10px] text-[var(--aw-text-2)] whitespace-pre-wrap max-h-40 overflow-y-auto font-mono bg-[var(--aw-bg-0)] p-2 rounded border border-[var(--aw-bg-2)] leading-relaxed">
                {cycle.analysisPrompt}
              </pre>
            </div>
          )}

          {/* Stream / Response log */}
          <div className="border-t border-[var(--aw-bg-2)]">
            <button
              onClick={e => { e.stopPropagation(); setShowStream(v => !v); }}
              className="w-full flex items-center gap-1.5 px-2.5 py-1.5 text-[10px] text-[var(--aw-text-2)] hover:bg-[var(--aw-bg-2)]/50 transition-colors text-left"
            >
              {showStream
                ? <ChevronDown className="h-2.5 w-2.5 shrink-0" />
                : <ChevronRight className="h-2.5 w-2.5 shrink-0" />}
              {streamLabel}
              {entryCount > 0 && (
                <span className="text-[var(--aw-text-4)] ml-1">({entryCount} events)</span>
              )}
              {isLive && (
                <Loader2 className="h-2.5 w-2.5 animate-spin text-[var(--aw-blue)] ml-auto" />
              )}
            </button>
            {showStream && (
              <div className="px-2.5 pb-2.5">
                {isLive ? (
                  <CollapsibleStreamLog
                    entries={liveStreamEntries}
                    sessionId={sessionId}
                    isLive
                    loadingLabel="Starting analysis session..."
                  />
                ) : cycle.streamEntries && cycle.streamEntries.length > 0 ? (
                  <CollapsibleStreamLog
                    entries={cycle.streamEntries}
                    sessionId={sessionId}
                  />
                ) : cycle.analysisResponse ? (
                  <div className="max-h-[420px] overflow-y-auto pr-0.5">
                    <MarkdownRenderer content={cycle.analysisResponse} size="sm" />
                  </div>
                ) : (
                  <p className="text-[11px] text-[var(--aw-text-4)]">No response captured</p>
                )}
              </div>
            )}
          </div>

          {/* Recommendations */}
          {cycle.recommendations && cycle.recommendations.length > 0 && (
            <div className="border-t border-[var(--aw-bg-2)] p-3">
              <h5 className="text-[10px] text-[var(--aw-text-2)] uppercase tracking-wide mb-2">
                AI Recommendations ({cycle.recommendations.length})
              </h5>
              <div className="space-y-2">
                {cycle.recommendations.map((rec, i) => (
                  <AIRecommendationCard key={i} rec={rec} sessionId={sessionId} />
                ))}
              </div>
            </div>
          )}

          {cycle.completedAt && (
            <div className="px-2.5 pb-2 text-[10px] text-[var(--aw-text-4)]">
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

// ── AI Recommendation Card ────────────────────────────────────────────────

function humanizeLabel(raw: string): string {
  return raw.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
}

function AIRecommendationCard({ rec, sessionId }: { rec: ExecutionRecommendation; sessionId: string }) {
  const addFeedback = useFeedbackStore(s => s.addFeedback);
  const { agentMap } = useSessionStore();
  const [feedbackState, setFeedbackState] = useState<'idle' | 'adding' | 'added'>('idle');

  const validCategory = FEEDBACK_CATEGORIES.some(c => c.value === rec.feedbackCategory)
    ? (rec.feedbackCategory as FeedbackCategory)
    : 'other';

  // Resolved from the session's own agent data rather than trusting the
  // model to echo a name back — the id is all it needs to get right.
  const targetAgent = rec.agentId ? agentMap.get(rec.agentId) : undefined;
  const targetAgentName = targetAgent
    ? (targetAgent.description?.slice(0, 60) || targetAgent.subagentType || targetAgent.type)
    : null;

  const handleAddFeedback = async () => {
    if (!rec.agentId || !rec.feedbackText || feedbackState !== 'idle') return;
    setFeedbackState('adding');
    const created = await addFeedback({
      sessionId,
      agentId: rec.agentId,
      agentName: targetAgentName,
      category: validCategory,
      text: rec.feedbackText,
    });
    setFeedbackState(created ? 'added' : 'idle');
  };

  const severityColors: Record<string, string> = {
    critical: 'text-[var(--aw-red)] bg-[var(--aw-red)]/10',
    high: 'text-[var(--aw-orange)] bg-[var(--aw-orange)]/10',
    medium: 'text-[var(--aw-yellow)] bg-[var(--aw-yellow)]/10',
    low: 'text-[var(--aw-blue)] bg-[var(--aw-blue)]/10',
  };

  const confidenceColors: Record<string, string> = {
    high: 'text-[var(--aw-green)]',
    medium: 'text-[var(--aw-yellow)]',
    low: 'text-[var(--aw-text-2)]',
  };

  // The model's JSON is free-form text, not a validated schema — a
  // recommendation can arrive with any field missing, or with the model
  // having drifted to a different field name for the same concept
  // (`target`/`finding` instead of `title`/`observation` have both been
  // observed for otherwise-identical prompts). Fall back across both
  // rather than rendering a mostly-blank card.
  const severity = rec.severity || 'medium';
  const heading = rec.title || rec.target || 'Recommendation';
  const body = rec.observation || rec.finding;
  // Only show target as its own tag when it isn't already standing in for
  // the heading above.
  const showTargetTag = Boolean(rec.target && rec.title);

  return (
    <div className="p-2 rounded border border-[var(--aw-bg-2)] bg-[var(--aw-bg-0)]">
      <div className="flex items-center gap-1.5 mb-1 flex-wrap">
        <span className={cn('text-[9px] px-1 py-0.5 rounded font-medium', severityColors[severity] || severityColors.medium)}>
          {severity.toUpperCase()}
        </span>
        {rec.category && (
          <span className="text-[9px] px-1 py-0.5 rounded bg-[var(--aw-bg-2)] text-[var(--aw-text-2)]">
            {humanizeLabel(rec.category)}
          </span>
        )}
        {showTargetTag && (
          <span
            className="text-[9px] px-1 py-0.5 rounded bg-[var(--aw-bg-2)] text-[var(--aw-text-3)] font-mono truncate max-w-[160px]"
            title={rec.target}
          >
            {rec.target}
          </span>
        )}
        {rec.confidence && (
          <span className={cn('text-[9px] ml-auto', confidenceColors[rec.confidence] || confidenceColors.medium)}>
            {rec.confidence} confidence
          </span>
        )}
      </div>
      <p className="text-[11px] text-[var(--aw-text-0)] font-medium">{heading}</p>
      {body && <p className="text-[10px] text-[var(--aw-text-2)] mt-1">{body}</p>}
      {rec.rootCause && (
        <p className="text-[10px] text-[var(--aw-text-3)] mt-1">
          <span className="text-[var(--aw-text-4)]">Root cause: </span>{rec.rootCause}
        </p>
      )}
      {rec.evidence && (
        Array.isArray(rec.evidence) ? (
          <ul className="text-[10px] text-[var(--aw-text-3)] mt-1 italic list-disc list-inside space-y-0.5">
            {rec.evidence.map((e, i) => <li key={i}>{e}</li>)}
          </ul>
        ) : (
          <p className="text-[10px] text-[var(--aw-text-3)] mt-1 italic">{rec.evidence}</p>
        )
      )}
      {rec.recommendation && (
        <p className="text-[10px] text-[var(--aw-blue)] mt-1">{rec.recommendation}</p>
      )}
      {rec.agentId && rec.feedbackText && (
        <div className="mt-1.5 pt-1.5 border-t border-[var(--aw-bg-2)]">
          {targetAgentName && (
            <p className="text-[9px] text-[var(--aw-text-4)] mb-0.5">
              Feedback for <span className="text-[var(--aw-text-2)] font-medium">{targetAgentName}</span>
            </p>
          )}
          <div className="flex items-start gap-1.5">
            <p className="text-[10px] text-[var(--aw-text-2)] flex-1">{rec.feedbackText}</p>
            <button
              onClick={handleAddFeedback}
              disabled={feedbackState !== 'idle'}
              className={cn(
                'flex items-center gap-1 text-[9px] px-1.5 py-0.5 rounded shrink-0 transition-colors',
                feedbackState === 'added'
                  ? 'text-[var(--aw-green)]'
                  : 'text-[var(--aw-text-2)] hover:text-[var(--aw-text-0)] hover:bg-[var(--aw-bg-2)]',
              )}
              title={`Add as feedback (${humanizeLabel(validCategory)})`}
            >
              {feedbackState === 'added'
                ? <Check className="h-2.5 w-2.5" />
                : <MessageSquarePlus className="h-2.5 w-2.5" />}
              {feedbackState === 'added' ? 'Added' : feedbackState === 'adding' ? 'Adding…' : 'Add as Feedback'}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
