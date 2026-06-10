'use client';

import { useState } from 'react';
import { ChevronRight, ChevronDown, ExternalLink, Copy, Check, Eye, Code } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useWorkspaceStore } from '@/store/workspace-store';

// Re-use the same rendering logic as the full pane view
// We import inline to keep the component self-contained
function getFileEmoji(lang: string): string {
  if (lang === 'markdown') return '📄';
  if (lang === 'typescript' || lang === 'tsx') return '📘';
  if (lang === 'javascript' || lang === 'jsx') return '📙';
  if (lang === 'python') return '🐍';
  if (lang === 'json') return '🔧';
  if (lang === 'css' || lang === 'scss') return '🎨';
  if (lang === 'html') return '🌐';
  if (lang === 'bash' || lang === 'sh') return '⚡';
  if (lang === 'sql') return '🗄️';
  return '📄';
}

function detectLanguage(filePath: string): string {
  const ext = filePath.split('.').pop()?.toLowerCase() || '';
  const map: Record<string, string> = {
    ts: 'typescript', tsx: 'tsx', js: 'javascript', jsx: 'jsx',
    py: 'python', rb: 'ruby', go: 'go', rs: 'rust',
    md: 'markdown', mdx: 'markdown', json: 'json', yaml: 'yaml', yml: 'yaml',
    toml: 'toml', css: 'css', scss: 'scss', html: 'html', xml: 'xml',
    sh: 'bash', bash: 'bash', sql: 'sql',
  };
  return map[ext] || 'plaintext';
}

interface ArtifactCardProps {
  toolId: string;
  operationType: 'create' | 'modify';
  filePath: string;
  content: string;
  paneId: string;
}

