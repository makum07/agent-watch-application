'use client';

import { Square, Loader2 } from 'lucide-react';

interface StopButtonProps {
  onClick: () => void;
  disabled?: boolean;
  stopping?: boolean;
  label?: string;
}

/** Kill switch for an in-flight `claude` CLI run — shown next to the trigger button while a job is active. */
export function StopButton({ onClick, disabled, stopping, label = 'Stop' }: StopButtonProps) {
  return (
    <button
      onClick={onClick}
      disabled={disabled || stopping}
      className="flex items-center gap-1.5 text-xs px-3 py-1.5 rounded bg-[var(--aw-red)]/10 hover:bg-[var(--aw-red)]/20 text-[var(--aw-red-bright)] transition-colors font-medium disabled:opacity-50"
    >
      {stopping ? <Loader2 className="h-3 w-3 animate-spin" /> : <Square className="h-3 w-3 fill-current" />}
      {stopping ? 'Stopping...' : label}
    </button>
  );
}
