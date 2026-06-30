import { NextRequest, NextResponse } from 'next/server';
import { getDatabase } from '@/lib/db/database';

export async function GET(req: NextRequest) {
  try {
    const url = new URL(req.url);
    const limit = Math.min(parseInt(url.searchParams.get('limit') || '30', 10), 100);
    const offset = parseInt(url.searchParams.get('offset') || '0', 10);

    const db = getDatabase();

    const runs = db.prepare(`
      SELECT * FROM digest_runs ORDER BY run_at DESC LIMIT ? OFFSET ?
    `).all(limit, offset) as Record<string, unknown>[];

    const { total } = db.prepare('SELECT COUNT(*) as total FROM digest_runs').get() as { total: number };

    const lastRead = db.prepare(
      `SELECT value FROM user_preferences WHERE key = 'last_read_alerts'`
    ).get() as { value: string } | undefined;
    const lastReadTs = lastRead ? parseInt(lastRead.value, 10) : 0;

    const { unread } = db.prepare(
      `SELECT COUNT(*) as unread FROM digest_runs WHERE run_at > ?`
    ).get(lastReadTs) as { unread: number };

    return NextResponse.json({
      runs: runs.map(r => ({
        id: r.id,
        runAt: new Date(r.run_at as number).toISOString(),
        windowStart: new Date(r.window_start as number).toISOString(),
        windowEnd: new Date(r.window_end as number).toISOString(),
        totalSessions: r.total_sessions,
        totalCost: r.total_cost,
        totalTokens: r.total_tokens,
        totalToolCalls: r.total_tool_calls,
        avgDurationMs: r.avg_duration_ms,
        topModel: r.top_model,
        sessionDetails: JSON.parse(r.session_details as string || '[]'),
        sourceBreakdown: JSON.parse(r.source_breakdown as string || '[]'),
      })),
      total,
      unread,
    });
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
