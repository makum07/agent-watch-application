import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import { getDatabase } from '@/lib/db/database';
import { FEEDBACK_CATEGORIES } from '@/types/feedback';
import {
  getClaudeProjectsDir,
  listProjectDirs,
  getProjectDisplayName,
} from '@/lib/parser/jsonl-parser';
import type { SkillInvocation } from '@/types/session';
import type {
  Skill,
  SkillSummary,
  SkillExecution,
  SkillAnalysisCycle,
  SkillDetailData,
  SkillFeedbackAggregate,
  SelfHealingMode,
  AnalysisStatus,
} from '@/types/skills';

export function computeSkillId(project: string, name: string): string {
  return crypto.createHash('sha256')
    .update(`${project}:${name}`)
    .digest('hex')
    .slice(0, 16);
}

function normalizeSkillName(name: string): string {
  return name.toLowerCase().replace(/_/g, '-').trim();
}

function toIso(ts: number | null): string | null {
  return ts ? new Date(ts).toISOString() : null;
}

function mapSkillRow(row: Record<string, unknown>): Skill {
  return {
    id: row.id as string,
    project: row.project as string,
    name: row.name as string,
    description: (row.description as string) ?? null,
    version: (row.version as number) ?? 1,
    selfHealingEnabled: !!(row.self_healing_enabled as number),
    selfHealingMode: (row.self_healing_mode as SelfHealingMode) ?? 'analysis_only',
    selfHealingThreshold: (row.self_healing_threshold as number) ?? 5,
    executionsSinceLastCycle: (row.executions_since_last_cycle as number) ?? 0,
    createdAt: new Date(row.created_at as number).toISOString(),
    updatedAt: new Date(row.updated_at as number).toISOString(),
  };
}

function mapAnalysisCycleRow(row: Record<string, unknown>): SkillAnalysisCycle {
  return {
    id: row.id as string,
    skillId: row.skill_id as string,
    cycleNumber: row.cycle_number as number,
    triggerType: (row.trigger_type as 'manual' | 'auto_threshold') ?? 'manual',
    sessionsAnalyzed: JSON.parse((row.sessions_analyzed as string) || '[]'),
    feedbackAnalyzed: JSON.parse((row.feedback_analyzed as string) || '[]'),
    analysisPrompt: row.analysis_prompt as string,
    analysisResponse: (row.analysis_response as string) ?? null,
    fixPrompt: (row.fix_prompt as string) ?? null,
    recommendations: row.recommendations ? JSON.parse(row.recommendations as string) : null,
    status: (row.status as AnalysisStatus) ?? 'pending',
    createdAt: new Date(row.created_at as number).toISOString(),
    completedAt: row.completed_at ? new Date(row.completed_at as number).toISOString() : null,
    streamEntries: row.stream_entries ? JSON.parse(row.stream_entries as string) : null,
  };
}

export function registerSkillExecutions(
  sessionId: string,
  project: string,
  agents: Array<{ id: string; skillInvocations: SkillInvocation[] }>
): void {
  const db = getDatabase();
  const now = Date.now();

  const upsertSkill = db.prepare(`
    INSERT INTO skills (id, project, name, description, version, self_healing_enabled, self_healing_mode, self_healing_threshold, executions_since_last_cycle, created_at, updated_at)
    VALUES (?, ?, ?, NULL, 1, 0, 'analysis_only', 5, 0, ?, ?)
    ON CONFLICT(project, name) DO UPDATE SET updated_at = excluded.updated_at
  `);

  const insertExecution = db.prepare(`
    INSERT OR IGNORE INTO skill_executions (id, skill_id, session_id, agent_id, invocation_id, timestamp, duration_ms, args, feedback_count)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0)
  `);

  const register = db.transaction(() => {
    for (const agent of agents) {
      if (!agent.skillInvocations || agent.skillInvocations.length === 0) continue;

      for (const inv of agent.skillInvocations) {
        const skillName = normalizeSkillName(inv.skill);
        const skillId = computeSkillId(project, skillName);
        const execId = crypto.createHash('sha256')
          .update(`${skillId}:${sessionId}:${inv.id}`)
          .digest('hex')
          .slice(0, 16);

        upsertSkill.run(skillId, project, skillName, now, now);
        const ts = inv.startTime ? new Date(inv.startTime).getTime() : now;
        insertExecution.run(
          execId,
          skillId,
          sessionId,
          agent.id,
          inv.id,
          ts,
          inv.durationMs ?? null,
          inv.args ?? null
        );
      }
    }
  });

  register();
}

