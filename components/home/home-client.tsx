'use client';

import { useState, useMemo, useRef, useEffect } from 'react';
import { useSearchParams } from 'next/navigation';
import { Pin, Clock, Layers, TerminalSquare, MessageSquare, Settings } from 'lucide-react';
import { SessionCard } from './session-card';
import { LocalDate } from './local-date';
import { SourcePathsSettings } from './source-paths-settings';
import { SourceSwitcher } from '@/components/source-switcher';
import { NavBarBrand } from '@/components/shared/navbar-brand';
import { NavBarTabs } from '@/components/shared/navbar-tabs';
import { SidebarNavItem } from '@/components/shared/sidebar-nav-item';
import Link from 'next/link';
import { shortenProjectPath, projectColorVar, parseSessionTitle, MIN_TITLE_LEN } from '@/lib/utils';
import type { SessionHistory } from '@/types/history';
import { Group, Panel, Separator, usePanelRef } from 'react-resizable-panels';
import type { PanelImperativeHandle } from 'react-resizable-panels';

type PanelSession =
  | { kind: 'history'; data: SessionHistory }
  | { kind: 'discovered'; id: string; lastModified: string; label: string; isCommand: boolean };

interface DiscoveredSession {
  id: string;
  filePath: string;
  lastModified: string;
  projectDisplayName?: string;
}

interface FirstUserMessageInfo {
  title: string | null;
  isCommand: boolean;
}

interface Props {
  pinned: SessionHistory[];
  recent: SessionHistory[];
  byProject: [string, DiscoveredSession[]][];
  historyMap: [string, SessionHistory][];
  firstUserMessages: [string, FirstUserMessageInfo][];
  projectNames: [string, string][];
  totalSessions: number;
  sourceId: string;
}

type Selection = 'pinned' | 'recent' | string;

function getTimestamp(s: PanelSession): number {
  return s.kind === 'history'
    ? new Date(s.data.lastOpened).getTime()
    : new Date(s.lastModified).getTime();
}

function groupByRecency(sessions: PanelSession[]) {
  const now = Date.now();
  const DAY = 86_400_000;
  const today: PanelSession[] = [];
  const week: PanelSession[] = [];
  const older: PanelSession[] = [];
  for (const s of sessions) {
    const diff = now - getTimestamp(s);
    if (diff < DAY) today.push(s);
    else if (diff < 7 * DAY) week.push(s);
    else older.push(s);
  }
  return { today, week, older };
}

function PanelSessionCard({
  session, msgMap, projectNameMap,
}: {
  session: PanelSession;
  msgMap: Map<string, FirstUserMessageInfo>;
  projectNameMap: Map<string, string>;
}) {
  if (session.kind === 'history') {
    const info = msgMap.get(session.data.sessionId);
    // Old history rows can have a title that was truncated mid-XML-tag by a since-fixed
    // bug (raw <command-name>/<local-command-caveat> wrappers cut off before their closing
    // tag), or a stale bare `/model`/`/clear` cached before the too-short-title skip-ahead
    // existed — neither can be cleanly recovered after the fact. Re-derive from the JSONL
    // instead — it's already recomputed fresh on every page load for the sidebar list.
    const isTainted = session.data.title.includes('<');
    const isTooShort = session.data.title.trim().length < MIN_TITLE_LEN;
    const titleOverride = (isTainted || isTooShort) ? info?.title : undefined;
    // Same story for project names: rows ingested before real-cwd resolution was added
    // still have the lossy dash-decoded slug baked into session_history.project.
    const projectOverride = projectNameMap.get(session.data.sessionId);
    return (
      <SessionCard
        session={session.data}
        titleOverride={titleOverride ?? undefined}
        projectOverride={projectOverride}
        // The displayed title can be an AI-generated summary of the whole session (or a
        // later message, if the first was too short) — whether this was a slash-command
        // session must come from the actual first message, not from that display text.
        isCommandOverride={info?.isCommand}
      />
    );
  }
  const { text: title } = parseSessionTitle(session.label);
  const isCommand = session.isCommand;
  return (
    <Link href={`/session/${session.id}/workspace`}>
      <div className="p-4 rounded-md border border-[var(--aw-bg-3)] bg-card hover:bg-[var(--aw-bg-5)] transition-colors cursor-pointer group">
        <div className="flex items-start justify-between gap-2">
          <div className="flex items-start gap-1.5 min-w-0 flex-1">
            {isCommand
              ? <TerminalSquare className="h-3.5 w-3.5 mt-0.5 shrink-0 text-[var(--aw-purple)]" />
              : <MessageSquare className="h-3.5 w-3.5 mt-0.5 shrink-0 text-[var(--aw-text-3)]" />}
            <div className="text-sm font-medium leading-tight line-clamp-2 group-hover:text-foreground text-[var(--aw-text-1)]">
              {title || 'Untitled session'}
            </div>
          </div>
          {isCommand && (
            <span className="shrink-0 text-[10px] uppercase tracking-wide font-medium text-[var(--aw-purple)] bg-[var(--aw-purple)]/10 px-1.5 py-0.5 rounded">
              Command
            </span>
          )}
        </div>
        <div className="flex items-center gap-1.5 mt-2 text-[11px] text-[var(--aw-text-3)]">
          <LocalDate iso={session.lastModified} />
          <span>·</span>
          <span>not opened yet</span>
        </div>
      </div>
    </Link>
  );
}

