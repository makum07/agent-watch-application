import { NextResponse } from 'next/server';
import { getDatabase } from '@/lib/db/database';

export async function GET() {
  try {
    const db = getDatabase();

    const lastRead = db.prepare(
      `SELECT value FROM user_preferences WHERE key = 'last_read_alerts'`
    ).get() as { value: string } | undefined;
    const lastReadTs = lastRead ? parseInt(lastRead.value, 10) : 0;

    const { count } = db.prepare(
      `SELECT COUNT(*) as count FROM digest_runs WHERE run_at > ?`
    ).get(lastReadTs) as { count: number };

    return NextResponse.json({ count });
  } catch (err) {
    return NextResponse.json({ count: 0 });
  }
}
