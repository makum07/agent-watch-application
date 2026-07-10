'use client';

import { useState, useEffect } from 'react';
import { Copy, Check, FileText, Code, Eye, ChevronDown } from 'lucide-react';
import { ScrollArea } from '@/components/ui/scroll-area';
import { cn } from '@/lib/utils';

interface ArtifactData {
  filePath: string;
  content: string;
  lang: string;
}

interface ArtifactPaneViewProps {
  artifactId: string;
}

function getFileEmoji(lang: string, filePath: string): string {
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

export function ArtifactPaneView({ artifactId }: ArtifactPaneViewProps) {
  const [data, setData] = useState<ArtifactData | null>(null);
  const [viewMode, setViewMode] = useState<'rendered' | 'source'>('rendered');
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (typeof window !== 'undefined') {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const cache = (window as any).__artifactCache as Record<string, ArtifactData> | undefined;
      if (cache?.[artifactId]) setData(cache[artifactId]);
    }
  }, [artifactId]);

  if (!data) {
    return (
      <div className="flex items-center justify-center h-full bg-[var(--aw-bg-0)]">
        <div className="text-center text-[var(--aw-text-4)]">
          <FileText className="h-10 w-10 mx-auto mb-3 opacity-20" />
          <p className="text-sm">Open an artifact from the conversation</p>
          <p className="text-xs mt-1">Click the ↗ button on any Write/Edit tool card</p>
        </div>
      </div>
    );
  }

  const fileName = data.filePath.split(/[/\\]/).pop() || data.filePath;
  const lines = data.content.split('\n');
  const isMarkdown = data.lang === 'markdown';
  const canRender = isMarkdown;

  const copy = () => {
    navigator.clipboard.writeText(data.content).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    });
  };

  return (
    <div className="flex flex-col h-full bg-[var(--aw-bg-4)]">
      {/* Document toolbar */}
      <div className="flex items-center gap-3 px-4 py-2.5 border-b border-[var(--aw-bg-2)] bg-[var(--aw-bg-0)] shrink-0">
        <span className="text-lg leading-none">{getFileEmoji(data.lang, data.filePath)}</span>
        <div className="flex-1 min-w-0">
          <div className="text-sm font-semibold text-[var(--aw-text-0)] truncate">{fileName}</div>
          <div className="text-[10px] text-[var(--aw-text-4)] font-mono truncate mt-0.5">{data.filePath}</div>
        </div>

        {/* Metadata chips */}
        <div className="flex items-center gap-2 shrink-0">
          <span className="text-[11px] text-[var(--aw-text-2)] bg-[var(--aw-bg-2)] px-2 py-0.5 rounded font-mono">
            {data.lang}
          </span>
          <span className="text-[11px] text-[var(--aw-text-2)]">
            {lines.length} lines
          </span>
        </div>

        {/* View toggle for markdown */}
        {canRender && (
          <div className="flex rounded border border-[var(--aw-bg-3)] overflow-hidden shrink-0">
            <button
              onClick={() => setViewMode('rendered')}
              className={cn(
                'flex items-center gap-1.5 px-2.5 py-1 text-[11px] transition-colors',
                viewMode === 'rendered'
                  ? 'bg-[var(--aw-bg-2)] text-[var(--aw-text-0)]'
                  : 'text-[var(--aw-text-2)] hover:text-[var(--aw-text-0)]'
              )}
            >
              <Eye className="h-3 w-3" />
              Preview
            </button>
            <button
              onClick={() => setViewMode('source')}
              className={cn(
                'flex items-center gap-1.5 px-2.5 py-1 text-[11px] border-l border-[var(--aw-bg-3)] transition-colors',
                viewMode === 'source'
                  ? 'bg-[var(--aw-bg-2)] text-[var(--aw-text-0)]'
                  : 'text-[var(--aw-text-2)] hover:text-[var(--aw-text-0)]'
              )}
            >
              <Code className="h-3 w-3" />
              Source
            </button>
          </div>
        )}

        {/* Copy */}
        <button
          onClick={copy}
          className="flex items-center gap-1.5 px-2.5 py-1 rounded border border-[var(--aw-bg-3)] text-[11px] text-[var(--aw-text-2)] hover:text-[var(--aw-text-0)] hover:border-[var(--aw-text-4)] transition-colors shrink-0"
        >
          {copied ? <Check className="h-3.5 w-3.5 text-[var(--aw-green)]" /> : <Copy className="h-3.5 w-3.5" />}
          {copied ? 'Copied!' : 'Copy'}
        </button>
      </div>

      {/* Document body */}
      <ScrollArea className="flex-1 bg-[var(--aw-bg-4)]">
        {isMarkdown && viewMode === 'rendered' ? (
          /* Markdown document view — centered paper */
          <div className="py-10 px-6">
            <div
              className="mx-auto rounded-lg border border-[var(--aw-bg-2)] bg-[var(--aw-bg-0)] shadow-2xl overflow-hidden"
              style={{ maxWidth: '780px' }}
            >
              <DocumentContent content={data.content} />
            </div>
          </div>
        ) : (
          /* Source / code view — full-width */
          <CodeContent lines={lines} lang={data.lang} />
        )}
      </ScrollArea>
    </div>
  );
}