function resolveProjectCwd(projectDir: string): string | null {
  try {
    const files = fs.readdirSync(projectDir).filter(f => f.endsWith('.jsonl') && !f.includes('subagent'));
    for (const file of files) {
      const fp = path.join(projectDir, file);
      const fd = fs.openSync(fp, 'r');
      const buf = Buffer.alloc(4096);
      const bytesRead = fs.readSync(fd, buf, 0, 4096, 0);
      fs.closeSync(fd);
      const chunk = buf.toString('utf8', 0, bytesRead);
      const match = chunk.match(/"cwd"\s*:\s*"([^"]+)"/);
      if (match) {
        return match[1].replace(/\\\\/g, '\\');
      }
    }
  } catch { /* non-fatal */ }
  return null;
}

function parseSkillFrontmatter(content: string): { name?: string; description?: string } {
  const fmMatch = content.match(/^---\s*\n([\s\S]*?)\n---/);
  if (!fmMatch) return {};
  const fm = fmMatch[1];
  const name = fm.match(/^name:\s*(.+)$/m)?.[1]?.trim();
  const description = fm.match(/^description:\s*(.+)$/m)?.[1]?.trim();
  return { name, description };
}

function enrichSkillDescriptions(): void {
  const db = getDatabase();
  const projectsDir = getClaudeProjectsDir();
  const projectDirs = listProjectDirs();

  const updateDesc = db.prepare(
    'UPDATE skills SET description = ? WHERE id = ? AND description IS NULL'
  );

  for (const dirName of projectDirs) {
    const projectDir = path.join(projectsDir, dirName);
    const project = getProjectDisplayName(dirName);
    const cwd = resolveProjectCwd(projectDir);
    if (!cwd) continue;

    const skillsDir = path.join(cwd, '.claude', 'skills');
    if (!fs.existsSync(skillsDir)) continue;

    try {
      const entries = fs.readdirSync(skillsDir, { withFileTypes: true });
      for (const entry of entries) {
        if (!entry.isDirectory()) continue;
        const skillFile = ['SKILL.md', 'skill.md']
          .map(f => path.join(skillsDir, entry.name, f))
          .find(f => fs.existsSync(f));
        if (!skillFile) continue;

        const content = fs.readFileSync(skillFile, 'utf8');
        const meta = parseSkillFrontmatter(content);
        if (!meta.description) continue;

        const skillName = normalizeSkillName(meta.name || entry.name);
        const skillId = computeSkillId(project, skillName);
        updateDesc.run(meta.description, skillId);
      }
    } catch { /* non-fatal */ }
  }
}

