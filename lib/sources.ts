import path from 'path';
import { getPreference, setPreference } from '@/lib/services/preferences';

export interface SourceConfig {
  id: string;
  label: string;
  path: string;
}

// The env/Docker-derived sources — always present, never user-removable.
// AGENTWATCH_SOURCES format: "Label:/mount/path,Label2:/mount/path2"
// Colons in paths are fine because we split on the FIRST colon only.
function getBaseSources(): SourceConfig[] {
  const raw = process.env.AGENTWATCH_SOURCES;
  if (raw) {
    return raw.split(',').map(entry => {
      const colonIdx = entry.indexOf(':');
      const label = entry.slice(0, colonIdx).trim();
      const p = entry.slice(colonIdx + 1).trim();
      return { id: slugify(label), label, path: p };
    });
  }
  const home = process.env.HOME || process.env.USERPROFILE || '';
  const claudeHome = process.env.CLAUDE_HOME || path.join(home, '.claude');
  return [{ id: 'default', label: 'Default', path: claudeHome }];
}

// User-added sources (e.g. a WSL distro's .claude, or a Claude Desktop data
// dir) persisted via the Home page's source settings panel — additive on
// top of whatever the env/Docker config already provides.
export function getCustomSources(): SourceConfig[] {
  return getPreference('customSources');
}

export function getSources(): SourceConfig[] {
  const base = getBaseSources();
  const baseIds = new Set(base.map(s => s.id));
  const custom = getCustomSources().filter(s => !baseIds.has(s.id));
  return [...base, ...custom];
}

// Whether a source ID came from the env/Docker config (fixed) rather than
// the user-managed custom list (removable) — used by the sources API/UI.
export function isRemovableSource(id: string): boolean {
  return getCustomSources().some(s => s.id === id);
}

export function addCustomSource(label: string, rawPath: string): SourceConfig[] {
  const trimmedLabel = label.trim();
  const normalizedPath = rawPath.trim().replace(/\\/g, '/');
  if (!trimmedLabel || !normalizedPath) {
    throw new Error('Label and path are required');
  }

  const existingIds = new Set(getSources().map(s => s.id));
  let id = slugify(trimmedLabel) || 'source';
  let suffix = 2;
  while (existingIds.has(id)) {
    id = `${slugify(trimmedLabel) || 'source'}-${suffix++}`;
  }

  const custom = getCustomSources();
  custom.push({ id, label: trimmedLabel, path: normalizedPath });
  setPreference('customSources', custom);
  return getSources();
}

export function removeCustomSource(id: string): SourceConfig[] {
  const custom = getCustomSources();
  const next = custom.filter(s => s.id !== id);
  if (next.length === custom.length) {
    throw new Error('Source not found or not removable');
  }
  setPreference('customSources', next);
  return getSources();
}

export function getSourceById(id: string): SourceConfig | undefined {
  return getSources().find(s => s.id === id);
}

export function getDefaultSource(): SourceConfig {
  return getSources()[0];
}

export function resolveSource(id?: string | null): SourceConfig {
  if (!id) return getDefaultSource();
  return getSourceById(id) ?? getDefaultSource();
}

function slugify(s: string): string {
  return s.toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, '');
}

// A WSL source's own recorded paths (session cwd, tool-call file paths) are
// native Linux paths, exactly as Claude Code saw them (e.g. "/home/user/proj").
// When AgentWatch itself runs on native Windows, a bare Linux path isn't
// fs-accessible — Node resolves it against the current drive root and every
// existsSync/readFileSync silently fails. Rewrite it through the same WSL UNC
// mount already configured for that source in AGENTWATCH_SOURCES (the prefix
// that ingestion already reads that source's own .claude folder through).
export function toAccessiblePath(linuxPath: string, sourceId?: string): string {
  if (process.platform !== 'win32') return linuxPath;
  if (!linuxPath.startsWith('/') || linuxPath.startsWith('//')) return linuxPath;
  const source = sourceId ? getSourceById(sourceId) : undefined;
  const uncMatch = source?.path.match(/^(\/\/[^/]+\/[^/]+)/);
  return uncMatch ? uncMatch[1] + linuxPath : linuxPath;
}

// Distro name for a WSL-backed source (its AGENTWATCH_SOURCES path looks like
// "//wsl.localhost/Ubuntu-24.04/..."), or null if this source isn't WSL-backed.
// Used to decide whether a `claude` spawn needs routing through `wsl -d <distro>`.
export function getWslDistro(sourceId?: string): string | null {
  if (process.platform !== 'win32' || !sourceId) return null;
  const source = getSourceById(sourceId);
  const match = source?.path.match(/^\/\/wsl[^/]*\/([^/]+)/i);
  return match ? match[1] : null;
}
