'use client';

import { useAgentMessages } from '@/hooks/use-agent-messages';
import { ToolCallCard } from './tool-call-card';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Loader2 } from 'lucide-react';
import { useEffect } from 'react';

interface ToolsTabProps {
  sessionId: string;
  agentId: string;
}

export function ToolsTab({ sessionId, agentId }: ToolsTabProps) {
  const { messages, loadMore, isLoading, total } = useAgentMessages(sessionId, agentId);

  const toolUses = messages.flatMap(msg => {
    if (msg.role !== 'assistant') return [];
    return msg.content
      .filter(b => b.type === 'tool_use')
      .map(b => b as { type: 'tool_use'; id: string; name: string; input: Record<string, unknown> });
  });

  return (
    <ScrollArea className="h-full">
      <div className="p-4 space-y-2">
        {isLoading && toolUses.length === 0 && (
          <div className="flex items-center justify-center h-24">
            <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
          </div>
        )}

        {!isLoading && toolUses.length === 0 && (
          <div className="text-sm text-muted-foreground text-center py-8">No tool calls recorded</div>
        )}

        {toolUses.map(tu => (
          <ToolCallCard
            key={tu.id}
            toolCall={{
              id: tu.id,
              name: tu.name,
              input: tu.input,
              result: undefined,
              isError: false,
              durationMs: null,
              isAgentSpawn: tu.name === 'Agent' || tu.name === 'Task' || tu.name === 'Workflow',
              childAgentId: null,
            }}
          />
        ))}
      </div>
    </ScrollArea>
  );
}
