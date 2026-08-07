'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Pin, Star, Users, Zap, Clock, DollarSign, Wrench, TerminalSquare, MessageSquare } from 'lucide-react';
import {
  cn, formatTokens, formatDuration, formatCost, formatRelativeTime,
  parseSessionTitle, shortenProjectPath, projectColorVar,
} from '@/lib/utils';
import type { SessionHistory } from '@/types/history';

interface SessionCardProps {
  session: SessionHistory;
  /** Freshly re-derived title text to use instead of `session.title` (e.g. when the stored title is a stale, unrecoverable XML fragment). */
  titleOverride?: string;
  /** Freshly re-derived project path to use instead of `session.project` (stored value can predate real-cwd resolution). */
  projectOverride?: string;
  /** Whether the session's actual first message was a slash command — the displayed
   * title can be an AI-generated summary of the whole session, so it can't be trusted
   * to reflect this on its own. */
  isCommandOverride?: boolean;
}

export function SessionCard({ session, titleOverride, projectOverride, isCommandOverride }: SessionCardProps) {
  const parsed = parseSessionTitle(titleOverride ?? session.title);
  const title = parsed.text;
  const isCommand = isCommandOverride ?? parsed.isCommand;
  const project = projectOverride ?? session.project;
  const projectName = shortenProjectPath(project);
  const colorVar = projectColorVar(project);
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
    <div
      className={cn(
        'rounded-md border bg-card hover:bg-[var(--aw-bg-5)] transition-colors group border-l-[3px]',
        isPinned ? 'border-[var(--aw-blue)]/40' : 'border-[var(--aw-bg-3)]'
      )}
      style={{ borderLeftColor: `var(${colorVar})` }}
    >
      {/* Header */}
      <div className="p-4 pb-3">
        <div className="flex items-start justify-between gap-2 mb-1.5">
          <div className="flex items-start gap-1.5 min-w-0 flex-1">
            {isCommand
              ? <TerminalSquare className="h-3.5 w-3.5 mt-0.5 shrink-0 text-[var(--aw-purple)]" />
              : <MessageSquare className="h-3.5 w-3.5 mt-0.5 shrink-0 text-[var(--aw-text-3)]" />}
            <h3 className="text-sm font-semibold text-[var(--aw-text-0)] leading-tight line-clamp-2">
              {title}
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
        <div className="flex items-center gap-1.5 min-w-0" title={project}>
          <span className="h-1.5 w-1.5 rounded-full shrink-0" style={{ backgroundColor: `var(${colorVar})` }} />
          <span className="text-xs text-[var(--aw-text-1)] font-mono truncate">{projectName}</span>
          {isCommand && (
            <span className="ml-auto shrink-0 text-[10px] uppercase tracking-wide font-medium text-[var(--aw-purple)] bg-[var(--aw-purple)]/10 px-1.5 py-0.5 rounded">
              Command
            </span>
          )}
        </div>
      </div>

      {/* Stats */}
      <div className="px-4 pb-3 flex flex-wrap gap-1.5">
        <Stat icon={<Users className="h-3 w-3" />} value={String(session.agentCount)} label="agents" />
        <Stat icon={<Zap className="h-3 w-3" />} value={formatTokens(session.totalTokens)} label="tokens" />
        <Stat icon={<Wrench className="h-3 w-3" />} value={String(session.totalToolCalls)} label="tools" />
        <Stat icon={<Clock className="h-3 w-3" />} value={formatDuration(session.durationMs)} label="duration" />
        <Stat icon={<DollarSign className="h-3 w-3" />} value={formatCost(session.estimatedCost)} label="cost" />
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
          href={`/session/${session.sessionId}/workspace?open=timeline`}
          className="text-xs py-1.5 px-3 rounded bg-[var(--aw-bg-2)] hover:bg-[var(--aw-bg-3)] text-[var(--aw-text-2)] hover:text-[var(--aw-text-0)] transition-colors"
        >
          Timeline
        </Link>
        <Link
          href={`/session/${session.sessionId}/workspace?open=analytics`}
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
    <div className="flex items-center gap-1 px-2 py-1 rounded bg-[var(--aw-bg-0)] whitespace-nowrap">
      <span className="text-[var(--aw-text-1)]">{icon}</span>
      <span className="text-[11px] font-semibold text-[var(--aw-text-0)]">{value}</span>
      {label && <span className="text-[10px] text-[var(--aw-text-3)]">{label}</span>}
    </div>
  );
}
