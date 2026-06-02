import path from 'path';
import fs from 'fs';
import crypto from 'crypto';
import type Database from 'better-sqlite3';
import { getDatabase } from '@/lib/db/database';
import {
  parseJsonlFile,
  extractAgentToolCalls,
  listProjectDirs,
  listJsonlFiles,
  decodeProjectPath,
  getProjectDisplayName,
  getClaudeProjectsDir,
} from '@/lib/parser/jsonl-parser';
import { correlateAgents, extractAiTitle } from '@/lib/parser/agent-correlator';
import { extractArtifacts } from '@/lib/parser/artifact-extractor';
import type { Session, Agent } from '@/types/session';

const MODEL_PRICING: Record<string, { input: number; output: number; cacheWrite: number; cacheRead: number }> = {
  'claude-opus-4-8': { input: 15, output: 75, cacheWrite: 18.75, cacheRead: 1.5 },
  'claude-opus-4-6': { input: 15, output: 75, cacheWrite: 18.75, cacheRead: 1.5 },
  'claude-sonnet-4-6': { input: 3, output: 15, cacheWrite: 3.75, cacheRead: 0.3 },
  'claude-haiku-4-5': { input: 0.8, output: 4, cacheWrite: 1, cacheRead: 0.08 },
  'claude-3-5-sonnet': { input: 3, output: 15, cacheWrite: 3.75, cacheRead: 0.3 },
  'claude-3-5-haiku': { input: 0.8, output: 4, cacheWrite: 1, cacheRead: 0.08 },
};

function estimateCost(model: string, input: number, output: number, cacheCreation: number, cacheRead: number): number {
  const pricing = MODEL_PRICING[model] || MODEL_PRICING['claude-sonnet-4-6'];
  return (
    (input * pricing.input) / 1_000_000 +
    (output * pricing.output) / 1_000_000 +
    (cacheCreation * pricing.cacheWrite) / 1_000_000 +
    (cacheRead * pricing.cacheRead) / 1_000_000
  );
}

export interface DiscoveredSession {
  id: string;
  filePath: string;
  projectDir: string;
  projectPath: string;
  projectDisplayName: string;
  created: string;
  lastModified: string;
}

export function discoverSessions(): DiscoveredSession[] {
  const projectsDir = getClaudeProjectsDir();
  if (!fs.existsSync(projectsDir)) return [];

  const sessions: DiscoveredSession[] = [];
  const projectDirs = listProjectDirs();

  for (const dirName of projectDirs) {
    const projectDir = path.join(projectsDir, dirName);
    const projectPath = decodeProjectPath(dirName);
    const projectDisplayName = getProjectDisplayName(dirName);
    const files = listJsonlFiles(projectDir);

    for (const filePath of files) {
      try {
        const stat = fs.statSync(filePath);
        const id = path.basename(filePath, '.jsonl');
        sessions.push({
          id,
          filePath,
          projectDir,
          projectPath,
          projectDisplayName,
          created: stat.birthtime.toISOString(),
          lastModified: stat.mtime.toISOString(),
        });
      } catch {
        continue;
      }
    }
  }

  return sessions.sort((a, b) => new Date(b.lastModified).getTime() - new Date(a.lastModified).getTime());
}

export function ingestSession(sessionId: string): Session | null {
  const db = getDatabase();

  const cached = db.prepare('SELECT * FROM conversations WHERE id = ?').get(sessionId) as Record<string, unknown> | undefined;

  const sessions = discoverSessions();
  const found = sessions.find(s => s.id === sessionId);

  if (!found) {
    if (cached) {
      return buildSessionFromDb(sessionId, db);
    }
    return null;
  }

  const shouldReindex = !cached ||
    new Date(found.lastModified).getTime() > (cached.last_modified as number);

  if (shouldReindex) {
    try {
      indexSession(found, db);
    } catch (err) {
      console.error(`Failed to index session ${sessionId}:`, err);
    }
  }

  return buildSessionFromDb(sessionId, db);
}

