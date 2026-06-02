import { getDatabase } from '@/lib/db/database';
import type { SessionHistory, SessionHistoryUpdate } from '@/types/history';
import type { Session } from '@/types/session';
import { extractAiTitle } from '@/lib/parser/agent-correlator';
import { discoverSessions } from './session-ingester';

function rowToHistory(row: Record<string, unknown>): SessionHistory {
  return {
    sessionId: row.session_id as string,
    title: row.title as string,
    summary: row.summary as string | null,
    project: row.project as string,
    sessionCreated: row.session_created ? new Date(row.session_created as number).toISOString() : new Date().toISOString(),
    firstOpened: new Date(row.first_opened as number).toISOString(),
    lastOpened: new Date(row.last_opened as number).toISOString(),
    openCount: row.open_count as number,
    agentCount: row.agent_count as number,
    artifactCount: row.artifact_count as number,
    totalTokens: row.total_tokens as number,
    totalToolCalls: row.total_tool_calls as number,
    durationMs: row.duration_ms as number,
    primaryModel: row.primary_model as string,
    estimatedCost: row.estimated_cost as number,
    isPinned: Boolean(row.is_pinned),
    isFavorite: Boolean(row.is_favorite),
    tags: JSON.parse(row.tags as string || '[]'),
    notes: row.notes as string | null,
    sourceExists: Boolean(row.source_exists),
    lastIndexed: row.last_indexed ? new Date(row.last_indexed as number).toISOString() : new Date().toISOString(),
  };
}

export function recordSessionOpen(session: Session): SessionHistory {
  const db = getDatabase();
  const now = Date.now();

  const existing = db.prepare('SELECT * FROM session_history WHERE session_id = ?').get(session.id) as Record<string, unknown> | undefined;

  const title = generateTitle(session);

  if (existing) {
    db.prepare(`
      UPDATE session_history SET
        last_opened = ?,
        open_count = open_count + 1,
        agent_count = ?,
        artifact_count = ?,
        total_tokens = ?,
        total_tool_calls = ?,
        duration_ms = ?,
        primary_model = ?,
        estimated_cost = ?,
        source_exists = 1,
        last_indexed = ?
      WHERE session_id = ?
    `).run(
      now, session.totalAgents, 0, session.totalTokens, session.totalToolCalls,
      session.duration.wallClock, session.primaryModel, session.estimatedCost.total,
      now, session.id
    );
  } else {
    db.prepare(`
      INSERT INTO session_history (
        session_id, title, summary, project,
        session_created, first_opened, last_opened, open_count,
        agent_count, artifact_count, total_tokens, total_tool_calls,
        duration_ms, primary_model, estimated_cost,
        is_pinned, is_favorite, tags, notes, source_exists, last_indexed
      ) VALUES (?, ?, ?, ?, ?, ?, ?, 1, ?, 0, ?, ?, ?, ?, ?, 0, 0, '[]', NULL, 1, ?)
    `).run(
      session.id, title, null, session.project,
      new Date(session.created).getTime(), now, now,
      session.totalAgents, session.totalTokens, session.totalToolCalls,
      session.duration.wallClock, session.primaryModel, session.estimatedCost.total, now
    );

    db.prepare(`
      INSERT OR REPLACE INTO session_history_fts (session_id, title, summary, project, tags)
      VALUES (?, ?, ?, ?, ?)
    `).run(session.id, title, null, session.project, '');
  }

  return getSessionHistory(session.id)!;
}

export function getSessionHistory(sessionId: string): SessionHistory | null {
  const db = getDatabase();
  const row = db.prepare('SELECT * FROM session_history WHERE session_id = ?').get(sessionId) as Record<string, unknown> | undefined;
  return row ? rowToHistory(row) : null;
}

