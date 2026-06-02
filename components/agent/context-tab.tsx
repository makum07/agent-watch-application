import { MarkdownRenderer } from '@/components/shared/markdown-renderer';
import { ScrollArea } from '@/components/ui/scroll-area';
import type { Agent } from '@/types/session';

interface ContextTabProps {
  agent: Agent;
}

export function ContextTab({ agent }: ContextTabProps) {
  return (
    <ScrollArea className="h-full">
      <div className="p-4 space-y-6">
        <section>
          <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-2">
            Prompt from Parent
          </div>
          {agent.prompt ? (
            <div className="rounded-md bg-muted/30 border border-border p-3">
              <MarkdownRenderer content={agent.prompt} />
            </div>
          ) : (
            <div className="text-sm text-muted-foreground italic">
              {agent.depth === 0 ? 'Root orchestrator — no parent prompt' : 'No prompt recorded'}
            </div>
          )}
        </section>

        {agent.description && (
          <section>
            <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-2">
              Description
            </div>
            <div className="text-sm">{agent.description}</div>
          </section>
        )}

        {agent.schema && (
          <section>
            <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-2">
              Output Schema
            </div>
            <pre className="text-xs font-mono bg-muted/30 rounded-md p-3 overflow-x-auto">
              {JSON.stringify(agent.schema, null, 2)}
            </pre>
          </section>
        )}

        <section>
          <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-2">
            Response to Parent
          </div>
          {agent.response ? (
            <div className="rounded-md bg-muted/30 border border-border p-3">
              <MarkdownRenderer content={agent.response} />
            </div>
          ) : (
            <div className="text-sm text-muted-foreground italic">No response recorded</div>
          )}
        </section>
      </div>
    </ScrollArea>
  );
}
