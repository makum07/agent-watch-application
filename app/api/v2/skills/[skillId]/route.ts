import { NextRequest, NextResponse } from 'next/server';
import { getSkillDetail, updateSkillConfig } from '@/lib/services/skill-registry';

export const dynamic = 'force-dynamic';

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ skillId: string }> }
) {
  try {
    const { skillId } = await params;
    const detail = getSkillDetail(skillId);
    if (!detail) {
      return NextResponse.json({ error: 'Skill not found' }, { status: 404 });
    }
    return NextResponse.json(detail);
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
    const body = await req.json();

    const updates: Record<string, unknown> = {};
    if (body.selfHealingEnabled !== undefined) updates.selfHealingEnabled = body.selfHealingEnabled;
    if (body.selfHealingMode !== undefined) updates.selfHealingMode = body.selfHealingMode;
    if (body.selfHealingThreshold !== undefined) updates.selfHealingThreshold = body.selfHealingThreshold;
    if (body.description !== undefined) updates.description = body.description;

    const skill = updateSkillConfig(skillId, updates);
    if (!skill) {
      return NextResponse.json({ error: 'Skill not found' }, { status: 404 });
    }
    return NextResponse.json(skill);
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
