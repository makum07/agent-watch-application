'use client';

import { useState, useEffect, useMemo } from 'react';
import { ScrollArea } from '@/components/ui/scroll-area';
import {
  Loader2, Search, X, ChevronRight, ChevronDown,
  Plus, Pencil, NotebookPen, Folder, FolderOpen,
  Files, Maximize2, Minimize2, Copy, Check,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { useWorkspaceStore } from '@/store/workspace-store';
import { useSessionStore } from '@/store/session-store';
import { getAgentDisplay } from '@/lib/agent-display';

interface ArtifactRow {
  id: string;
  file_path: string;
  tool_name: string;
  type: string;
  timestamp: number | null;
  content_size: number;
  agent_id: string;
  content_preview: string | null;
}

interface FileEntry {
  filePath: string;
  fileName: string;
  dirPath: string;
  isCreate: boolean;
  agentIds: string[];
  operationCount: number;
  latestTimestamp: number | null;
  contentSize: number;
  isNotebook: boolean;
  contentPreview: string | null;
}

type FilterMode = 'all' | 'created' | 'modified';

function detectLang(filePath: string): string {
  const ext = filePath.split('.').pop()?.toLowerCase() || '';
  const map: Record<string, string> = {
    ts: 'typescript', tsx: 'tsx', js: 'javascript', jsx: 'jsx',
    py: 'python', rb: 'ruby', rs: 'rust', go: 'go', java: 'java',
    c: 'c', cpp: 'cpp', cs: 'csharp', php: 'php', swift: 'swift',
    css: 'css', scss: 'scss', html: 'html', xml: 'xml',
    json: 'json', yaml: 'yaml', yml: 'yaml', toml: 'toml',
    md: 'markdown', mdx: 'markdown', sh: 'bash', bash: 'bash',
    sql: 'sql', graphql: 'graphql',
    txt: 'text', env: 'bash', gitignore: 'text',
  };
  return map[ext] || ext || 'text';
}

interface SessionArtifactsPaneProps {
  sessionId: string;
  paneId: string;
  isSingleTab?: boolean;
}

export function SessionArtifactsPane({ sessionId, paneId, isSingleTab }: SessionArtifactsPaneProps) {
  const { closePane, maximizePane, restorePane, maximizedPaneId, refreshToken } = useWorkspaceStore();
  const { agentMap } = useSessionStore();
  const isMaximized = maximizedPaneId === paneId;

  const [artifacts, setArtifacts] = useState<ArtifactRow[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [filter, setFilter] = useState<FilterMode>('all');
  const [search, setSearch] = useState('');
  const [expandedPath, setExpandedPath] = useState<string | null>(null);
  const [collapsedDirs, setCollapsedDirs] = useState<Set<string>>(new Set());

  useEffect(() => {
    setIsLoading(true);
    fetch(`/api/v2/sessions/${sessionId}/artifacts`)
      .then(r => r.json())
      .then(d => setArtifacts(d.artifacts ?? []))
      .catch(() => setArtifacts([]))
      .finally(() => setIsLoading(false));
  }, [sessionId, refreshToken]);

  // Deduplicate by file path, merging operations per file
  const fileEntries = useMemo((): FileEntry[] => {
    const map = new Map<string, FileEntry>();
    for (const a of artifacts) {
      const existing = map.get(a.file_path);
      if (existing) {
        if (!existing.agentIds.includes(a.agent_id)) existing.agentIds.push(a.agent_id);
        existing.operationCount++;
        if (a.timestamp && (!existing.latestTimestamp || a.timestamp > existing.latestTimestamp)) {
          existing.latestTimestamp = a.timestamp;
          existing.contentSize = a.content_size;
          if (a.content_preview) existing.contentPreview = a.content_preview;
        }
        if (a.tool_name === 'NotebookEdit') existing.isNotebook = true;
      } else {
        const parts = a.file_path.replace(/\\/g, '/').split('/');
        const fileName = parts.pop() || a.file_path;
        const dirPath = parts.join('/');
        map.set(a.file_path, {
          filePath: a.file_path,
          fileName,
          dirPath,
          isCreate: a.type === 'create',
          agentIds: [a.agent_id],
          operationCount: 1,
          latestTimestamp: a.timestamp,
          contentSize: a.content_size,
          isNotebook: a.tool_name === 'NotebookEdit',
          contentPreview: a.content_preview ?? null,
        });
      }
    }
    return Array.from(map.values()).sort((a, b) => a.filePath.localeCompare(b.filePath));
  }, [artifacts]);

  const filtered = useMemo(() => {
    let entries = fileEntries;
    if (filter === 'created') entries = entries.filter(e => e.isCreate);
    if (filter === 'modified') entries = entries.filter(e => !e.isCreate);
    if (search.trim()) {
      const q = search.toLowerCase();
      entries = entries.filter(e =>
        e.filePath.toLowerCase().includes(q) ||
        e.agentIds.some(id => {
          const agent = agentMap.get(id);
          if (!agent) return false;
          const { name } = getAgentDisplay(agent);
          return name.toLowerCase().includes(q);
        })
      );
    }
    return entries;
  }, [fileEntries, filter, search, agentMap]);

  // Group by directory
  const groups = useMemo(() => {
    const map = new Map<string, FileEntry[]>();
    for (const entry of filtered) {
      const dir = entry.dirPath || '(root)';
      if (!map.has(dir)) map.set(dir, []);
      map.get(dir)!.push(entry);
    }
    return Array.from(map.entries()).sort(([a], [b]) => a.localeCompare(b));
  }, [filtered]);

  const toggleDir = (dir: string) => {
    setCollapsedDirs(prev => {
      const next = new Set(prev);
      if (next.has(dir)) next.delete(dir);
      else next.add(dir);
      return next;
    });
  };

  const createdCount = fileEntries.filter(e => e.isCreate).length;
  const modifiedCount = fileEntries.length - createdCount;

  return (
    <div className="flex flex-col h-full overflow-hidden bg-[var(--aw-bg-0)]">
      {/* Header — shown when single tab (matches agent-view header style) */}
      {isSingleTab && (
        <div className="shrink-0 border-b border-[var(--aw-bg-2)]">
          <div className="flex items-center gap-2.5 px-3 py-2 bg-[var(--aw-bg-1)]">
            <Files className="h-4 w-4 text-[var(--aw-blue)] shrink-0" />
            <span className="text-sm font-bold text-[var(--aw-text-0)] flex-1">Session Files</span>
            {!isLoading && (
              <span className="text-[11px] text-[var(--aw-text-3)]">{fileEntries.length} files</span>
            )}
            <div className="flex items-center gap-0.5 shrink-0">
              <button
                onClick={() => isMaximized ? restorePane() : maximizePane(paneId)}
                className="p-1.5 rounded text-[var(--aw-text-1)] hover:text-[var(--aw-text-0)] hover:bg-[var(--aw-bg-2)] transition-colors"
                title={isMaximized ? 'Restore pane' : 'Maximize pane'}
              >
                {isMaximized ? <Minimize2 className="h-3.5 w-3.5" /> : <Maximize2 className="h-3.5 w-3.5" />}
              </button>
              <button
                onClick={() => { restorePane(); closePane(paneId); }}
                className="p-1.5 rounded text-[var(--aw-text-1)] hover:text-[var(--aw-text-0)] hover:bg-[var(--aw-bg-2)] transition-colors"
                title="Close pane"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Filter bar */}
      <div className="flex items-center gap-1 px-3 py-1.5 border-b border-[var(--aw-bg-2)] shrink-0 bg-[var(--aw-bg-0)] flex-wrap gap-y-1">
        {/* Search */}
        <div className="flex items-center gap-1 flex-1 min-w-[120px]">
          <Search className="h-3 w-3 text-[var(--aw-text-4)] shrink-0" />
          <input
            type="text"
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Search files…"
            className="flex-1 text-[11px] bg-transparent text-[var(--aw-text-0)] placeholder-[var(--aw-text-4)] outline-none min-w-0"
          />
          {search && (
            <button onClick={() => setSearch('')} className="text-[var(--aw-text-3)] hover:text-[var(--aw-text-1)]">
              <X className="h-3 w-3" />
            </button>
          )}
        </div>
        {/* Type filter */}
        <div className="flex items-center gap-0.5">
          {(['all', 'created', 'modified'] as FilterMode[]).map(f => (
            <button
              key={f}
              onClick={() => setFilter(f)}
              className={cn(
                'text-[10px] px-2 py-0.5 rounded transition-colors',
                filter === f ? 'bg-[var(--aw-bg-2)] text-[var(--aw-text-0)]' : 'text-[var(--aw-text-3)] hover:text-[var(--aw-text-1)]'
              )}
            >
              {f === 'all'
                ? `All (${fileEntries.length})`
                : f === 'created'
                ? `New (${createdCount})`
                : `Edited (${modifiedCount})`}
            </button>
          ))}
        </div>
      </div>

      {/* Content */}
      {isLoading ? (
        <div className="flex items-center justify-center flex-1">
          <Loader2 className="h-5 w-5 animate-spin text-[var(--aw-text-3)]" />
        </div>
      ) : filtered.length === 0 ? (
        <div className="flex items-center justify-center flex-1 text-sm text-[var(--aw-text-3)]">
          {search || filter !== 'all' ? 'No matching files' : 'No files produced in this session'}
        </div>
      ) : (
        <ScrollArea className="flex-1">
          <div className="p-2">
            {groups.map(([dir, entries]) => {
              const isCollapsed = collapsedDirs.has(dir);
              return (
                <div key={dir} className="mb-1">
                  {/* Directory header */}
                  <button
                    onClick={() => toggleDir(dir)}
                    className="w-full flex items-center gap-1.5 px-2 py-1 rounded hover:bg-[var(--aw-bg-1)] transition-colors text-left"
                  >
                    {isCollapsed
                      ? <FolderOpen className="h-3.5 w-3.5 text-[var(--aw-orange)] shrink-0" />
                      : <Folder className="h-3.5 w-3.5 text-[var(--aw-orange)] shrink-0" />}
                    <span className="text-[11px] font-mono text-[var(--aw-text-2)] flex-1 truncate">{dir}</span>
                    <span className="text-[10px] text-[var(--aw-text-4)] shrink-0">{entries.length}</span>
                    {isCollapsed
                      ? <ChevronRight className="h-3 w-3 text-[var(--aw-text-4)] shrink-0" />
                      : <ChevronDown className="h-3 w-3 text-[var(--aw-text-4)] shrink-0" />}
                  </button>

                  {/* Files in directory */}
                  {!isCollapsed && (
                    <div className="ml-2 space-y-0.5">
                      {entries.map(entry => (
                        <FileRow
                          key={entry.filePath}
                          entry={entry}
                          sessionId={sessionId}
                          agentMap={agentMap}
                          isExpanded={expandedPath === entry.filePath}
                          onToggle={() => setExpandedPath(prev => prev === entry.filePath ? null : entry.filePath)}
                        />
                      ))}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </ScrollArea>
      )}
    </div>
  );
}

// ─── File Row ─────────────────────────────────────────────────────────────────

function FileRow({
  entry, sessionId, agentMap, isExpanded, onToggle,
}: {
  entry: FileEntry;
  sessionId: string;
  agentMap: Map<string, import('@/types/session').Agent>;
  isExpanded: boolean;
  onToggle: () => void;
}) {
  return (
    <div className="rounded border border-[var(--aw-bg-2)] overflow-hidden">
      {/* Row header */}
      <div
        className="flex items-center gap-2 px-2.5 py-2 bg-[var(--aw-bg-1)] hover:bg-[var(--aw-bg-5)] transition-colors cursor-pointer"
        onClick={onToggle}
      >
        {/* Type icon */}
        <div className={cn('p-1 rounded shrink-0',
          entry.isCreate ? 'bg-green-900/30' : entry.isNotebook ? 'bg-purple-900/30' : 'bg-orange-900/30'
        )}>
          {entry.isCreate
            ? <Plus className="h-3 w-3 text-green-400" />
            : entry.isNotebook
            ? <NotebookPen className="h-3 w-3 text-purple-400" />
            : <Pencil className="h-3 w-3 text-orange-400" />}
        </div>

        {/* Filename */}
        <span className="text-[11px] font-mono font-medium text-[var(--aw-text-0)] flex-1 truncate min-w-0">
          {entry.fileName}
        </span>

        {/* Metadata */}
        <div className="flex items-center gap-1.5 shrink-0">
          {/* Agent badges */}
          {entry.agentIds.slice(0, 3).map(id => {
            const agent = agentMap.get(id);
            if (!agent) return null;
            const { initials, color } = getAgentDisplay(agent);
            return (
              <div
                key={id}
                className="w-4 h-4 rounded text-[8px] font-bold flex items-center justify-center border shrink-0"
                style={{ backgroundColor: color.bg, color: color.text, borderColor: color.border }}
                title={`Agent: ${initials}`}
              >
                {initials.slice(0, 2)}
              </div>
            );
          })}
          {entry.agentIds.length > 3 && (
            <span className="text-[9px] text-[var(--aw-text-4)]">+{entry.agentIds.length - 3}</span>
          )}

          {/* Operation count */}
          {entry.operationCount > 1 && (
            <span className="text-[9px] text-[var(--aw-text-4)] font-mono">{entry.operationCount}×</span>
          )}

          {/* Size */}
          {entry.contentSize > 0 && (
            <span className="text-[10px] text-[var(--aw-text-4)]">
              {entry.contentSize > 1024 ? `${Math.round(entry.contentSize / 1024)}KB` : `${entry.contentSize}B`}
            </span>
          )}

          {/* Type badge */}
          <span className={cn(
            'text-[9px] px-1 py-0.5 rounded font-medium',
            entry.isCreate ? 'bg-green-900/30 text-green-400' : 'bg-orange-900/30 text-orange-400'
          )}>
            {entry.isCreate ? 'New' : 'Edited'}
          </span>

          {isExpanded
            ? <ChevronDown className="h-3 w-3 text-[var(--aw-text-3)]" />
            : <ChevronRight className="h-3 w-3 text-[var(--aw-text-3)]" />}
        </div>
      </div>

      {/* Inline file viewer */}
      {isExpanded && (
        <FileViewer sessionId={sessionId} filePath={entry.filePath} lang={detectLang(entry.filePath)} contentPreview={entry.contentPreview} />
      )}
    </div>
  );
}

// ─── Inline File Viewer ────────────────────────────────────────────────────────

function FileViewer({ sessionId, filePath, lang, contentPreview }: { sessionId: string; filePath: string; lang: string; contentPreview: string | null }) {
  const [content, setContent] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [copied, setCopied] = useState(false);
  const [isPreviewOnly, setIsPreviewOnly] = useState(false);

  useEffect(() => {
    setLoading(true);
    setContent(null);
    setError(null);
    setIsPreviewOnly(false);
    fetch(`/api/v2/sessions/${sessionId}/file?path=${encodeURIComponent(filePath)}`)
      .then(async r => {
        const d = await r.json();
        if (!r.ok) {
          // Fall back to stored content preview from JSONL
          if (contentPreview) {
            setContent(contentPreview);
            setIsPreviewOnly(true);
          } else {
            setError(d.error || `HTTP ${r.status}`);
          }
        } else {
          setContent(d.content);
        }
      })
      .catch(() => {
        if (contentPreview) { setContent(contentPreview); setIsPreviewOnly(true); }
        else setError('Could not load file');
      })
      .finally(() => setLoading(false));
  }, [sessionId, filePath, contentPreview]);

  const copy = () => {
    if (!content) return;
    navigator.clipboard.writeText(content).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    });
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-5 bg-[var(--aw-bg-4)] border-t border-[var(--aw-bg-2)]">
        <Loader2 className="h-4 w-4 animate-spin text-[var(--aw-text-3)]" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="px-4 py-3 bg-[var(--aw-bg-4)] border-t border-[var(--aw-bg-2)] text-[11px] text-[var(--aw-text-3)]">
        {error === 'File not found' ? 'File no longer exists on disk' : error}
      </div>
    );
  }

  const lines = (content ?? '').split('\n');

  return (
    <div className="border-t border-[var(--aw-bg-2)] bg-[var(--aw-bg-4)]">
      <div className="flex items-center gap-2 px-3 py-1 border-b border-[var(--aw-bg-2)] bg-[var(--aw-bg-0)]">
        <span className="text-[10px] font-mono text-[var(--aw-text-4)] flex-1">
          {lines.length} lines · {lang}
        </span>
        <button
          onClick={copy}
          className="flex items-center gap-1 text-[10px] text-[var(--aw-text-3)] hover:text-[var(--aw-text-1)] transition-colors"
        >
          {copied ? <Check className="h-3 w-3 text-[var(--aw-green)]" /> : <Copy className="h-3 w-3" />}
          {copied ? 'Copied' : 'Copy'}
        </button>
      </div>
      <div className="flex text-[11px] font-mono leading-5 max-h-[320px] overflow-auto">
        <div
          className="select-none text-right border-r border-[var(--aw-bg-2)] sticky left-0 bg-[var(--aw-bg-4)] shrink-0"
          style={{ minWidth: '38px', padding: '8px 6px' }}
        >
          {lines.slice(0, 300).map((_, i) => (
            <div key={i} className="text-[var(--aw-text-4)] leading-5">{i + 1}</div>
          ))}
          {lines.length > 300 && <div className="text-[var(--aw-text-4)] leading-5">…</div>}
        </div>
        <pre className="flex-1 p-2 text-[var(--aw-text-1)] whitespace-pre overflow-x-auto leading-5">
          {lines.slice(0, 300).join('\n')}
          {lines.length > 300 && `\n… (${lines.length - 300} more lines)`}
        </pre>
      </div>
    </div>
  );
}
