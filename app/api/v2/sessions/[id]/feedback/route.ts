import { NextRequest, NextResponse } from 'next/server';
import { getDatabase } from '@/lib/db/database';
import { randomUUID } from 'crypto';

interface DbFeedbackItem {
  id: string;
  session_id: string;
  agent_id: string;
  message_id: string | null;
  artifact_id: string | null;
  category: string;
  text: string;
  agent_name: string | null;
  created_at: number;
}

function mapItem(row: DbFeedbackItem) {
  return {
    id: row.id,
    sessionId: row.session_id,
    agentId: row.agent_id,
    messageId: row.message_id,
    artifactId: row.artifact_id,
    category: row.category,
    text: row.text,
    agentName: row.agent_name,
    createdAt: new Date(row.created_at).toISOString(),
  };
}

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id: sessionId } = await params;
    const db = getDatabase();
    const items = db.prepare(
      `SELECT * FROM feedback_items WHERE session_id = ? ORDER BY created_at ASC`
    ).all(sessionId) as DbFeedbackItem[];
    return NextResponse.json({ items: items.map(mapItem) });
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id: sessionId } = await params;
    const body = await req.json();

    if (!body.agentId || !body.category || !body.text?.trim()) {
      return NextResponse.json({ error: 'agentId, category and text are required' }, { status: 400 });
    }

    const db = getDatabase();
    const id = randomUUID();
    const now = Date.now();

    db.prepare(`
      INSERT INTO feedback_items (id, session_id, agent_id, message_id, artifact_id, category, text, agent_name, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      id, sessionId, body.agentId,
      body.messageId ?? null, body.artifactId ?? null,
      body.category, body.text.trim(),
      body.agentName ?? null, now
    );

    const item = db.prepare(`SELECT * FROM feedback_items WHERE id = ?`).get(id) as DbFeedbackItem;
    return NextResponse.json(mapItem(item), { status: 201 });
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id: sessionId } = await params;
    const itemId = req.nextUrl.searchParams.get('itemId');
    if (!itemId) {
      return NextResponse.json({ error: 'itemId query param required' }, { status: 400 });
    }
    const body = await req.json();
    if (!body.text?.trim() && !body.category) {
      return NextResponse.json({ error: 'text or category required' }, { status: 400 });
    }
    const db = getDatabase();
    const fields: string[] = [];
    const values: unknown[] = [];
    if (body.text?.trim()) { fields.push('text = ?'); values.push(body.text.trim()); }
    if (body.category)     { fields.push('category = ?'); values.push(body.category); }
    values.push(itemId, sessionId);
    db.prepare(`UPDATE feedback_items SET ${fields.join(', ')} WHERE id = ? AND session_id = ?`).run(...values);
    const item = db.prepare(`SELECT * FROM feedback_items WHERE id = ?`).get(itemId) as DbFeedbackItem | undefined;
    if (!item) return NextResponse.json({ error: 'Not found' }, { status: 404 });
    return NextResponse.json(mapItem(item));
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}

export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id: sessionId } = await params;
    const itemId = req.nextUrl.searchParams.get('itemId');
    if (!itemId) {
      return NextResponse.json({ error: 'itemId query param required' }, { status: 400 });
    }
    const db = getDatabase();
    db.prepare(`DELETE FROM feedback_items WHERE id = ? AND session_id = ?`).run(itemId, sessionId);
    return NextResponse.json({ ok: true });
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