export function ArtifactCard({ toolId, operationType, filePath, content, paneId }: ArtifactCardProps) {
  const [expanded, setExpanded] = useState(false);
  const [viewMode, setViewMode] = useState<'rendered' | 'source'>('rendered');
  const [copied, setCopied] = useState(false);
  const { splitPane, addTabToPane, focusedPaneId, layout } = useWorkspaceStore();

  const fileName = filePath.split(/[/\\]/).pop() || filePath;
  const lang = detectLanguage(filePath);
  const lines = content.split('\n');
  const isMarkdown = lang === 'markdown';
  const isCreate = operationType === 'create';

  const openInPane = (e: React.MouseEvent) => {
    e.stopPropagation();
    const tab = { type: 'artifact-content' as const, artifactId: toolId, label: fileName };
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const w = window as any;
    w.__artifactCache = w.__artifactCache || {};
    w.__artifactCache[toolId] = { filePath, content, lang };

    if (focusedPaneId && layout && focusedPaneId !== paneId) {
      addTabToPane(focusedPaneId, tab);
    } else {
      splitPane(paneId, 'horizontal', tab);
    }
  };

  const copy = (e: React.MouseEvent) => {
    e.stopPropagation();
    navigator.clipboard.writeText(content).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    });
  };

  return (
    <div className={cn(
      'rounded-md border overflow-hidden',
      isCreate ? 'border-[#2d6b47]' : 'border-[#6b4a1a]'
    )}>
      {/* Header — matches ArtifactPaneView toolbar style */}
      <div
        className={cn(
          'flex items-center gap-2.5 px-3 py-2 cursor-pointer transition-colors',
          isCreate ? 'bg-[#0a1f12] hover:bg-[#0d2416]' : 'bg-[#1c1108] hover:bg-[#221409]'
        )}
        onClick={() => setExpanded(!expanded)}
      >
        {/* Operation badge */}
        <span className={cn(
          'text-[9px] font-bold px-1.5 py-0.5 rounded uppercase tracking-wider shrink-0 border',
          isCreate
            ? 'text-[#3fb950] bg-[#3fb950]/10 border-[#3fb950]/30'
            : 'text-[#f0883e] bg-[#f0883e]/10 border-[#f0883e]/30'
        )}>
          {isCreate ? '+ Create' : '✎ Edit'}
        </span>

        {/* File icon + name */}
        <span className="text-base leading-none shrink-0">{getFileEmoji(lang)}</span>
        <span className="text-sm font-semibold text-[#e6edf3] truncate flex-1">{fileName}</span>

        {/* Metadata */}
        <span className="text-[10px] text-[#8b949e] font-mono shrink-0">{lang}</span>
        <span className="text-[10px] text-[#484f58] shrink-0">{lines.length} lines</span>

        {/* Actions — only visible when hovered or expanded */}
        <div className="flex items-center gap-1 shrink-0" onClick={e => e.stopPropagation()}>
          <button
            onClick={copy}
            className="p-1 rounded text-[#484f58] hover:text-[#e6edf3] hover:bg-white/10 transition-colors"
            title="Copy content"
          >
            {copied ? <Check className="h-3 w-3 text-[#3fb950]" /> : <Copy className="h-3 w-3" />}
          </button>
          <button
            onClick={openInPane}
            className="p-1 rounded text-[#484f58] hover:text-[#e6edf3] hover:bg-white/10 transition-colors"
            title="Open in new pane"
          >
            <ExternalLink className="h-3 w-3" />
          </button>
        </div>

        {expanded
          ? <ChevronDown className="h-3.5 w-3.5 text-[#484f58] shrink-0" />
          : <ChevronRight className="h-3.5 w-3.5 text-[#484f58] shrink-0" />
        }
      </div>

      {/* Expanded content */}
      {expanded && (
        <div className="border-t" style={{ borderColor: isCreate ? '#2d6b47' : '#6b4a1a' }}>
          {/* Sub-toolbar: file path + view toggle */}
          <div className="flex items-center gap-2 px-3 py-1.5 bg-[#010409] border-b border-[#21262d]">
            <span className="text-[10px] font-mono text-[#484f58] truncate flex-1">{filePath}</span>
            {isMarkdown && (
              <div className="flex rounded border border-[#30363d] overflow-hidden shrink-0">
                <button
                  onClick={e => { e.stopPropagation(); setViewMode('rendered'); }}
                  className={cn(
                    'flex items-center gap-1 px-2 py-0.5 text-[10px] transition-colors',
                    viewMode === 'rendered' ? 'bg-[#21262d] text-[#e6edf3]' : 'text-[#8b949e] hover:text-[#e6edf3]'
                  )}
                >
                  <Eye className="h-2.5 w-2.5" />
                  Preview
                </button>
                <button
                  onClick={e => { e.stopPropagation(); setViewMode('source'); }}
                  className={cn(
                    'flex items-center gap-1 px-2 py-0.5 text-[10px] border-l border-[#30363d] transition-colors',
                    viewMode === 'source' ? 'bg-[#21262d] text-[#e6edf3]' : 'text-[#8b949e] hover:text-[#e6edf3]'
                  )}
                >
                  <Code className="h-2.5 w-2.5" />
                  Source
                </button>
              </div>
            )}
          </div>

          {/* Content */}
          <div className="max-h-80 overflow-auto bg-[#010409]">
            {isMarkdown && viewMode === 'rendered' ? (
              <InlineMarkdown content={content} />
            ) : (
              <InlineCode lines={lines} />
            )}
          </div>

          {lines.length > 30 && (
            <div className="px-3 py-2 text-center text-[10px] text-[#484f58] border-t border-[#21262d] bg-[#010409]">
              {lines.length} lines ·{' '}
              <button onClick={openInPane} className="text-[#58a6ff] hover:underline">
                Open in full pane to see all
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ─── Inline Markdown renderer (compact, matches document viewer style) ─────────

function InlineMarkdown({ content }: { content: string }) {
  const lines = content.split('\n');
  const elements: React.ReactNode[] = [];
  let i = 0;

  while (i < lines.length) {
    const line = lines[i];

    if (line.startsWith('# ')) {
      elements.push(<h1 key={i} className="text-[18px] font-bold text-[#e6edf3] mt-4 mb-3 pb-2 border-b border-[#21262d]">{renderInline(line.slice(2))}</h1>);
      i++; continue;
    }
    if (line.startsWith('## ')) {
      elements.push(<h2 key={i} className="text-[15px] font-semibold text-[#e6edf3] mt-4 mb-2 pb-1 border-b border-[#21262d]">{renderInline(line.slice(3))}</h2>);
      i++; continue;
    }
    if (line.startsWith('### ')) {
      elements.push(<h3 key={i} className="text-[13px] font-semibold text-[#e6edf3] mt-3 mb-1">{renderInline(line.slice(4))}</h3>);
      i++; continue;
    }
    if (line.startsWith('```')) {
      const codeStart = i;
      const codeLang = line.slice(3).trim();
      const codeLines: string[] = [];
      i++;
      while (i < lines.length && !lines[i].startsWith('```')) { codeLines.push(lines[i]); i++; }
      i++;
      elements.push(
        <div key={`code-${codeStart}`} className="my-2 rounded border border-[#30363d] overflow-hidden">
          {codeLang && <div className="px-3 py-1 bg-[#161b22] text-[10px] font-mono text-[#8b949e] border-b border-[#30363d]">{codeLang}</div>}
          <pre className="p-3 text-[12px] font-mono text-[#c9d1d9] overflow-x-auto bg-[#161b22] whitespace-pre-wrap">{codeLines.join('\n')}</pre>
        </div>
      );
      continue;
    }
    if (line.startsWith('> ')) {
      elements.push(<blockquote key={i} className="my-2 pl-3 border-l-2 border-[#58a6ff]/40 text-[#8b949e] italic text-[13px]">{renderInline(line.slice(2))}</blockquote>);
      i++; continue;
    }
    if (/^[-*+] /.test(line)) {
      const listStart = i;
      const items: string[] = [];
      while (i < lines.length && /^[-*+] /.test(lines[i])) { items.push(lines[i].replace(/^[-*+] /, '')); i++; }
      elements.push(
        <ul key={`ul-${listStart}`} className="my-2 space-y-1 pl-1">
          {items.map((item, j) => (
            <li key={j} className="flex items-start gap-2 text-[13px] text-[#c9d1d9] leading-5">
              <span className="mt-2 w-1 h-1 rounded-full bg-[#484f58] shrink-0" />
              <span>{renderInline(item)}</span>
            </li>
          ))}
        </ul>
      );
      continue;
    }
    if (/^\d+\. /.test(line)) {
      const listStart = i;
      const items: string[] = [];
      while (i < lines.length && /^\d+\. /.test(lines[i])) { items.push(lines[i].replace(/^\d+\. /, '')); i++; }
      elements.push(
        <ol key={`ol-${listStart}`} className="my-2 space-y-1 pl-1">
          {items.map((item, j) => (
            <li key={j} className="flex items-start gap-2 text-[13px] text-[#c9d1d9] leading-5">
              <span className="text-[#484f58] font-mono text-[11px] shrink-0 mt-0.5">{j + 1}.</span>
              <span>{renderInline(item)}</span>
            </li>
          ))}
        </ol>
      );
      continue;
    }
    if (/^(-{3,}|\*{3,})$/.test(line.trim())) {
      elements.push(<hr key={i} className="my-3 border-[#21262d]" />);
      i++; continue;
    }
    if (line.trim() === '') { elements.push(<div key={i} className="h-2" />); i++; continue; }

    elements.push(<p key={i} className="text-[13px] text-[#c9d1d9] leading-6 mb-2">{renderInline(line)}</p>);
    i++;
  }

  return <div className="px-5 py-4">{elements}</div>;
}

function renderInline(text: string): React.ReactNode {
  const parts: React.ReactNode[] = [];
  const regex = /(\*\*[^*]+\*\*|\*[^*]+\*|`[^`]+`)/g;
  let last = 0;
  let m: RegExpExecArray | null;
  while ((m = regex.exec(text)) !== null) {
    if (m.index > last) parts.push(text.slice(last, m.index));
    const t = m[0];
    if (t.startsWith('**')) parts.push(<strong key={m.index} className="font-semibold text-[#e6edf3]">{t.slice(2, -2)}</strong>);
    else if (t.startsWith('*')) parts.push(<em key={m.index} className="italic">{t.slice(1, -1)}</em>);
    else if (t.startsWith('`')) parts.push(<code key={m.index} className="text-[12px] font-mono px-1 py-0.5 rounded bg-[#161b22] text-[#f0883e] border border-[#30363d]">{t.slice(1, -1)}</code>);
    last = m.index + t.length;
  }
  if (last < text.length) parts.push(text.slice(last));
  return parts.length === 1 ? parts[0] : <>{parts}</>;
}

// ─── Inline Code viewer ──────────────────────────────────────────────────────

function InlineCode({ lines }: { lines: string[] }) {
  return (
    <div className="flex text-[12px] font-mono leading-5">
      <div className="select-none text-right px-3 py-3 text-[#484f58] border-r border-[#21262d] bg-black/30 shrink-0" style={{ minWidth: '40px' }}>
        {lines.map((_, i) => <div key={i}>{i + 1}</div>)}
      </div>
      <pre className="px-4 py-3 text-[#c9d1d9] flex-1 whitespace-pre-wrap break-words overflow-x-auto leading-5">
        {lines.join('\n')}
      </pre>
    </div>
  );
}
