import { NextRequest, NextResponse } from 'next/server';
import { discoverSessions } from '@/lib/services/session-ingester';
import { listSessionHistory } from '@/lib/services/session-history';

export async function GET(req: NextRequest) {
  try {
    const sourceId = req.nextUrl.searchParams.get('source') ?? undefined;
    const discovered = discoverSessions(sourceId);
    const history = listSessionHistory({ limit: 200 }, sourceId);

    const historyMap = new Map(history.map(h => [h.sessionId, h]));

    const sessions = discovered.map(s => ({
      id: s.id,
      filePath: s.filePath,
      projectPath: s.projectPath,
      projectDisplayName: s.projectDisplayName,
      created: s.created,
      lastModified: s.lastModified,
      history: historyMap.get(s.id) || null,
    }));

    return NextResponse.json({ sessions, total: sessions.length });
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
