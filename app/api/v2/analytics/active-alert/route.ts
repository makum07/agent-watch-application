import { NextResponse } from 'next/server';
import fs from 'fs';
import path from 'path';
import { getSources } from '@/lib/sources';
import { estimateAgentCost } from '@/lib/utils';

const COST_THRESHOLD = parseFloat(process.env.ACTIVE_ALERT_THRESHOLD || '5');
// Only consider files modified within the last 6 hours as potentially active
const ACTIVE_WINDOW_MS = 6 * 60 * 60 * 1000;

interface ActiveSession {
  sessionId: string;
  title: string;
  project: string;
  cost: number;
  tokens: number;
  durationMs: number;
  source: string;
  lastModified: string;
}

function computeCostFromJsonl(filePath: string): {
  cost: number;
  tokens: number;
  title: string;
  durationMs: number;
  isActive: boolean;
} {
  let content: string;
  try {
    content = fs.readFileSync(filePath, 'utf8');
  } catch {
    return { cost: 0, tokens: 0, title: '', durationMs: 0, isActive: false };
  }

  const lines = content.trim().split('\n').filter(Boolean);
  if (lines.length === 0) return { cost: 0, tokens: 0, title: '', durationMs: 0, isActive: false };

  // Check if session is completed — completed sessions end with last-prompt
  const lastLine = lines[lines.length - 1];
  let isActive = true;
  try {
    const parsed = JSON.parse(lastLine);
    if (parsed.type === 'last-prompt') isActive = false;
  } catch { /* malformed line — treat as active */ }

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

      // Extract title from first user message
      if (!title && msg.type === 'user') {
        const text = typeof msg.message?.content === 'string'
          ? msg.message.content
          : Array.isArray(msg.message?.content)
            ? msg.message.content.find((b: { type: string }) => b.type === 'text')?.text
            : null;
        if (text && text.trim()) title = text.trim().slice(0, 80);
      }

      // Accumulate token usage from assistant messages
      if (msg.type === 'assistant' && msg.message?.usage) {
        const u = msg.message.usage;
        totalInputTokens += u.input_tokens ?? 0;
        totalOutputTokens += u.output_tokens ?? 0;
        totalCacheCreation += u.cache_creation_input_tokens ?? 0;
        totalCacheRead += u.cache_read_input_tokens ?? 0;
        if (msg.message.model) model = msg.message.model;
      }

      // Track timestamps for duration
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

  return { cost, tokens, title, durationMs, isActive };
}

export async function GET() {
  const sources = getSources();
  const activeSessions: ActiveSession[] = [];
  const now = Date.now();

  for (const source of sources) {
    const projectsDir = path.join(source.path, 'projects');
    if (!fs.existsSync(projectsDir)) continue;

    let projectDirs: string[];
    try {
      projectDirs = fs.readdirSync(projectsDir);
    } catch { continue; }

    for (const proj of projectDirs) {
      const projPath = path.join(projectsDir, proj);
      let files: string[];
      try {
        files = fs.readdirSync(projPath).filter(f => f.endsWith('.jsonl'));
      } catch { continue; }

      for (const file of files) {
        const filePath = path.join(projPath, file);
        let stat: fs.Stats;
        try { stat = fs.statSync(filePath); } catch { continue; }

        // Skip files not modified recently
        if (now - stat.mtimeMs > ACTIVE_WINDOW_MS) continue;

        const sessionId = file.replace('.jsonl', '');
        const { cost, tokens, title, durationMs, isActive } = computeCostFromJsonl(filePath);

        if (!isActive || cost < COST_THRESHOLD) continue;

        // Decode project name
        const projectName = proj.replace(/^-/, '').replace(/-/g, '/');
        const displayName = projectName.split('/').filter(Boolean).pop() ?? proj;

        activeSessions.push({
          sessionId,
          title: title || displayName,
          project: displayName,
          cost,
          tokens,
          durationMs,
          source: source.label,
          lastModified: stat.mtime.toISOString(),
        });
      }
    }
  }

  // Sort by cost descending
  activeSessions.sort((a, b) => b.cost - a.cost);

  return NextResponse.json({
    activeSessions,
    threshold: COST_THRESHOLD,
    checkedAt: new Date().toISOString(),
  });
}
