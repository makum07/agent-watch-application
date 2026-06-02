'use client';

import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { cn } from '@/lib/utils';

interface MarkdownRendererProps {
  content: string;
  className?: string;
  size?: 'sm' | 'base';
}

export function MarkdownRenderer({ content, className, size = 'sm' }: MarkdownRendererProps) {
  const isBase = size === 'base';
  return (
    <div className={cn(
      isBase ? 'prose prose-invert prose-base max-w-none' : 'prose prose-invert prose-sm max-w-none',
      className,
    )}>
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          // ── Inline code — colored pill ──────────────────────────────────────
          code({ className, children, ...props }) {
            const isInline = !className;
            if (isInline) {
              return (
                <code
                  className={isBase
                    ? 'bg-[#1c2333] text-[#79c0ff] border border-[#2d3f55] px-1.5 py-0.5 rounded font-mono text-[0.85em] align-baseline'
                    : 'bg-[#1c2333] text-[#79c0ff] px-1 py-0.5 rounded font-mono text-[0.8em]'}
                  {...props}
                >
                  {children}
                </code>
              );
            }
            return (
              <code
                className={cn('block font-mono text-xs overflow-x-auto text-[#c9d1d9]', className)}
                {...props}
              >
                {children}
              </code>
            );
          },

          // ── Code block ──────────────────────────────────────────────────────
          pre({ children, ...props }) {
            return (
              <pre
                className="overflow-x-auto rounded-lg bg-[#0d1117] border border-[#30363d] p-4 text-xs my-4"
                {...props}
              >
                {children}
              </pre>
            );
          },

          // ── Paragraphs ──────────────────────────────────────────────────────
          p({ children, ...props }) {
            return (
              <p
                className={isBase
                  ? 'text-[15px] leading-7 mb-4 last:mb-0 text-[#c9d1d9]'
                  : 'text-sm leading-relaxed mb-2 last:mb-0'}
                {...props}
              >
                {children}
              </p>
            );
          },

          // ── Links ───────────────────────────────────────────────────────────
          a({ href, children, ...props }) {
            return (
              <a
                href={href}
                className="text-[#58a6ff] hover:underline underline-offset-2"
                target="_blank"
                rel="noopener noreferrer"
                {...props}
              >
                {children}
              </a>
            );
          },

          // ── Lists — outside indent for proper multi-line wrap ───────────────
          ul({ children, ...props }) {
            return (
              <ul
                className={isBase
                  ? 'list-disc pl-5 space-y-2 text-[15px] mb-4 text-[#c9d1d9]'
                  : 'list-disc list-inside space-y-1 text-sm mb-2'}
                {...props}
              >
                {children}
              </ul>
            );
          },
          ol({ children, ...props }) {
            return (
              <ol
                className={isBase
                  ? 'list-decimal pl-5 space-y-2 text-[15px] mb-4 text-[#c9d1d9]'
                  : 'list-decimal list-inside space-y-1 text-sm mb-2'}
                {...props}
              >
                {children}
              </ol>
            );
          },
          li({ children, ...props }) {
            return (
              <li
                className={isBase ? 'leading-7 text-[#c9d1d9] pl-1' : 'leading-relaxed'}
                {...props}
              >
                {children}
              </li>
            );
          },

          // ── Headings ────────────────────────────────────────────────────────
          h1({ children, ...props }) {
            return (
              <h1
                className={isBase
                  ? 'text-xl font-bold mt-5 mb-3 first:mt-0 text-[#e6edf3] border-b border-[#21262d] pb-2'
                  : 'text-lg font-bold mb-2'}
                {...props}
              >
                {children}
              </h1>
            );
          },
          h2({ children, ...props }) {
            return (
              <h2
                className={isBase
                  ? 'text-lg font-bold mt-5 mb-2 first:mt-0 text-[#e6edf3]'
                  : 'text-base font-bold mb-2'}
                {...props}
              >
                {children}
              </h2>
            );
          },
          h3({ children, ...props }) {
            return (
              <h3
                className={isBase
                  ? 'text-[15px] font-semibold mt-4 mb-2 first:mt-0 text-[#e6edf3]'
                  : 'text-sm font-bold mb-1'}
                {...props}
              >
                {children}
              </h3>
            );
          },

          // ── Blockquote — left-border callout card ───────────────────────────
          blockquote({ children, ...props }) {
            return (
              <blockquote
                className={isBase
                  ? 'not-italic border-l-4 border-[#388bfd] bg-[#0d1f35] px-4 py-3 rounded-r-lg my-4 text-[#c9d1d9]'
                  : 'border-l-2 border-primary pl-3 italic text-muted-foreground text-sm my-2'}
                {...props}
              >
                {children}
              </blockquote>
            );
          },

          // ── Strong / em ─────────────────────────────────────────────────────
          strong({ children, ...props }) {
            return (
              <strong className={isBase ? 'font-semibold text-[#e6edf3]' : 'font-semibold'} {...props}>
                {children}
              </strong>
            );
          },
          em({ children, ...props }) {
            return (
              <em className={isBase ? 'italic text-[#8b949e]' : 'italic'} {...props}>
                {children}
              </em>
            );
          },

          // ── Horizontal rule — subtle separator ──────────────────────────────
          hr({ ...props }) {
            return <hr className="border-[#21262d] my-5" {...props} />;
          },

          // ── Tables ──────────────────────────────────────────────────────────
          table({ children, ...props }) {
            return (
              <div className="overflow-x-auto my-4 rounded-lg border border-[#30363d]">
                <table className="w-full border-collapse text-[14px]" {...props}>
                  {children}
                </table>
              </div>
            );
          },
          thead({ children, ...props }) {
            return (
              <thead className="bg-[#161b22] border-b border-[#30363d]" {...props}>
                {children}
              </thead>
            );
          },
          tbody({ children, ...props }) {
            return <tbody {...props}>{children}</tbody>;
          },
          tr({ children, ...props }) {
            return (
              <tr className="border-b border-[#21262d] last:border-0 odd:bg-transparent even:bg-[#161b22]/40" {...props}>
                {children}
              </tr>
            );
          },
          th({ children, ...props }) {
            return (
              <th
                className="text-left font-semibold text-[#e6edf3] px-4 py-2.5 text-[13px] tracking-wide uppercase"
                {...props}
              >
                {children}
              </th>
            );
          },
          td({ children, ...props }) {
            return (
              <td className="px-4 py-2.5 text-[#c9d1d9] align-top" {...props}>
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
