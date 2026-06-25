import { NextRequest, NextResponse } from 'next/server';
import { ingestSession, forceReindex } from '@/lib/services/session-ingester';
import { recordSessionOpen } from '@/lib/services/session-history';

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const sourceId = req.nextUrl.searchParams.get('source') ?? undefined;
    const session = ingestSession(id, sourceId);

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
