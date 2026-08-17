import { NextRequest, NextResponse } from 'next/server';
import { listSkills, syncSkillRegistry } from '@/lib/services/skill-registry';
import { resolveSourceFromRequest } from '@/lib/api/resolve-source';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  try {
    const url = new URL(req.url);
    const project = url.searchParams.get('project') || undefined;
    const sourceId = await resolveSourceFromRequest(req);
    const skills = listSkills({ project }, sourceId);
    return NextResponse.json({ skills });
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const sourceId = await resolveSourceFromRequest(req);
    const synced = syncSkillRegistry(sourceId);
    return NextResponse.json({ synced });
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
