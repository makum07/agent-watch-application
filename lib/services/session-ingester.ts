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
import type { Session, Agent, SkillInvocation } from '@/types/session';
import { estimateAgentCost, isPermissionDenial } from '@/lib/utils';
import { registerSkillExecutions } from '@/lib/services/skill-registry';

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

  // Also re-index if any non-root agent is missing its prompt (old schema gap)
  const missingPrompt = cached
    ? (db.prepare(
        "SELECT 1 FROM agents WHERE session_id = ? AND depth > 0 AND prompt IS NULL LIMIT 1"
      ).get(sessionId) != null)
    : false;

  // Re-index if no agents have skill data but the JSONL file contains Skill calls or invoked_skills (pre-v5 gap)
  let missingSkills = false;
  if (cached) {
    const hasSkillData = db.prepare(
      "SELECT 1 FROM agents WHERE session_id = ? AND skill_invocations IS NOT NULL AND skill_invocations != '[]' LIMIT 1"
    ).get(sessionId);
    if (!hasSkillData) {
      try {
        const content = fs.readFileSync(found.filePath, 'utf8');
        missingSkills = content.includes('"name":"Skill"') || content.includes('"name": "Skill"') || content.includes('"invoked_skills"') || content.includes('"attributionSkill"');
      } catch { /* non-fatal */ }
    }
  }

  // Re-index once if error/denial accounting hasn't been computed yet (v10 gap)
  const missingErrorCounts = cached
    ? (db.prepare(
        "SELECT 1 FROM agents WHERE session_id = ? AND denied_tool_count IS NULL LIMIT 1"
      ).get(sessionId) != null)
    : false;

  const shouldReindex = !cached ||
    new Date(found.lastModified).getTime() > (cached.last_modified as number) ||
    missingPrompt ||
    missingSkills ||
    missingErrorCounts;

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
      tool_call_summary, children, depth, jsonl_path, skill_invocations,
      error_tool_count, denied_tool_count
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
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
  const agentSkillMap: Array<{ id: string; skillInvocations: SkillInvocation[] }> = [];
  for (const correlated of agents) {
    const agentId = crypto.createHash('sha256')
      .update(`${discovered.id}:${correlated.conversationId}`)
      .digest('hex')
      .slice(0, 16);
    agentIdMap.set(correlated.conversationId, agentId);
  }

  // Build a map of conversationId → parsed messages for prompt lookup
  const parsedByConvId = new Map(agents.map(a => [a.conversationId, a.parsed.messages]));

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
      let errorToolCount = 0, deniedToolCount = 0;
      let model = correlated.agentToolCall?.model || 'claude-sonnet-4-6';
      const toolCounts = new Map<string, number>();
      const skillInvocations: SkillInvocation[] = [];
      const pendingSkills = new Map<string, { skill: string; args: string | null; startTime: string }>();

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
            if (block.name === 'Skill') {
              pendingSkills.set(block.id, {
                skill: (block.input.skill as string) || 'unknown',
                args: (block.input.args as string) || null,
                startTime: msg.timestamp,
              });
            }
          }
          if (block.type === 'tool_result') {
            if (block.is_error) {
              errorToolCount++;
              const resultText = block.content
                .filter(b => b.type === 'text')
                .map(b => (b as { type: 'text'; text: string }).text)
                .join('\n');
              if (isPermissionDenial(resultText)) deniedToolCount++;
            }
            const pending = pendingSkills.get(block.tool_use_id);
            if (pending) {
              const startMs = new Date(pending.startTime).getTime();
              const endMs = new Date(msg.timestamp).getTime();
              skillInvocations.push({
                id: block.tool_use_id,
                skill: pending.skill,
                args: pending.args,
                startTime: pending.startTime,
                endTime: msg.timestamp,
                durationMs: endMs > startMs ? endMs - startMs : null,
              });
              pendingSkills.delete(block.tool_use_id);
            }
          }
        }
      }
      // Capture skills that completed without a matching tool_result
      for (const [id, pending] of pendingSkills) {
        skillInvocations.push({ id, ...pending, endTime: null, durationMs: null });
      }

      // Capture directly invoked skills (via /skill-name, appear as invoked_skills attachments)
      for (const invoked of correlated.parsed.invokedSkills) {
        const alreadyTracked = skillInvocations.some(s => s.skill === invoked.name);
        if (!alreadyTracked) {
          skillInvocations.push({
            id: crypto.createHash('sha256').update(`invoked:${discovered.id}:${invoked.name}:${invoked.timestamp || ''}`).digest('hex').slice(0, 16),
            skill: invoked.name,
            args: null,
            startTime: invoked.timestamp || correlated.parsed.firstTimestamp || new Date().toISOString(),
            endTime: null,
            durationMs: null,
          });
        }
      }

      if (skillInvocations.length > 0) {
        agentSkillMap.push({ id: agentId, skillInvocations });
      }

      const children = agents
        .filter(a => a.parentConversationId === correlated.conversationId)
        .map(a => agentIdMap.get(a.conversationId)!)
        .filter(Boolean);

      const lastMsg = msgs[msgs.length - 1];
      const response = lastMsg?.role === 'assistant'
        ? extractText(lastMsg.content).slice(0, 2000)
        : null;

      // Resolve prompt: prefer meta.json field, then look up from parent's tool_use block
      let prompt: string | null = correlated.agentToolCall?.prompt ?? null;
      if (!prompt && correlated.parentToolUseId && correlated.parentConversationId) {
        const parentMsgs = parsedByConvId.get(correlated.parentConversationId) ?? [];
        outer: for (const pmsg of parentMsgs) {
          for (const block of pmsg.content) {
            if (
              block.type === 'tool_use' &&
              block.id === correlated.parentToolUseId
            ) {
              const inp = block.input as Record<string, unknown>;
              prompt = (inp.prompt as string) || (inp.description as string) || null;
              break outer;
            }
          }
        }
      }

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
        (deniedToolCount > 0 || errorToolCount > 0) ? 'completed_with_errors' : 'completed',
        firstTimestamp ? new Date(firstTimestamp).getTime() : null,
        lastTimestamp ? new Date(lastTimestamp).getTime() : null,
        firstTimestamp && lastTimestamp
          ? new Date(lastTimestamp).getTime() - new Date(firstTimestamp).getTime()
          : 0,
        prompt,
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
        correlated.filePath,
        JSON.stringify(skillInvocations),
        errorToolCount,
        deniedToolCount
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

  // Register skill executions for cross-session skill intelligence
  if (agentSkillMap.length > 0) {
    try {
      const project = discovered.projectDisplayName || discovered.projectPath;
      registerSkillExecutions(discovered.id, project, agentSkillMap);
    } catch (err) {
      console.error('Failed to register skill executions:', err);
    }
  }
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
    status: (row.status as Agent['status']) || 'completed',
    errorToolCount: (row.error_tool_count as number) || 0,
    deniedToolCount: (row.denied_tool_count as number) || 0,
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
    skillInvocations: JSON.parse(row.skill_invocations as string || '[]'),
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
    const cost = estimateAgentCost(a.tokenUsage, a.model);
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

export function forceReindex(sessionId: string): Session | null {
  const db = getDatabase();
  const sessions = discoverSessions();
  const found = sessions.find(s => s.id === sessionId);
  if (!found) return null;

  db.prepare('DELETE FROM agents WHERE session_id = ?').run(sessionId);
  db.prepare('DELETE FROM artifacts WHERE session_id = ?').run(sessionId);
  db.prepare('DELETE FROM timeline_events WHERE session_id = ?').run(sessionId);
  db.prepare('DELETE FROM conversations WHERE id = ?').run(sessionId);

  indexSession(found, db);
  return buildSessionFromDb(sessionId, db);
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
