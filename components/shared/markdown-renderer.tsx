'use client';

import { useState, useCallback, useMemo } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { visit } from 'unist-util-visit';
import { Copy, Check } from 'lucide-react';
import { cn } from '@/lib/utils';

interface MarkdownRendererProps {
  content: string;
  className?: string;
  size?: 'sm' | 'base';
  highlightTerms?: string[];
}

function makeHighlightPlugin(terms: string[]) {
  const lower = terms.filter(t => t.trim()).map(t => t.toLowerCase());
  if (!lower.length) return () => {};

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return () => (tree: any) => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    visit(tree, 'text', (node: any, index: number | null | undefined, parent: any) => {
      if (index == null || !parent) return;
      const text: string = node.value;
      const textLower = text.toLowerCase();
      if (!lower.some(t => textLower.includes(t))) return;

      const ranges: { start: number; end: number }[] = [];
      for (const term of lower) {
        let i = 0;
        while (i < textLower.length) {
          const pos = textLower.indexOf(term, i);
          if (pos === -1) break;
          ranges.push({ start: pos, end: pos + term.length });
          i = pos + term.length;
        }
      }
      ranges.sort((a, b) => a.start - b.start);

      const nodes: unknown[] = [];
      let cursor = 0;
      for (const { start, end } of ranges) {
        if (start < cursor) continue;
        if (start > cursor) nodes.push({ type: 'text', value: text.slice(cursor, start) });
        nodes.push({
          type: 'element', tagName: 'mark', properties: {},
          children: [{ type: 'text', value: text.slice(start, end) }],
        });
        cursor = end;
      }
      if (cursor < text.length) nodes.push({ type: 'text', value: text.slice(cursor) });

      if (nodes.length > 0) parent.children.splice(index, 1, ...nodes);
    });
  };
}

function CodeBlock({ lang, codeText, children }: { lang: string; codeText: string; children: React.ReactNode }) {
  const [copied, setCopied] = useState(false);

  const copy = useCallback(() => {
    navigator.clipboard.writeText(codeText).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  }, [codeText]);

  return (
    <div className="my-3 rounded-lg overflow-hidden border border-[var(--aw-bg-3)] bg-[var(--aw-bg-0)]">
      <div className="flex items-center justify-between px-3.5 py-2 bg-[var(--aw-bg-1)] border-b border-[var(--aw-bg-3)]">
        <span className="text-[11px] font-mono text-[var(--aw-text-3)]">
          {lang || 'code'}
        </span>
        <button
          onClick={copy}
          className="flex items-center gap-1.5 text-[11px] text-[var(--aw-text-3)] hover:text-[var(--aw-text-1)] transition-colors"
        >
          {copied ? (
            <>
              <Check className="h-3 w-3 text-[var(--aw-green)]" />
              <span className="text-[var(--aw-green)]">Copied</span>
            </>
          ) : (
            <>
              <Copy className="h-3 w-3" />
              <span>Copy</span>
            </>
          )}
        </button>
      </div>
      <pre className="overflow-x-auto px-4 py-3.5 text-[12.5px] leading-relaxed">
        {children}
      </pre>
    </div>
  );
}

