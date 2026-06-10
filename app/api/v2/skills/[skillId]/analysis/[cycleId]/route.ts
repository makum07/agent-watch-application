import { NextRequest, NextResponse } from 'next/server';
import {
  getAnalysisCycle,
  updateAnalysisCycle,
  deleteAnalysisCycle,
} from '@/lib/services/skill-registry';
import { applySkillFix } from '@/lib/services/self-healing-controller';

export const dynamic = 'force-dynamic';

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ skillId: string; cycleId: string }> }
) {
  try {
    const { cycleId } = await params;
    const cycle = getAnalysisCycle(cycleId);
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
    const cycle = getAnalysisCycle(cycleId);

    if (!cycle) {
      return NextResponse.json({ error: 'Cycle not found' }, { status: 404 });
    }

    if (cycle.status !== 'awaiting_review') {
      return NextResponse.json({ error: 'Cycle is not awaiting review' }, { status: 400 });
    }

    let fixPrompt = cycle.fixPrompt;
    try {
      const body = await req.json();
      if (body.fixPrompt) fixPrompt = body.fixPrompt;
    } catch {
      // No body — use existing fix prompt
    }

    if (!fixPrompt) {
      return NextResponse.json({ error: 'No fix prompt available' }, { status: 400 });
    }

    updateAnalysisCycle(cycleId, { fixPrompt, status: 'applying' });

    setImmediate(() => {
      applySkillFix(cycleId, skillId, fixPrompt!).catch(err => {
        console.error('Fix application failed:', err);
      });
    });

    return NextResponse.json({ status: 'applying' });
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}

export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ skillId: string; cycleId: string }> }
) {
  try {
    const { cycleId } = await params;
    deleteAnalysisCycle(cycleId);
    return NextResponse.json({ ok: true });
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
