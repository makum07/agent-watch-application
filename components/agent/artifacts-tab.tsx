'use client';

import { useState, useEffect, useMemo } from 'react';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Pencil, Plus, Filter, Loader2, NotebookPen, ChevronDown, ChevronRight, Copy, Check, Eye, Code, ExternalLink } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useWorkspaceStore } from '@/store/workspace-store';
import { InlineMarkdown } from '@/components/agent/artifact-card';

interface ArtifactRow {
  id: string;
  file_path: string;
  tool_name: string;
  type: 'create' | 'modify' | 'delete';
  timestamp: number | null;
  content_size: number;
}

interface ArtifactsTabProps {
  sessionId: string;
  agentId: string;
  paneId: string;
}

type ArtifactFilter = 'all' | 'write' | 'edit';

function detectLang(filePath: string): string {
  const ext = filePath.split('.').pop()?.toLowerCase() || '';
  const map: Record<string, string> = {
    ts: 'typescript', tsx: 'tsx', js: 'javascript', jsx: 'jsx',
    py: 'python', rb: 'ruby', rs: 'rust', go: 'go', java: 'java',
    c: 'c', cpp: 'cpp', cs: 'csharp', php: 'php', swift: 'swift',
    css: 'css', scss: 'scss', html: 'html', xml: 'xml',
    json: 'json', yaml: 'yaml', yml: 'yaml', toml: 'toml',
    md: 'markdown', mdx: 'markdown', sh: 'bash', bash: 'bash',
    sql: 'sql', graphql: 'graphql', dockerfile: 'dockerfile',
    txt: 'text', env: 'bash', gitignore: 'text',
  };
  return map[ext] || ext || 'text';
}

