import { NextRequest, NextResponse } from 'next/server';
import { getDatabase } from '@/lib/db/database';
import { getWsServer } from '@/lib/websocket/ws-server';
import { randomUUID } from 'crypto';
import { spawn, execSync } from 'child_process';
import path from 'path';
import fs from 'fs';
import os from 'os';
import { registerActiveCycle, unregisterActiveCycle, resolveApproval, waitForApproval } from '@/lib/hooks/permission-state';
import { generateImprovementPrompt } from '@/lib/services/improvement-prompt';
import { findExternalSkillDirsFromSession, findInvokedSkillsFromSession } from '@/lib/services/external-dirs';
import { resolveSelectedSkills } from '@/lib/services/skill-catalog';
import { applyEditLocally, isNativePermissionBlock } from '@/lib/services/direct-edit-apply';

interface DbFeedbackItem {
  id: string;
  session_id: string;
  agent_id: string;
  message_id: string | null;
  artifact_id: string | null;
  category: string;
  text: string;
  agent_name: string | null;
  created_at: number;
}

interface DbCycle {
  id: string;
  session_id: string;
  cycle_number: number;
  feedback_ids: string;
  generated_prompt: string;
  claude_response: string | null;
  status: string;
  created_at: number;
  completed_at: number | null;
  jsonl_snapshot_size: number | null;
  file_changes: string | null;
  stream_entries: string | null;
}

function mapCycle(row: DbCycle) {
  return {
    id: row.id,
    sessionId: row.session_id,
    cycleNumber: row.cycle_number,
    feedbackIds: JSON.parse(row.feedback_ids ?? '[]'),
    generatedPrompt: row.generated_prompt,
    claudeResponse: row.claude_response,
    status: row.status,
    createdAt: new Date(row.created_at).toISOString(),
    completedAt: row.completed_at ? new Date(row.completed_at).toISOString() : null,
    snapshotSize: row.jsonl_snapshot_size ?? null,
    fileChanges: row.file_changes ? JSON.parse(row.file_changes) : null,
    streamEntries: row.stream_entries ? JSON.parse(row.stream_entries) : null,
  };
}

// ── Git diff capture ──────────────────────────────────────────────────────────

interface ParsedFileDiff {
  filePath: string;
  isNew: boolean;
  isDeleted: boolean;
  additions: number;
  deletions: number;
  diff: string;
}

function parseUnifiedDiff(diffText: string): ParsedFileDiff[] {
  const files: ParsedFileDiff[] = [];
  const sections = diffText.split(/^(?=diff --git )/m).filter(Boolean);

  for (const section of sections) {
    const headerMatch = section.match(/^diff --git a\/.+ b\/(.+)$/m);
    if (!headerMatch) continue;

    const filePath = headerMatch[1].trim();
    const isNew = /^new file mode/m.test(section);
    const isDeleted = /^deleted file mode/m.test(section);

    let additions = 0;
    let deletions = 0;
    for (const line of section.split('\n')) {
      if (line.startsWith('+') && !line.startsWith('+++')) additions++;
      if (line.startsWith('-') && !line.startsWith('---')) deletions++;
    }

    // Extract hunk content only (from @@ onwards) — cap at 20k chars
    const hunkStart = section.indexOf('\n@@');
    const diff = hunkStart >= 0 ? section.slice(hunkStart + 1, hunkStart + 1 + 20_000) : '';

    files.push({ filePath, isNew, isDeleted, additions, deletions, diff });
  }

  return files;
}

