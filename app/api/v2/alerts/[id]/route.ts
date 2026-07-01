import { NextRequest, NextResponse } from 'next/server';
import { getDatabase } from '@/lib/db/database';
import { getWsServer } from '@/lib/websocket/ws-server';
import { mapAlertRow } from '@/lib/services/threshold-monitor';

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const body = await req.json();
  const { status } = body;

  if (!status || !['dismissed', 'resolved'].includes(status)) {
    return NextResponse.json({ error: 'Invalid status. Must be "dismissed" or "resolved".' }, { status: 400 });
  }

  const db = getDatabase();
  const now = Date.now();

  const existing = db.prepare(
    'SELECT id, session_id, threshold_type FROM threshold_alerts WHERE id = ?',
  ).get(id) as { id: string; session_id: string; threshold_type: string } | undefined;
  if (!existing) {
    return NextResponse.json({ error: 'Alert not found' }, { status: 404 });
  }

  // Dismiss/resolve all active alerts for the same session+type to prevent duplicates
  db.prepare(
    `UPDATE threshold_alerts SET status = ?, resolved_at = ?, updated_at = ? WHERE session_id = ? AND threshold_type = ? AND status = 'active'`,
  ).run(status, now, now, existing.session_id, existing.threshold_type);

  // Also update the target alert if it wasn't active
  db.prepare(
    `UPDATE threshold_alerts SET status = ?, resolved_at = ?, updated_at = ? WHERE id = ? AND status != ?`,
  ).run(status, now, now, id, status);

  const row = db.prepare('SELECT * FROM threshold_alerts WHERE id = ?').get(id) as Record<string, unknown>;
  const alert = mapAlertRow(row);

  const wss = getWsServer();
  wss?.broadcast({ type: 'threshold_alert_updated', alert });

  return NextResponse.json({ alert });
}
