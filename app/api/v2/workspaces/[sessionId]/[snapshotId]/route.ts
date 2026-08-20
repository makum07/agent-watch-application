import { NextRequest, NextResponse } from 'next/server';
import { deleteSnapshot } from '@/lib/services/workspace-snapshots';
import { resolveSessionSource } from '@/lib/api/resolve-source';

export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ sessionId: string; snapshotId: string }> }
) {
  const { sessionId, snapshotId } = await params;
  const sourceId = await resolveSessionSource(req, sessionId);
  const deleted = deleteSnapshot(snapshotId, sourceId);
  if (!deleted) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  return NextResponse.json({ ok: true });
}
