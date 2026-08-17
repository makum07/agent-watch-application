import path from 'path';
import fs from 'fs';
import {
  parseJsonlFile,
  type ParsedConversation,
} from './jsonl-parser';
import { parseSessionTitle, MIN_TITLE_LEN } from '@/lib/utils';

export interface CorrelatedAgent {
  conversationId: string;
  filePath: string;
  parentConversationId: string | null;
  parentToolUseId: string | null;
  agentToolCall: AgentMeta | null;
  parsed: ParsedConversation;
  depth: number;
  workflowRunId: string | null;
  agentLabel?: string; // prompt label from workflow script
}

export interface AgentMeta {
  agentType: string;        // "workflow-subagent", "Explore", "Plan", etc.
  toolUseId?: string;       // links back to parent tool_use block
  description?: string;     // agent description if any
  subagentType?: string;
  model?: string;
  prompt?: string;
  label?: string;
}

/**
 * Main entry point. Given the root session JSONL file, finds ALL subagents
 * using the actual Claude Code directory structure:
 *
 * <project-dir>/
 *   <session-id>.jsonl                         → root session
 *   <session-id>/
 *     subagents/
 *       agent-<hex16>.jsonl                    → named Agent/Task subagent
 *       agent-<hex16>.meta.json                → {agentType, toolUseId, description}
 *       workflows/
 *         <wf-run-id>/
 *           journal.jsonl                      → {agentId, key} mappings
 *           agent-<hex16>.jsonl                → workflow subagent transcript
 *           agent-<hex16>.meta.json            → {agentType: "workflow-subagent"}
 *     workflows/
 *       <wf-run-id>.json                       → full workflow run data
 *     tool-results/
 *       <toolUseId>.txt                        → externally stored large tool results
 */
export function correlateAgents(
  rootFilePath: string,
  _projectDir: string  // kept for API compat but not used — we derive from rootFilePath
): CorrelatedAgent[] {
  const rootId = path.basename(rootFilePath, '.jsonl');
  const sessionDir = path.join(path.dirname(rootFilePath), rootId);

  const result: CorrelatedAgent[] = [];

  // 1. Root orchestrator
  const rootParsed = parseJsonlFile(rootFilePath);
  result.push({
    conversationId: rootId,
    filePath: rootFilePath,
    parentConversationId: null,
    parentToolUseId: null,
    agentToolCall: null,
    parsed: rootParsed,
    depth: 0,
    workflowRunId: null,
    agentLabel: undefined,
  });

  if (!fs.existsSync(sessionDir)) return result;

  const subagentsDir = path.join(sessionDir, 'subagents');

  // 2. Named agents (Agent / Task tool calls) — directly in subagents/
  if (fs.existsSync(subagentsDir)) {
    try {
      const entries = fs.readdirSync(subagentsDir);
      const namedJsonl = entries.filter(f => f.startsWith('agent-') && f.endsWith('.jsonl'));

      for (const file of namedJsonl) {
        const agentHexId = file.replace('.jsonl', '');
        const filePath = path.join(subagentsDir, file);
        const metaPath = path.join(subagentsDir, `${agentHexId}.meta.json`);

        let meta: AgentMeta = { agentType: 'agent' };
        if (fs.existsSync(metaPath)) {
          try { meta = JSON.parse(fs.readFileSync(metaPath, 'utf8')); } catch {}
        }

        const parsed = parseJsonlFile(filePath);
        result.push({
          conversationId: agentHexId,
          filePath,
          parentConversationId: rootId,
          parentToolUseId: meta.toolUseId || null,
          agentToolCall: meta,
          parsed,
          depth: 1,
          workflowRunId: null,
          agentLabel: meta.description || meta.label || undefined,
        });
      }
    } catch {}
  }

  // 2b. Fix parent-child relationships — check which agent's JSONL actually
  //     contains each toolUseId as an Agent/Task tool_use block.
  //     Claude Code stores all sidechain agents flat in subagents/ regardless of
  //     nesting depth, so we can't rely on directory structure for depth.
  resolveParentChain(result, rootId);

  // 3. Workflow subagents — in subagents/workflows/<wf-run-id>/
  const workflowsSubDir = path.join(subagentsDir, 'workflows');
  if (fs.existsSync(workflowsSubDir)) {
    try {
      for (const wfId of fs.readdirSync(workflowsSubDir)) {
        const wfDir = path.join(workflowsSubDir, wfId);
        if (!fs.statSync(wfDir).isDirectory()) continue;

        // Parse journal.jsonl to get agent labels/order
        const journalPath = path.join(wfDir, 'journal.jsonl');
        const journalEntries = parseJournal(journalPath);

        // Load workflow run data for agent labels if available
        const wfDataPath = path.join(sessionDir, 'workflows', `${wfId}.json`);
        const wfData = loadWorkflowData(wfDataPath);

        const agentFiles = fs.readdirSync(wfDir)
          .filter(f => f.startsWith('agent-') && f.endsWith('.jsonl'));

        for (const file of agentFiles) {
          // file = "agent-a4101e1aafc01cb2b.jsonl"
          // agentHexId = "agent-a4101e1aafc01cb2b" (full prefix)
          // shortId = "a4101e1aafc01cb2b" (used in workflowProgress.agentId)
          const agentHexId = file.replace('.jsonl', '');
          const shortId = agentHexId.replace(/^agent-/, '');
          const filePath = path.join(wfDir, file);
          const metaPath = path.join(wfDir, `${agentHexId}.meta.json`);

          let meta: AgentMeta = { agentType: 'workflow-subagent' };
          if (fs.existsSync(metaPath)) {
            try { meta = JSON.parse(fs.readFileSync(metaPath, 'utf8')); } catch {}
          }

          // Try to get the label from the workflow run data using shortId
          const journalEntry = journalEntries.find(e => e.agentId === shortId);
          const agentLabel = getAgentLabelFromWorkflow(wfData, journalEntry?.key, shortId);

          const parsed = parseJsonlFile(filePath);
          // Use label as description
          const description = agentLabel || `${wfId.slice(0, 12)} agent`;
          result.push({
            conversationId: agentHexId,
            filePath,
            parentConversationId: rootId,
            parentToolUseId: null,
            agentToolCall: {
              agentType: 'workflow-subagent',
              subagentType: 'workflow-subagent',
              label: agentLabel ?? undefined,
              description,
            },
            parsed,
            depth: 1,
            workflowRunId: wfId,
            agentLabel: agentLabel ?? undefined,
          });
        }
      }
    } catch {}
  }

  return result;
}

