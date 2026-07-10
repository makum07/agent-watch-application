import { NextRequest, NextResponse } from 'next/server';
import { getDatabase } from '@/lib/db/database';
import { mapAlertRow } from '@/lib/services/threshold-monitor';

export async function GET(req: NextRequest) {
  const db = getDatabase();
  const url = new URL(req.url);
  const status = url.searchParams.get('status');
  const limit = parseInt(url.searchParams.get('limit') || '50', 10);
  const offset = parseInt(url.searchParams.get('offset') || '0', 10);

  let query = 'SELECT * FROM threshold_alerts';
  const params: unknown[] = [];

  if (status) {
    query += ' WHERE status = ?';
    params.push(status);
  }

  query += ' ORDER BY created_at DESC LIMIT ? OFFSET ?';
  params.push(limit, offset);

  const rows = db.prepare(query).all(...params) as Record<string, unknown>[];
  const alerts = rows.map(mapAlertRow);

  let countQuery = 'SELECT COUNT(*) as count FROM threshold_alerts';
  const countParams: unknown[] = [];
  if (status) {
    countQuery += ' WHERE status = ?';
    countParams.push(status);
  }
  const total = (db.prepare(countQuery).get(...countParams) as { count: number }).count;
  const activeCount = (db.prepare('SELECT COUNT(*) as count FROM threshold_alerts WHERE status = ?').get('active') as { count: number }).count;

  return NextResponse.json({ alerts, total, activeCount });
}
