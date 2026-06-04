import { NextRequest, NextResponse } from 'next/server';
import { getDatabase } from '@/lib/db/database';

interface DbFeedbackItem {
  id: string;
  session_id: string;
  agent_id: string;
  category: string;
  text: string;
  agent_name: string | null;
}

function formatCategory(c: string) {
  return c.split('_').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');
}

function buildPrompt(sessionId: string, items: DbFeedbackItem[]): string {
  const byAgent = new Map<string, DbFeedbackItem[]>();
  for (const item of items) {
    if (!byAgent.has(item.agent_id)) byAgent.set(item.agent_id, []);
    byAgent.get(item.agent_id)!.push(item);
  }

  const byCategory = new Map<string, DbFeedbackItem[]>();
  for (const item of items) {
    if (!byCategory.has(item.category)) byCategory.set(item.category, []);
    byCategory.get(item.category)!.push(item);
  }

  const sortedCategories = Array.from(byCategory.entries()).sort((a, b) => b[1].length - a[1].length);

  const lines: string[] = [];
  lines.push(`# Multi-Agent Workflow Design Review — ${new Date().toISOString().slice(0, 10)}`);
  lines.push(`\nSession: \`${sessionId}\``);

  lines.push(`\n## Purpose\n`);
  lines.push(`This review presents structured observations from a completed multi-agent workflow execution. The goal is **not** to patch individual failures or encode session-specific rules. The goal is to evolve the design of the workflow itself — updating orchestrator logic, agent responsibilities, skill definitions, and reasoning patterns so that all components can independently recognize and handle similar situations across any future execution.\n`);
  lines.push(`**Constraint: Do not introduce hardcoded fixes, task-specific rules, or logic that only applies to the inputs or artifacts of this session.** Every proposed change must remain correct and beneficial across future workflow executions with entirely different tasks, contexts, and inputs.\n`);

  lines.push(`## Observed Failure Patterns (${items.length} observation${items.length !== 1 ? 's' : ''} across ${byAgent.size} agent${byAgent.size !== 1 ? 's' : ''})\n`);
  lines.push(`Observations are grouped by failure type to surface structural patterns rather than individual agent mistakes:\n`);

  for (const [cat, catItems] of sortedCategories) {
    lines.push(`### ${formatCategory(cat)} (${catItems.length})\n`);
    for (const item of catItems) {
      const agentLabel = item.agent_name || item.agent_id.slice(0, 12);
      lines.push(`- ${item.text} *(context: ${agentLabel})*`);
    }
    lines.push('');
  }

  const recurringCategories = sortedCategories.filter(([, catItems]) => catItems.length >= 2);
  if (recurringCategories.length > 0) {
    lines.push(`## Cross-Agent Patterns\n`);
    lines.push(`These failure types appeared in multiple agents, indicating systemic weaknesses in workflow design rather than isolated mistakes:\n`);
    for (const [cat, catItems] of recurringCategories) {
      const agentNames = [...new Set(catItems.map(i => i.agent_name || i.agent_id.slice(0, 12)))];
      lines.push(`- **${formatCategory(cat)}** — ${catItems.length} observations across: ${agentNames.join(', ')}`);
    }
    lines.push('');
  }

  lines.push(`## Improvement Request\n`);
  lines.push(`For each observed failure pattern, analyze the workflow design and produce a targeted improvement. Structure each improvement as follows:\n`);
  lines.push(`1. **Root cause** — What workflow design weakness caused this class of failure? Identify what is missing or incorrect in the agent's instructions, reasoning approach, validation logic, or coordination design that would cause any agent to make this type of mistake.`);
  lines.push(`2. **Affected component** — Which component should change: the orchestrator's logic, a specific agent type's responsibilities or reasoning patterns, a skill definition, or a coordination mechanism?`);
  lines.push(`3. **Proposed change** — Write a concrete addition or modification to that component's system prompt or behavioral contract. Specify exactly what the agent should do, when, and under what conditions.`);
  lines.push(`4. **Self-correction signal** — How should the agent recognize mid-execution that it may be in a situation similar to what triggered this feedback? What uncertainty indicator or evidence gap should prompt it to re-verify before proceeding?`);
  lines.push(`5. **Generalizability check** — Confirm this change applies correctly across future executions with different inputs and contexts. If it would only help for tasks similar to this session, rethink from the root cause.\n`);

  lines.push(`Address the following dimensions where the observations reveal gaps:\n`);
  lines.push(`- **Orchestrator design** — task decomposition, agent selection, delegation scope, and completion verification`);
  lines.push(`- **Agent reasoning patterns** — hypothesis formation, confidence assessment, and evidence thresholds before acting`);
  lines.push(`- **Validation and self-correction** — how agents challenge their own outputs and detect errors before returning results`);
  lines.push(`- **Context and evidence gathering** — what context to proactively seek and when to pause and verify rather than proceed`);
  lines.push(`- **Skill and capability usage** — correct invocation timing, scope, and error handling`);
  lines.push(`- **Artifact and output quality** — completeness and accuracy standards before an output is considered ready`);
  lines.push(`- **Coordination and handoffs** — what must be explicitly transferred and verified at each agent boundary\n`);

  lines.push(`Produce one improvement entry per failure pattern. Each entry should contain a concrete system prompt addition or behavioral change applicable directly to the relevant workflow component. The output should read as a set of workflow design changes — not a post-mortem of this execution.`);

  return lines.join('\n');
}

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id: sessionId } = await params;
    const db = getDatabase();
    const items = db.prepare(
      `SELECT * FROM feedback_items WHERE session_id = ? ORDER BY created_at ASC`
    ).all(sessionId) as DbFeedbackItem[];

    if (items.length === 0) {
      return NextResponse.json({ error: 'No feedback items' }, { status: 400 });
    }

    return NextResponse.json({ prompt: buildPrompt(sessionId, items) });
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
