'use client';

import { useEffect, useRef, useState } from 'react';
import { useAgentMessages } from '@/hooks/use-agent-messages';

import { Loader2, Users, User, Bot, Sparkles, ChevronDown, ChevronUp, ChevronsDown } from 'lucide-react';
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
  const refreshToken = useWorkspaceStore(s => s.refreshToken);
  const { messages, loadMore, hasMore, isLoading, total } = useAgentMessages(sessionId, agentId, refreshToken);
  const { agentMap } = useSessionStore();
  const bottomRef = useRef<HTMLDivElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const [isAtBottom, setIsAtBottom] = useState(true);
  const [isAtTop, setIsAtTop] = useState(true);
  const pendingScrollToBottom = useRef(false);
  const pendingScrollToTop = useRef(false);

  // Scroll-to-message: read target from tab state and scroll when found
  const scrollToMessageId = useWorkspaceStore(s =>
    paneId ? s.paneStates[paneId]?.tabStates[`agent:${agentId}`]?.scrollToMessageId : undefined
  );

  useEffect(() => {
    if (!scrollToMessageId || isLoading) return;

    const el = document.querySelector(`[data-message-id="${scrollToMessageId}"]`);
    if (el) {
      el.scrollIntoView({ behavior: 'smooth', block: 'center' });
      useWorkspaceStore.getState().updateTabState(paneId, `agent:${agentId}`, { scrollToMessageId: undefined });
    } else if (hasMore) {
      loadMore();
    }
  }, [scrollToMessageId, messages, hasMore, isLoading, paneId, agentId]);

  // Load-all-then-scroll: when pendingScrollToBottom is set, keep paging until done, then scroll
  useEffect(() => {
    if (!pendingScrollToBottom.current && !pendingScrollToTop.current) return;
    if (isLoading) return;
    if (hasMore) {
      loadMore();
    } else {
      if (pendingScrollToBottom.current) {
        pendingScrollToBottom.current = false;
        bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
      }
      if (pendingScrollToTop.current) {
        pendingScrollToTop.current = false;
        containerRef.current?.scrollTo({ top: 0, behavior: 'smooth' });
      }
    }
  }, [hasMore, isLoading, loadMore]);

  // Scroll sync: emit current visible timestamp on scroll; listen for incoming sync timestamp
  const scrollSyncEnabled = useWorkspaceStore(s => s.scrollSyncEnabled);
  const scrollSyncTimestamp = useWorkspaceStore(s => s.scrollSyncTimestamp);
  const isEmitting = useRef(false); // prevent echo-loop

  // Build sorted timestamp index from messages (for binary search)
  const timestampIndex = useRef<{ ts: number; id: string }[]>([]);
  useEffect(() => {
    timestampIndex.current = messages
      .filter(m => m.timestamp)
      .map(m => ({ ts: new Date(m.timestamp).getTime(), id: m.id }))
      .sort((a, b) => a.ts - b.ts);
  }, [messages]);

  // Emit: on scroll, find the topmost visible message and broadcast its timestamp
  const handleScroll = useRef(() => {
    const container = containerRef.current;
    if (!container) return;
    const distFromBottom = container.scrollHeight - container.scrollTop - container.clientHeight;
    setIsAtBottom(distFromBottom < 60);
    setIsAtTop(container.scrollTop < 60);
    if (!scrollSyncEnabled || isEmitting.current) return;
    const containerTop = container.getBoundingClientRect().top;
    const els = container.querySelectorAll('[data-message-id]');
    for (const el of els) {
      const rect = el.getBoundingClientRect();
      if (rect.bottom > containerTop + 20) {
        const msgId = (el as HTMLElement).dataset.messageId;
        const msg = messages.find(m => m.id === msgId);
        if (msg) useWorkspaceStore.getState().broadcastScrollTimestamp(msg.timestamp);
        break;
      }
    }
  });

  useEffect(() => {
    handleScroll.current = () => {
      const container = containerRef.current;
      if (!container) return;
      const distFromBottom = container.scrollHeight - container.scrollTop - container.clientHeight;
      setIsAtBottom(distFromBottom < 60);
      setIsAtTop(container.scrollTop < 60);
      if (!scrollSyncEnabled || isEmitting.current) return;
      const containerTop = container.getBoundingClientRect().top;
      const els = container.querySelectorAll('[data-message-id]');
      for (const el of els) {
        const rect = el.getBoundingClientRect();
        if (rect.bottom > containerTop + 20) {
          const msgId = (el as HTMLElement).dataset.messageId;
          const msg = messages.find(m => m.id === msgId);
          if (msg) useWorkspaceStore.getState().broadcastScrollTimestamp(msg.timestamp);
          break;
        }
      }
    };
  }, [scrollSyncEnabled, messages]);

  // Receive: when scrollSyncTimestamp changes (and this pane is NOT the source), scroll to nearest message
  useEffect(() => {
    if (!scrollSyncEnabled || !scrollSyncTimestamp || isEmitting.current) return;
    const targetTs = new Date(scrollSyncTimestamp).getTime();
    const idx = timestampIndex.current;
    if (!idx.length) return;

    // Binary search for nearest timestamp
    let lo = 0, hi = idx.length - 1;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (idx[mid].ts < targetTs) lo = mid + 1;
      else hi = mid;
    }
    const nearest = idx[lo];
    if (!nearest) return;

    isEmitting.current = true;
    const el = document.querySelector(`[data-message-id="${nearest.id}"]`);
    if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' });
    setTimeout(() => { isEmitting.current = false; }, 500);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scrollSyncTimestamp, scrollSyncEnabled]);

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
    <div className="relative h-full">
      {(!isAtBottom || !isAtTop) && (
        <div className="absolute bottom-3 right-3 z-10 flex flex-col gap-1">
          {!isAtTop && (
            <button
              onClick={() => {
                if (hasMore) {
                  pendingScrollToTop.current = true;
                  loadMore();
                } else {
                  containerRef.current?.scrollTo({ top: 0, behavior: 'smooth' });
                }
              }}
              className="flex items-center justify-center w-7 h-7 rounded-full bg-[var(--aw-bg-1)] border border-[var(--aw-bg-3)] text-[var(--aw-text-2)] hover:text-[var(--aw-text-0)] hover:border-[var(--aw-text-4)] transition-colors shadow-lg"
              title="Scroll to top"
            >
              <ChevronsDown className="h-3.5 w-3.5 rotate-180" />
            </button>
          )}
          {!isAtBottom && (
            <button
              onClick={() => {
                if (hasMore) {
                  pendingScrollToBottom.current = true;
                  loadMore();
                } else {
                  bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
                }
              }}
              className="flex items-center justify-center w-7 h-7 rounded-full bg-[var(--aw-bg-1)] border border-[var(--aw-bg-3)] text-[var(--aw-text-2)] hover:text-[var(--aw-text-0)] hover:border-[var(--aw-text-4)] transition-colors shadow-lg"
              title="Scroll to bottom"
            >
              <ChevronsDown className="h-3.5 w-3.5" />
            </button>
          )}
        </div>
      )}
    <div
      ref={containerRef}
      className="h-full overflow-y-auto overflow-x-hidden bg-[var(--aw-bg-0)]"
      onScroll={() => handleScroll.current()}
    >
      <div className="min-h-full w-full py-3">
        {isLoading && messages.length === 0 && (
          <div className="flex items-center justify-center h-32">
            <Loader2 className="h-5 w-5 animate-spin text-[var(--aw-text-4)]" />
          </div>
        )}
        {!isLoading && turns.length === 0 && (
          <div className="flex items-center justify-center h-32 text-[var(--aw-text-4)] text-sm">No messages</div>
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
            <button onClick={loadMore} disabled={isLoading} className="text-xs text-[var(--aw-text-2)] hover:text-[var(--aw-text-0)]">
              {isLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : `Load more (${total - messages.length} remaining)`}
            </button>
          </div>
        )}
        <div ref={bottomRef} />
      </div>
    </div>
    </div>
  );
}

