import { cookies } from 'next/headers';
import { listSessionHistory } from '@/lib/services/session-history';
import { discoverSessions } from '@/lib/services/session-ingester';
import { extractFirstUserMessage } from '@/lib/parser/agent-correlator';
import { getDefaultSource } from '@/lib/sources';
import { SessionCard } from '@/components/home/session-card';
import { SessionSearch } from '@/components/home/session-search';
import { OpenById } from '@/components/home/open-by-id';
import { LocalDate } from '@/components/home/local-date';
import { SourceSwitcher } from '@/components/source-switcher';
import { Pin, Activity, Layers, FolderOpen, Sparkles } from 'lucide-react';
import Link from 'next/link';

export const dynamic = 'force-dynamic';

export default async function HomePage() {
  const cookieStore = await cookies();
  const sourceId = cookieStore.get('aw-source')?.value ?? getDefaultSource().id;

  let pinned: Awaited<ReturnType<typeof listSessionHistory>> = [];
  let recent: Awaited<ReturnType<typeof listSessionHistory>> = [];
  let allHistory: Awaited<ReturnType<typeof listSessionHistory>> = [];
  let allDiscovered: Awaited<ReturnType<typeof discoverSessions>> = [];

  try {
    [pinned, recent, allHistory, allDiscovered] = await Promise.all([
      listSessionHistory({ pinned: true, limit: 10 }, sourceId),
      listSessionHistory({ limit: 50 }, sourceId),
      listSessionHistory({ limit: 10000 }, sourceId),
      discoverSessions(sourceId),
    ]);
  } catch {
    // DB may not be ready on first run
  }

  // Build a full history map for O(1) lookups in "All Sessions by Project"
  const historyMap = new Map(allHistory.map(s => [s.sessionId, s]));

  // Group discovered sessions by project display name
  const byProject = new Map<string, typeof allDiscovered>();
  for (const s of allDiscovered) {
    const key = s.projectDisplayName || 'Unknown';
    if (!byProject.has(key)) byProject.set(key, []);
    byProject.get(key)!.push(s);
  }

  const recentIds = new Set(recent.map(s => s.sessionId));

  return (
    <div className="min-h-screen bg-background">
      <header className="border-b border-border sticky top-0 z-10 bg-background/95 backdrop-blur">
        <div className="max-w-6xl mx-auto px-6 py-4 flex items-center gap-4">
          <div className="flex items-center gap-2">
            <Layers className="h-5 w-5 text-primary" />
            <span className="font-semibold text-lg">AgentWatch</span>
          </div>
          <Link
            href="/skills"
            className="flex items-center gap-1.5 text-xs text-[#8b949e] hover:text-[#e6edf3] px-2 py-1 rounded hover:bg-[#21262d] transition-colors"
          >
            <Sparkles className="h-3.5 w-3.5 text-[#d2a8ff]" />
            Skills
          </Link>
          <SourceSwitcher initialSourceId={sourceId} />
          <div className="flex-1 max-w-md">
            <SessionSearch />
          </div>
          <div className="flex items-center gap-1 text-xs text-muted-foreground">
            <Activity className="h-3.5 w-3.5" />
            <span>{allDiscovered.length} sessions discovered</span>
          </div>
        </div>
      </header>

      <main className="max-w-6xl mx-auto px-6 py-8 space-y-8">
        <section>
          <h2 className="text-xs font-medium text-muted-foreground mb-2 uppercase tracking-wide">Open by ID</h2>
          <div className="max-w-md">
            <OpenById />
          </div>
        </section>

        {pinned.length > 0 && (
          <section>
            <div className="flex items-center gap-2 mb-3">
              <Pin className="h-4 w-4 text-primary" />
              <h2 className="text-sm font-semibold">Pinned</h2>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
              {pinned.map(s => <SessionCard key={s.sessionId} session={s} />)}
            </div>
          </section>
        )}

        {recent.length > 0 && (
          <section>
            <div className="flex items-center gap-2 mb-3">
              <Activity className="h-4 w-4 text-muted-foreground" />
              <h2 className="text-sm font-semibold">Recently Opened</h2>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
              {recent.map(s => <SessionCard key={s.sessionId} session={s} />)}
            </div>
          </section>
        )}

        {/* Sessions grouped by project */}
        {byProject.size > 0 && (
          <section>
            <div className="flex items-center gap-2 mb-4">
              <FolderOpen className="h-4 w-4 text-muted-foreground" />
              <h2 className="text-sm font-semibold">All Sessions by Project</h2>
            </div>
            <div className="space-y-6">
              {Array.from(byProject.entries()).map(([project, sessions]) => (
                <div key={project}>
                  <div className="flex items-center gap-2 mb-2">
                    <span className="text-xs font-medium text-muted-foreground bg-muted px-2 py-0.5 rounded font-mono">
                      {project}
                    </span>
                    <span className="text-xs text-muted-foreground">{sessions.length} session{sessions.length !== 1 ? 's' : ''}</span>
                  </div>
                  <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-2">
                    {sessions.map(s => {
                      const historyEntry = historyMap.get(s.id);
                      if (historyEntry) {
                        return <SessionCard key={s.id} session={historyEntry} />;
                      }
                      const label = extractFirstUserMessage(s.filePath) ?? `${s.id.slice(0, 8)}…`;
                      return (
                        <Link key={s.id} href={`/session/${s.id}/workspace`}>
                          <div className="p-3 rounded-lg border border-border hover:bg-accent/50 transition-colors cursor-pointer group">
                            <div className="text-xs text-muted-foreground truncate group-hover:text-foreground">
                              {label}
                            </div>
                            <div className="text-xs text-muted-foreground mt-0.5">
                              <LocalDate iso={s.lastModified} />
                            </div>
                          </div>
                        </Link>
                      );
                    })}
                  </div>
                </div>
              ))}
            </div>
          </section>
        )}

        {allDiscovered.length === 0 && (
          <div className="text-center py-16 text-muted-foreground">
            <Layers className="h-12 w-12 mx-auto mb-4 opacity-20" />
            <p className="text-sm font-medium">No sessions found</p>
            <p className="text-xs mt-1">Start a Claude Code session, then refresh this page</p>
          </div>
        )}
      </main>
    </div>
  );
}
