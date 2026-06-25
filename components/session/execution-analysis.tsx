'use client';

import { useState, useEffect, useRef } from 'react';
import {
  Sparkles, Play, Loader2, ChevronDown, ChevronRight,
  Copy, Check, Trash2, Eye, EyeOff,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { useExecutionAnalysisStore } from '@/store/execution-analysis-store';
import { useWebSocket } from '@/hooks/use-websocket';
import { MarkdownRenderer } from '@/components/shared/markdown-renderer';
import type { SessionEvent } from '@/types/events';
import type { ExecutionAnalysisCycle, ExecutionRecommendation } from '@/types/analytics';
import type { StreamEntry } from '@/types/feedback';

interface ExecutionAnalysisProps {
  sessionId: string;
}

export function ExecutionAnalysis({ sessionId }: ExecutionAnalysisProps) {
  const {
    cycles, isAnalyzing, isLoading, lastError, streamEntries,
    loadCycles, previewPrompt, triggerAnalysis, deleteCycle, handleStreamEvent,
    clearError, clearStream,
  } = useExecutionAnalysisStore();

  const [showPromptPreview, setShowPromptPreview] = useState(false);
  const [promptText, setPromptText] = useState<string | null>(null);
  const [loadingPrompt, setLoadingPrompt] = useState(false);
  const [expandedCycles, setExpandedCycles] = useState<Set<string>>(new Set());

  useEffect(() => {
    loadCycles(sessionId);
  }, [sessionId, loadCycles]);

  useWebSocket((event: SessionEvent) => {
    if (
      event.type === 'execution_analysis_started' ||
      event.type === 'execution_analysis_stream_event' ||
      event.type === 'execution_analysis_complete' ||
      event.type === 'execution_analysis_failed'
    ) {
      handleStreamEvent(event);
    }
  });

  const handlePreviewPrompt = async () => {
    if (showPromptPreview && promptText) {
      setShowPromptPreview(false);
      return;
    }
    setLoadingPrompt(true);
    const prompt = await previewPrompt(sessionId);
    setPromptText(prompt);
    setShowPromptPreview(true);
    setLoadingPrompt(false);
  };

  const handleRunAnalysis = async (customPrompt?: string) => {
    clearError();
    clearStream();
    await triggerAnalysis(sessionId, customPrompt || undefined);
  };

  const toggleCycle = (id: string) => {
    setExpandedCycles(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
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
          <div className="flex items-center justify-between px-3 py-2 border-b border-[var(--aw-bg-2)]">
            <span className="text-[10px] text-[var(--aw-text-2)]">Analysis Prompt (editable)</span>
            <button
              onClick={() => handleRunAnalysis(promptText)}
              disabled={isAnalyzing}
              className="flex items-center gap-1 px-2 py-1 rounded text-[10px] bg-[var(--aw-green-3)] hover:bg-[var(--aw-green-2)] text-white disabled:opacity-50"
            >
              <Play className="h-2.5 w-2.5" /> Run with this prompt
            </button>
          </div>
          <textarea
            value={promptText}
            onChange={e => setPromptText(e.target.value)}
            className="w-full p-3 bg-transparent text-[10px] text-[var(--aw-text-1)] font-mono resize-y min-h-[200px] max-h-[500px] outline-none"
            rows={15}
          />
        </div>
      )}

      {/* Live Stream */}
      {isAnalyzing && streamEntries.length > 0 && (
        <div className="rounded-md border border-[var(--aw-bg-3)] bg-[var(--aw-bg-0)]">
          <div className="flex items-center gap-2 px-3 py-2 border-b border-[var(--aw-bg-2)]">
            <Loader2 className="h-3 w-3 animate-spin text-[var(--aw-blue)]" />
            <span className="text-[10px] text-[var(--aw-blue)]">Analysis in progress...</span>
          </div>
          <StreamLog entries={streamEntries} isLive />
        </div>
      )}

      {/* Past Analysis Cycles */}
      {cycles.length > 0 && (
        <div className="space-y-2">
          <h4 className="text-[11px] text-[var(--aw-text-2)] uppercase tracking-wide">Analysis History</h4>
          {cycles.map(cycle => (
            <CycleCard
              key={cycle.id}
              cycle={cycle}
              sessionId={sessionId}
              isExpanded={expandedCycles.has(cycle.id)}
              onToggle={() => toggleCycle(cycle.id)}
              onDelete={() => deleteCycle(sessionId, cycle.id)}
            />
          ))}
        </div>
      )}
    </div>
  );
}

