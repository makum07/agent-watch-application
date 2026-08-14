// Shared state for the Claude Code PreToolUse hook permission flow.
// Used by both the hook API endpoint and the improvement loop runner.

const activeCycles = new Map<string, string>();
const pendingApprovals = new Map<string, { resolve: (approved: boolean) => void }>();

export function registerActiveCycle(sessionId: string, cycleId: string) {
  activeCycles.set(sessionId, cycleId);
}

export function unregisterActiveCycle(sessionId: string) {
  activeCycles.delete(sessionId);
}

export function getActiveCycleId(sessionId: string): string | undefined {
  return activeCycles.get(sessionId);
}

export interface ApprovalResult {
  approved: boolean;
  /** True if no response arrived before the timeout — distinct from an explicit user denial. */
  expired: boolean;
}

// Claude Code's own PreToolUse HTTP hook waits up to 600s (see
// writePermissionHookSettings in lib/services/claude-cli.ts) before it gives
// up on our endpoint. Our own wait must resolve well before that so we
// control the "expired" messaging ourselves, rather than Claude Code's HTTP
// client timing out the request with a less graceful error.
export function waitForApproval(requestId: string, timeoutMs = 9 * 60 * 1000): Promise<ApprovalResult> {
  return new Promise<ApprovalResult>((resolve) => {
    const timeout = setTimeout(() => {
      pendingApprovals.delete(requestId);
      resolve({ approved: false, expired: true });
    }, timeoutMs);

    pendingApprovals.set(requestId, {
      resolve: (val) => { clearTimeout(timeout); resolve({ approved: val, expired: false }); },
    });
  });
}

export function resolveApproval(requestId: string, approved: boolean) {
  const entry = pendingApprovals.get(requestId);
  if (entry) {
    entry.resolve(approved);
    pendingApprovals.delete(requestId);
  }
}
