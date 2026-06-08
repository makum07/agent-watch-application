export interface WorkflowPhase {
  title: string;
  agentIds: string[];
}

export interface WorkflowInfo {
  agentId: string;
  name: string;
  description: string;
  phases: WorkflowPhase[];
}

/**
 * Extract meta.name, meta.description, and meta.phases from a workflow script
 * using regex — no AST parsing needed for the common pattern.
 */
export function extractWorkflowMeta(script: string): {
  name: string;
  description: string;
  phaseNames: string[];
} {
  const nameMatch = script.match(/name\s*:\s*['"]([^'"]+)['"]/);
  const descMatch = script.match(/description\s*:\s*['"]([^'"]+)['"]/);

  // Extract phase titles from the phases array: { title: 'Phase Name', ... }
  const phaseNames: string[] = [];
  const phasesMatch = script.match(/phases\s*:\s*\[([\s\S]*?)\]/);
  if (phasesMatch) {
    const phasesStr = phasesMatch[1];
    const titleMatches = phasesStr.matchAll(/title\s*:\s*['"]([^'"]+)['"]/g);
    for (const m of titleMatches) {
      phaseNames.push(m[1]);
    }
  }

  // Also look for phase() calls in the script body: phase('Phase Name')
  const phaseCallMatches = script.matchAll(/phase\s*\(\s*['"]([^'"]+)['"]\s*\)/g);
  for (const m of phaseCallMatches) {
    if (!phaseNames.includes(m[1])) phaseNames.push(m[1]);
  }

  return {
    name: nameMatch?.[1] ?? 'Workflow',
    description: descMatch?.[1] ?? '',
    phaseNames,
  };
}

/**
 * Match agents to phases using heuristics:
 * - Agent description matches a phase title (opts.phase in agent call)
 * - Fallback: distribute agents evenly by start time
 */
export function assignAgentsToPhases(
  agents: Array<{ id: string; description: string | null; startTime: string }>,
  phaseNames: string[]
): WorkflowPhase[] {
  if (phaseNames.length === 0) return [];

  const phases: WorkflowPhase[] = phaseNames.map(title => ({ title, agentIds: [] }));
  const unassigned: typeof agents = [];

  for (const agent of agents) {
    const desc = (agent.description ?? '').toLowerCase();
    let matched = false;
    for (const phase of phases) {
      if (desc.includes(phase.title.toLowerCase())) {
        phase.agentIds.push(agent.id);
        matched = true;
        break;
      }
    }
    if (!matched) unassigned.push(agent);
  }

  // Distribute unassigned agents evenly across phases by timing
  if (unassigned.length > 0 && phases.length > 0) {
    const sorted = [...unassigned].sort(
      (a, b) => new Date(a.startTime).getTime() - new Date(b.startTime).getTime()
    );
    const chunkSize = Math.ceil(sorted.length / phases.length);
    sorted.forEach((agent, i) => {
      const phaseIdx = Math.min(Math.floor(i / chunkSize), phases.length - 1);
      phases[phaseIdx].agentIds.push(agent.id);
    });
  }

  return phases.filter(p => p.agentIds.length > 0);
}
