'use client';

import { use } from 'react';
import { Layers, Loader2 } from 'lucide-react';
import Link from 'next/link';
import { useSession } from '@/hooks/use-session';
import { AnalyticsDashboard } from '@/components/session/analytics-dashboard';

interface Props {
  params: Promise<{ id: string }>;
}

export default function AnalyticsPage({ params }: Props) {
  const { id } = use(params);
  const { session, isLoading, error } = useSession(id);

  if (isLoading) {
    return (
      <div className="flex h-screen items-center justify-center bg-background">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (error || !session) {
    return (
      <div className="flex h-screen items-center justify-center bg-background">
        <div className="text-center text-muted-foreground">
          <Layers className="h-8 w-8 mx-auto mb-2 opacity-30" />
          <p className="text-sm">{error || 'Session not found'}</p>
          <Link href="/" className="text-xs text-primary mt-2 block hover:underline">← Back to dashboard</Link>
        </div>
      </div>
    );
  }

  return (
    <div className="h-screen bg-background flex flex-col">
      <header className="border-b border-border shrink-0">
        <div className="max-w-5xl mx-auto px-6 py-3 flex items-center gap-3">
          <Link href="/" className="text-muted-foreground hover:text-foreground"><Layers className="h-4 w-4" /></Link>
          <span className="text-muted-foreground">/</span>
          <Link href={`/session/${id}/workspace`} className="text-muted-foreground hover:text-foreground text-sm">Session</Link>
          <span className="text-muted-foreground">/</span>
          <span className="text-sm font-medium">Analytics</span>
        </div>
      </header>
      <div className="flex-1 overflow-hidden">
        <AnalyticsDashboard sessionId={id} />
      </div>
    </div>
  );
}
