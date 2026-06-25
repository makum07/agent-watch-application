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
  return new Date(iso).toLocaleDateString();
}

export function truncate(text: string, maxLength: number): string {
  if (text.length <= maxLength) return text;
  return text.slice(0, maxLength - 3) + '...';
}

/**
 * Detects whether a tool_result error is a permission denial (the user declined
 * the tool call) rather than a runtime failure. Claude Code emits a stable
 * "Permission to use <Tool> has been denied" message for denials, plus the
 * "requested permissions ... but ... haven't granted it" variant.
 */
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
    return new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
  } catch { return iso; }
}

// Pricing per million tokens (USD) — Anthropic list prices as of 2026-06
const MODEL_PRICING: Record<string, { input: number; output: number; cacheWrite: number; cacheRead: number }> = {
  opus:   { input: 15.00, output: 75.00, cacheWrite: 18.75, cacheRead: 1.50 },
  sonnet: { input:  3.00, output: 15.00, cacheWrite:  3.75, cacheRead: 0.30 },
  haiku:  { input:  0.80, output:  4.00, cacheWrite:  1.00, cacheRead: 0.08 },
};

function modelTier(model: string): keyof typeof MODEL_PRICING {
  const m = model.toLowerCase();
  if (m.includes('opus'))   return 'opus';
  if (m.includes('haiku'))  return 'haiku';
  return 'sonnet';
}

export function estimateAgentCost(usage: {
  input: number; output: number; cacheCreation: number; cacheRead: number;
}, model: string): number {
  const p = MODEL_PRICING[modelTier(model)];
  return (
    usage.input        * p.input      / 1_000_000 +
    usage.output       * p.output     / 1_000_000 +
    usage.cacheCreation * p.cacheWrite / 1_000_000 +
    usage.cacheRead    * p.cacheRead  / 1_000_000
  );
}
