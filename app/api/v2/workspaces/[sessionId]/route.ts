import { NextRequest, NextResponse } from 'next/server';
import { listNamedSnapshots, saveSnapshot } from '@/lib/services/workspace-snapshots';
import type { WorkspaceSnapshot } from '@/types/workspace';

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ sessionId: string }> }
) {
  const { sessionId } = await params;
  const snapshots = listNamedSnapshots(sessionId);
  return NextResponse.json({ snapshots });
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ sessionId: string }> }
) {
  try {
    const { sessionId } = await params;
    const snapshot: WorkspaceSnapshot = await req.json();
    snapshot.sessionId = sessionId;
    const saved = saveSnapshot(snapshot);
    return NextResponse.json(saved);
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
