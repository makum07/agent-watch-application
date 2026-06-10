'use client';

import { useState, useEffect } from 'react';
import { HeartPulse, Save } from 'lucide-react';
import { useSkillStore } from '@/store/skill-store';
import { cn } from '@/lib/utils';
import type { SelfHealingMode } from '@/types/skills';

interface SelfHealingConfigProps {
  skillId: string;
  enabled: boolean;
  mode: SelfHealingMode;
  threshold: number;
}

const MODES: Array<{ value: SelfHealingMode; label: string; description: string }> = [
  { value: 'analysis_only', label: 'Analysis Only', description: 'Generates report for manual review' },
  { value: 'analysis_and_fix', label: 'Analysis + Fix', description: 'Generates report and fix prompt for review' },
  { value: 'fully_automatic', label: 'Fully Automatic', description: 'Auto-generates and applies improvements' },
];

export function SelfHealingConfig({ skillId, enabled, mode, threshold }: SelfHealingConfigProps) {
  const { updateSkillConfig } = useSkillStore();
  const [localEnabled, setLocalEnabled] = useState(enabled);
  const [localMode, setLocalMode] = useState(mode);
  const [localThreshold, setLocalThreshold] = useState(threshold);
  const [saving, setSaving] = useState(false);
  const [dirty, setDirty] = useState(false);

  useEffect(() => {
    setLocalEnabled(enabled);
    setLocalMode(mode);
    setLocalThreshold(threshold);
    setDirty(false);
  }, [enabled, mode, threshold]);

  const handleChange = (field: string, value: unknown) => {
    if (field === 'enabled') setLocalEnabled(value as boolean);
    if (field === 'mode') setLocalMode(value as SelfHealingMode);
    if (field === 'threshold') setLocalThreshold(value as number);
    setDirty(true);
  };

  const handleSave = async () => {
    setSaving(true);
    await updateSkillConfig(skillId, {
      selfHealingEnabled: localEnabled,
      selfHealingMode: localMode,
      selfHealingThreshold: localThreshold,
    });
    setSaving(false);
    setDirty(false);
  };

  return (
    <div className="rounded-lg border border-[#30363d] bg-[#161b22] p-4">
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2">
          <HeartPulse className={cn('h-4 w-4', localEnabled ? 'text-green-400' : 'text-[#484f58]')} />
          <span className="text-sm font-medium text-[#e6edf3]">Self-Healing</span>
        </div>
        <button
          onClick={() => handleChange('enabled', !localEnabled)}
          className={cn(
            'relative h-5 w-9 rounded-full transition-colors',
            localEnabled ? 'bg-green-500' : 'bg-[#30363d]'
          )}
        >
          <span className={cn(
            'absolute top-0.5 h-4 w-4 rounded-full bg-white transition-transform',
            localEnabled ? 'left-[18px]' : 'left-0.5'
          )} />
        </button>
      </div>

      {localEnabled && (
        <div className="space-y-4">
          <div>
            <label className="text-xs text-[#8b949e] block mb-2">Mode</label>
            <div className="space-y-2">
              {MODES.map(m => (
                <label
                  key={m.value}
                  className={cn(
                    'flex items-start gap-2 p-2 rounded cursor-pointer transition-colors',
                    localMode === m.value ? 'bg-[#21262d]' : 'hover:bg-[#21262d]/50'
                  )}
                >
                  <input
                    type="radio"
                    name="selfHealingMode"
                    value={m.value}
                    checked={localMode === m.value}
                    onChange={() => handleChange('mode', m.value)}
                    className="mt-0.5 accent-[#58a6ff]"
                  />
                  <div>
                    <div className="text-xs font-medium text-[#e6edf3]">{m.label}</div>
                    <div className="text-[11px] text-[#8b949e]">{m.description}</div>
                  </div>
                </label>
              ))}
            </div>
          </div>

          <div>
            <label className="text-xs text-[#8b949e] block mb-1">
              Trigger threshold (executions since last cycle)
            </label>
            <input
              type="number"
              min={1}
              max={100}
              value={localThreshold}
              onChange={e => handleChange('threshold', Math.max(1, parseInt(e.target.value) || 5))}
              className="w-20 text-xs px-2 py-1.5 rounded bg-[#0d1117] border border-[#30363d] text-[#e6edf3]"
            />
          </div>
        </div>
      )}

      {dirty && (
        <button
          onClick={handleSave}
          disabled={saving}
          className="mt-4 flex items-center gap-1.5 text-xs px-3 py-1.5 rounded bg-[#238636] hover:bg-[#2ea043] text-white transition-colors font-medium disabled:opacity-50"
        >
          <Save className="h-3.5 w-3.5" />
          {saving ? 'Saving...' : 'Save Configuration'}
        </button>
      )}
    </div>
  );
}
