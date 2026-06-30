import { NextRequest, NextResponse } from 'next/server';
import { getDatabase } from '@/lib/db/database';
import { getWsServer } from '@/lib/websocket/ws-server';
import { randomUUID } from 'crypto';
import { spawn, execSync } from 'child_process';
import path from 'path';
import fs from 'fs';
import os from 'os';
import { registerActiveCycle, unregisterActiveCycle, resolveApproval } from '@/lib/hooks/permission-state';

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

function formatCategory(category: string): string {
  return category.split('_').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');
}

function generateImprovementPrompt(sessionId: string, items: DbFeedbackItem[]): string {
  const byAgent = new Map<string, DbFeedbackItem[]>();
  for (const item of items) {
    if (!byAgent.has(item.agent_id)) byAgent.set(item.agent_id, []);
    byAgent.get(item.agent_id)!.push(item);
  }

  const byCategory = new Map<string, DbFeedbackItem[]>();
  for (const item of items) {
    if (!byCategory.has(item.category)) byCategory.set(item.category, []);
    byCategory.get(item.category)!.push(item);
  }

  const sortedCategories = Array.from(byCategory.entries()).sort((a, b) => b[1].length - a[1].length);

  const lines: string[] = [];

  lines.push(`# Multi-Agent Workflow Design Review — ${new Date().toISOString().slice(0, 10)}`);
  lines.push(`\nSession: \`${sessionId}\``);

  lines.push(`\n## Purpose\n`);
  lines.push(`This review presents structured observations from a completed multi-agent workflow execution. The goal is **not** to patch individual failures or encode session-specific rules. The goal is to evolve the design of the workflow itself — updating orchestrator logic, agent responsibilities, skill definitions, and reasoning patterns so that all components can independently recognize and handle similar situations across any future execution.\n`);
  lines.push(`**Constraint: Do not introduce hardcoded fixes, task-specific rules, or logic that only applies to the inputs or artifacts of this session.** Every proposed change must remain correct and beneficial across future workflow executions with entirely different tasks, contexts, and inputs.\n`);

  lines.push(`## Observed Failure Patterns (${items.length} observation${items.length !== 1 ? 's' : ''} across ${byAgent.size} agent${byAgent.size !== 1 ? 's' : ''})\n`);
  lines.push(`Observations are grouped by failure type to surface structural patterns rather than individual agent mistakes:\n`);

  for (const [cat, catItems] of sortedCategories) {
    lines.push(`### ${formatCategory(cat)} (${catItems.length})\n`);
    for (const item of catItems) {
      const agentLabel = item.agent_name || item.agent_id.slice(0, 12);
      lines.push(`- ${item.text} *(context: ${agentLabel})*`);
    }
    lines.push('');
  }

  const recurringCategories = sortedCategories.filter(([, catItems]) => catItems.length >= 2);
  if (recurringCategories.length > 0) {
    lines.push(`## Cross-Agent Patterns\n`);
    lines.push(`These failure types appeared in multiple agents, indicating systemic weaknesses in the workflow design rather than isolated mistakes:\n`);
    for (const [cat, catItems] of recurringCategories) {
      const agentNames = [...new Set(catItems.map(i => i.agent_name || i.agent_id.slice(0, 12)))];
      lines.push(`- **${formatCategory(cat)}** — ${catItems.length} observations across: ${agentNames.join(', ')}`);
    }
    lines.push('');
  }

  lines.push(`## Improvement Request\n`);
  lines.push(`For each observed failure pattern, analyze the workflow design and produce a targeted improvement. Structure each improvement as follows:\n`);
  lines.push(`1. **Root cause** — What workflow design weakness caused this class of failure? Do not describe what went wrong in this specific execution. Identify what is missing or incorrect in the agent's instructions, reasoning approach, validation logic, or coordination design that would cause any agent to make this type of mistake.`);
  lines.push(`2. **Affected component** — Which workflow component should change: the orchestrator's task decomposition or delegation logic, a specific agent type's responsibilities or reasoning patterns, a skill definition, or a coordination/handoff mechanism?`);
  lines.push(`3. **Proposed change** — Write a concrete addition or modification to that component's system prompt or behavioral contract. Be specific: describe exactly what the agent should do, when, and under what conditions. Avoid vague directives like "be more careful" or "validate outputs" — specify the reasoning step, verification action, or re-evaluation trigger.`);
  lines.push(`4. **Self-correction signal** — How should the agent recognize, mid-execution, that it may be in a situation similar to what triggered this feedback? What internal signal, uncertainty indicator, or evidence gap should prompt the agent to gather more context, re-verify an assumption, or escalate rather than proceed?`);
  lines.push(`5. **Generalizability check** — Explicitly confirm that this change applies correctly across future executions with different inputs, tasks, and contexts. If the change would only help for tasks similar to this session, discard it and rethink from the root cause.\n`);

  lines.push(`Address the following workflow dimensions where the observations reveal gaps:\n`);
  lines.push(`- **Orchestrator design** — task decomposition strategy, agent selection criteria, delegation scope, and completion verification`);
  lines.push(`- **Agent reasoning patterns** — how agents form hypotheses, assess confidence, and decide when more evidence is needed before acting`);
  lines.push(`- **Validation and self-correction** — when and how agents challenge their own outputs, re-examine assumptions, and detect errors before returning results`);
  lines.push(`- **Context and evidence gathering** — what context agents should proactively seek, how they distinguish sufficient from insufficient evidence, and when to pause and verify`);
  lines.push(`- **Skill and capability usage** — whether the right capabilities are invoked at the right time with appropriate scope and error handling`);
  lines.push(`- **Artifact and output quality** — what completeness, structure, and accuracy standards agents apply before considering an output ready`);
  lines.push(`- **Coordination and handoffs** — what information must be explicitly transferred between agents and what each receiving agent must verify before continuing\n`);

  lines.push(`## Output Format\n`);
  lines.push(`Produce one improvement entry per failure pattern (not per individual feedback item). Each entry should contain a concrete system prompt addition or behavioral change that can be directly applied to the relevant workflow component.\n`);
  lines.push(`The final output should read as a set of workflow design changes — not a post-mortem of this specific execution, and not a checklist of things to watch for on similar tasks. Every improvement must make the affected component more reliable and self-correcting across all future executions.\n`);

  lines.push(`## Execution Instructions\n`);
  lines.push(`**IMPORTANT: After presenting your analysis and proposed changes, immediately proceed to apply them.** Do NOT ask for confirmation or approval before making changes. Do NOT say "shall I proceed?" or "would you like me to implement these?". This prompt is the approval — analyze the issues, present the improvements, then directly edit the relevant files to implement every proposed change. If an edit fails or is denied, skip it and continue with the remaining changes.`);

  return lines.join('\n');
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

// ── External skill/agent directory discovery ────────────────────────────────
// When a session runs in project A but its skills/agents are defined in
// project B, parse the session JSONL to find those external paths so the
// improvement prompt can include them for Read/Edit.

function findExternalSkillDirsFromSession(jsonlPath: string, projectCwd: string): string[] {
  let raw: string;
  try { raw = fs.readFileSync(jsonlPath, 'utf8'); } catch { return []; }

  const dirs = new Set<string>();
  const normalizedCwd = path.resolve(projectCwd);

  // In the JSONL, skill/agent paths appear in two forms:
  // 1. JSON-escaped backslashes: C:\\Users\\...\.claude\\skills
  // 2. Forward slashes (tool inputs): C:/Users/.../.claude/skills
  const patterns = [
    /([A-Za-z]:\\\\[^"]*?\\\\.claude\\\\(?:skills|agents))/g,
    /([A-Za-z]:\/[^"]*?\/\.claude\/(?:skills|agents))/g,
  ];

  for (const re of patterns) {
    let match;
    while ((match = re.exec(raw)) !== null) {
      const unescaped = match[1].replace(/\\\\/g, '\\').replace(/\//g, '\\');
      try {
        const resolved = path.resolve(unescaped);
        if (!resolved.startsWith(normalizedCwd)) {
          dirs.add(resolved);
        }
      } catch { continue; }
    }
  }

  return Array.from(dirs).filter(dir => {
    try { return fs.statSync(dir).isDirectory(); } catch { return false; }
  });
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
      '--settings', settingsPath,
      '--include-hook-events',
    ];

    // Grant Read access to external skill/agent directories
    for (const dir of externalSkillDirs) {
      cliArgs.push('--add-dir', dir);
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
          }
        }
      }

      if (eventType === 'user') {
        const um = event.message as { content?: Array<{ type: string; tool_use_id?: string; content?: string; is_error?: boolean }> } | undefined;
        if (um?.content) {
          for (const block of um.content) {
            if (block.type === 'tool_result') {
              streamLog.push({
                id: `s-${++streamIdCounter}`, kind: 'tool_result', timestamp: Date.now(),
                toolUseId: block.tool_use_id, content: typeof block.content === 'string' ? block.content : JSON.stringify(block.content),
                isError: block.is_error ?? false,
              });
            }
          }
        }
      }

      if (eventType === 'result') {
        child.stdin.end();
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

    // Allow an optional custom prompt from the client (user-edited version)
    let body: { customPrompt?: string } = {};
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
    const externalSkillDirs = jsonlPath ? findExternalSkillDirsFromSession(jsonlPath, projectCwd) : [];
    const prompt = body.customPrompt?.trim() || generateImprovementPrompt(sessionId, items);
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