export function syncSkillRegistry(): number {
  const db = getDatabase();

  // Step 1: Force re-index sessions that may have skills but were indexed before v5.
  const { discoverSessions, ingestSession } = require('@/lib/services/session-ingester');
  const allDiscovered = discoverSessions() as Array<{ id: string; filePath: string; projectDisplayName: string; projectPath: string }>;

  const sessionsToIndex: string[] = [];
  for (const discovered of allDiscovered) {
    try {
      const content = fs.readFileSync(discovered.filePath, 'utf8');
      const hasSkillToolUse = content.includes('"name":"Skill"') || content.includes('"name": "Skill"');
      const hasInvokedSkills = content.includes('"invoked_skills"');
      const hasAttributionSkill = content.includes('"attributionSkill"');
      if (!hasSkillToolUse && !hasInvokedSkills && !hasAttributionSkill) continue;

      const cached = db.prepare('SELECT id FROM conversations WHERE id = ?').get(discovered.id) as { id: string } | undefined;
      if (!cached) {
        sessionsToIndex.push(discovered.id);
        continue;
      }

      const hasSkillData = db.prepare(
        "SELECT 1 FROM agents WHERE session_id = ? AND skill_invocations IS NOT NULL AND skill_invocations != '[]' LIMIT 1"
      ).get(discovered.id);

      if (!hasSkillData || hasInvokedSkills || hasAttributionSkill) {
        sessionsToIndex.push(discovered.id);
      }
    } catch { /* file not readable — skip */ }
  }

  for (const sessionId of sessionsToIndex) {
    db.prepare('DELETE FROM skill_executions WHERE session_id = ?').run(sessionId);
    db.prepare('DELETE FROM agents WHERE session_id = ?').run(sessionId);
    db.prepare('DELETE FROM artifacts WHERE session_id = ?').run(sessionId);
    db.prepare('DELETE FROM timeline_events WHERE session_id = ?').run(sessionId);
    db.prepare('DELETE FROM conversations WHERE id = ?').run(sessionId);
    try {
      ingestSession(sessionId);
    } catch (err) {
      console.error(`Failed to re-index session ${sessionId}:`, err);
    }
  }

  // Step 1.5: Normalize conversations.project for ALL discovered sessions.
  // Historical sessions may have been indexed with different display-name logic
  // (e.g. decoded path "ZER/app" vs current display name "Zeroni-Product-ZER-app").
  // This ensures all sessions from the same project directory get a consistent
  // project name so skill IDs (sha256 of project:name) are deterministic.
  const updateConvProject = db.prepare('UPDATE conversations SET project = ? WHERE id = ?');
  const normalizeProjects = db.transaction(() => {
    for (const d of allDiscovered) {
      const project = d.projectDisplayName || d.projectPath;
      updateConvProject.run(project, d.id);
    }
  });
  normalizeProjects();

  // Step 2: Clear ALL skill_executions for a clean rebuild.
  db.exec('DELETE FROM skill_executions');

  // Step 3: Register execution data from ALL agents (fresh, consistent project names)
  const agentRows = db.prepare(`
    SELECT id, session_id, skill_invocations FROM agents
    WHERE skill_invocations IS NOT NULL AND skill_invocations != '[]'
  `).all() as Array<{ id: string; session_id: string; skill_invocations: string }>;

  const sessionProjects = new Map<string, string>();
  const convRows = db.prepare('SELECT id, project FROM conversations').all() as Array<{ id: string; project: string }>;
  for (const c of convRows) {
    sessionProjects.set(c.id, c.project);
  }

  let execCount = 0;
  for (const row of agentRows) {
    const project = sessionProjects.get(row.session_id);
    if (!project) continue;

    const invocations: SkillInvocation[] = JSON.parse(row.skill_invocations);
    if (invocations.length === 0) continue;

    registerSkillExecutions(row.session_id, project, [{ id: row.id, skillInvocations: invocations }]);
    execCount += invocations.length;
  }

  // Step 4: Migrate analysis cycles from orphaned skill entries to their active replacements.
  // Orphaned entries exist when the skill was re-registered under a corrected project name
  // (new ID), leaving the old entry with cycles but no executions.
  const orphanedWithCycles = db.prepare(`
    SELECT DISTINCT sac.skill_id AS old_id, s.name
    FROM skill_analysis_cycles sac
    INNER JOIN skills s ON s.id = sac.skill_id
    WHERE s.id NOT IN (SELECT DISTINCT skill_id FROM skill_executions)
  `).all() as Array<{ old_id: string; name: string }>;

  for (const orphan of orphanedWithCycles) {
    const replacement = db.prepare(`
      SELECT s.id FROM skills s
      INNER JOIN skill_executions se ON se.skill_id = s.id
      WHERE s.name = ?
      GROUP BY s.id
      ORDER BY COUNT(se.id) DESC
      LIMIT 1
    `).get(orphan.name) as { id: string } | undefined;

    if (replacement) {
      db.prepare('UPDATE skill_analysis_cycles SET skill_id = ? WHERE skill_id = ?')
        .run(replacement.id, orphan.old_id);
    }
  }

  // Step 5: Enrich descriptions from SKILL.md files on disk
  enrichSkillDescriptions();

  // Step 6: Remove skills with no executions AND no analysis cycles
  db.prepare(`
    DELETE FROM skills
    WHERE id NOT IN (SELECT DISTINCT skill_id FROM skill_executions)
      AND id NOT IN (SELECT DISTINCT skill_id FROM skill_analysis_cycles)
  `).run();

  return execCount;
}

