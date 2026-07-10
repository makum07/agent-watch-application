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

export function waitForApproval(requestId: string, timeoutMs = 5 * 60 * 1000): Promise<boolean> {
  return new Promise<boolean>((resolve) => {
    const timeout = setTimeout(() => {
      pendingApprovals.delete(requestId);
      resolve(false);
    }, timeoutMs);

    pendingApprovals.set(requestId, {
      resolve: (val) => { clearTimeout(timeout); resolve(val); },
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
