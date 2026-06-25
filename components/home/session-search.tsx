'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { Search, Loader2, ArrowRight } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { cn, formatRelativeTime } from '@/lib/utils';
import type { SessionHistory } from '@/types/history';

const UUID_RE = /^[0-9a-f]{8}-?[0-9a-f]{4}-?[0-9a-f]{4}-?[0-9a-f]{4}-?[0-9a-f]{12}$/i;

function extractId(raw: string): string | null {
  const trimmed = raw.trim();
  // Direct UUID
  if (UUID_RE.test(trimmed)) return trimmed;
  // Path ending in UUID or UUID.jsonl
  const part = trimmed.split(/[/\\]/).pop()?.replace(/\.jsonl$/, '') ?? '';
  if (UUID_RE.test(part)) return part;
  return null;
}

export function SessionSearch() {
  const router = useRouter();
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<SessionHistory[]>([]);
  const [loading, setLoading] = useState(false);
  const [focused, setFocused] = useState(false);

  const directId = extractId(query);

  useEffect(() => {
    if (!query.trim() || directId) { setResults([]); return; }

    const timer = setTimeout(async () => {
      setLoading(true);
      try {
        const res = await fetch(`/api/v2/history?q=${encodeURIComponent(query)}&limit=10`);
        if (res.ok) {
          const data = await res.json();
          setResults(data.sessions || []);
        }
      } catch { }
      setLoading(false);
    }, 300);

    return () => clearTimeout(timer);
  }, [query, directId]);

  function handleKeyDown(e: React.KeyboardEvent) {
    if (e.key === 'Enter') {
      if (directId) { router.push(`/session/${directId}`); setFocused(false); }
      else if (results.length > 0) { router.push(`/session/${results[0].sessionId}`); setFocused(false); }
    }
  }

  return (
    <div className="relative w-full">
      <div className="relative">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground pointer-events-none" />
        <Input
          className="pl-9 pr-9 bg-muted/50 border-border"
          placeholder="Search sessions or paste ID / path…"
          value={query}
          onChange={e => setQuery(e.target.value)}
          onKeyDown={handleKeyDown}
          onFocus={() => setFocused(true)}
          onBlur={() => setTimeout(() => setFocused(false), 200)}
        />
        {loading && (
          <Loader2 className="absolute right-3 top-1/2 -translate-y-1/2 h-4 w-4 animate-spin text-muted-foreground" />
        )}
        {directId && !loading && (
          <ArrowRight className="absolute right-3 top-1/2 -translate-y-1/2 h-4 w-4 text-primary" />
        )}
      </div>

      {focused && directId && (
        <div className="absolute top-full left-0 right-0 mt-1 bg-card border border-border rounded-lg shadow-lg z-50 overflow-hidden">
          <button
            className="w-full flex items-center gap-3 px-3 py-2.5 hover:bg-accent text-left transition-colors"
            onClick={() => { router.push(`/session/${directId}`); setFocused(false); }}
          >
            <ArrowRight className="h-4 w-4 text-primary shrink-0" />
            <div className="min-w-0 flex-1">
              <div className="text-sm font-medium">Open session</div>
              <div className="text-xs text-muted-foreground font-mono truncate">{directId}</div>
            </div>
          </button>
        </div>
      )}

      {focused && !directId && results.length > 0 && (
        <div className="absolute top-full left-0 right-0 mt-1 bg-card border border-border rounded-lg shadow-lg z-50 overflow-hidden">
          {results.map(s => (
            <button
              key={s.sessionId}
              className="w-full flex items-center gap-3 px-3 py-2.5 hover:bg-accent text-left transition-colors"
              onClick={() => { router.push(`/session/${s.sessionId}`); setFocused(false); }}
            >
              <div className="min-w-0 flex-1">
                <div className="text-sm font-medium truncate">{s.title}</div>
                <div className="text-xs text-muted-foreground truncate">{s.project.split(/[/\\]/).pop()}</div>
              </div>
              <div className="text-xs text-muted-foreground shrink-0">{formatRelativeTime(s.lastOpened)}</div>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