function autoRegisterFromSessions(): void {
  const db = getDatabase();

  const agentRows = db.prepare(`
    SELECT a.id, a.session_id, a.skill_invocations, c.project
    FROM agents a
    INNER JOIN conversations c ON c.id = a.session_id
    WHERE a.skill_invocations IS NOT NULL AND a.skill_invocations != '[]'
      AND a.id NOT IN (SELECT DISTINCT agent_id FROM skill_executions)
  `).all() as Array<{ id: string; session_id: string; skill_invocations: string; project: string }>;

  for (const row of agentRows) {
    const invocations: SkillInvocation[] = JSON.parse(row.skill_invocations);
    if (invocations.length === 0) continue;
    registerSkillExecutions(row.session_id, row.project, [{ id: row.id, skillInvocations: invocations }]);
  }

  if (agentRows.length > 0) {
    enrichSkillDescriptions();
  }
}

export function listSkills(opts?: { project?: string }): SkillSummary[] {
  autoRegisterFromSessions();
  const db = getDatabase();

  let query = `
    SELECT
      s.*,
      COALESCE(exec_stats.total_executions, 0) as total_executions,
      COALESCE(exec_stats.total_sessions, 0) as total_sessions,
      COALESCE(exec_stats.avg_duration_ms, 0) as avg_duration_ms,
      exec_stats.last_execution_at,
      cycle_stats.last_analysis_at,
      cycle_stats.last_analysis_status,
      cycle_stats.last_completed_at,
      COALESCE(fb_stats.total_feedback, 0) as total_feedback,
      COALESCE(since_cycle.execs_since_cycle, 0) as execs_since_cycle
    FROM skills s
    LEFT JOIN (
      SELECT
        skill_id,
        COUNT(*) as total_executions,
        COUNT(DISTINCT session_id) as total_sessions,
        AVG(duration_ms) as avg_duration_ms,
        MAX(timestamp) as last_execution_at
      FROM skill_executions
      GROUP BY skill_id
    ) exec_stats ON exec_stats.skill_id = s.id
    LEFT JOIN (
      SELECT
        skill_id,
        MAX(created_at) as last_analysis_at,
        MAX(CASE WHEN status IN ('completed','failed') THEN completed_at END) as last_completed_at,
        (SELECT status FROM skill_analysis_cycles sac2
         WHERE sac2.skill_id = sac.skill_id
         ORDER BY sac2.created_at DESC LIMIT 1) as last_analysis_status
      FROM skill_analysis_cycles sac
      GROUP BY skill_id
    ) cycle_stats ON cycle_stats.skill_id = s.id
    LEFT JOIN (
      SELECT
        skill_id,
        COUNT(DISTINCT fi_id) as total_feedback
      FROM (
        SELECT DISTINCT se.skill_id, fi.id AS fi_id
        FROM skill_executions se
        INNER JOIN feedback_items fi ON fi.session_id = se.session_id
      )
      GROUP BY skill_id
    ) fb_stats ON fb_stats.skill_id = s.id
    LEFT JOIN (
      SELECT
        se.skill_id,
        COUNT(*) as execs_since_cycle
      FROM skill_executions se
      LEFT JOIN (
        SELECT skill_id, MAX(completed_at) as last_completed
        FROM skill_analysis_cycles
        WHERE status IN ('completed', 'failed')
        GROUP BY skill_id
      ) lc ON lc.skill_id = se.skill_id
      WHERE lc.last_completed IS NULL OR se.timestamp > lc.last_completed
      GROUP BY se.skill_id
    ) since_cycle ON since_cycle.skill_id = s.id
  `;

  const params: unknown[] = [];
  if (opts?.project) {
    query += ' WHERE s.project = ?';
    params.push(opts.project);
  }

  query += ' ORDER BY s.project, s.name';

  const rows = db.prepare(query).all(...params) as Array<Record<string, unknown>>;

  return rows.map(row => ({
    ...mapSkillRow(row),
    executionsSinceLastCycle: (row.execs_since_cycle as number) ?? 0,
    totalExecutions: (row.total_executions as number) ?? 0,
    totalSessions: (row.total_sessions as number) ?? 0,
    totalFeedback: (row.total_feedback as number) ?? 0,
    avgDurationMs: Math.round((row.avg_duration_ms as number) ?? 0),
    lastExecutionAt: toIso(row.last_execution_at as number | null),
    lastAnalysisAt: toIso(row.last_analysis_at as number | null),
    lastAnalysisStatus: (row.last_analysis_status as AnalysisStatus) ?? null,
  }));
}