export function ArtifactsTab({ sessionId, agentId, paneId }: ArtifactsTabProps) {
  const [artifacts, setArtifacts] = useState<ArtifactRow[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [filter, setFilter] = useState<ArtifactFilter>('all');
  const [expandedId, setExpandedId] = useState<string | null>(null);

  useEffect(() => {
    setIsLoading(true);
    setExpandedId(null);
    fetch(`/api/v2/sessions/${sessionId}/agents/${agentId}/artifacts`)
      .then(r => r.json())
      .then(d => setArtifacts(d.artifacts ?? []))
      .catch(() => setArtifacts([]))
      .finally(() => setIsLoading(false));
  }, [sessionId, agentId]);

  const filtered = useMemo(() => {
    if (filter === 'write') return artifacts.filter(a => a.type === 'create');
    if (filter === 'edit') return artifacts.filter(a => a.type === 'modify' || a.type === 'delete');
    return artifacts;
  }, [artifacts, filter]);

  const writeCount = artifacts.filter(a => a.type === 'create').length;
  const editCount = artifacts.length - writeCount;

  const toggleExpand = (id: string) => setExpandedId(prev => prev === id ? null : id);

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-full">
        <Loader2 className="h-5 w-5 animate-spin text-[var(--aw-text-3)]" />
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full">
      <div className="flex items-center gap-1 px-3 py-1.5 border-b border-[var(--aw-bg-2)] shrink-0 bg-[var(--aw-bg-0)]">
        <Filter className="h-3 w-3 text-[var(--aw-text-4)] mr-0.5" />
        {(['all', 'write', 'edit'] as ArtifactFilter[]).map(f => (
          <button
            key={f}
            onClick={() => setFilter(f)}
            className={cn(
              'text-[11px] px-2 py-0.5 rounded transition-colors',
              filter === f ? 'bg-[var(--aw-bg-2)] text-[var(--aw-text-0)]' : 'text-[var(--aw-text-3)] hover:text-[var(--aw-text-1)]'
            )}
          >
            {f === 'all'
              ? `All (${artifacts.length})`
              : f === 'write'
              ? `Created (${writeCount})`
              : `Modified (${editCount})`}
          </button>
        ))}
      </div>

      <ScrollArea className="flex-1">
        <div className="p-3 space-y-1.5">
          {filtered.length === 0 && (
            <div className="text-sm text-[var(--aw-text-3)] text-center py-8">
              {filter === 'all' ? 'No files produced' : filter === 'write' ? 'No files created' : 'No files modified'}
            </div>
          )}

          {filtered.map(a => {
            const isExpanded = expandedId === a.id;
            const isCreate = a.type === 'create';
            const isNotebook = a.tool_name === 'NotebookEdit';
            const parts = a.file_path.replace(/\\/g, '/').split('/');
            const fileName = parts.pop() || a.file_path;
            const dirPath = parts.join('/');

            return (
              <div key={a.id} className="rounded border border-[var(--aw-bg-2)] overflow-hidden">
                {/* Row header */}
                <div
                  className="flex items-center gap-2.5 p-2.5 bg-[var(--aw-bg-1)] hover:bg-[var(--aw-bg-5)] transition-colors cursor-pointer"
                  onClick={() => toggleExpand(a.id)}
                >
                  <div className={cn('p-1.5 rounded shrink-0',
                    isCreate ? 'bg-green-900/30' : isNotebook ? 'bg-purple-900/30' : 'bg-orange-900/30'
                  )}>
                    {isCreate
                      ? <Plus className="h-3.5 w-3.5 text-green-400" />
                      : isNotebook
                      ? <NotebookPen className="h-3.5 w-3.5 text-purple-400" />
                      : <Pencil className="h-3.5 w-3.5 text-orange-400" />}
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="text-xs font-mono font-medium text-[var(--aw-text-0)] truncate">{fileName}</div>
                    {dirPath && <div className="text-[11px] font-mono text-[var(--aw-text-3)] truncate">{dirPath}</div>}
                  </div>
                  <div className="flex items-center gap-1.5 shrink-0">
                    {a.content_size > 0 && (
                      <span className="text-[10px] text-[var(--aw-text-4)]">
                        {a.content_size > 1024 ? `${Math.round(a.content_size / 1024)}KB` : `${a.content_size}B`}
                      </span>
                    )}
                    <span className={cn(
                      'text-[10px] px-1.5 py-0.5 rounded font-medium',
                      isCreate ? 'bg-green-900/30 text-green-400' : 'bg-orange-900/30 text-orange-400'
                    )}>
                      {isCreate ? 'Created' : 'Modified'}
                    </span>
                    {isExpanded
                      ? <ChevronDown className="h-3.5 w-3.5 text-[var(--aw-text-3)]" />
                      : <ChevronRight className="h-3.5 w-3.5 text-[var(--aw-text-3)]" />}
                  </div>
                </div>

                {/* Inline file viewer */}
                {isExpanded && (
                  <FileViewer
                    sessionId={sessionId}
                    paneId={paneId}
                    filePath={a.file_path}
                    lang={detectLang(a.file_path)}
                  />
                )}
              </div>
            );
          })}
        </div>
      </ScrollArea>
    </div>
  );
}

// ─── Inline File Viewer ────────────────────────────────────────────────────────

interface FileViewerState {
  content: string | null;
  error: string | null;
  loading: boolean;
}

