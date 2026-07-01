'use client';

import { useState, useEffect, useRef } from 'react';
import {
  ChevronRight, ChevronDown, Loader2, MessageSquare,
  Terminal, Brain, Wrench, Eye, FileCode2,
  ShieldCheck, ShieldX, Check, X,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { MarkdownRenderer } from '@/components/shared/markdown-renderer';
import type { StreamEntry } from '@/types/feedback';

// ── Tool colors & helpers ──────────────────────────────────────────────────

export const TOOL_COLORS: Record<string, { border: string; icon: string }> = {
  Bash:  { border: 'var(--aw-green-bright)', icon: 'var(--aw-green-bright)' },
  Read:  { border: 'var(--aw-blue-light)', icon: 'var(--aw-blue-light)' },
  Edit:  { border: 'var(--aw-orange)', icon: 'var(--aw-orange)' },
  Write: { border: 'var(--aw-orange)', icon: 'var(--aw-orange)' },
  Grep:  { border: 'var(--aw-purple-light)', icon: 'var(--aw-purple-light)' },
  Glob:  { border: 'var(--aw-purple-light)', icon: 'var(--aw-purple-light)' },
  Agent: { border: 'var(--aw-blue)', icon: 'var(--aw-blue)' },
};

export function getToolColor(name: string) {
  return TOOL_COLORS[name] ?? { border: 'var(--aw-bg-3)', icon: 'var(--aw-text-1)' };
}

export function getToolSummaryText(toolName: string, toolInput: Record<string, unknown>): string {
  if (toolName === 'Bash') return String(toolInput?.command ?? '').slice(0, 80);
  if (toolName === 'Read') return String(toolInput?.file_path ?? '').split(/[/\\]/).slice(-2).join('/');
  if (toolName === 'Edit') return String(toolInput?.file_path ?? '').split(/[/\\]/).slice(-2).join('/') + ' (edit)';
  if (toolName === 'Write') return String(toolInput?.file_path ?? '').split(/[/\\]/).slice(-2).join('/') + ' (write)';
  if (toolName === 'Grep') return `"${String(toolInput?.pattern ?? '').slice(0, 40)}"`;
  if (toolName === 'Glob') return String(toolInput?.pattern ?? '').slice(0, 40);
  if (toolName === 'Agent') return String(toolInput?.description ?? toolInput?.prompt ?? '').slice(0, 60);
  return JSON.stringify(toolInput).slice(0, 60);
}

export function formatToolInput(toolName: string, toolInput: Record<string, unknown>): string {
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

// ── FileContentViewer ──────────────────────────────────────────────────────

export function FileContentViewer({ sessionId, filePath }: { sessionId: string; filePath: string }) {
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
      <div className="flex items-center gap-2 px-3 py-3 text-[10px] text-[var(--aw-blue)]">
        <Loader2 className="h-3 w-3 animate-spin" /> Loading file...
      </div>
    );
  }

  if (error) {
    return <div className="px-3 py-2 text-[10px] text-[var(--aw-red-bright)]">{error}</div>;
  }

  const lines = (content ?? '').split('\n');
  return (
    <div className="bg-[var(--aw-bg-4)] overflow-x-auto max-h-80 overflow-y-auto">
      <div className="px-2.5 py-1 text-[9px] font-mono text-[var(--aw-text-4)] border-b border-[var(--aw-bg-2)] truncate flex items-center gap-1.5">
        <FileCode2 className="h-3 w-3 shrink-0" />
        {filePath}
        <span className="ml-auto text-[var(--aw-bg-3)]">{lines.length} lines</span>
      </div>
      <table className="w-full border-collapse text-[11px] font-mono leading-5">
        <tbody>
          {lines.map((line, i) => (
            <tr key={i} className="hover:bg-[var(--aw-bg-1)]">
              <td className="select-none text-right pr-2 pl-2 text-[var(--aw-bg-3)] border-r border-[var(--aw-bg-2)] w-10 shrink-0">
                {i + 1}
              </td>
              <td className="px-3 py-0 whitespace-pre text-[var(--aw-text-1)] break-all">
                {line}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ── ThinkingEntry ──────────────────────────────────────────────────────────

export function ThinkingEntry({ entry }: { entry: StreamEntry }) {
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

// ── ToolCallEntry ──────────────────────────────────────────────────────────

export function ToolCallEntry({ entry, result, sessionId }: { entry: StreamEntry; result?: StreamEntry; sessionId: string }) {
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
    : result ? 'ok'
    : null;

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
        {hasFile && (
          <span
            role="button"
            tabIndex={0}
            onClick={e => { e.stopPropagation(); setShowFile(v => !v); }}
            onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.stopPropagation(); e.preventDefault(); setShowFile(v => !v); } }}
            className={cn(
              'text-[9px] flex items-center gap-0.5 px-1 py-0.5 rounded transition-colors shrink-0 cursor-pointer',
              showFile ? 'text-[var(--aw-blue)] bg-[var(--aw-blue)]/10' : 'text-[var(--aw-text-4)] hover:text-[var(--aw-text-2)] opacity-0 group-hover:opacity-100',
            )}
          >
            <FileCode2 className="h-2.5 w-2.5" /> {showFile ? 'Hide' : 'View'}
          </span>
        )}
        {resultBadge && (
          <span className={cn(
            'text-[8px] px-1 py-0.5 rounded shrink-0',
            isPermDenied ? 'text-[var(--aw-orange)]'
            : isError ? 'text-[var(--aw-red-bright)]'
            : 'text-[var(--aw-text-4)]',
          )}>
            {resultBadge}
          </span>
        )}
        <ChevronRight className={cn('h-2 w-2 text-[var(--aw-text-4)] shrink-0 transition-transform opacity-0 group-hover:opacity-100', expanded && 'rotate-90 opacity-100')} />
      </button>

      {showFile && hasFile && (
        <div className="ml-4 mt-0.5 mb-1 rounded border border-[var(--aw-bg-2)] overflow-hidden">
          <FileContentViewer sessionId={sessionId} filePath={filePath} />
        </div>
      )}

      {expanded && (
        <div className="ml-4 mt-0.5 mb-1 space-y-1.5">
          <div>
            <div className="text-[8px] text-[var(--aw-text-4)] uppercase tracking-wider mb-0.5">Input</div>
            <pre className="text-[9px] font-mono text-[var(--aw-text-2)] bg-[var(--aw-bg-0)] rounded p-1.5 overflow-x-auto max-h-32 whitespace-pre-wrap leading-relaxed border border-[var(--aw-bg-2)]">
              {formatToolInput(toolName, toolInput)}
            </pre>
          </div>
          {result && !isPermDenied && (
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
          {isPermDenied && (
            <div className="flex items-center gap-1.5 text-[9px] text-[var(--aw-orange)]">
              <ShieldX className="h-2.5 w-2.5 shrink-0" />
              <span>Permission denied</span>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ── TextEntry ──────────────────────────────────────────────────────────────

export function TextEntry({ entry }: { entry: StreamEntry }) {
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

// ── ApprovalCard ───────────────────────────────────────────────────────────

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

export function DiffLines({ diff }: { diff: string }) {
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
                <tr key={i} className="bg-[var(--aw-navy)]">
                  <td className="px-3 py-0.5 text-[var(--aw-blue-light)] select-none w-full" colSpan={2}>
                    {line}
                  </td>
                </tr>
              );
            }

            return (
              <tr key={i} className={isAdd ? 'bg-[var(--aw-diff-add-bg)]' : isDel ? 'bg-[var(--aw-diff-del-bg)]' : ''}>
                <td className={cn(
                  'select-none text-center w-5 shrink-0 pl-2 pr-1 border-r',
                  isAdd
                    ? 'text-[var(--aw-green)] border-[var(--aw-green)]/20'
                    : isDel
                      ? 'text-[var(--aw-red-bright)] border-[var(--aw-red-bright)]/20'
                      : 'text-[var(--aw-bg-3)] border-[var(--aw-bg-2)]',
                )}>
                  {isAdd ? '+' : isDel ? '−' : ' '}
                </td>
                <td className={cn(
                  'px-3 py-0 whitespace-pre break-all',
                  isAdd ? 'text-[var(--aw-diff-add-text)]' : isDel ? 'text-[var(--aw-diff-del-text)]' : 'text-[var(--aw-text-2)]',
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

export function ApprovalCard({ entry, sessionId, onApprove, onDeny }: { entry: StreamEntry; sessionId: string; onApprove: () => void; onDeny: () => void }) {
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
        ? 'border-[var(--aw-orange)]/50 bg-[var(--aw-orange)]/5 ring-1 ring-[var(--aw-orange)]/20'
        : isApproved
          ? 'border-[var(--aw-green)]/30 bg-[var(--aw-green)]/5'
          : 'border-[var(--aw-red-bright)]/30 bg-[var(--aw-red-bright)]/5',
    )}>
      <div className="flex items-center gap-2 px-2.5 py-2">
        {isPending ? (
          <ShieldCheck className="h-4 w-4 text-[var(--aw-orange)] shrink-0" />
        ) : isApproved ? (
          <Check className="h-4 w-4 text-[var(--aw-green)] shrink-0" />
        ) : (
          <ShieldX className="h-4 w-4 text-[var(--aw-red-bright)] shrink-0" />
        )}
        <div className="flex-1 min-w-0">
          <div className="text-[11px] font-semibold text-[var(--aw-text-0)]">
            {isPending
              ? (entry.toolName === 'Read' || entry.toolName === 'Glob' ? 'Allow Read?' : 'Approve Change?')
              : isApproved ? 'Approved' : 'Denied'}
          </div>
          <div className="text-[10px] text-[var(--aw-text-2)] truncate">
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
                  ? 'text-[var(--aw-blue)] bg-[var(--aw-blue)]/10'
                  : 'text-[var(--aw-text-2)] hover:text-[var(--aw-text-0)]',
              )}
            >
              <FileCode2 className="h-3 w-3" /> {viewMode === 'file' ? 'Diff' : 'File'}
            </button>
          )}
        </div>
      </div>

      {viewMode === 'diff' && diffPreview && (
        <div className="border-t border-[var(--aw-bg-2)] bg-[var(--aw-bg-4)]">
          <div className="px-2.5 py-1 text-[9px] font-mono text-[var(--aw-text-4)] border-b border-[var(--aw-bg-2)] truncate">
            {filePath}
          </div>
          <DiffLines diff={diffPreview} />
        </div>
      )}
      {viewMode === 'file' && (
        <div className="border-t border-[var(--aw-bg-2)]">
          <FileContentViewer sessionId={sessionId} filePath={filePath} />
        </div>
      )}

      {isPending && (
        <div className="border-t border-[var(--aw-bg-2)] flex gap-2 px-2.5 py-2">
          <button
            onClick={onApprove}
            className="flex-1 flex items-center justify-center gap-1.5 px-3 py-1.5 rounded bg-[var(--aw-green-3)] hover:bg-[var(--aw-green-2)] text-white text-[11px] font-medium transition-colors"
          >
            <Check className="h-3 w-3" /> Approve
          </button>
          <button
            onClick={onDeny}
            className="flex-1 flex items-center justify-center gap-1.5 px-3 py-1.5 rounded border border-[var(--aw-red-bright)]/40 text-[var(--aw-red-bright)] hover:bg-[var(--aw-red-bright)]/10 text-[11px] font-medium transition-colors"
          >
            <X className="h-3 w-3" /> Deny
          </button>
        </div>
      )}
    </div>
  );
}

// ── CollapsibleStreamLog ───────────────────────────────────────────────────

export interface CollapsibleStreamLogProps {
  entries: StreamEntry[];
  sessionId: string;
  pendingApprovals?: Map<string, { toolName: string; toolInput: Record<string, unknown> }>;
  onApprove?: (requestId: string) => void;
  onDeny?: (requestId: string) => void;
  isLive?: boolean;
  loadingLabel?: string;
}

export function CollapsibleStreamLog({
  entries,
  sessionId,
  pendingApprovals,
  onApprove,
  onDeny,
  isLive = false,
  loadingLabel = 'Starting...',
}: CollapsibleStreamLogProps) {
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (isLive) scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' });
  }, [entries.length, isLive]);

  if (entries.length === 0 && isLive) {
    return (
      <div className="flex items-center gap-2 text-[11px] text-[var(--aw-blue)]">
        <Loader2 className="h-3 w-3 animate-spin" /> {loadingLabel}
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
    <div ref={scrollRef} className={cn('overflow-y-auto pr-0.5', isLive ? 'max-h-[500px]' : 'max-h-[600px]')}>
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
          return <ToolCallEntry key={entry.id} entry={entry} result={result} sessionId={sessionId} />;
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

        if (entry.kind === 'permission_request' && onApprove && onDeny) {
          return (
            <div key={entry.id} className="my-1">
              <ApprovalCard
                entry={entry}
                sessionId={sessionId}
                onApprove={() => entry.requestId && onApprove(entry.requestId)}
                onDeny={() => entry.requestId && onDeny(entry.requestId)}
              />
            </div>
          );
        }

        if (entry.kind === 'text') {
          return <TextEntry key={entry.id} entry={entry} />;
        }

        return null;
      })}
      {isLive && pendingApprovals && pendingApprovals.size > 0 && (
        <div className="flex items-center gap-2 text-[10px] text-[var(--aw-orange)] pt-1">
          <Loader2 className="h-3 w-3 animate-spin" /> Waiting for approval...
        </div>
      )}
      {isLive && (!pendingApprovals || pendingApprovals.size === 0) && entries.length > 0 && entries[entries.length - 1].kind !== 'text' && (
        <div className="flex items-center gap-2 text-[10px] text-[var(--aw-blue)] pt-1">
          <Loader2 className="h-3 w-3 animate-spin" /> Processing...
        </div>
      )}
    </div>
  );
}
