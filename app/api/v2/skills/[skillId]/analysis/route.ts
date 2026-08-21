import { NextRequest, NextResponse } from 'next/server';
import { getDatabase } from '@/lib/db/database';
import {
  listAnalysisCycles,
  getSkillDetail,
  getNextCycleNumber,
  createAnalysisCycle,
} from '@/lib/services/skill-registry';
import { generateAnalysisPrompt, generatePromptPreview, runSkillAnalysis } from '@/lib/services/self-healing-controller';
import { resolveSourceFromRequest } from '@/lib/api/resolve-source';

export const dynamic = 'force-dynamic';

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ skillId: string }> }
) {
  try {
    const { skillId } = await params;
    const sourceId = await resolveSourceFromRequest(req);

    const preview = req.nextUrl.searchParams.get('preview');
    if (preview === '1') {
      const prompt = generatePromptPreview(skillId, sourceId);
      if (!prompt) return NextResponse.json({ error: 'Skill not found' }, { status: 404 });
      return NextResponse.json({ prompt });
    }

    const cycles = listAnalysisCycles(skillId, sourceId);
    return NextResponse.json({ cycles });
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ skillId: string }> }
) {
  try {
    const { skillId } = await params;
    const sourceId = await resolveSourceFromRequest(req);
    let customPrompt: string | undefined;
    let model: string | undefined;

    try {
      const body = await req.json();
      customPrompt = body.customPrompt;
      model = body.model;
    } catch {
      // No body — that's fine
    }

    const detail = getSkillDetail(skillId, sourceId);
    if (!detail) {
      return NextResponse.json({ error: 'Skill not found' }, { status: 404 });
    }

    const cycleNumber = getNextCycleNumber(skillId, sourceId);
    const prompt = customPrompt || generatePromptPreview(skillId, sourceId) || generateAnalysisPrompt(detail.skill, detail);

    const sessionIds = [...new Set(detail.recentExecutions.map(e => e.sessionId))];
    const db = getDatabase(sourceId);
    const fbRows = db.prepare(`
      SELECT fi.id FROM feedback_items fi
      INNER JOIN skill_executions se ON fi.session_id = se.session_id AND fi.agent_id = se.agent_id
      WHERE se.skill_id = ?
    `).all(skillId) as Array<{ id: string }>;
    const feedbackIds = fbRows.map(r => r.id);

    const cycle = createAnalysisCycle(skillId, cycleNumber, 'manual', prompt, sessionIds, feedbackIds, sourceId);

    setImmediate(() => {
      runSkillAnalysis(cycle.id, skillId, customPrompt, sourceId, model).catch(err => {
        console.error('Skill analysis failed:', err);
      });
    });

    return NextResponse.json(cycle, { status: 201 });
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
