'use client';

import { CLAUDE_CLI_MODELS, type ClaudeCliModel } from '@/lib/claude-models';

interface ModelSelectProps {
  value: ClaudeCliModel;
  onChange: (model: ClaudeCliModel) => void;
  disabled?: boolean;
}

/** Model picker for the three features that spawn the `claude` CLI (skill analysis, execution analysis, apply improvements). */
export function ModelSelect({ value, onChange, disabled }: ModelSelectProps) {
  return (
    <select
      value={value}
      onChange={e => onChange(e.target.value as ClaudeCliModel)}
      disabled={disabled}
      title="Model"
      className="text-xs px-2 py-1.5 rounded bg-[var(--aw-bg-2)] border border-[var(--aw-bg-3)] text-[var(--aw-text-0)] disabled:opacity-50"
    >
      {CLAUDE_CLI_MODELS.map(m => (
        <option key={m.value} value={m.value} title={m.description}>{m.label}</option>
      ))}
    </select>
  );
}
