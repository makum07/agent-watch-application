import { NextRequest, NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { ingestSession, forceReindex } from '@/lib/services/session-ingester';
import { recordSessionOpen } from '@/lib/services/session-history';
import { getSources } from '@/lib/sources';

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    // Prefer explicit ?source= param, then cookie, then search all sources
    const paramSource = req.nextUrl.searchParams.get('source') ?? undefined;
    const cookieStore = await cookies();
    const cookieSource = cookieStore.get('aw-source')?.value ?? undefined;

    let sourceId = paramSource ?? cookieSource;
    let session = ingestSession(id, sourceId);

    // If not found under resolved source, try all other sources
    if (!session) {
      const allSources = getSources();
      for (const src of allSources) {
        if (src.id === sourceId) continue;
        const s = ingestSession(id, src.id);
        if (s) { session = s; sourceId = src.id; break; }
      }
    }

    if (!session) {
      return NextResponse.json({ error: 'Session not found' }, { status: 404 });
    }

    recordSessionOpen(session, sourceId);

    return NextResponse.json(session);
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}

export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const sourceId = req.nextUrl.searchParams.get('source') ?? undefined;
    const session = forceReindex(id, sourceId);

    if (!session) {
      return NextResponse.json({ error: 'Session not found' }, { status: 404 });
    }

    return NextResponse.json({ reindexed: true, agentCount: session.agents.length });
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
