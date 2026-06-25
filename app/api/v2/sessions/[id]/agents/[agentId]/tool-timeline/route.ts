import { NextRequest, NextResponse } from 'next/server';
import path from 'path';
import fs from 'fs';
import { getDatabase } from '@/lib/db/database';
import { parseJsonlFile, resolveToolCalls } from '@/lib/parser/jsonl-parser';
import type { ToolTimelineEntry } from '@/types/analytics';

function summarizeInput(input: Record<string, unknown>): string {
  if (input.file_path) return `file_path: ${String(input.file_path)}`;
  if (input.command) return String(input.command).slice(0, 120);
  if (input.pattern) return `pattern: ${String(input.pattern)}`;
  if (input.query) return `query: ${String(input.query).slice(0, 120)}`;
  if (input.url) return `url: ${String(input.url)}`;
  if (input.prompt) return String(input.prompt).slice(0, 120);
  if (input.skill) return `skill: ${String(input.skill)}`;
  if (input.old_string != null) return `file_path: ${String(input.file_path || '?')}`;
  const s = JSON.stringify(input);
  return s.length > 120 ? s.slice(0, 117) + '...' : s;
}

function previewResult(result: unknown, isError: boolean): string {
  const maxLen = isError ? 300 : 200;
  if (result == null) return '';
  const s = typeof result === 'string' ? result : JSON.stringify(result);
  return s.length > maxLen ? s.slice(0, maxLen - 3) + '...' : s;
}

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string; agentId: string }> }
) {
  try {
    const { id: sessionId, agentId } = await params;
    const db = getDatabase();

    const agent = db.prepare('SELECT conversation_id, session_id, jsonl_path FROM agents WHERE id = ?').get(agentId) as
      | { conversation_id: string; session_id: string; jsonl_path?: string }
      | undefined;

    if (!agent || agent.session_id !== sessionId) {
      return NextResponse.json({ error: 'Agent not found' }, { status: 404 });
    }

    let convPath: string;
    if (agent.jsonl_path && fs.existsSync(agent.jsonl_path)) {
      convPath = agent.jsonl_path;
    } else {
      const conv = db.prepare('SELECT file_path FROM conversations WHERE id = ?').get(sessionId) as
        | { file_path: string }
        | undefined;
      if (!conv) {
        return NextResponse.json({ error: 'Session not found' }, { status: 404 });
      }
      const projectDir = path.dirname(conv.file_path);
      convPath = path.join(projectDir, `${agent.conversation_id}.jsonl`);
    }

    if (!fs.existsSync(convPath)) {
      return NextResponse.json([]);
    }

    const parsed = parseJsonlFile(convPath);
    const resolved = resolveToolCalls(parsed.messages);

    const timeline: ToolTimelineEntry[] = resolved.map((tc, i) => ({
      id: tc.id,
      index: i,
      name: tc.name,
      inputSummary: summarizeInput(tc.input),
      resultPreview: previewResult(tc.result, tc.isError),
      isError: tc.isError,
      durationMs: tc.durationMs,
      isAgentSpawn: tc.isAgentSpawn,
      childAgentId: tc.childAgentId,
    }));

    return NextResponse.json(timeline);
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
