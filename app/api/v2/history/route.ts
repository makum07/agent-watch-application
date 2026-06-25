import { NextRequest, NextResponse } from 'next/server';
import { listSessionHistory, searchSessionHistory } from '@/lib/services/session-history';

export async function GET(req: NextRequest) {
  try {
    const url = new URL(req.url);
    const q = url.searchParams.get('q');
    const limit = parseInt(url.searchParams.get('limit') || '50', 10);
    const offset = parseInt(url.searchParams.get('offset') || '0', 10);
    const pinned = url.searchParams.get('pinned');
    const favorite = url.searchParams.get('favorite');

    const sourceId = url.searchParams.get('source') ?? undefined;

    if (q) {
      const results = searchSessionHistory(q, limit, sourceId);
      return NextResponse.json({ sessions: results, total: results.length });
    }

    const sessions = listSessionHistory({
      limit,
      offset,
      pinned: pinned === 'true' ? true : pinned === 'false' ? false : undefined,
      favorite: favorite === 'true' ? true : favorite === 'false' ? false : undefined,
    }, sourceId);

    return NextResponse.json({ sessions, total: sessions.length });
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
