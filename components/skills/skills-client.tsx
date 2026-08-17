'use client';

import { useEffect, useState, useMemo, useRef } from 'react';
import { Wand2, FolderOpen, RefreshCw, ArrowUpDown } from 'lucide-react';
import { useSkillStore } from '@/store/skill-store';
import { SkillCard } from './skill-card';
import { SourceSwitcher } from '@/components/source-switcher';
import { NavBarBrand } from '@/components/shared/navbar-brand';
import { NavBarTabs } from '@/components/shared/navbar-tabs';
import { SidebarNavItem } from '@/components/shared/sidebar-nav-item';
import { Group, Panel, Separator, usePanelRef } from 'react-resizable-panels';

function readSourceCookie(): string | undefined {
  const match = document.cookie.match(/(?:^|; )aw-source=([^;]*)/);
  return match ? decodeURIComponent(match[1]) : undefined;
}

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
  const { skills, isLoading, isSyncing, loadSkills, syncSkills, setSourceId, sourceId } = useSkillStore();
  const [selected, setSelected] = useState<string>('all');
  const [sortKey, setSortKey] = useState<SortKey>('executions');

  // Skills are per-source (same as every other page) — pick up the active
  // source from the shared cookie on mount, and again whenever the
  // SourceSwitcher below changes it.
  useEffect(() => {
    setSourceId(readSourceCookie());
    const onSourceChanged = (e: Event) => setSourceId((e as CustomEvent<string>).detail);
    window.addEventListener('aw-source-changed', onSourceChanged);
    return () => window.removeEventListener('aw-source-changed', onSourceChanged);
  }, [setSourceId]);

  useEffect(() => { loadSkills(); }, [loadSkills, sourceId]);

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
      <Group orientation="horizontal" className="flex-1 overflow-hidden">
        {/* Resizable sidebar */}
        <Panel
          id="skills-sidebar"
          panelRef={sidebarPanelRef}
          defaultSize={260}
          minSize={260}
          maxSize={440}
          collapsible
          collapsedSize={44}
          onResize={(size) => {
            const collapsed = size.inPixels <= 44;
            if (collapsed !== collapsedRef.current) {
              collapsedRef.current = collapsed;
              setSidebarCollapsed(collapsed);
            }
          }}
          className="flex flex-col border-r border-sidebar-border bg-sidebar text-sidebar-foreground overflow-hidden"
        >
          <NavBarBrand collapsed={sidebarCollapsed} sidebarToggle={{ onToggle: toggleSidebar }} />

          <div className="flex-1 overflow-y-auto px-2 pt-3 space-y-0.5">
            <SidebarNavItem
              active={selected === 'all'}
              collapsed={sidebarCollapsed}
              onClick={() => setSelected('all')}
              icon={<Wand2 className="h-4 w-4 text-primary" />}
              label="All Skills"
              trailing={skills.length}
            />

            {sidebarProjects.length > 0 && !sidebarCollapsed && (
              <div className="mt-3 pt-3 border-t border-sidebar-border/50">
                <p className="px-2.5 pb-1 text-[10px] font-semibold uppercase tracking-wider text-sidebar-foreground/40">Projects</p>
                {sidebarProjects.map(({ raw, displayName, count }) => (
                  <SidebarNavItem
                    key={raw}
                    active={selected === raw}
                    onClick={() => setSelected(raw)}
                    icon={<FolderOpen className="h-4 w-4" />}
                    label={displayName}
                    trailing={count}
                  />
                ))}
              </div>
            )}

            {sidebarProjects.length > 0 && sidebarCollapsed && (
              <div className="mt-2 pt-2 border-t border-sidebar-border/50 space-y-0.5">
                {sidebarProjects.map(({ raw, displayName }) => (
                  <SidebarNavItem
                    key={raw}
                    active={selected === raw}
                    collapsed
                    onClick={() => setSelected(raw)}
                    title={displayName}
                    icon={<FolderOpen className="h-4 w-4" />}
                    label={displayName}
                  />
                ))}
              </div>
            )}
          </div>
        </Panel>

        <Separator className="shrink-0 bg-sidebar-border hover:bg-primary/40 cursor-col-resize transition-colors data-[orientation=horizontal]:w-1" />

        {/* Main content */}
        <Panel id="skills-main" minSize={300} className="flex flex-col overflow-hidden">
          <NavBarTabs activePage="skills" rightSlot={<SourceSwitcher initialSourceId={sourceId ?? ''} />} />
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
        </Panel>
      </Group>
    </div>
  );
}
