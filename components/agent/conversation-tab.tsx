'use client';

import { useEffect, useRef, useState } from 'react';
import { useAgentMessages } from '@/hooks/use-agent-messages';

import { Loader2, User, Bot, Sparkles, ChevronDown, ChevronUp, ChevronsDown } from 'lucide-react';
import { MarkdownRenderer } from '@/components/shared/markdown-renderer';
import { cn } from '@/lib/utils';
import { formatTime as fmtTime } from '@/lib/utils';
import type { ParsedMessage } from '@/lib/parser/jsonl-parser';
import type { ContentBlock } from '@/types/session';
import { ToolCallWithResult } from './tool-call-with-result';
import { useWorkspaceStore } from '@/store/workspace-store';

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
  userMessage: ParsedMessage | null;
  messages: ParsedMessage[];
}

function buildTurns(messages: ParsedMessage[]): ConversationTurn[] {
  const turns: ConversationTurn[] = [];
  let current: ConversationTurn = { userMessage: null, messages: [] };

  for (const msg of messages) {
    const textContent = msg.content.filter(b => b.type === 'text').map(b => (b as { type:'text';text:string }).text).join('');
    const isToolResultOnly = msg.content.every(b => b.type === 'tool_result');
    const isTaskNotification = textContent.trim().startsWith('<task-notification>');
    if (isToolResultOnly || isTaskNotification) continue;
    if (msg.role === 'user' && isSystemOnly(textContent)) continue;

    // A real USER message starts a new turn
    if (msg.role === 'user' && current.messages.length > 0) {
      turns.push(current);
      current = { userMessage: msg, messages: [msg] };
      continue;
    }
    if (msg.role === 'user' && !current.userMessage) current.userMessage = msg;
    current.messages.push(msg);
  }
  if (current.messages.length > 0) turns.push(current);

  return turns;
}

export function ConversationTab({ sessionId, agentId, paneId = '' }: ConversationTabProps) {
  const refreshToken = useWorkspaceStore(s => s.refreshToken);
  const { messages, loadMore, hasMore, isLoading, total } = useAgentMessages(sessionId, agentId, refreshToken);
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

const COLLAPSE_LINE_THRESHOLD = 25;

interface TurnSectionProps {
  turn: ConversationTurn;
  toolResultMap: Map<string, { content: ContentBlock[]; isError: boolean }>;
  paneId: string;
}

function TurnSection({ turn, toolResultMap, paneId }: TurnSectionProps) {
  if (turn.messages.length === 0) return null;

  return (
    <div className="relative mb-1 min-w-0 overflow-hidden">
      <div className="min-w-0">
        {turn.messages.map((msg, i) => (
          <MessageRow
            key={`${msg.id}-${i}`}
            message={msg}
            isFirst={i === 0 && msg.role === 'user'}
            isLast={i === turn.messages.length - 1 && msg.role === 'assistant'}
            toolResultMap={toolResultMap}
            paneId={paneId}
          />
        ))}
      </div>
    </div>
  );
}

interface MessageRowProps {
  message: ParsedMessage;
  isFirst: boolean;
  isLast: boolean;
  toolResultMap: Map<string, { content: ContentBlock[]; isError: boolean }>;
  paneId: string;
}

function MessageRow({ message, isFirst, isLast, toolResultMap, paneId }: MessageRowProps) {
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