function captureFileChanges(projectCwd: string): import('@/types/feedback').FileChange[] {
  const changes: import('@/types/feedback').FileChange[] = [];

  try {
    // Unstaged changes to tracked files
    const diffOutput = execSync('git diff -U3', {
      cwd: projectCwd, shell: 'cmd.exe', timeout: 10_000,
    }).toString('utf8');
    for (const f of parseUnifiedDiff(diffOutput)) {
      changes.push({
        filePath: f.filePath,
        type: f.isNew ? 'create' : f.isDeleted ? 'delete' : 'modify',
        additions: f.additions,
        deletions: f.deletions,
        diff: f.diff,
      });
    }

    // Staged changes (index vs HEAD)
    const stagedDiff = execSync('git diff --cached -U3', {
      cwd: projectCwd, shell: 'cmd.exe', timeout: 10_000,
    }).toString('utf8');
    const seen = new Set(changes.map(c => c.filePath));
    for (const f of parseUnifiedDiff(stagedDiff)) {
      if (seen.has(f.filePath)) continue;
      changes.push({
        filePath: f.filePath,
        type: f.isNew ? 'create' : f.isDeleted ? 'delete' : 'modify',
        additions: f.additions,
        deletions: f.deletions,
        diff: f.diff,
      });
    }

    // New untracked files not in git yet
    const untrackedRaw = execSync('git ls-files --others --exclude-standard', {
      cwd: projectCwd, shell: 'cmd.exe', timeout: 5_000,
    }).toString('utf8');
    for (const rel of untrackedRaw.split('\n').map(l => l.trim()).filter(Boolean)) {
      try {
        const abs = path.join(projectCwd, rel);
        const content = fs.readFileSync(abs, 'utf8');
        const lines = content.split('\n');
        const diff = `@@ -0,0 +1,${lines.length} @@\n` + lines.map(l => `+${l}`).join('\n');
        changes.push({
          filePath: rel,
          type: 'create',
          additions: lines.length,
          deletions: 0,
          diff: diff.slice(0, 20_000),
        });
      } catch { /* skip unreadable */ }
    }
  } catch { /* not a git repo or git not available — non-fatal */ }

  return changes;
}

// Encode a filesystem path the same way Claude Code encodes CWD into project slugs.
// Windows: C:\Users\foo\bar baz → C--Users-foo-bar-baz
function encodePathToSlug(p: string): string {
  return p.replace(/^([A-Za-z]):\\/, '$1--').replace(/[\\/ ]/g, '-');
}

// Find the real directory whose slug encoding matches the given slug.
// Walks the filesystem starting from the user's home dir, using slug-prefix
// pruning so only directories that could possibly match are visited.
function findProjectDirBySlug(slug: string): string | null {
  // Only handle the Windows C--Users-<username>-... pattern for now
  const m = slug.match(/^([A-Za-z])--Users-([^-]+)-/);
  if (!m) return null;

  const drive = m[1].toUpperCase();
  const username = m[2];
  const startDir = path.join(`${drive}:`, 'Users', username);

  function search(dir: string, depth: number): string | null {
    if (depth <= 0) return null;
    let entries: fs.Dirent[];
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); }
    catch { return null; }

    for (const e of entries) {
      if (!e.isDirectory()) continue;
      const full = path.join(dir, e.name);
      const encoded = encodePathToSlug(full);
      if (encoded === slug) return full;
      // Prune: only recurse if this path is a prefix of the target slug
      if (slug.startsWith(encoded + '-')) {
        const hit = search(full, depth - 1);
        if (hit) return hit;
      }
    }
    return null;
  }

  return search(startDir, 6);
}

// ── Stream-JSON runner ───────────────────────────────────────────────────────

function resolveProjectCwd(db: ReturnType<typeof getDatabase>, sessionId: string): string {
  let projectCwd = process.cwd();
  try {
    const conv = db.prepare('SELECT file_path FROM conversations WHERE id = ?').get(sessionId) as { file_path: string } | undefined;
    if (conv?.file_path) {
      const slug = path.basename(path.dirname(conv.file_path));
      const found = findProjectDirBySlug(slug);
      if (found) projectCwd = found;
    }
  } catch { /* fall back to server cwd */ }
  return projectCwd;
}

