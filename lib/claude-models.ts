// Shared model choices for the three features that spawn the `claude` CLI
// programmatically (skill analysis, execution analysis, review/apply
// improvements) — see lib/services/claude-cli.ts. These short aliases are
// passed straight through as `--model <value>`.

export const CLAUDE_CLI_MODELS = [
  { value: 'haiku', label: 'Haiku', description: 'Fastest, cheapest' },
  { value: 'sonnet', label: 'Sonnet', description: 'Balanced (default)' },
  { value: 'opus', label: 'Opus', description: 'Most capable, slowest' },
] as const;

export type ClaudeCliModel = typeof CLAUDE_CLI_MODELS[number]['value'];

export const DEFAULT_CLAUDE_CLI_MODEL: ClaudeCliModel = 'sonnet';

export function sanitizeClaudeCliModel(value: unknown): ClaudeCliModel {
  return (CLAUDE_CLI_MODELS as readonly { value: string }[]).some(m => m.value === value)
    ? (value as ClaudeCliModel)
    : DEFAULT_CLAUDE_CLI_MODEL;
}
