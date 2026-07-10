import { spawn } from 'child_process';
import path from 'path';
import fs from 'fs';
import os from 'os';
import { getDatabase } from '@/lib/db/database';
import { getWsServer } from '@/lib/websocket/ws-server';
import { FEEDBACK_CATEGORIES } from '@/types/feedback';
import type { StreamEntry } from '@/types/feedback';
import type { SkillSummary, SkillDetailData, AnalysisRecommendation } from '@/types/skills';
import {
  getClaudeProjectsDir,
  listProjectDirs,
  getProjectDisplayName,
} from '@/lib/parser/jsonl-parser';
import {
  getSkillDetail,
  getNextCycleNumber,
  createAnalysisCycle,
  updateAnalysisCycle,
  checkSelfHealingThreshold,
} from './skill-registry';
import { registerActiveCycle, unregisterActiveCycle, resolveApproval } from '@/lib/hooks/permission-state';
import { findExternalSkillDirsForSessions } from '@/lib/services/external-dirs';

function formatCategory(cat: string): string {
  const meta = FEEDBACK_CATEGORIES.find(c => c.value === cat);
  return meta?.label ?? cat.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
}

function formatDate(iso: string): string {
  const d = new Date(iso);
  return d.toISOString().slice(0, 19).replace('T', ' ') + ' UTC';
}

function formatDateShort(iso: string): string {
  return new Date(iso).toISOString().slice(0, 10);
}

function resolveSkillProjectCwd(projectDisplayName: string): string | null {
  try {
    const projectsDir = getClaudeProjectsDir();
    const projectDirs = listProjectDirs();

    for (const dirName of projectDirs) {
      if (getProjectDisplayName(dirName) !== projectDisplayName) continue;

      const metaDir = path.join(projectsDir, dirName);
      const files = fs.readdirSync(metaDir)
        .filter((f: string) => f.endsWith('.jsonl') && !f.includes('subagent'));

      for (const file of files) {
        const fp = path.join(metaDir, file);
        const fd = fs.openSync(fp, 'r');
        const buf = Buffer.alloc(4096);
        const bytesRead = fs.readSync(fd, buf, 0, 4096, 0);
        fs.closeSync(fd);
        const chunk = buf.toString('utf8', 0, bytesRead);
        const match = chunk.match(/"cwd"\s*:\s*"([^"]+)"/);
        if (match) {
          return match[1].replace(/\\\\/g, '\\');
        }
      }
    }
  } catch { /* non-fatal */ }
  return null;
}

// A skill's definition file can live in a different project directory than
// the ones its executions ran in (e.g. a shared skills/agents repo added via
// `claude --add-dir`). Since analysis and fix application spawn a fresh `-p`
// process with no memory of that grant, rediscover the external directories
// from the JSONL of every session that has executed this skill and pass them
// back via `--add-dir` — otherwise Edit/Write on the real definition file is
// blocked by Claude Code's workspace boundary regardless of hook approval.
function resolveExternalSkillDirs(skillId: string, cwd: string): string[] {
  try {
    const db = getDatabase();
    const sessionIds = db.prepare(
      'SELECT DISTINCT session_id FROM skill_executions WHERE skill_id = ?'
    ).all(skillId) as Array<{ session_id: string }>;

    const jsonlPaths: string[] = [];
    for (const { session_id } of sessionIds) {
      const conv = db.prepare('SELECT file_path FROM conversations WHERE id = ?').get(session_id) as { file_path: string } | undefined;
      if (conv?.file_path) jsonlPaths.push(conv.file_path);
    }

    return findExternalSkillDirsForSessions(jsonlPaths, cwd);
  } catch {
    return [];
  }
}

