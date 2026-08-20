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
import { translateStreamEvent, createStreamLogger, createCycleBroadcaster, extractJsonFence, extractResolvedModel, extractCliSessionId } from '@/lib/services/cli-stream-log';
import { sanitizeClaudeCliModel } from '@/lib/claude-models';

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
  lines.push(`You are analyzing the \`${skill.name}\` skill across ${skill.totalSessions} sessions and ${skill.totalExecutions} executions. Your goal is to determine what issues persist or recur despite fixes, what structural changes to the skill definition would make it more reliable, and how the skill could evolve to provide greater value in the software development lifecycle.\n`);
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
    lines.push(`The user attached the following document(s) as context. Some are pure background (glossaries, domain docs, specs) — use those only to inform your understanding of the skill's purpose, domain, or audience. If a document is itself an audit, assessment, maturity model, gap analysis, roadmap, or scorecard, route each entry relevant to this skill by what it actually is: an entry that corroborates a problem the execution/feedback history already shows happening now is a Finding; an entry describing a gap this skill could evolve to close (gap → capability this skill could develop → benefit) is a Growth Opportunity, but pick only the highest-value entries this skill can meaningfully influence — not every gap in the document; an entry that is neither yet is still worth naming in Current Status as where the skill stands against the framework. Cite specific entries inline wherever used (see **Output** for the exact style), not summarized in isolation.\n`);

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
    lines.push(`For each recommendation below, trace what happened after it: previous problem → the fix that was proposed/applied → what the executions and feedback since then actually show. Classify the outcome as worked (the issue is gone in subsequent data), partially worked (reduced but not eliminated), failed (the same root cause still produces the same issue — treat this as a regression and surface it at higher severity than a first-time finding, since a prior fix already failed to hold), or not yet evaluable (too little execution volume since the fix to tell — say so as uncertainty, not as a resolved or open finding). When a fix failed, say why in mechanism terms — too narrow, covering only one path to the root cause, or addressing the symptom the fix was aimed at rather than the underlying dependency — not just that the issue recurred. Do not restate a prior finding purely to repeat it; restate it only when this trace shows something new about whether it held.\n`);

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
  lines.push(`After reading the skill definition, use the timestamps above to reason about what is actually happening over time, not what went wrong in one session. A finding is worth surfacing when:\n`);
  lines.push(`- A feedback category persists in open items despite an improvement cycle that targeted it — the fix did not address the root cause in the skill definition`);
  lines.push(`- The same type of issue appears across multiple sessions at different times — it is structural, not incidental`);
  lines.push(`- The skill definition contains an instruction or design decision that the historical data shows consistently failing in practice`);
  lines.push(`- An attached audit/assessment document corroborates a problem already visible in the execution/feedback history (see **Attached Context Documents** above for how to use these) — cite the specific entry\n`);
  lines.push(`Weigh evidence rather than counting occurrences at face value: a pattern repeated across many sessions over time is stronger evidence than the same count seen once in a single session. Treat the absence of feedback as uncertainty, not as a signal of quality — a skill with few executions or little feedback has not been proven good, it has simply not been exercised enough to tell, and that distinction belongs in Current Status rather than being silently skipped or turned into an unearned finding. Do not manufacture a finding just because something could theoretically be improved with no evidence it currently is a problem — that belongs in Growth Opportunities, if anywhere. For each real finding, name the specific part of the skill definition that needs to change, explain the root cause (the mechanism producing the symptom, not just the symptom), and explain why the proposed change addresses that root cause rather than papering over the symptom.\n`);

  // ─── Output ─────────────────────────────────────────────────────────

  lines.push(`## Output\n`);
  lines.push(`Every section below must be fully substantive whether or not a context document is attached. Documents, when present, are a supplementary lens on top of the feedback/execution history below — not a prerequisite for a useful analysis. A skill with no attached documents should get an equally thorough report, sourced entirely from its definition, feedback, and execution history.\n`);
  lines.push(`Write three sections, in this order:\n`);
  lines.push(`### 1. Current Status`);
  lines.push(`A substantive paragraph (not one line) covering: the skill's health trend (improving, stable, degrading, or indeterminate — use indeterminate rather than stable when volume is too thin to support a trend) with evidence from the timestamps; how reliably it is being used (execution volume, recurrence of issues, whether fixes have held); and, if an attached document scores or audits this skill's domain, where it currently sits against that framework, including any relevant entry that named neither a Finding nor a Growth Opportunity. This is a status report someone could read without opening any recommendation.\n`);
  lines.push(`### 2. Findings & Fixes`);
  lines.push(`Surface each meaningful finding from **What to Look For** above, each paired with a concrete fix. Each finding needs real substance, not a one-line label — explain the pattern like you're briefing someone who has not read the raw data: what is happening, why (the mechanism, not the symptom), the evidence behind it, your confidence, and — where a prior recommendation targeted the same area — whether it worked, partially worked, failed, or can't yet be evaluated. If nothing meaningful surfaces, say so directly; this section is allowed to be short when the history is clean.\n`);
  lines.push(`### 3. Growth Opportunities`);
  lines.push(`This section is forward-looking, not a second pass over history: it evaluates the skill's current capability and purpose against its potential — helped, when attached, by an audit/assessment's direction for it (see **Attached Context Documents** above for how entries get routed here) — not against what has gone wrong. Execution history plays a supporting role only: use it to validate that an opportunity is feasible, or to show where the skill has already demonstrated room to grow — not to re-surface a Findings & Fixes item under a new name. Consider its reasoning and context-gathering, how it verifies its own output, what artifacts or handoffs it produces for downstream work, where it could automate a step still gated on a human, and how well it closes the loop back into future runs — only where genuinely grounded in what this skill does, not as a checklist to fill.`);
  lines.push(`Rank each opportunity high/medium/low by how much it would move this skill's reliability or SDLC contribution — this is required per opportunity, the same way severity is required per finding above.`);
  lines.push(`If nothing genuine applies, say so rather than inventing generic advice — an empty section is better than padding.\n`);
  lines.push(`### Citing attached documents`);
  lines.push(`Wherever any section above draws on an attached document, cite it inline the way you would in a written report — name the document and the specific entry, condition, sheet, or score it comes from (e.g. "per MaturityAssessment.xlsx, condition 3.2 (Not Met), ..."), woven into the sentence, not appended as a separate checklist. That specificity is what makes it verifiable that the document was actually read rather than skimmed for keywords — a vague reference like "the maturity assessment suggests improvements" is not acceptable. If a document contains nothing applicable anywhere in this report, say so once, briefly, in Current Status — don't force a citation that isn't there.\n`);
  lines.push(`Do not make any changes to files. This is an analysis report only. Growth Opportunities are strategic and belong to the user's judgment, not \`fixPrompt\` — only Findings & Fixes recommendations that are safe, concrete file edits belong there. If \`recommendations\` has more than one entry, \`fixPrompt\` must implement all of them together, not just the first or highest-severity one. If Findings & Fixes has nothing to report, \`fixPrompt\` should be omitted or empty.\n`);
  lines.push(`End with:\n`);
  lines.push('```json');
  lines.push(`{"currentStatus": "...", "recommendations": [{"severity": "high|medium|low", "title": "...", "rootCause": "...", "affectedComponent": "...", "proposedChange": "...", "evidence": ["..."], "confidence": "high|medium|low", "selfCorrectionSignal": "..."}], "growthOpportunities": [{"title": "...", "currentState": "...", "targetState": "...", "rationale": "...", "sdlcImpact": "...", "suggestedChange": "...", "impact": "high|medium|low", "sourceDocument": "filename or null"}], "fixPrompt": "..."}`);
  lines.push('```');
  lines.push(`\`rootCause\` and \`proposedChange\` should each be a few sentences, matching the depth of the Current Status and Growth Opportunities prose above — not a fragment. \`rootCause\` should name the mechanism producing the symptom (including, if applicable, why an earlier fix in this area didn't hold), and \`proposedChange\` should make clear why this change addresses that mechanism rather than the surface symptom. \`evidence\` is a list of specific, citable data points backing the finding — timestamps, session IDs, counts, or a document citation in the inline style above; weight repeated evidence over an isolated instance. \`selfCorrectionSignal\` is a concrete, observable signal in future execution data that would confirm the fix held or reveal it didn't. \`impact\` on a growth opportunity is how much it would move this skill's reliability or SDLC contribution if pursued. \`sourceDocument\` is the filename it came from, or \`null\` if it came purely from the skill definition/execution history.`);

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
  sourceId?: string,
  model?: string
): Promise<void> {
  const db = getDatabase(sourceId);
  const resolvedModel = sanitizeClaudeCliModel(model);

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
      const resolvedActualModel = extractResolvedModel(event);
      const cliSessionId = extractCliSessionId(event);
      if (resolvedActualModel || cliSessionId) {
        updateAnalysisCycle(cycleId, { model: resolvedActualModel, cliSessionId }, sourceId);
      }
      for (const entry of translateStreamEvent(event)) log.push(entry);
    }

    // 10 min: the output now includes a Current Status writeup, richer
    // per-finding evidence/confidence, and a Growth Opportunities section —
    // the old 5-minute budget was tuned for a much shorter report and was
    // observed timing out mid-synthesis once the skill has an attached
    // audit document to read through.
    const ANALYSIS_TIMEOUT_MS = 10 * 60 * 1000;
    const { exitCode, timedOut, stderr, fullText: responseText, cancelled } = await runClaudeCliOneShot({
      prompt,
      cwd: skillCwd || undefined,
      model: resolvedModel,
      permission: { mode: 'skipPermissions' },
      externalDirs: [...externalDirs, ...contextDirs],
      wslDistro,
      timeoutMs: ANALYSIS_TIMEOUT_MS,
      onEvent: handleStreamEvent,
      jobId: cycleId,
    });

    if (cancelled) {
      log.push({ kind: 'system', text: 'Analysis stopped by user.' });
      updateAnalysisCycle(cycleId, {
        status: 'cancelled',
        analysisResponse: responseText || null,
        streamEntries: log.entries.length > 0 ? log.entries : null,
      }, sourceId);
      broadcast('skill_analysis_failed', { error: 'Stopped by user', cancelled: true });
      return;
    }

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
      await applySkillFix(cycleId, skillId, fixPrompt, sourceId, resolvedModel);
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
  sourceId?: string,
  model?: string
): Promise<void> {
  const resolvedModel = sanitizeClaudeCliModel(model);
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

      const resolvedActualModel = extractResolvedModel(event);
      const cliSessionId = extractCliSessionId(event);
      if (resolvedActualModel || cliSessionId) {
        updateAnalysisCycle(cycleId, { model: resolvedActualModel, cliSessionId }, sourceId);
      }

      broadcast('skill_analysis_stream_event', { event });
    }

    // Grant Edit/Write access to the skill's real definition directory when it
    // lives outside skillCwd — otherwise the workspace-boundary check blocks
    // the edit even after the user approves it via the browser hook.
    const { cancelled } = await runClaudeCliOneShot({
      prompt: fixPrompt,
      cwd: skillCwd || undefined,
      model: resolvedModel,
      permission: { mode: 'hook', settingsPath },
      externalDirs,
      wslDistro,
      onEvent: handleStreamEvent,
      jobId: cycleId,
    });

    if (cancelled) {
      updateAnalysisCycle(cycleId, { status: 'cancelled' }, sourceId);
      broadcast('skill_analysis_failed', { error: 'Stopped by user', cancelled: true });
      return;
    }

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
