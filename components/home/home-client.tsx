'use client';

import { useState, useMemo, useRef } from 'react';
import { Pin, Clock, FolderOpen, Layers, PanelLeftClose, PanelLeftOpen } from 'lucide-react';
import { SessionCard } from './session-card';
import { LocalDate } from './local-date';
import { SourceSwitcher } from '@/components/source-switcher';
import { NavBar } from '@/components/shared/navbar';
import Link from 'next/link';
import { cn } from '@/lib/utils';
import type { SessionHistory } from '@/types/history';
import { Group, Panel, Separator, usePanelRef } from 'react-resizable-panels';
import type { PanelImperativeHandle } from 'react-resizable-panels';

type PanelSession =
  | { kind: 'history'; data: SessionHistory }
  | { kind: 'discovered'; id: string; lastModified: string; label: string };

interface DiscoveredSession {
  id: string;
  filePath: string;
  lastModified: string;
  projectDisplayName?: string;
}

interface Props {
  pinned: SessionHistory[];
  recent: SessionHistory[];
  byProject: [string, DiscoveredSession[]][];
  historyMap: [string, SessionHistory][];
  firstUserMessages: [string, string | null][];
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

function PanelSessionCard({ session }: { session: PanelSession }) {
  if (session.kind === 'history') return <SessionCard session={session.data} />;
  return (
    <Link href={`/session/${session.id}/workspace`}>
      <div className="p-3 rounded-lg border border-border hover:bg-accent/50 transition-colors cursor-pointer group">
        <div className="text-xs truncate group-hover:text-foreground text-muted-foreground">{session.label}</div>
        <div className="text-xs text-muted-foreground mt-0.5">
          <LocalDate iso={session.lastModified} />
        </div>
      </div>
    </Link>
  );
}

function SessionGroup({ label, sessions }: { label: string; sessions: PanelSession[] }) {
  if (sessions.length === 0) return null;
  return (
    <div>
      <div className="text-[10px] font-medium text-muted-foreground uppercase tracking-wider mb-2">{label}</div>
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2 mb-5">
        {sessions.map(s => (
          <PanelSessionCard key={s.kind === 'history' ? s.data.sessionId : s.id} session={s} />
        ))}
      </div>
    </div>
  );
}

export function HomeClient({ pinned, recent, byProject, historyMap: historyMapArr, firstUserMessages, totalSessions, sourceId }: Props) {
  const [selected, setSelected] = useState<Selection>('recent');
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const sidebarPanelRef = usePanelRef();
  const collapsedRef = useRef(false);

  const historyMap = useMemo(() => new Map(historyMapArr), [historyMapArr]);
  const msgMap = useMemo(() => new Map(firstUserMessages), [firstUserMessages]);
  const projectMap = useMemo(() => new Map(byProject), [byProject]);

  function getProjectSessions(projectName: string): PanelSession[] {
    const sessions = projectMap.get(projectName) ?? [];
    return sessions
      .map((s): PanelSession => {
        const h = historyMap.get(s.id);
        if (h) return { kind: 'history', data: h };
        return { kind: 'discovered', id: s.id, lastModified: s.lastModified, label: msgMap.get(s.id) ?? `${s.id.slice(0, 8)}…` };
      })
      .sort((a, b) => getTimestamp(b) - getTimestamp(a));
  }

  const sidebarProjects = useMemo(() => {
    const items = byProject.map(([name, sessions]) => {
      const latest = sessions.reduce((best, s) => {
        const t = new Date(s.lastModified).getTime();
        return t > best ? t : best;
      }, 0);
      return { name, count: sessions.length, latest };
    }).sort((a, b) => b.latest - a.latest);

    if (items.length > 1) {
      const names = items.map(i => i.name);
      let prefix = '';
      const first = names[0];
      for (let i = 0; i < first.length; i++) {
        const ch = first.slice(0, i + 1);
        if (names.every(n => n.startsWith(ch))) prefix = ch;
        else break;
      }
      const dashIdx = prefix.lastIndexOf('-');
      const stripPrefix = dashIdx > 0 ? prefix.slice(0, dashIdx + 1) : '';
      if (stripPrefix && items.every(i => i.name !== stripPrefix.slice(0, -1))) {
        return items.map(i => ({ ...i, displayName: i.name.slice(stripPrefix.length) || i.name }));
      }
    }
    return items.map(i => ({ ...i, displayName: i.name }));
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

  return (
    <div className="flex flex-col h-screen overflow-hidden">
      <NavBar
        activePage="home"
        rightSlot={<SourceSwitcher initialSourceId={sourceId} />}
      />

      <Group orientation="horizontal" className="flex-1 overflow-hidden">
        {/* Resizable sidebar */}
        <Panel
          id="home-sidebar"
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
          {/* Sidebar header with toggle */}
          <div className={cn('flex items-center px-2 py-3 shrink-0', sidebarCollapsed ? 'justify-center' : 'justify-end')}>
            <button
              onClick={toggleSidebar}
              className="h-7 w-7 flex items-center justify-center rounded-md text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
            >
              {sidebarCollapsed
                ? <PanelLeftOpen className="h-4 w-4" />
                : <PanelLeftClose className="h-4 w-4" />}
            </button>
          </div>

          {/* Sidebar nav items */}
          <div className="flex-1 overflow-y-auto px-2 space-y-0.5">
            {/* Fixed items */}
            {([
              { id: 'pinned', label: 'Pinned', icon: Pin, count: pinned.length },
              { id: 'recent', label: 'Recent', icon: Clock, count: recent.length },
            ] as const).map(({ id, label, icon: Icon, count }) => (
              <button
                key={id}
                onClick={() => setSelected(id)}
                className={cn(
                  'w-full flex items-center gap-2 px-2 py-1.5 rounded-md text-sm transition-colors',
                  selected === id
                    ? 'bg-muted text-foreground font-medium'
                    : 'text-muted-foreground hover:text-foreground hover:bg-muted/60',
                )}
                title={sidebarCollapsed ? label : undefined}
              >
                <Icon className="h-4 w-4 shrink-0" />
                {!sidebarCollapsed && (
                  <>
                    <span className="truncate">{label}</span>
                    {count > 0 && <span className="ml-auto text-xs opacity-60">{count}</span>}
                  </>
                )}
              </button>
            ))}

            {/* Projects */}
            {sidebarProjects.length > 0 && !sidebarCollapsed && (
              <div className="pt-3">
                <p className="px-2 pb-1 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground/60">
                  Projects
                </p>
                {sidebarProjects.map(({ name, displayName, count, latest }) => (
                  <button
                    key={name}
                    onClick={() => setSelected(name)}
                    className={cn(
                      'w-full flex items-center gap-2 px-2 py-1.5 rounded-md text-sm transition-colors',
                      selected === name
                        ? 'bg-muted text-foreground font-medium'
                        : 'text-muted-foreground hover:text-foreground hover:bg-muted/60',
                    )}
                  >
                    <FolderOpen className="h-4 w-4 shrink-0" />
                    <span className="truncate">{displayName}</span>
                    <span className="ml-auto text-xs opacity-60 shrink-0">{timeAgo(latest)}</span>
                  </button>
                ))}
              </div>
            )}

            {/* Projects icon-only when collapsed */}
            {sidebarProjects.length > 0 && sidebarCollapsed && (
              <div className="pt-2 space-y-0.5">
                {sidebarProjects.map(({ name, displayName }) => (
                  <button
                    key={name}
                    onClick={() => setSelected(name)}
                    title={displayName}
                    className={cn(
                      'w-full flex items-center justify-center py-1.5 rounded-md transition-colors',
                      selected === name
                        ? 'bg-muted text-foreground'
                        : 'text-muted-foreground hover:text-foreground hover:bg-muted/60',
                    )}
                  >
                    <FolderOpen className="h-4 w-4" />
                  </button>
                ))}
              </div>
            )}
          </div>
        </Panel>

        {/* Drag handle */}
        <Separator className="shrink-0 bg-border hover:bg-primary/40 cursor-col-resize transition-colors data-[orientation=horizontal]:w-1" />

        {/* Main content */}
        <Panel id="home-main" minSize={300} className="overflow-y-auto">
          <div className="max-w-5xl mx-auto px-6 py-8">
            <h2 className="text-sm font-semibold mb-5 truncate">{panelTitle}</h2>
            {isEmpty ? (
              <div className="text-center py-16 text-muted-foreground">
                <Layers className="h-8 w-8 mx-auto mb-3 opacity-20" />
                <p className="text-sm">No sessions here yet</p>
              </div>
            ) : (
              <>
                <SessionGroup label="Today" sessions={grouped.today} />
                <SessionGroup label="This week" sessions={grouped.week} />
                <SessionGroup label="Older" sessions={grouped.older} />
              </>
            )}
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
