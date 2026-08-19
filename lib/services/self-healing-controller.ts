import path from 'path';
import fs from 'fs';
import { getDatabase } from '@/lib/db/database';
import { getWsServer } from '@/lib/websocket/ws-server';
import { FEEDBACK_CATEGORIES } from '@/types/feedback';
import type { SkillSummary, SkillDetailData, AnalysisRecommendation, SkillGrowthOpportunity } from '@/types/skills';
import {
  getClaudeProjectsDir,
  listProjectDirs,
  getProjectDisplayName,
} from '@/lib/parser/jsonl-parser';
import { readCwdFromJsonl } from '@/lib/parser/session-cwd';
import {
  getSkillDetail,
  getNextCycleNumber,
  createAnalysisCycle,
  updateAnalysisCycle,
  checkSelfHealingThreshold,
} from './skill-registry';
import { registerActiveCycle, unregisterActiveCycle, resolveApproval } from '@/lib/hooks/permission-state';
import { findExternalSkillDirsForSessions } from '@/lib/services/external-dirs';
import { getWslDistro } from '@/lib/sources';
import { runClaudeCliOneShot, writePermissionHookSettings } from '@/lib/services/claude-cli';
import { translateStreamEvent, createStreamLogger, createCycleBroadcaster, extractJsonFence } from '@/lib/services/cli-stream-log';

// Above this, a file's extracted text is dropped from the prompt in favor of
// a pointer to its on-disk .extracted.md sidecar (see createContextFile) —
// keeps the full content available without bloating every analysis prompt.
const CONTEXT_FILE_INLINE_THRESHOLD = 20_000;

interface DeferrableContextFile {
  extractedText: string;
  textPath: string | null;
}

function isContextFileDeferred(file: DeferrableContextFile): boolean {
  return file.extractedText.length > CONTEXT_FILE_INLINE_THRESHOLD && !!file.textPath;
}

// Directories to grant via --add-dir so the spawned analysis agent can Read
// the sidecar text of any deferred (too-large-to-inline) context file —
// skill-scoped and project-scoped files live under different directories
// (see attachments routes) so both lists are passed in and merged here.
// Left untranslated for WSL — spawnClaudeCli translates every --add-dir
// target to /mnt/<drive> itself when routing through wsl.
function getDeferredContextFileDirs(...fileLists: DeferrableContextFile[][]): string[] {
  const dirs = new Set<string>();
  for (const files of fileLists) {
    for (const file of files) {
      if (!isContextFileDeferred(file)) continue;
      dirs.add(path.dirname(file.textPath!));
    }
  }
  return [...dirs];
}

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

// Shared ordering for recommendation severity and growth-opportunity impact —
// the model doesn't reliably emit either array pre-sorted, and the UI reads
// list order as priority order.
function severityRank(level: string | undefined): number {
  switch (level) {
    case 'critical': return 0;
    case 'high': return 1;
    case 'medium': return 2;
    case 'low': return 3;
    default: return 4;
  }
}

