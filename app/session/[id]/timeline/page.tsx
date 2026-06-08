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
    <div className="flex flex-col h-screen bg-[#0d1117]">
      {/* Page header */}
      <header className="border-b border-[#21262d] shrink-0 bg-[#161b22]">
        <div className="px-4 py-2.5 flex items-center gap-2">
          <Link href="/" className="text-[#8b949e] hover:text-[#e6edf3] transition-colors">
            <Layers className="h-4 w-4" />
          </Link>
          <span className="text-[#484f58]">/</span>
          <Link href={`/session/${id}/workspace`}
            className="text-[#8b949e] hover:text-[#e6edf3] text-sm transition-colors truncate max-w-[200px]">
            {projectName}
          </Link>
          <span className="text-[#484f58]">/</span>
          <span className="text-sm font-medium text-[#e6edf3] flex items-center gap-1.5">
            <Clock className="h-3.5 w-3.5 text-[#58a6ff]" />
            Timeline
          </span>
          <div className="ml-auto flex items-center gap-3 text-xs text-[#6e7681]">
            <span>{session.agents.length} agents</span>
            <Link href={`/session/${id}/workspace`}
              className="px-2 py-1 rounded bg-[#21262d] text-[#c9d1d9] hover:text-[#e6edf3] hover:bg-[#30363d] transition-colors">
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
