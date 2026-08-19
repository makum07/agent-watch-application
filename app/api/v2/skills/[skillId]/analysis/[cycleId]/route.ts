import { NextRequest, NextResponse } from 'next/server';
import {
  getAnalysisCycle,
  updateAnalysisCycle,
  deleteAnalysisCycle,
} from '@/lib/services/skill-registry';
import { applySkillFix } from '@/lib/services/self-healing-controller';
import { resolveSourceFromRequest } from '@/lib/api/resolve-source';
import { cancelJob } from '@/lib/services/job-control';

export const dynamic = 'force-dynamic';

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ skillId: string; cycleId: string }> }
) {
  try {
    const { cycleId } = await params;
    const sourceId = await resolveSourceFromRequest(req);
    const cycle = getAnalysisCycle(cycleId, sourceId);
    if (!cycle) {
      return NextResponse.json({ error: 'Cycle not found' }, { status: 404 });
    }
    return NextResponse.json(cycle);
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ skillId: string; cycleId: string }> }
) {
  try {
    const { skillId, cycleId } = await params;
    const sourceId = await resolveSourceFromRequest(req);
    const cycle = getAnalysisCycle(cycleId, sourceId);

    if (!cycle) {
      return NextResponse.json({ error: 'Cycle not found' }, { status: 404 });
    }

    if (cycle.status !== 'awaiting_review') {
      return NextResponse.json({ error: 'Cycle is not awaiting review' }, { status: 400 });
    }

    let fixPrompt = cycle.fixPrompt;
    let model: string | undefined;
    try {
      const body = await req.json();
      if (body.fixPrompt) fixPrompt = body.fixPrompt;
      model = body.model;
    } catch {
      // No body — use existing fix prompt
    }

    if (!fixPrompt) {
      return NextResponse.json({ error: 'No fix prompt available' }, { status: 400 });
    }

    updateAnalysisCycle(cycleId, { fixPrompt, status: 'applying' }, sourceId);

    setImmediate(() => {
      applySkillFix(cycleId, skillId, fixPrompt!, sourceId, model).catch(err => {
        console.error('Fix application failed:', err);
      });
    });

    return NextResponse.json({ status: 'applying' });
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ skillId: string; cycleId: string }> }
) {
  try {
    const { cycleId } = await params;
    const sourceId = await resolveSourceFromRequest(req);

    let action: string | undefined;
    try {
      const body = await req.json();
      action = body.action;
    } catch { /* no body */ }

    if (action !== 'cancel') {
      return NextResponse.json({ error: 'Unsupported action' }, { status: 400 });
    }

    const cycle = getAnalysisCycle(cycleId, sourceId);
    if (!cycle) return NextResponse.json({ error: 'Cycle not found' }, { status: 404 });

    if (cycle.status !== 'analyzing' && cycle.status !== 'applying') {
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

export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ skillId: string; cycleId: string }> }
) {
  try {
    const { cycleId } = await params;
    const sourceId = await resolveSourceFromRequest(req);
    deleteAnalysisCycle(cycleId, sourceId);
    return NextResponse.json({ ok: true });
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
