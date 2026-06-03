'use client';

import { useEffect, useRef } from 'react';
import { useAgentMessages } from '@/hooks/use-agent-messages';

import { Loader2, Users, User, Bot, Sparkles } from 'lucide-react';
import { MarkdownRenderer } from '@/components/shared/markdown-renderer';
import { cn } from '@/lib/utils';
import { formatTime as fmtTime } from '@/lib/utils';
import type { ParsedMessage } from '@/lib/parser/jsonl-parser';
import type { ContentBlock } from '@/types/session';
import { ToolCallWithResult } from './tool-call-with-result';
import { useSessionStore } from '@/store/session-store';
import { useWorkspaceStore } from '@/store/workspace-store';
import { getAgentDisplay } from '@/lib/agent-display';

interface ConversationTabProps {
  sessionId: string;
  agentId: string;
  paneId?: string;
}

const SYSTEM_PREFIXES = [
  '<ide_opened_file>', '<local-command-caveat>', '<command-name>',
  '<system-reminder>', '<context>', '<task-notification>',
];

function stripAnsi(s: string) {
  return s.replace(/\x1b\[[0-9;]*[mGKHF]/g, '').replace(/\[\d+m/g, '');
}

function cleanText(text: string): string {
  return text
    .replace(/<ide_opened_file>[\s\S]*?<\/ide_opened_file>\n?/g, '')
    .replace(/<local-command-caveat>[\s\S]*?<\/local-command-caveat>\n?/g, '')
    .replace(/<local-command-stdout>([\s\S]*?)<\/local-command-stdout>/g, (_, c) => {
      const cleaned = stripAnsi(c.trim());
      return cleaned ? `\`\`\`\n${cleaned}\n\`\`\`` : '';
    })
    .replace(/<command-name>[\s\S]*?<\/command-name>/g, '')
    .replace(/<command-message>[\s\S]*?<\/command-message>/g, '')
    .replace(/<command-args>[\s\S]*?<\/command-args>/g, '')
    .replace(/<system-reminder>[\s\S]*?<\/system-reminder>\n?/g, '')
    .replace(/<task-notification>[\s\S]*?<\/task-notification>\n?/g, '')
    .replace(/<context>[\s\S]*?<\/context>\n?/g, '')
    .trim();
}

function isSystemOnly(text: string): boolean {
  const t = text.trim();
  return SYSTEM_PREFIXES.some(p => t.startsWith(p)) && cleanText(t) === '';
}

interface ConversationTurn {
  /** null for plain exchanges, 1-indexed for turns that spawn agents */
  orchestrationRound: number | null;
  userMessage: ParsedMessage | null;
  messages: ParsedMessage[];
}

function buildTurns(messages: ParsedMessage[]): ConversationTurn[] {
  const turns: ConversationTurn[] = [];
  let current: ConversationTurn = { orchestrationRound: null, userMessage: null, messages: [] };

  for (const msg of messages) {
    const textContent = msg.content.filter(b => b.type === 'text').map(b => (b as { type:'text';text:string }).text).join('');
    const isToolResultOnly = msg.content.every(b => b.type === 'tool_result');
    const isTaskNotification = textContent.trim().startsWith('<task-notification>');
    if (isToolResultOnly || isTaskNotification) continue;
    if (msg.role === 'user' && isSystemOnly(textContent)) continue;

    // A real USER message starts a new turn
    if (msg.role === 'user' && current.messages.length > 0) {
      turns.push(current);
      current = { orchestrationRound: null, userMessage: msg, messages: [msg] };
      continue;
    }
    if (msg.role === 'user' && !current.userMessage) current.userMessage = msg;
    current.messages.push(msg);
  }
  if (current.messages.length > 0) turns.push(current);

  // Assign orchestration round numbers ONLY to turns that spawn agents
  let roundNum = 0;
  for (const turn of turns) {
    const spawnsAgents = turn.messages.some(m =>
      m.role === 'assistant' &&
      m.content.some(b => b.type === 'tool_use' && (b.name === 'Workflow' || b.name === 'Agent' || b.name === 'Task'))
    );
    if (spawnsAgents) {
      roundNum++;
      turn.orchestrationRound = roundNum;
    }
  }

  return turns;
}

export function ConversationTab({ sessionId, agentId, paneId = '' }: ConversationTabProps) {
  const { messages, loadMore, hasMore, isLoading, total } = useAgentMessages(sessionId, agentId);
  const { agentMap } = useSessionStore();
  const bottomRef = useRef<HTMLDivElement>(null);

  // Tool result map for inline display
  const toolResultMap = new Map<string, { content: ContentBlock[]; isError: boolean }>();
  for (const msg of messages) {
    if (msg.role === 'user' || msg.role === 'tool') {
      for (const block of msg.content) {
        if (block.type === 'tool_result') {
          toolResultMap.set(block.tool_use_id, {
            content: block.content as ContentBlock[],
            isError: block.is_error ?? false,
          });
        }
      }
    }
  }

  const turns = buildTurns(messages);
  const subagents = [...agentMap.values()].filter(a => a.type !== 'orchestrator');
  const totalOrchRounds = turns.filter(t => t.orchestrationRound !== null).length;
  const activePaneId = paneId;

  return (
    <div className="h-full overflow-y-auto overflow-x-hidden">
      <div className="min-h-full w-full">
        {isLoading && messages.length === 0 && (
          <div className="flex items-center justify-center h-32">
            <Loader2 className="h-5 w-5 animate-spin text-[#484f58]" />
          </div>
        )}
        {!isLoading && turns.length === 0 && (
          <div className="flex items-center justify-center h-32 text-[#484f58] text-sm">No messages</div>
        )}

        {turns.map((turn, ti) => (
          <TurnSection
            key={ti}
            turn={turn}
            toolResultMap={toolResultMap}
            subagents={subagents}
            agentMap={agentMap}
            isMultiRound={totalOrchRounds > 1}
            paneId={activePaneId}
          />
        ))}

        {hasMore && (
          <div className="p-4 flex justify-center">
            <button onClick={loadMore} disabled={isLoading} className="text-xs text-[#8b949e] hover:text-[#e6edf3]">
              {isLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : `Load more (${total - messages.length} remaining)`}
            </button>
          </div>
        )}
        <div ref={bottomRef} />
      </div>
    </div>
  );
}

const ROUND_COLORS = [
  { bg: '#0e1f35', border: '#2d5a8c', text: '#58a6ff', rail: '#1c3d6e' },
  { bg: '#0e2516', border: '#2d6b47', text: '#39d353', rail: '#1a4a2e' },
  { bg: '#2a1a08', border: '#6b4a1a', text: '#f0883e', rail: '#4a2f0d' },
  { bg: '#1a0f30', border: '#4d3470', text: '#bc8cff', rail: '#2d1f45' },
  { bg: '#2a0d0d', border: '#6b2020', text: '#ff7b7b', rail: '#4a1515' },
];

interface TurnSectionProps {
  turn: ConversationTurn;
  toolResultMap: Map<string, { content: ContentBlock[]; isError: boolean }>;
  subagents: import('@/types/session').Agent[];
  agentMap: Map<string, import('@/types/session').Agent>;
  isMultiRound: boolean;
  paneId: string;
}

function TurnSection({ turn, toolResultMap, subagents, agentMap, isMultiRound, paneId }: TurnSectionProps) {
  if (turn.messages.length === 0) return null;

  const isOrchRound = turn.orchestrationRound !== null;
  const rn = turn.orchestrationRound ?? 0;
  const color = ROUND_COLORS[(rn - 1) % ROUND_COLORS.length];

  // Find agents spawned in this turn by timing
  const spawnedAgents = isOrchRound ? findSpawnedAgents(turn.messages, subagents) : [];

  // Orchestration round — prominent colored header + left rail
  if (isOrchRound && isMultiRound) {
    const userText = turn.userMessage
      ? cleanText(turn.userMessage.content.filter(b => b.type === 'text').map(b => (b as { type:'text';text:string }).text).join(''))
      : '';

    return (
      <div className="relative mb-2 min-w-0 overflow-hidden">
        {/* Bold round banner */}
        <div
          className="sticky top-0 z-10 flex items-center gap-3 px-4 py-2.5 border-b min-w-0 overflow-hidden"
          style={{ backgroundColor: color.bg, borderColor: color.border, borderLeftWidth: '3px', borderLeftColor: color.border }}
        >
          {/* Round label */}
          <div className="flex items-center gap-2 shrink-0">
            <div
              className="px-2.5 py-1 rounded-md text-[11px] font-bold tracking-wider uppercase border"
              style={{ backgroundColor: `${color.text}18`, color: color.text, borderColor: `${color.text}40` }}
            >
              ◈ Round {rn}
            </div>
          </div>

          {/* User message excerpt */}
          {userText && (
            <span className="text-[11px] text-[#c9d1d9] truncate flex-1 italic">
              "{userText.slice(0, 70)}{userText.length > 70 ? '…' : ''}"
            </span>
          )}

          {/* Spawned agent badges — click to open that agent in the current pane */}
          {spawnedAgents.length > 0 && (
            <div className="flex items-center gap-1.5 shrink-0">
              <Users className="h-3 w-3 text-[#6e7681]" />
              {spawnedAgents.slice(0, 5).map(agent => {
                const { color: ac, initials, name } = getAgentDisplay(agent);
                return (
                  <button
                    key={agent.id}
                    className="text-[10px] font-bold px-1.5 py-0.5 rounded border cursor-pointer hover:opacity-80 transition-opacity"
                    style={{ color: ac.text, backgroundColor: ac.bg, borderColor: ac.border }}
                    title={`Open ${name}`}
                    onClick={e => {
                      e.stopPropagation();
                      useWorkspaceStore.getState().addTabToPane(paneId, {
                        type: 'agent',
                        agentId: agent.id,
                        label: name.slice(0, 20),
                      });
                    }}
                  >
                    {initials}
                  </button>
                );
              })}
              {spawnedAgents.length > 5 && (
                <span className="text-[10px] text-[#6e7681]">+{spawnedAgents.length - 5}</span>
              )}
            </div>
          )}
        </div>

        {/* Messages with left rail */}
        <div className="border-l-2 ml-2 min-w-0 overflow-hidden" style={{ borderColor: color.rail }}>
          {turn.messages.map((msg, i) => (
            <MessageRow
              key={`${msg.id}-${i}`}
              message={msg}
              isFirst={i === 0 && msg.role === 'user'}
              isLast={i === turn.messages.length - 1 && msg.role === 'assistant'}
              toolResultMap={toolResultMap}
              roundColor={color.text}
              paneId={paneId}
            />
          ))}
        </div>
      </div>
    );
  }

  // Plain exchange (no agents spawned) — lighter separator
  return (
    <div className="relative mb-1 min-w-0 overflow-hidden">
      {isMultiRound && turn.userMessage && (
        <div className="flex items-center gap-2 px-4 py-1.5 bg-[#161b22] border-b border-[#21262d]">
          <div className="text-[10px] font-medium text-[#6e7681] uppercase tracking-wider">Exchange</div>
          <div className="flex-1 h-px bg-[#21262d]" />
          <span className="text-[10px] text-[#6e7681]">{fmtTime(turn.userMessage.timestamp)}</span>
        </div>
      )}
      <div className="min-w-0">
        {turn.messages.map((msg, i) => (
          <MessageRow
            key={`${msg.id}-${i}`}
            message={msg}
            isFirst={i === 0 && msg.role === 'user'}
            isLast={i === turn.messages.length - 1 && msg.role === 'assistant'}
            toolResultMap={toolResultMap}
            roundColor={undefined}
            paneId={paneId}
          />
        ))}
      </div>
    </div>
  );
}

function findSpawnedAgents(
  msgs: ParsedMessage[],
  subagents: import('@/types/session').Agent[]
): import('@/types/session').Agent[] {
  const hasSpawn = msgs.some(m =>
    m.role === 'assistant' &&
    m.content.some(b => b.type === 'tool_use' && (b.name === 'Workflow' || b.name === 'Agent' || b.name === 'Task'))
  );
  if (!hasSpawn || subagents.length === 0) return [];

  const turnStart = Math.min(...msgs.map(m => new Date(m.timestamp).getTime()));
  const turnEnd = Math.max(...msgs.map(m => new Date(m.timestamp).getTime()));
  const WINDOW = 30 * 60 * 1000;

  return subagents.filter(a => {
    if (!a.startTime) return false;
    const t = new Date(a.startTime).getTime();
    return t >= turnStart - 5000 && t <= turnEnd + WINDOW;
  });
}

interface MessageRowProps {
  message: ParsedMessage;
  isFirst: boolean;
  isLast: boolean;
  toolResultMap: Map<string, { content: ContentBlock[]; isError: boolean }>;
  roundColor: string | undefined;
  paneId: string;
}

function MessageRow({ message, isFirst, isLast, toolResultMap, roundColor, paneId }: MessageRowProps) {
  const textBlocks = message.content.filter(b => b.type === 'text').map(b => (b as { type:'text';text:string }).text).join('\n');
  const cleanedText = cleanText(textBlocks);
  const toolUses = message.content.filter(b => b.type === 'tool_use') as Array<{ type:'tool_use'; id:string; name:string; input:Record<string,unknown> }>;

  if (!cleanedText && toolUses.length === 0) return null;

  const isUser = message.role === 'user';
  const isResponse = isLast && !isUser;

  const avatarColor = isUser ? '#58a6ff' : isResponse ? '#3fb950' : '#8b949e';
  const AvatarIcon = isUser ? User : isResponse ? Sparkles : Bot;

  // Bubble appearance — distinct backgrounds per sender
  const bubbleCls = isUser
    ? 'bg-[#0a1c30] border border-[#1e4a73] rounded-2xl rounded-tr-sm shadow-[0_2px_8px_#00000030,0_0_0_1px_#58a6ff10]'
    : isResponse
    ? 'bg-[#0c1929] border border-[#2d5a9e] rounded-2xl rounded-tl-sm shadow-[0_2px_12px_#1a3a6e25,0_0_0_1px_#2d5a9e20]'
    : 'bg-[#161b22] border border-[#30363d] rounded-xl rounded-tl-sm';

  const tokTotal = message.tokenUsage
    ? (message.tokenUsage.input + message.tokenUsage.output).toLocaleString()
    : null;

  const hasText = cleanedText.length > 0;
  const hasTools = toolUses.length > 0;

  // Tool-only rows (intermediate steps) are visually de-emphasized
  const isToolOnly = !hasText && hasTools;
  const isPrimary = isUser || isResponse;

  return (
    <div className={cn(
      'flex items-start min-w-0 overflow-hidden',
      isUser ? 'flex-row-reverse pl-10 pr-3' : 'px-3',
      isToolOnly ? 'py-0.5 gap-1.5' : 'py-2 gap-2',
    )}>
      {/* Avatar — smaller and muted for tool-only rows */}
      <div className={cn('shrink-0', isToolOnly ? 'mt-0.5' : 'mt-1')}>
        <div
          className={cn('rounded-full flex items-center justify-center', isToolOnly ? 'w-4 h-4' : 'w-6 h-6')}
          style={{
            backgroundColor: `${isToolOnly ? '#484f58' : avatarColor}18`,
            border: `1px solid ${isToolOnly ? '#484f58' : avatarColor}35`,
          }}
        >
          <AvatarIcon
            className={isToolOnly ? 'h-2 w-2' : 'h-3 w-3'}
            style={{ color: isToolOnly ? '#484f58' : avatarColor }}
          />
        </div>
      </div>

      {/* Content column — flex-1 min-w-0 so it fills remaining space without overflowing */}
      <div className={cn('flex-1 min-w-0 overflow-hidden', isToolOnly ? 'space-y-0.5' : 'space-y-2')}>

        {/* Text bubble — only rendered when there is actual text */}
        {hasText && (
          <div className={cn(isPrimary ? 'px-4 py-3.5' : 'px-3.5 py-3', 'break-words overflow-hidden', bubbleCls)}>

            {/* Response timestamp strip */}
            {isResponse && (
              <div className="flex items-center mb-3 pb-2.5 border-b border-[#2d5a9e]/50">
                <span className="text-[10px] text-[#6e7681] ml-auto">
                  {fmtTime(message.timestamp)}{tokTotal ? ` · ${tokTotal} tok` : ''}
                </span>
              </div>
            )}

            <MarkdownRenderer content={cleanedText} size={isPrimary ? 'base' : 'sm'} />

            {!isResponse && (
              <div className="flex items-center gap-1.5 mt-3 justify-end">
                <span className="text-[10px] text-[#6e7681]">{fmtTime(message.timestamp)}</span>
                {tokTotal && <span className="text-[10px] text-[#6e7681]">· {tokTotal} tok</span>}
              </div>
            )}
          </div>
        )}

        {/* Tool action cards — compact when there is no accompanying text */}
        {hasTools && (
          <div className={isToolOnly ? 'space-y-0.5' : 'space-y-1.5'}>
            {toolUses.map(tu => (
              <ToolCallWithResult
                key={tu.id}
                id={tu.id}
                name={tu.name}
                input={tu.input}
                result={toolResultMap.get(tu.id)?.content}
                isError={toolResultMap.get(tu.id)?.isError ?? false}
                paneId={paneId}
                compact={isToolOnly}
              />
            ))}
            {/* Timestamp below tool cards when there is no text bubble */}
            {!hasText && (
              <div className={cn('flex items-center gap-1.5 px-1', isUser ? 'justify-start' : 'justify-end')}>
                <span className="text-[10px] text-[#484f58]">{fmtTime(message.timestamp)}</span>
                {tokTotal && <span className="text-[10px] text-[#484f58]">· {tokTotal} tok</span>}
              </div>
            )}
          </div>
        )}

      </div>
    </div>
  );
}