// ── Cycle Card ────────────────────────────────────────────────────────────

function CycleCard({
  cycle, sessionId, isExpanded, onToggle, onDelete,
}: {
  cycle: ExecutionAnalysisCycle;
  sessionId: string;
  isExpanded: boolean;
  onToggle: () => void;
  onDelete: () => void;
}) {
  const [copied, setCopied] = useState(false);
  const [tab, setTab] = useState<'response' | 'stream' | 'prompt'>('response');

  const statusColors: Record<string, string> = {
    completed: 'text-[var(--aw-green)] bg-[var(--aw-green)]/10',
    failed: 'text-[var(--aw-red)] bg-[var(--aw-red)]/10',
    analyzing: 'text-[var(--aw-blue)] bg-[var(--aw-blue)]/10',
    pending: 'text-[var(--aw-text-2)] bg-[var(--aw-bg-2)]',
  };

  const handleCopy = async () => {
    if (cycle.analysisResponse) {
      await navigator.clipboard.writeText(cycle.analysisResponse);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  };

  return (
    <div className="rounded-md border border-[var(--aw-bg-2)] bg-[var(--aw-bg-1)] overflow-hidden">
      <button
        onClick={onToggle}
        className="w-full flex items-center gap-2 px-3 py-2.5 text-left hover:bg-[var(--aw-bg-2)]/50 transition-colors"
      >
        {isExpanded ? <ChevronDown className="h-3 w-3 text-[var(--aw-text-3)]" /> : <ChevronRight className="h-3 w-3 text-[var(--aw-text-3)]" />}
        <Sparkles className="h-3 w-3 text-[var(--aw-purple)]" />
        <span className="text-xs text-[var(--aw-text-1)]">Analysis #{cycle.cycleNumber}</span>
        <span className={cn('text-[9px] px-1.5 py-0.5 rounded', statusColors[cycle.status] || statusColors.pending)}>
          {cycle.status}
        </span>
        <span className="text-[9px] text-[var(--aw-text-4)] ml-auto">
          {new Date(cycle.createdAt).toLocaleString()}
        </span>
      </button>

      {isExpanded && (
        <div className="border-t border-[var(--aw-bg-2)]">
          {/* Tabs */}
          <div className="flex items-center gap-0.5 px-3 py-1.5 border-b border-[var(--aw-bg-2)]">
            {(['response', 'stream', 'prompt'] as const).map(t => (
              <button
                key={t}
                onClick={() => setTab(t)}
                className={cn(
                  'px-2 py-1 rounded text-[10px] transition-colors',
                  tab === t ? 'bg-[var(--aw-bg-2)] text-[var(--aw-text-0)]' : 'text-[var(--aw-text-3)] hover:text-[var(--aw-text-1)]'
                )}
              >
                {t.charAt(0).toUpperCase() + t.slice(1)}
              </button>
            ))}
            <div className="ml-auto flex items-center gap-1">
              {cycle.analysisResponse && (
                <button
                  onClick={handleCopy}
                  className="flex items-center gap-1 px-1.5 py-0.5 rounded text-[9px] text-[var(--aw-text-2)] hover:text-[var(--aw-text-1)] transition-colors"
                >
                  {copied ? <Check className="h-2.5 w-2.5 text-[var(--aw-green)]" /> : <Copy className="h-2.5 w-2.5" />}
                  {copied ? 'Copied' : 'Copy'}
                </button>
              )}
              <button
                onClick={onDelete}
                className="flex items-center gap-1 px-1.5 py-0.5 rounded text-[9px] text-[var(--aw-text-3)] hover:text-[var(--aw-red)] transition-colors"
              >
                <Trash2 className="h-2.5 w-2.5" />
              </button>
            </div>
          </div>

          {/* Content */}
          <div className="p-3 max-h-[600px] overflow-y-auto">
            {tab === 'response' && (
              cycle.analysisResponse
                ? <MarkdownRenderer content={cycle.analysisResponse} size="sm" />
                : <p className="text-xs text-[var(--aw-text-3)]">No response yet</p>
            )}
            {tab === 'stream' && (
              cycle.streamEntries && cycle.streamEntries.length > 0
                ? <StreamLog entries={cycle.streamEntries} />
                : <p className="text-xs text-[var(--aw-text-3)]">No stream data</p>
            )}
            {tab === 'prompt' && (
              <pre className="text-[10px] text-[var(--aw-text-2)] whitespace-pre-wrap font-mono">
                {cycle.analysisPrompt}
              </pre>
            )}
          </div>

          {/* Recommendations */}
          {tab === 'response' && cycle.recommendations && cycle.recommendations.length > 0 && (
            <div className="border-t border-[var(--aw-bg-2)] p-3">
              <h5 className="text-[10px] text-[var(--aw-text-2)] uppercase tracking-wide mb-2">
                AI Recommendations ({cycle.recommendations.length})
              </h5>
              <div className="space-y-2">
                {cycle.recommendations.map((rec, i) => (
                  <AIRecommendationCard key={i} rec={rec} />
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ── AI Recommendation Card ────────────────────────────────────────────────

function AIRecommendationCard({ rec }: { rec: ExecutionRecommendation }) {
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

  return (
    <div className="p-2 rounded border border-[var(--aw-bg-2)] bg-[var(--aw-bg-0)]">
      <div className="flex items-center gap-1.5 mb-1">
        <span className={cn('text-[9px] px-1 py-0.5 rounded font-medium', severityColors[rec.severity] || severityColors.medium)}>
          {rec.severity.toUpperCase()}
        </span>
        <span className="text-[9px] px-1 py-0.5 rounded bg-[var(--aw-bg-2)] text-[var(--aw-text-2)]">{rec.category}</span>
        {rec.confidence && (
          <span className={cn('text-[9px] ml-auto', confidenceColors[rec.confidence] || confidenceColors.medium)}>
            {rec.confidence} confidence
          </span>
        )}
      </div>
      <p className="text-[11px] text-[var(--aw-text-0)] font-medium">{rec.title}</p>
      <p className="text-[10px] text-[var(--aw-text-2)] mt-1">{rec.observation}</p>
      {rec.evidence && (
        <p className="text-[10px] text-[var(--aw-text-3)] mt-1 italic">{rec.evidence}</p>
      )}
      <p className="text-[10px] text-[var(--aw-blue)] mt-1">{rec.recommendation}</p>
    </div>
  );
}

// ── Stream Log ────────────────────────────────────────────────────────────

function StreamLog({ entries, isLive = false }: { entries: StreamEntry[]; isLive?: boolean }) {
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (isLive && scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [entries.length, isLive]);

  const textEntries = entries.filter(e => e.kind === 'text');
  const fullText = textEntries.map(e => e.text || '').join('');

  if (fullText && !isLive) {
    return (
      <div className="max-h-[400px] overflow-y-auto" ref={scrollRef}>
        <MarkdownRenderer content={fullText} size="sm" />
      </div>
    );
  }

  return (
    <div className="max-h-[400px] overflow-y-auto font-mono text-[10px]" ref={scrollRef}>
      {entries.map(entry => {
        if (entry.kind === 'system') {
          return <div key={entry.id} className="px-3 py-1 text-[var(--aw-text-2)] italic">{entry.text}</div>;
        }
        if (entry.kind === 'text') {
          return <div key={entry.id} className="px-3 py-0.5 text-[var(--aw-text-1)] whitespace-pre-wrap">{entry.text}</div>;
        }
        if (entry.kind === 'thinking') {
          return <div key={entry.id} className="px-3 py-0.5 text-[var(--aw-text-3)] italic">[thinking] {(entry.text || '').slice(0, 200)}</div>;
        }
        if (entry.kind === 'tool_use') {
          return <div key={entry.id} className="px-3 py-0.5 text-[var(--aw-purple)]">[tool] {entry.toolName}</div>;
        }
        if (entry.kind === 'tool_result') {
          return (
            <div key={entry.id} className={cn('px-3 py-0.5', entry.isError ? 'text-[var(--aw-red)]' : 'text-[var(--aw-text-3)]')}>
              [result{entry.isError ? ' ERROR' : ''}] {(entry.content || '').slice(0, 150)}
            </div>
          );
        }
        return null;
      })}
      {isLive && (
        <div className="px-3 py-1 flex items-center gap-1">
          <span className="w-1.5 h-1.5 rounded-full bg-[var(--aw-blue)] animate-pulse" />
        </div>
      )}
    </div>
  );
}