// ─── Markdown Document Renderer ────────────────────────────────────────────────

function DocumentContent({ content }: { content: string }) {
  const sections = parseMarkdownSections(content);

  return (
    <article className="px-10 py-10 text-[15px] leading-7 text-[var(--aw-text-0)]">
      {sections.map((section, i) => renderSection(section, i))}
    </article>
  );
}

interface MarkdownSection {
  type: 'h1' | 'h2' | 'h3' | 'h4' | 'p' | 'ul' | 'ol' | 'code-block' | 'blockquote' | 'hr' | 'table';
  content: string;
  lang?: string;
  items?: string[];
  rows?: string[][];
  headers?: string[];
}

function parseMarkdownSections(md: string): MarkdownSection[] {
  const lines = md.split('\n');
  const sections: MarkdownSection[] = [];
  let i = 0;

  while (i < lines.length) {
    const line = lines[i];

    // Headings
    if (line.startsWith('# ')) { sections.push({ type: 'h1', content: line.slice(2) }); i++; continue; }
    if (line.startsWith('## ')) { sections.push({ type: 'h2', content: line.slice(3) }); i++; continue; }
    if (line.startsWith('### ')) { sections.push({ type: 'h3', content: line.slice(4) }); i++; continue; }
    if (line.startsWith('#### ')) { sections.push({ type: 'h4', content: line.slice(5) }); i++; continue; }

    // Horizontal rule
    if (/^(-{3,}|\*{3,}|_{3,})$/.test(line.trim())) { sections.push({ type: 'hr', content: '' }); i++; continue; }

    // Fenced code block
    if (line.startsWith('```')) {
      const lang = line.slice(3).trim();
      const codeLines: string[] = [];
      i++;
      while (i < lines.length && !lines[i].startsWith('```')) {
        codeLines.push(lines[i]);
        i++;
      }
      i++; // skip closing ```
      sections.push({ type: 'code-block', content: codeLines.join('\n'), lang });
      continue;
    }

    // Blockquote
    if (line.startsWith('> ')) {
      const quoteLines: string[] = [];
      while (i < lines.length && lines[i].startsWith('> ')) {
        quoteLines.push(lines[i].slice(2));
        i++;
      }
      sections.push({ type: 'blockquote', content: quoteLines.join('\n') });
      continue;
    }

    // Unordered list
    if (/^[-*+] /.test(line)) {
      const items: string[] = [];
      while (i < lines.length && /^[-*+] /.test(lines[i])) {
        items.push(lines[i].replace(/^[-*+] /, ''));
        i++;
      }
      sections.push({ type: 'ul', content: '', items });
      continue;
    }

    // Ordered list
    if (/^\d+\. /.test(line)) {
      const items: string[] = [];
      while (i < lines.length && /^\d+\. /.test(lines[i])) {
        items.push(lines[i].replace(/^\d+\. /, ''));
        i++;
      }
      sections.push({ type: 'ol', content: '', items });
      continue;
    }

    // Empty line — skip
    if (line.trim() === '') { i++; continue; }

    // Table
    if (line.includes('|') && i + 1 < lines.length && /^[\|\-\s:]+$/.test(lines[i + 1])) {
      const headers = line.split('|').filter(c => c.trim()).map(c => c.trim());
      i += 2; // skip header + separator
      const rows: string[][] = [];
      while (i < lines.length && lines[i].includes('|')) {
        rows.push(lines[i].split('|').filter(c => c.trim()).map(c => c.trim()));
        i++;
      }
      sections.push({ type: 'table', content: '', headers, rows });
      continue;
    }

    // Paragraph
    const paraLines: string[] = [];
    while (i < lines.length && lines[i].trim() !== '' && !lines[i].startsWith('#') && !lines[i].startsWith('```') && !lines[i].startsWith('> ') && !/^[-*+] /.test(lines[i]) && !/^\d+\. /.test(lines[i])) {
      paraLines.push(lines[i]);
      i++;
    }
    if (paraLines.length > 0) {
      sections.push({ type: 'p', content: paraLines.join(' ') });
    } else {
      i++;
    }
  }

  return sections;
}

