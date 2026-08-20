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
          // A skill only ever prints its own `.claude/skills/<name>` path into the
          // transcript (via "Base directory for this skill: ..."); the sibling
          // `.claude/agents` directory it delegates to is loaded internally by
          // Claude Code and never appears as an absolute path anywhere in the
          // transcript. Without this, --add-dir grants the skill directory but
          // not the agent definitions it invokes, so edits to those agent files
          // get silently blocked by Claude Code's own workspace-boundary check.
          const claudeRootMatch = resolved.match(/^(.*\.claude)\\(?:skills|agents)(?:\\.*)?$/i);
          if (claudeRootMatch) {
            for (const sibling of ['skills', 'agents']) {
              dirs.add(path.join(claudeRootMatch[1], sibling));
            }
          }
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