function FileViewer({ sessionId, paneId, filePath, lang }: { sessionId: string; paneId: string; filePath: string; lang: string }) {
  const [state, setState] = useState<FileViewerState>({ content: null, error: null, loading: true });
  const [copied, setCopied] = useState(false);
  const isMarkdown = lang === 'markdown';
  const [viewMode, setViewMode] = useState<'rendered' | 'source'>(isMarkdown ? 'rendered' : 'source');
  const { addTabToPane, setFocusedPane } = useWorkspaceStore();

  useEffect(() => {
    setState({ content: null, error: null, loading: true });
    fetch(`/api/v2/sessions/${sessionId}/file?path=${encodeURIComponent(filePath)}`)
      .then(async r => {
        const d = await r.json();
        if (!r.ok) setState({ content: null, error: d.error || `HTTP ${r.status}`, loading: false });
        else setState({ content: d.content, error: null, loading: false });
      })
      .catch(e => setState({ content: null, error: String(e), loading: false }));
  }, [sessionId, filePath]);

  const copy = () => {
    if (!state.content) return;
    navigator.clipboard.writeText(state.content).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    });
  };

  const fileName = filePath.split(/[/\\]/).pop() || filePath;

  const openAsTab = () => {
    if (!state.content) return;
    const artifactId = `file:${sessionId}:${filePath}`;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const w = window as any;
    w.__artifactCache = w.__artifactCache || {};
    w.__artifactCache[artifactId] = { filePath, content: state.content, lang };
    addTabToPane(paneId, { type: 'artifact-content' as const, artifactId, label: fileName });
    setFocusedPane(paneId);
  };

  if (state.loading) {
    return (
      <div className="flex items-center justify-center py-6 bg-[var(--aw-bg-4)] border-t border-[var(--aw-bg-2)]">
        <Loader2 className="h-4 w-4 animate-spin text-[var(--aw-text-3)]" />
      </div>
    );
  }

  if (state.error) {
    return (
      <div className="px-4 py-3 bg-[var(--aw-bg-4)] border-t border-[var(--aw-bg-2)] text-[11px] text-[var(--aw-text-3)]">
        {state.error === 'File not found' ? 'File no longer exists on disk' : state.error}
      </div>
    );
  }

  const lines = (state.content ?? '').split('\n');

  return (
    <div className="border-t border-[var(--aw-bg-2)] bg-[var(--aw-bg-4)]">
      {/* Viewer toolbar */}
      <div className="flex items-center gap-1 px-3 py-1 border-b border-[var(--aw-bg-2)] bg-[var(--aw-bg-0)]">
        <span className="text-[10px] font-mono text-[var(--aw-text-4)] flex-1 truncate min-w-0">
          {lines.length} lines · {lang}
        </span>
        {isMarkdown && (
          <div className="flex rounded border border-[var(--aw-bg-3)] overflow-hidden shrink-0">
            <button
              type="button"
              onClick={() => setViewMode('rendered')}
              title="Preview"
              className={cn(
                'flex items-center justify-center p-1 transition-colors',
                viewMode === 'rendered' ? 'bg-[var(--aw-bg-2)] text-[var(--aw-text-0)]' : 'text-[var(--aw-text-2)] hover:text-[var(--aw-text-0)]'
              )}
            >
              <Eye className="h-3 w-3" />
            </button>
            <button
              type="button"
              onClick={() => setViewMode('source')}
              title="Source"
              className={cn(
                'flex items-center justify-center p-1 border-l border-[var(--aw-bg-3)] transition-colors',
                viewMode === 'source' ? 'bg-[var(--aw-bg-2)] text-[var(--aw-text-0)]' : 'text-[var(--aw-text-2)] hover:text-[var(--aw-text-0)]'
              )}
            >
              <Code className="h-3 w-3" />
            </button>
          </div>
        )}
        <button
          type="button"
          onClick={copy}
          title={copied ? 'Copied' : 'Copy'}
          className="p-1 rounded text-[var(--aw-text-3)] hover:text-[var(--aw-text-1)] hover:bg-[var(--aw-bg-2)] transition-colors shrink-0"
        >
          {copied ? <Check className="h-3 w-3 text-[var(--aw-green)]" /> : <Copy className="h-3 w-3" />}
        </button>
        <button
          type="button"
          onClick={openAsTab}
          title="Open as tab"
          className="p-1 rounded text-[var(--aw-text-3)] hover:text-[var(--aw-text-1)] hover:bg-[var(--aw-bg-2)] transition-colors shrink-0"
        >
          <ExternalLink className="h-3 w-3" />
        </button>
      </div>

      {isMarkdown && viewMode === 'rendered' ? (
        <div className="max-h-80 overflow-auto">
          <InlineMarkdown content={state.content ?? ''} />
        </div>
      ) : (
        /* Code lines — capped at 300 lines to avoid huge renders */
        <div className="flex text-[12px] font-mono leading-5 max-h-80 overflow-auto min-w-0">
          <div className="select-none text-right border-r border-[var(--aw-bg-2)] sticky left-0 bg-[var(--aw-bg-4)] shrink-0"
            style={{ minWidth: '40px', padding: '10px 8px' }}>
            {lines.slice(0, 300).map((_, i) => (
              <div key={i} className="text-[var(--aw-text-4)] leading-5">{i + 1}</div>
            ))}
            {lines.length > 300 && <div className="text-[var(--aw-text-4)] leading-5">…</div>}
          </div>
          <pre className="flex-1 min-w-0 p-2.5 text-[var(--aw-text-1)] whitespace-pre-wrap break-words leading-5">
            {lines.slice(0, 300).join('\n')}
            {lines.length > 300 && `\n… (${lines.length - 300} more lines)`}
          </pre>
        </div>
      )}
    </div>
  );
}
