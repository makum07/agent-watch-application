import { NextRequest, NextResponse } from 'next/server';
import { getAutoSave } from '@/lib/services/workspace-snapshots';
import { resolveSessionSource } from '@/lib/api/resolve-source';

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ sessionId: string }> }
) {
  const { sessionId } = await params;
  const sourceId = await resolveSessionSource(req, sessionId);
  const snapshot = getAutoSave(sessionId, sourceId);
  if (!snapshot) return NextResponse.json({ error: 'No snapshot found' }, { status: 404 });
  return NextResponse.json(snapshot);
}