function renderInline(text: string): React.ReactNode {
  // Handle bold, italic, code, links
  const parts: React.ReactNode[] = [];
  const regex = /(\*\*[^*]+\*\*|\*[^*]+\*|`[^`]+`|\[[^\]]+\]\([^)]+\))/g;
  let last = 0;
  let m: RegExpExecArray | null;

  while ((m = regex.exec(text)) !== null) {
    if (m.index > last) parts.push(text.slice(last, m.index));
    const t = m[0];
    if (t.startsWith('**')) parts.push(<strong key={m.index} className="font-semibold text-[var(--aw-text-0)]">{t.slice(2, -2)}</strong>);
    else if (t.startsWith('*')) parts.push(<em key={m.index} className="italic">{t.slice(1, -1)}</em>);
    else if (t.startsWith('`')) parts.push(<code key={m.index} className="font-mono text-[13px] px-1.5 py-0.5 rounded bg-[var(--aw-bg-1)] text-[var(--aw-orange)] border border-[var(--aw-bg-2)]">{t.slice(1, -1)}</code>);
    else if (t.startsWith('[')) {
      const label = t.match(/\[([^\]]+)\]/)?.[1] || '';
      const href = t.match(/\(([^)]+)\)/)?.[1] || '';
      parts.push(<a key={m.index} href={href} className="text-[var(--aw-blue)] hover:underline">{label}</a>);
    }
    last = m.index + t.length;
  }
  if (last < text.length) parts.push(text.slice(last));
  return parts.length === 1 ? parts[0] : <>{parts}</>;
}

