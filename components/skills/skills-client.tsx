'use client';

import { useEffect, useState, useMemo } from 'react';
import { Layers, Wand2, FolderOpen, RefreshCw, ArrowUpDown } from 'lucide-react';
import Link from 'next/link';
import { useSkillStore } from '@/store/skill-store';
import { SkillCard } from './skill-card';
import { SessionSearch } from '@/components/home/session-search';
import { ThemeToggle } from '@/components/theme-toggle';
import {
  Sidebar, SidebarContent, SidebarGroup, SidebarGroupContent,
  SidebarGroupLabel, SidebarHeader, SidebarInset, SidebarMenu,
  SidebarMenuButton, SidebarMenuItem, SidebarProvider, SidebarTrigger,
} from '@/components/ui/sidebar';

type SortKey = 'name' | 'executions' | 'feedback' | 'lastAnalysis';

function decodeProjectName(encoded: string): string {
  const s = encoded.startsWith('-') ? encoded.slice(1) : encoded;
  const homeMatch = s.match(/^home-[^-]+-(.+)/);
  if (homeMatch) return homeMatch[1];
  const mntMatch = s.match(/^mnt-[^-]+-Users-[^-]+-(.+)/);
  if (mntMatch) return mntMatch[1];
  if (/^[A-Za-z]--/.test(encoded)) return s.replace(/^[A-Za-z]--[^-]+-[^-]+-/, '');
  return s;
}

