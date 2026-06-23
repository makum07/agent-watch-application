import fs from 'fs';
import path from 'path';
import type { ContentBlock, Message, ResolvedToolCall } from '@/types/session';
import { resolveSource } from '@/lib/sources';

// ─── Outer wrapper format (actual Claude Code format) ────────────────────────
interface RawLine {
  type: string;
  message?: RawMessage;
  uuid?: string;
  timestamp?: string;
  parentUuid?: string | null;
  isSidechain?: boolean;
  sessionId?: string;
  attributionSkill?: string;
  attachment?: {
    type: string;
    skills?: Array<{ name: string; path: string; content?: string }>;
  };
}

interface RawMessage {
  role?: string;
  content?: RawContentBlock[] | string;
  model?: string;
  stop_reason?: string;
  stop_sequence?: string | null;
  usage?: {
    input_tokens?: number;
    output_tokens?: number;
    cache_creation_input_tokens?: number;
    cache_read_input_tokens?: number;
  };
}

export type RawContentBlock =
  | { type: 'text'; text: string }
  | { type: 'thinking'; thinking: string }
  | { type: 'tool_use'; id: string; name: string; input: Record<string, unknown> }
  | { type: 'tool_result'; tool_use_id: string; content: RawContentBlock[] | string; is_error?: boolean };

export interface ParsedMessage {
  index: number;
  id: string;
  role: 'user' | 'assistant' | 'tool';
  timestamp: string;
  content: ContentBlock[];
  model?: string;
  stopReason?: string;
  tokenUsage?: {
    input: number;
    output: number;
    cacheCreation: number;
    cacheRead: number;
  };
}

export interface InvokedSkill {
  name: string;
  path: string;
  timestamp: string | null;
}

export interface ParsedConversation {
  messages: ParsedMessage[];
  invokedSkills: InvokedSkill[];
  firstTimestamp: string | null;
  lastTimestamp: string | null;
}

export function parseJsonlFile(filePath: string): ParsedConversation {
  if (!fs.existsSync(filePath)) {
    return { messages: [], invokedSkills: [], firstTimestamp: null, lastTimestamp: null };
  }

  let content: string;
  try {
    content = fs.readFileSync(filePath, 'utf8');
  } catch {
    return { messages: [], invokedSkills: [], firstTimestamp: null, lastTimestamp: null };
  }

  const lines = content.split('\n');
  const messages: ParsedMessage[] = [];
  const invokedSkills: InvokedSkill[] = [];
  let msgIndex = 0;

  for (const rawLine of lines) {
    const trimmed = rawLine.trim();
    if (!trimmed) continue;

    try {
      const line: RawLine = JSON.parse(trimmed);

      if (line.attachment?.type === 'invoked_skills' && Array.isArray(line.attachment.skills)) {
        for (const skill of line.attachment.skills) {
          if (skill.name) {
            invokedSkills.push({
              name: skill.name,
              path: skill.path || '',
              timestamp: line.timestamp || null,
            });
          }
        }
        continue;
      }

      if (line.type !== 'user' && line.type !== 'assistant') continue;
      if (!line.message) continue;

      // Detect skill attribution on assistant messages
      if (line.type === 'assistant' && line.attributionSkill) {
        const name = line.attributionSkill;
        if (!invokedSkills.some(s => s.name === name)) {
          invokedSkills.push({ name, path: '', timestamp: line.timestamp || null });
        }
      }

      const msg = line.message;
      const role = line.type === 'assistant' ? 'assistant' : determineUserRole(msg);
      const timestamp = line.timestamp || new Date().toISOString();
      const id = line.uuid || `msg-${msgIndex}`;

      const content = normalizeContent(msg.content);

      const parsed: ParsedMessage = {
        index: msgIndex++,
        id,
        role,
        timestamp,
        content,
      };

      if (msg.model) parsed.model = msg.model;
      if (msg.stop_reason) parsed.stopReason = msg.stop_reason;
      if (msg.usage) {
        parsed.tokenUsage = {
          input: msg.usage.input_tokens ?? 0,
          output: msg.usage.output_tokens ?? 0,
          cacheCreation: msg.usage.cache_creation_input_tokens ?? 0,
          cacheRead: msg.usage.cache_read_input_tokens ?? 0,
        };
      }

      messages.push(parsed);
    } catch {
      // skip malformed lines
    }
  }

  return {
    messages,
    invokedSkills,
    firstTimestamp: messages[0]?.timestamp ?? null,
    lastTimestamp: messages[messages.length - 1]?.timestamp ?? null,
  };
}

function determineUserRole(msg: RawMessage): 'user' | 'tool' {
  if (!msg.content) return 'user';
  const blocks = Array.isArray(msg.content) ? msg.content : [];
  const hasToolResult = blocks.some(b => typeof b === 'object' && b !== null && (b as {type?: string}).type === 'tool_result');
  return hasToolResult ? 'tool' : 'user';
}