export function getSkillDetail(skillId: string): SkillDetailData | null {
  const db = getDatabase();

  const skillRow = db.prepare('SELECT * FROM skills WHERE id = ?').get(skillId) as Record<string, unknown> | undefined;
  if (!skillRow) return null;

  const skills = listSkills({ project: skillRow.project as string });
  const skillSummary = skills.find(s => s.id === skillId);
  if (!skillSummary) return null;

  // Recent executions — feedback count computed dynamically per execution
  const execRows = db.prepare(`
    SELECT se.*, a.description as agent_name,
           (SELECT COUNT(*) FROM feedback_items fi
            WHERE fi.session_id = se.session_id) as live_feedback_count
    FROM skill_executions se
    LEFT JOIN agents a ON a.id = se.agent_id
    WHERE se.skill_id = ?
    ORDER BY se.timestamp DESC
    LIMIT 100
  `).all(skillId) as Array<Record<string, unknown>>;

  const recentExecutions: SkillExecution[] = execRows.map(row => ({
    id: row.id as string,
    skillId: row.skill_id as string,
    sessionId: row.session_id as string,
    agentId: row.agent_id as string,
    invocationId: row.invocation_id as string,
    timestamp: new Date(row.timestamp as number).toISOString(),
    durationMs: (row.duration_ms as number) ?? null,
    args: (row.args as string) ?? null,
    feedbackCount: (row.live_feedback_count as number) ?? 0,
  }));

  // Feedback by category — includes feedback from skill sub-agents in the same session
  const fbRows = db.prepare(`
    SELECT fi.category, COUNT(DISTINCT fi.id) as count
    FROM feedback_items fi
    INNER JOIN skill_executions se ON fi.session_id = se.session_id
    WHERE se.skill_id = ?
    GROUP BY fi.category
    ORDER BY count DESC
  `).all(skillId) as Array<{ category: string; count: number }>;

  const totalFb = fbRows.reduce((sum, r) => sum + r.count, 0);
  const feedbackByCategory: SkillFeedbackAggregate[] = fbRows.map(row => {
    const meta = FEEDBACK_CATEGORIES.find(c => c.value === row.category);
    return {
      category: row.category,
      label: meta?.label ?? row.category,
      count: row.count,
      percentage: totalFb > 0 ? Math.round((row.count / totalFb) * 100) : 0,
      color: meta?.color ?? '#8b949e',
    };
  });

  // Feedback by agent — includes feedback from skill sub-agents in the same session
  const fbAgentRows = db.prepare(`
    SELECT COALESCE(fi.agent_name, a.description, fi.agent_id) as agent_name, COUNT(DISTINCT fi.id) as count
    FROM feedback_items fi
    INNER JOIN skill_executions se ON fi.session_id = se.session_id
    LEFT JOIN agents a ON a.id = fi.agent_id
    WHERE se.skill_id = ?
    GROUP BY agent_name
    ORDER BY count DESC
    LIMIT 20
  `).all(skillId) as Array<{ agent_name: string; count: number }>;

  // Individual feedback items with session context (session-level join catches sub-agent feedback)
  const feedbackItemRows = db.prepare(`
    SELECT DISTINCT fi.id, fi.session_id, fi.agent_id, fi.category, fi.text, fi.created_at,
           COALESCE(fi.agent_name, a.description, fi.agent_id) as agent_name
    FROM feedback_items fi
    INNER JOIN skill_executions se ON fi.session_id = se.session_id
    LEFT JOIN agents a ON a.id = fi.agent_id
    WHERE se.skill_id = ?
    ORDER BY fi.created_at DESC
    LIMIT 200
  `).all(skillId) as Array<{
    id: string; session_id: string; agent_id: string; category: string;
    text: string; created_at: number; agent_name: string;
  }>;

  const feedbackItems = feedbackItemRows.map(row => {
    const meta = FEEDBACK_CATEGORIES.find(c => c.value === row.category);
    return {
      id: row.id,
      sessionId: row.session_id,
      agentId: row.agent_id,
      agentName: row.agent_name,
      category: row.category,
      categoryLabel: meta?.label ?? row.category,
      categoryColor: meta?.color ?? '#8b949e',
      text: row.text,
      createdAt: new Date(row.created_at).toISOString(),
    };
  });

  const cycleRows = db.prepare(`
    SELECT * FROM skill_analysis_cycles
    WHERE skill_id = ?
    ORDER BY created_at DESC
  `).all(skillId) as Array<Record<string, unknown>>;

  // Executions by session — feedback count computed dynamically (session-level)
  const sessionExecRows = db.prepare(`
    SELECT se.session_id, se.timestamp, se.agent_id, se.duration_ms,
           COALESCE(a.description, NULL) as agent_name,
           (SELECT COUNT(*) FROM feedback_items fi
            WHERE fi.session_id = se.session_id) as live_feedback_count
    FROM skill_executions se
    LEFT JOIN agents a ON a.id = se.agent_id
    WHERE se.skill_id = ?
    ORDER BY se.timestamp DESC
    LIMIT 200
  `).all(skillId) as Array<Record<string, unknown>>;

  // Improvement cycles from sessions that executed this skill
  const improvementRows = db.prepare(`
    SELECT DISTINCT ic.id, ic.session_id, ic.cycle_number, ic.feedback_ids,
           ic.generated_prompt, ic.claude_response, ic.status,
           ic.created_at, ic.completed_at, ic.file_changes
    FROM improvement_cycles ic
    INNER JOIN skill_executions se ON ic.session_id = se.session_id
    WHERE se.skill_id = ?
    ORDER BY ic.created_at DESC
    LIMIT 100
  `).all(skillId) as Array<Record<string, unknown>>;

  const improvementCycles = improvementRows.map(row => ({
    id: row.id as string,
    sessionId: row.session_id as string,
    cycleNumber: row.cycle_number as number,
    feedbackIds: JSON.parse((row.feedback_ids as string) || '[]') as string[],
    generatedPrompt: row.generated_prompt as string,
    claudeResponse: (row.claude_response as string) ?? null,
    status: row.status as string,
    createdAt: new Date(row.created_at as number).toISOString(),
    completedAt: row.completed_at ? new Date(row.completed_at as number).toISOString() : null,
    fileChanges: (row.file_changes as string) ?? null,
  }));

  // Collect feedback IDs referenced by improvement cycles that aren't already in feedbackItems
  const existingFbIds = new Set(feedbackItems.map(f => f.id));
  const missingFbIds = [...new Set(
    improvementCycles.flatMap(ic => ic.feedbackIds)
  )].filter(id => !existingFbIds.has(id));

  if (missingFbIds.length > 0) {
    const placeholders = missingFbIds.map(() => '?').join(',');
    const extraFbRows = db.prepare(`
      SELECT fi.id, fi.session_id, fi.agent_id, fi.category, fi.text, fi.created_at,
             COALESCE(fi.agent_name, a.description, fi.agent_id) as agent_name
      FROM feedback_items fi
      LEFT JOIN agents a ON a.id = fi.agent_id
      WHERE fi.id IN (${placeholders})
    `).all(...missingFbIds) as Array<{
      id: string; session_id: string; agent_id: string; category: string;
      text: string; created_at: number; agent_name: string;
    }>;

    for (const row of extraFbRows) {
      const meta = FEEDBACK_CATEGORIES.find(c => c.value === row.category);
      feedbackItems.push({
        id: row.id,
        sessionId: row.session_id,
        agentId: row.agent_id,
        agentName: row.agent_name,
        category: row.category,
        categoryLabel: meta?.label ?? row.category,
        categoryColor: meta?.color ?? '#8b949e',
        text: row.text,
        createdAt: new Date(row.created_at).toISOString(),
      });
    }
  }

  return {
    skill: skillSummary,
    recentExecutions,
    feedbackItems,
    feedbackByCategory,
    feedbackByAgent: fbAgentRows.map(r => ({
      agentName: r.agent_name,
      count: r.count,
    })),
    analysisCycles: cycleRows.map(mapAnalysisCycleRow),
    improvementCycles,
    executionsBySession: sessionExecRows.map(row => ({
      sessionId: row.session_id as string,
      timestamp: new Date(row.timestamp as number).toISOString(),
      agentId: row.agent_id as string,
      agentName: (row.agent_name as string) ?? null,
      durationMs: (row.duration_ms as number) ?? null,
      feedbackCount: (row.live_feedback_count as number) ?? 0,
    })),
  };
}