/**
 * Second pass: fix parent-child relationships using toolUseId matching.
 *
 * All named agents are initially assigned parentConversationId = rootId and depth = 1.
 * But some agents may actually have been spawned by another subagent (not root).
 * We detect this by scanning each subagent's messages for Agent/Task tool_use blocks
 * whose id matches a child agent's parentToolUseId. If found, that subagent is the
 * true parent and we update the child accordingly, then recompute all depths.
 */
function resolveParentChain(agents: CorrelatedAgent[], rootId: string): void {
  // Map: toolUseId → child agent
  const byToolUseId = new Map<string, CorrelatedAgent>();
  for (const agent of agents) {
    if (agent.parentToolUseId) byToolUseId.set(agent.parentToolUseId, agent);
  }

  // For each non-root agent, scan its messages for Agent/Task tool_use blocks
  for (const parent of agents) {
    if (parent.conversationId === rootId) continue;
    for (const msg of parent.parsed.messages) {
      for (const block of msg.content) {
        if (
          block.type === 'tool_use' &&
          (block.name === 'Agent' || block.name === 'Task')
        ) {
          const child = byToolUseId.get(block.id);
          if (child && child.parentConversationId === rootId) {
            child.parentConversationId = parent.conversationId;
          }
        }
      }
    }
  }

  // Recompute depths via BFS from root
  const depthMap = new Map<string, number>([[rootId, 0]]);
  const queue = [rootId];
  while (queue.length > 0) {
    const parentId = queue.shift()!;
    const parentDepth = depthMap.get(parentId)!;
    for (const agent of agents) {
      if (agent.parentConversationId === parentId && !depthMap.has(agent.conversationId)) {
        depthMap.set(agent.conversationId, parentDepth + 1);
        agent.depth = parentDepth + 1;
        queue.push(agent.conversationId);
      }
    }
  }
}

interface JournalEntry {
  type: 'started' | 'result' | string;
  key: string;
  agentId: string;
  result?: string;
}

function parseJournal(journalPath: string): JournalEntry[] {
  if (!fs.existsSync(journalPath)) return [];
  try {
    return fs.readFileSync(journalPath, 'utf8')
      .split('\n')
      .filter(l => l.trim())
      .map(l => {
        try { return JSON.parse(l); } catch { return null; }
      })
      .filter(Boolean) as JournalEntry[];
  } catch { return []; }
}

interface WorkflowProgress {
  type: string;
  label?: string;
  agentId?: string;
  phase?: string;
  status?: string;
}

interface WorkflowData {
  runId?: string;
  script?: string;
  workflowName?: string;
  phases?: Array<{ title: string; detail?: string }>;
  workflowProgress?: WorkflowProgress[];
  status?: string;
  durationMs?: number;
  totalTokens?: number;
}

function loadWorkflowData(wfDataPath: string): WorkflowData | null {
  if (!fs.existsSync(wfDataPath)) return null;
  try {
    return JSON.parse(fs.readFileSync(wfDataPath, 'utf8'));
  } catch { return null; }
}

function getAgentLabelFromWorkflow(
  wfData: WorkflowData | null,
  _key: string | undefined,
  agentHexId: string
): string | null {
  if (!wfData) return null;
  // Primary: workflowProgress entries have agentId → label mapping
  if (wfData.workflowProgress) {
    const entry = wfData.workflowProgress.find(
      p => p.type === 'workflow_agent' && p.agentId === agentHexId
    );
    if (entry?.label) return entry.label;
  }
  return null;
}

/**
 * Reads an externally-stored tool result if available.
 */