export function SkillsClient() {
  const { skills, isLoading, isSyncing, loadSkills, syncSkills } = useSkillStore();
  const [selected, setSelected] = useState<string>('all');
  const [sortKey, setSortKey] = useState<SortKey>('executions');

  useEffect(() => { loadSkills(); }, [loadSkills]);

  // Build sidebar project list with display names + skill counts
  const sidebarProjects = useMemo(() => {
    const map = new Map<string, number>();
    for (const s of skills) {
      map.set(s.project, (map.get(s.project) ?? 0) + 1);
    }
    const items = Array.from(map.entries()).map(([raw, count]) => ({
      raw, count, displayName: decodeProjectName(raw),
    }));

    // Strip common prefix across display names
    if (items.length > 1) {
      const names = items.map(i => i.displayName);
      let prefix = '';
      const first = names[0];
      for (let i = 0; i < first.length; i++) {
        const ch = first.slice(0, i + 1);
        if (names.every(n => n.startsWith(ch))) prefix = ch;
        else break;
      }
      const dashIdx = prefix.lastIndexOf('-');
      const strip = dashIdx > 0 ? prefix.slice(0, dashIdx + 1) : '';
      if (strip && items.every(i => i.displayName !== strip.slice(0, -1))) {
        return items.map(i => ({ ...i, displayName: i.displayName.slice(strip.length) || i.displayName }));
      }
    }
    return items;
  }, [skills]);

  const filtered = selected === 'all' ? skills : skills.filter(s => s.project === selected);

  const sorted = [...filtered].sort((a, b) => {
    switch (sortKey) {
      case 'name': return a.name.localeCompare(b.name);
      case 'executions': return b.totalExecutions - a.totalExecutions;
      case 'feedback': return b.totalFeedback - a.totalFeedback;
      case 'lastAnalysis': {
        const aT = a.lastAnalysisAt ? new Date(a.lastAnalysisAt).getTime() : 0;
        const bT = b.lastAnalysisAt ? new Date(b.lastAnalysisAt).getTime() : 0;
        return bT - aT;
      }
      default: return 0;
    }
  });

  const panelTitle = selected === 'all'
    ? `All Skills (${skills.length})`
    : `${sidebarProjects.find(p => p.raw === selected)?.displayName ?? selected} (${sorted.length})`;

  return (
    <SidebarProvider style={{ '--sidebar-width': '220px' } as React.CSSProperties}>
      <Sidebar collapsible="icon">
        <SidebarHeader className="py-3" />
        <SidebarContent>
          <SidebarGroup>
            <SidebarGroupContent>
              <SidebarMenu>
                <SidebarMenuItem>
                  <SidebarMenuButton
                    isActive={selected === 'all'}
                    onClick={() => setSelected('all')}
                    tooltip="All Skills"
                  >
                    <Wand2 className="h-4 w-4 text-primary" />
                    <span>All Skills</span>
                    <span className="ml-auto text-xs text-muted-foreground">{skills.length}</span>
                  </SidebarMenuButton>
                </SidebarMenuItem>
              </SidebarMenu>
            </SidebarGroupContent>
          </SidebarGroup>

          {sidebarProjects.length > 0 && (
            <SidebarGroup>
              <SidebarGroupLabel>Projects</SidebarGroupLabel>
              <SidebarGroupContent>
                <SidebarMenu>
                  {sidebarProjects.map(({ raw, displayName, count }) => (
                    <SidebarMenuItem key={raw}>
                      <SidebarMenuButton
                        isActive={selected === raw}
                        onClick={() => setSelected(raw)}
                        tooltip={displayName}
                      >
                        <FolderOpen className="h-4 w-4 shrink-0" />
                        <span className="truncate">{displayName}</span>
                        <span className="ml-auto text-xs text-muted-foreground shrink-0">{count}</span>
                      </SidebarMenuButton>
                    </SidebarMenuItem>
                  ))}
                </SidebarMenu>
              </SidebarGroupContent>
            </SidebarGroup>
          )}
        </SidebarContent>
      </Sidebar>

      <SidebarInset className="flex flex-col h-screen overflow-hidden">
        {/* Navbar */}
        <header className="border-b border-border shrink-0 bg-background/95 backdrop-blur z-10">
          <div className="px-4 py-3 grid grid-cols-3 items-center gap-4">
            <div className="flex items-center gap-2 min-w-0">
              <SidebarTrigger className="shrink-0" />
              <div className="h-4 w-px bg-border shrink-0" />
              <Link href="/" className="flex items-center gap-1.5 hover:opacity-80 transition-opacity shrink-0">
                <Layers className="h-4 w-4 text-primary" />
                <span className="font-semibold text-sm">AgentWatch</span>
              </Link>
              <span className="text-border shrink-0">/</span>
              <div className="flex items-center gap-1 shrink-0">
                <Wand2 className="h-4 w-4 text-primary" />
                <span className="text-sm font-medium">Skills</span>
              </div>
            </div>
            <div className="flex justify-center">
              <div className="w-full max-w-sm">
                <SessionSearch />
              </div>
            </div>
            <div className="flex items-center justify-end">
              <ThemeToggle />
            </div>
          </div>
        </header>

        {/* Content */}
        <div className="flex-1 overflow-y-auto">
          <div className="max-w-5xl mx-auto px-6 py-8">
            <div className="flex items-center justify-between mb-6">
              <div>
                <h1 className="text-lg font-semibold">{panelTitle}</h1>
                <p className="text-xs text-muted-foreground mt-0.5">Skill analytics, feedback &amp; self-healing intelligence</p>
              </div>
              <div className="flex items-center gap-2">
                <div className="flex items-center gap-1">
                  <ArrowUpDown className="h-3.5 w-3.5 text-muted-foreground" />
                  <select
                    value={sortKey}
                    onChange={e => setSortKey(e.target.value as SortKey)}
                    className="text-xs px-2 py-1.5 rounded bg-muted border border-border text-foreground"
                  >
                    <option value="executions">Most Used</option>
                    <option value="feedback">Most Feedback</option>
                    <option value="name">Name</option>
                    <option value="lastAnalysis">Last Analyzed</option>
                  </select>
                </div>
                <button
                  onClick={() => syncSkills()}
                  disabled={isSyncing}
                  className="flex items-center gap-1.5 text-xs px-3 py-1.5 rounded bg-muted hover:bg-accent text-foreground transition-colors font-medium disabled:opacity-50"
                >
                  <RefreshCw className={`h-3.5 w-3.5 ${isSyncing ? 'animate-spin' : ''}`} />
                  {isSyncing ? 'Syncing...' : 'Sync'}
                </button>
              </div>
            </div>

            {isLoading ? (
              <div className="text-center py-16 text-muted-foreground">
                <div className="h-6 w-6 border-2 border-primary border-t-transparent rounded-full animate-spin mx-auto mb-3" />
                <p className="text-sm">Loading skills...</p>
              </div>
            ) : sorted.length === 0 ? (
              <div className="text-center py-16 text-muted-foreground">
                <Wand2 className="h-8 w-8 mx-auto mb-3 opacity-20" />
                <p className="text-sm font-medium">No skills found</p>
                <p className="text-xs mt-1">Open sessions that use skills, or click Sync</p>
              </div>
            ) : (
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3">
                {sorted.map(skill => <SkillCard key={skill.id} skill={skill} />)}
              </div>
            )}
          </div>
        </div>
      </SidebarInset>
    </SidebarProvider>
  );
}
