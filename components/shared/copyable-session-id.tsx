'use client';

import { useState } from 'react';
import { Copy, Check } from 'lucide-react';

interface CopyableSessionIdProps {
  sessionId: string;
  className?: string;
}

/**
 * Small chip showing (a prefix of) a CLI session id, click-to-copy. Used
 * where a feature spawns a brand-new one-shot `claude` session rather than
 * resuming an existing one (skill analysis, execution analysis) — lets the
 * user grab the id to `claude --resume <id>` into it later if they want to
 * dig further into how a report was produced.
 */
export function CopyableSessionId({ sessionId, className }: CopyableSessionIdProps) {
  const [copied, setCopied] = useState(false);

  const handleCopy = async (e: React.MouseEvent) => {
    e.stopPropagation();
    try {
      await navigator.clipboard.writeText(sessionId);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // clipboard unavailable (permissions, insecure context) — nothing to fall back to
    }
  };

  return (
    <button
      onClick={handleCopy}
      title={`claude --resume ${sessionId}\n\nClick to copy the session id`}
      className={
        className ??
        'flex items-center gap-1 text-[9px] font-mono px-1.5 py-0.5 rounded bg-[var(--aw-bg-3)] text-[var(--aw-text-2)] hover:text-[var(--aw-text-0)] transition-colors shrink-0'
      }
    >
      {copied ? <Check className="h-2.5 w-2.5 text-[var(--aw-green)]" /> : <Copy className="h-2.5 w-2.5" />}
      {copied ? 'Copied' : sessionId.slice(0, 8)}
    </button>
  );
}
