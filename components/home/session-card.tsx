'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Pin, Star, Users, Zap, Clock, DollarSign, Wrench } from 'lucide-react';
import { cn, formatTokens, formatDuration, formatCost, formatRelativeTime } from '@/lib/utils';
import type { SessionHistory } from '@/types/history';

interface SessionCardProps {
  session: SessionHistory;
}

export function SessionCard({ session }: SessionCardProps) {
  const projectName = session.project.split(/[/\\]/).filter(Boolean).slice(-2).join('/');
  const [isPinned, setIsPinned] = useState(session.isPinned);
  const [isFavorite, setIsFavorite] = useState(session.isFavorite);
  const router = useRouter();

  const toggle = async (field: 'isPinned' | 'isFavorite') => {
    const next = field === 'isPinned' ? !isPinned : !isFavorite;
    if (field === 'isPinned') setIsPinned(next);
    else setIsFavorite(next);
    try {
      const sourceId = document.cookie.split(';').map(c => c.trim())
        .find(c => c.startsWith('aw-source='))?.split('=')[1];
      const url = `/api/v2/history/${session.sessionId}${sourceId ? `?source=${sourceId}` : ''}`;
      await fetch(url, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ [field]: next }),
      });
      if (field === 'isPinned') router.refresh();
    } catch {
      if (field === 'isPinned') setIsPinned(!next);
      else setIsFavorite(!next);
    }
  };

  return (
    <div className={cn(
      'rounded-md border bg-card hover:bg-[var(--aw-bg-5)] transition-colors group',
      isPinned ? 'border-[var(--aw-blue)]/40' : 'border-[var(--aw-bg-3)]'
    )}>
      {/* Header */}
      <div className="p-4 pb-3">
        <div className="flex items-start justify-between gap-2 mb-1.5">
          <div className="flex items-center gap-1.5 min-w-0 flex-1">
            <h3 className="text-sm font-semibold text-[var(--aw-text-0)] truncate leading-tight">
              {session.title}
            </h3>
          </div>
          <div className="flex items-center gap-1 shrink-0">
            <button
              onClick={() => toggle('isFavorite')}
              title={isFavorite ? 'Unfavorite' : 'Favorite'}
              className={cn(
                'p-1 rounded transition-colors',
                isFavorite ? 'text-yellow-400' : 'text-[var(--aw-text-4)] hover:text-yellow-400'
              )}
            >
              <Star className={cn('h-3.5 w-3.5', isFavorite && 'fill-yellow-400')} />
            </button>
            <button
              onClick={() => toggle('isPinned')}
              title={isPinned ? 'Unpin' : 'Pin'}
              className={cn(
                'p-1 rounded transition-colors',
                isPinned ? 'text-[var(--aw-blue)]' : 'text-[var(--aw-text-4)] hover:text-[var(--aw-blue)]'
              )}
            >
              <Pin className={cn('h-3.5 w-3.5', isPinned && 'fill-[var(--aw-blue)]')} />
            </button>
          </div>
        </div>
        <div className="text-xs text-[var(--aw-text-1)] font-mono truncate">{projectName}</div>
      </div>

      {/* Stats */}
      <div className="px-4 pb-3 grid grid-cols-5 gap-1">
        <Stat icon={<Users className="h-3 w-3" />} value={String(session.agentCount)} label="agents" />
        <Stat icon={<Zap className="h-3 w-3" />} value={formatTokens(session.totalTokens)} label="tokens" />
        <Stat icon={<Wrench className="h-3 w-3" />} value={String(session.totalToolCalls)} label="tools" />
        <Stat icon={<Clock className="h-3 w-3" />} value={formatDuration(session.durationMs)} label="" />
        <Stat icon={<DollarSign className="h-3 w-3" />} value={formatCost(session.estimatedCost)} label="" />
      </div>

      {/* Actions */}
      <div className="px-3 pb-3 flex gap-2 border-t border-[var(--aw-bg-2)] pt-3">
        <Link
          href={`/session/${session.sessionId}/workspace`}
          className="flex-1 text-center text-xs py-1.5 rounded bg-[var(--aw-bg-2)] hover:bg-[var(--aw-bg-3)] text-[var(--aw-text-0)] transition-colors font-medium"
        >
          Open Workspace
        </Link>
        <Link
          href={`/session/${session.sessionId}/timeline`}
          className="text-xs py-1.5 px-3 rounded bg-[var(--aw-bg-2)] hover:bg-[var(--aw-bg-3)] text-[var(--aw-text-2)] hover:text-[var(--aw-text-0)] transition-colors"
        >
          Timeline
        </Link>
        <Link
          href={`/session/${session.sessionId}/analytics`}
          className="text-xs py-1.5 px-3 rounded bg-[var(--aw-bg-2)] hover:bg-[var(--aw-bg-3)] text-[var(--aw-text-2)] hover:text-[var(--aw-text-0)] transition-colors"
        >
          Analytics
        </Link>
      </div>

      <div className="px-4 pb-2 text-[11px] text-[var(--aw-text-3)]">
        {formatRelativeTime(session.lastOpened)} · {session.sessionId.slice(0, 8)}
      </div>
    </div>
  );
}

function Stat({ icon, value, label }: { icon: React.ReactNode; value: string; label: string }) {
  return (
    <div className="flex flex-col items-center gap-0.5 py-1.5 rounded bg-[var(--aw-bg-0)]">
      <div className="text-[var(--aw-text-1)]">{icon}</div>
      <div className="text-[11px] font-semibold text-[var(--aw-text-0)] leading-none">{value}</div>
      {label && <div className="text-[10px] text-[var(--aw-text-3)]">{label}</div>}
    </div>
  );
}