function resolveSkillProjectCwd(projectDisplayName: string, sourceId?: string): string | null {
  try {
    const projectsDir = getClaudeProjectsDir(sourceId);
    const projectDirs = listProjectDirs(sourceId);

    for (const dirName of projectDirs) {
      if (getProjectDisplayName(dirName) !== projectDisplayName) continue;

      const metaDir = path.join(projectsDir, dirName);
      const files = fs.readdirSync(metaDir)
        .filter((f: string) => f.endsWith('.jsonl') && !f.includes('subagent'));

      for (const file of files) {
        const fp = path.join(metaDir, file);
        const cwd = readCwdFromJsonl(fp);
        if (cwd) return cwd;
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
function resolveExternalSkillDirs(skillId: string, cwd: string, sourceId?: string): string[] {
  try {
    const db = getDatabase(sourceId);
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
  lines.push(`Start by reading the skill definition file: \`.claude/skills/${skill.name}/SKILL.md\` (the current Claude Code convention), or \`.claude/skills/${skill.name}.md\` if this project predates that layout. If the skill isn't in this project's own \`.claude/skills/\`, it likely lives in an externally-referenced skills directory you've been granted access to — search there before falling back to a broader search. Understanding what the skill is designed to do is the basis for evaluating whether the historical data reveals gaps in that design.\n`);

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

  // ─── Attached context documents ─────────────────────────────────────
  // Two scopes: project-wide (shared by every skill under the same
  // project, uploaded once) and skill-specific (this skill only). Both are
  // rendered into one section so the model reasons about them together,
  // but each entry is labeled with its scope since a project-wide finding
  // (e.g. a repo-level maturity assessment) implies different things than
  // something uploaded for this one skill.

  const totalContextFiles = detail.projectContextFiles.length + detail.contextFiles.length;
  if (totalContextFiles > 0) {
    lines.push(`## Attached Context Documents (${totalContextFiles})\n`);
    lines.push(`The user attached the following document(s) as context. Some are pure background (glossaries, domain docs) — use those only to inform your understanding of purpose, domain, or audience. But if a document is itself an audit, assessment, or scorecard (e.g. an AI-maturity assessment, a code-quality review, a compliance checklist) that contains findings, gap entries, scores, or "what to do" items relevant to this skill's discipline or behavior, those are not background — they are required inputs. Extract every entry that bears on this skill specifically and treat it as a candidate finding, on equal footing with the feedback/execution data below.\n`);
    lines.push(`When you use something from a document below, cite it inline where you use it — name the document and the specific entry/condition/score (see **Output** for the exact style) — rather than only summarizing the document here in isolation.\n`);

    for (const file of detail.projectContextFiles) {
      lines.push(`### ${file.filename} — project-wide, shared across every skill in \`${skill.project}\`${isContextFileDeferred(file) ? ` (${file.extractedText.length.toLocaleString()} chars — too large to inline)` : ''}\n`);
      if (isContextFileDeferred(file)) {
        lines.push(`Full content is available at \`${file.textPath}\`. Read this file before evaluating the skill so its content informs your analysis.\n`);
      } else {
        lines.push(file.extractedText.trim());
        lines.push('');
      }
    }
    for (const file of detail.contextFiles) {
      lines.push(`### ${file.filename} — specific to this skill${isContextFileDeferred(file) ? ` (${file.extractedText.length.toLocaleString()} chars — too large to inline)` : ''}\n`);
      if (isContextFileDeferred(file)) {
        lines.push(`Full content is available at \`${file.textPath}\`. Read this file before evaluating the skill so its content informs your analysis.\n`);
      } else {
        lines.push(file.extractedText.trim());
        lines.push('');
      }
    }
  }

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
    lines.push(`Do not restate a finding below purely to repeat it. But if the historical data shows the same root cause still producing issues after a recommendation here was supposedly applied, that is a regression — surface it as high severity and note that the prior fix did not hold, rather than suppressing it as a duplicate.\n`);

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
  lines.push(`- The skill definition contains an instruction or design decision that the historical data shows consistently failing in practice`);
  lines.push(`- An attached audit/assessment document identifies a gap, unmet condition, or low score that applies to this skill's discipline (e.g. testing, delegation, verification) — cite the specific entry\n`);
  lines.push(`For each finding, identify the specific part of the skill definition that needs to change — not what went wrong in a specific session.\n`);

  // ─── Output ─────────────────────────────────────────────────────────

  lines.push(`## Output\n`);
  lines.push(`Every section below must be fully substantive whether or not a context document is attached. Documents, when present, are a supplementary lens on top of the feedback/execution history below — not a prerequisite for a useful analysis. A skill with no attached documents should get an equally thorough report, sourced entirely from its definition, feedback, and execution history.\n`);
  lines.push(`Write three sections, in this order:\n`);
  lines.push(`### 1. Current Status`);
  lines.push(`A substantive paragraph (not one line) covering: the skill's health trend (improving, stable, or degrading) with evidence from the timestamps; how reliably it is being used (execution volume, recurrence of issues, whether fixes have held); and, if an attached document scores or audits this skill's domain, where it currently sits against that framework. This is a status report someone could read without opening any recommendation.\n`);
  lines.push(`### 2. Findings & Fixes`);
  lines.push(`Surface each meaningful finding from **What to Look For** above. Each finding needs real substance, not a one-line label — explain the pattern like you're briefing someone who has not read the raw data: what is happening, why it is happening (the mechanism, not just the symptom), what evidence supports it, and how confident you are given the volume/quality of that evidence. A finding with one data point is lower confidence than one repeated across many sessions — say so. If nothing meaningful surfaces here, say so directly rather than inventing a finding to fill the section — this section is allowed to be short when the history is clean.\n`);
  lines.push(`### 3. Growth Opportunities`);
  lines.push(`Separately from bug fixes, answer: how could this skill do more, or do it better, within the software development lifecycle — not "what's broken" but "what's the ceiling, and how do we raise it." This section does not depend on a context document being attached — the primary source is the skill definition and its own execution history:`);
  lines.push(`- Structural opportunities visible in the skill definition and execution history itself: steps still gated on a human that could self-verify, output that stays local when it could feed the next stage of the pipeline automatically, or scope this skill could reasonably absorb from adjacent manual work`);
  lines.push(`- If a maturity/audit document is attached and scores this skill's discipline below its top level, or lists unmet conditions for the *next* stage up, use it as an additional lens on top of the above — describe what closing that gap would look like concretely for this skill`);
  lines.push(`Rank each opportunity high/medium/low by how much it would move this skill's reliability or SDLC contribution — this is required per opportunity, the same way severity is required per finding above.`);
  lines.push(`If nothing genuine applies, say so rather than inventing generic advice — an empty section is better than padding.\n`);
  lines.push(`### Citing attached documents`);
  lines.push(`Wherever any section above draws on an attached document, cite it inline the way you would in a written report — name the document and the specific entry, condition, sheet, or score it comes from (e.g. "per Zeroni_AI_Maturity_Assessment.xlsx, condition tst_s1_2 (Not Met), ..."), woven into the sentence, not appended as a separate checklist. That specificity is what makes it verifiable that the document was actually read rather than skimmed for keywords — a vague reference like "the maturity assessment suggests improvements" is not acceptable. If a document contains nothing applicable anywhere in this report, say so once, briefly, in Current Status — don't force a citation that isn't there.\n`);
  lines.push(`Do not make any changes to files. This is an analysis report only. Growth Opportunities are strategic and belong to the user's judgment, not \`fixPrompt\` — only Findings & Fixes recommendations that are safe, concrete file edits belong there. If Findings & Fixes has nothing to report, \`fixPrompt\` should be omitted or empty.\n`);
  lines.push(`End with:\n`);
  lines.push('```json');
  lines.push(`{"currentStatus": "...", "recommendations": [{"severity": "high|medium|low", "title": "...", "rootCause": "...", "affectedComponent": "...", "proposedChange": "...", "evidence": ["..."], "confidence": "high|medium|low", "selfCorrectionSignal": "..."}], "growthOpportunities": [{"title": "...", "currentState": "...", "targetState": "...", "rationale": "...", "sdlcImpact": "...", "suggestedChange": "...", "impact": "high|medium|low", "sourceDocument": "filename or null"}], "fixPrompt": "..."}`);
  lines.push('```');
  lines.push(`\`rootCause\` and \`proposedChange\` should each be a few sentences, matching the depth of the Current Status and Growth Opportunities prose above — not a fragment. \`evidence\` is a list of specific, citable data points backing the finding — timestamps, session IDs, counts, or a document citation in the inline style above. \`selfCorrectionSignal\` is what future execution data would confirm the fix held or reveal it didn't. \`impact\` on a growth opportunity is how much it would move this skill's reliability or SDLC contribution if pursued. \`sourceDocument\` is the filename it came from, or \`null\` if it came purely from the skill definition/execution history.`);

  return lines.join('\n');
}

export function generatePromptPreview(skillId: string, sourceId?: string): string | null {
  const detail = getSkillDetail(skillId, sourceId);
  if (!detail) return null;
  return generateAnalysisPrompt(detail.skill, detail);
}

export async function runSkillAnalysis(
  cycleId: string,
  skillId: string,
  customPrompt?: string,
  sourceId?: string
): Promise<void> {
  const db = getDatabase(sourceId);

  const broadcast = createCycleBroadcaster({ skillId, cycleId });
  const log = createStreamLogger('sa');

  try {
    broadcast('skill_analysis_started', {});

    const detail = getSkillDetail(skillId, sourceId);
    if (!detail) {
      updateAnalysisCycle(cycleId, { status: 'failed' }, sourceId);
      broadcast('skill_analysis_failed', { error: 'Skill not found' });
      return;
    }

    const prompt = customPrompt || generateAnalysisPrompt(detail.skill, detail);

    const skillCwd = resolveSkillProjectCwd(detail.skill.project, sourceId);

    log.push({
      kind: 'system',
      text: `Starting skill analysis for "${detail.skill.name}" (${detail.skill.project})${skillCwd ? ` in ${skillCwd}` : ''}...`,
    });

    const externalDirs = skillCwd ? resolveExternalSkillDirs(skillId, skillCwd, sourceId) : [];

    // WSL-sourced skill: cwd is a native Linux path — a Windows-side spawn
    // can't cd into it (cmd.exe rejects UNC paths as a cwd). Route through
    // `wsl -d <distro> -- bash -lc` so PATH additions (nvm, ~/.local/bin)
    // still resolve `claude`, same fix already proven for other flows.
    const wslDistro = getWslDistro(sourceId);

    // Deferred (too-large-to-inline) context files live on this (Windows)
    // process's disk — spawnClaudeCli translates every --add-dir target to
    // /mnt/<drive> itself when routing through wsl, so pass raw paths here.
    const contextDirs = getDeferredContextFileDirs(detail.contextFiles, detail.projectContextFiles);

    function handleStreamEvent(event: Record<string, unknown>) {
      broadcast('skill_analysis_stream_event', { event });
      for (const entry of translateStreamEvent(event)) log.push(entry);
    }

    // 10 min: the output now includes a Current Status writeup, richer
    // per-finding evidence/confidence, and a Growth Opportunities section —
    // the old 5-minute budget was tuned for a much shorter report and was
    // observed timing out mid-synthesis once the skill has an attached
    // audit document to read through.
    const ANALYSIS_TIMEOUT_MS = 10 * 60 * 1000;
    const { exitCode, timedOut, stderr, fullText: responseText } = await runClaudeCliOneShot({
      prompt,
      cwd: skillCwd || undefined,
      model: 'claude-sonnet-4-6',
      permission: { mode: 'skipPermissions' },
      externalDirs: [...externalDirs, ...contextDirs],
      wslDistro,
      timeoutMs: ANALYSIS_TIMEOUT_MS,
      onEvent: handleStreamEvent,
    });
    if (timedOut) {
      log.push({ kind: 'system', text: 'Analysis timed out after 5 minutes.' });
      updateAnalysisCycle(cycleId, {
        status: 'failed',
        analysisResponse: responseText || null,
        streamEntries: log.entries.length > 0 ? log.entries : null,
      }, sourceId);
      broadcast('skill_analysis_failed', { error: 'Analysis timed out after 5 minutes' });
      return;
    }

    if (exitCode !== 0) {
      const errorDetail = stderr.trim() || `Process exited with code ${exitCode}`;
      log.push({ kind: 'system', text: `Analysis process failed (exit code ${exitCode}): ${errorDetail.slice(0, 500)}` });
      updateAnalysisCycle(cycleId, {
        status: 'failed',
        analysisResponse: responseText || null,
        streamEntries: log.entries.length > 0 ? log.entries : null,
      }, sourceId);
      broadcast('skill_analysis_failed', { error: errorDetail.slice(0, 300) });
      return;
    }

    const fullResponse = responseText;

    let recommendations: AnalysisRecommendation[] | null = null;
    let fixPrompt: string | null = null;
    let currentStatus: string | null = null;
    let growthOpportunities: SkillGrowthOpportunity[] | null = null;
    const parsed = extractJsonFence(fullResponse);
    if (parsed) {
      if (Array.isArray(parsed.recommendations)) {
        recommendations = (parsed.recommendations as AnalysisRecommendation[])
          .sort((a, b) => severityRank(a.severity) - severityRank(b.severity));
      }
      if (typeof parsed.fixPrompt === 'string') {
        fixPrompt = parsed.fixPrompt;
      }
      if (typeof parsed.currentStatus === 'string') {
        currentStatus = parsed.currentStatus;
      }
      if (Array.isArray(parsed.growthOpportunities)) {
        growthOpportunities = (parsed.growthOpportunities as SkillGrowthOpportunity[])
          .sort((a, b) => severityRank(a.impact) - severityRank(b.impact));
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

    log.push({ kind: 'system', text: `Analysis ${finalStatus}. ${recommendations?.length ?? 0} recommendations generated.` });

    updateAnalysisCycle(cycleId, {
      analysisResponse: fullResponse,
      fixPrompt,
      recommendations,
      currentStatus,
      growthOpportunities,
      status: finalStatus,
      streamEntries: log.entries.length > 0 ? log.entries : null,
    }, sourceId);

    broadcast('skill_analysis_complete', { status: finalStatus });

    if (mode === 'fully_automatic' && fixPrompt) {
      await applySkillFix(cycleId, skillId, fixPrompt, sourceId);
    }
  } catch (err) {
    log.push({ kind: 'system', text: `Analysis failed: ${String(err)}` });

    try {
      updateAnalysisCycle(cycleId, {
        status: 'failed',
        streamEntries: log.entries.length > 0 ? log.entries : null,
      }, sourceId);
    } catch (updateErr) {
      try {
        getDatabase(sourceId).prepare('UPDATE skill_analysis_cycles SET status = ?, completed_at = ? WHERE id = ?')
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
  fixPrompt: string,
  sourceId?: string
): Promise<void> {
  const wss = getWsServer();
  const broadcast = createCycleBroadcaster({ skillId, cycleId });

  const detail = getSkillDetail(skillId, sourceId);
  const skillCwd = detail ? resolveSkillProjectCwd(detail.skill.project, sourceId) : null;

  const { settingsPath, cleanup: cleanupSettings } = writePermissionHookSettings('agentwatch-hook-skill', cycleId);

  let registeredSessionId: string | null = null;
  let unsubscribe: (() => void) | undefined;

  try {
    updateAnalysisCycle(cycleId, { status: 'applying' }, sourceId);

    const externalDirs = skillCwd ? resolveExternalSkillDirs(skillId, skillCwd, sourceId) : [];
    const wslDistro = getWslDistro(sourceId);

    unsubscribe = wss?.onClientMessage((msg: Record<string, unknown>) => {
      if (msg.type === 'permission_response' && msg.cycleId === cycleId) {
        resolveApproval(msg.requestId as string, msg.approved as boolean);
      }
    });

    function handleStreamEvent(event: Record<string, unknown>) {
      if (event.type === 'system' && typeof event.session_id === 'string' && !registeredSessionId) {
        registeredSessionId = event.session_id as string;
        registerActiveCycle(registeredSessionId, cycleId);
      }

      broadcast('skill_analysis_stream_event', { event });
    }

    // Grant Edit/Write access to the skill's real definition directory when it
    // lives outside skillCwd — otherwise the workspace-boundary check blocks
    // the edit even after the user approves it via the browser hook.
    await runClaudeCliOneShot({
      prompt: fixPrompt,
      cwd: skillCwd || undefined,
      model: 'claude-sonnet-4-6',
      permission: { mode: 'hook', settingsPath },
      externalDirs,
      wslDistro,
      onEvent: handleStreamEvent,
    });

    const db = getDatabase(sourceId);
    db.prepare('UPDATE skills SET version = version + 1, updated_at = ? WHERE id = ?').run(Date.now(), skillId);

    updateAnalysisCycle(cycleId, { status: 'completed' }, sourceId);
    broadcast('skill_analysis_complete', { status: 'completed' });
  } catch (err) {
    updateAnalysisCycle(cycleId, { status: 'failed' }, sourceId);
    broadcast('skill_analysis_failed', { error: String(err) });
  } finally {
    unsubscribe?.();
    if (registeredSessionId) unregisterActiveCycle(registeredSessionId);
    cleanupSettings();
  }
}

export async function triggerAutoAnalysis(skillId: string, sourceId?: string): Promise<void> {
  if (!checkSelfHealingThreshold(skillId, sourceId)) return;

  const detail = getSkillDetail(skillId, sourceId);
  if (!detail) return;

  const cycleNumber = getNextCycleNumber(skillId, sourceId);
  const prompt = generateAnalysisPrompt(detail.skill, detail);

  const sessionIds = [...new Set(detail.recentExecutions.map(e => e.sessionId))];
  const feedbackIds: string[] = [];

  const db = getDatabase(sourceId);
  const fbRows = db.prepare(`
    SELECT fi.id FROM feedback_items fi
    INNER JOIN skill_executions se ON fi.session_id = se.session_id AND fi.agent_id = se.agent_id
    WHERE se.skill_id = ?
  `).all(skillId) as Array<{ id: string }>;
  feedbackIds.push(...fbRows.map(r => r.id));

  const cycle = createAnalysisCycle(skillId, cycleNumber, 'auto_threshold', prompt, sessionIds, feedbackIds, sourceId);

  setImmediate(() => {
    runSkillAnalysis(cycle.id, skillId, undefined, sourceId).catch(err => {
      console.error('Auto skill analysis failed:', err);
    });
  });
}
