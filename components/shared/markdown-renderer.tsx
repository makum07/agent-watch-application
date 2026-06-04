'use client';

import { useState, useCallback } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { Copy, Check } from 'lucide-react';
import { cn } from '@/lib/utils';

interface MarkdownRendererProps {
  content: string;
  className?: string;
  size?: 'sm' | 'base';
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
    <div className="my-3 rounded-lg overflow-hidden border border-[#30363d] bg-[#0d1117]">
      <div className="flex items-center justify-between px-3.5 py-2 bg-[#161b22] border-b border-[#30363d]">
        <span className="text-[11px] font-mono text-[#6e7681]">
          {lang || 'code'}
        </span>
        <button
          onClick={copy}
          className="flex items-center gap-1.5 text-[11px] text-[#6e7681] hover:text-[#c9d1d9] transition-colors"
        >
          {copied ? (
            <>
              <Check className="h-3 w-3 text-[#3fb950]" />
              <span className="text-[#3fb950]">Copied</span>
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

export function MarkdownRenderer({ content, className, size = 'sm' }: MarkdownRendererProps) {
  const isBase = size === 'base';
  const textSz  = isBase ? 'text-[14px]'  : 'text-[13px]';
  const textClr  = 'text-[#c9d1d9]';
  const lineH   = isBase ? 'leading-[1.75]' : 'leading-relaxed';
  const mbPara  = isBase ? 'mb-3.5' : 'mb-2';

  return (
    <div className={cn('overflow-hidden min-w-0', textSz, textClr, lineH, className)}>
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{

          // ── Inline code ─────────────────────────────────────────────────
          code({ className: cls, children, ...props }) {
            const isInline = !cls;
            if (isInline) {
              return (
                <code
                  className="bg-[#1c2333] text-[#79c0ff] border border-[#2d3f55]/70 px-1.5 py-0.5 rounded-md font-mono text-[0.85em] align-baseline"
                  {...props}
                >
                  {children}
                </code>
              );
            }
            return (
              <code
                className={cn('block font-mono text-[12.5px] text-[#c9d1d9]', cls)}
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
                className="text-[#58a6ff] hover:text-[#79c0ff] underline underline-offset-2 decoration-[#58a6ff]/40 hover:decoration-[#79c0ff] transition-colors"
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
              <h1 className="text-[18px] font-bold mt-6 mb-3 first:mt-0 text-[#e6edf3] pb-2 border-b border-[#21262d]">
                {children}
              </h1>
            );
          },
          h2({ children }) {
            return (
              <h2 className="text-[15px] font-bold mt-5 mb-2 first:mt-0 text-[#e6edf3]">
                {children}
              </h2>
            );
          },
          h3({ children }) {
            return (
              <h3 className="text-[13px] font-semibold mt-4 mb-1.5 first:mt-0 text-[#e6edf3]">
                {children}
              </h3>
            );
          },
          h4({ children }) {
            return (
              <h4 className="text-[13px] font-medium mt-3 mb-1 first:mt-0 text-[#8b949e] uppercase tracking-wide">
                {children}
              </h4>
            );
          },

          // ── Blockquote — callout card ────────────────────────────────────
          blockquote({ children }) {
            return (
              <blockquote className="relative border-l-[3px] border-[#388bfd] bg-[#0d1f35] pl-4 pr-4 py-3 rounded-r-lg my-3 text-[#8b949e] italic">
                {children}
              </blockquote>
            );
          },

          // ── Emphasis ────────────────────────────────────────────────────
          strong({ children }) {
            return <strong className="font-semibold text-[#e6edf3]">{children}</strong>;
          },
          em({ children }) {
            return <em className="italic text-[#8b949e]">{children}</em>;
          },

          // ── Horizontal rule ──────────────────────────────────────────────
          hr() {
            return <hr className="border-[#21262d] my-5" />;
          },

          // ── Tables ──────────────────────────────────────────────────────
          table({ children }) {
            return (
              <div className="overflow-x-auto my-4 rounded-lg border border-[#30363d]">
                <table className="w-full border-collapse text-[13px]">
                  {children}
                </table>
              </div>
            );
          },
          thead({ children }) {
            return (
              <thead className="bg-[#161b22] border-b border-[#30363d]">
                {children}
              </thead>
            );
          },
          tbody({ children }) {
            return <tbody className="divide-y divide-[#21262d]">{children}</tbody>;
          },
          tr({ children }) {
            return (
              <tr className="hover:bg-[#161b22]/60 transition-colors">
                {children}
              </tr>
            );
          },
          th({ children }) {
            return (
              <th className="text-left font-semibold text-[#8b949e] px-4 py-2.5 text-[11px] uppercase tracking-wider whitespace-nowrap">
                {children}
              </th>
            );
          },
          td({ children }) {
            return (
              <td className="px-4 py-2.5 text-[#c9d1d9] align-top">
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
