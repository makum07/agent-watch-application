// Shared plumbing for programmatically driving the `claude` CLI in
// `-p --output-format stream-json --input-format stream-json` mode.
//
// Three features spawn `claude` this way — the improvement loop
// (app/api/v2/sessions/[id]/improvements/route.ts), skill self-healing
// (self-healing-controller.ts), and execution analysis (execution-analyzer.ts).
// They differ in prompt content, DB tables, and whether the child process
// stays interactive (improvement loop keeps stdin open for direct-apply
// continuation turns) — but arg-building, spawning, stdout stream-json
// parsing, stderr capture, exit/timeout handling, and the PreToolUse
// approval-hook settings file are identical. This module is that common
// layer; each caller keeps its own event handling and persistence.

import { spawn, type ChildProcessWithoutNullStreams } from 'child_process';
import path from 'path';
import fs from 'fs';
import os from 'os';

export type ClaudePermissionOptions =
  // Read-only / analysis-only runs — no edits expected, so skip the
  // approval round-trip entirely.
  | { mode: 'skipPermissions' }
  // Runs that may Edit/Write — routes PreToolUse through AgentWatch's
  // browser approval hook via a generated settings file.
  | { mode: 'hook'; settingsPath: string; includeHookEvents?: boolean };

export interface SpawnClaudeCliOptions {
  cwd?: string;
  model?: string;
  /** Resume an existing Claude Code session instead of starting a fresh one-shot. */
  resumeSessionId?: string;
  permission: ClaudePermissionOptions;
  /** Extra directories to grant access to via --add-dir (already quoted internally). */
  externalDirs?: string[];
}

export function buildClaudeCliArgs(opts: SpawnClaudeCliOptions): string[] {
  const args: string[] = [];
  if (opts.resumeSessionId) args.push('--resume', opts.resumeSessionId);
  args.push('-p', '--output-format', 'stream-json', '--input-format', 'stream-json', '--verbose');
  if (opts.model) args.push('--model', opts.model);

  if (opts.permission.mode === 'skipPermissions') {
    args.push('--dangerously-skip-permissions');
  } else {
    args.push('--permission-mode', 'default', '--settings', `"${opts.permission.settingsPath}"`);
    if (opts.permission.includeHookEvents !== false) args.push('--include-hook-events');
  }

  // Paths must be quoted — shell: true splits on spaces otherwise.
  for (const dir of opts.externalDirs ?? []) args.push('--add-dir', `"${dir}"`);

  return args;
}

export function spawnClaudeCli(opts: SpawnClaudeCliOptions): ChildProcessWithoutNullStreams {
  return spawn('claude', buildClaudeCliArgs(opts), {
    shell: true,
    cwd: opts.cwd || undefined,
    env: { ...process.env },
    stdio: ['pipe', 'pipe', 'pipe'],
  }) as ChildProcessWithoutNullStreams;
}

/** Writes one `stream-json` user turn to the child's stdin. Does not end stdin. */
export function writeUserTurn(child: ChildProcessWithoutNullStreams, text: string): void {
  const msg = JSON.stringify({
    type: 'user',
    message: { role: 'user', content: [{ type: 'text', text }] },
  });
  child.stdin.write(msg + '\n', 'utf8');
}

/**
 * Buffers stdout, splits on newlines, and JSON-parses each complete
 * `stream-json` line into `onEvent`. Malformed lines are skipped, matching
 * the CLI's own tolerance for partial writes.
 */
export function attachStreamJsonParser(
  child: ChildProcessWithoutNullStreams,
  onEvent: (event: Record<string, unknown>) => void,
): { flushRemaining: () => void; getStderr: () => string } {
  let stdoutBuffer = '';

  const parseLine = (line: string) => {
    const trimmed = line.trim();
    if (!trimmed) return;
    try { onEvent(JSON.parse(trimmed)); } catch { /* skip malformed line */ }
  };

  child.stdout.on('data', (chunk: Buffer) => {
    stdoutBuffer += chunk.toString();
    const lines = stdoutBuffer.split('\n');
    stdoutBuffer = lines.pop() ?? '';
    for (const line of lines) parseLine(line);
  });

  let stderr = '';
  child.stderr.on('data', (chunk: Buffer) => { stderr += chunk.toString(); });

  return {
    // The CLI doesn't always end its final line with '\n' — call after
    // 'close' to parse whatever is left in the buffer.
    flushRemaining: () => {
      const remaining = stdoutBuffer;
      stdoutBuffer = '';
      parseLine(remaining);
    },
    getStderr: () => stderr,
  };
}

