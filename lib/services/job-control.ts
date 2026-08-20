// Tracks in-flight `claude` CLI child processes by job id (a DB cycle id) so
// an API route can cancel one on user request. In-memory only — jobs don't
// survive a server restart, which is fine since the DB row they'd resume
// into no longer has a live process behind it anyway.
//
// Stashed on `globalThis` rather than a plain module-scoped `Map` — Next.js
// dev (Turbopack/webpack) can compile the route that registers a job
// (POST .../analysis) and the route that cancels it (PATCH .../analysis/[id])
// into separate module instances of this file, each with its own top-level
// state. A plain `const jobs = new Map()` would then silently split into two
// independent maps, so `cancelJob` always misses. Same fix already used by
// `getWsServer()` (lib/websocket/ws-server.ts) for the same reason.

import { execFile, type ChildProcessWithoutNullStreams } from 'child_process';

interface TrackedJob {
  child: ChildProcessWithoutNullStreams;
  cancelled: boolean;
}

const GLOBAL_KEY = '__awJobs';

function getJobs(): Map<string, TrackedJob> {
  const g = globalThis as Record<string, unknown>;
  if (!(g[GLOBAL_KEY] instanceof Map)) {
    g[GLOBAL_KEY] = new Map<string, TrackedJob>();
  }
  return g[GLOBAL_KEY] as Map<string, TrackedJob>;
}

export function registerJob(jobId: string, child: ChildProcessWithoutNullStreams): void {
  getJobs().set(jobId, { child, cancelled: false });
}

export function unregisterJob(jobId: string): void {
  getJobs().delete(jobId);
}

// `child.kill()` only signals the one process Node holds a handle to. Both
// spawn paths in claude-cli.ts put a wrapper in that slot — `cmd.exe` (from
// `spawn(..., { shell: true })`) or `wsl.exe` (WSL routing) — with the real
// `claude` process (often itself wrapped again by a `claude.cmd` npm shim)
// running as a grandchild. On Windows, killing the parent does NOT kill its
// descendants the way it does on POSIX (no process-group signal propagation),
// so the actual CLI process silently survives a plain `.kill()`. `taskkill
// /T` walks the whole tree instead.
export function killProcessTree(child: ChildProcessWithoutNullStreams): void {
  if (process.platform === 'win32' && child.pid) {
    execFile('taskkill', ['/pid', String(child.pid), '/T', '/F'], () => { /* best effort */ });
  } else {
    try { child.kill(); } catch { /* already dead */ }
  }
}

/** Kills the tracked process (and its descendants) and marks it cancelled. Returns false if no job is tracked under this id (already finished, or never started). */
export function cancelJob(jobId: string): boolean {
  const job = getJobs().get(jobId);
  if (!job) return false;
  job.cancelled = true;
  killProcessTree(job.child);
  return true;
}

export function isJobCancelled(jobId: string): boolean {
  return getJobs().get(jobId)?.cancelled ?? false;
}

export function isJobRunning(jobId: string): boolean {
  return getJobs().has(jobId);
}
