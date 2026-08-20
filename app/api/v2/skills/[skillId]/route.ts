import { NextRequest, NextResponse } from 'next/server';
import { getSkillDetail, updateSkillConfig } from '@/lib/services/skill-registry';
import { resolveSourceFromRequest } from '@/lib/api/resolve-source';

export const dynamic = 'force-dynamic';

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ skillId: string }> }
) {
  try {
    const { skillId } = await params;
    const sourceId = await resolveSourceFromRequest(req);
    const detail = getSkillDetail(skillId, sourceId);
    if (!detail) {
      return NextResponse.json({ error: 'Skill not found' }, { status: 404 });
    }
    return NextResponse.json({
      ...detail,
      // Extracted text can be large (uncapped by design) — the UI only
      // needs filename/size/date, so keep it out of the browser payload.
      contextFiles: detail.contextFiles.map(({ extractedText, ...summary }) => {
        void extractedText;
        return summary;
      }),
      projectContextFiles: detail.projectContextFiles.map(({ extractedText, ...summary }) => {
        void extractedText;
        return summary;
      }),
    });
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ skillId: string }> }
) {
  try {
    const { skillId } = await params;
    const sourceId = await resolveSourceFromRequest(req);
    const body = await req.json();

    const updates: Record<string, unknown> = {};
    if (body.selfHealingEnabled !== undefined) updates.selfHealingEnabled = body.selfHealingEnabled;
    if (body.selfHealingMode !== undefined) updates.selfHealingMode = body.selfHealingMode;
    if (body.selfHealingThreshold !== undefined) updates.selfHealingThreshold = body.selfHealingThreshold;
    if (body.description !== undefined) updates.description = body.description;

    const skill = updateSkillConfig(skillId, updates, sourceId);
    if (!skill) {
      return NextResponse.json({ error: 'Skill not found' }, { status: 404 });
    }
    return NextResponse.json(skill);
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
