import Database from 'better-sqlite3';
import path from 'path';
import fs from 'fs';

const dbs = new Map<string, Database.Database>();

export function getDatabase(sourceId?: string): Database.Database {
  const key = sourceId ?? 'default';
  if (dbs.has(key)) return dbs.get(key)!;

  const baseDbPath = process.env.CLAUDE_DB_PATH || path.join(process.cwd(), 'data', 'agentwatch.db');
  const dbPath = sourceId && sourceId !== 'default'
    ? baseDbPath.replace(/\.db$/, `-${sourceId}.db`)
    : baseDbPath;
  const dbDir = path.dirname(dbPath);

  if (!fs.existsSync(dbDir)) {
    fs.mkdirSync(dbDir, { recursive: true });
  }

  const db = new Database(dbPath);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  db.pragma('cache_size = -64000');

  runMigrations(db);
  dbs.set(key, db);
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

  if (currentVersion < 3) {
    db.exec(`
      CREATE TABLE IF NOT EXISTS feedback_items (
        id TEXT PRIMARY KEY,
        session_id TEXT NOT NULL,
        agent_id TEXT NOT NULL,
        message_id TEXT,
        artifact_id TEXT,
        category TEXT NOT NULL,
        text TEXT NOT NULL,
        agent_name TEXT,
        created_at INTEGER NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_feedback_session ON feedback_items(session_id);
      CREATE INDEX IF NOT EXISTS idx_feedback_agent ON feedback_items(session_id, agent_id);

      CREATE TABLE IF NOT EXISTS improvement_cycles (
        id TEXT PRIMARY KEY,
        session_id TEXT NOT NULL,
        cycle_number INTEGER NOT NULL,
        feedback_ids TEXT NOT NULL DEFAULT '[]',
        generated_prompt TEXT NOT NULL,
        claude_response TEXT,
        status TEXT DEFAULT 'pending',
        created_at INTEGER NOT NULL,
        completed_at INTEGER
      );

      CREATE INDEX IF NOT EXISTS idx_improvements_session ON improvement_cycles(session_id, created_at DESC);

      INSERT INTO schema_version (version, applied_at) VALUES (3, ${Date.now()});
    `);
  }

  if (currentVersion < 4) {
    const cols = db.prepare("PRAGMA table_info(improvement_cycles)").all() as { name: string }[];
    if (!cols.find(c => c.name === 'jsonl_snapshot_size')) {
      db.exec(`ALTER TABLE improvement_cycles ADD COLUMN jsonl_snapshot_size INTEGER;`);
    }
    db.exec(`INSERT INTO schema_version (version, applied_at) VALUES (4, ${Date.now()});`);
  }

  if (currentVersion < 5) {
    const cols = db.prepare("PRAGMA table_info(agents)").all() as { name: string }[];
    if (!cols.find(c => c.name === 'skill_invocations')) {
      db.exec(`ALTER TABLE agents ADD COLUMN skill_invocations TEXT DEFAULT '[]';`);
    }
    db.exec(`INSERT INTO schema_version (version, applied_at) VALUES (5, ${Date.now()});`);
  }

  if (currentVersion < 6) {
    const cols = db.prepare("PRAGMA table_info(improvement_cycles)").all() as { name: string }[];
    if (!cols.find(c => c.name === 'file_changes')) {
      db.exec(`ALTER TABLE improvement_cycles ADD COLUMN file_changes TEXT;`);
    }
    db.exec(`INSERT INTO schema_version (version, applied_at) VALUES (6, ${Date.now()});`);
  }

  if (currentVersion < 7) {
    const cols = db.prepare("PRAGMA table_info(improvement_cycles)").all() as { name: string }[];
    if (!cols.find(c => c.name === 'stream_entries')) {
      db.exec(`ALTER TABLE improvement_cycles ADD COLUMN stream_entries TEXT;`);
    }
    db.exec(`INSERT INTO schema_version (version, applied_at) VALUES (7, ${Date.now()});`);
  }

  if (currentVersion < 8) {
    db.exec(`
      CREATE TABLE IF NOT EXISTS skills (
        id TEXT PRIMARY KEY,
        project TEXT NOT NULL,
        name TEXT NOT NULL,
        description TEXT,
        version INTEGER DEFAULT 1,
        self_healing_enabled INTEGER DEFAULT 0,
        self_healing_mode TEXT DEFAULT 'analysis_only',
        self_healing_threshold INTEGER DEFAULT 5,
        executions_since_last_cycle INTEGER DEFAULT 0,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL,
        UNIQUE(project, name)
      );

      CREATE INDEX IF NOT EXISTS idx_skills_project ON skills(project);
      CREATE INDEX IF NOT EXISTS idx_skills_name ON skills(name);

      CREATE TABLE IF NOT EXISTS skill_executions (
        id TEXT PRIMARY KEY,
        skill_id TEXT NOT NULL,
        session_id TEXT NOT NULL,
        agent_id TEXT NOT NULL,
        invocation_id TEXT NOT NULL,
        timestamp INTEGER NOT NULL,
        duration_ms INTEGER,
        args TEXT,
        feedback_count INTEGER DEFAULT 0,
        FOREIGN KEY (skill_id) REFERENCES skills(id),
        FOREIGN KEY (session_id) REFERENCES conversations(id)
      );

      CREATE INDEX IF NOT EXISTS idx_skill_exec_skill ON skill_executions(skill_id, timestamp DESC);
      CREATE INDEX IF NOT EXISTS idx_skill_exec_session ON skill_executions(session_id);
      CREATE INDEX IF NOT EXISTS idx_skill_exec_invocation ON skill_executions(invocation_id);

      CREATE TABLE IF NOT EXISTS skill_analysis_cycles (
        id TEXT PRIMARY KEY,
        skill_id TEXT NOT NULL,
        cycle_number INTEGER NOT NULL,
        trigger_type TEXT NOT NULL DEFAULT 'manual',
        sessions_analyzed TEXT DEFAULT '[]',
        feedback_analyzed TEXT DEFAULT '[]',
        analysis_prompt TEXT NOT NULL,
        analysis_response TEXT,
        fix_prompt TEXT,
        recommendations TEXT,
        status TEXT DEFAULT 'pending',
        created_at INTEGER NOT NULL,
        completed_at INTEGER,
        FOREIGN KEY (skill_id) REFERENCES skills(id)
      );

      CREATE INDEX IF NOT EXISTS idx_skill_analysis_skill ON skill_analysis_cycles(skill_id, created_at DESC);

      INSERT INTO schema_version (version, applied_at) VALUES (8, ${Date.now()});
    `);
  }

  if (currentVersion < 9) {
    db.exec(`INSERT INTO schema_version (version, applied_at) VALUES (9, ${Date.now()});`);
  }

  if (currentVersion < 10) {
    // Per-agent error/denial accounting so we can distinguish "came to rest"
    // from "succeeded cleanly" (green should mean clean success).
    // Nullable (no DEFAULT) so existing rows stay NULL → signals "not yet
    // computed" and triggers a one-time re-index in the ingester.
    const cols = db.prepare("PRAGMA table_info(agents)").all() as { name: string }[];
    if (!cols.find(c => c.name === 'error_tool_count')) {
      db.exec(`ALTER TABLE agents ADD COLUMN error_tool_count INTEGER;`);
    }
    if (!cols.find(c => c.name === 'denied_tool_count')) {
      db.exec(`ALTER TABLE agents ADD COLUMN denied_tool_count INTEGER;`);
    }
    db.exec(`INSERT INTO schema_version (version, applied_at) VALUES (10, ${Date.now()});`);
  }

  if (currentVersion < 11) {
    db.exec(`
      CREATE TABLE IF NOT EXISTS execution_analysis_cycles (
        id TEXT PRIMARY KEY,
        session_id TEXT NOT NULL,
        cycle_number INTEGER NOT NULL,
        analysis_prompt TEXT NOT NULL,
        analysis_response TEXT,
        recommendations TEXT,
        status TEXT DEFAULT 'pending',
        stream_entries TEXT,
        created_at INTEGER NOT NULL,
        completed_at INTEGER,
        FOREIGN KEY (session_id) REFERENCES conversations(id)
      );

      CREATE INDEX IF NOT EXISTS idx_exec_analysis_session ON execution_analysis_cycles(session_id, created_at DESC);

      INSERT INTO schema_version (version, applied_at) VALUES (11, ${Date.now()});
    `);
  }

  if (currentVersion < 12) {
    db.exec(`
      CREATE TABLE IF NOT EXISTS digest_runs (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        run_at INTEGER NOT NULL,
        window_start INTEGER NOT NULL,
        window_end INTEGER NOT NULL,
        total_sessions INTEGER NOT NULL,
        total_cost REAL NOT NULL,
        total_tokens INTEGER NOT NULL,
        total_tool_calls INTEGER NOT NULL,
        avg_duration_ms INTEGER NOT NULL,
        top_model TEXT,
        session_details TEXT NOT NULL DEFAULT '[]',
        source_breakdown TEXT NOT NULL DEFAULT '[]'
      );

      CREATE INDEX IF NOT EXISTS idx_digest_runs_run_at ON digest_runs(run_at DESC);

      INSERT INTO schema_version (version, applied_at) VALUES (12, ${Date.now()});
    `);
  }

  // Fixup: ensure stream_entries column exists on skill_analysis_cycles
  // (v9 migration may have recorded success without actually adding the column)
  const sacCols = db.prepare("PRAGMA table_info(skill_analysis_cycles)").all() as { name: string }[];
  if (sacCols.length > 0 && !sacCols.find(c => c.name === 'stream_entries')) {
    db.exec(`ALTER TABLE skill_analysis_cycles ADD COLUMN stream_entries TEXT;`);
  }
}

export function closeDatabase(sourceId?: string) {
  if (sourceId) {
    dbs.get(sourceId)?.close();
    dbs.delete(sourceId);
  } else {
    dbs.forEach(d => d.close());
    dbs.clear();
  }
}
