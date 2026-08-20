import { NextRequest, NextResponse } from 'next/server';
import { getDatabase } from '@/lib/db/database';
import { resolveSessionSource } from '@/lib/api/resolve-source';
import { cancelJob } from '@/lib/services/job-control';

export const dynamic = 'force-dynamic';

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string; cycleId: string }> }
) {
  try {
    const { id: sessionId, cycleId } = await params;
    const sourceId = await resolveSessionSource(req, sessionId);
    const db = getDatabase(sourceId);

    let action: string | undefined;
    try {
      const body = await req.json();
      action = body.action;
    } catch { /* no body */ }

    if (action !== 'cancel') {
      return NextResponse.json({ error: 'Unsupported action' }, { status: 400 });
    }

    const cycle = db.prepare(
      'SELECT status FROM execution_analysis_cycles WHERE id = ? AND session_id = ?'
    ).get(cycleId, sessionId) as { status: string } | undefined;
    if (!cycle) return NextResponse.json({ error: 'Cycle not found' }, { status: 404 });

    if (cycle.status !== 'analyzing') {
      return NextResponse.json({ error: 'Cycle is not running' }, { status: 400 });
    }

    const killed = cancelJob(cycleId);
    if (!killed) {
      return NextResponse.json({ error: 'No running process found for this cycle — it may have just finished' }, { status: 409 });
    }

    return NextResponse.json({ ok: true, status: 'cancelling' });
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