async function runClaudeResumeAsync(
  cycleId: string,
  sessionId: string,
  prompt: string,
  resolvedProjectCwd?: string,
  externalSkillDirs: string[] = [],
) {
  const wss = getWsServer();
  const db = getDatabase();

  const broadcast = (type: string, payload: Record<string, unknown>) => {
    wss?.broadcast({ type, sessionId, cycleId, ...payload } as never);
  };

  const projectCwd = resolvedProjectCwd ?? resolveProjectCwd(db, sessionId);

  // Snapshot the working tree before Claude runs so rewind can restore it.
  try {
    execSync(`git stash push --include-untracked -m "agentwatch-pre-${cycleId}"`, {
      cwd: projectCwd, shell: 'cmd.exe', stdio: 'pipe',
    });
  } catch { /* not a git repo, or nothing to stash — non-fatal */ }

  const responseChunks: string[] = [];
  let streamIdCounter = 0;
  const streamLog: Array<Record<string, unknown>> = [];

  // Write a temporary settings file with a PreToolUse hook that POSTs
  // directly to AgentWatch's endpoint for browser-based approval.
  const port = String(process.env.PORT || 3000);
  const hookSettings = {
    hooks: {
      PreToolUse: [{
        matcher: 'Edit|Write',
        hooks: [{
          type: 'http',
          url: `http://localhost:${port}/api/v2/hooks/permission`,
          timeout: 600,
        }],
      }],
    },
  };
  const settingsPath = path.join(os.tmpdir(), `agentwatch-hook-${cycleId}.json`);
  fs.writeFileSync(settingsPath, JSON.stringify(hookSettings), 'utf8');

  // Register this cycle so the hook endpoint knows which session is active
  registerActiveCycle(sessionId, cycleId);

  try {
    broadcast('improvement_started', {});

    const cliArgs = [
      '--resume', sessionId, '-p',
      '--output-format', 'stream-json',
      '--input-format', 'stream-json',
      '--verbose',
      '--permission-mode', 'default',
      '--settings', `"${settingsPath}"`,
      '--include-hook-events',
    ];

    // Grant Read access to external skill/agent directories.
    // Paths must be quoted — shell: true splits on spaces otherwise.
    for (const dir of externalSkillDirs) {
      cliArgs.push('--add-dir', `"${dir}"`);
    }

    const child = spawn('claude', cliArgs, {
      shell: true,
      cwd: projectCwd,
      env: { ...process.env },
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    const userMsg = JSON.stringify({
      type: 'user',
      message: { role: 'user', content: [{ type: 'text', text: prompt }] },
    });
    child.stdin.write(userMsg + '\n', 'utf8');

    // Route browser approval responses to the shared permission state
    const unsubscribe = wss?.onClientMessage((msg) => {
      if (msg.type === 'permission_response' && msg.cycleId === cycleId) {
        resolveApproval(msg.requestId, msg.approved);
      }
    });

    let stdoutBuffer = '';

    // Edit/Write calls that Claude Code natively refuses (e.g. "sensitive
    // file" paths under .claude/) never reach the PreToolUse hook — Claude
    // denies them before the hook is consulted. We track each Edit/Write
    // tool_use here so that if its tool_result comes back as this kind of
    // native denial, we can offer the same browser approval card and, if
    // approved, write the change to disk ourselves.
    const pendingToolCalls = new Map<string, { name: string; input: Record<string, unknown> }>();
    const directApplyOutcomes: Array<{ file: string; applied: boolean; reason?: string }> = [];
    let directApplyInFlight = 0;
    let turnEnded = false;

    function maybeFinishTurn() {
      if (!turnEnded || directApplyInFlight > 0) return;
      turnEnded = false;

      if (directApplyOutcomes.length === 0) {
        child.stdin.end();
        return;
      }

      const lines = directApplyOutcomes.splice(0).map(o =>
        o.applied
          ? `- Applied directly to ${o.file} — Claude Code's Edit tool can't write this file, so AgentWatch wrote your approved change to disk outside the tool.`
          : `- NOT applied to ${o.file}${o.reason ? ` (${o.reason})` : ''}`
      );
      const continuation = [
        "The following Edit/Write attempts were blocked by Claude Code's own tool restrictions and were resolved outside the Edit tool after user review in AgentWatch:",
        '',
        ...lines,
        '',
        'Continue your task accordingly. Treat files marked "Applied directly" as already containing your intended change — do not re-attempt editing them with the same content.',
      ].join('\n');

      const msg = JSON.stringify({
        type: 'user',
        message: { role: 'user', content: [{ type: 'text', text: continuation }] },
      });
      child.stdin.write(msg + '\n', 'utf8');
    }

    async function handleBlockedEdit(name: string, input: Record<string, unknown>) {
      const requestId = randomUUID();
      broadcast('improvement_permission_request', { requestId, toolName: name, toolInput: input });
      const approved = await waitForApproval(requestId);
      broadcast('improvement_permission_resolved', { requestId, approved });

      const filePath = String(input.file_path ?? 'unknown file');
      if (!approved) {
        directApplyOutcomes.push({ file: filePath, applied: false, reason: 'denied by user' });
      } else {
        const result = applyEditLocally(name, input);
        directApplyOutcomes.push({ file: filePath, applied: result.ok, reason: result.error });
      }
    }

    function handleStreamEvent(line: string) {
      let event: Record<string, unknown>;
      try { event = JSON.parse(line); } catch { return; }

      broadcast('improvement_stream_event', { event });

      const eventType = event.type as string;

      if (eventType === 'system') {
        streamLog.push({ id: `s-${++streamIdCounter}`, kind: 'system', timestamp: Date.now(), text: 'Session initialized' });
      }

      if (eventType === 'assistant') {
        const msg = event.message as { content?: Array<{ type: string; text?: string; thinking?: string; id?: string; name?: string; input?: Record<string, unknown> }> } | undefined;
        if (!msg?.content) return;

        for (const block of msg.content) {
          if (block.type === 'text' && block.text) {
            responseChunks.push(block.text);
            streamLog.push({ id: `s-${++streamIdCounter}`, kind: 'text', timestamp: Date.now(), text: block.text });
          }
          if (block.type === 'thinking') {
            streamLog.push({ id: `s-${++streamIdCounter}`, kind: 'thinking', timestamp: Date.now(), text: block.thinking ?? '' });
          }
          if (block.type === 'tool_use') {
            streamLog.push({ id: `s-${++streamIdCounter}`, kind: 'tool_use', timestamp: Date.now(), toolName: block.name, toolInput: block.input, toolUseId: block.id });
            if (block.id && (block.name === 'Edit' || block.name === 'Write')) {
              pendingToolCalls.set(block.id, { name: block.name, input: block.input ?? {} });
            }
          }
        }
      }

      if (eventType === 'user') {
        const um = event.message as { content?: Array<{ type: string; tool_use_id?: string; content?: string; is_error?: boolean }> } | undefined;
        if (um?.content) {
          for (const block of um.content) {
            if (block.type === 'tool_result') {
              const content = typeof block.content === 'string' ? block.content : JSON.stringify(block.content);
              streamLog.push({
                id: `s-${++streamIdCounter}`, kind: 'tool_result', timestamp: Date.now(),
                toolUseId: block.tool_use_id, content,
                isError: block.is_error ?? false,
              });

              const call = block.tool_use_id ? pendingToolCalls.get(block.tool_use_id) : undefined;
              if (call && block.tool_use_id) {
                pendingToolCalls.delete(block.tool_use_id);
                if (block.is_error && isNativePermissionBlock(content ?? '')) {
                  directApplyInFlight++;
                  handleBlockedEdit(call.name, call.input).finally(() => {
                    directApplyInFlight--;
                    maybeFinishTurn();
                  });
                }
              }
            }
          }
        }
      }

      if (eventType === 'result') {
        turnEnded = true;
        maybeFinishTurn();
      }
    }

    child.stdout.on('data', (chunk: Buffer) => {
      stdoutBuffer += chunk.toString();
      const lines = stdoutBuffer.split('\n');
      stdoutBuffer = lines.pop() ?? '';
      for (const line of lines) {
        if (line.trim()) handleStreamEvent(line.trim());
      }
    });

    let stderr = '';
    child.stderr.on('data', (chunk: Buffer) => {
      stderr += chunk.toString();
    });

    let spawnError: Error | null = null;
    const exitCode = await new Promise<number>((resolve) => {
      child.on('close', (code) => resolve(code ?? 0));
      child.on('error', (err) => { spawnError = err; resolve(1); });
    });

    if (stdoutBuffer.trim()) {
      handleStreamEvent(stdoutBuffer.trim());
    }

    if (unsubscribe) unsubscribe();

    const fileChanges = captureFileChanges(projectCwd);
    const now = Date.now();
    const fullResponse = responseChunks.join('');

    let status: string;
    let response: string;

    if (exitCode === 0 && fullResponse) {
      status = 'completed';
      response = fullResponse;
    } else {
      status = (exitCode === 0 && !fullResponse) ? 'completed' : 'failed';
      const parts: string[] = [];
      if (spawnError) parts.push(`Spawn error: ${(spawnError as Error).message}`);
      if (stderr) parts.push(`Stderr:\n${stderr}`);
      if (fullResponse) parts.push(fullResponse);
      response = parts.length > 0 ? parts.join('\n\n') : `Process exited with code ${exitCode}`;
    }

    db.prepare(`
      UPDATE improvement_cycles
      SET claude_response = ?, status = ?, completed_at = ?, file_changes = ?, stream_entries = ?
      WHERE id = ?
    `).run(response, status, now, fileChanges.length ? JSON.stringify(fileChanges) : null, streamLog.length ? JSON.stringify(streamLog) : null, cycleId);

    broadcast('improvement_complete', { status, response, fileChanges });
  } catch (err) {
    const errMsg = String(err);
    db.prepare(`
      UPDATE improvement_cycles SET claude_response = ?, status = 'failed', completed_at = ? WHERE id = ?
    `).run(errMsg, Date.now(), cycleId);
    broadcast('improvement_failed', { error: errMsg });
  } finally {
    unregisterActiveCycle(sessionId);
    try { fs.unlinkSync(settingsPath); } catch { /* non-fatal */ }
  }
}

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id: sessionId } = await params;
    const db = getDatabase();
    const cycles = db.prepare(
      `SELECT * FROM improvement_cycles WHERE session_id = ? ORDER BY created_at DESC`
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

    const items = db.prepare(
      `SELECT * FROM feedback_items WHERE session_id = ? ORDER BY created_at ASC`
    ).all(sessionId) as DbFeedbackItem[];

    if (items.length === 0) {
      return NextResponse.json({ error: 'No feedback items to apply' }, { status: 400 });
    }

    // The improvement loop streams progress and delivers edit-approval prompts
    // over WebSocket. Without it the cycle would spawn Claude, hit denied edits,
    // and block waiting for approvals that can never arrive — hanging forever in
    // "applying". Fail fast with a clear message instead. (This is the case when
    // the app is started with `npm run dev` rather than `npm run dev:server`.)
    if (!getWsServer()) {
      return NextResponse.json(
        { error: 'WebSocket server is not running, so live streaming and edit approvals cannot be delivered. Start the app with "npm run dev:server" (not "npm run dev"), then try again.' },
        { status: 503 },
      );
    }

    const rewindCycleId = req.nextUrl.searchParams.get('rewind');
    if (rewindCycleId) {
      const targetCycle = db.prepare(
        `SELECT * FROM improvement_cycles WHERE id = ? AND session_id = ?`
      ).get(rewindCycleId, sessionId) as DbCycle | undefined;

      if (!targetCycle) return NextResponse.json({ error: 'Cycle not found' }, { status: 404 });

      // Count non-rewound cycles from the target cycle onward (inclusive).
      // Each improvement cycle adds exactly one conversation turn, so this is
      // also how many times we need to call /rewind.
      const { n: cyclesToRewind } = db.prepare(`
        SELECT COUNT(*) as n FROM improvement_cycles
        WHERE session_id = ? AND cycle_number >= ? AND status != 'rewound'
      `).get(sessionId, targetCycle.cycle_number) as { n: number };

      if (cyclesToRewind === 0) {
        return NextResponse.json({ error: 'All cycles from this point are already rewound' }, { status: 400 });
      }

      // Resolve the project working directory (same slug-decode logic as apply)
      let projectCwd = process.cwd();
      try {
        const conv = db.prepare(`SELECT file_path FROM conversations WHERE id = ?`).get(sessionId) as { file_path: string } | undefined;
        if (conv?.file_path) {
          const slug = path.basename(path.dirname(conv.file_path));
          const found = findProjectDirBySlug(slug);
          if (found) projectCwd = found;
        }
      } catch { /* fall back to server cwd */ }

      // Delegate to Claude Code's built-in /rewind for each cycle.
      // Each improvement cycle adds exactly one conversation turn, so one
      // /rewind call per cycle removes it — including the file changes it made.
      for (let i = 0; i < cyclesToRewind; i++) {
        try {
          execSync(
            `claude --resume ${sessionId} -p "/rewind" --dangerously-skip-permissions`,
            { cwd: projectCwd, shell: 'cmd.exe', stdio: 'pipe' }
          );
        } catch (e) {
          return NextResponse.json(
            { error: `Claude Code /rewind failed on turn ${i + 1}/${cyclesToRewind}: ${String(e)}` },
            { status: 500 }
          );
        }
      }

      // Restore any pre-cycle uncommitted changes that AgentWatch stashed before
      // the cycle ran. Claude Code's /rewind handles reverting its own file edits;
      // this stash pop restores whatever was already in the working tree beforehand.
      try {
        const stashList = execSync('git stash list', { cwd: projectCwd, shell: 'cmd.exe' }).toString('utf8');
        const line = stashList.split('\n').find(l => l.includes(`agentwatch-pre-${rewindCycleId}`));
        if (line) {
          const ref = line.split(':')[0].trim(); // e.g. "stash@{2}"
          execSync(`git stash pop ${ref}`, { cwd: projectCwd, shell: 'cmd.exe', stdio: 'pipe' });
        }
      } catch { /* non-fatal — stash may not exist if working tree was clean before the cycle */ }

      // Mark this cycle and all later ones as rewound
      db.prepare(`
        UPDATE improvement_cycles SET status = 'rewound'
        WHERE session_id = ? AND cycle_number >= ?
      `).run(sessionId, targetCycle.cycle_number);

      return NextResponse.json({ ok: true, rewoundCycles: cyclesToRewind });
    }

    // Allow an optional custom prompt and skill selection from the client
    let body: { customPrompt?: string; skillIds?: string[] } = {};
    try { body = await req.json(); } catch { /* no body is fine */ }

    const row = db.prepare(
      `SELECT MAX(cycle_number) as n FROM improvement_cycles WHERE session_id = ?`
    ).get(sessionId) as { n: number | null };
    const cycleNumber = (row?.n ?? 0) + 1;

    // Query the JSONL path once — used for snapshot size, projectCwd, and external skill detection
    const conv = db.prepare('SELECT file_path FROM conversations WHERE id = ?').get(sessionId) as { file_path: string } | undefined;
    const jsonlPath = conv?.file_path ?? null;

    let snapshotSize = 0;
    try {
      if (jsonlPath && fs.existsSync(jsonlPath)) {
        snapshotSize = fs.statSync(jsonlPath).size;
      }
    } catch { /* non-fatal */ }

    const projectCwd = resolveProjectCwd(db, sessionId);
    const invokedSkills = jsonlPath ? findInvokedSkillsFromSession(jsonlPath) : [];
    const selectedSkills = resolveSelectedSkills(body.skillIds ?? [], invokedSkills);

    const externalSkillDirs = Array.from(new Set([
      ...(jsonlPath ? findExternalSkillDirsFromSession(jsonlPath, projectCwd) : []),
      ...selectedSkills.filter(s => s.kind === 'path').map(s => s.dir),
    ]));
    const prompt = body.customPrompt?.trim() || generateImprovementPrompt(sessionId, items, selectedSkills);
    const cycleId = randomUUID();
    const now = Date.now();

    db.prepare(`
      INSERT INTO improvement_cycles
        (id, session_id, cycle_number, feedback_ids, generated_prompt, status, jsonl_snapshot_size, created_at)
      VALUES (?, ?, ?, ?, ?, 'applying', ?, ?)
    `).run(cycleId, sessionId, cycleNumber, JSON.stringify(items.map(i => i.id)), prompt, snapshotSize || null, now);

    // Fire-and-forget — client polls GET or listens via WebSocket
    setImmediate(() => runClaudeResumeAsync(cycleId, sessionId, prompt, projectCwd, externalSkillDirs));

    const cycle = db.prepare(`SELECT * FROM improvement_cycles WHERE id = ?`).get(cycleId) as DbCycle;
    return NextResponse.json(mapCycle(cycle), { status: 201 });
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}

export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id: sessionId } = await params;
    const db = getDatabase();

    if (req.nextUrl.searchParams.get('clearRewound') === 'true') {
      db.prepare(`DELETE FROM improvement_cycles WHERE session_id = ? AND status = 'rewound'`).run(sessionId);
      return NextResponse.json({ ok: true });
    }

    const cycleId = req.nextUrl.searchParams.get('cycleId');
    if (!cycleId) return NextResponse.json({ error: 'Missing cycleId' }, { status: 400 });

    const result = db.prepare(`DELETE FROM improvement_cycles WHERE id = ? AND session_id = ?`).run(cycleId, sessionId);
    if (result.changes === 0) return NextResponse.json({ error: 'Cycle not found' }, { status: 404 });

    return NextResponse.json({ ok: true });
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
