'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';

interface SourceInfo {
  id: string;
  label: string;
  available: boolean;
}

export function SourceSwitcher({ initialSourceId }: { initialSourceId: string }) {
  const [activeId, setActiveId] = useState(initialSourceId);
  const [sources, setSources] = useState<SourceInfo[]>([]);
  const router = useRouter();

  useEffect(() => {
    fetch('/api/v2/sources')
      .then(r => r.json())
      .then(data => setSources(data.sources ?? []))
      .catch(() => {});
  }, []);

  if (sources.length <= 1) return null;

  function switchSource(id: string) {
    if (id === activeId) return;
    document.cookie = `aw-source=${id}; path=/; max-age=31536000`;
    setActiveId(id);
    window.dispatchEvent(new CustomEvent('aw-source-changed', { detail: id }));
    router.refresh();
  }

  return (
    <div className="flex items-center gap-0.5 rounded-md border border-border bg-muted/20 p-0.5">
      {sources.map(s => (
        <button
          key={s.id}
          onClick={() => switchSource(s.id)}
          title={!s.available ? `${s.label} not mounted` : undefined}
          className={`flex items-center gap-1 px-2.5 py-1 rounded text-xs transition-colors ${
            activeId === s.id
              ? 'bg-background text-foreground shadow-sm'
              : 'text-muted-foreground hover:text-foreground hover:bg-accent/50'
          }`}
        >
          {s.label}
          {!s.available && (
            <span className="text-destructive text-[10px] leading-none">!</span>
          )}
        </button>
      ))}
    </div>
  );
}
