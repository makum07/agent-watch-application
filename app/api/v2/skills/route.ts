import { NextRequest, NextResponse } from 'next/server';
import { listSkills, syncSkillRegistry } from '@/lib/services/skill-registry';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  try {
    const url = new URL(req.url);
    const project = url.searchParams.get('project') || undefined;
    const skills = listSkills({ project });
    return NextResponse.json({ skills });
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}

export async function POST() {
  try {
    const synced = syncSkillRegistry();
    return NextResponse.json({ synced });
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
