import { NextRequest, NextResponse } from 'next/server';
import { getDatabase } from '@/lib/db/database';
import { resolveSessionSource } from '@/lib/api/resolve-source';

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string; agentId: string }> }
) {
  const { id: sessionId, agentId } = await params;
  try {
    const sourceId = await resolveSessionSource(req, sessionId);
    const db = getDatabase(sourceId);
    const rows = db.prepare(`
      SELECT id, file_path, tool_name, type, timestamp, content_size
      FROM artifacts
      WHERE agent_id = ?
      ORDER BY timestamp ASC
    `).all(agentId) as {
      id: string;
      file_path: string;
      tool_name: string;
      type: string;
      timestamp: number | null;
      content_size: number;
    }[];

    return NextResponse.json({ artifacts: rows });
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
