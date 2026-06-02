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

  const byCategory = new Map<string, number>();
  for (const item of items) {
    byCategory.set(item.category, (byCategory.get(item.category) ?? 0) + 1);
  }

  const lines: string[] = [];
  lines.push(`# Workflow Improvement Review — Cycle ${new Date().toISOString().slice(0, 10)}`);
  lines.push(`\nSession: \`${sessionId}\``);
  lines.push(`\nA structured human review of this multi-agent workflow execution has produced ${items.length} feedback item${items.length !== 1 ? 's' : ''} spanning ${byAgent.size} agent${byAgent.size !== 1 ? 's' : ''}.\n`);

  lines.push(`## Feedback Summary\n`);
  for (const [cat, count] of [...byCategory.entries()].sort((a, b) => b[1] - a[1])) {
    lines.push(`- **${formatCategory(cat)}**: ${count}`);
  }

  lines.push(`\n## Detailed Feedback by Agent\n`);
  for (const [agentId, agentItems] of byAgent.entries()) {
    const name = agentItems[0]?.agent_name || agentId.slice(0, 12);
    lines.push(`### ${name}\n`);
    for (const item of agentItems) {
      lines.push(`- **[${formatCategory(item.category)}]** ${item.text}`);
    }
    lines.push('');
  }

  const recurring = [...byCategory.entries()].filter(([, c]) => c >= 2);
  if (recurring.length) {
    lines.push(`## Recurring Patterns\n`);
    for (const [cat, count] of recurring) {
      lines.push(`- **${formatCategory(cat)}** (${count} occurrences)`);
    }
    lines.push('');
  }

  lines.push(`## Improvement Request\n`);
  lines.push(`Please analyze the workflow and propose specific, systemic improvements. Focus on durable changes to workflow design, agent instructions, and coordination patterns.\n`);
  lines.push(`Address these dimensions where feedback reveals gaps:\n`);
  lines.push(`1. **Orchestrator behavior** — delegation strategy, decision-making, coordination`);
  lines.push(`2. **Agent responsibilities** — task scoping, ownership, handoff clarity`);
  lines.push(`3. **Context gathering** — when and how agents gather context before acting`);
  lines.push(`4. **Validation patterns** — how outputs are verified, assumptions challenged`);
  lines.push(`5. **Artifact design** — completeness, structure, handoff quality`);
  lines.push(`6. **Edge case coverage** — unexpected or missing inputs`);
  lines.push(`7. **Evidence standards** — what evidence is required before drawing conclusions\n`);
  lines.push(`For each improvement, specify the affected component, what changes, why it prevents recurrence, and any new coordination steps needed.\n`);
  lines.push(`Format as a structured improvement plan that could be used to directly update agent prompts and workflow orchestration logic.`);

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
