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
    <div className={cn(isBase ? 'prose prose-invert prose-base max-w-none' : 'prose prose-invert prose-sm max-w-none', className)}>
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          code({ className, children, ...props }) {
            const isInline = !className;
            if (isInline) {
              return (
                <code
                  className="px-1.5 py-0.5 rounded bg-muted font-mono text-xs text-foreground"
                  {...props}
                >
                  {children}
                </code>
              );
            }
            return (
              <code
                className={cn('block p-3 rounded bg-muted font-mono text-xs overflow-x-auto text-foreground', className)}
                {...props}
              >
                {children}
              </code>
            );
          },
          pre({ children, ...props }) {
            return (
              <pre className="overflow-x-auto rounded bg-[#0d1117] border border-[#30363d] p-3 text-xs" {...props}>
                {children}
              </pre>
            );
          },
          p({ children, ...props }) {
            return (
              <p
                className={isBase
                  ? 'text-[15px] leading-7 mb-3 last:mb-0 text-[#c9d1d9]'
                  : 'text-sm leading-relaxed mb-2 last:mb-0'}
                {...props}
              >
                {children}
              </p>
            );
          },
          a({ href, children, ...props }) {
            return (
              <a href={href} className="text-primary hover:underline" target="_blank" rel="noopener noreferrer" {...props}>
                {children}
              </a>
            );
          },
          ul({ children, ...props }) {
            return (
              <ul
                className={isBase
                  ? 'list-disc list-inside space-y-1.5 text-[15px] mb-3 text-[#c9d1d9]'
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
                  ? 'list-decimal list-inside space-y-1.5 text-[15px] mb-3 text-[#c9d1d9]'
                  : 'list-decimal list-inside space-y-1 text-sm mb-2'}
                {...props}
              >
                {children}
              </ol>
            );
          },
          h1({ children, ...props }) {
            return <h1 className={isBase ? 'text-xl font-bold mb-3 text-[#e6edf3]' : 'text-lg font-bold mb-2'} {...props}>{children}</h1>;
          },
          h2({ children, ...props }) {
            return <h2 className={isBase ? 'text-lg font-bold mb-2 text-[#e6edf3]' : 'text-base font-bold mb-2'} {...props}>{children}</h2>;
          },
          h3({ children, ...props }) {
            return <h3 className={isBase ? 'text-[15px] font-semibold mb-2 text-[#e6edf3]' : 'text-sm font-bold mb-1'} {...props}>{children}</h3>;
          },
          blockquote({ children, ...props }) {
            return (
              <blockquote
                className={isBase
                  ? 'border-l-2 border-[#388bfd] pl-4 italic text-[#8b949e] text-[15px] my-3'
                  : 'border-l-2 border-primary pl-3 italic text-muted-foreground text-sm'}
                {...props}
              >
                {children}
              </blockquote>
            );
          },
          strong({ children, ...props }) {
            return (
              <strong className={isBase ? 'font-semibold text-[#e6edf3]' : 'font-semibold'} {...props}>
                {children}
              </strong>
            );
          },
        }}
      >
        {content}
      </ReactMarkdown>
    </div>
  );
}
