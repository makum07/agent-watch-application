import fs from 'fs';
import path from 'path';

// When a Claude Code session references skills/agents defined outside its own
// project directory (added via `claude --add-dir` in the original interactive
// session), a freshly spawned `-p` process has no memory of that grant — it
// only knows about its `cwd`. Edit/Write on paths outside `cwd` are blocked by
// Claude Code's workspace-boundary check regardless of what a PreToolUse hook
// decides, so we must rediscover those directories and pass them back via
// `--add-dir` on every respawn.
//
// We recover them by scanning the session JSONL for `.claude/skills` or
// `.claude/agents` paths that fall outside the current project directory —
// those only appear in the transcript if the original session actually had
// access to them.

export function findExternalSkillDirsFromSession(jsonlPath: string, projectCwd: string): string[] {
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

// Same idea, aggregated across every session that has touched a given skill —
// used when respawning a fresh `-p` process for skill-level analysis/fix
// application, which isn't tied to any single session's JSONL.
export function findExternalSkillDirsForSessions(jsonlPaths: string[], projectCwd: string): string[] {
  const dirs = new Set<string>();
  for (const jsonlPath of jsonlPaths) {
    for (const dir of findExternalSkillDirsFromSession(jsonlPath, projectCwd)) {
      dirs.add(dir);
    }
  }
  return Array.from(dirs);
}

// Every skill invocation echoes its own base directory into the transcript
// (e.g. "Base directory for this skill: /home/sarat/.claude/skills/egsb-review"),
// which lets us recover exactly which named skill(s) this session actually
// used — as opposed to findExternalSkillDirsFromSession above, which only
// recovers the shared skills-root directory it was granted access to.
export function findInvokedSkillsFromSession(jsonlPath: string): { name: string; dir: string }[] {
  let raw: string;
  try { raw = fs.readFileSync(jsonlPath, 'utf8'); } catch { return []; }

  const seen = new Map<string, string>();
  const re = /Base directory for this skill:\s*(.+?)\\n/g;
  let match;
  while ((match = re.exec(raw)) !== null) {
    const dir = match[1].replace(/\\\\/g, '\\').trim();
    const name = dir.split(/[\\/]/).pop();
    if (name && !seen.has(name)) seen.set(name, dir);
  }
  return Array.from(seen, ([name, dir]) => ({ name, dir }));
}