export function generateAnalysisPrompt(skill: SkillSummary, detail: SkillDetailData): string {
  const lines: string[] = [];
  const now = new Date().toISOString();

  // ─── Purpose ───────────────────────────────────────────────────────

  lines.push(`# Skill Analysis — \`${skill.name}\` — ${formatDateShort(now)}\n`);
  lines.push(`You are analyzing the \`${skill.name}\` skill across ${skill.totalSessions} sessions and ${skill.totalExecutions} executions. Your goal is to determine what issues persist, what recurs despite fixes, and what structural changes to the skill definition would make it more reliable.\n`);
  lines.push(`Start by reading the skill definition file: \`.claude/skills/${skill.name}.md\` (or the equivalent in this project). Understanding what the skill is designed to do is the basis for evaluating whether the historical data reveals gaps in that design.\n`);

  // ─── Skill metadata ─────────────────────────────────────────────────

  lines.push(`## Skill\n`);
  lines.push(`| | |`);
  lines.push(`|---|---|`);
  lines.push(`| Name | \`${skill.name}\` |`);
  lines.push(`| Project | ${skill.project} |`);
  lines.push(`| Version | ${skill.version} |`);
  if (skill.description) lines.push(`| Description | ${skill.description} |`);
  lines.push(`| Executions | ${skill.totalExecutions} across ${skill.totalSessions} sessions |`);
  lines.push(`| Total Feedback | ${skill.totalFeedback} items |`);
  if (skill.avgDurationMs > 0) lines.push(`| Avg Duration | ${Math.round(skill.avgDurationMs / 1000)}s |`);
  lines.push(`| Created | ${formatDate(skill.createdAt)} |`);
  lines.push(`| Last Execution | ${skill.lastExecutionAt ? formatDate(skill.lastExecutionAt) : 'Never'} |`);
  lines.push(`| Last Analysis | ${skill.lastAnalysisAt ? formatDate(skill.lastAnalysisAt) : 'Never'} |`);
  lines.push('');

  // ─── Compute open/closed classification ────────────────────────────

  const improvementCycles = detail.improvementCycles ?? [];
  const addressedByMap = new Map<string, typeof improvementCycles[number]>();
  for (const ic of improvementCycles) {
    if (ic.status === 'completed' || ic.status === 'rewound') {
      for (const fbId of ic.feedbackIds) {
        if (!addressedByMap.has(fbId)) addressedByMap.set(fbId, ic);
      }
    }
  }
  const feedbackById = new Map(detail.feedbackItems.map(f => [f.id, f]));
  const openFeedback = detail.feedbackItems.filter(f => !addressedByMap.has(f.id));
  const closedFeedback = detail.feedbackItems.filter(f => addressedByMap.has(f.id));

  // ─── Improvement cycle history (chronological) ─────────────────────

  if (improvementCycles.length > 0) {
    const sortedCycles = [...improvementCycles].sort(
      (a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime()
    );
    lines.push(`## Improvement Cycles (${improvementCycles.length})\n`);

    for (const ic of sortedCycles) {
      lines.push(`### Cycle #${ic.cycleNumber} — ${ic.status.toUpperCase()} — ${formatDate(ic.createdAt)}`);
      if (ic.completedAt) lines.push(`Completed: ${formatDate(ic.completedAt)}`);
      lines.push(`Session: ${ic.sessionId.slice(0, 12)}`);

      if (ic.feedbackIds.length > 0) {
        lines.push(`Targeted (${ic.feedbackIds.length}):`);
        for (const fbId of ic.feedbackIds) {
          const fb = feedbackById.get(fbId);
          if (fb) lines.push(`- [${formatCategory(fb.category)}] ${fb.text} *(${fb.agentName || 'unknown'}, ${formatDateShort(fb.createdAt)})*`);
          else lines.push(`- [ref] ${fbId.slice(0, 12)}`);
        }
      }

      if (ic.claudeResponse) {
        lines.push(`Response: ${ic.claudeResponse.slice(0, 3000)}${ic.claudeResponse.length > 3000 ? '…' : ''}`);
      }
      lines.push('');
    }
  }

  // ─── Prior skill analyses ───────────────────────────────────────────

  if (detail.analysisCycles.length > 0) {
    const sortedAnalysis = [...detail.analysisCycles].sort(
      (a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime()
    );
    lines.push(`## Prior Skill Analyses (${detail.analysisCycles.length})\n`);
    lines.push(`Do not duplicate findings already recommended here.\n`);

    for (const cycle of sortedAnalysis) {
      lines.push(`### Analysis #${cycle.cycleNumber} — ${formatDate(cycle.createdAt)}`);
      lines.push(`${cycle.status} | ${cycle.triggerType === 'auto_threshold' ? 'automatic' : 'manual'} | ${cycle.sessionsAnalyzed.length} sessions, ${cycle.feedbackAnalyzed.length} feedback items`);

      if (cycle.recommendations && cycle.recommendations.length > 0) {
        for (const rec of cycle.recommendations) {
          lines.push(`- [${rec.severity}] ${rec.title}: ${rec.proposedChange}`);
        }
      }
      if (cycle.analysisResponse) {
        lines.push(`Summary: ${cycle.analysisResponse.slice(0, 400)}${cycle.analysisResponse.length > 400 ? '…' : ''}`);
      }
      lines.push('');
    }
  }

  // ─── Feedback overview ──────────────────────────────────────────────

  if (detail.feedbackByCategory.length > 0) {
    lines.push(`## Feedback by Category\n`);
    lines.push(`| Category | Total | Open | Closed |`);
    lines.push(`|----------|-------|------|--------|`);
    for (const fb of detail.feedbackByCategory) {
      const openCount = openFeedback.filter(f => f.category === fb.category).length;
      const closedCount = closedFeedback.filter(f => f.category === fb.category).length;
      lines.push(`| ${fb.label} | ${fb.count} | ${openCount} | ${closedCount} |`);
    }
    lines.push('');
  }

  if (detail.feedbackByAgent.length > 0) {
    lines.push(`## Feedback by Agent\n`);
    lines.push(`| Agent | Total | Open | Closed |`);
    lines.push(`|-------|-------|------|--------|`);
    for (const agent of detail.feedbackByAgent.slice(0, 15)) {
      const agentFb = detail.feedbackItems.filter(f => f.agentName === agent.agentName);
      const agentOpen = agentFb.filter(f => !addressedByMap.has(f.id)).length;
      const agentClosed = agentFb.filter(f => addressedByMap.has(f.id)).length;
      lines.push(`| ${agent.agentName} | ${agent.count} | ${agentOpen} | ${agentClosed} |`);
    }
    lines.push('');
  }

  // ─── Open feedback (timestamped, grouped by category) ──────────────

  if (openFeedback.length > 0) {
    const sorted = [...openFeedback].sort(
      (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
    );
    lines.push(`## Open Feedback (${openFeedback.length} unaddressed)\n`);
    const byCategory = new Map<string, typeof sorted>();
    for (const fb of sorted) {
      if (!byCategory.has(fb.category)) byCategory.set(fb.category, []);
      byCategory.get(fb.category)!.push(fb);
    }
    for (const [cat, items] of Array.from(byCategory.entries()).sort((a, b) => b[1].length - a[1].length)) {
      lines.push(`### ${formatCategory(cat)} (${items.length})\n`);
      for (const item of items) {
        lines.push(`- [${formatDate(item.createdAt)}] ${item.text} *(${item.agentName || 'unknown'}, session ${item.sessionId.slice(0, 8)})*`);
      }
      lines.push('');
    }
  }

  // ─── Addressed feedback (with cycle refs for fix-effectiveness) ─────

  if (closedFeedback.length > 0) {
    const sorted = [...closedFeedback].sort(
      (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
    );
    lines.push(`## Addressed Feedback (${closedFeedback.length})\n`);
    lines.push(`Use timestamps: if the same category reappears in Open Feedback above after being closed here, the fix did not hold.\n`);
    for (const item of sorted.slice(0, 80)) {
      const cycle = addressedByMap.get(item.id);
      const ref = cycle ? `Cycle #${cycle.cycleNumber} (${formatDateShort(cycle.createdAt)}, ${cycle.status})` : 'unknown cycle';
      lines.push(`- [${formatDate(item.createdAt)}] [${formatCategory(item.category)}] ${item.text} *(${item.agentName || 'unknown'}) — ${ref}*`);
    }
    if (sorted.length > 80) lines.push(`\n…and ${sorted.length - 80} more`);
    lines.push('');
  }

  // ─── Pre-computed temporal signals ─────────────────────────────────

  const closedCategories = new Set(closedFeedback.map(f => f.category));
  const recurringCats = [...new Set(openFeedback.filter(f => closedCategories.has(f.category)).map(f => f.category))];
  if (recurringCats.length > 0) {
    lines.push(`## Recurrence Signal\n`);
    lines.push(`Categories with both addressed AND currently open items — fixes in these categories did not hold:\n`);
    for (const cat of recurringCats) {
      const openCount = openFeedback.filter(f => f.category === cat).length;
      const closedCount = closedFeedback.filter(f => f.category === cat).length;
      lines.push(`- **${formatCategory(cat)}**: ${openCount} still open, ${closedCount} previously addressed`);
    }
    lines.push('');
  }

  if (improvementCycles.length > 0) {
    const completedCycles = improvementCycles
      .filter(ic => ic.status === 'completed' && ic.completedAt)
      .sort((a, b) => new Date(a.completedAt!).getTime() - new Date(b.completedAt!).getTime());

    if (completedCycles.length > 0) {
      const lastCompletedAt = completedCycles[completedCycles.length - 1].completedAt!;
      const postFixFeedback = openFeedback.filter(
        f => new Date(f.createdAt).getTime() > new Date(lastCompletedAt).getTime()
      );
      if (postFixFeedback.length > 0) {
        lines.push(`**${postFixFeedback.length} open item(s) appeared after the last improvement cycle (${formatDateShort(lastCompletedAt)}) — new issues, not yet addressed:**\n`);
        for (const fb of postFixFeedback.slice(0, 10)) {
          lines.push(`- [${formatDate(fb.createdAt)}] [${formatCategory(fb.category)}] ${fb.text}`);
        }
        lines.push('');
      }
    }
  }

  // ─── What constitutes a finding worth surfacing ─────────────────────

  lines.push(`## What to Look For\n`);
  lines.push(`After reading the skill definition, use the timestamps above to reason about what is actually happening over time. A finding is worth surfacing when:\n`);
  lines.push(`- A feedback category persists in open items despite an improvement cycle that targeted it — the fix did not address the root cause in the skill definition`);
  lines.push(`- The same type of issue appears across multiple sessions at different times — it is structural, not incidental`);
  lines.push(`- The skill definition contains an instruction or design decision that the historical data shows consistently failing in practice\n`);
  lines.push(`For each finding, identify the specific part of the skill definition that needs to change — not what went wrong in a specific session.\n`);

  // ─── Output ─────────────────────────────────────────────────────────

  lines.push(`## Output\n`);
  lines.push(`Describe the skill's health trend (improving, stable, or degrading) with evidence from the timestamps. Then surface each meaningful finding: what the pattern is, what the timeline shows, and what specific change to the skill definition would address it.\n`);
  lines.push(`Do not make any changes to files. This is an analysis report only.\n`);
  lines.push(`End with:\n`);
  lines.push('```json');
  lines.push(`{"recommendations": [{"severity": "high|medium|low", "title": "...", "rootCause": "...", "affectedComponent": "...", "proposedChange": "..."}], "fixPrompt": "..."}`);
  lines.push('```');

  return lines.join('\n');
}

export function generatePromptPreview(skillId: string): string | null {
  const detail = getSkillDetail(skillId);
  if (!detail) return null;
  return generateAnalysisPrompt(detail.skill, detail);
}

export async function runSkillAnalysis(
  cycleId: string,
  skillId: string,
  customPrompt?: string
): Promise<void> {
  const wss = getWsServer();
  const db = getDatabase();

  const broadcast = (type: string, payload: Record<string, unknown>) => {
    wss?.broadcast({ type, skillId, cycleId, ...payload } as never);
  };

  const streamLog: StreamEntry[] = [];
  let streamIdCounter = 0;

  try {
    broadcast('skill_analysis_started', {});

    const detail = getSkillDetail(skillId);
    if (!detail) {
      updateAnalysisCycle(cycleId, { status: 'failed' });
      broadcast('skill_analysis_failed', { error: 'Skill not found' });
      return;
    }

    const prompt = customPrompt || generateAnalysisPrompt(detail.skill, detail);

    const skillCwd = resolveSkillProjectCwd(detail.skill.project);

    streamLog.push({
      id: `sa-${++streamIdCounter}`,
      kind: 'system',
      timestamp: Date.now(),
      text: `Starting skill analysis for "${detail.skill.name}" (${detail.skill.project})${skillCwd ? ` in ${skillCwd}` : ''}...`,
    });

    const externalDirs = skillCwd ? resolveExternalSkillDirs(skillId, skillCwd) : [];

    const cliArgs = [
      '-p',
      '--output-format', 'stream-json',
      '--input-format', 'stream-json',
      '--verbose',
      '--model', 'claude-sonnet-4-6',
      '--dangerously-skip-permissions',
    ];

    // Paths must be quoted — shell: true splits on spaces otherwise.
    for (const dir of externalDirs) {
      cliArgs.push('--add-dir', `"${dir}"`);
    }

    const child = spawn('claude', cliArgs, {
      shell: true,
      cwd: skillCwd || undefined,
      env: { ...process.env },
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    const userMsg = JSON.stringify({
      type: 'user',
      message: { role: 'user', content: [{ type: 'text', text: prompt }] },
    });
    child.stdin.write(userMsg + '\n', 'utf8');
    child.stdin.end();

    const responseChunks: string[] = [];
    let stdoutBuffer = '';

    function handleStreamEvent(line: string) {
      let event: Record<string, unknown>;
      try { event = JSON.parse(line); } catch { return; }

      broadcast('skill_analysis_stream_event', { event });

      const eventType = event.type as string;

      if (eventType === 'assistant') {
        const msg = event.message as {
          content?: Array<{ type: string; text?: string; thinking?: string; id?: string; name?: string; input?: Record<string, unknown> }>;
        } | undefined;
        if (!msg?.content) return;

        for (const block of msg.content) {
          if (block.type === 'text' && block.text) {
            responseChunks.push(block.text);
            streamLog.push({
              id: `sa-${++streamIdCounter}`,
              kind: 'text',
              timestamp: Date.now(),
              text: block.text,
            });
          }
          if (block.type === 'thinking' && block.thinking) {
            streamLog.push({
              id: `sa-${++streamIdCounter}`,
              kind: 'thinking',
              timestamp: Date.now(),
              text: block.thinking,
            });
          }
          if (block.type === 'tool_use') {
            streamLog.push({
              id: `sa-${++streamIdCounter}`,
              kind: 'tool_use',
              timestamp: Date.now(),
              toolName: block.name,
              toolInput: block.input,
              toolUseId: block.id,
            });
          }
        }
      }

      if (eventType === 'user') {
        const userMsg = event.message as { content?: Array<{ type: string; tool_use_id?: string; content?: string; is_error?: boolean }> };
        if (userMsg?.content) {
          for (const block of userMsg.content) {
            if (block.type === 'tool_result') {
              streamLog.push({
                id: `sa-${++streamIdCounter}`,
                kind: 'tool_result',
                timestamp: Date.now(),
                toolUseId: block.tool_use_id,
                content: typeof block.content === 'string' ? block.content : JSON.stringify(block.content),
                isError: block.is_error ?? false,
              });
            }
          }
        }
      }
    }

    child.stdout.on('data', (chunk: Buffer) => {
      stdoutBuffer += chunk.toString();
      const lines = stdoutBuffer.split('\n');
      stdoutBuffer = lines.pop() ?? '';
      for (const line of lines) {
        if (line.trim()) handleStreamEvent(line.trim());
      }
    });

    let stderr = '';
    child.stderr.on('data', (chunk: Buffer) => {
      stderr += chunk.toString();
    });

    const ANALYSIS_TIMEOUT_MS = 5 * 60 * 1000;
    const exitCode = await new Promise<number>((resolve) => {
      const timer = setTimeout(() => {
        try { child.kill(); } catch { /* already dead */ }
        resolve(124);
      }, ANALYSIS_TIMEOUT_MS);

      child.on('close', (code) => { clearTimeout(timer); resolve(code ?? 0); });
      child.on('error', () => { clearTimeout(timer); resolve(1); });
    });

    if (stdoutBuffer.trim()) {
      handleStreamEvent(stdoutBuffer.trim());
    }

    if (exitCode === 124) {
      streamLog.push({
        id: `sa-${++streamIdCounter}`,
        kind: 'system',
        timestamp: Date.now(),
        text: 'Analysis timed out after 5 minutes.',
      });
      updateAnalysisCycle(cycleId, {
        status: 'failed',
        analysisResponse: responseChunks.join('') || null,
        streamEntries: streamLog.length > 0 ? streamLog : null,
      });
      broadcast('skill_analysis_failed', { error: 'Analysis timed out after 5 minutes' });
      return;
    }

    if (exitCode !== 0) {
      const errorDetail = stderr.trim() || `Process exited with code ${exitCode}`;
      streamLog.push({
        id: `sa-${++streamIdCounter}`,
        kind: 'system',
        timestamp: Date.now(),
        text: `Analysis process failed (exit code ${exitCode}): ${errorDetail.slice(0, 500)}`,
      });
      updateAnalysisCycle(cycleId, {
        status: 'failed',
        analysisResponse: responseChunks.join('') || null,
        streamEntries: streamLog.length > 0 ? streamLog : null,
      });
      broadcast('skill_analysis_failed', { error: errorDetail.slice(0, 300) });
      return;
    }

    const fullResponse = responseChunks.join('');

    let recommendations: AnalysisRecommendation[] | null = null;
    let fixPrompt: string | null = null;
    const jsonMatch = fullResponse.match(/```json\s*([\s\S]*?)```/);
    if (jsonMatch) {
      try {
        const parsed = JSON.parse(jsonMatch[1]);
        if (Array.isArray(parsed.recommendations)) {
          recommendations = parsed.recommendations;
        }
        if (typeof parsed.fixPrompt === 'string') {
          fixPrompt = parsed.fixPrompt;
        }
      } catch {
        // Failed to parse JSON — non-fatal
      }
    }

    const skillMode = db.prepare('SELECT self_healing_mode FROM skills WHERE id = ?').get(skillId) as { self_healing_mode: string } | undefined;
    const mode = skillMode?.self_healing_mode ?? 'analysis_only';

    let finalStatus: 'completed' | 'awaiting_review' = 'completed';
    if (mode === 'analysis_and_fix' && fixPrompt) {
      finalStatus = 'awaiting_review';
    } else if (mode === 'fully_automatic' && fixPrompt) {
      finalStatus = 'awaiting_review';
    }

    streamLog.push({
      id: `sa-${++streamIdCounter}`,
      kind: 'system',
      timestamp: Date.now(),
      text: `Analysis ${finalStatus}. ${recommendations?.length ?? 0} recommendations generated.`,
    });

    updateAnalysisCycle(cycleId, {
      analysisResponse: fullResponse,
      fixPrompt,
      recommendations,
      status: finalStatus,
      streamEntries: streamLog.length > 0 ? streamLog : null,
    });

    broadcast('skill_analysis_complete', { status: finalStatus });

    if (mode === 'fully_automatic' && fixPrompt) {
      await applySkillFix(cycleId, skillId, fixPrompt);
    }
  } catch (err) {
    streamLog.push({
      id: `sa-${++streamIdCounter}`,
      kind: 'system',
      timestamp: Date.now(),
      text: `Analysis failed: ${String(err)}`,
    });

    try {
      updateAnalysisCycle(cycleId, {
        status: 'failed',
        streamEntries: streamLog.length > 0 ? streamLog : null,
      });
    } catch (updateErr) {
      try {
        getDatabase().prepare('UPDATE skill_analysis_cycles SET status = ?, completed_at = ? WHERE id = ?')
          .run('failed', Date.now(), cycleId);
      } catch { /* best effort */ }
      console.error('Failed to update analysis cycle:', updateErr);
    }
    broadcast('skill_analysis_failed', { error: String(err) });
  }
}

export async function applySkillFix(
  cycleId: string,
  skillId: string,
  fixPrompt: string
): Promise<void> {
  const wss = getWsServer();

  const broadcast = (type: string, payload: Record<string, unknown>) => {
    wss?.broadcast({ type, skillId, cycleId, ...payload } as never);
  };

  const detail = getSkillDetail(skillId);
  const skillCwd = detail ? resolveSkillProjectCwd(detail.skill.project) : null;

  const port = String(process.env.PORT || 3000);
  const hookSettings = {
    hooks: {
      PreToolUse: [{
        matcher: 'Edit|Write',
        hooks: [{
          type: 'http',
          url: `http://localhost:${port}/api/v2/hooks/permission`,
          timeout: 600,
        }],
      }],
    },
  };
  const settingsPath = path.join(os.tmpdir(), `agentwatch-hook-skill-${cycleId}.json`);
  fs.writeFileSync(settingsPath, JSON.stringify(hookSettings), 'utf8');

  let registeredSessionId: string | null = null;
  let unsubscribe: (() => void) | undefined;

  try {
    updateAnalysisCycle(cycleId, { status: 'applying' });

    const externalDirs = skillCwd ? resolveExternalSkillDirs(skillId, skillCwd) : [];

    const cliArgs = [
      '-p',
      '--output-format', 'stream-json',
      '--input-format', 'stream-json',
      '--verbose',
      '--model', 'claude-sonnet-4-6',
      '--permission-mode', 'default',
      '--settings', `"${settingsPath}"`,
      '--include-hook-events',
    ];

    // Grant Edit/Write access to the skill's real definition directory when it
    // lives outside skillCwd — otherwise the workspace-boundary check blocks
    // the edit even after the user approves it via the browser hook.
    for (const dir of externalDirs) {
      cliArgs.push('--add-dir', `"${dir}"`);
    }

    const child = spawn('claude', cliArgs, {
      shell: true,
      cwd: skillCwd || undefined,
      env: { ...process.env },
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    const userMsg = JSON.stringify({
      type: 'user',
      message: { role: 'user', content: [{ type: 'text', text: fixPrompt }] },
    });
    child.stdin.write(userMsg + '\n', 'utf8');
    child.stdin.end();

    unsubscribe = wss?.onClientMessage((msg: Record<string, unknown>) => {
      if (msg.type === 'permission_response' && msg.cycleId === cycleId) {
        resolveApproval(msg.requestId as string, msg.approved as boolean);
      }
    });

    const responseChunks: string[] = [];
    let stdoutBuffer = '';

    function handleStreamEvent(line: string) {
      let event: Record<string, unknown>;
      try { event = JSON.parse(line); } catch { return; }

      if (event.type === 'system' && typeof event.session_id === 'string' && !registeredSessionId) {
        registeredSessionId = event.session_id as string;
        registerActiveCycle(registeredSessionId, cycleId);
      }

      broadcast('skill_analysis_stream_event', { event });

      const eventType = event.type as string;
      if (eventType === 'assistant') {
        const msg = event.message as {
          content?: Array<{ type: string; text?: string }>;
        } | undefined;
        if (!msg?.content) return;
        for (const block of msg.content) {
          if (block.type === 'text' && block.text) {
            responseChunks.push(block.text);
          }
        }
      }
    }

    child.stdout.on('data', (chunk: Buffer) => {
      stdoutBuffer += chunk.toString();
      const lines = stdoutBuffer.split('\n');
      stdoutBuffer = lines.pop() ?? '';
      for (const line of lines) {
        if (line.trim()) handleStreamEvent(line.trim());
      }
    });

    await new Promise<number>((resolve) => {
      child.on('close', (code) => resolve(code ?? 0));
      child.on('error', () => resolve(1));
    });

    if (stdoutBuffer.trim()) {
      handleStreamEvent(stdoutBuffer.trim());
    }

    const db = getDatabase();
    db.prepare('UPDATE skills SET version = version + 1, updated_at = ? WHERE id = ?').run(Date.now(), skillId);

    updateAnalysisCycle(cycleId, { status: 'completed' });
    broadcast('skill_analysis_complete', { status: 'completed' });
  } catch (err) {
    updateAnalysisCycle(cycleId, { status: 'failed' });
    broadcast('skill_analysis_failed', { error: String(err) });
  } finally {
    unsubscribe?.();
    if (registeredSessionId) unregisterActiveCycle(registeredSessionId);
    try { fs.unlinkSync(settingsPath); } catch { /* already cleaned */ }
  }
}

export async function triggerAutoAnalysis(skillId: string): Promise<void> {
  if (!checkSelfHealingThreshold(skillId)) return;

  const detail = getSkillDetail(skillId);
  if (!detail) return;

  const cycleNumber = getNextCycleNumber(skillId);
  const prompt = generateAnalysisPrompt(detail.skill, detail);

  const sessionIds = [...new Set(detail.recentExecutions.map(e => e.sessionId))];
  const feedbackIds: string[] = [];

  const db = getDatabase();
  const fbRows = db.prepare(`
    SELECT fi.id FROM feedback_items fi
    INNER JOIN skill_executions se ON fi.session_id = se.session_id AND fi.agent_id = se.agent_id
    WHERE se.skill_id = ?
  `).all(skillId) as Array<{ id: string }>;
  feedbackIds.push(...fbRows.map(r => r.id));

  const cycle = createAnalysisCycle(skillId, cycleNumber, 'auto_threshold', prompt, sessionIds, feedbackIds);

  setImmediate(() => {
    runSkillAnalysis(cycle.id, skillId).catch(err => {
      console.error('Auto skill analysis failed:', err);
    });
  });
}
