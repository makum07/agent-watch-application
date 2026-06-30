import { NextResponse } from 'next/server';
import { getDatabase } from '@/lib/db/database';

export async function POST() {
  try {
    const db = getDatabase();
    db.prepare(`
      INSERT INTO user_preferences (key, value, updated_at)
      VALUES ('last_read_alerts', ?, ?)
      ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at
    `).run(String(Date.now()), Date.now());

    return NextResponse.json({ ok: true });
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
