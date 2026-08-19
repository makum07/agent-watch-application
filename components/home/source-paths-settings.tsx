'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Plus, X, CheckCircle2, AlertCircle } from 'lucide-react';

interface SourceInfo {
  id: string;
  label: string;
  path: string;
  available: boolean;
  removable: boolean;
}

function readSourceCookie(): string | undefined {
  const match = document.cookie.match(/(?:^|; )aw-source=([^;]*)/);
  return match ? decodeURIComponent(match[1]) : undefined;
}

export function SourcePathsSettings() {
  const [sources, setSources] = useState<SourceInfo[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [newLabel, setNewLabel] = useState('');
  const [newPath, setNewPath] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const router = useRouter();

  function load() {
    return fetch('/api/v2/sources')
      .then(r => r.json())
      .then(d => {
        const list: SourceInfo[] = d.sources ?? [];
        setSources(list);
        // Prefill the add-source path with the default/first source's path so
        // the user only has to tweak it (e.g. swap in a WSL UNC prefix) rather
        // than type a full path from scratch.
        setNewPath(prev => prev || list[0]?.path || '');
        setLoaded(true);
      })
      .catch(() => setLoaded(true));
  }

  useEffect(() => { load(); }, []);

  async function addSource() {
    if (!newLabel.trim() || !newPath.trim()) return;
    setSaving(true);
    setError(null);
    try {
      const res = await fetch('/api/v2/sources', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ label: newLabel, path: newPath }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? 'Failed to add source');
      setSources(data.sources ?? []);
      setNewLabel('');
      setNewPath(data.sources?.[0]?.path ?? '');
      window.dispatchEvent(new CustomEvent('aw-sources-changed'));
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  }

  async function removeSource(id: string) {
    const wasActive = readSourceCookie() === id;
    const res = await fetch(`/api/v2/sources/${id}`, { method: 'DELETE' });
    const data = await res.json();
    if (!res.ok) {
      setError(data.error ?? 'Failed to remove source');
      return;
    }
    setSources(data.sources ?? []);
    window.dispatchEvent(new CustomEvent('aw-sources-changed'));
    if (wasActive) {
      const fallbackId = data.sources?.[0]?.id;
      if (fallbackId) {
        document.cookie = `aw-source=${fallbackId}; path=/; max-age=31536000`;
        window.dispatchEvent(new CustomEvent('aw-source-changed', { detail: fallbackId }));
      }
      router.refresh();
    }
  }

  if (!loaded) return null;

  return (
    <div className="border border-[var(--aw-bg-3)] rounded-lg p-4 bg-[var(--aw-bg-1)] space-y-3">
      <div>
        <h3 className="text-sm font-medium text-[var(--aw-text-0)]">Data sources</h3>
        <p className="text-[11px] text-[var(--aw-text-2)] mt-0.5">
          Paths to `.claude` folders AgentWatch reads sessions/skills from — add one per system
          (native, WSL, Claude Desktop, etc.) and switch between them from the source selector above.
        </p>
      </div>

      <div className="space-y-1.5">
        {sources.map(s => (
          <div
            key={s.id}
            className="flex items-center gap-2 px-2.5 py-2 rounded border border-[var(--aw-bg-3)] bg-[var(--aw-bg-0)]"
          >
            {s.available
              ? <CheckCircle2 className="h-3.5 w-3.5 text-[var(--aw-green)] shrink-0" />
              : <AlertCircle className="h-3.5 w-3.5 text-[var(--aw-orange-bright)] shrink-0" />}
            <div className="min-w-0 flex-1">
              <div className="text-xs font-medium text-[var(--aw-text-0)]">{s.label}</div>
              <div className="text-[11px] font-mono text-[var(--aw-text-2)] truncate" title={s.path}>{s.path}</div>
            </div>
            {!s.available && (
              <span className="text-[10px] text-[var(--aw-orange-bright)] shrink-0">not found</span>
            )}
            {s.removable && (
              <button
                onClick={() => removeSource(s.id)}
                title="Remove source"
                className="p-1 rounded hover:bg-[var(--aw-bg-2)] text-[var(--aw-text-2)] hover:text-[var(--aw-red-bright)] transition-colors shrink-0"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            )}
          </div>
        ))}
      </div>

      <div className="flex items-end gap-2 pt-1">
        <div className="w-40">
          <label className="text-[10px] text-[var(--aw-text-2)] block mb-1">Label</label>
          <input
            value={newLabel}
            onChange={e => setNewLabel(e.target.value)}
            placeholder="WSL Ubuntu"
            className="w-full px-2 py-1.5 text-xs rounded border border-[var(--aw-bg-3)] bg-[var(--aw-bg-0)] text-[var(--aw-text-0)] focus:outline-none focus:ring-1 focus:ring-[var(--aw-blue)]"
          />
        </div>
        <div className="flex-1">
          <label className="text-[10px] text-[var(--aw-text-2)] block mb-1">Path to `.claude` folder</label>
          <input
            value={newPath}
            onChange={e => setNewPath(e.target.value)}
            placeholder="//wsl.localhost/Ubuntu-24.04/home/you/.claude"
            className="w-full px-2 py-1.5 text-xs font-mono rounded border border-[var(--aw-bg-3)] bg-[var(--aw-bg-0)] text-[var(--aw-text-0)] focus:outline-none focus:ring-1 focus:ring-[var(--aw-blue)]"
          />
        </div>
        <button
          onClick={addSource}
          disabled={saving || !newLabel.trim() || !newPath.trim()}
          className="flex items-center gap-1 text-xs px-3 py-1.5 rounded bg-[var(--aw-blue)] hover:opacity-90 text-white transition-opacity disabled:opacity-50 shrink-0"
        >
          <Plus className="h-3.5 w-3.5" />
          Add
        </button>
      </div>

      {error && <p className="text-[11px] text-[var(--aw-red-bright)]">{error}</p>}
    </div>
  );
}
