import { NextRequest, NextResponse } from 'next/server';
import { getDatabase } from '@/lib/db/database';
import { getWsServer } from '@/lib/websocket/ws-server';
import { randomUUID } from 'crypto';
import { execSync } from 'child_process';
import path from 'path';
import fs from 'fs';
import { registerActiveCycle, unregisterActiveCycle, resolveApproval, waitForApproval } from '@/lib/hooks/permission-state';
import { generateImprovementPrompt } from '@/lib/services/improvement-prompt';
import { findExternalSkillDirsFromSession, findInvokedSkillsFromSession } from '@/lib/services/external-dirs';
import { resolveSelectedSkills } from '@/lib/services/skill-catalog';
import { applyEditLocally, isNativePermissionBlock } from '@/lib/services/direct-edit-apply';
import { readCwdFromJsonl } from '@/lib/parser/session-cwd';
import {
  spawnClaudeCli,
  writeUserTurn,
  attachStreamJsonParser,
  waitForClaudeExit,
  writePermissionHookSettings,
} from '@/lib/services/claude-cli';
import { translateStreamEvent, createStreamLogger, createCycleBroadcaster } from '@/lib/services/cli-stream-log';

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
  permission_mode: string | null;
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
    permissionMode: row.permission_mode ?? 'approve',
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

// ── Stream-JSON runner ───────────────────────────────────────────────────────

// The session's own JSONL transcript records the real working directory
// Claude Code was run from (the "cwd" field on its first line) — read that
// directly rather than guessing the project's location from its Claude
// Code slug, which breaks for any project outside the user's home directory.
function resolveProjectCwd(db: ReturnType<typeof getDatabase>, sessionId: string): string {
  try {
    const conv = db.prepare('SELECT file_path FROM conversations WHERE id = ?').get(sessionId) as { file_path: string } | undefined;
    if (conv?.file_path && fs.existsSync(conv.file_path)) {
      const cwd = readCwdFromJsonl(conv.file_path);
      if (cwd) return cwd;
    }
  } catch { /* fall back to server cwd */ }
  return process.cwd();
}