function SessionGroup({
  label, sessions, msgMap, projectNameMap,
}: {
  label: string;
  sessions: PanelSession[];
  msgMap: Map<string, FirstUserMessageInfo>;
  projectNameMap: Map<string, string>;
}) {
  if (sessions.length === 0) return null;
  return (
    <div>
      <div className="text-[10px] font-medium text-muted-foreground uppercase tracking-wider mb-2">{label}</div>
      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4 gap-3 mb-6">
        {sessions.map(s => (
          <PanelSessionCard
            key={s.kind === 'history' ? s.data.sessionId : s.id}
            session={s}
            msgMap={msgMap}
            projectNameMap={projectNameMap}
          />
        ))}
      </div>
    </div>
  );
}

export function HomeClient({ pinned, recent, byProject, historyMap: historyMapArr, firstUserMessages, projectNames, totalSessions, sourceId }: Props) {
  const searchParams = useSearchParams();
  const [selected, setSelected] = useState<Selection>(() => {
    const requestedProject = searchParams.get('project');
    const exists = requestedProject && byProject.some(([name]) => name === requestedProject);
    return exists ? requestedProject! : 'recent';
  });
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [showSourceSettings, setShowSourceSettings] = useState(false);
  const sidebarPanelRef = usePanelRef();
  const collapsedRef = useRef(false);

  const historyMap = useMemo(() => new Map(historyMapArr), [historyMapArr]);
  const msgMap = useMemo(() => new Map(firstUserMessages), [firstUserMessages]);
  const projectNameMap = useMemo(() => new Map(projectNames), [projectNames]);
  const projectMap = useMemo(() => new Map(byProject), [byProject]);

  function getProjectSessions(projectName: string): PanelSession[] {
    const sessions = projectMap.get(projectName) ?? [];
    return sessions
      .map((s): PanelSession => {
        const h = historyMap.get(s.id);
        if (h) return { kind: 'history', data: h };
        const info = msgMap.get(s.id);
        return {
          kind: 'discovered',
          id: s.id,
          lastModified: s.lastModified,
          label: info?.title ?? `${s.id.slice(0, 8)}…`,
          isCommand: info?.isCommand ?? false,
        };
      })
      .sort((a, b) => getTimestamp(b) - getTimestamp(a));
  }

  const sidebarProjects = useMemo(() => {
    const items = byProject.map(([name, sessions]) => {
      const latest = sessions.reduce((best, s) => {
        const t = new Date(s.lastModified).getTime();
        return t > best ? t : best;
      }, 0);
      return { name, count: sessions.length, latest, displayName: shortenProjectPath(name) };
    }).sort((a, b) => b.latest - a.latest);
    return items;
  }, [byProject]);

  const panelContent = useMemo((): PanelSession[] => {
    if (selected === 'pinned') return pinned.map(s => ({ kind: 'history', data: s }));
    if (selected === 'recent') return recent.map(s => ({ kind: 'history', data: s }));
    return getProjectSessions(selected);
  }, [selected, pinned, recent, historyMap, projectMap, msgMap]);

  const grouped = useMemo(() => groupByRecency(panelContent), [panelContent]);
  const isEmpty = panelContent.length === 0;

  const panelTitle = selected === 'pinned' ? 'Pinned'
    : selected === 'recent' ? 'Recently Opened'
    : sidebarProjects.find(p => p.name === selected)?.displayName ?? selected;

  function toggleSidebar() {
    const panel = sidebarPanelRef.current;
    if (!panel) return;
    if (collapsedRef.current) { panel.expand(); } else { panel.collapse(); }
  }

  // Below `md`, default to the collapsed icon rail rather than eating ~220px of a
  // narrow viewport — the resizable panel's own pixel-based auto-shrink only kicked
  // in at extreme widths and did so abruptly. This only fires once per breakpoint
  // crossing so it never fights a manual toggle afterwards.
  useEffect(() => {
    const mql = window.matchMedia('(max-width: 767px)');
    const collapseForMobile = () => {
      if (mql.matches && !collapsedRef.current) toggleSidebar();
    };
    collapseForMobile();
    mql.addEventListener('change', collapseForMobile);
    return () => mql.removeEventListener('change', collapseForMobile);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="flex flex-col h-screen overflow-hidden">
      <Group orientation="horizontal" className="flex-1 overflow-hidden">
        {/* Resizable sidebar */}
        <Panel
          id="home-sidebar"
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

          {/* Sidebar nav items */}
          <div className="flex-1 overflow-y-auto px-2 pt-3 space-y-0.5">
            {/* Fixed items */}
            {([
              { id: 'pinned', label: 'Pinned', icon: Pin, count: pinned.length },
              { id: 'recent', label: 'Recent', icon: Clock, count: recent.length },
            ] as const).map(({ id, label, icon: Icon, count }) => (
              <SidebarNavItem
                key={id}
                active={selected === id}
                collapsed={sidebarCollapsed}
                onClick={() => setSelected(id)}
                icon={<Icon className="h-4 w-4" />}
                label={label}
                trailing={count > 0 ? count : undefined}
              />
            ))}

            {/* Projects */}
            {sidebarProjects.length > 0 && !sidebarCollapsed && (
              <div className="mt-3 pt-3 border-t border-sidebar-border/50">
                <p className="px-2.5 pb-1 text-[10px] font-semibold uppercase tracking-wider text-sidebar-foreground/40">
                  Projects
                </p>
                {sidebarProjects.map(({ name, displayName, count, latest }) => (
                  <SidebarNavItem
                    key={name}
                    active={selected === name}
                    onClick={() => setSelected(name)}
                    title={name}
                    accentVar={projectColorVar(name)}
                    icon={
                      <span
                        className="h-1.5 w-1.5 rounded-full shrink-0"
                        style={{ backgroundColor: `var(${projectColorVar(name)})` }}
                      />
                    }
                    label={displayName}
                    trailing={timeAgo(latest)}
                  />
                ))}
              </div>
            )}

            {/* Projects icon-only when collapsed */}
            {sidebarProjects.length > 0 && sidebarCollapsed && (
              <div className="mt-2 pt-2 border-t border-sidebar-border/50 space-y-0.5">
                {sidebarProjects.map(({ name, displayName }) => (
                  <SidebarNavItem
                    key={name}
                    active={selected === name}
                    collapsed
                    onClick={() => setSelected(name)}
                    title={name}
                    icon={
                      <span
                        className="h-2 w-2 rounded-full"
                        style={{ backgroundColor: `var(${projectColorVar(name)})` }}
                      />
                    }
                    label={displayName}
                  />
                ))}
              </div>
            )}
          </div>

          {/* Footer — settings that live below the scrollable nav list, not lost among it */}
          <div className="px-2 py-2 border-t border-sidebar-border/50">
            <SidebarNavItem
              active={showSourceSettings}
              collapsed={sidebarCollapsed}
              onClick={() => setShowSourceSettings(o => !o)}
              icon={<Settings className="h-4 w-4" />}
              label="Data Sources"
              title="Data Sources"
            />
          </div>
        </Panel>

        {/* Drag handle */}
        <Separator className="shrink-0 bg-sidebar-border hover:bg-primary/40 cursor-col-resize transition-colors data-[orientation=horizontal]:w-1" />

        {/* Main content */}
        <Panel id="home-main" minSize={300} className="flex flex-col overflow-hidden">
          <NavBarTabs
            activePage="home"
            rightSlot={<SourceSwitcher initialSourceId={sourceId} />}
          />
          <div className="flex-1 overflow-y-auto">
            <div className="max-w-[1800px] mx-auto px-6 py-8">
              <h2 className="text-sm font-semibold mb-5 truncate">{panelTitle}</h2>

              {showSourceSettings && (
                <div className="mb-6">
                  <SourcePathsSettings />
                </div>
              )}

              {isEmpty ? (
                <div className="text-center py-16 text-muted-foreground">
                  <Layers className="h-8 w-8 mx-auto mb-3 opacity-20" />
                  <p className="text-sm">No sessions here yet</p>
                </div>
              ) : (
                <>
                  <SessionGroup label="Today" sessions={grouped.today} msgMap={msgMap} projectNameMap={projectNameMap} />
                  <SessionGroup label="This week" sessions={grouped.week} msgMap={msgMap} projectNameMap={projectNameMap} />
                  <SessionGroup label="Older" sessions={grouped.older} msgMap={msgMap} projectNameMap={projectNameMap} />
                </>
              )}
            </div>
          </div>
        </Panel>
      </Group>
    </div>
  );
}

function timeAgo(ms: number): string {
  const diff = Date.now() - ms;
  const d = Math.floor(diff / 86_400_000);
  if (d < 1) return 'today';
  if (d < 7) return `${d}d`;
  const w = Math.floor(d / 7);
  if (w < 5) return `${w}w`;
  return `${Math.floor(d / 30)}mo`;
}
