import { NextRequest, NextResponse } from 'next/server';
import { ingestSession } from '@/lib/services/session-ingester';

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

    return NextResponse.json({ agents: session.agents });
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
