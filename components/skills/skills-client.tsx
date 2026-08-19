'use client';

import { useEffect, useState, useMemo, useRef } from 'react';
import { Wand2, RefreshCw, ArrowUpDown } from 'lucide-react';
import { useSkillStore } from '@/store/skill-store';
import { SkillCard } from './skill-card';
import { ProjectContextDocuments } from './project-context-documents';
import { SourceSwitcher } from '@/components/source-switcher';
import { NavBarBrand } from '@/components/shared/navbar-brand';
import { NavBarTabs } from '@/components/shared/navbar-tabs';
import { SidebarNavItem } from '@/components/shared/sidebar-nav-item';
import { shortenProjectPath, projectColorVar } from '@/lib/utils';
import { Group, Panel, Separator, usePanelRef } from 'react-resizable-panels';

function readSourceCookie(): string | undefined {
  const match = document.cookie.match(/(?:^|; )aw-source=([^;]*)/);
  return match ? decodeURIComponent(match[1]) : undefined;
}

type SortKey = 'name' | 'executions' | 'feedback' | 'lastAnalysis';

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

  // Build sidebar project list — same display-name shortening + color coding as
  // Home, so the same project reads as the same name/color everywhere. Different
  // raw project strings (older sessions indexed under stale slugs) that shorten to
  // the same display name are merged into a single entry instead of listed twice.
  // Project documents are keyed by the raw `project` string (there's no normalized
  // project ID in this schema — see skill-registry.ts), so when a display name is
  // backed by more than one raw string, the most-common one is used as the upload
  // target; the rare drifted minority won't see docs uploaded via this entry until
  // they're reconciled onto the canonical name (same caveat as skill grouping itself).
  const sidebarProjects = useMemo(() => {
    const map = new Map<string, { count: number; rawProjects: Map<string, number> }>();
    for (const s of skills) {
      const displayName = shortenProjectPath(s.project);
      const entry = map.get(displayName) ?? { count: 0, rawProjects: new Map<string, number>() };
      entry.count++;
      entry.rawProjects.set(s.project, (entry.rawProjects.get(s.project) ?? 0) + 1);
      map.set(displayName, entry);
    }
    return Array.from(map.entries())
      .map(([displayName, { count, rawProjects }]) => ({
        displayName,
        count,
        canonicalProject: [...rawProjects.entries()].sort((a, b) => b[1] - a[1])[0][0],
      }))
      .sort((a, b) => b.count - a.count);
  }, [skills]);

  const selectedCanonicalProject = selected === 'all'
    ? null
    : sidebarProjects.find(p => p.displayName === selected)?.canonicalProject ?? null;

  const filtered = selected === 'all' ? skills : skills.filter(s => shortenProjectPath(s.project) === selected);

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
    : `${selected} (${sorted.length})`;

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
                {sidebarProjects.map(({ displayName, count }) => (
                  <SidebarNavItem
                    key={displayName}
                    active={selected === displayName}
                    onClick={() => setSelected(displayName)}
                    accentVar={projectColorVar(displayName)}
                    icon={
                      <span
                        className="h-1.5 w-1.5 rounded-full shrink-0"
                        style={{ backgroundColor: `var(${projectColorVar(displayName)})` }}
                      />
                    }
                    label={displayName}
                    trailing={count}
                  />
                ))}
              </div>
            )}

            {sidebarProjects.length > 0 && sidebarCollapsed && (
              <div className="mt-2 pt-2 border-t border-sidebar-border/50 space-y-0.5">
                {sidebarProjects.map(({ displayName }) => (
                  <SidebarNavItem
                    key={displayName}
                    active={selected === displayName}
                    collapsed
                    onClick={() => setSelected(displayName)}
                    title={displayName}
                    icon={
                      <span
                        className="h-2 w-2 rounded-full"
                        style={{ backgroundColor: `var(${projectColorVar(displayName)})` }}
                      />
                    }
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
          <div className="max-w-[1800px] mx-auto px-6 py-8">
            <div className="flex items-center justify-between mb-5">
              <div>
                <h2 className="text-sm font-semibold truncate">{panelTitle}</h2>
                <p className="text-xs text-[var(--aw-text-2)] mt-0.5">Skill analytics, feedback &amp; self-healing intelligence</p>
              </div>
              <div className="flex items-center gap-2">
                <div className="flex items-center gap-1">
                  <ArrowUpDown className="h-3.5 w-3.5 text-[var(--aw-text-2)]" />
                  <select
                    value={sortKey}
                    onChange={e => setSortKey(e.target.value as SortKey)}
                    className="text-xs px-2 py-1.5 rounded bg-[var(--aw-bg-2)] border border-[var(--aw-bg-3)] text-[var(--aw-text-0)]"
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
                  className="flex items-center gap-1.5 text-xs px-3 py-1.5 rounded bg-[var(--aw-bg-2)] hover:bg-[var(--aw-bg-3)] text-[var(--aw-text-0)] transition-colors font-medium disabled:opacity-50"
                >
                  <RefreshCw className={`h-3.5 w-3.5 ${isSyncing ? 'animate-spin' : ''}`} />
                  {isSyncing ? 'Syncing...' : 'Sync'}
                </button>
              </div>
            </div>

            {selectedCanonicalProject && (
              <div className="mb-5">
                <ProjectContextDocuments project={selectedCanonicalProject} />
              </div>
            )}

            {isLoading ? (
              <div className="text-center py-16 text-[var(--aw-text-2)]">
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
              <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4 gap-3">
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
