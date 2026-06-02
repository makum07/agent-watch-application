'use client';

import { MarkdownRenderer } from '@/components/shared/markdown-renderer';
import { ToolCallCard } from './tool-call-card';
import { cn } from '@/lib/utils';
import type { ParsedMessage } from '@/lib/parser/jsonl-parser';

// System XML tags injected by Claude Code that should be filtered/hidden from UI
const SYSTEM_TAG_PATTERNS = [
  /^<ide_opened_file>[\s\S]*?<\/ide_opened_file>$/,
  /^<local-command-caveat>[\s\S]*?<\/local-command-caveat>$/,
  /^<local-command-stdout>[\s\S]*?<\/local-command-stdout>$/,
  /^<command-name>[\s\S]*?<\/command-name>[\s\S]*?<\/command-args>$/,
  /^<context>[\s\S]*?<\/context>$/,
];

const SYSTEM_TAG_STARTS = [
  '<ide_opened_file>',
  '<local-command-caveat>',
  '<local-command-stdout>',
  '<command-name>',
  '<context>',
  '<system-reminder>',
];

function isSystemContent(text: string): boolean {
  const t = text.trim();
  return SYSTEM_TAG_STARTS.some(tag => t.startsWith(tag));
}

// Strip ANSI escape codes (color/formatting codes from terminal output)
function stripAnsi(str: string): string {
  return str.replace(/\x1b\[[0-9;]*[mGKHF]/g, '').replace(/\x1b\[[\d;]*m/g, '');
}

function cleanText(text: string): string {
  return text
    .replace(/<ide_opened_file>[\s\S]*?<\/ide_opened_file>\n?/g, '')
    .replace(/<local-command-caveat>[\s\S]*?<\/local-command-caveat>\n?/g, '')
    .replace(/<local-command-stdout>([\s\S]*?)<\/local-command-stdout>/g, (_, content) => {
      const cleaned = stripAnsi(content.trim());
      return cleaned ? `\`\`\`\n${cleaned}\n\`\`\`` : '';
    })
    .replace(/<command-name>[\s\S]*?<\/command-name>/g, '')
    .replace(/<command-message>[\s\S]*?<\/command-message>/g, '')
    .replace(/<command-args>[\s\S]*?<\/command-args>/g, '')
    .replace(/<system-reminder>[\s\S]*?<\/system-reminder>\n?/g, '')
    .replace(/<context>[\s\S]*?<\/context>\n?/g, '')
    .replace(/\[\d+m/g, '') // leftover ANSI bracket codes
    .trim();
}

interface AgentMessageProps {
  message: ParsedMessage;
  isFirst?: boolean;
  isLast?: boolean;
}

export function AgentMessage({ message, isFirst, isLast }: AgentMessageProps) {
  const textBlocks = message.content
    .filter(b => b.type === 'text')
    .map(b => (b as { type: 'text'; text: string }).text);

  const rawText = textBlocks.join('\n');
  const cleanedText = cleanText(rawText);

  const toolUses = message.content.filter(b => b.type === 'tool_use') as Array<{
    type: 'tool_use'; id: string; name: string; input: Record<string, unknown>;
  }>;

  // Skip messages that are purely system tags with no meaningful content
  if (!cleanedText && toolUses.length === 0 && message.role !== 'assistant') return null;

  const isUser = message.role === 'user';
  const isPrompt = isFirst && isUser;

  const roleLabel = isPrompt ? 'PROMPT'
    : isUser ? 'USER'
    : isLast ? 'RESPONSE'
    : 'ASSISTANT';

  const roleLabelColor = isPrompt ? '#f0883e'
    : isUser ? '#58a6ff'
    : '#e6edf3';

  return (
    <div className={cn(
      'border-b border-[#21262d] last:border-0',
      isUser && 'bg-[#161b22]/40',
    )}>
      {/* Role + timestamp */}
      <div className="flex items-center gap-2 px-4 pt-3 pb-1.5">
        <span className="text-[11px] font-semibold uppercase tracking-wide" style={{ color: roleLabelColor }}>
          {roleLabel}
        </span>
        <span className="text-[11px] text-[#6e7681]">{formatTime(message.timestamp)}</span>
        {message.tokenUsage && (
          <span className="ml-auto text-[11px] text-[#6e7681]">
            {(message.tokenUsage.input + message.tokenUsage.output).toLocaleString()} tok
          </span>
        )}
      </div>

      {/* Content */}
      <div className="px-4 pb-3">
        {cleanedText && (
          <MarkdownRenderer content={cleanedText} />
        )}

        {toolUses.length > 0 && (
          <div className={cn('space-y-1.5', cleanedText && 'mt-3')}>
            {toolUses.map(tu => (
              <ToolCallCard
                key={tu.id}
                toolCall={{
                  id: tu.id,
                  name: tu.name,
                  input: tu.input,
                  result: undefined,
                  isError: false,
                  durationMs: null,
                  isAgentSpawn: tu.name === 'Agent' || tu.name === 'Task' || tu.name === 'Workflow',
                  childAgentId: null,
                }}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function formatTime(iso: string): string {
  try {
    return new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
  } catch { return iso; }
}
