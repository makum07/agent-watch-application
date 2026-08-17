'use client';

import { useEffect, useState } from 'react';
import { Pin, Star } from 'lucide-react';
import { cn } from '@/lib/utils';

interface SessionPinToggleProps {
  sessionId: string;
}

function sourceCookie(): string | undefined {
  return document.cookie.split(';').map(c => c.trim())
    .find(c => c.startsWith('aw-source='))?.split('=')[1];
}

/** Star/Pin toggle for the session detail header — mirrors the same controls on the Home session cards. */
export function SessionPinToggle({ sessionId }: SessionPinToggleProps) {
  const [isPinned, setIsPinned] = useState(false);
  const [isFavorite, setIsFavorite] = useState(false);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    const sourceId = sourceCookie();
    const url = `/api/v2/history/${sessionId}${sourceId ? `?source=${sourceId}` : ''}`;
    fetch(url)
      .then(res => res.ok ? res.json() : null)
      .then(data => {
        if (data) { setIsPinned(!!data.isPinned); setIsFavorite(!!data.isFavorite); }
        setLoaded(true);
      })
      .catch(() => setLoaded(true));
  }, [sessionId]);

  const toggle = async (field: 'isPinned' | 'isFavorite') => {
    const next = field === 'isPinned' ? !isPinned : !isFavorite;
    if (field === 'isPinned') setIsPinned(next); else setIsFavorite(next);
    try {
      const sourceId = sourceCookie();
      const url = `/api/v2/history/${sessionId}${sourceId ? `?source=${sourceId}` : ''}`;
      await fetch(url, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ [field]: next }),
      });
    } catch {
      if (field === 'isPinned') setIsPinned(!next); else setIsFavorite(!next);
    }
  };

  if (!loaded) return null;

  return (
    <div className="flex items-center gap-0.5 shrink-0">
      <button
        onClick={() => toggle('isFavorite')}
        title={isFavorite ? 'Unfavorite' : 'Favorite'}
        className={cn(
          'p-1.5 rounded transition-colors',
          isFavorite ? 'text-yellow-400' : 'text-[var(--aw-text-2)] hover:text-yellow-400 hover:bg-[var(--aw-bg-3)]'
        )}
      >
        <Star className={cn('h-3.5 w-3.5', isFavorite && 'fill-yellow-400')} />
      </button>
      <button
        onClick={() => toggle('isPinned')}
        title={isPinned ? 'Unpin' : 'Pin'}
        className={cn(
          'p-1.5 rounded transition-colors',
          isPinned ? 'text-[var(--aw-blue)]' : 'text-[var(--aw-text-2)] hover:text-[var(--aw-blue)] hover:bg-[var(--aw-bg-3)]'
        )}
      >
        <Pin className={cn('h-3.5 w-3.5', isPinned && 'fill-[var(--aw-blue)]')} />
      </button>
    </div>
  );
}
