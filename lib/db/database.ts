import Database from 'better-sqlite3';
import path from 'path';
import fs from 'fs';

let db: Database.Database | null = null;

export function getDatabase(): Database.Database {
  if (db) return db;

  const dbPath = process.env.CLAUDE_DB_PATH || path.join(process.cwd(), 'data', 'agentwatch.db');
  const dbDir = path.dirname(dbPath);

  if (!fs.existsSync(dbDir)) {
    fs.mkdirSync(dbDir, { recursive: true });
  }

  db = new Database(dbPath);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  db.pragma('cache_size = -64000');

  runMigrations(db);

  return db;
}

function runMigrations(db: Database.Database) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS schema_version (
      version INTEGER PRIMARY KEY,
      applied_at INTEGER NOT NULL
    );
  `);

  const row = db.prepare('SELECT MAX(version) as v FROM schema_version').get() as { v: number | null };
  const currentVersion = row?.v ?? 0;

  if (currentVersion < 1) {
    db.exec(`
      CREATE TABLE IF NOT EXISTS conversations (
        id TEXT PRIMARY KEY,
        project TEXT NOT NULL,
        created INTEGER,
        last_modified INTEGER,
        file_path TEXT NOT NULL,
        status TEXT DEFAULT 'unknown'
      );

      CREATE TABLE IF NOT EXISTS agents (
        id TEXT PRIMARY KEY,
        session_id TEXT NOT NULL,
        conversation_id TEXT NOT NULL,
        parent_id TEXT,
        parent_conversation_id TEXT,
        tool_use_id TEXT,
        type TEXT NOT NULL,
        subagent_type TEXT,
        model TEXT,
        status TEXT DEFAULT 'unknown',
        start_time INTEGER,
        end_time INTEGER,
        duration_ms INTEGER DEFAULT 0,
        prompt TEXT,
        description TEXT,
        response TEXT,
        schema_json TEXT,
        isolation TEXT,
        message_count INTEGER DEFAULT 0,
        tokens_input INTEGER DEFAULT 0,
        tokens_output INTEGER DEFAULT 0,
        tokens_cache_creation INTEGER DEFAULT 0,
        tokens_cache_read INTEGER DEFAULT 0,
        tokens_total INTEGER DEFAULT 0,
        tool_call_summary TEXT DEFAULT '[]',
        children TEXT DEFAULT '[]',
        depth INTEGER DEFAULT 0,
        FOREIGN KEY (session_id) REFERENCES conversations(id)
      );

      CREATE INDEX IF NOT EXISTS idx_agents_session ON agents(session_id);
      CREATE INDEX IF NOT EXISTS idx_agents_parent ON agents(parent_id);
      CREATE INDEX IF NOT EXISTS idx_agents_conversation ON agents(conversation_id);

      CREATE TABLE IF NOT EXISTS artifacts (
        id TEXT PRIMARY KEY,
        session_id TEXT NOT NULL,
        agent_id TEXT NOT NULL,
        type TEXT NOT NULL,
        file_path TEXT NOT NULL,
        tool_name TEXT NOT NULL,
        timestamp INTEGER,
        content_preview TEXT,
        content_size INTEGER DEFAULT 0,
        created_by TEXT,
        modified_by TEXT DEFAULT '[]',
        consumed_by TEXT DEFAULT '[]',
        FOREIGN KEY (session_id) REFERENCES conversations(id)
      );

      CREATE INDEX IF NOT EXISTS idx_artifacts_session ON artifacts(session_id);
      CREATE INDEX IF NOT EXISTS idx_artifacts_agent ON artifacts(agent_id);

      CREATE TABLE IF NOT EXISTS timeline_events (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        session_id TEXT NOT NULL,
        agent_id TEXT NOT NULL,
        event_type TEXT NOT NULL,
        timestamp INTEGER NOT NULL,
        details TEXT DEFAULT '{}',
        FOREIGN KEY (session_id) REFERENCES conversations(id)
      );

      CREATE INDEX IF NOT EXISTS idx_timeline_session ON timeline_events(session_id, timestamp);

      CREATE TABLE IF NOT EXISTS session_history (
        session_id TEXT PRIMARY KEY,
        title TEXT NOT NULL,
        summary TEXT,
        project TEXT NOT NULL,
        session_created INTEGER,
        first_opened INTEGER NOT NULL,
        last_opened INTEGER NOT NULL,
        open_count INTEGER DEFAULT 1,
        agent_count INTEGER DEFAULT 0,
        artifact_count INTEGER DEFAULT 0,
        total_tokens INTEGER DEFAULT 0,
        total_tool_calls INTEGER DEFAULT 0,
        duration_ms INTEGER DEFAULT 0,
        primary_model TEXT DEFAULT '',
        estimated_cost REAL DEFAULT 0,
        is_pinned INTEGER DEFAULT 0,
        is_favorite INTEGER DEFAULT 0,
        tags TEXT DEFAULT '[]',
        notes TEXT,
        source_exists INTEGER DEFAULT 1,
        last_indexed INTEGER
      );

      CREATE INDEX IF NOT EXISTS idx_history_last_opened ON session_history(last_opened DESC);
      CREATE INDEX IF NOT EXISTS idx_history_pinned ON session_history(is_pinned, last_opened DESC);
      CREATE INDEX IF NOT EXISTS idx_history_project ON session_history(project);

      CREATE VIRTUAL TABLE IF NOT EXISTS session_history_fts USING fts5(
        session_id UNINDEXED,
        title,
        summary,
        project,
        tags,
        content='session_history',
        content_rowid='rowid'
      );

      CREATE TABLE IF NOT EXISTS workspace_snapshots (
        id TEXT PRIMARY KEY,
        session_id TEXT NOT NULL,
        saved_at INTEGER NOT NULL,
        is_auto_save INTEGER DEFAULT 1,
        name TEXT,
        snapshot_data TEXT NOT NULL,
        snapshot_size INTEGER,
        FOREIGN KEY (session_id) REFERENCES session_history(session_id) ON DELETE CASCADE
      );

      CREATE INDEX IF NOT EXISTS idx_workspace_session ON workspace_snapshots(session_id, saved_at DESC);

      CREATE TABLE IF NOT EXISTS user_preferences (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL,
        updated_at INTEGER NOT NULL
      );

      INSERT INTO schema_version (version, applied_at) VALUES (1, ${Date.now()});
    `);
  }

  if (currentVersion < 2) {
    // Check if column already exists (idempotent — ALTER TABLE fails on duplicate)
    const cols = db.prepare("PRAGMA table_info(agents)").all() as { name: string }[];
    if (!cols.find(c => c.name === 'jsonl_path')) {
      db.exec(`ALTER TABLE agents ADD COLUMN jsonl_path TEXT;`);
    }
    db.exec(`INSERT INTO schema_version (version, applied_at) VALUES (2, ${Date.now()});`);
  }
}

export function closeDatabase() {
  db?.close();
  db = null;
}
