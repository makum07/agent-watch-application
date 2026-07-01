export interface FeedbackItem {
  id: string;
  session_id: string;
  agent_id: string;
  category: string;
  text: string;
  agent_name: string | null;
}

function formatCategory(c: string): string {
  return c.split('_').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');
}

export function generateImprovementPrompt(sessionId: string, items: FeedbackItem[]): string {
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

  lines.push(`\nYou are reviewing ${items.length} observation${items.length !== 1 ? 's' : ''} from a completed multi-agent workflow execution across ${byAgent.size} agent${byAgent.size !== 1 ? 's' : ''}.`);
  lines.push(`Your objective is to identify the design weaknesses that produced these failures and propose changes that make the workflow more reliable across all future executions — not fixes for this session's specific inputs, tasks, or artifacts.`);
  lines.push(`\nA design weakness is a gap in the orchestrator's logic, an agent's reasoning contract, a skill definition, or a coordination mechanism that would cause any agent to fail similarly, regardless of the specific task. Session-specific rules or hardcoded logic are not improvements.\n`);

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
    lines.push(`Note: ${summary} — these appeared across multiple agents and are likely systemic weaknesses rather than isolated mistakes.\n`);
  }

  lines.push(`Investigate the failure patterns above. For each class of failure, identify what is missing or incorrect in the workflow design that would cause similar failures in any future execution. Determine which component needs to change — orchestrator logic, an agent type's behavioral contract, a skill definition, or a coordination mechanism — and write a concrete change specific enough to directly edit the relevant system prompt or configuration.`);
  lines.push(`\nBefore including any change, verify it applies correctly across future executions with entirely different tasks and inputs. Discard changes that only help for tasks similar to this session.\n`);
  lines.push(`**After presenting your analysis and proposed changes, immediately apply them by editing the relevant files. Do not ask for confirmation. This prompt is the approval. If an edit fails or is denied, skip it and continue.**`);

  return lines.join('\n');
}
