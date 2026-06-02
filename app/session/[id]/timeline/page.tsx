'use client';

import { use, useEffect } from 'react';
import { useSession } from '@/hooks/use-session';
import { Layers, Loader2, Clock } from 'lucide-react';
import { AgentBadge } from '@/components/agent/agent-badge';
import { formatDuration } from '@/lib/utils';
import Link from 'next/link';

interface Props {
  params: Promise<{ id: string }>;
}

export default function TimelinePage({ params }: Props) {
  const { id } = use(params);
  const { session, isLoading } = useSession(id);

  if (isLoading) {
    return (
      <div className="flex h-screen items-center justify-center bg-background">
        <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (!session) {
    return (
      <div className="flex h-screen items-center justify-center bg-background">
        <p className="text-muted-foreground">Session not found</p>
      </div>
    );
  }

  const sorted = [...session.agents].sort((a, b) =>
    new Date(a.startTime).getTime() - new Date(b.startTime).getTime()
  );

  const sessionStart = Math.min(...sorted.map(a => new Date(a.startTime).getTime()));
  const sessionEnd = Math.max(...sorted.filter(a => a.endTime).map(a => new Date(a.endTime!).getTime()));
  const totalDuration = sessionEnd - sessionStart;

  return (
    <div className="min-h-screen bg-background">
      <header className="border-b border-border sticky top-0 z-10 bg-background">
        <div className="max-w-full px-6 py-3 flex items-center gap-3">
          <Link href="/" className="text-muted-foreground hover:text-foreground"><Layers className="h-4 w-4" /></Link>
          <span className="text-muted-foreground">/</span>
          <Link href={`/session/${id}`} className="text-muted-foreground hover:text-foreground text-sm">Session</Link>
          <span className="text-muted-foreground">/</span>
          <span className="text-sm font-medium flex items-center gap-1.5">
            <Clock className="h-3.5 w-3.5" />
            Timeline
          </span>
          <span className="ml-auto text-xs text-muted-foreground">{sorted.length} agents</span>
        </div>
      </header>

      <main className="px-6 py-6 overflow-x-auto">
        <div className="min-w-[800px]">
          <div className="space-y-1">
            {sorted.map(agent => {
              const start = new Date(agent.startTime).getTime() - sessionStart;
              const duration = agent.endTime
                ? new Date(agent.endTime).getTime() - new Date(agent.startTime).getTime()
                : totalDuration - start;

              const left = totalDuration > 0 ? (start / totalDuration) * 100 : 0;
              const width = totalDuration > 0 ? Math.max((duration / totalDuration) * 100, 0.5) : 0.5;

              return (
                <div key={agent.id} className="flex items-center gap-3 h-8">
                  <div className="w-32 shrink-0 flex items-center gap-1">
                    <AgentBadge subagentType={agent.subagentType} type={agent.type} className="text-[10px] px-1 py-0" />
                  </div>
                  <div className="flex-1 relative h-6 bg-muted/20 rounded">
                    <Link
                      href={`/session/${id}/workspace`}
                      className="absolute top-0 h-full rounded flex items-center px-1.5 text-xs font-medium overflow-hidden hover:opacity-80 transition-opacity"
                      style={{
                        left: `${left}%`,
                        width: `${width}%`,
                        minWidth: '4px',
                        backgroundColor: agentColor(agent.subagentType || agent.type),
                      }}
                      title={`${agent.description || agent.subagentType || 'Agent'} — ${formatDuration(duration)}`}
                    >
                      {width > 8 && (
                        <span className="truncate text-white/80 text-[10px]">
                          {agent.description?.slice(0, 20) || agent.subagentType || 'Agent'}
                        </span>
                      )}
                    </Link>
                  </div>
                  <div className="w-16 shrink-0 text-right text-xs text-muted-foreground">
                    {formatDuration(duration)}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </main>
    </div>
  );
}

const AGENT_COLORS: Record<string, string> = {
  Explore: '#3fb950',
  Plan: '#f0883e',
  'general-purpose': '#bc8cff',
  'code-reviewer': '#f85149',
  orchestrator: '#58a6ff',
  workflow: '#39d353',
};

function agentColor(type: string): string {
  return AGENT_COLORS[type] || '#8b949e';
}
