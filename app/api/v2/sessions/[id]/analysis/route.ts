import { NextRequest, NextResponse } from 'next/server';
import path from 'path';
import fs from 'fs';
import { getDatabase } from '@/lib/db/database';
import { ingestSession } from '@/lib/services/session-ingester';
import { computeExecutionFacts } from '@/lib/services/execution-facts';
import { parseJsonlFile, resolveToolCalls, decodeProjectPath } from '@/lib/parser/jsonl-parser';
import { getWsServer } from '@/lib/websocket/ws-server';
import { randomUUID } from 'crypto';
import {
  generateExecutionAnalysisPrompt,
  runExecutionAnalysis,
} from '@/lib/services/execution-analyzer';
import type { PromptToolCall } from '@/lib/services/execution-analyzer';
import type { ExecutionAnalysisCycle } from '@/types/analytics';

export const dynamic = 'force-dynamic';

interface DbCycle {
  id: string;
  session_id: string;
  cycle_number: number;
  analysis_prompt: string;
  analysis_response: string | null;
  recommendations: string | null;
  status: string;
  stream_entries: string | null;
  created_at: number;
  completed_at: number | null;
}

function mapCycle(row: DbCycle): ExecutionAnalysisCycle {
  return {
    id: row.id,
    sessionId: row.session_id,
    cycleNumber: row.cycle_number,
    analysisPrompt: row.analysis_prompt,
    analysisResponse: row.analysis_response,
    recommendations: row.recommendations ? JSON.parse(row.recommendations) : null,
    status: row.status as ExecutionAnalysisCycle['status'],
    streamEntries: row.stream_entries ? JSON.parse(row.stream_entries) : null,
    createdAt: new Date(row.created_at).toISOString(),
    completedAt: row.completed_at ? new Date(row.completed_at).toISOString() : null,
  };
}

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id: sessionId } = await params;
    const db = getDatabase();

    const preview = req.nextUrl.searchParams.get('preview');
    if (preview === '1') {
      const session = ingestSession(sessionId);
      if (!session) return NextResponse.json({ error: 'Session not found' }, { status: 404 });

      const promptData = buildPromptData(sessionId, session, db);
      const prompt = generateExecutionAnalysisPrompt(promptData);
      return NextResponse.json({ prompt });
    }

    const cycles = db.prepare(
      'SELECT * FROM execution_analysis_cycles WHERE session_id = ? ORDER BY created_at DESC'
    ).all(sessionId) as DbCycle[];

    return NextResponse.json({ cycles: cycles.map(mapCycle) });
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
    const db = getDatabase();

    const session = ingestSession(sessionId);
    if (!session) {
      return NextResponse.json({ error: 'Session not found' }, { status: 404 });
    }

    if (!getWsServer()) {
      return NextResponse.json(
        { error: 'WebSocket server is not running. Start with "npm run dev:server" to enable live streaming.' },
        { status: 503 },
      );
    }

    let customPrompt: string | undefined;
    try {
      const body = await req.json();
      customPrompt = body.customPrompt;
    } catch { /* no body is fine */ }

    const row = db.prepare(
      'SELECT MAX(cycle_number) as n FROM execution_analysis_cycles WHERE session_id = ?'
    ).get(sessionId) as { n: number | null };
    const cycleNumber = (row?.n ?? 0) + 1;

    const promptData = buildPromptData(sessionId, session, db);
    const prompt = customPrompt?.trim() || generateExecutionAnalysisPrompt(promptData);

    const cycleId = randomUUID();
    const now = Date.now();

    db.prepare(`
      INSERT INTO execution_analysis_cycles
        (id, session_id, cycle_number, analysis_prompt, status, created_at)
      VALUES (?, ?, ?, ?, 'analyzing', ?)
    `).run(cycleId, sessionId, cycleNumber, prompt, now);

    setImmediate(() => {
      runExecutionAnalysis(cycleId, sessionId, prompt, promptData.projectDir, promptData.externalSkillDirs).catch(err => {
        console.error('Execution analysis failed:', err);
      });
    });

    const cycle = db.prepare(
      'SELECT * FROM execution_analysis_cycles WHERE id = ?'
    ).get(cycleId) as DbCycle;

    return NextResponse.json(mapCycle(cycle), { status: 201 });
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}

function readCwdFromJsonl(filePath: string): string | null {
  try {
    const fd = fs.openSync(filePath, 'r');
    const buf = Buffer.alloc(4096);
    const bytesRead = fs.readSync(fd, buf, 0, 4096, 0);
    fs.closeSync(fd);
    const chunk = buf.toString('utf8', 0, bytesRead);
    const match = chunk.match(/"cwd"\s*:\s*"([^"]+)"/);
    if (match) return match[1].replace(/\\\\/g, '\\');
  } catch { /* non-fatal */ }
  return null;
}

