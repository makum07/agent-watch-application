import { NextRequest, NextResponse } from 'next/server';
import { getAutoSave } from '@/lib/services/workspace-snapshots';

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ sessionId: string }> }
) {
  const { sessionId } = await params;
  const snapshot = getAutoSave(sessionId);
  if (!snapshot) return NextResponse.json({ error: 'No snapshot found' }, { status: 404 });
  return NextResponse.json(snapshot);
}