export function updateSkillConfig(
  skillId: string,
  updates: Partial<Pick<Skill, 'selfHealingEnabled' | 'selfHealingMode' | 'selfHealingThreshold' | 'description'>>
): Skill | null {
  const db = getDatabase();
  const now = Date.now();

  const existing = db.prepare('SELECT * FROM skills WHERE id = ?').get(skillId) as Record<string, unknown> | undefined;
  if (!existing) return null;

  const fields: string[] = ['updated_at = ?'];
  const values: unknown[] = [now];

  if (updates.selfHealingEnabled !== undefined) {
    fields.push('self_healing_enabled = ?');
    values.push(updates.selfHealingEnabled ? 1 : 0);
  }
  if (updates.selfHealingMode !== undefined) {
    fields.push('self_healing_mode = ?');
    values.push(updates.selfHealingMode);
  }
  if (updates.selfHealingThreshold !== undefined) {
    fields.push('self_healing_threshold = ?');
    values.push(updates.selfHealingThreshold);
  }
  if (updates.description !== undefined) {
    fields.push('description = ?');
    values.push(updates.description);
  }

  values.push(skillId);
  db.prepare(`UPDATE skills SET ${fields.join(', ')} WHERE id = ?`).run(...values);

  const updated = db.prepare('SELECT * FROM skills WHERE id = ?').get(skillId) as Record<string, unknown>;
  return mapSkillRow(updated);
}