function normalizeContent(content: RawMessage['content']): ContentBlock[] {
  if (!content) return [];
  if (typeof content === 'string') return [{ type: 'text', text: content }];
  if (!Array.isArray(content)) return [];

  const blocks: ContentBlock[] = [];
  for (const block of content) {
    if (!block || typeof block !== 'object') continue;
    const b = block as RawContentBlock;

    if (b.type === 'text') {
      blocks.push({ type: 'text', text: b.text || '' });
    } else if (b.type === 'thinking') {
      // Skip thinking blocks in content (internal reasoning)
    } else if (b.type === 'tool_use') {
      blocks.push({ type: 'tool_use', id: b.id, name: b.name, input: b.input || {} });
    } else if (b.type === 'tool_result') {
      const innerContent = typeof b.content === 'string'
        ? [{ type: 'text' as const, text: b.content }]
        : normalizeContent(b.content);
      blocks.push({
        type: 'tool_result',
        tool_use_id: b.tool_use_id,
        content: innerContent,
        is_error: b.is_error,
      });
    }
  }
  return blocks;
}

export function resolveToolCalls(messages: ParsedMessage[]): ResolvedToolCall[] {
  const toolUseMap = new Map<string, {
    name: string;
    input: Record<string, unknown>;
    timestamp: string;
  }>();
  const resolved: ResolvedToolCall[] = [];

  for (const msg of messages) {
    if (msg.role === 'assistant') {
      for (const block of msg.content) {
        if (block.type === 'tool_use') {
          toolUseMap.set(block.id, { name: block.name, input: block.input, timestamp: msg.timestamp });
        }
      }
    }

    if (msg.role === 'tool' || msg.role === 'user') {
      for (const block of msg.content) {
        if (block.type === 'tool_result') {
          const use = toolUseMap.get(block.tool_use_id);
          if (!use) continue;

          const durationMs = use.timestamp
            ? new Date(msg.timestamp).getTime() - new Date(use.timestamp).getTime()
            : null;

          const isAgentSpawn = use.name === 'Agent' || use.name === 'Task' || use.name === 'Workflow';

          resolved.push({
            id: block.tool_use_id,
            name: use.name,
            input: use.input,
            result: block.content,
            isError: block.is_error ?? false,
            durationMs,
            isAgentSpawn,
            childAgentId: null,
          });
        }
      }
    }
  }

  return resolved;
}

export function extractAgentToolCalls(messages: ParsedMessage[]): AgentToolCall[] {
  const calls: AgentToolCall[] = [];

  for (const msg of messages) {
    if (msg.role !== 'assistant') continue;
    for (const block of msg.content) {
      if (block.type === 'tool_use' && (block.name === 'Agent' || block.name === 'Task' || block.name === 'Workflow')) {
        calls.push({
          toolUseId: block.id,
          toolName: block.name,
          prompt: (block.input.prompt as string) || (block.input.description as string) || '',
          description: block.input.description as string | undefined,
          subagentType: block.input.subagent_type as string | undefined,
          model: block.input.model as string | undefined,
          schema: block.input.schema as object | undefined,
          isolation: block.input.isolation as 'worktree' | undefined,
          timestamp: msg.timestamp,
        });
      }
    }
  }

  return calls;
}

export interface AgentToolCall {
  toolUseId: string;
  toolName: string;
  prompt: string;
  description?: string;
  subagentType?: string;
  model?: string;
  schema?: object;
  isolation?: 'worktree';
  timestamp: string;
}

export function getClaudeProjectsDir(sourceId?: string): string {
  const source = resolveSource(sourceId);
  return path.join(source.path, 'projects');
}

export function listProjectDirs(sourceId?: string): string[] {
  const projectsDir = getClaudeProjectsDir(sourceId);
  if (!fs.existsSync(projectsDir)) return [];

  try {
    return fs.readdirSync(projectsDir)
      .filter(name => {
        try {
          return fs.statSync(path.join(projectsDir, name)).isDirectory();
        } catch { return false; }
      });
  } catch {
    return [];
  }
}

export function listJsonlFiles(projectDir: string): string[] {
  if (!fs.existsSync(projectDir)) return [];
  try {
    return fs.readdirSync(projectDir)
      .filter(f => f.endsWith('.jsonl'))
      .map(f => path.join(projectDir, f));
  } catch {
    return [];
  }
}

export function decodeProjectPath(encoded: string): string {
  // Windows encoding: drive letter + -- + path with - as separator
  // e.g. C--Users-makum-Zeroni-Product-agent-watch
  if (/^[A-Za-z]--/.test(encoded)) {
    // Replace first -- with :\ and remaining - with \
    return encoded.replace(/^([A-Za-z])--/, '$1:\\').replace(/-/g, '\\');
  }

  // Linux/Mac: base64url encoded path
  try {
    // Handle url-safe base64 (- -> +, _ -> /)
    const b64 = encoded.replace(/-/g, '+').replace(/_/g, '/');
    const decoded = Buffer.from(b64, 'base64').toString('utf8');
    if (decoded.includes('/') || decoded.includes('\\')) {
      return decoded;
    }
  } catch {
    // fall through
  }

  // Fallback: return as-is
  return encoded;
}

export function getProjectDisplayName(encodedDirName: string): string {
  const decoded = decodeProjectPath(encodedDirName);

  // Split by path separator and take last 2 non-empty parts
  const parts = decoded.split(/[/\\]/).filter(Boolean);
  if (parts.length === 0) return encodedDirName;
  if (parts.length === 1) return parts[0];

  // Show last 2 path components joined
  return parts.slice(-2).join('/');
}