export interface ClaudeExitResult {
  exitCode: number;
  timedOut: boolean;
  spawnError: Error | null;
}

/** Resolves on process exit, or kills the child and resolves with exitCode 124 on timeout. */
export function waitForClaudeExit(
  child: ChildProcessWithoutNullStreams,
  timeoutMs?: number,
): Promise<ClaudeExitResult> {
  return new Promise((resolve) => {
    let timer: NodeJS.Timeout | undefined;
    let settled = false;
    const settle = (result: ClaudeExitResult) => {
      if (settled) return;
      settled = true;
      if (timer) clearTimeout(timer);
      resolve(result);
    };

    if (timeoutMs) {
      timer = setTimeout(() => {
        try { child.kill(); } catch { /* already dead */ }
        settle({ exitCode: 124, timedOut: true, spawnError: null });
      }, timeoutMs);
    }

    child.on('close', (code) => settle({ exitCode: code ?? 0, timedOut: false, spawnError: null }));
    child.on('error', (err) => settle({ exitCode: 1, timedOut: false, spawnError: err }));
  });
}

/**
 * Writes the temporary settings file that routes PreToolUse (Edit|Write)
 * through AgentWatch's browser approval endpoint. Caller must call
 * `cleanup()` once the child process has exited.
 */
export function writePermissionHookSettings(
  filePrefix: string,
  cycleId: string,
): { settingsPath: string; cleanup: () => void } {
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
  const settingsPath = path.join(os.tmpdir(), `${filePrefix}-${cycleId}.json`);
  fs.writeFileSync(settingsPath, JSON.stringify(hookSettings), 'utf8');
  return {
    settingsPath,
    cleanup: () => { try { fs.unlinkSync(settingsPath); } catch { /* already cleaned */ } },
  };
}

export interface RunClaudeCliOneShotOptions {
  prompt: string;
  cwd?: string;
  model?: string;
  permission: ClaudePermissionOptions;
  externalDirs?: string[];
  timeoutMs?: number;
  /** Raw stream-json event passthrough — for broadcasting and building a stream log. */
  onEvent?: (event: Record<string, unknown>) => void;
}

export interface RunClaudeCliOneShotResult {
  exitCode: number;
  timedOut: boolean;
  spawnError: Error | null;
  stderr: string;
  /** Concatenation of every assistant text block, in order. */
  fullText: string;
}

/**
 * Writes a single user turn, closes stdin, and awaits process exit —
 * the shape shared by skill analysis, skill fix-apply, and execution
 * analysis. The improvement loop needs interactive stdin control (it may
 * write a follow-up turn before ending), so it composes the lower-level
 * primitives above directly instead of using this.
 */
export async function runClaudeCliOneShot(
  opts: RunClaudeCliOneShotOptions,
): Promise<RunClaudeCliOneShotResult> {
  const child = spawnClaudeCli(opts);
  writeUserTurn(child, opts.prompt);
  child.stdin.end();

  const responseChunks: string[] = [];
  const handleEvent = (event: Record<string, unknown>) => {
    opts.onEvent?.(event);
    if (event.type === 'assistant') {
      const msg = event.message as { content?: Array<{ type: string; text?: string }> } | undefined;
      for (const block of msg?.content ?? []) {
        if (block.type === 'text' && block.text) responseChunks.push(block.text);
      }
    }
  };

  const { flushRemaining, getStderr } = attachStreamJsonParser(child, handleEvent);
  const { exitCode, timedOut, spawnError } = await waitForClaudeExit(child, opts.timeoutMs);
  flushRemaining();

  return { exitCode, timedOut, spawnError, stderr: getStderr(), fullText: responseChunks.join('') };
}
