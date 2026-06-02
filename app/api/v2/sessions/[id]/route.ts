import { NextRequest, NextResponse } from 'next/server';
import { ingestSession } from '@/lib/services/session-ingester';
import { recordSessionOpen } from '@/lib/services/session-history';

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const session = ingestSession(id);

    if (!session) {
      return NextResponse.json({ error: 'Session not found' }, { status: 404 });
    }

    recordSessionOpen(session);

    return NextResponse.json(session);
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
