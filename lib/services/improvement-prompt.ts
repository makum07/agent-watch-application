export interface FeedbackItem {
  id: string;
  session_id: string;
  agent_id: string;
  category: string;
  text: string;
  agent_name: string | null;
}

// Fixed skills carry their content vendored inline (see skill-catalog.ts) so
// they work regardless of the host's filesystem. Skills detected as actually
// used by the session stay a path reference — Claude reads them live, which
// needs a matching --add-dir Read grant.
export type SkillRef =
  | { kind: 'inline'; name: string; content: string }
  | { kind: 'path'; name: string; dir: string };

function formatCategory(c: string): string {
  return c.split('_').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');
}

export function generateImprovementPrompt(sessionId: string, items: FeedbackItem[], skills: SkillRef[] = []): string {
  const byAgent = new Map<string, FeedbackItem[]>();
  for (const item of items) {
    if (!byAgent.has(item.agent_id)) byAgent.set(item.agent_id, []);
    byAgent.get(item.agent_id)!.push(item);
  }

  const byCategory = new Map<string, FeedbackItem[]>();
  for (const item of items) {
    if (!byCategory.has(item.category)) byCategory.set(item.category, []);
    byCategory.get(item.category)!.push(item);
  }

  const sortedCategories = Array.from(byCategory.entries()).sort((a, b) => b[1].length - a[1].length);
  const recurringCategories = sortedCategories.filter(([, catItems]) => catItems.length >= 2);

  const lines: string[] = [];

  lines.push(`# Multi-Agent Workflow Design Review — ${new Date().toISOString().slice(0, 10)}`);
  lines.push(`\nSession: \`${sessionId}\``);

  lines.push(`\nYou are reviewing ${items.length} observation${items.length !== 1 ? 's' : ''} from a completed multi-agent workflow execution across ${byAgent.size} agent${byAgent.size !== 1 ? 's' : ''}. Find design weaknesses — gaps in the orchestrator's logic, an agent's reasoning contract, a skill definition, or a coordination mechanism that would make any agent fail similarly regardless of task — and propose changes that generalize: fixes that make the workflow more reliable on future executions, not ones tailored to this session's particular inputs or artifacts.\n`);

  if (skills.length > 0) {
    lines.push(`## Required Skills\n`);
    lines.push(`Apply the following skill(s) as part of this review:\n`);
    for (const s of skills) {
      if (s.kind === 'inline') {
        lines.push(`### ${s.name}\n`);
        lines.push(s.content.trim());
        lines.push('');
      } else {
        lines.push(`- **${s.name}** — read \`${s.dir}/SKILL.md\` and follow its guidance for this review.`);
      }
    }
    lines.push('');
  }

  for (const [cat, catItems] of sortedCategories) {
    lines.push(`### ${formatCategory(cat)} (${catItems.length})\n`);
    for (const item of catItems) {
      const agentLabel = item.agent_name || item.agent_id.slice(0, 12);
      lines.push(`- ${item.text} *(${agentLabel})*`);
    }
    lines.push('');
  }

  if (recurringCategories.length > 0) {
    const summary = recurringCategories.map(([cat, catItems]) => {
      const agentNames = [...new Set(catItems.map(i => i.agent_name || i.agent_id.slice(0, 12)))];
      return `${formatCategory(cat)} (${catItems.length} occurrences across ${agentNames.join(', ')})`;
    }).join('; ');
    lines.push(`Note: ${summary}. Recurrence across agents is evidence, not a verdict — weigh it using the questions below.\n`);
  }

  lines.push(`Pursue only failures that reveal a genuine design gap generalizable beyond this session — a one-off mistake tied to this session's inputs is fine to set aside. For what remains:\n`);
  lines.push(`- **Signal vs. noise** — does it recur across agents or executions, or is it isolated? Recurrence suggests a shared flaw, but check whether unrelated mistakes could explain it just as well.`);
  lines.push(`- **Root cause and ownership** — what in the design, not the input, made this possible, and which piece owns it: orchestrator logic, an agent's behavioral contract, a skill, or coordination between agents?`);
  lines.push(`- **Generality** — would the fix generalize to a different task and inputs, or does it only hold for this session's?\n`);
  lines.push(`Write a concrete, directly-editable change for each failure that survives this reasoning.\n`);
  lines.push(`**After presenting your analysis and proposed changes, apply them immediately by editing the relevant files. Do not ask for confirmation — this prompt is the approval. If an edit fails or is denied, skip it and continue.**`);

  return lines.join('\n');
}