function indexSession(discovered: DiscoveredSession, db: Database.Database) {
  const agents = correlateAgents(discovered.filePath, discovered.projectDir);

  db.prepare(`
    INSERT OR REPLACE INTO conversations (id, project, created, last_modified, file_path, status)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(
    discovered.id,
    discovered.projectDisplayName || discovered.projectPath,
    new Date(discovered.created).getTime(),
    new Date(discovered.lastModified).getTime(),
    discovered.filePath,
    'completed'
  );

  if (agents.length === 0) return;

  const rootAgent = agents[0];

  db.prepare('DELETE FROM agents WHERE session_id = ?').run(discovered.id);
  db.prepare('DELETE FROM artifacts WHERE session_id = ?').run(discovered.id);
  db.prepare('DELETE FROM timeline_events WHERE session_id = ?').run(discovered.id);

  const insertAgent = db.prepare(`
    INSERT OR REPLACE INTO agents (
      id, session_id, conversation_id, parent_id, parent_conversation_id, tool_use_id,
      type, subagent_type, model, status, start_time, end_time, duration_ms,
      prompt, description, response, schema_json, isolation,
      message_count, tokens_input, tokens_output, tokens_cache_creation, tokens_cache_read, tokens_total,
      tool_call_summary, children, depth, jsonl_path
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  const insertArtifact = db.prepare(`
    INSERT OR REPLACE INTO artifacts (
      id, session_id, agent_id, type, file_path, tool_name, timestamp,
      content_preview, content_size, created_by, modified_by, consumed_by
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  const insertTimeline = db.prepare(`
    INSERT INTO timeline_events (session_id, agent_id, event_type, timestamp, details)
    VALUES (?, ?, ?, ?, ?)
  `);

  const agentIdMap = new Map<string, string>();
  for (const correlated of agents) {
    const agentId = crypto.createHash('sha256')
      .update(`${discovered.id}:${correlated.conversationId}`)
      .digest('hex')
      .slice(0, 16);
    agentIdMap.set(correlated.conversationId, agentId);
  }

  const insertAll = db.transaction(() => {
    for (const correlated of agents) {
      const agentId = agentIdMap.get(correlated.conversationId)!;
      const parentId = correlated.parentConversationId
        ? agentIdMap.get(correlated.parentConversationId) ?? null
        : null;

      const msgs = correlated.parsed.messages;
      const firstTimestamp = correlated.parsed.firstTimestamp;
      const lastTimestamp = correlated.parsed.lastTimestamp;

      let totalInput = 0, totalOutput = 0, totalCacheCreate = 0, totalCacheRead = 0;
      let model = correlated.agentToolCall?.model || 'claude-sonnet-4-6';
      const toolCounts = new Map<string, number>();

      for (const msg of msgs) {
        if (msg.tokenUsage) {
          totalInput += msg.tokenUsage.input;
          totalOutput += msg.tokenUsage.output;
          totalCacheCreate += msg.tokenUsage.cacheCreation;
          totalCacheRead += msg.tokenUsage.cacheRead;
        }
        if (msg.model) model = msg.model;
        for (const block of msg.content) {
          if (block.type === 'tool_use') {
            toolCounts.set(block.name, (toolCounts.get(block.name) || 0) + 1);
          }
        }
      }

      const children = agents
        .filter(a => a.parentConversationId === correlated.conversationId)
        .map(a => agentIdMap.get(a.conversationId)!)
        .filter(Boolean);

      const lastMsg = msgs[msgs.length - 1];
      const response = lastMsg?.role === 'assistant'
        ? extractText(lastMsg.content).slice(0, 2000)
        : null;

      insertAgent.run(
        agentId,
        discovered.id,
        correlated.conversationId,
        parentId,
        correlated.parentConversationId,
        correlated.parentToolUseId,
        correlated.depth === 0 ? 'orchestrator' : (correlated.workflowRunId ? 'workflow' : 'subagent'),
        correlated.agentToolCall?.agentType ?? correlated.agentToolCall?.subagentType ?? null,
        model,
        'completed',
        firstTimestamp ? new Date(firstTimestamp).getTime() : null,
        lastTimestamp ? new Date(lastTimestamp).getTime() : null,
        firstTimestamp && lastTimestamp
          ? new Date(lastTimestamp).getTime() - new Date(firstTimestamp).getTime()
          : 0,
        correlated.agentToolCall?.prompt ?? null,
        correlated.agentLabel ?? correlated.agentToolCall?.description ?? null,
        response,
        null, // schema (not tracked for new format)
        null, // isolation (not tracked for new format)
        msgs.length,
        totalInput,
        totalOutput,
        totalCacheCreate,
        totalCacheRead,
        totalInput + totalOutput + totalCacheCreate + totalCacheRead,
        JSON.stringify(Array.from(toolCounts.entries()).map(([name, count]) => ({ name, count }))),
        JSON.stringify(children),
        correlated.depth,
        correlated.filePath  // actual JSONL path for this agent
      );

      if (firstTimestamp) {
        insertTimeline.run(discovered.id, agentId, 'agent_start', new Date(firstTimestamp).getTime(), '{}');
      }
      if (lastTimestamp) {
        insertTimeline.run(discovered.id, agentId, 'agent_end', new Date(lastTimestamp).getTime(), '{}');
      }

      const artifacts = extractArtifacts(msgs, agentId, discovered.id);
      for (const artifact of artifacts) {
        insertArtifact.run(
          artifact.id,
          artifact.sessionId,
          artifact.agentId,
          artifact.type,
          artifact.filePath,
          artifact.toolName,
          new Date(artifact.timestamp).getTime(),
          artifact.contentPreview,
          artifact.contentSize,
          artifact.agentId,
          '[]',
          '[]'
        );
      }
    }
  });

  insertAll();
}

function buildSessionFromDb(sessionId: string, db: Database.Database): Session | null {
  const conv = db.prepare('SELECT * FROM conversations WHERE id = ?').get(sessionId) as Record<string, unknown> | undefined;
  if (!conv) return null;

  const agentRows = db.prepare('SELECT * FROM agents WHERE session_id = ?').all(sessionId) as Record<string, unknown>[];

  const agents: Agent[] = agentRows.map(row => ({
    id: row.id as string,
    sessionId: row.session_id as string,
    conversationId: row.conversation_id as string,
    parentId: row.parent_id as string | null,
    parentConversationId: row.parent_conversation_id as string | null,
    toolUseId: row.tool_use_id as string | null,
    type: row.type as 'orchestrator' | 'subagent' | 'workflow',
    subagentType: row.subagent_type as string | null,
    model: row.model as string || 'claude-sonnet-4-6',
    status: row.status as 'completed',
    startTime: row.start_time ? new Date(row.start_time as number).toISOString() : new Date().toISOString(),
    endTime: row.end_time ? new Date(row.end_time as number).toISOString() : null,
    durationMs: row.duration_ms as number || 0,
    prompt: row.prompt as string | null,
    description: row.description as string | null,
    response: row.response as string | null,
    schema: row.schema_json ? JSON.parse(row.schema_json as string) : null,
    isolation: row.isolation as 'worktree' | null,
    messageCount: row.message_count as number || 0,
    tokenUsage: {
      input: row.tokens_input as number || 0,
      output: row.tokens_output as number || 0,
      cacheCreation: row.tokens_cache_creation as number || 0,
      cacheRead: row.tokens_cache_read as number || 0,
      total: row.tokens_total as number || 0,
    },
    toolCalls: JSON.parse(row.tool_call_summary as string || '[]'),
    children: JSON.parse(row.children as string || '[]'),
    depth: row.depth as number || 0,
  }));

  const rootAgent = agents.find(a => a.parentId === null) || agents[0];

  const totalTokens = agents.reduce((sum, a) => sum + a.tokenUsage.total, 0);
  const totalToolCalls = agents.reduce((sum, a) =>
    sum + a.toolCalls.reduce((s, t) => s + t.count, 0), 0);

  const modelCounts = new Map<string, number>();
  for (const a of agents) {
    modelCounts.set(a.model, (modelCounts.get(a.model) || 0) + a.tokenUsage.total);
  }
  const primaryModel = [...modelCounts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] || 'claude-sonnet-4-6';

  const startTime = rootAgent?.startTime ? new Date(rootAgent.startTime).getTime() : Date.now();
  const endTimes = agents.filter(a => a.endTime).map(a => new Date(a.endTime!).getTime());
  const endTime = endTimes.length ? Math.max(...endTimes) : startTime;
  const wallClock = endTime - startTime;
  const agentTime = agents.reduce((sum, a) => sum + a.durationMs, 0);

  const costByModel: Record<string, number> = {};
  for (const a of agents) {
    const cost = estimateCost(a.model, a.tokenUsage.input, a.tokenUsage.output, a.tokenUsage.cacheCreation, a.tokenUsage.cacheRead);
    costByModel[a.model] = (costByModel[a.model] || 0) + cost;
  }
  const totalCost = Object.values(costByModel).reduce((s, c) => s + c, 0);

  return {
    id: sessionId,
    project: conv.project as string,
    created: conv.created ? new Date(conv.created as number).toISOString() : new Date().toISOString(),
    lastModified: conv.last_modified ? new Date(conv.last_modified as number).toISOString() : new Date().toISOString(),
    status: 'completed',
    totalMessages: agents.reduce((s, a) => s + a.messageCount, 0),
    totalTokens,
    totalAgents: agents.length,
    totalToolCalls,
    primaryModel,
    duration: {
      wallClock,
      agentTime,
      parallelismFactor: wallClock > 0 ? agentTime / wallClock : 1,
    },
    estimatedCost: { total: totalCost, byModel: costByModel },
    agents,
    rootAgentId: rootAgent?.id || '',
  };
}

function extractText(content: import('@/types/session').ContentBlock[]): string {
  return content
    .filter(b => b.type === 'text')
    .map(b => (b as { type: 'text'; text: string }).text)
    .join('\n');
}

export function getAgentMessages(sessionId: string, agentId: string, page = 0, limit = 50) {
  const db = getDatabase();

  const agent = db.prepare('SELECT conversation_id, session_id, jsonl_path FROM agents WHERE id = ?').get(agentId) as
    | { conversation_id: string; session_id: string; jsonl_path?: string }
    | undefined;

  if (!agent || agent.session_id !== sessionId) return null;

  // Primary: use stored jsonl_path (correct for both root agents and subagents)
  let convPath: string;
  if (agent.jsonl_path && fs.existsSync(agent.jsonl_path)) {
    convPath = agent.jsonl_path;
  } else {
    // Fallback: derive from conversations table (works for root orchestrator only)
    const conv = db.prepare('SELECT file_path FROM conversations WHERE id = ?').get(sessionId) as
      | { file_path: string }
      | undefined;
    if (!conv) return null;
    const projectDir = path.dirname(conv.file_path);
    convPath = path.join(projectDir, `${agent.conversation_id}.jsonl`);
  }

  if (!fs.existsSync(convPath)) {
    return { messages: [], total: 0, hasMore: false, page };
  }

  const parsed = parseJsonlFile(convPath);
  const start = page * limit;
  const paginated = parsed.messages.slice(start, start + limit);

  return {
    messages: paginated,
    total: parsed.messages.length,
    hasMore: start + limit < parsed.messages.length,
    page,
  };
}
