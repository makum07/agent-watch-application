import fs from 'fs';
import path from 'path';

// Claude Code's Edit/Write tools refuse certain paths outright — most
// notably anything under a `.claude/` directory reached via `--add-dir`,
// which it flags as "a sensitive file". That check runs before any
// PreToolUse hook is consulted, so a hook can never approve it: the hook
// is never even called. When we see this kind of native denial, AgentWatch
// asks the user directly (reusing the normal approval-card flow) and, if
// approved, writes the change to disk itself — bypassing Claude Code's
// Edit/Write tool for the actual mutation.

export function isNativePermissionBlock(content: string): boolean {
  if (!content) return false;
  if (content.includes('via AgentWatch')) return false; // our own hook already resolved this
  return content.includes('is a sensitive file') || content.includes('requested permissions');
}

export function applyEditLocally(
  toolName: string,
  toolInput: Record<string, unknown>,
): { ok: boolean; error?: string } {
  const filePath = String(toolInput.file_path ?? '');
  if (!filePath) return { ok: false, error: 'Missing file_path' };

  try {
    if (toolName === 'Write') {
      const content = String(toolInput.content ?? '');
      fs.mkdirSync(path.dirname(filePath), { recursive: true });
      fs.writeFileSync(filePath, content, 'utf8');
      return { ok: true };
    }

    if (toolName === 'Edit') {
      const oldStr = String(toolInput.old_string ?? '');
      const newStr = String(toolInput.new_string ?? '');
      const replaceAll = Boolean(toolInput.replace_all);
      const current = fs.readFileSync(filePath, 'utf8');

      const firstIdx = current.indexOf(oldStr);
      if (firstIdx === -1) return { ok: false, error: 'old_string not found in file' };
      if (!replaceAll && current.indexOf(oldStr, firstIdx + 1) !== -1) {
        return { ok: false, error: 'old_string is not unique in file' };
      }

      const updated = replaceAll
        ? current.split(oldStr).join(newStr)
        : current.slice(0, firstIdx) + newStr + current.slice(firstIdx + oldStr.length);

      fs.writeFileSync(filePath, updated, 'utf8');
      return { ok: true };
    }

    return { ok: false, error: `Unsupported tool for direct apply: ${toolName}` };
  } catch (err) {
    return { ok: false, error: String(err) };
  }
}