function renderSection(s: MarkdownSection, key: number): React.ReactNode {
  switch (s.type) {
    case 'h1':
      return (
        <h1 key={key} className="text-[26px] font-bold text-[var(--aw-text-0)] mb-4 mt-0 pb-3 border-b border-[var(--aw-bg-2)]">
          {renderInline(s.content)}
        </h1>
      );
    case 'h2':
      return (
        <h2 key={key} className="text-[20px] font-semibold text-[var(--aw-text-0)] mt-8 mb-3 pb-2 border-b border-[var(--aw-bg-2)]">
          {renderInline(s.content)}
        </h2>
      );
    case 'h3':
      return <h3 key={key} className="text-[16px] font-semibold text-[var(--aw-text-0)] mt-6 mb-2">{renderInline(s.content)}</h3>;
    case 'h4':
      return <h4 key={key} className="text-[14px] font-semibold text-[var(--aw-text-1)] mt-4 mb-1">{renderInline(s.content)}</h4>;
    case 'p':
      return <p key={key} className="text-[var(--aw-text-1)] leading-7 mb-4">{renderInline(s.content)}</p>;
    case 'ul':
      return (
        <ul key={key} className="mb-4 space-y-1.5 pl-1">
          {(s.items || []).map((item, i) => (
            <li key={i} className="flex items-start gap-2.5 text-[var(--aw-text-1)]">
              <span className="mt-2.5 w-1.5 h-1.5 rounded-full bg-[var(--aw-text-4)] shrink-0" />
              <span>{renderInline(item)}</span>
            </li>
          ))}
        </ul>
      );
    case 'ol':
      return (
        <ol key={key} className="mb-4 space-y-1.5 pl-1">
          {(s.items || []).map((item, i) => (
            <li key={i} className="flex items-start gap-2.5 text-[var(--aw-text-1)]">
              <span className="text-[var(--aw-text-4)] font-mono text-sm shrink-0 mt-0.5">{i + 1}.</span>
              <span>{renderInline(item)}</span>
            </li>
          ))}
        </ol>
      );
    case 'code-block':
      return (
        <div key={key} className="mb-4 rounded-md overflow-hidden border border-[var(--aw-bg-3)]">
          {s.lang && (
            <div className="flex items-center justify-between px-4 py-1.5 bg-[var(--aw-bg-1)] border-b border-[var(--aw-bg-3)]">
              <span className="text-[11px] font-mono text-[var(--aw-text-2)]">{s.lang}</span>
            </div>
          )}
          <pre className="p-4 overflow-x-auto bg-[var(--aw-bg-1)] text-[13px] font-mono text-[var(--aw-text-1)] leading-5 whitespace-pre">
            {s.content}
          </pre>
        </div>
      );
    case 'blockquote':
      return (
        <blockquote key={key} className="mb-4 pl-4 border-l-4 border-[var(--aw-blue)]/40 text-[var(--aw-text-2)] italic">
          {renderInline(s.content)}
        </blockquote>
      );
    case 'hr':
      return <hr key={key} className="my-6 border-[var(--aw-bg-2)]" />;
    case 'table':
      return (
        <div key={key} className="mb-4 overflow-x-auto rounded-md border border-[var(--aw-bg-3)]">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-[var(--aw-bg-1)]">
                {(s.headers || []).map((h, i) => (
                  <th key={i} className="px-4 py-2 text-left text-[var(--aw-text-0)] font-semibold border-b border-[var(--aw-bg-3)]">
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {(s.rows || []).map((row, ri) => (
                <tr key={ri} className="border-b border-[var(--aw-bg-2)] hover:bg-[var(--aw-bg-1)]/50">
                  {row.map((cell, ci) => (
                    <td key={ci} className="px-4 py-2 text-[var(--aw-text-1)]">
                      {renderInline(cell)}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      );
    default:
      return null;
  }
}

// ─── Code / Source Viewer ──────────────────────────────────────────────────────

function CodeContent({ lines, lang }: { lines: string[]; lang: string }) {
  return (
    <div className="flex text-[13px] font-mono leading-5 min-h-full">
      {/* Line numbers gutter */}
      <div
        className="select-none text-right border-r border-[var(--aw-bg-2)] sticky left-0 z-10 bg-[var(--aw-bg-4)]"
        style={{ minWidth: '52px', padding: '16px 12px 16px 0' }}
      >
        {lines.map((_, i) => (
          <div key={i} className="text-[var(--aw-text-4)] leading-5 px-2">{i + 1}</div>
        ))}
      </div>
      {/* Code content */}
      <pre className="flex-1 p-4 text-[var(--aw-text-1)] whitespace-pre-wrap leading-5 break-words overflow-x-auto">
        {lines.join('\n')}
      </pre>
    </div>
  );
}