export function checkSelfHealingThreshold(skillId: string): boolean {
  const db = getDatabase();
  const skill = db.prepare(
    'SELECT self_healing_enabled, self_healing_threshold FROM skills WHERE id = ?'
  ).get(skillId) as { self_healing_enabled: number; self_healing_threshold: number } | undefined;
  if (!skill || !skill.self_healing_enabled) return false;

  const lastCompleted = db.prepare(
    "SELECT MAX(completed_at) as t FROM skill_analysis_cycles WHERE skill_id = ? AND status IN ('completed','failed')"
  ).get(skillId) as { t: number | null };

  let countSince: number;
  if (lastCompleted?.t) {
    countSince = (db.prepare(
      'SELECT COUNT(*) as c FROM skill_executions WHERE skill_id = ? AND timestamp > ?'
    ).get(skillId, lastCompleted.t) as { c: number }).c;
  } else {
    countSince = (db.prepare(
      'SELECT COUNT(*) as c FROM skill_executions WHERE skill_id = ?'
    ).get(skillId) as { c: number }).c;
  }

  return countSince >= skill.self_healing_threshold;
}

export function getNextCycleNumber(skillId: string): number {
  const db = getDatabase();
  const row = db.prepare(
    'SELECT MAX(cycle_number) as max_num FROM skill_analysis_cycles WHERE skill_id = ?'
  ).get(skillId) as { max_num: number | null };
  return (row?.max_num ?? 0) + 1;
}