const ROUND_COLORS = [
  { bg: 'var(--aw-blue-bg-deep2)', border: 'var(--aw-blue-bg)', text: 'var(--aw-blue)', rail: 'var(--aw-blue-rail)' },
  { bg: 'var(--aw-green-bg-deep2)', border: 'var(--aw-green-bg-2)', text: 'var(--aw-green-bright)', rail: 'var(--aw-green-rail)' },
  { bg: 'var(--aw-orange-bg-deep)', border: 'var(--aw-orange-bg)', text: 'var(--aw-orange)', rail: 'var(--aw-orange-rail)' },
  { bg: 'var(--aw-purple-bg-deep)', border: 'var(--aw-purple-border)', text: 'var(--aw-purple)', rail: 'var(--aw-purple-bg-deep2)' },
  { bg: 'var(--aw-red-bg-deep)', border: 'var(--aw-red-border)', text: 'var(--aw-red-text-bright)', rail: 'var(--aw-red-rail)' },
];

const COLLAPSE_LINE_THRESHOLD = 25;

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
            <span className="text-[11px] text-[var(--aw-text-1)] truncate flex-1 italic">
              "{userText.slice(0, 70)}{userText.length > 70 ? '…' : ''}"
            </span>
          )}

          {/* Spawned agent badges — click to open that agent in the current pane */}
          {spawnedAgents.length > 0 && (
            <div className="flex items-center gap-1.5 shrink-0">
              <Users className="h-3 w-3 text-[var(--aw-text-3)]" />
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
                <span className="text-[10px] text-[var(--aw-text-3)]">+{spawnedAgents.length - 5}</span>
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
        <div className="flex items-center gap-3 px-4 py-2 my-1">
          <div className="flex-1 h-px bg-[var(--aw-bg-2)]" />
          <span className="text-[10px] text-[var(--aw-text-4)] font-medium">{fmtTime(turn.userMessage.timestamp)}</span>
          <div className="flex-1 h-px bg-[var(--aw-bg-2)]" />
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
  const globalSearchQuery = useWorkspaceStore(s => s.globalSearchQuery);
  const highlightTerms = globalSearchQuery ? [globalSearchQuery] : undefined;

  const textBlocks = message.content.filter(b => b.type === 'text').map(b => (b as { type:'text';text:string }).text).join('\n');
  const cleanedText = cleanText(textBlocks);
  const toolUses = message.content.filter(b => b.type === 'tool_use') as Array<{ type:'tool_use'; id:string; name:string; input:Record<string,unknown> }>;

  if (!cleanedText && toolUses.length === 0) return null;

  const isUser = message.role === 'user';
  const isResponse = isLast && !isUser;
  const hasText = cleanedText.length > 0;
  const hasTools = toolUses.length > 0;
  const isToolOnly = !hasText && hasTools;

  const tokTotal = message.tokenUsage
    ? (message.tokenUsage.input + message.tokenUsage.output).toLocaleString()
    : null;

  const isLongMessage = cleanedText.split('\n').length > COLLAPSE_LINE_THRESHOLD;
  const [isExpanded, setIsExpanded] = useState(false);

  // ── Tool-only rows: ghost strip, no bubble ──────────────────────────────
  if (isToolOnly) {
    return (
      <div data-message-id={message.id} className="group flex items-start gap-2 px-4 py-0.5 my-0.5">
        <div
          className="mt-0.5 w-5 h-5 rounded-full flex items-center justify-center shrink-0 opacity-30 group-hover:opacity-60 transition-opacity"
          style={{ backgroundColor: 'var(--aw-bg-2)', border: '1px solid var(--aw-bg-3)' }}
        >
          <Bot className="h-2.5 w-2.5 text-[var(--aw-text-2)]" />
        </div>
        <div className="flex-1 min-w-0 space-y-0.5">
          {toolUses.map(tu => (
            <ToolCallWithResult
              key={tu.id}
              id={tu.id}
              name={tu.name}
              input={tu.input}
              result={toolResultMap.get(tu.id)?.content}
              isError={toolResultMap.get(tu.id)?.isError ?? false}
              paneId={paneId}
              compact
            />
          ))}
          <div className="flex items-center gap-1 px-0.5 opacity-0 group-hover:opacity-100 transition-opacity">
            <span className="text-[10px] text-[var(--aw-text-4)]">{fmtTime(message.timestamp)}</span>
            {tokTotal && <span className="text-[10px] text-[var(--aw-text-4)]">· {tokTotal} tok</span>}
          </div>
        </div>
      </div>
    );
  }

  // ── Message rows with text ──────────────────────────────────────────────
  const AvatarIcon = isUser ? User : isResponse ? Sparkles : Bot;
  const avatarAccent = isUser ? 'var(--aw-blue)' : isResponse ? 'var(--aw-green)' : 'var(--aw-text-3)';

  // Bubble colors
  const bubbleBg   = isUser ? 'var(--aw-user-bubble)' : 'var(--aw-assistant-bubble)';
  const bubbleBorder = isUser ? 'rgba(88,166,255,0.25)' : 'rgba(48,54,61,0.8)';
  const bubbleShadow = isUser
    ? '0 2px 8px rgba(0,0,0,0.35), 0 0 0 1px rgba(88,166,255,0.08)'
    : '0 1px 4px rgba(0,0,0,0.25)';

  return (
    <div
      data-message-id={message.id}
      className={cn(
        'flex items-end gap-2.5 px-4',
        isUser ? 'flex-row-reverse' : 'flex-row',
        isResponse ? 'py-3' : 'py-2',
      )}
    >
      {/* Avatar — sits at baseline of the bubble */}
      <div className="shrink-0 self-end pb-6">
        <div
          className="w-7 h-7 rounded-full flex items-center justify-center"
          style={{
            backgroundColor: `${avatarAccent}18`,
            border: `1.5px solid ${avatarAccent}35`,
          }}
        >
          <AvatarIcon className="h-3.5 w-3.5" style={{ color: avatarAccent }} />
        </div>
      </div>

      {/* Content column */}
      <div className={cn(
        'flex flex-col gap-1.5 min-w-0 overflow-hidden',
        isUser ? 'items-end max-w-[78%]' : 'items-start flex-1',
      )}>

        {/* Text bubble */}
        {hasText && (
          <div
            className={cn(
              'px-4 py-3 break-words overflow-hidden w-full',
              isUser ? 'rounded-2xl rounded-br-sm' : 'rounded-2xl rounded-bl-sm',
            )}
            style={{ backgroundColor: bubbleBg, border: `1px solid ${bubbleBorder}`, boxShadow: bubbleShadow }}
          >
            {/* Collapsible content */}
            <div className="relative">
              <div
                className="overflow-hidden"
                style={isLongMessage && !isExpanded ? { maxHeight: '500px' } : undefined}
              >
                <MarkdownRenderer content={cleanedText} size="base" highlightTerms={highlightTerms} />
              </div>
              {isLongMessage && !isExpanded && (
                <div
                  className="absolute bottom-0 left-0 right-0 h-14 pointer-events-none"
                  style={{ background: `linear-gradient(to top, ${bubbleBg}, transparent)` }}
                />
              )}
            </div>
            {isLongMessage && (
              <button
                onClick={() => setIsExpanded(v => !v)}
                className="mt-2 flex items-center gap-1 text-[11px] text-[var(--aw-blue)] hover:text-[var(--aw-blue-light)] transition-colors"
              >
                {isExpanded
                  ? <><ChevronUp className="h-3 w-3" /> Show less</>
                  : <><ChevronDown className="h-3 w-3" /> Show more</>
                }
              </button>
            )}
          </div>
        )}

        {/* Tool cards attached below the bubble */}
        {hasTools && (
          <div className="w-full space-y-1">
            {toolUses.map(tu => (
              <ToolCallWithResult
                key={tu.id}
                id={tu.id}
                name={tu.name}
                input={tu.input}
                result={toolResultMap.get(tu.id)?.content}
                isError={toolResultMap.get(tu.id)?.isError ?? false}
                paneId={paneId}
              />
            ))}
          </div>
        )}

        {/* Timestamp + tokens — outside the bubble, faint */}
        <div className={cn('flex items-center gap-1.5 px-1', isUser ? 'flex-row-reverse' : 'flex-row')}>
          <span className="text-[10px] text-[var(--aw-text-4)]">{fmtTime(message.timestamp)}</span>
          {tokTotal && <span className="text-[10px] text-[var(--aw-text-4)]">· {tokTotal} tok</span>}
        </div>
      </div>
    </div>
  );
}
