import { getDatabase } from '@/lib/db/database';
import type { WorkspaceSnapshot } from '@/types/workspace';
import crypto from 'crypto';

function rowToSnapshot(row: Record<string, unknown>): WorkspaceSnapshot {
  return JSON.parse(row.snapshot_data as string) as WorkspaceSnapshot;
}

export function saveSnapshot(snapshot: WorkspaceSnapshot): WorkspaceSnapshot {
  const db = getDatabase();
  const data = JSON.stringify(snapshot);

  if (snapshot.isAutoSave) {
    db.prepare('DELETE FROM workspace_snapshots WHERE session_id = ? AND is_auto_save = 1').run(snapshot.sessionId);
  }

  db.prepare(`
    INSERT INTO workspace_snapshots (id, session_id, saved_at, is_auto_save, name, snapshot_data, snapshot_size)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(
    snapshot.id,
    snapshot.sessionId,
    new Date(snapshot.savedAt).getTime(),
    snapshot.isAutoSave ? 1 : 0,
    snapshot.name,
    data,
    Buffer.byteLength(data, 'utf8')
  );

  return snapshot;
}

export function getLatestSnapshot(sessionId: string): WorkspaceSnapshot | null {
  const db = getDatabase();
  const row = db.prepare(`
    SELECT * FROM workspace_snapshots
    WHERE session_id = ?
    ORDER BY saved_at DESC
    LIMIT 1
  `).get(sessionId) as Record<string, unknown> | undefined;

  return row ? rowToSnapshot(row) : null;
}

export function getAutoSave(sessionId: string): WorkspaceSnapshot | null {
  const db = getDatabase();
  const row = db.prepare(`
    SELECT * FROM workspace_snapshots
    WHERE session_id = ? AND is_auto_save = 1
    ORDER BY saved_at DESC
    LIMIT 1
  `).get(sessionId) as Record<string, unknown> | undefined;

  return row ? rowToSnapshot(row) : null;
}

export function listNamedSnapshots(sessionId: string): WorkspaceSnapshot[] {
  const db = getDatabase();
  const rows = db.prepare(`
    SELECT * FROM workspace_snapshots
    WHERE session_id = ? AND is_auto_save = 0
    ORDER BY saved_at DESC
    LIMIT 20
  `).all(sessionId) as Record<string, unknown>[];

  return rows.map(rowToSnapshot);
}

export function deleteSnapshot(snapshotId: string): boolean {
  const db = getDatabase();
  const result = db.prepare('DELETE FROM workspace_snapshots WHERE id = ?').run(snapshotId);
  return result.changes > 0;
}

export function createAutoSaveId(): string {
  return `auto_${crypto.randomUUID()}`;
}