export function createAnalysisCycle(
  skillId: string,
  cycleNumber: number,
  triggerType: 'manual' | 'auto_threshold',
  prompt: string,
  sessionsAnalyzed: string[],
  feedbackAnalyzed: string[]
): SkillAnalysisCycle {
  const db = getDatabase();
  const id = crypto.randomUUID();
  const now = Date.now();

  db.prepare(`
    INSERT INTO skill_analysis_cycles
    (id, skill_id, cycle_number, trigger_type, sessions_analyzed, feedback_analyzed, analysis_prompt, status, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, 'analyzing', ?)
  `).run(
    id, skillId, cycleNumber, triggerType,
    JSON.stringify(sessionsAnalyzed),
    JSON.stringify(feedbackAnalyzed),
    prompt, now
  );

  return {
    id,
    skillId,
    cycleNumber,
    triggerType,
    sessionsAnalyzed,
    feedbackAnalyzed,
    analysisPrompt: prompt,
    analysisResponse: null,
    fixPrompt: null,
    recommendations: null,
    status: 'analyzing',
    createdAt: new Date(now).toISOString(),
    completedAt: null,
    streamEntries: null,
  };
}

export function updateAnalysisCycle(
  cycleId: string,
  updates: Partial<Pick<SkillAnalysisCycle, 'analysisResponse' | 'fixPrompt' | 'recommendations' | 'status' | 'streamEntries'>>
): void {
  const db = getDatabase();
  const fields: string[] = [];
  const values: unknown[] = [];

  if (updates.analysisResponse !== undefined) {
    fields.push('analysis_response = ?');
    values.push(updates.analysisResponse);
  }
  if (updates.fixPrompt !== undefined) {
    fields.push('fix_prompt = ?');
    values.push(updates.fixPrompt);
  }
  if (updates.recommendations !== undefined) {
    fields.push('recommendations = ?');
    values.push(JSON.stringify(updates.recommendations));
  }
  if (updates.streamEntries !== undefined) {
    fields.push('stream_entries = ?');
    values.push(updates.streamEntries ? JSON.stringify(updates.streamEntries) : null);
  }
  if (updates.status !== undefined) {
    fields.push('status = ?');
    values.push(updates.status);
    if (updates.status === 'completed' || updates.status === 'failed') {
      fields.push('completed_at = ?');
      values.push(Date.now());
    }
  }

  if (fields.length === 0) return;

  values.push(cycleId);
  db.prepare(`UPDATE skill_analysis_cycles SET ${fields.join(', ')} WHERE id = ?`).run(...values);
}

export function deleteAnalysisCycle(cycleId: string): void {
  const db = getDatabase();
  db.prepare('DELETE FROM skill_analysis_cycles WHERE id = ?').run(cycleId);
}

export function getAnalysisCycle(cycleId: string): SkillAnalysisCycle | null {
  const db = getDatabase();
  const row = db.prepare('SELECT * FROM skill_analysis_cycles WHERE id = ?').get(cycleId) as Record<string, unknown> | undefined;
  return row ? mapAnalysisCycleRow(row) : null;
}

export function listAnalysisCycles(skillId: string): SkillAnalysisCycle[] {
  const db = getDatabase();

  const STALE_THRESHOLD_MS = 10 * 60 * 1000;
  const cutoff = Date.now() - STALE_THRESHOLD_MS;
  db.prepare(`
    UPDATE skill_analysis_cycles
    SET status = 'failed', completed_at = ?
    WHERE skill_id = ? AND status IN ('analyzing', 'applying') AND created_at < ?
  `).run(Date.now(), skillId, cutoff);

  const rows = db.prepare(
    'SELECT * FROM skill_analysis_cycles WHERE skill_id = ? ORDER BY created_at DESC'
  ).all(skillId) as Array<Record<string, unknown>>;
  return rows.map(mapAnalysisCycleRow);
}
