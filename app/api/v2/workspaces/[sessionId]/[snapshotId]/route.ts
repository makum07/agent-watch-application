import { NextRequest, NextResponse } from 'next/server';
import { deleteSnapshot } from '@/lib/services/workspace-snapshots';

export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ sessionId: string; snapshotId: string }> }
) {
  const { snapshotId } = await params;
  const deleted = deleteSnapshot(snapshotId);
  if (!deleted) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  return NextResponse.json({ ok: true });
}
