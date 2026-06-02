'use client';

import { useState } from 'react';
import { ChevronRight, Terminal, FileText, Search, Globe, Code2, Wrench } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import type { ResolvedToolCall } from '@/types/session';

import type { LucideProps } from 'lucide-react';
import type { ForwardRefExoticComponent, RefAttributes } from 'react';
type LucideIcon = ForwardRefExoticComponent<Omit<LucideProps, 'ref'> & RefAttributes<SVGSVGElement>>;
const TOOL_ICONS: Record<string, LucideIcon> = {
  Bash: Terminal,
  Read: FileText,
  Write: FileText,
  Edit: FileText,
  Grep: Search,
  Glob: Search,
  WebSearch: Globe,
  WebFetch: Globe,
  Agent: Code2,
  Task: Code2,
  Workflow: Code2,
};

function ToolIcon({ name, className }: { name: string; className?: string }) {
  const Icon = TOOL_ICONS[name] || Wrench;
  return <Icon className={className} />;
}

interface ToolCallCardProps {
  toolCall: ResolvedToolCall;
  defaultOpen?: boolean;
}

export function ToolCallCard({ toolCall, defaultOpen = false }: ToolCallCardProps) {
  const [isOpen, setIsOpen] = useState(defaultOpen);

  const isAgentSpawn = toolCall.isAgentSpawn;
  const hasError = toolCall.isError;

  return (
    <Collapsible open={isOpen} onOpenChange={setIsOpen}>
      <div className={cn(
        'rounded-md border text-xs',
        hasError ? 'border-red-700 bg-red-900/20' : isAgentSpawn ? 'border-blue-700 bg-blue-900/20' : 'border-border bg-muted/30'
      )}>
        <CollapsibleTrigger asChild>
          <button className="w-full flex items-center gap-2 px-3 py-2 hover:bg-accent/50 transition-colors text-left">
            <ToolIcon name={toolCall.name} className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
            <span className={cn(
              'font-mono font-medium',
              hasError ? 'text-red-400' : isAgentSpawn ? 'text-blue-400' : 'text-foreground'
            )}>
              {toolCall.name}
            </span>
            {!!toolCall.input?.description && (
              <span className="text-muted-foreground truncate flex-1">
                {String(toolCall.input.description).slice(0, 60)}
              </span>
            )}
            {!toolCall.input?.description && !!toolCall.input?.file_path && (
              <span className="text-muted-foreground truncate flex-1 font-mono">
                {String(toolCall.input.file_path).split('/').slice(-2).join('/')}
              </span>
            )}
            {toolCall.durationMs !== null && (
              <span className="text-muted-foreground ml-auto shrink-0">
                {toolCall.durationMs < 1000 ? `${toolCall.durationMs}ms` : `${(toolCall.durationMs / 1000).toFixed(1)}s`}
              </span>
            )}
            <ChevronRight className={cn('h-3 w-3 shrink-0 transition-transform text-muted-foreground', isOpen && 'rotate-90')} />
          </button>
        </CollapsibleTrigger>

        <CollapsibleContent>
          <div className="px-3 pb-3 space-y-2">
            <div>
              <div className="text-muted-foreground mb-1 font-medium">Input</div>
              <pre className="bg-background/50 rounded p-2 overflow-x-auto text-xs font-mono">
                {JSON.stringify(toolCall.input, null, 2)}
              </pre>
            </div>
            {toolCall.result !== undefined && (
              <div>
                <div className={cn('mb-1 font-medium', hasError ? 'text-red-400' : 'text-muted-foreground')}>
                  {hasError ? 'Error' : 'Result'}
                </div>
                <pre className="bg-background/50 rounded p-2 overflow-x-auto text-xs font-mono max-h-48 overflow-y-auto">
                  {formatResult(toolCall.result)}
                </pre>
              </div>
            )}
          </div>
        </CollapsibleContent>
      </div>
    </Collapsible>
  );
}

function formatResult(result: unknown): string {
  if (result === null || result === undefined) return '(empty)';
  if (Array.isArray(result)) {
    return result.map(item => {
      if (typeof item === 'object' && item !== null && 'text' in item) {
        return (item as { text: string }).text;
      }
      return JSON.stringify(item);
    }).join('\n');
  }
  if (typeof result === 'string') return result;
  return JSON.stringify(result, null, 2);
}
