import { NextRequest, NextResponse } from 'next/server';
import { getDatabase } from '@/lib/db/database';

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const {
      windowStart, windowEnd, totalSessions, totalCost,
      totalTokens, totalToolCalls, avgDurationMs,
      topModel, sessionDetails, sourceBreakdown,
    } = body;

    const db = getDatabase();
    const result = db.prepare(`
      INSERT INTO digest_runs
        (run_at, window_start, window_end, total_sessions, total_cost,
         total_tokens, total_tool_calls, avg_duration_ms, top_model,
         session_details, source_breakdown)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      Date.now(),
      new Date(windowStart).getTime(),
      new Date(windowEnd).getTime(),
      totalSessions,
      totalCost,
      totalTokens,
      totalToolCalls,
      avgDurationMs,
      topModel ?? null,
      JSON.stringify(sessionDetails ?? []),
      JSON.stringify(sourceBreakdown ?? []),
    );

    return NextResponse.json({ id: result.lastInsertRowid });
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
