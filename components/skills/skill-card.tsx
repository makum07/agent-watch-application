'use client';

import Link from 'next/link';
import { Zap, Clock, MessageSquare, Activity, HeartPulse, Layers } from 'lucide-react';
import { cn, formatDuration } from '@/lib/utils';
import type { SkillSummary } from '@/types/skills';

interface SkillCardProps {
  skill: SkillSummary;
}

export function SkillCard({ skill }: SkillCardProps) {
  const healingColor = skill.selfHealingEnabled
    ? (skill.lastAnalysisStatus === 'analyzing' ? 'bg-yellow-400' : 'bg-green-400')
    : 'bg-[var(--aw-text-4)]';

  return (
    <Link href={`/skills/${skill.id}`}>
      <div className={cn(
        'rounded-md border bg-card hover:bg-[var(--aw-bg-5)] transition-colors group',
        'border-[var(--aw-bg-3)]'
      )}>
        <div className="p-4 pb-3">
          <div className="flex items-start justify-between gap-2 mb-1.5">
            <div className="flex items-center gap-1.5 min-w-0 flex-1">
              <h3 className="text-sm font-semibold text-[var(--aw-text-0)] truncate leading-tight font-mono">
                /{skill.name}
              </h3>
            </div>
            <div className="flex items-center gap-1.5 shrink-0">
              <div className={cn('h-2 w-2 rounded-full', healingColor)} title={
                skill.selfHealingEnabled ? 'Self-Healing Enabled' : 'Self-Healing Disabled'
              } />
              {skill.selfHealingEnabled && (
                <HeartPulse className="h-3.5 w-3.5 text-green-400" />
              )}
            </div>
          </div>
          <div className="text-xs text-[var(--aw-text-1)] font-mono truncate">{skill.project}</div>
          {skill.description && (
            <div className="text-xs text-[var(--aw-text-2)] mt-1 line-clamp-2">{skill.description}</div>
          )}
        </div>

        <div className="px-4 pb-3 grid grid-cols-4 gap-1">
          <Stat icon={<Zap className="h-3 w-3" />} value={String(skill.totalExecutions)} label="executions" />
          <Stat icon={<Layers className="h-3 w-3" />} value={String(skill.totalSessions)} label="sessions" />
          <Stat icon={<MessageSquare className="h-3 w-3" />} value={String(skill.totalFeedback)} label="feedback" />
          <Stat icon={<Clock className="h-3 w-3" />} value={skill.avgDurationMs > 0 ? formatDuration(skill.avgDurationMs) : '—'} label="avg" />
        </div>

        <div className="px-4 pb-3 flex items-center justify-between text-[11px] text-[var(--aw-text-3)] border-t border-[var(--aw-bg-2)] pt-2">
          <span>
            {skill.lastAnalysisAt
              ? `Last analyzed ${new Date(skill.lastAnalysisAt).toLocaleDateString([], { month: 'short', day: 'numeric' })}`
              : 'Never analyzed'
            }
          </span>
          <span className="flex items-center gap-1">
            <Activity className="h-3 w-3" />
            v{skill.version}
          </span>
        </div>
      </div>
    </Link>
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
