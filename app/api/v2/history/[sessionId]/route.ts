import { NextRequest, NextResponse } from 'next/server';
import { getSessionHistory, updateSessionHistory } from '@/lib/services/session-history';

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ sessionId: string }> }
) {
  const { sessionId } = await params;
  const sourceId = req.nextUrl.searchParams.get('source') ?? undefined;
  const history = getSessionHistory(sessionId, sourceId);
  if (!history) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  return NextResponse.json(history);
}

export async function PUT(
  req: NextRequest,
  { params }: { params: Promise<{ sessionId: string }> }
) {
  try {
    const { sessionId } = await params;
    const sourceId = req.nextUrl.searchParams.get('source') ?? undefined;
    const body = await req.json();
    const updated = updateSessionHistory(sessionId, body, sourceId);
    if (!updated) return NextResponse.json({ error: 'Not found' }, { status: 404 });
    return NextResponse.json(updated);
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
