'use client';

import { useEffect, useState, useMemo, useRef } from 'react';
import { Wand2, FolderOpen, RefreshCw, ArrowUpDown, PanelLeftClose, PanelLeftOpen } from 'lucide-react';
import { useSkillStore } from '@/store/skill-store';
import { SkillCard } from './skill-card';
import { NavBar } from '@/components/shared/navbar';
import { cn } from '@/lib/utils';
import { Group, Panel, Separator, usePanelRef } from 'react-resizable-panels';

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

  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const sidebarPanelRef = usePanelRef();
  const collapsedRef = useRef(false);

  function toggleSidebar() {
    const panel = sidebarPanelRef.current;
    if (!panel) return;
    if (collapsedRef.current) { panel.expand(); } else { panel.collapse(); }
  }

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
    <div className="flex flex-col h-screen overflow-hidden">
      <NavBar activePage="skills" />

      <Group orientation="horizontal" className="flex-1 overflow-hidden">
        {/* Resizable sidebar */}
        <Panel
          id="skills-sidebar"
          panelRef={sidebarPanelRef}
          defaultSize={220}
          minSize={160}
          maxSize={400}
          collapsible
          collapsedSize={40}
          onResize={(size) => {
            const collapsed = size.inPixels <= 44;
            if (collapsed !== collapsedRef.current) {
              collapsedRef.current = collapsed;
              setSidebarCollapsed(collapsed);
            }
          }}
          className="flex flex-col border-r border-border bg-background overflow-hidden"
        >
          <div className={cn('flex items-center px-2 py-3 shrink-0', sidebarCollapsed ? 'justify-center' : 'justify-end')}>
            <button
              onClick={toggleSidebar}
              className="h-7 w-7 flex items-center justify-center rounded-md text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
            >
              {sidebarCollapsed ? <PanelLeftOpen className="h-4 w-4" /> : <PanelLeftClose className="h-4 w-4" />}
            </button>
          </div>

          <div className="flex-1 overflow-y-auto px-2 space-y-0.5">
            <button
              onClick={() => setSelected('all')}
              className={cn('w-full flex items-center gap-2 px-2 py-1.5 rounded-md text-sm transition-colors',
                selected === 'all' ? 'bg-muted text-foreground font-medium' : 'text-muted-foreground hover:text-foreground hover:bg-muted/60')}
              title={sidebarCollapsed ? 'All Skills' : undefined}
            >
              <Wand2 className="h-4 w-4 shrink-0 text-primary" />
              {!sidebarCollapsed && (<><span className="truncate">All Skills</span><span className="ml-auto text-xs opacity-60">{skills.length}</span></>)}
            </button>

            {sidebarProjects.length > 0 && !sidebarCollapsed && (
              <div className="pt-3">
                <p className="px-2 pb-1 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground/60">Projects</p>
                {sidebarProjects.map(({ raw, displayName, count }) => (
                  <button key={raw} onClick={() => setSelected(raw)}
                    className={cn('w-full flex items-center gap-2 px-2 py-1.5 rounded-md text-sm transition-colors',
                      selected === raw ? 'bg-muted text-foreground font-medium' : 'text-muted-foreground hover:text-foreground hover:bg-muted/60')}
                  >
                    <FolderOpen className="h-4 w-4 shrink-0" />
                    <span className="truncate">{displayName}</span>
                    <span className="ml-auto text-xs opacity-60 shrink-0">{count}</span>
                  </button>
                ))}
              </div>
            )}

            {sidebarProjects.length > 0 && sidebarCollapsed && (
              <div className="pt-2 space-y-0.5">
                {sidebarProjects.map(({ raw, displayName }) => (
                  <button key={raw} onClick={() => setSelected(raw)} title={displayName}
                    className={cn('w-full flex items-center justify-center py-1.5 rounded-md transition-colors',
                      selected === raw ? 'bg-muted text-foreground' : 'text-muted-foreground hover:text-foreground hover:bg-muted/60')}
                  >
                    <FolderOpen className="h-4 w-4" />
                  </button>
                ))}
              </div>
            )}
          </div>
        </Panel>

        <Separator className="shrink-0 bg-border hover:bg-primary/40 cursor-col-resize transition-colors data-[orientation=horizontal]:w-1" />

        {/* Main content */}
        <Panel id="skills-main" minSize={300} className="overflow-y-auto">
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
        </Panel>
      </Group>
    </div>
  );
}
