import path from 'path';
import fs from 'fs';
import {
  parseJsonlFile,
  type ParsedConversation,
} from './jsonl-parser';

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

  // 2c. Infer conceptual delegation for depth-1 coordinator agents.
  //     When a coordinator (B) can't use the Agent tool (filtered at depth 1),
  //     the orchestrator spawns sub-agents on its behalf. We detect this by:
  //     - Identifying "coordinator" agents from their description/prompt
  //     - Matching downstream agents via topic keywords + temporal proximity
  inferDelegation(result, rootId);

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

/**
 * Infer conceptual delegation when depth-1 "coordinator" agents couldn't
 * actually spawn sub-agents (Agent tool filtered out at depth 1).
 *
 * Heuristic: if agent B's description/prompt contains "coordinator" or
 * "coordinate" and agent C was spawned later by the orchestrator with
 * overlapping topic keywords, re-parent C under B.
 */
function inferDelegation(agents: CorrelatedAgent[], rootId: string): void {
  const root = agents.find(a => a.conversationId === rootId);
  if (!root) return;

  // Collect spawn timestamps from root's tool_use blocks
  const spawnOrder: { toolUseId: string; timestamp: string; description: string; prompt: string }[] = [];
  for (const msg of root.parsed.messages) {
    for (const block of msg.content) {
      if (block.type === 'tool_use' && (block.name === 'Agent' || block.name === 'Task')) {
        const input = block.input as Record<string, unknown>;
        spawnOrder.push({
          toolUseId: block.id,
          timestamp: msg.timestamp,
          description: (input.description as string) || '',
          prompt: (input.prompt as string) || '',
        });
      }
    }
  }

  // Map toolUseId → agent for quick lookup
  const byToolUseId = new Map<string, CorrelatedAgent>();
  for (const a of agents) {
    if (a.parentToolUseId) byToolUseId.set(a.parentToolUseId, a);
  }

  // Identify coordinator agents: description or prompt contains "coordinator" or "coordinate"
  const coordinatorPattern = /\bcoordinat(?:or|e|ing)\b/i;
  const coordinators: { agent: CorrelatedAgent; spawnIdx: number; keywords: string[] }[] = [];

  for (let i = 0; i < spawnOrder.length; i++) {
    const spawn = spawnOrder[i];
    const desc = spawn.description;
    const prompt = spawn.prompt;
    if (!coordinatorPattern.test(desc) && !coordinatorPattern.test(prompt)) continue;

    const agent = byToolUseId.get(spawn.toolUseId);
    if (!agent || agent.parentConversationId !== rootId) continue;

    // Extract topic keywords from description (before the em-dash)
    const keywords = extractTopicKeywords(desc);
    if (keywords.length > 0) {
      coordinators.push({ agent, spawnIdx: i, keywords });
    }
  }

  if (coordinators.length === 0) return;

  let changed = false;

  // For each coordinator, find subsequent agents that belong to it.
  // Strategy: match agents that the coordinator's prompt explicitly names as
  // sub-agents it intends to spawn. Fall back to keyword + temporal heuristics
  // only when the candidate is NOT explicitly a same-level peer.
  for (const coord of coordinators) {
    const nextCoordIdx = coordinators.find(c => c.spawnIdx > coord.spawnIdx)?.spawnIdx ?? spawnOrder.length;
    const coordSpawn = spawnOrder[coord.spawnIdx];

    // Extract the coordinator's own level from its prompt (e.g., "[Level 1 coordinator]")
    const coordLevel = extractLevel(coordSpawn.prompt);

    // Extract sub-agent names/descriptions the coordinator's prompt says it will spawn
    const expectedSubAgents = extractExpectedSubAgents(coordSpawn.prompt);

    for (let i = coord.spawnIdx + 1; i < nextCoordIdx; i++) {
      const spawn = spawnOrder[i];
      const candidate = byToolUseId.get(spawn.toolUseId);
      if (!candidate || candidate.parentConversationId !== rootId) continue;

      // Don't re-parent other coordinators
      if (coordinatorPattern.test(spawn.description)) continue;

      // Guard: skip if the candidate's prompt explicitly marks it as the same
      // level as the coordinator (e.g., both say "[Level 1]")
      const candidateLevel = extractLevel(spawn.prompt);
      if (coordLevel !== null && candidateLevel !== null && candidateLevel <= coordLevel) continue;

      // Guard: skip if the candidate explicitly says it does NOT spawn sub-agents
      // — that means it's an independent worker, not delegated coordination work
      if (/\bdo\s+not\s+spawn\s+sub[- ]?agents?\b/i.test(spawn.prompt)) continue;

      // Strategy 1: coordinator prompt explicitly names this agent as a sub-agent
      if (expectedSubAgents.length > 0) {
        const descLower = spawn.description.toLowerCase();
        const isExpected = expectedSubAgents.some(name =>
          descLower.includes(name.toLowerCase()) || name.toLowerCase().includes(descLower.split(/\s[—–-]\s/)[0].toLowerCase().trim())
        );
        if (isExpected) {
          candidate.parentConversationId = coord.agent.conversationId;
          changed = true;
          continue;
        }
      }

      // Strategy 2: keyword overlap (require 2+ matches to avoid false positives
      // from common words like "test")
      const candidateWords = extractTopicKeywords(spawn.description);
      const overlap = coord.keywords.filter(k =>
        candidateWords.some(ck => ck === k || ck.includes(k) || k.includes(ck))
      );

      if (overlap.length >= 2) {
        candidate.parentConversationId = coord.agent.conversationId;
        changed = true;
        continue;
      }

      // Strategy 3: temporal window — only when the coordinator's prompt mentions
      // spawning sub-agents AND neither the level guard nor explicit-non-spawner
      // guard blocked it (those guards already returned above if applicable)
      const mentionsSubAgents = /\b(spawn|sub-?agent|level[- ]?2|coordinate\s+two|orchestrate)\b/i.test(coordSpawn.prompt);
      if (mentionsSubAgents && overlap.length >= 1) {
        candidate.parentConversationId = coord.agent.conversationId;
        changed = true;
      }
    }
  }

  if (!changed) return;

  // Recompute depths via BFS
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

function extractLevel(prompt: string): number | null {
  const match = prompt.match(/\[Level[- ]?(\d+)/i);
  return match ? parseInt(match[1], 10) : null;
}

function extractExpectedSubAgents(prompt: string): string[] {
  // Look for patterns like "Sub-agent C: Schema Metadata Agent" or
  // "spawn ... <AgentName> Agent" in the coordinator's prompt
  const names: string[] = [];
  const subAgentPattern = /sub-?agent\s*\w*:\s*\*?\*?([^*\n[\]]+?)(?:\*?\*?\s*\[|\s*$)/gim;
  let m;
  while ((m = subAgentPattern.exec(prompt)) !== null) {
    const name = m[1].trim();
    if (name.length > 3 && name.length < 60) names.push(name);
  }
  return names;
}

function extractTopicKeywords(description: string): string[] {
  return description
    .toLowerCase()
    .replace(/\[.*?\]/g, '')
    .split(/[\s,.:;—–\-]+/)
    .filter(w => w.length > 2)
    .filter(w => ![
      'the', 'and', 'for', 'agent', 'coordinator', 'coordinate', 'general',
      'purpose', 'get', 'collect', 'gather', 'build', 'create', 'draft',
      'check', 'verify', 'write', 'independent', 'comprehensive', 'overview',
    ].includes(w));
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