function buildPromptData(sessionId: string, session: import('@/types/session').Session, db: ReturnType<typeof getDatabase>) {
  const conv = db.prepare('SELECT file_path FROM conversations WHERE id = ?').get(sessionId) as
    | { file_path: string }
    | undefined;
  let projectDir = session.project;
  if (conv) {
    const cwdFromHeader = readCwdFromJsonl(conv.file_path);
    if (cwdFromHeader) {
      projectDir = cwdFromHeader;
    } else {
      const metaDir = path.dirname(conv.file_path);
      const dirName = path.basename(metaDir);
      projectDir = decodeProjectPath(dirName);
    }
  }

  const agentJsonlPaths = new Map<string, string>();
  for (const agent of session.agents) {
    const row = db.prepare('SELECT jsonl_path FROM agents WHERE id = ?').get(agent.id) as
      | { jsonl_path: string | null }
      | undefined;
    if (row?.jsonl_path) {
      agentJsonlPaths.set(agent.id, row.jsonl_path);
    } else if (conv) {
      const fallback = path.join(path.dirname(conv.file_path), `${agent.conversationId || agent.id}.jsonl`);
      agentJsonlPaths.set(agent.id, fallback);
    }
  }

  const feedbackItems = db.prepare(
    'SELECT * FROM feedback_items WHERE session_id = ? ORDER BY created_at ASC'
  ).all(sessionId) as Array<Record<string, unknown>>;

  const artifacts = db.prepare(
    'SELECT * FROM artifacts WHERE session_id = ? ORDER BY timestamp ASC'
  ).all(sessionId) as Array<Record<string, unknown>>;

  const improvementCycles = db.prepare(
    'SELECT * FROM improvement_cycles WHERE session_id = ? ORDER BY cycle_number ASC'
  ).all(sessionId) as Array<Record<string, unknown>>;

  const facts = computeExecutionFacts(session);

  // Load full tool call timeline for every agent + collect skill definition paths
  const agentToolTimelines = new Map<string, PromptToolCall[]>();
  const skillDefinitionPaths = new Map<string, string>();
  for (const agent of session.agents) {
    const jsonlPath = agentJsonlPaths.get(agent.id);
    if (!jsonlPath || !fs.existsSync(jsonlPath)) continue;
    try {
      const parsed = parseJsonlFile(jsonlPath);

      // Collect skill definition file paths
      for (const skill of parsed.invokedSkills) {
        if (skill.name && skill.path && !skillDefinitionPaths.has(skill.name)) {
          skillDefinitionPaths.set(skill.name, skill.path);
        }
      }

      const resolved = resolveToolCalls(parsed.messages);
      if (resolved.length === 0) continue;

      const calls: PromptToolCall[] = resolved.map(tc => ({
        name: tc.name,
        inputSummary: tc.input ? summarizeToolInput(tc.input) : '',
        isError: tc.isError,
        errorMessage: tc.isError && tc.result
          ? (typeof tc.result === 'string' ? tc.result : JSON.stringify(tc.result)).slice(0, 300)
          : undefined,
        durationMs: tc.durationMs,
      }));
      agentToolTimelines.set(agent.id, calls);
    } catch { /* skip agents whose JSONL can't be parsed */ }
  }

  // Detect external skill/agent directories — directories outside the session's
  // project that contain .claude/skills or .claude/agents used during the run.
  const externalSkillDirs = new Set<string>();
  if (skillDefinitionPaths.size > 0) {
    for (const skillPath of skillDefinitionPaths.values()) {
      if (!skillPath) continue;
      const dir = skillPath.replace(/[\\/][^\\/]+$/, '');
      const root = dir.replace(/[\\/]\.claude[\\/]skills$/, '').replace(/[\\/]\.claude[\\/]agents$/, '');
      if (root && root.toLowerCase() !== projectDir.toLowerCase()) {
        externalSkillDirs.add(dir);
      }
    }
  }
  // Also detect .claude/agents dirs for agent types used in the session
  if (externalSkillDirs.size > 0) {
    for (const skillDir of [...externalSkillDirs]) {
      const agentsDir = skillDir.replace(/[\\/]skills$/, path.sep + 'agents');
      try {
        if (fs.statSync(agentsDir).isDirectory()) {
          externalSkillDirs.add(agentsDir);
        }
      } catch { /* no agents dir — fine */ }
    }
  }

  return {
    session,
    projectDir,
    externalSkillDirs: [...externalSkillDirs],
    facts,
    agentJsonlPaths,
    agentToolTimelines,
    artifacts,
    feedbackItems,
    improvementCycles: improvementCycles.length > 0 ? improvementCycles : undefined,
    skillDefinitionPaths: skillDefinitionPaths.size > 0 ? skillDefinitionPaths : undefined,
  };
}

function summarizeToolInput(input: Record<string, unknown>): string {
  if (input.file_path) return `file_path: ${String(input.file_path)}`;
  if (input.command) return String(input.command).slice(0, 120);
  if (input.pattern) return `pattern: ${String(input.pattern)}`;
  if (input.query) return `query: ${String(input.query).slice(0, 120)}`;
  if (input.prompt) return String(input.prompt).slice(0, 120);
  if (input.skill) return `skill: ${String(input.skill)}`;
  if (input.old_string != null) return `file_path: ${String(input.file_path || '?')}`;
  const s = JSON.stringify(input);
  return s.length > 120 ? s.slice(0, 117) + '...' : s;
}

export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id: sessionId } = await params;
    const db = getDatabase();
    const cycleId = req.nextUrl.searchParams.get('cycleId');
    if (!cycleId) return NextResponse.json({ error: 'Missing cycleId' }, { status: 400 });

    const result = db.prepare(
      'DELETE FROM execution_analysis_cycles WHERE id = ? AND session_id = ?'
    ).run(cycleId, sessionId);

    if (result.changes === 0) return NextResponse.json({ error: 'Cycle not found' }, { status: 404 });
    return NextResponse.json({ ok: true });
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
