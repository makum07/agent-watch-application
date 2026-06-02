'use client';

import { useAgentMessages } from '@/hooks/use-agent-messages';
import { ScrollArea } from '@/components/ui/scroll-area';
import { FileText, Pencil, Plus } from 'lucide-react';
import { cn } from '@/lib/utils';

interface ArtifactsTabProps {
  sessionId: string;
  agentId: string;
}

export function ArtifactsTab({ sessionId, agentId }: ArtifactsTabProps) {
  const { messages, isLoading } = useAgentMessages(sessionId, agentId);

  const artifacts = messages.flatMap(msg => {
    if (msg.role !== 'assistant') return [];
    return msg.content
      .filter(b => b.type === 'tool_use' && (b as { name: string }).name === 'Write' || b.type === 'tool_use' && (b as { name: string }).name === 'Edit')
      .map(b => b as { type: 'tool_use'; id: string; name: string; input: Record<string, unknown> });
  });

  return (
    <ScrollArea className="h-full">
      <div className="p-4 space-y-2">
        {!isLoading && artifacts.length === 0 && (
          <div className="text-sm text-muted-foreground text-center py-8">No files produced</div>
        )}

        {artifacts.map(a => {
          const filePath = (a.input?.file_path as string) || 'Unknown file';
          const isWrite = a.name === 'Write';
          const fileName = filePath.split('/').pop() || filePath;

          return (
            <div key={a.id} className="flex items-center gap-3 p-3 rounded-md border border-border bg-muted/20 hover:bg-muted/40 transition-colors">
              <div className={cn('p-1.5 rounded', isWrite ? 'bg-green-900/50' : 'bg-orange-900/50')}>
                {isWrite ? <Plus className="h-3.5 w-3.5 text-green-400" /> : <Pencil className="h-3.5 w-3.5 text-orange-400" />}
              </div>
              <div className="min-w-0 flex-1">
                <div className="text-sm font-mono truncate">{fileName}</div>
                <div className="text-xs text-muted-foreground truncate">{filePath}</div>
              </div>
              <span className={cn(
                'text-xs px-1.5 py-0.5 rounded shrink-0',
                isWrite ? 'bg-green-900/50 text-green-400' : 'bg-orange-900/50 text-orange-400'
              )}>
                {isWrite ? 'Created' : 'Modified'}
              </span>
            </div>
          );
        })}
      </div>
    </ScrollArea>
  );
}
