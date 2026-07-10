import { NextRequest, NextResponse } from 'next/server';
import { getDatabase } from '@/lib/db/database';
import { generateImprovementPrompt, type FeedbackItem } from '@/lib/services/improvement-prompt';
import { findInvokedSkillsFromSession } from '@/lib/services/external-dirs';
import { resolveSelectedSkills } from '@/lib/services/skill-catalog';

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id: sessionId } = await params;
    const db = getDatabase();
    const items = db.prepare(
      `SELECT * FROM feedback_items WHERE session_id = ? ORDER BY created_at ASC`
    ).all(sessionId) as FeedbackItem[];

    if (items.length === 0) {
      return NextResponse.json({ error: 'No feedback items' }, { status: 400 });
    }

    const conv = db.prepare('SELECT file_path FROM conversations WHERE id = ?').get(sessionId) as { file_path: string } | undefined;
    const invokedSkills = conv?.file_path ? findInvokedSkillsFromSession(conv.file_path) : [];

    const skillsParam = req.nextUrl.searchParams.get('skills');
    const skillIds = skillsParam ? skillsParam.split(',').filter(Boolean) : [];
    const skills = resolveSelectedSkills(skillIds, invokedSkills);

    return NextResponse.json({
      prompt: generateImprovementPrompt(sessionId, items, skills),
      autoDetectedSkills: invokedSkills.map(s => ({ id: s.name, name: s.name })),
    });
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
