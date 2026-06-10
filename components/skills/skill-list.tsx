'use client';

import { useEffect, useState } from 'react';
import { RefreshCw, ArrowUpDown } from 'lucide-react';
import { useSkillStore } from '@/store/skill-store';
import { SkillCard } from './skill-card';
import type { SkillSummary } from '@/types/skills';

type SortKey = 'name' | 'executions' | 'feedback' | 'lastAnalysis';

export function SkillList() {
  const { skills, isLoading, isSyncing, loadSkills, syncSkills } = useSkillStore();
  const [sortKey, setSortKey] = useState<SortKey>('executions');
  const [projectFilter, setProjectFilter] = useState<string>('all');

  useEffect(() => {
    loadSkills();
  }, [loadSkills]);

  const projects = [...new Set(skills.map(s => s.project))].sort();

  const filtered = projectFilter === 'all'
    ? skills
    : skills.filter(s => s.project === projectFilter);

  const sorted = [...filtered].sort((a, b) => {
    switch (sortKey) {
      case 'name': return a.name.localeCompare(b.name);
      case 'executions': return b.totalExecutions - a.totalExecutions;
      case 'feedback': return b.totalFeedback - a.totalFeedback;
      case 'lastAnalysis': {
        const aTime = a.lastAnalysisAt ? new Date(a.lastAnalysisAt).getTime() : 0;
        const bTime = b.lastAnalysisAt ? new Date(b.lastAnalysisAt).getTime() : 0;
        return bTime - aTime;
      }
      default: return 0;
    }
  });

  const byProject = new Map<string, SkillSummary[]>();
  for (const skill of sorted) {
    const key = skill.project;
    if (!byProject.has(key)) byProject.set(key, []);
    byProject.get(key)!.push(skill);
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3 flex-wrap">
        <button
          onClick={() => syncSkills()}
          disabled={isSyncing}
          className="flex items-center gap-1.5 text-xs px-3 py-1.5 rounded bg-[#21262d] hover:bg-[#30363d] text-[#e6edf3] transition-colors font-medium disabled:opacity-50"
        >
          <RefreshCw className={`h-3.5 w-3.5 ${isSyncing ? 'animate-spin' : ''}`} />
          {isSyncing ? 'Syncing...' : 'Sync Skills'}
        </button>

        <select
          value={projectFilter}
          onChange={e => setProjectFilter(e.target.value)}
          className="text-xs px-2 py-1.5 rounded bg-[#21262d] border border-[#30363d] text-[#e6edf3]"
        >
          <option value="all">All Projects</option>
          {projects.map(p => (
            <option key={p} value={p}>{p}</option>
          ))}
        </select>

        <div className="flex items-center gap-1">
          <ArrowUpDown className="h-3.5 w-3.5 text-[#8b949e]" />
          <select
            value={sortKey}
            onChange={e => setSortKey(e.target.value as SortKey)}
            className="text-xs px-2 py-1.5 rounded bg-[#21262d] border border-[#30363d] text-[#e6edf3]"
          >
            <option value="executions">Most Executions</option>
            <option value="feedback">Most Feedback</option>
            <option value="name">Name</option>
            <option value="lastAnalysis">Last Analyzed</option>
          </select>
        </div>
      </div>

      {isLoading ? (
        <div className="text-center py-16 text-muted-foreground">
          <div className="h-6 w-6 border-2 border-[#58a6ff] border-t-transparent rounded-full animate-spin mx-auto mb-3" />
          <p className="text-sm">Loading skills...</p>
        </div>
      ) : sorted.length === 0 ? (
        <div className="text-center py-16 text-muted-foreground">
          <p className="text-sm font-medium">No skills found</p>
          <p className="text-xs mt-1">Open sessions that use skills, or click Sync Skills to scan all sessions</p>
        </div>
      ) : (
        <div className="space-y-6">
          {Array.from(byProject.entries()).map(([project, projectSkills]) => (
            <div key={project}>
              <div className="flex items-center gap-2 mb-2">
                <span className="text-xs font-medium text-muted-foreground bg-muted px-2 py-0.5 rounded font-mono">
                  {project}
                </span>
                <span className="text-xs text-muted-foreground">
                  {projectSkills.length} skill{projectSkills.length !== 1 ? 's' : ''}
                </span>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3">
                {projectSkills.map(skill => (
                  <SkillCard key={skill.id} skill={skill} />
                ))}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
