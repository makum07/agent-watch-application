'use client';

import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { cn } from '@/lib/utils';

interface MarkdownRendererProps {
  content: string;
  className?: string;
}

export function MarkdownRenderer({ content, className }: MarkdownRendererProps) {
  return (
    <div className={cn('prose prose-invert prose-sm max-w-none', className)}>
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          code({ className, children, ...props }) {
            const isInline = !className;
            if (isInline) {
              return (
                <code
                  className="px-1 py-0.5 rounded bg-muted font-mono text-xs text-foreground"
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
              <pre className="overflow-x-auto rounded bg-muted p-3 text-xs" {...props}>
                {children}
              </pre>
            );
          },
          p({ children, ...props }) {
            return <p className="text-sm leading-relaxed mb-2 last:mb-0" {...props}>{children}</p>;
          },
          a({ href, children, ...props }) {
            return (
              <a href={href} className="text-primary hover:underline" target="_blank" rel="noopener noreferrer" {...props}>
                {children}
              </a>
            );
          },
          ul({ children, ...props }) {
            return <ul className="list-disc list-inside space-y-1 text-sm mb-2" {...props}>{children}</ul>;
          },
          ol({ children, ...props }) {
            return <ol className="list-decimal list-inside space-y-1 text-sm mb-2" {...props}>{children}</ol>;
          },
          h1({ children, ...props }) {
            return <h1 className="text-lg font-bold mb-2" {...props}>{children}</h1>;
          },
          h2({ children, ...props }) {
            return <h2 className="text-base font-bold mb-2" {...props}>{children}</h2>;
          },
          h3({ children, ...props }) {
            return <h3 className="text-sm font-bold mb-1" {...props}>{children}</h3>;
          },
          blockquote({ children, ...props }) {
            return (
              <blockquote className="border-l-2 border-primary pl-3 italic text-muted-foreground text-sm" {...props}>
                {children}
              </blockquote>
            );
          },
        }}
      >
        {content}
      </ReactMarkdown>
    </div>
  );
}
