import { NextRequest, NextResponse } from 'next/server';
import { getDatabase } from '@/lib/db/database';
import { parseJsonlFile } from '@/lib/parser/jsonl-parser';
import type { SearchResult } from '@/types/session';
import type { ParsedMessage } from '@/lib/parser/jsonl-parser';
import type { ContentBlock } from '@/types/session';

function extractTextFromMessage(msg: ParsedMessage): string {
  const parts: string[] = [];
  for (const block of msg.content) {
    const b = block as ContentBlock;
    if (b.type === 'text') {
      parts.push(b.text);
    } else if (b.type === 'tool_use') {
      parts.push(b.name);
      const inp = b.input;
      if (inp && typeof inp === 'object') {
        // Include command, description, prompt fields from tool inputs
        for (const key of ['command', 'description', 'prompt', 'path', 'file_path']) {
          const val = (inp as Record<string, unknown>)[key];
          if (typeof val === 'string' && val.length < 500) parts.push(val);
        }
      }
    }
  }
  return parts.join(' ');
}

function buildSnippet(text: string, query: string, windowSize = 220): { snippet: string; matchOffset: number } {
  const lower = text.toLowerCase();
  const qLower = query.toLowerCase();
  const idx = lower.indexOf(qLower);
  if (idx === -1) return { snippet: text.slice(0, windowSize), matchOffset: -1 };

  const prefixLen = 80;
  const start = Math.max(0, idx - prefixLen);
  const end = Math.min(text.length, start + windowSize);
  const prefix = start > 0 ? '…' : '';
  const suffix = end < text.length ? '…' : '';
  const snippet = prefix + text.slice(start, end) + suffix;
  const matchOffset = idx - start + prefix.length;

  return { snippet, matchOffset };
}

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const url = new URL(req.url);
  const q = url.searchParams.get('q')?.trim() ?? '';
  const agentTypes = url.searchParams.getAll('agentTypes');
  const roles = url.searchParams.getAll('roles');
  const page = Math.max(0, parseInt(url.searchParams.get('page') ?? '0', 10));
  const limit = Math.min(100, Math.max(1, parseInt(url.searchParams.get('limit') ?? '50', 10)));

  if (!q) return NextResponse.json({ results: [], total: 0, hasMore: false });

  try {
    const db = getDatabase();

    let sql = 'SELECT id, type, subagent_type, description, jsonl_path FROM agents WHERE session_id = ?';
    const args: unknown[] = [id];

    if (agentTypes.length > 0) {
      const placeholders = agentTypes.map(() => '?').join(',');
      sql += ` AND (type IN (${placeholders}) OR subagent_type IN (${placeholders}))`;
      args.push(...agentTypes, ...agentTypes);
    }

    const agentRows = db.prepare(sql).all(...args) as Array<{
      id: string;
      type: string;
      subagent_type: string | null;
      description: string | null;
      jsonl_path: string | null;
    }>;

    const results: SearchResult[] = [];
    const qLower = q.toLowerCase();

    for (const row of agentRows) {
      if (!row.jsonl_path) continue;

      const parsed = parseJsonlFile(row.jsonl_path);

      for (const msg of parsed.messages) {
        if (roles.length > 0 && !roles.includes(msg.role)) continue;

        const text = extractTextFromMessage(msg);
        if (!text.toLowerCase().includes(qLower)) continue;

        const { snippet, matchOffset } = buildSnippet(text, q);
        const agentName = row.description || row.subagent_type || row.type;

        results.push({
          agentId: row.id,
          agentName,
          agentType: row.type,
          agentSubtype: row.subagent_type,
          messageId: msg.id,
          messageIndex: msg.index,
          role: msg.role,
          timestamp: msg.timestamp,
          snippet,
          matchOffset,
        });
      }
    }

    results.sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime());

    const total = results.length;
    const paginated = results.slice(page * limit, (page + 1) * limit);

    return NextResponse.json({ results: paginated, total, hasMore: (page + 1) * limit < total });
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
