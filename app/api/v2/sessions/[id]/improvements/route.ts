import { NextRequest, NextResponse } from 'next/server';
import { getDatabase } from '@/lib/db/database';
import { getWsServer } from '@/lib/websocket/ws-server';
import { randomUUID } from 'crypto';
import { spawn } from 'child_process';
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
  };
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

  const byCategory = new Map<string, number>();
  for (const item of items) {
    byCategory.set(item.category, (byCategory.get(item.category) ?? 0) + 1);
  }

  const lines: string[] = [];

  lines.push(`# Workflow Improvement Review — Cycle ${new Date().toISOString().slice(0, 10)}`);
  lines.push(`\nSession: \`${sessionId}\``);
  lines.push(`\nA structured human review of this multi-agent workflow execution has produced ${items.length} feedback item${items.length !== 1 ? 's' : ''} spanning ${byAgent.size} agent${byAgent.size !== 1 ? 's' : ''}. The feedback was collected by reviewing agent responses, reasoning quality, tool usage, artifacts, and workflow decisions.\n`);

  lines.push(`## Feedback Summary\n`);
  const sortedCategories = Array.from(byCategory.entries()).sort((a, b) => b[1] - a[1]);
  for (const [cat, count] of sortedCategories) {
    lines.push(`- **${formatCategory(cat)}**: ${count}`);
  }

  lines.push(`\n## Detailed Feedback by Agent\n`);
  for (const [agentId, agentItems] of byAgent.entries()) {
    const name = agentItems[0]?.agent_name || agentId.slice(0, 12);
    lines.push(`### ${name}\n`);
    for (const item of agentItems) {
      lines.push(`- **[${formatCategory(item.category)}]** ${item.text}`);
    }
    lines.push('');
  }

  // Identify recurring themes
  const recurringCategories = sortedCategories.filter(([, count]) => count >= 2);
  if (recurringCategories.length > 0) {
    lines.push(`## Recurring Patterns\n`);
    lines.push(`The following issues appear across multiple agents and represent systemic weaknesses:\n`);
    for (const [cat, count] of recurringCategories) {
      lines.push(`- **${formatCategory(cat)}** (${count} occurrences) — this is a cross-agent pattern, not an isolated incident`);
    }
    lines.push('');
  }

  lines.push(`## Improvement Request\n`);
  lines.push(`Based on this structured review, please analyze the workflow and propose specific, systemic improvements. Do not propose one-time patches — propose durable changes to the workflow design, agent instructions, and coordination patterns that will prevent these issues from recurring across future executions.\n`);
  lines.push(`Address each of the following dimensions where the feedback reveals gaps:\n`);
  lines.push(`1. **Orchestrator behavior** — delegation strategy, decision-making, and agent coordination`);
  lines.push(`2. **Agent responsibilities** — task scoping, ownership boundaries, and handoff clarity`);
  lines.push(`3. **Context gathering** — how and when agents gather context before acting`);
  lines.push(`4. **Validation patterns** — how outputs are verified and assumptions are challenged`);
  lines.push(`5. **Artifact design** — completeness, structure, and handoff quality of outputs`);
  lines.push(`6. **Edge case coverage** — how the workflow handles unexpected or missing inputs`);
  lines.push(`7. **Evidence standards** — what level of evidence is required before drawing conclusions\n`);
  lines.push(`For each proposed improvement, specify:`);
  lines.push(`- The affected agent or workflow component`);
  lines.push(`- What specifically needs to change in its instructions or behavior`);
  lines.push(`- How this change prevents the identified issue from recurring`);
  lines.push(`- Any new coordination steps or validation checkpoints needed\n`);
  lines.push(`Format your response as a structured improvement plan that could be used to directly update agent prompts and workflow orchestration logic.`);

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

  let stdout = '';
  let stderr = '';

  try {
    broadcast('improvement_started', {});

    // shell:true resolves Windows .cmd wrappers; stdio:pipe so we can write
    // the prompt via stdin (avoids cmd.exe arg-length / newline limits)
    const child = spawn('claude', ['--resume', sessionId, '-p'], {
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
      SET claude_response = ?, status = ?, completed_at = ?
      WHERE id = ?
    `).run(response, status, now, cycleId);

    broadcast('improvement_complete', { status, response });
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

    // Handle rewind: delegate entirely to Claude Code's built-in /rewind command.
    // Each improvement cycle adds exactly one turn (user prompt + assistant response).
    // We run /rewind once per cycle being removed — Claude Code handles both the
    // conversation cleanup and any git file reversion internally.
    const rewindCycleId = req.nextUrl.searchParams.get('rewind');
    if (rewindCycleId) {
      const targetCycle = db.prepare(
        `SELECT * FROM improvement_cycles WHERE id = ? AND session_id = ?`
      ).get(rewindCycleId, sessionId) as DbCycle | undefined;

      if (!targetCycle) return NextResponse.json({ error: 'Cycle not found' }, { status: 404 });

      // Count non-rewound cycles from the target cycle onward (inclusive)
      const { n: cyclesToRewind } = db.prepare(`
        SELECT COUNT(*) as n FROM improvement_cycles
        WHERE session_id = ? AND cycle_number >= ? AND status != 'rewound'
      `).get(sessionId, targetCycle.cycle_number) as { n: number };

      if (cyclesToRewind === 0) {
        return NextResponse.json({ error: 'All cycles from this point are already rewound' }, { status: 400 });
      }

      // Resolve the project working directory for claude --resume
      let projectCwd = process.cwd();
      try {
        const conv = db.prepare(`SELECT file_path FROM conversations WHERE id = ?`).get(sessionId) as { file_path: string } | undefined;
        if (conv?.file_path) {
          const slug = path.basename(path.dirname(conv.file_path));
          const found = findProjectDirBySlug(slug);
          if (found) projectCwd = found;
        }
      } catch { /* use default cwd */ }

      // Build stdin: N /rewind commands (one per cycle), then EOF to exit
      const rewindInput = Array(cyclesToRewind).fill('/rewind').join('\n') + '\n';

      await new Promise<void>((resolve) => {
        const child = spawn('claude', ['--resume', sessionId], {
          shell: true,
          cwd: projectCwd,
          env: { ...process.env },
          stdio: ['pipe', 'pipe', 'pipe'],
        });
        child.stdin.write(rewindInput, 'utf8');
        child.stdin.end(); // EOF signals end of input — claude exits after processing
        const t = setTimeout(() => { child.kill(); resolve(); }, 60_000);
        child.on('close', () => { clearTimeout(t); resolve(); });
        child.on('error', () => { clearTimeout(t); resolve(); });
      });

      // Mark this cycle and all later ones as rewound in our DB
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
