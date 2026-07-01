import fs from 'fs';
import { estimateAgentCost } from '@/lib/utils';

export interface SessionCostResult {
  cost: number;
  tokens: number;
  title: string;
  durationMs: number;
  isActive: boolean;
  model: string;
}

export function computeCostFromJsonl(filePath: string): SessionCostResult {
  const empty: SessionCostResult = { cost: 0, tokens: 0, title: '', durationMs: 0, isActive: false, model: 'claude-sonnet-4-6' };

  let content: string;
  try {
    content = fs.readFileSync(filePath, 'utf8');
  } catch {
    return empty;
  }

  const lines = content.trim().split('\n').filter(Boolean);
  if (lines.length === 0) return empty;

  let isActive = true;
  try {
    const parsed = JSON.parse(lines[lines.length - 1]);
    if (parsed.type === 'last-prompt') isActive = false;
  } catch { /* malformed — treat as active */ }

  let totalInputTokens = 0;
  let totalOutputTokens = 0;
  let totalCacheCreation = 0;
  let totalCacheRead = 0;
  let model = 'claude-sonnet-4-6';
  let title = '';
  let firstTs: number | null = null;
  let lastTs: number | null = null;

  for (const line of lines) {
    try {
      const msg = JSON.parse(line);

      if (!title && msg.type === 'user') {
        const text = typeof msg.message?.content === 'string'
          ? msg.message.content
          : Array.isArray(msg.message?.content)
            ? msg.message.content.find((b: { type: string }) => b.type === 'text')?.text
            : null;
        if (text && text.trim()) title = text.trim().slice(0, 80);
      }

      if (msg.type === 'assistant' && msg.message?.usage) {
        const u = msg.message.usage;
        totalInputTokens += u.input_tokens ?? 0;
        totalOutputTokens += u.output_tokens ?? 0;
        totalCacheCreation += u.cache_creation_input_tokens ?? 0;
        totalCacheRead += u.cache_read_input_tokens ?? 0;
        if (msg.message.model) model = msg.message.model;
      }

      const ts = msg.timestamp ? new Date(msg.timestamp).getTime() : null;
      if (ts) {
        if (firstTs === null || ts < firstTs) firstTs = ts;
        if (lastTs === null || ts > lastTs) lastTs = ts;
      }
    } catch { /* skip malformed line */ }
  }

  const cost = estimateAgentCost(
    { input: totalInputTokens, output: totalOutputTokens, cacheCreation: totalCacheCreation, cacheRead: totalCacheRead },
    model,
  );
  const tokens = totalInputTokens + totalOutputTokens + totalCacheCreation + totalCacheRead;
  const durationMs = firstTs && lastTs ? lastTs - firstTs : 0;

  return { cost, tokens, title, durationMs, isActive, model };
}
