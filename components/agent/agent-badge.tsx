import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';

const AGENT_COLORS: Record<string, string> = {
  Explore: 'bg-green-900/50 text-green-300 border-green-700',
  Plan: 'bg-orange-900/50 text-orange-300 border-orange-700',
  'general-purpose': 'bg-purple-900/50 text-purple-300 border-purple-700',
  'code-reviewer': 'bg-red-900/50 text-red-300 border-red-700',
  orchestrator: 'bg-blue-900/50 text-blue-300 border-blue-700',
  workflow: 'bg-emerald-900/50 text-emerald-300 border-emerald-700',
};

export function AgentBadge({
  subagentType,
  type,
  className,
}: {
  subagentType: string | null;
  type: string;
  className?: string;
}) {
  const label = subagentType || (type === 'orchestrator' ? 'Main' : 'Agent');
  const colorClass = AGENT_COLORS[subagentType || type] || 'bg-muted text-muted-foreground border-border';

  return (
    <Badge variant="outline" className={cn('text-xs shrink-0', colorClass, className)}>
      {label}
    </Badge>
  );
}

export function StatusBadge({ status }: { status: string }) {
  const map: Record<string, string> = {
    completed: 'bg-green-900/50 text-green-300 border-green-700',
    running: 'bg-blue-900/50 text-blue-300 border-blue-700',
    errored: 'bg-red-900/50 text-red-300 border-red-700',
    unknown: 'bg-muted text-muted-foreground border-border',
  };

  return (
    <Badge variant="outline" className={cn('text-xs', map[status] || map.unknown)}>
      {status}
    </Badge>
  );
}
