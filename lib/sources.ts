import path from 'path';

export interface SourceConfig {
  id: string;
  label: string;
  path: string;
}

// AGENTWATCH_SOURCES format: "Label:/mount/path,Label2:/mount/path2"
// Colons in paths are fine because we split on the FIRST colon only.
export function getSources(): SourceConfig[] {
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
