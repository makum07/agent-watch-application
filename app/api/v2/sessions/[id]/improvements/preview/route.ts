import { NextRequest, NextResponse } from 'next/server';
import { getDatabase } from '@/lib/db/database';
import { generateImprovementPrompt, type FeedbackItem } from '@/lib/services/improvement-prompt';

export async function GET(
  _req: NextRequest,
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

    return NextResponse.json({ prompt: generateImprovementPrompt(sessionId, items) });
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
