import { formatTokens, formatDuration, formatCost } from '@/lib/utils';
import { getStatusDisplay } from '@/lib/agent-display';
import type { Agent } from '@/types/session';

interface SummaryTabProps {
  agent: Agent;
}

export function SummaryTab({ agent }: SummaryTabProps) {
  const status = getStatusDisplay(agent);
  return (
    <div className="p-4 space-y-4">
      <section>
        <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-2">Identity</h3>
        <div className="space-y-1.5 text-sm">
          <Row label="Type" value={agent.subagentType || agent.type} />
          <Row label="Model" value={agent.model || '—'} />
          <Row label="Status" value={status.title} />
          {agent.deniedToolCount > 0 && <Row label="Denied tool calls" value={String(agent.deniedToolCount)} />}
          {agent.errorToolCount > 0 && <Row label="Failed tool calls" value={String(agent.errorToolCount)} />}
          <Row label="Depth" value={String(agent.depth)} />
          {agent.isolation && <Row label="Isolation" value={agent.isolation} />}
        </div>
      </section>

      <section>
        <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-2">Timing</h3>
        <div className="space-y-1.5 text-sm">
          <Row label="Start" value={formatTimestamp(agent.startTime)} />
          <Row label="End" value={agent.endTime ? formatTimestamp(agent.endTime) : '—'} />
          <Row label="Duration" value={formatDuration(agent.durationMs)} />
        </div>
      </section>

      <section>
        <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-2">Tokens</h3>
        <div className="space-y-1.5 text-sm">
          <Row label="Input" value={formatTokens(agent.tokenUsage.input)} />
          <Row label="Output" value={formatTokens(agent.tokenUsage.output)} />
          <Row label="Cache Created" value={formatTokens(agent.tokenUsage.cacheCreation)} />
          <Row label="Cache Read" value={formatTokens(agent.tokenUsage.cacheRead)} />
          <Row label="Total" value={formatTokens(agent.tokenUsage.total)} />
        </div>
      </section>

      {agent.toolCalls.length > 0 && (
        <section>
          <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-2">Tool Usage</h3>
          <div className="space-y-1.5 text-sm">
            {agent.toolCalls.map(tc => (
              <Row key={tc.name} label={tc.name} value={String(tc.count)} />
            ))}
          </div>
        </section>
      )}

      {agent.children.length > 0 && (
        <section>
          <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-2">Children</h3>
          <div className="text-sm text-muted-foreground">
            {agent.children.length} subagent{agent.children.length !== 1 ? 's' : ''}
          </div>
        </section>
      )}
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between">
      <span className="text-muted-foreground">{label}</span>
      <span className="font-mono text-xs">{value}</span>
    </div>
  );
}

function formatTimestamp(iso: string): string {
  try {
    return new Date(iso).toLocaleString([], {
      month: 'short', day: 'numeric',
      hour: '2-digit', minute: '2-digit', second: '2-digit',
    });
  } catch {
    return iso;
  }
}
