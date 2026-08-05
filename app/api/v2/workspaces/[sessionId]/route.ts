import { NextRequest, NextResponse } from 'next/server';
import { listNamedSnapshots, saveSnapshot } from '@/lib/services/workspace-snapshots';
import { resolveSessionSource } from '@/lib/api/resolve-source';
import type { WorkspaceSnapshot } from '@/types/workspace';

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ sessionId: string }> }
) {
  const { sessionId } = await params;
  const sourceId = await resolveSessionSource(req, sessionId);
  const snapshots = listNamedSnapshots(sessionId, sourceId);
  return NextResponse.json({ snapshots });
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ sessionId: string }> }
) {
  try {
    const { sessionId } = await params;
    const sourceId = await resolveSessionSource(req, sessionId);
    const snapshot: WorkspaceSnapshot = await req.json();
    snapshot.sessionId = sessionId;
    const saved = saveSnapshot(snapshot, sourceId);
    return NextResponse.json(saved);
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