async function runClaudeResumeAsync(
  cycleId: string,
  sessionId: string,
  prompt: string,
  resolvedProjectCwd?: string,
  externalSkillDirs: string[] = [],
  skipPermissions = false,
) {
  const wss = getWsServer();
  const db = getDatabase();

  const broadcast = createCycleBroadcaster({ sessionId, cycleId });

  // Detect WSL sessions by scanning all configured sources.
  // AGENTWATCH_SOURCES format: "Label:/path,Label2:/path2" — colon-split on first colon.
  type WslCtx = { distro: string; wslCwd: string };
  let wslCtx: WslCtx | undefined;
  let sessionDb = db;
  const rawSources = process.env.AGENTWATCH_SOURCES ?? '';
  if (rawSources) {
    for (const entry of rawSources.split(',')) {
      const ci = entry.indexOf(':');
      if (ci < 0) continue;
      const label = entry.slice(0, ci).trim();
      const srcPath = entry.slice(ci + 1).trim();
      const srcId = label.toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, '');
      const distroMatch = srcPath.match(/^\/\/wsl[^/]*\/([^/]+)/i);
      if (!distroMatch) continue; // not a WSL source
      // Step 1: check if this session exists in the WSL DB (separate try-catch)
      let wslDistro: string | undefined;
      let jsonlFilePath: string | undefined;
      try {
        const wslDb = getDatabase(srcId);
        const row = wslDb.prepare('SELECT file_path FROM conversations WHERE id = ?').get(sessionId) as { file_path: string } | undefined;
        if (row?.file_path) {
          sessionDb = wslDb;
          wslDistro = distroMatch[1];
          jsonlFilePath = row.file_path;
        }
      } catch { /* DB not accessible */ }
      if (!wslDistro) continue;

      // Step 2: read cwd from JSONL — optional, fallback to home dir
      let wslCwd = '~';
      const cwdFromJsonl = readCwdFromJsonl(jsonlFilePath!);
      if (cwdFromJsonl) wslCwd = cwdFromJsonl;
      wslCtx = { distro: wslDistro, wslCwd };
      break;
    }
  }

  const projectCwd = resolvedProjectCwd ?? resolveProjectCwd(sessionDb, sessionId);

  // Snapshot the working tree before Claude runs so rewind can restore it.
  // Skip for WSL sessions (cmd.exe can't run git in WSL cwd) and when the
  // cwd fell back to process.cwd() — that would stash AgentWatch's own files.
  const appCwd = process.cwd();
  if (!wslCtx && path.resolve(projectCwd) !== path.resolve(appCwd)) {
    try {
      execSync(`git stash push --include-untracked -m "agentwatch-pre-${cycleId}"`, {
        cwd: projectCwd, shell: 'cmd.exe', stdio: 'pipe',
      });
    } catch { /* not a git repo, or nothing to stash — non-fatal */ }
  }

  const responseChunks: string[] = [];
  const log = createStreamLogger('s');

  // In skip-permissions mode there's no PreToolUse hook to wire up — Claude
  // runs with --dangerously-skip-permissions and never calls out for approval.
  let cleanupSettings: () => void = () => {};
  let settingsPath: string | undefined;
  if (!skipPermissions) {
    const hookSettings = writePermissionHookSettings('agentwatch-hook', cycleId);
    settingsPath = hookSettings.settingsPath;
    cleanupSettings = hookSettings.cleanup;
    // Register this cycle so the hook endpoint knows which session is active
    registerActiveCycle(sessionId, cycleId);
  }

  try {
    broadcast('improvement_started', {});

    // WSL session: route through wsl -d <distro> --cd <wslCwd> so claude can
    // access its own session data — projectCwd may have fallen back to this
    // server's own cwd here, since resolveProjectCwd's fs.existsSync guard
    // can't stat a native WSL path from a Windows-side process. wslCtx.wslCwd
    // was read directly from the WSL session's own JSONL instead.
    const child = spawnClaudeCli({
      resumeSessionId: sessionId,
      cwd: wslCtx ? wslCtx.wslCwd : projectCwd,
      wslDistro: wslCtx?.distro ?? null,
      permission: skipPermissions ? { mode: 'skipPermissions' } : { mode: 'hook', settingsPath: settingsPath! },
      // Grant Read access to external skill/agent directories.
      externalDirs: externalSkillDirs,
    });

    writeUserTurn(child, prompt);

    // Route browser approval responses to the shared permission state
    const unsubscribe = wss?.onClientMessage((msg) => {
      if (msg.type === 'permission_response' && msg.cycleId === cycleId) {
        resolveApproval(msg.requestId, msg.approved);
      }
    });

    // Edit/Write calls that Claude Code natively refuses (e.g. "sensitive
    // file" paths under .claude/) never reach the PreToolUse hook — Claude
    // denies them before the hook is consulted. We track each Edit/Write
    // tool_use here so that if its tool_result comes back as this kind of
    // native denial, we can offer the same browser approval card and, if
    // approved, write the change to disk ourselves.
    const pendingToolCalls = new Map<string, { name: string; input: Record<string, unknown> }>();
    const directApplyOutcomes: Array<{ file: string; applied: boolean; reason?: string }> = [];
    // Claude sometimes emits more than one tool_use for what is content-wise
    // the same edit (e.g. a duplicated parallel tool call) — each gets its
    // own toolUseId, so without this they'd each independently trigger
    // handleBlockedEdit and show the user two approval cards for one change.
    // Keyed by the edit's actual content, not toolUseId, so duplicates reuse
    // the first request's outcome instead of prompting again.
    const blockedEditResults = new Map<string, Promise<{ applied: boolean; reason?: string }>>();
    let directApplyInFlight = 0;
    let turnEnded = false;

    function maybeFinishTurn() {
      if (!turnEnded || directApplyInFlight > 0) return;
      turnEnded = false;

      if (directApplyOutcomes.length === 0) {
        child.stdin.end();
        return;
      }

      // Duplicate tool_use calls resolved to the same outcome (see
      // blockedEditResults above) — collapse them so the continuation
      // message doesn't repeat the same line per duplicate call.
      const outcomes = directApplyOutcomes.splice(0);
      const seenOutcomes = new Set<string>();
      const dedupedOutcomes = outcomes.filter(o => {
        const key = `${o.file}::${o.applied}::${o.reason ?? ''}`;
        if (seenOutcomes.has(key)) return false;
        seenOutcomes.add(key);
        return true;
      });

      const lines = dedupedOutcomes.map(o =>
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
      const filePath = String(input.file_path ?? 'unknown file');
      const dedupeKey = JSON.stringify([name, filePath, input.old_string ?? input.content ?? '', input.new_string ?? '']);

      let resultPromise = blockedEditResults.get(dedupeKey);
      if (!resultPromise) {
        resultPromise = (async (): Promise<{ applied: boolean; reason?: string }> => {
          let approved: boolean;

          if (skipPermissions) {
            // Skip mode is meant to be fully autonomous — a native "sensitive
            // file" block isn't the interactive permission system, so it
            // still needs this path, but it shouldn't stop and ask either.
            approved = true;
          } else {
            const requestId = randomUUID();
            broadcast('improvement_permission_request', { requestId, toolName: name, toolInput: input });
            const result = await waitForApproval(requestId);
            approved = result.approved;
            broadcast('improvement_permission_resolved', { requestId, approved: result.approved, expired: result.expired });
          }

          if (!approved) return { applied: false, reason: 'denied by user' };
          const applyResult = applyEditLocally(name, input, projectCwd);
          return { applied: applyResult.ok, reason: applyResult.error };
        })();
        blockedEditResults.set(dedupeKey, resultPromise);
      }

      const { applied, reason } = await resultPromise;
      directApplyOutcomes.push({ file: filePath, applied, reason });
    }

    function handleStreamEvent(event: Record<string, unknown>) {
      broadcast('improvement_stream_event', { event });

      const eventType = event.type as string;

      if (eventType === 'system') {
        log.push({ kind: 'system', text: 'Session initialized' });
      }

      for (const entry of translateStreamEvent(event)) {
        log.push(entry);

        if (entry.kind === 'text' && entry.text) {
          responseChunks.push(entry.text);
        }

        if (entry.kind === 'tool_use' && entry.toolUseId && (entry.toolName === 'Edit' || entry.toolName === 'Write')) {
          pendingToolCalls.set(entry.toolUseId, { name: entry.toolName, input: entry.toolInput ?? {} });
        }

        if (entry.kind === 'tool_result' && entry.toolUseId) {
          const call = pendingToolCalls.get(entry.toolUseId);
          if (call) {
            pendingToolCalls.delete(entry.toolUseId);
            if (entry.isError && isNativePermissionBlock(entry.content ?? '')) {
              directApplyInFlight++;
              handleBlockedEdit(call.name, call.input).finally(() => {
                directApplyInFlight--;
                maybeFinishTurn();
              });
            }
          }
        }
      }

      if (eventType === 'result') {
        turnEnded = true;
        maybeFinishTurn();
      }
    }

    const { flushRemaining, getStderr } = attachStreamJsonParser(child, handleStreamEvent);

    const { exitCode, spawnError } = await waitForClaudeExit(child);

    flushRemaining();
    const stderr = getStderr();

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
    `).run(response, status, now, fileChanges.length ? JSON.stringify(fileChanges) : null, log.entries.length ? JSON.stringify(log.entries) : null, cycleId);

    broadcast('improvement_complete', { status, response, fileChanges });
  } catch (err) {
    const errMsg = String(err);
    db.prepare(`
      UPDATE improvement_cycles SET claude_response = ?, status = 'failed', completed_at = ? WHERE id = ?
    `).run(errMsg, Date.now(), cycleId);
    broadcast('improvement_failed', { error: errMsg });
  } finally {
    unregisterActiveCycle(sessionId);
    cleanupSettings();
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

    // Hard guard against a second cycle starting (or a rewind running) while
    // one is still applying — the pre-run `git stash` snapshots the whole
    // working tree, so an overlapping cycle would stash away (and appear to
    // silently discard) the first cycle's not-yet-committed edits.
    const activeCycle = db.prepare(
      `SELECT id FROM improvement_cycles WHERE session_id = ? AND status = 'applying'`
    ).get(sessionId) as { id: string } | undefined;
    if (activeCycle) {
      return NextResponse.json(
        { error: 'An improvement cycle is already running for this session. Wait for it to finish before starting another.' },
        { status: 409 },
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

      // Resolve the project working directory (same logic as apply)
      const projectCwd = resolveProjectCwd(db, sessionId);

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

    // Allow an optional custom prompt, skill selection, and permission mode from the client
    let body: { customPrompt?: string; skillIds?: string[]; skipPermissions?: boolean } = {};
    try { body = await req.json(); } catch { /* no body is fine */ }
    const skipPermissions = body.skipPermissions === true;

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
        (id, session_id, cycle_number, feedback_ids, generated_prompt, status, jsonl_snapshot_size, permission_mode, created_at)
      VALUES (?, ?, ?, ?, ?, 'applying', ?, ?, ?)
    `).run(cycleId, sessionId, cycleNumber, JSON.stringify(items.map(i => i.id)), prompt, snapshotSize || null, skipPermissions ? 'skip' : 'approve', now);

    // Fire-and-forget — client polls GET or listens via WebSocket
    setImmediate(() => runClaudeResumeAsync(cycleId, sessionId, prompt, projectCwd, externalSkillDirs, skipPermissions));

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
