import { NextRequest, NextResponse } from 'next/server';
import { getDatabase } from '@/lib/db/database';
import { getWsServer } from '@/lib/websocket/ws-server';
import { randomUUID } from 'crypto';
import { spawn, execSync } from 'child_process';
import path from 'path';
import fs from 'fs';

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
    // Changes to tracked files
    const diffOutput = execSync('git diff -U3', {
      cwd: projectCwd, shell: true, timeout: 10_000,
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

    // New untracked files not in git yet
    const untrackedRaw = execSync('git ls-files --others --exclude-standard', {
      cwd: projectCwd, shell: true, timeout: 5_000,
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
  lines.push(`The final output should read as a set of workflow design changes — not a post-mortem of this specific execution, and not a checklist of things to watch for on similar tasks. Every improvement must make the affected component more reliable and self-correcting across all future executions.`);

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

async function runClaudeResumeAsync(cycleId: string, sessionId: string, prompt: string) {
  const wss = getWsServer();
  const db = getDatabase();

  const broadcast = (type: string, payload: Record<string, unknown>) => {
    wss?.broadcast({ type, sessionId, cycleId, ...payload } as never);
  };

  // Resolve the original project's working directory so `claude --resume` can
  // find the session. Claude only searches sessions for the project matching
  // the current working directory.
  //
  // The slug (e.g. C--Users-makum-Zeroni-Product-ZER-app) cannot be
  // unambiguously decoded because spaces, path separators, and literal dashes
  // are all encoded as '-'. Instead we search the filesystem for the real
  // directory whose encoded form matches the slug.
  let projectCwd = process.cwd();
  try {
    const conv = db.prepare('SELECT file_path FROM conversations WHERE id = ?').get(sessionId) as { file_path: string } | undefined;
    if (conv?.file_path) {
      const slug = path.basename(path.dirname(conv.file_path)); // e.g. C--Users-makum-Zeroni-Product-ZER-app
      const found = findProjectDirBySlug(slug);
      if (found) projectCwd = found;
    }
  } catch {
    // fall back to server cwd — resume may fail if project dir can't be found
  }

  // Snapshot the working tree before Claude runs so rewind can restore it.
  // Named by cycleId — no DB column needed; found on rewind via `git stash list`.
  try {
    execSync(`git stash push --include-untracked -m "agentwatch-pre-${cycleId}"`, {
      cwd: projectCwd, shell: true, stdio: 'pipe',
    });
  } catch { /* not a git repo, or nothing to stash — non-fatal */ }

  let stdout = '';
  let stderr = '';

  try {
    broadcast('improvement_started', {});

    // shell:true resolves Windows .cmd wrappers; stdio:pipe so we can write
    // the prompt via stdin (avoids cmd.exe arg-length / newline limits).
    // --dangerously-skip-permissions: the user reviewed and approved the prompt
    // before clicking Apply, so authorization happened at the UI level. Without
    // this flag, each Edit/Write call blocks waiting for interactive approval
    // that can never arrive because stdin is already closed after the prompt.
    const child = spawn('claude', ['--resume', sessionId, '-p', '--dangerously-skip-permissions'], {
      shell: true,
      cwd: projectCwd,
      env: { ...process.env },
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    // Write prompt to stdin — cleaner than CLI arg for multiline content
    child.stdin.write(prompt, 'utf8');
    child.stdin.end();

    child.stdout.on('data', (chunk: Buffer) => {
      const text = chunk.toString();
      stdout += text;
      broadcast('improvement_chunk', { chunk: text });
    });

    child.stderr.on('data', (chunk: Buffer) => {
      const text = chunk.toString();
      stderr += text;
      broadcast('improvement_chunk', { chunk: text });
    });

    let spawnError: Error | null = null;
    const exitCode = await new Promise<number>((resolve) => {
      child.on('close', (code) => resolve(code ?? 0));
      child.on('error', (err) => { spawnError = err; resolve(1); });
    });

    // Capture which files changed before writing the DB record
    const fileChanges = captureFileChanges(projectCwd);

    const now = Date.now();
    let response: string;
    let status: string;

    if (exitCode === 0 && stdout) {
      status = 'completed';
      response = stdout;
    } else {
      status = 'failed';
      const errParts: string[] = [];
      if (spawnError) errParts.push(`Spawn error: ${(spawnError as Error).message}`);
      if (stderr) errParts.push(`Stderr:\n${stderr}`);
      if (stdout) errParts.push(`Stdout:\n${stdout}`);
      if (!errParts.length) errParts.push(`Process exited with code ${exitCode}`);
      response = errParts.join('\n\n');
    }

    db.prepare(`
      UPDATE improvement_cycles
      SET claude_response = ?, status = ?, completed_at = ?, file_changes = ?
      WHERE id = ?
    `).run(response, status, now, fileChanges.length ? JSON.stringify(fileChanges) : null, cycleId);

    broadcast('improvement_complete', { status, response, fileChanges });
  } catch (err) {
    const errMsg = String(err);
    db.prepare(`
      UPDATE improvement_cycles SET claude_response = ?, status = 'failed', completed_at = ? WHERE id = ?
    `).run(errMsg, Date.now(), cycleId);
    broadcast('improvement_failed', { error: errMsg });
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

      // Use Claude Code's built-in /rewind for each cycle.
      // Each improvement cycle adds exactly one turn (one user prompt + one
      // assistant response), so one /rewind call per cycle removes it cleanly.
      for (let i = 0; i < cyclesToRewind; i++) {
        try {
          execSync(
            `claude --resume ${sessionId} -p "/rewind" --dangerously-skip-permissions`,
            { cwd: projectCwd, shell: true, stdio: 'pipe' }
          );
        } catch (e) {
          return NextResponse.json(
            { error: `Claude Code /rewind failed on turn ${i + 1}/${cyclesToRewind}: ${String(e)}` },
            { status: 500 }
          );
        }
      }

      // Restore file changes made during the rewound cycle(s).
      // /rewind only removes conversation turns — file edits must be undone separately.
      try { execSync('git restore .', { cwd: projectCwd, shell: true, stdio: 'pipe' }); } catch { /* non-fatal */ }
      try { execSync('git clean -fd', { cwd: projectCwd, shell: true, stdio: 'pipe' }); } catch { /* non-fatal */ }

      // Pop the stash saved before the target cycle ran (contains pre-cycle file state)
      try {
        const stashList = execSync('git stash list', { cwd: projectCwd, shell: true }).toString('utf8');
        const line = stashList.split('\n').find(l => l.includes(`agentwatch-pre-${rewindCycleId}`));
        if (line) {
          const ref = line.split(':')[0].trim(); // e.g. "stash@{2}"
          execSync(`git stash pop ${ref}`, { cwd: projectCwd, shell: true, stdio: 'pipe' });
        }
      } catch { /* non-fatal — stash may not exist if the working tree was clean */ }

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

    // Capture the JSONL file size BEFORE spawning Claude, so the user can rewind to this point later
    let snapshotSize = 0;
    try {
      const conv = db.prepare(`SELECT file_path FROM conversations WHERE id = ?`).get(sessionId) as { file_path: string } | undefined;
      if (conv?.file_path && fs.existsSync(conv.file_path)) {
        snapshotSize = fs.statSync(conv.file_path).size;
      }
    } catch { /* non-fatal */ }

    const prompt = body.customPrompt?.trim() || generateImprovementPrompt(sessionId, items);
    const cycleId = randomUUID();
    const now = Date.now();

    db.prepare(`
      INSERT INTO improvement_cycles
        (id, session_id, cycle_number, feedback_ids, generated_prompt, status, jsonl_snapshot_size, created_at)
      VALUES (?, ?, ?, ?, ?, 'applying', ?, ?)
    `).run(cycleId, sessionId, cycleNumber, JSON.stringify(items.map(i => i.id)), prompt, snapshotSize || null, now);

    // Fire-and-forget — client polls GET or listens via WebSocket
    setImmediate(() => runClaudeResumeAsync(cycleId, sessionId, prompt));

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
