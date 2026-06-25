import { NextRequest, NextResponse } from 'next/server';
import { getDatabase } from '@/lib/db/database';

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id: sessionId } = await params;
  try {
    const db = getDatabase();
    const rows = db.prepare(`
      SELECT id, file_path, tool_name, type, timestamp, content_size, agent_id
      FROM artifacts
      WHERE session_id = ?
      ORDER BY timestamp ASC
    `).all(sessionId) as {
      id: string;
      file_path: string;
      tool_name: string;
      type: string;
      timestamp: number | null;
      content_size: number;
      agent_id: string;
    }[];

    return NextResponse.json({ artifacts: rows });
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
