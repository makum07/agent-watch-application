'use client';

import { useState, useMemo } from 'react';
import { useAgentMessages } from '@/hooks/use-agent-messages';
import { useWorkspaceStore } from '@/store/workspace-store';
import { ToolCallCard } from './tool-call-card';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Loader2, Search, X } from 'lucide-react';
import { cn } from '@/lib/utils';

interface ToolsTabProps {
  sessionId: string;
  agentId: string;
}

const SPAWN_TOOLS = new Set(['Agent', 'Task', 'Workflow']);

export function ToolsTab({ sessionId, agentId }: ToolsTabProps) {
  const refreshToken = useWorkspaceStore(s => s.refreshToken);
  const { messages, loadMore, hasMore, isLoading } = useAgentMessages(sessionId, agentId, refreshToken);
  const [filter, setFilter] = useState('');

  // Collect tool calls in execution order (message order → content order within message),
  // paired with their tool_result block (looked up by tool_use_id) so output isn't lost.
  const toolUses = useMemo(() => {
    const resultMap = new Map<string, { content: unknown; isError: boolean; ts: number }>();
    for (const msg of messages) {
      if (msg.role !== 'user' && msg.role !== 'tool') continue;
      for (const block of msg.content) {
        if (block.type === 'tool_result') {
          resultMap.set(block.tool_use_id, {
            content: block.content,
            isError: block.is_error ?? false,
            ts: new Date(msg.timestamp).getTime(),
          });
        }
      }
    }

    const calls: Array<{
      id: string; name: string; input: Record<string, unknown>;
      result: unknown; isError: boolean; durationMs: number | null;
    }> = [];
    for (const msg of messages) {
      if (msg.role !== 'assistant') continue;
      for (const block of msg.content) {
        if (block.type !== 'tool_use') continue;
        const res = resultMap.get(block.id);
        const durationMs = res ? res.ts - new Date(msg.timestamp).getTime() : null;
        calls.push({
          id: block.id,
          name: block.name,
          input: block.input,
          result: res?.content,
          isError: res?.isError ?? false,
          durationMs,
        });
      }
    }
    return calls;
  }, [messages]);

  const filtered = useMemo(() => {
    if (!filter) return toolUses;
    const q = filter.toLowerCase();
    return toolUses.filter(t =>
      t.name.toLowerCase().includes(q) ||
      JSON.stringify(t.input).toLowerCase().includes(q)
    );
  }, [toolUses, filter]);

  return (
    <div className="flex flex-col h-full">
      <div className="flex items-center gap-2 px-3 py-1.5 border-b border-[var(--aw-bg-2)] shrink-0 bg-[var(--aw-bg-0)]">
        <Search className="h-3.5 w-3.5 text-[var(--aw-text-4)] shrink-0" />
        <input
          type="text"
          value={filter}
          onChange={e => setFilter(e.target.value)}
          placeholder="Filter tool calls…"
          className="flex-1 text-xs bg-transparent text-[var(--aw-text-0)] placeholder-[var(--aw-text-4)] outline-none"
        />
        {filter && (
          <button onClick={() => setFilter('')} className="text-[var(--aw-text-3)] hover:text-[var(--aw-text-1)]">
            <X className="h-3 w-3" />
          </button>
        )}
        {filter && filtered.length !== toolUses.length && (
          <span className="text-[10px] text-[var(--aw-text-4)] shrink-0">{filtered.length}/{toolUses.length}</span>
        )}
      </div>

      <ScrollArea className="flex-1">
        <div className="p-3 space-y-1.5">
          {isLoading && toolUses.length === 0 && (
            <div className="flex items-center justify-center h-24">
              <Loader2 className="h-5 w-5 animate-spin text-[var(--aw-text-3)]" />
            </div>
          )}

          {!isLoading && filtered.length === 0 && (
            <div className="text-sm text-[var(--aw-text-3)] text-center py-8">
              {filter ? 'No matching tool calls' : 'No tool calls recorded'}
            </div>
          )}

          {filtered.map(tu => (
            <ToolCallCard
              key={tu.id}
              toolCall={{
                id: tu.id,
                name: tu.name,
                input: tu.input,
                result: tu.result,
                isError: tu.isError,
                durationMs: tu.durationMs,
                isAgentSpawn: SPAWN_TOOLS.has(tu.name),
                childAgentId: null,
              }}
            />
          ))}

          {hasMore && (
            <button
              onClick={loadMore}
              disabled={isLoading}
              className={cn(
                'w-full text-xs py-2 rounded border border-[var(--aw-bg-3)] text-[var(--aw-text-2)] hover:text-[var(--aw-text-0)] hover:border-[var(--aw-blue)]/40 transition-colors',
                isLoading && 'opacity-50 cursor-not-allowed'
              )}
            >
              {isLoading ? 'Loading…' : `Load more (${toolUses.length} loaded)`}
            </button>
          )}
        </div>
      </ScrollArea>
    </div>
  );
}