export function listSessionHistory(opts: {
  limit?: number;
  offset?: number;
  sort?: 'lastOpened' | 'created' | 'title';
  pinned?: boolean;
  favorite?: boolean;
  project?: string;
}): SessionHistory[] {
  const db = getDatabase();
  const { limit = 50, offset = 0, sort = 'lastOpened', pinned, favorite, project } = opts;

  let where = 'WHERE 1=1';
  const params: unknown[] = [];

  if (pinned !== undefined) { where += ' AND is_pinned = ?'; params.push(pinned ? 1 : 0); }
  if (favorite !== undefined) { where += ' AND is_favorite = ?'; params.push(favorite ? 1 : 0); }
  if (project) { where += ' AND project LIKE ?'; params.push(`%${project}%`); }

  const orderMap = { lastOpened: 'last_opened DESC', created: 'session_created DESC', title: 'title ASC' };
  const order = orderMap[sort] || 'last_opened DESC';

  params.push(limit, offset);
  const rows = db.prepare(`SELECT * FROM session_history ${where} ORDER BY is_pinned DESC, ${order} LIMIT ? OFFSET ?`).all(...params) as Record<string, unknown>[];
  return rows.map(rowToHistory);
}

export function searchSessionHistory(query: string, limit = 20): SessionHistory[] {
  const db = getDatabase();

  try {
    const ftsRows = db.prepare(`
      SELECT session_id FROM session_history_fts
      WHERE session_history_fts MATCH ?
      LIMIT ?
    `).all(`${query}*`, limit) as { session_id: string }[];

    if (ftsRows.length === 0) return [];

    const ids = ftsRows.map(r => `'${r.session_id}'`).join(',');
    const rows = db.prepare(`SELECT * FROM session_history WHERE session_id IN (${ids})`).all() as Record<string, unknown>[];
    return rows.map(rowToHistory);
  } catch {
    const rows = db.prepare(`
      SELECT * FROM session_history
      WHERE title LIKE ? OR project LIKE ? OR summary LIKE ?
      LIMIT ?
    `).all(`%${query}%`, `%${query}%`, `%${query}%`, limit) as Record<string, unknown>[];
    return rows.map(rowToHistory);
  }
}

export function updateSessionHistory(sessionId: string, update: SessionHistoryUpdate): SessionHistory | null {
  const db = getDatabase();
  const fields: string[] = [];
  const params: unknown[] = [];

  if (update.title !== undefined) { fields.push('title = ?'); params.push(update.title); }
  if (update.summary !== undefined) { fields.push('summary = ?'); params.push(update.summary); }
  if (update.isPinned !== undefined) { fields.push('is_pinned = ?'); params.push(update.isPinned ? 1 : 0); }
  if (update.isFavorite !== undefined) { fields.push('is_favorite = ?'); params.push(update.isFavorite ? 1 : 0); }
  if (update.tags !== undefined) { fields.push('tags = ?'); params.push(JSON.stringify(update.tags)); }
  if (update.notes !== undefined) { fields.push('notes = ?'); params.push(update.notes); }

  if (fields.length === 0) return getSessionHistory(sessionId);

  params.push(sessionId);
  db.prepare(`UPDATE session_history SET ${fields.join(', ')} WHERE session_id = ?`).run(...params);

  if (update.title || update.tags) {
    const row = db.prepare('SELECT * FROM session_history WHERE session_id = ?').get(sessionId) as Record<string, unknown>;
    if (row) {
      db.prepare(`
        INSERT OR REPLACE INTO session_history_fts (session_id, title, summary, project, tags)
        VALUES (?, ?, ?, ?, ?)
      `).run(sessionId, row.title, row.summary, row.project, row.tags);
    }
  }

  return getSessionHistory(sessionId);
}

function generateTitle(session: Session): string {
  // Try ai-title from the JSONL file first
  try {
    const discovered = discoverSessions();
    const found = discovered.find(s => s.id === session.id);
    if (found) {
      const aiTitle = extractAiTitle(found.filePath);
      if (aiTitle) return aiTitle;
    }
  } catch {}
  // Fallback to project + agent count
  const projectName = session.project.split(/[/\\]/).filter(Boolean).pop() || 'Project';
  const agentStr = session.totalAgents > 0 ? ` — ${session.totalAgents} agent${session.totalAgents !== 1 ? 's' : ''}` : '';
  return `${projectName}${agentStr}`;
}
