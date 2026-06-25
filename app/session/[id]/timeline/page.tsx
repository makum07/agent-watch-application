'use client';

import { use } from 'react';
import { useSession } from '@/hooks/use-session';
import { ExecutionTimeline } from '@/components/session/execution-timeline';
import { Layers, Loader2, Clock } from 'lucide-react';
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

  const projectName = session.project.split(/[/\\]/).filter(Boolean).pop() || 'Session';

  return (
    <div className="flex flex-col h-screen bg-[var(--aw-bg-0)]">
      {/* Page header */}
      <header className="border-b border-[var(--aw-bg-2)] shrink-0 bg-[var(--aw-bg-1)]">
        <div className="px-4 py-2.5 flex items-center gap-2">
          <Link href="/" className="text-[var(--aw-text-2)] hover:text-[var(--aw-text-0)] transition-colors">
            <Layers className="h-4 w-4" />
          </Link>
          <span className="text-[var(--aw-text-4)]">/</span>
          <Link href={`/session/${id}/workspace`}
            className="text-[var(--aw-text-2)] hover:text-[var(--aw-text-0)] text-sm transition-colors truncate max-w-[200px]">
            {projectName}
          </Link>
          <span className="text-[var(--aw-text-4)]">/</span>
          <span className="text-sm font-medium text-[var(--aw-text-0)] flex items-center gap-1.5">
            <Clock className="h-3.5 w-3.5 text-[var(--aw-blue)]" />
            Timeline
          </span>
          <div className="ml-auto flex items-center gap-3 text-xs text-[var(--aw-text-3)]">
            <span>{session.agents.length} agents</span>
            <Link href={`/session/${id}/workspace`}
              className="px-2 py-1 rounded bg-[var(--aw-bg-2)] text-[var(--aw-text-1)] hover:text-[var(--aw-text-0)] hover:bg-[var(--aw-bg-3)] transition-colors">
              Workspace →
            </Link>
          </div>
        </div>
      </header>

      {/* Timeline fills remaining height */}
      <div className="flex-1 overflow-hidden">
        <ExecutionTimeline sessionId={id} />
      </div>
    </div>
  );
}
