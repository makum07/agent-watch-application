'use client';

import { useState, useMemo } from 'react';
import { Pin, Clock, FolderOpen, Layers, Wand2 } from 'lucide-react';
import { SessionCard } from './session-card';
import { SessionSearch } from './session-search';
import { LocalDate } from './local-date';
import { SourceSwitcher } from '@/components/source-switcher';
import { ThemeToggle } from '@/components/theme-toggle';
import Link from 'next/link';
import { cn } from '@/lib/utils';
import type { SessionHistory } from '@/types/history';
import {
  Sidebar,
  SidebarContent,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarInset,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarProvider,
  SidebarTrigger,
} from '@/components/ui/sidebar';

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
                      isActive={selected === 'pinned'}
                      onClick={() => setSelected('pinned')}
                      tooltip="Pinned"
                    >
                      <Pin className="h-4 w-4" />
                      <span>Pinned</span>
                      {pinned.length > 0 && (
                        <span className="ml-auto text-xs text-muted-foreground">{pinned.length}</span>
                      )}
                    </SidebarMenuButton>
                  </SidebarMenuItem>
                  <SidebarMenuItem>
                    <SidebarMenuButton
                      isActive={selected === 'recent'}
                      onClick={() => setSelected('recent')}
                      tooltip="Recent"
                    >
                      <Clock className="h-4 w-4" />
                      <span>Recent</span>
                      {recent.length > 0 && (
                        <span className="ml-auto text-xs text-muted-foreground">{recent.length}</span>
                      )}
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
                    {sidebarProjects.map(({ name, displayName, count, latest }) => (
                      <SidebarMenuItem key={name}>
                        <SidebarMenuButton
                          isActive={selected === name}
                          onClick={() => setSelected(name)}
                          tooltip={displayName}
                        >
                          <FolderOpen className="h-4 w-4 shrink-0" />
                          <span className="truncate">{displayName}</span>
                          <span className="ml-auto text-xs text-muted-foreground shrink-0">{timeAgo(latest)}</span>
                        </SidebarMenuButton>
                      </SidebarMenuItem>
                    ))}
                  </SidebarMenu>
                </SidebarGroupContent>
              </SidebarGroup>
            )}
          </SidebarContent>
      </Sidebar>

      {/* SidebarInset contains header + content */}
      <SidebarInset className="flex flex-col h-screen overflow-hidden">
        {/* Navbar */}
        <header className="border-b border-border shrink-0 bg-background/95 backdrop-blur z-10">
          <div className="px-4 py-3 grid grid-cols-3 items-center gap-4">
            {/* Left: trigger + logo + nav */}
            <div className="flex items-center gap-2 min-w-0">
              <SidebarTrigger className="shrink-0" />
              <div className="h-4 w-px bg-border shrink-0" />
              <div className="flex items-center gap-1.5 shrink-0">
                <Layers className="h-4 w-4 text-primary" />
                <div className="leading-none">
                  <div className="font-semibold text-sm">AgentWatch</div>
                  <div className="text-[10px] text-muted-foreground">{totalSessions} sessions</div>
                </div>
              </div>
              <div className="h-4 w-px bg-border mx-1 shrink-0" />
              <Link href="/skills" className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground px-2 py-1 rounded hover:bg-muted transition-colors shrink-0">
                <Wand2 className="h-3 w-3 text-primary" />
                Skills
              </Link>
            </div>
            {/* Center: search */}
            <div className="flex justify-center">
              <div className="w-full max-w-sm">
                <SessionSearch />
              </div>
            </div>
            {/* Right: utilities */}
            <div className="flex items-center justify-end gap-2">
              <SourceSwitcher initialSourceId={sourceId} />
              <ThemeToggle />
            </div>
          </div>
        </header>

        {/* Content */}
        <div className="flex-1 overflow-y-auto">
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
        </div>
      </SidebarInset>
    </SidebarProvider>
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
