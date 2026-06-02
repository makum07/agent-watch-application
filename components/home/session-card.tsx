'use client';

import Link from 'next/link';
import { Pin, Star, Users, Zap, Clock, DollarSign, Wrench, ChevronRight } from 'lucide-react';
import { cn, formatTokens, formatDuration, formatCost, formatRelativeTime } from '@/lib/utils';
import type { SessionHistory } from '@/types/history';

interface SessionCardProps {
  session: SessionHistory;
}

export function SessionCard({ session }: SessionCardProps) {
  const projectName = session.project.split(/[/\\]/).filter(Boolean).slice(-2).join('/');

  return (
    <div className={cn(
      'rounded-md border bg-card hover:bg-[#1c2128] transition-colors group',
      session.isPinned ? 'border-[#58a6ff]/40' : 'border-[#30363d]'
    )}>
      {/* Header */}
      <div className="p-4 pb-3">
        <div className="flex items-start justify-between gap-2 mb-1.5">
          <div className="flex items-center gap-1.5 min-w-0">
            {session.isPinned && <Pin className="h-3 w-3 text-[#58a6ff] shrink-0" />}
            {session.isFavorite && <Star className="h-3 w-3 text-yellow-400 fill-yellow-400 shrink-0" />}
            <h3 className="text-sm font-semibold text-[#e6edf3] truncate leading-tight">
              {session.title}
            </h3>
          </div>
          <span className={cn(
            'text-[10px] px-1.5 py-0.5 rounded-full shrink-0 font-medium',
            'bg-[#3fb950]/20 text-[#3fb950] border border-[#3fb950]/30'
          )}>
            Completed
          </span>
        </div>
        <div className="text-xs text-[#c9d1d9] font-mono truncate">{projectName}</div>
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
      <div className="px-3 pb-3 flex gap-2 border-t border-[#21262d] pt-3">
        <Link
          href={`/session/${session.sessionId}/workspace`}
          className="flex-1 text-center text-xs py-1.5 rounded bg-[#21262d] hover:bg-[#30363d] text-[#e6edf3] transition-colors font-medium"
        >
          Open Workspace
        </Link>
        <Link
          href={`/session/${session.sessionId}/timeline`}
          className="text-xs py-1.5 px-3 rounded bg-[#21262d] hover:bg-[#30363d] text-[#8b949e] hover:text-[#e6edf3] transition-colors"
        >
          Timeline
        </Link>
        <Link
          href={`/session/${session.sessionId}/analytics`}
          className="text-xs py-1.5 px-3 rounded bg-[#21262d] hover:bg-[#30363d] text-[#8b949e] hover:text-[#e6edf3] transition-colors"
        >
          Analytics
        </Link>
      </div>

      <div className="px-4 pb-2 text-[11px] text-[#6e7681]">
        {formatRelativeTime(session.lastOpened)} · {session.sessionId.slice(0, 8)}
      </div>
    </div>
  );
}

function Stat({ icon, value, label }: { icon: React.ReactNode; value: string; label: string }) {
  return (
    <div className="flex flex-col items-center gap-0.5 py-1.5 rounded bg-[#0d1117]">
      <div className="text-[#c9d1d9]">{icon}</div>
      <div className="text-[11px] font-semibold text-[#e6edf3] leading-none">{value}</div>
      {label && <div className="text-[10px] text-[#6e7681]">{label}</div>}
    </div>
  );
}
