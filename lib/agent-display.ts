import type { Agent } from '@/types/session';

// Named agent types with fixed colors
const NAMED_TYPE_COLORS: Record<string, { bg: string; text: string; border: string }> = {
  Orchestrator: { bg: '#1c3556', text: '#58a6ff', border: '#2d5a8c' },
  Explore:      { bg: '#1a3d1f', text: '#3fb950', border: '#2d6b35' },
  Plan:         { bg: '#3d2a0e', text: '#f0883e', border: '#6b4a1a' },
  'general-purpose': { bg: '#2d1f45', text: '#bc8cff', border: '#4d3470' },
  'code-reviewer':   { bg: '#3d0e0e', text: '#f85149', border: '#6b1a1a' },
  Workflow:     { bg: '#1a3d2a', text: '#39d353', border: '#2d6b47' },
};

// Palette for dynamically-labeled agents (workflow subagents with free-form labels)
const PALETTE = [
  { bg: '#1c3556', text: '#58a6ff', border: '#2d5a8c' },  // blue
  { bg: '#1a3d2a', text: '#39d353', border: '#2d6b47' },  // teal-green
  { bg: '#3d2a0e', text: '#f0883e', border: '#6b4a1a' },  // orange
  { bg: '#2d1f45', text: '#bc8cff', border: '#4d3470' },  // purple
  { bg: '#3d1f1a', text: '#ff9a85', border: '#6b3530' },  // salmon
  { bg: '#1a3038', text: '#56d3e0', border: '#2d5c67' },  // cyan
  { bg: '#3d3314', text: '#e0b456', border: '#6b5920' },  // amber
  { bg: '#1f3d20', text: '#6dde77', border: '#347a3b' },  // lime
];

/** Simple stable hash to pick a palette color for a given label */
function hashLabel(label: string): number {
  let h = 0;
  for (let i = 0; i < label.length; i++) {
    h = ((h << 5) - h) + label.charCodeAt(i);
    h |= 0;
  }
  return Math.abs(h) % PALETTE.length;
}

/** Format a kebab-case OR space-separated label to a clean display name */
export function formatAgentLabel(raw: string): string {
  if (!raw) return '';

  // If it already has spaces, it's a natural-language description — capitalize first letter only
  if (raw.includes(' ')) {
    return raw.charAt(0).toUpperCase() + raw.slice(1);
  }

  // Kebab/snake case → Title Case (e.g. "session-format-researcher" → "Session Format Researcher")
  return raw
    .split(/[-_]+/)
    .map(word => {
      if (['api', 'ui', 'db', 'aws', 'llm', 'ai', 'ac'].includes(word.toLowerCase())) {
        return word.toUpperCase();
      }
      return word.charAt(0).toUpperCase() + word.slice(1).toLowerCase();
    })
    .join(' ');
}

export interface AgentDisplay {
  name: string;            // Primary display name
  shortName: string;       // Abbreviated (max ~16 chars)
  typeLabel: string;       // Secondary type hint ("Workflow Subagent", "Orchestrator", etc.)
  color: { bg: string; text: string; border: string };
  initials: string;        // 1–2 letter initials for avatars/compact views
}

export function getAgentDisplay(agent: Agent): AgentDisplay {
  const desc = agent.description; // e.g. "session-format-researcher"
  const subType = agent.subagentType; // e.g. "workflow-subagent", "Explore"
  const agentType = agent.type; // "orchestrator", "subagent", "workflow"

  // 1. Orchestrator
  if (agentType === 'orchestrator') {
    return {
      name: 'Orchestrator',
      shortName: 'Orchestrator',
      typeLabel: 'Main',
      color: NAMED_TYPE_COLORS['Orchestrator'],
      initials: 'OR',
    };
  }

  // 2. Named types (Explore, Plan, general-purpose, etc.)
  if (subType && NAMED_TYPE_COLORS[subType]) {
    const shortDesc = desc ? formatAgentLabel(desc) : '';
    const name = shortDesc ? `${subType}: ${shortDesc}` : subType;
    const shortName = subType + (shortDesc ? `: ${shortDesc.slice(0, 20)}` : '');
    const initials = subType === 'general-purpose' ? 'GP' : subType.slice(0, 2).toUpperCase();
    return {
      name,
      shortName: shortName.slice(0, 28),
      typeLabel: subType,
      color: NAMED_TYPE_COLORS[subType],
      initials,
    };
  }

  // general-purpose without a color entry
  if (subType === 'general-purpose') {
    const color = NAMED_TYPE_COLORS['general-purpose'];
    const shortDesc = desc ? formatAgentLabel(desc) : '';
    const name = shortDesc ? `Agent: ${shortDesc}` : 'Agent';
    return {
      name,
      shortName: name.slice(0, 28),
      typeLabel: 'general-purpose',
      color,
      initials: 'GP',
    };
  }

  // 3. Workflow subagents with description labels
  if (desc) {
    const formatted = formatAgentLabel(desc);
    const colorIdx = hashLabel(desc);
    const color = PALETTE[colorIdx];
    const words = formatted.split(' ');
    const initials = words.length >= 2
      ? words[0][0] + words[1][0]
      : formatted.slice(0, 2);
    return {
      name: formatted,
      shortName: formatted.slice(0, 18),
      typeLabel: 'Workflow Subagent',
      color,
      initials: initials.toUpperCase(),
    };
  }

  // 4. Fallback
  const fallback = formatAgentLabel(subType || agentType || 'Agent');
  const colorIdx = hashLabel(fallback);
  return {
    name: fallback,
    shortName: fallback.slice(0, 18),
    typeLabel: agentType,
    color: PALETTE[colorIdx],
    initials: fallback.slice(0, 2).toUpperCase(),
  };
}
