import { NextRequest, NextResponse } from 'next/server';
import { getDatabase } from '@/lib/db/database';
import type { SkillExecution } from '@/types/skills';

export const dynamic = 'force-dynamic';

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ skillId: string }> }
) {
  try {
    const { skillId } = await params;
    const url = new URL(req.url);
    const limit = parseInt(url.searchParams.get('limit') ?? '50', 10);
    const offset = parseInt(url.searchParams.get('offset') ?? '0', 10);

    const db = getDatabase();

    const totalRow = db.prepare(
      'SELECT COUNT(*) as count FROM skill_executions WHERE skill_id = ?'
    ).get(skillId) as { count: number };

    const rows = db.prepare(`
      SELECT se.*,
        COALESCE(a.description, NULL) as agent_name,
        (SELECT COUNT(*) FROM feedback_items fi
         WHERE fi.session_id = se.session_id) as live_feedback_count
      FROM skill_executions se
      LEFT JOIN agents a ON a.id = se.agent_id
      WHERE se.skill_id = ?
      ORDER BY se.timestamp DESC
      LIMIT ? OFFSET ?
    `).all(skillId, limit, offset) as Array<Record<string, unknown>>;

    const executions: SkillExecution[] = rows.map(row => ({
      id: row.id as string,
      skillId: row.skill_id as string,
      sessionId: row.session_id as string,
      agentId: row.agent_id as string,
      invocationId: row.invocation_id as string,
      timestamp: new Date(row.timestamp as number).toISOString(),
      durationMs: (row.duration_ms as number) ?? null,
      args: (row.args as string) ?? null,
      feedbackCount: (row.live_feedback_count as number) ?? 0,
    }));

    return NextResponse.json({ executions, total: totalRow.count });
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
