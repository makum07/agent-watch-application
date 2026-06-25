import { NextRequest, NextResponse } from 'next/server';
import { discoverSessions, ingestSession } from '@/lib/services/session-ingester';
import { detectPatterns } from '@/lib/services/pattern-detector';

export async function GET(req: NextRequest) {
  try {
    const sourceId = req.nextUrl.searchParams.get('source') ?? undefined;
    const discovered = discoverSessions(sourceId).slice(0, 15);

    const sessions = discovered
      .map(s => ingestSession(s.id, sourceId))
      .filter(Boolean) as NonNullable<ReturnType<typeof ingestSession>>[];

    const patterns = detectPatterns(sessions);

    return NextResponse.json({ patterns, sessionCount: sessions.length });
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
