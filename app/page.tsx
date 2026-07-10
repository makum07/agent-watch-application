import { cookies } from 'next/headers';
import { listSessionHistory } from '@/lib/services/session-history';
import { discoverSessions } from '@/lib/services/session-ingester';
import { extractFirstUserMessage } from '@/lib/parser/agent-correlator';
import { getDefaultSource } from '@/lib/sources';
import { HomeClient } from '@/components/home/home-client';

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
      listSessionHistory({ pinned: true, limit: 20 }, sourceId),
      listSessionHistory({ limit: 20 }, sourceId),
      listSessionHistory({ limit: 10000 }, sourceId),
      discoverSessions(sourceId),
    ]);
  } catch {
    // DB may not be ready on first run
  }

  const historyMap = new Map(allHistory.map(s => [s.sessionId, s]));

  // Group discovered sessions by project
  const byProjectMap = new Map<string, typeof allDiscovered>();
  for (const s of allDiscovered) {
    const key = s.projectDisplayName || 'Unknown';
    if (!byProjectMap.has(key)) byProjectMap.set(key, []);
    byProjectMap.get(key)!.push(s);
  }

  return (
    <HomeClient
      pinned={pinned}
      recent={recent}
      byProject={Array.from(byProjectMap.entries())}
      historyMap={Array.from(historyMap.entries())}
      firstUserMessages={allDiscovered.map(s => [s.id, extractFirstUserMessage(s.filePath)])}
      totalSessions={allDiscovered.length}
      sourceId={sourceId}
    />
  );
}
