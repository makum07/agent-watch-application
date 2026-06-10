import { spawn } from 'child_process';
import { getDatabase } from '@/lib/db/database';
import { getWsServer } from '@/lib/websocket/ws-server';
import { FEEDBACK_CATEGORIES } from '@/types/feedback';
import type { StreamEntry } from '@/types/feedback';
import type { StreamEvent } from '@/types/events';
import type { SkillSummary, SkillDetailData, AnalysisRecommendation } from '@/types/skills';
import {
  getSkillDetail,
  getNextCycleNumber,
  createAnalysisCycle,
  updateAnalysisCycle,
  checkSelfHealingThreshold,
} from './skill-registry';

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

export function generateAnalysisPrompt(skill: SkillSummary, detail: SkillDetailData): string {
  const lines: string[] = [];
  const now = new Date().toISOString();

  lines.push(`# Skill Deep Analysis — ${formatDateShort(now)}`);
  lines.push(`\n## Skill Under Analysis\n`);
  lines.push(`| Property | Value |`);
  lines.push(`|----------|-------|`);
  lines.push(`| **Name** | \`${skill.name}\` |`);
  lines.push(`| **Project** | ${skill.project} |`);
  lines.push(`| **Version** | ${skill.version} |`);
  if (skill.description) lines.push(`| **Description** | ${skill.description} |`);
  lines.push(`| **Total Executions** | ${skill.totalExecutions} |`);
  lines.push(`| **Total Sessions** | ${skill.totalSessions} |`);
  lines.push(`| **Total Feedback Items** | ${skill.totalFeedback} |`);
  if (skill.avgDurationMs > 0) lines.push(`| **Average Duration** | ${Math.round(skill.avgDurationMs / 1000)}s |`);
  lines.push(`| **Created** | ${formatDate(skill.createdAt)} |`);
  lines.push(`| **Last Execution** | ${skill.lastExecutionAt ? formatDate(skill.lastExecutionAt) : 'Never'} |`);
  lines.push(`| **Last Analysis** | ${skill.lastAnalysisAt ? formatDate(skill.lastAnalysisAt) : 'Never'} |`);
  lines.push(`| **Analysis Date** | ${formatDate(now)} |`);

  // ─── Purpose ───
  lines.push(`\n## Purpose\n`);
  lines.push(`You are performing a **deep cross-session analysis** of the \`${skill.name}\` skill. This analysis examines **${skill.totalFeedback} feedback items** collected across **${skill.totalSessions} sessions** and **${skill.totalExecutions} executions**.\n`);
  lines.push(`Your job is to:\n`);
  lines.push(`1. Evaluate whether past improvement cycles actually fixed the issues they targeted`);
  lines.push(`2. Identify feedback items that remain unresolved (open)`);
  lines.push(`3. Detect recurring issues — problems that reappeared after a fix was applied`);
  lines.push(`4. Identify systemic gaps in the skill's workflow design`);
  lines.push(`5. Provide concrete, actionable recommendations for structural improvements\n`);
  lines.push(`**Important:** Focus on structural improvements to the skill definition and workflow design. Do not propose session-specific fixes or hardcoded rules that only apply to a particular execution.\n`);

  // ─── Improvement Cycles History (chronological, with full context) ───
  const improvementCycles = detail.improvementCycles ?? [];

  // Build addressed-by map: feedback ID → improvement cycle
  const addressedByMap = new Map<string, typeof improvementCycles[number]>();
  for (const ic of improvementCycles) {
    if (ic.status === 'completed' || ic.status === 'rewound') {
      for (const fbId of ic.feedbackIds) {
        if (!addressedByMap.has(fbId)) addressedByMap.set(fbId, ic);
      }
    }
  }

  // Build feedback lookup
  const feedbackById = new Map(detail.feedbackItems.map(f => [f.id, f]));

  // Classify feedback as open/closed
  const openFeedback = detail.feedbackItems.filter(f => !addressedByMap.has(f.id));
  const closedFeedback = detail.feedbackItems.filter(f => addressedByMap.has(f.id));

  if (improvementCycles.length > 0) {
    const sortedCycles = [...improvementCycles].sort(
      (a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime()
    );

    lines.push(`\n## Improvement Cycle History (${improvementCycles.length} cycles, chronological)\n`);
    lines.push(`These are per-session improvement cycles that have been applied to sessions using this skill. Each cycle addresses specific feedback items.\n`);

    for (const ic of sortedCycles) {
      lines.push(`### Session Improvement Cycle #${ic.cycleNumber} — ${ic.status.toUpperCase()}`);
      lines.push(`- **Date:** ${formatDate(ic.createdAt)}`);
      lines.push(`- **Session:** ${ic.sessionId.slice(0, 12)}`);
      lines.push(`- **Status:** ${ic.status}`);
      if (ic.completedAt) lines.push(`- **Completed:** ${formatDate(ic.completedAt)}`);

      // Show feedback items addressed
      if (ic.feedbackIds.length > 0) {
        lines.push(`- **Feedback Addressed (${ic.feedbackIds.length}):**`);
        for (const fbId of ic.feedbackIds) {
          const fb = feedbackById.get(fbId);
          if (fb) {
            lines.push(`  - [${formatCategory(fb.category)}] ${fb.text} *(agent: ${fb.agentName || 'unknown'}, ${formatDateShort(fb.createdAt)})*`);
          } else {
            lines.push(`  - [unresolved] Feedback ID: ${fbId.slice(0, 12)}`);
          }
        }
      }

      // Show file changes if available
      if (ic.fileChanges) {
        try {
          const changes = typeof ic.fileChanges === 'string' ? JSON.parse(ic.fileChanges) : ic.fileChanges;
          if (Array.isArray(changes) && changes.length > 0) {
            lines.push(`- **Files Changed (${changes.length}):**`);
            for (const fc of changes) {
              const type = fc.type === 'create' ? 'CREATED' : fc.type === 'delete' ? 'DELETED' : 'MODIFIED';
              lines.push(`  - ${type}: \`${fc.filePath}\` (+${fc.additions || 0}/-${fc.deletions || 0})`);
            }
          }
        } catch { /* non-fatal */ }
      }

      // Show Claude response summary if available
      if (ic.claudeResponse) {
        const summary = ic.claudeResponse.slice(0, 600);
        lines.push(`- **Claude Response Summary:** ${summary}${ic.claudeResponse.length > 600 ? '...' : ''}`);
      }

      lines.push('');
    }
  }

  // ─── Prior Skill Analysis Cycles ───
  if (detail.analysisCycles.length > 0) {
    const sortedAnalysis = [...detail.analysisCycles].sort(
      (a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime()
    );

    lines.push(`\n## Prior Skill Analysis Cycles (${detail.analysisCycles.length} cycles)\n`);
    lines.push(`These are previous skill-level analyses (like this one). Review whether prior recommendations were addressed.\n`);

    for (const cycle of sortedAnalysis) {
      lines.push(`### Skill Analysis Cycle #${cycle.cycleNumber} — ${cycle.status.toUpperCase()}`);
      lines.push(`- **Date:** ${formatDate(cycle.createdAt)}`);
      if (cycle.completedAt) lines.push(`- **Completed:** ${formatDate(cycle.completedAt)}`);
      lines.push(`- **Trigger:** ${cycle.triggerType === 'auto_threshold' ? 'Automatic (threshold)' : 'Manual'}`);
      lines.push(`- **Sessions Analyzed:** ${cycle.sessionsAnalyzed.length}`);
      lines.push(`- **Feedback Analyzed:** ${cycle.feedbackAnalyzed.length}`);

      if (cycle.recommendations && cycle.recommendations.length > 0) {
        lines.push(`- **Recommendations (${cycle.recommendations.length}):**`);
        for (const rec of cycle.recommendations) {
          lines.push(`  - [${rec.severity.toUpperCase()}] ${rec.title}: ${rec.proposedChange}`);
        }
      }

      if (cycle.analysisResponse) {
        const summary = cycle.analysisResponse.slice(0, 800);
        lines.push(`- **Analysis Summary:** ${summary}${cycle.analysisResponse.length > 800 ? '...' : ''}`);
      }

      if (cycle.fixPrompt) {
        const fixSummary = cycle.fixPrompt.slice(0, 400);
        lines.push(`- **Fix Prompt Summary:** ${fixSummary}${cycle.fixPrompt.length > 400 ? '...' : ''}`);
      }

      lines.push('');
    }
  }

  // ─── Feedback Distribution ───
  if (detail.feedbackByCategory.length > 0) {
    lines.push(`\n## Feedback Distribution Summary\n`);
    lines.push(`| Category | Count | % | Status |`);
    lines.push(`|----------|-------|---|--------|`);
    for (const fb of detail.feedbackByCategory) {
      const openCount = openFeedback.filter(f => f.category === fb.category).length;
      const closedCount = closedFeedback.filter(f => f.category === fb.category).length;
      lines.push(`| ${fb.label} | ${fb.count} | ${fb.percentage}% | ${openCount} open, ${closedCount} closed |`);
    }
  }

  // ─── Feedback by Agent ───
  if (detail.feedbackByAgent.length > 0) {
    lines.push(`\n## Feedback by Agent\n`);
    lines.push(`| Agent | Total | Open | Closed |`);
    lines.push(`|-------|-------|------|--------|`);
    for (const agent of detail.feedbackByAgent.slice(0, 15)) {
      const agentFb = detail.feedbackItems.filter(f => f.agentName === agent.agentName);
      const agentOpen = agentFb.filter(f => !addressedByMap.has(f.id)).length;
      const agentClosed = agentFb.filter(f => addressedByMap.has(f.id)).length;
      lines.push(`| ${agent.agentName} | ${agent.count} | ${agentOpen} | ${agentClosed} |`);
    }
  }

  // ─── Open Feedback Items (sorted by date, most recent first) ───
  if (openFeedback.length > 0) {
    const sorted = [...openFeedback].sort(
      (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
    );
    lines.push(`\n## Open Feedback Items (${openFeedback.length} unresolved)\n`);
    lines.push(`These feedback items have NOT been addressed by any improvement cycle. They represent outstanding issues.\n`);

    const byCategory = new Map<string, typeof sorted>();
    for (const fb of sorted) {
      if (!byCategory.has(fb.category)) byCategory.set(fb.category, []);
      byCategory.get(fb.category)!.push(fb);
    }

    for (const [cat, items] of Array.from(byCategory.entries()).sort((a, b) => b[1].length - a[1].length)) {
      lines.push(`### ${formatCategory(cat)} (${items.length} open)\n`);
      for (const item of items) {
        lines.push(`- **[${formatDate(item.createdAt)}]** ${item.text}`);
        lines.push(`  *(agent: ${item.agentName || 'unknown'}, session: ${item.sessionId.slice(0, 8)})*`);
      }
      lines.push('');
    }
  }

  // ─── Closed Feedback Items (sorted by date, showing which cycle addressed them) ───
  if (closedFeedback.length > 0) {
    const sorted = [...closedFeedback].sort(
      (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
    );
    lines.push(`\n## Closed Feedback Items (${closedFeedback.length} addressed)\n`);
    lines.push(`These feedback items were addressed by improvement cycles. Verify whether the fixes actually resolved the issues.\n`);

    for (const item of sorted.slice(0, 80)) {
      const cycle = addressedByMap.get(item.id);
      const cycleRef = cycle
        ? `Addressed by Improvement Cycle #${cycle.cycleNumber} (${formatDateShort(cycle.createdAt)}, ${cycle.status})`
        : 'Addressed by unknown cycle';
      lines.push(`- **[${formatDate(item.createdAt)}]** [${formatCategory(item.category)}] ${item.text}`);
      lines.push(`  *(agent: ${item.agentName || 'unknown'}, session: ${item.sessionId.slice(0, 8)}) — ${cycleRef}*`);
    }
    if (sorted.length > 80) {
      lines.push(`\n*...and ${sorted.length - 80} more closed items*`);
    }
    lines.push('');
  }

  // ─── Recurring Issue Detection Hints ───
  lines.push(`\n## Recurring Issue Detection\n`);
  lines.push(`Look for these patterns in the data above:\n`);

  // Find feedback categories that appear in both open and closed
  const closedCategories = new Set(closedFeedback.map(f => f.category));
  const recurringCategories = openFeedback
    .filter(f => closedCategories.has(f.category))
    .map(f => f.category);
  const uniqueRecurring = [...new Set(recurringCategories)];

  if (uniqueRecurring.length > 0) {
    lines.push(`**Categories with both open AND closed items** (potential recurring issues):`);
    for (const cat of uniqueRecurring) {
      const openCount = openFeedback.filter(f => f.category === cat).length;
      const closedCount = closedFeedback.filter(f => f.category === cat).length;
      lines.push(`- **${formatCategory(cat)}**: ${openCount} still open, ${closedCount} previously closed — investigate if the same type of issue keeps recurring`);
    }
    lines.push('');
  }

  // Find feedback items that appeared AFTER a fix cycle
  if (improvementCycles.length > 0) {
    const completedCycles = improvementCycles
      .filter(ic => ic.status === 'completed' && ic.completedAt)
      .sort((a, b) => new Date(a.completedAt!).getTime() - new Date(b.completedAt!).getTime());

    if (completedCycles.length > 0) {
      const lastCompletedTime = new Date(completedCycles[completedCycles.length - 1].completedAt!).getTime();
      const postFixFeedback = openFeedback.filter(
        f => new Date(f.createdAt).getTime() > lastCompletedTime
      );
      if (postFixFeedback.length > 0) {
        lines.push(`**${postFixFeedback.length} open feedback items appeared AFTER the last completed improvement cycle** (${formatDateShort(completedCycles[completedCycles.length - 1].completedAt!)}):`);
        for (const fb of postFixFeedback.slice(0, 10)) {
          lines.push(`- [${formatDate(fb.createdAt)}] [${formatCategory(fb.category)}] ${fb.text}`);
        }
        lines.push(`\nThis means new issues are still appearing despite prior fixes. Investigate root causes.\n`);
      }
    }
  }

  // ─── Analysis Instructions ───
  lines.push(`\n## Deep Analysis Objectives\n`);
  lines.push(`Perform a thorough analysis covering:\n`);
  lines.push(`1. **Fix Effectiveness Audit** — For each completed improvement cycle above, evaluate:`);
  lines.push(`   - Did the fix actually resolve the targeted feedback items?`);
  lines.push(`   - Were there unintended side effects?`);
  lines.push(`   - Did the same category of issue resurface after the fix?`);
  lines.push(`2. **Open Issue Triage** — For each open feedback item:`);
  lines.push(`   - Is this a genuinely new issue or a recurrence of a "fixed" problem?`);
  lines.push(`   - What is the root cause in the skill's workflow design?`);
  lines.push(`   - How critical is it? (affects all sessions vs. edge case)`);
  lines.push(`3. **Recurring Pattern Detection** — Identify feedback themes that keep appearing:`);
  lines.push(`   - Same category issues across different sessions and timeframes`);
  lines.push(`   - Issues that were "closed" but similar ones appeared later`);
  lines.push(`   - Systemic weaknesses that surface in multiple forms`);
  lines.push(`4. **Temporal Trend Analysis** — Using the timestamps:`);
  lines.push(`   - Are issues increasing, stable, or decreasing over time?`);
  lines.push(`   - Is the skill improving version over version?`);
  lines.push(`   - Are certain agents consistently producing more feedback?`);
  lines.push(`5. **Gap Analysis** — What the current skill definition is missing:`);
  lines.push(`   - Validation steps that would catch recurring issues earlier`);
  lines.push(`   - Agent coordination improvements`);
  lines.push(`   - Workflow design changes for robustness`);
  lines.push(`6. **Prioritized Recommendations** — Rank by frequency × impact\n`);

  // ─── Output Format ───
  lines.push(`\n## Output Format\n`);
  lines.push(`Structure your analysis as follows:\n`);
  lines.push(`### Executive Summary\nA 2-3 paragraph overview: skill health, key findings, trend direction.\n`);
  lines.push(`### Fix Effectiveness Report\nFor each past improvement cycle, state whether it succeeded, partially succeeded, or failed — with evidence from the feedback timeline.\n`);
  lines.push(`### Recurring Issues\nList each recurring pattern with: frequency, affected agents, when it first appeared, which fixes attempted to address it, and whether it's still active.\n`);
  lines.push(`### Open Issues Analysis\nFor each open feedback category, provide root cause analysis and severity assessment.\n`);
  lines.push(`### Prioritized Recommendations\nFor each recommendation, provide:`);
  lines.push(`- **Severity:** critical / high / medium / low`);
  lines.push(`- **Title:** Short descriptive title`);
  lines.push(`- **Root Cause:** What design weakness causes this`);
  lines.push(`- **Affected Component:** orchestrator / agent / skill / coordination`);
  lines.push(`- **Proposed Change:** Concrete improvement to the workflow or prompt`);
  lines.push(`- **Self-Correction Signal:** How agents can detect this situation in future\n`);

  lines.push(`### Suggested Fix Prompt\nProvide a detailed prompt that can be used to implement the recommended improvements. This prompt should target the skill definition, orchestrator design, agent prompts, and validation patterns. Be specific and actionable.\n`);

  lines.push(`\nAfter your analysis, output a JSON block with structured recommendations:`);
  lines.push('```json');
  lines.push(`{`);
  lines.push(`  "recommendations": [`);
  lines.push(`    {`);
  lines.push(`      "severity": "high",`);
  lines.push(`      "title": "...",`);
  lines.push(`      "rootCause": "...",`);
  lines.push(`      "affectedComponent": "...",`);
  lines.push(`      "proposedChange": "...",`);
  lines.push(`      "selfCorrectionSignal": "..."`);
  lines.push(`    }`);
  lines.push(`  ],`);
  lines.push(`  "fixPrompt": "..."`);
  lines.push(`}`);
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

    streamLog.push({
      id: `sa-${++streamIdCounter}`,
      kind: 'system',
      timestamp: Date.now(),
      text: `Starting skill analysis for "${detail.skill.name}" (${detail.skill.project})...`,
    });

    const child = spawn('claude', [
      '-p',
      '--output-format', 'stream-json',
      '--input-format', 'stream-json',
      '--verbose',
      '--model', 'claude-sonnet-4-6',
    ], {
      shell: true,
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

  try {
    updateAnalysisCycle(cycleId, { status: 'applying' });

    const child = spawn('claude', [
      '-p',
      '--output-format', 'stream-json',
      '--input-format', 'stream-json',
      '--verbose',
      '--model', 'claude-sonnet-4-6',
      '--permission-mode', 'default',
    ], {
      shell: true,
      env: { ...process.env },
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    const userMsg = JSON.stringify({
      type: 'user',
      message: { role: 'user', content: [{ type: 'text', text: fixPrompt }] },
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
