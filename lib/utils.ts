import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export function formatTokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}k`;
  return String(n);
}

export function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)}s`;
  if (ms < 3_600_000) return `${Math.floor(ms / 60000)}m ${Math.floor((ms % 60000) / 1000)}s`;
  return `${Math.floor(ms / 3_600_000)}h ${Math.floor((ms % 3_600_000) / 60000)}m`;
}

export function formatCost(usd: number): string {
  if (usd < 0.01) return `$${(usd * 100).toFixed(2)}¢`;
  return `$${usd.toFixed(4)}`;
}

export function formatRelativeTime(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const minutes = Math.floor(diff / 60_000);
  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `${days}d ago`;
  // Fixed locale: relying on the runtime default locale here made SSR (Node's
  // default locale) and the browser (its Accept-Language locale) render different
  // digit orders for the same date, which React flags as a hydration mismatch.
  return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function truncate(text: string, maxLength: number): string {
  if (text.length <= maxLength) return text;
  return text.slice(0, maxLength - 3) + '...';
}

export function isPermissionDenial(resultText: string): boolean {
  if (!resultText) return false;
  return (
    /Permission to use \w+ has been denied/i.test(resultText) ||
    /requested permissions to use \w+/i.test(resultText) ||
    /user (?:doesn't|does not) want to (?:proceed|take this action)/i.test(resultText)
  );
}

export function formatTime(iso: string): string {
  try {
    return new Date(iso).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
  } catch { return iso; }
}

/**
 * Cleans up raw session titles that leaked Claude Code's internal slash-command
 * XML wrapper (`<command-name>`, `<command-args>`, `<local-command-caveat>`, ...)
 * instead of a human-readable string, and flags whether the session was a
 * command invocation so the UI can badge it distinctly from a plain conversation.
 */
export const MIN_TITLE_LEN = 10;

export function parseSessionTitle(raw: string | null | undefined): { text: string; isCommand: boolean } {
  if (!raw) return { text: '', isCommand: false };
  const nameMatch = raw.match(/<command-name>([^<]*)<\/command-name>/);
  if (nameMatch && nameMatch[1].trim()) {
    let text = nameMatch[1].trim();
    const argsMatch = raw.match(/<command-args>([^<]*)<\/command-args>/);
    const args = argsMatch?.[1]?.trim();
    if (args) text += ` ${args}`;
    return { text, isCommand: true };
  }
  // No command was invoked (e.g. a bare `!shell` local command) — the caveat text
  // itself is boilerplate repeated on every such session, so prefer its actual
  // output as the identifying text when present.
  const stdoutMatch = raw.match(/<local-command-stdout>([^<]*)<\/local-command-stdout>/);
  if (stdoutMatch && stdoutMatch[1].trim()) {
    return { text: stdoutMatch[1].trim(), isCommand: false };
  }
  if (/<[a-z-]+>/.test(raw)) {
    const stripped = raw.replace(/<\/?[a-z-]+>/g, ' ').replace(/\s+/g, ' ').trim();
    if (stripped) return { text: stripped, isCommand: /^\/[\w-]/.test(stripped) };
  }
  return { text: raw, isCommand: /^\/[\w-]/.test(raw) };
}

/**
 * Reduces a `/`-separated relative project path down to just the project name
 * (its last segment) for display — e.g. `Zeroni Product/ZER-app` → `ZER-app`.
 * Pass the full path as a tooltip for the cases where that context is lost.
 */
export function shortenProjectPath(relPath: string): string {
  const parts = relPath.split(/[\\/]/).filter(Boolean);
  return parts[parts.length - 1] || relPath;
}

const PROJECT_COLOR_VARS = [
  '--aw-blue', '--aw-purple', '--aw-cyan', '--aw-amber',
  '--aw-lime', '--aw-pink', '--aw-orange', '--aw-green-bright',
];

/** Deterministic color assignment so the same project always gets the same accent, for quick visual grouping. */
export function projectColorVar(name: string): string {
  let hash = 0;
  for (let i = 0; i < name.length; i++) hash = (hash * 31 + name.charCodeAt(i)) >>> 0;
  return PROJECT_COLOR_VARS[hash % PROJECT_COLOR_VARS.length];
}

// Model pricing lives in lib/pricing/ — import `estimateAgentCost` from
// `@/lib/pricing/pricebank` in server code or `@/lib/pricing/pricing-core` in
// client components (this file is bundled into both and must stay `fs`-free).