export function readExternalToolResult(
  sessionFilePath: string,
  toolUseId: string
): string | null {
  const sessionId = path.basename(sessionFilePath, '.jsonl');
  const resultPath = path.join(
    path.dirname(sessionFilePath),
    sessionId,
    'tool-results',
    `${toolUseId}.txt`
  );
  if (!fs.existsSync(resultPath)) return null;
  try {
    return fs.readFileSync(resultPath, 'utf8').slice(0, 10000);
  } catch { return null; }
}

/**
 * Extracts the ai-title from a session JSONL file.
 */
export function extractAiTitle(filePath: string): string | null {
  if (!fs.existsSync(filePath)) return null;
  try {
    const content = fs.readFileSync(filePath, 'utf8');
    for (const line of content.split('\n')) {
      if (!line.trim()) continue;
      try {
        const obj = JSON.parse(line);
        if (obj.type === 'ai-title' && obj.aiTitle) return obj.aiTitle;
      } catch {}
    }
  } catch {}
  return null;
}

// IDE/tooling injects these as "user" turns (file-opened notices, async-agent
// completion pings, etc.) — never something a human typed, so they're noise
// when picked up as a session title. They can appear as their own message, or
// bolted onto the front of the real prompt's text, so strip rather than just detect.
const SYNTHETIC_BLOCK_RE = /^\s*<(ide_[\w-]+|task-notification|system-reminder|automated-reminder|user-prompt-submit-hook)>[\s\S]*?<\/\1>\s*/;
function stripSyntheticNoise(text: string): string {
  let out = text;
  while (SYNTHETIC_BLOCK_RE.test(out)) out = out.replace(SYNTHETIC_BLOCK_RE, '');
  return out.trim();
}

export interface FirstUserMessageInfo {
  title: string | null;
  /** Whether the session's actual first message was a slash command — independent of
   * whatever text ends up displayed as the title (an AI-generated title, or a longer
   * later message used because the first one was too short to be useful). */
  isCommand: boolean;
}

/**
 * Extracts the first human-typed user message from a session JSONL file, for use as a
 * readable session title fallback and as the source of truth for "was this session
 * started via a slash command" — the actual first message, not whatever title ends up
 * displayed (an AI-generated title can paraphrase a much later request).
 *
 * When the first real message is too short to be a useful title (a bare `/model` or
 * `/clear` with no args), keeps looking and prefers a longer subsequent message for
 * display — but `isCommand` always reflects the true first message.
 */
export function extractFirstUserMessageInfo(filePath: string, maxLength = 140): FirstUserMessageInfo {
  if (!fs.existsSync(filePath)) return { title: null, isCommand: false };
  try {
    const content = fs.readFileSync(filePath, 'utf8');
    const candidates: string[] = [];
    for (const line of content.split('\n')) {
      if (!line.trim()) continue;
      try {
        const obj = JSON.parse(line);
        if (obj.type !== 'user' || !obj.message?.content) continue;
        // isMeta lines are Claude Code's own injections (e.g. `/context` output, compact
        // summaries) stamped onto the transcript as a "user" turn — never something the
        // user actually typed, so they're useless (and confusing) as a session title.
        if (obj.isMeta) continue;
        const msgContent = obj.message.content;
        let text: string | null = null;
        if (typeof msgContent === 'string') {
          text = stripSyntheticNoise(msgContent) || null;
        } else if (Array.isArray(msgContent)) {
          // Skip pure tool_result messages — find first block with actual text
          const hasToolResult = msgContent.some((b: { type: string }) => b.type === 'tool_result');
          if (hasToolResult) continue;
          // The IDE bolts auto-context (open file, notifications) on as an extra text
          // block alongside — not instead of — the real prompt, so strip each block and
          // take the first that still has real content left over.
          for (const b of msgContent as { type: string; text?: string }[]) {
            if (b.type !== 'text' || !b.text?.trim()) continue;
            const stripped = stripSyntheticNoise(b.text);
            if (stripped) { text = stripped; break; }
          }
        }
        if (!text) continue;
        // Pure command *output* with no invocation attached (e.g. a lone
        // <local-command-stdout> status line) isn't something the user said — skip it
        // rather than let it win as the title over a real message.
        if (/<local-command-stdout>/.test(text) && !/<command-name>/.test(text)) continue;
        const cleaned = parseSessionTitle(text).text.replace(/\s+/g, ' ').trim();
        if (!cleaned) continue;
        candidates.push(cleaned);
        if (candidates.length >= 5) break;
      } catch {}
    }
    if (candidates.length === 0) return { title: null, isCommand: false };
    const first = candidates[0];
    const isCommand = /^\/[\w-]/.test(first);
    const title = first.length >= MIN_TITLE_LEN
      ? first
      : candidates.find(c => c.length >= MIN_TITLE_LEN) ?? first;
    return {
      title: title.length > maxLength ? title.slice(0, maxLength) + '…' : title,
      isCommand,
    };
  } catch {}
  return { title: null, isCommand: false };
}

/**
 * Extracts the first human-typed user message from a session JSONL file,
 * truncated to 80 characters. Used as a readable session title fallback.
 */
export function extractFirstUserMessage(filePath: string, maxLength = 140): string | null {
  return extractFirstUserMessageInfo(filePath, maxLength).title;
}