export function MarkdownRenderer({ content, className, size = 'sm', highlightTerms }: MarkdownRendererProps) {
  const isBase = size === 'base';

  const rehypePlugins = useMemo(
    () => (highlightTerms?.length ? [makeHighlightPlugin(highlightTerms)] : []),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [highlightTerms?.join(',')]
  );
  const textSz  = isBase ? 'text-[14px]'  : 'text-[13px]';
  const textClr  = 'text-[var(--aw-text-1)]';
  const lineH   = isBase ? 'leading-[1.75]' : 'leading-relaxed';
  const mbPara  = isBase ? 'mb-3.5' : 'mb-2';

  return (
    <div className={cn('overflow-hidden min-w-0', textSz, textClr, lineH, className)}>
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        rehypePlugins={rehypePlugins as Parameters<typeof ReactMarkdown>[0]['rehypePlugins']}
        components={{
          mark({ children }) {
            return <mark className="bg-yellow-500/30 text-yellow-200 rounded-sm px-0.5 not-italic">{children}</mark>;
          },

          // ── Inline code ─────────────────────────────────────────────────
          code({ className: cls, children, ...props }) {
            const isInline = !cls;
            if (isInline) {
              return (
                <code
                  className="bg-muted text-foreground border border-border px-1.5 py-0.5 rounded-md font-mono text-[0.85em] align-baseline"
                  {...props}
                >
                  {children}
                </code>
              );
            }
            return (
              <code
                className={cn('block font-mono text-[12.5px] text-[var(--aw-text-1)]', cls)}
                {...props}
              >
                {children}
              </code>
            );
          },

          // ── Fenced code block — with language badge + copy ──────────────
          pre({ children }) {
            const childArr = Array.isArray(children) ? children : [children];
            const codeEl = childArr.find(
              (c): c is React.ReactElement =>
                !!c && typeof c === 'object' && 'type' in (c as object) &&
                (c as React.ReactElement).type === 'code'
            );
            const cp = (codeEl?.props ?? {}) as { className?: string; children?: React.ReactNode };
            const lang = (cp.className || '').replace('language-', '') || '';
            const codeText = String(cp.children ?? '').replace(/\n$/, '');
            return <CodeBlock lang={lang} codeText={codeText}>{children}</CodeBlock>;
          },

          // ── Paragraphs ──────────────────────────────────────────────────
          p({ children }) {
            return (
              <p className={cn(textSz, lineH, mbPara, 'last:mb-0', textClr)}>
                {children}
              </p>
            );
          },

          // ── Links ───────────────────────────────────────────────────────
          a({ href, children }) {
            return (
              <a
                href={href}
                className="text-[var(--aw-blue)] hover:text-[var(--aw-blue-light)] underline underline-offset-2 decoration-[var(--aw-blue)]/40 hover:decoration-[var(--aw-blue-light)] transition-colors"
                target="_blank"
                rel="noopener noreferrer"
              >
                {children}
              </a>
            );
          },

          // ── Lists — proper outdented markers ────────────────────────────
          ul({ children }) {
            return (
              <ul className={cn('list-disc pl-5 space-y-1.5', mbPara, 'last:mb-0', textSz, textClr)}>
                {children}
              </ul>
            );
          },
          ol({ children }) {
            return (
              <ol className={cn('list-decimal pl-5 space-y-1.5', mbPara, 'last:mb-0', textSz, textClr)}>
                {children}
              </ol>
            );
          },
          li({ children }) {
            return (
              <li className={cn(lineH, 'pl-0.5')}>
                {children}
              </li>
            );
          },

          // ── Headings ────────────────────────────────────────────────────
          h1({ children }) {
            return (
              <h1 className="text-[18px] font-bold mt-6 mb-3 first:mt-0 text-[var(--aw-text-0)] pb-2 border-b border-[var(--aw-bg-2)]">
                {children}
              </h1>
            );
          },
          h2({ children }) {
            return (
              <h2 className="text-[15px] font-bold mt-5 mb-2 first:mt-0 text-[var(--aw-text-0)]">
                {children}
              </h2>
            );
          },
          h3({ children }) {
            return (
              <h3 className="text-[13px] font-semibold mt-4 mb-1.5 first:mt-0 text-[var(--aw-text-0)]">
                {children}
              </h3>
            );
          },
          h4({ children }) {
            return (
              <h4 className="text-[13px] font-medium mt-3 mb-1 first:mt-0 text-[var(--aw-text-2)] uppercase tracking-wide">
                {children}
              </h4>
            );
          },

          // ── Blockquote — callout card ────────────────────────────────────
          blockquote({ children }) {
            return (
              <blockquote className="relative border-l-[3px] border-primary bg-muted pl-4 pr-4 py-3 rounded-r-lg my-3 text-muted-foreground italic">
                {children}
              </blockquote>
            );
          },

          // ── Emphasis ────────────────────────────────────────────────────
          strong({ children }) {
            return <strong className="font-semibold text-[var(--aw-text-0)]">{children}</strong>;
          },
          em({ children }) {
            return <em className="italic text-[var(--aw-text-2)]">{children}</em>;
          },

          // ── Horizontal rule ──────────────────────────────────────────────
          hr() {
            return <hr className="border-[var(--aw-bg-2)] my-5" />;
          },

          // ── Tables ──────────────────────────────────────────────────────
          table({ children }) {
            return (
              <div className="overflow-x-auto my-4 rounded-lg border border-[var(--aw-bg-3)]">
                <table className="w-full border-collapse text-[13px]">
                  {children}
                </table>
              </div>
            );
          },
          thead({ children }) {
            return (
              <thead className="bg-[var(--aw-bg-1)] border-b border-[var(--aw-bg-3)]">
                {children}
              </thead>
            );
          },
          tbody({ children }) {
            return <tbody className="divide-y divide-[var(--aw-bg-2)]">{children}</tbody>;
          },
          tr({ children }) {
            return (
              <tr className="hover:bg-[var(--aw-bg-1)]/60 transition-colors">
                {children}
              </tr>
            );
          },
          th({ children }) {
            return (
              <th className="text-left font-semibold text-[var(--aw-text-2)] px-4 py-2.5 text-[11px] uppercase tracking-wider whitespace-nowrap">
                {children}
              </th>
            );
          },
          td({ children }) {
            return (
              <td className="px-4 py-2.5 text-[var(--aw-text-1)] align-top">
                {children}
              </td>
            );
          },
        }}
      >
        {content}
      </ReactMarkdown>
    </div>
  );
}
