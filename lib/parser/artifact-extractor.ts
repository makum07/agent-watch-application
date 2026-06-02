import type { ParsedMessage } from './jsonl-parser';
import type { Artifact } from '@/types/session';
import crypto from 'crypto';

const WRITE_TOOLS = new Set(['Write', 'Edit', 'NotebookEdit']);
const READ_TOOLS = new Set(['Read', 'Grep', 'Glob']);

export interface ExtractedArtifact {
  id: string;
  agentId: string;
  sessionId: string;
  type: 'create' | 'modify' | 'delete';
  filePath: string;
  toolName: string;
  timestamp: string;
  contentPreview: string | null;
  contentSize: number;
}

export interface ArtifactRead {
  agentId: string;
  sessionId: string;
  filePath: string;
  toolName: string;
  timestamp: string;
}

export function extractArtifacts(
  messages: ParsedMessage[],
  agentId: string,
  sessionId: string
): ExtractedArtifact[] {
  const artifacts: ExtractedArtifact[] = [];

  const toolUseMap = new Map<string, { name: string; input: Record<string, unknown>; timestamp: string }>();

  for (const msg of messages) {
    if (msg.role === 'assistant') {
      for (const block of msg.content) {
        if (block.type === 'tool_use' && WRITE_TOOLS.has(block.name)) {
          toolUseMap.set(block.id, { name: block.name, input: block.input, timestamp: msg.timestamp });
        }
      }
    }

    if (msg.role === 'tool' || msg.role === 'user') {
      for (const block of msg.content) {
        if (block.type === 'tool_result') {
          const use = toolUseMap.get(block.tool_use_id);
          if (!use) continue;
          if (!WRITE_TOOLS.has(use.name)) continue;

          const filePath = extractFilePath(use.name, use.input);
          if (!filePath) continue;

          const content = extractContent(use.name, use.input);
          const isCreate = use.name === 'Write';

          artifacts.push({
            id: crypto.randomUUID(),
            agentId,
            sessionId,
            type: isCreate ? 'create' : 'modify',
            filePath,
            toolName: use.name,
            timestamp: msg.timestamp,
            contentPreview: content ? content.slice(0, 500) : null,
            contentSize: content ? Buffer.byteLength(content, 'utf8') : 0,
          });
        }
      }
    }
  }

  return artifacts;
}

export function extractArtifactReads(
  messages: ParsedMessage[],
  agentId: string,
  sessionId: string
): ArtifactRead[] {
  const reads: ArtifactRead[] = [];

  for (const msg of messages) {
    if (msg.role !== 'assistant') continue;
    for (const block of msg.content) {
      if (block.type === 'tool_use' && READ_TOOLS.has(block.name)) {
        const filePath = extractFilePath(block.name, block.input);
        if (filePath) {
          reads.push({ agentId, sessionId, filePath, toolName: block.name, timestamp: msg.timestamp });
        }
      }
    }
  }

  return reads;
}

function extractFilePath(toolName: string, input: Record<string, unknown>): string | null {
  if (toolName === 'Write') return (input.file_path as string) || null;
  if (toolName === 'Edit') return (input.file_path as string) || null;
  if (toolName === 'NotebookEdit') return (input.notebook_path as string) || null;
  if (toolName === 'Read') return (input.file_path as string) || null;
  if (toolName === 'Grep') return null;
  if (toolName === 'Glob') return null;
  return null;
}

function extractContent(toolName: string, input: Record<string, unknown>): string | null {
  if (toolName === 'Write') return (input.content as string) || null;
  if (toolName === 'Edit') return (input.new_string as string) || null;
  return null;
}
