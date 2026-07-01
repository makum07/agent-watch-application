import { getDatabase } from '@/lib/db/database';

interface UserPreferences {
  alwaysResumeWorkspace: boolean;
  defaultLayoutPreset: string;
  sidebarWidth: number;
  maxPinnedSessions: number;
  theme: 'dark';
  alertCostThreshold: number;
  alertDurationThresholdHours: number;
  teamsWebhookUrl: string;
}

const DEFAULTS: UserPreferences = {
  alwaysResumeWorkspace: false,
  defaultLayoutPreset: 'single',
  sidebarWidth: 280,
  maxPinnedSessions: 10,
  theme: 'dark',
  alertCostThreshold: 5,
  alertDurationThresholdHours: 0,
  teamsWebhookUrl: '',
};

export function getPreferences(): UserPreferences {
  const db = getDatabase();
  const rows = db.prepare('SELECT key, value FROM user_preferences').all() as { key: string; value: string }[];

  const prefs = { ...DEFAULTS };
  for (const row of rows) {
    try {
      (prefs as Record<string, unknown>)[row.key] = JSON.parse(row.value);
    } catch {
      (prefs as Record<string, unknown>)[row.key] = row.value;
    }
  }

  return prefs;
}

export function getPreference<K extends keyof UserPreferences>(key: K): UserPreferences[K] {
  const db = getDatabase();
  const row = db.prepare('SELECT value FROM user_preferences WHERE key = ?').get(key) as { value: string } | undefined;

  if (!row) return DEFAULTS[key];

  try {
    return JSON.parse(row.value) as UserPreferences[K];
  } catch {
    return row.value as UserPreferences[K];
  }
}

export function setPreference<K extends keyof UserPreferences>(key: K, value: UserPreferences[K]): void {
  const db = getDatabase();
  db.prepare(`
    INSERT OR REPLACE INTO user_preferences (key, value, updated_at) VALUES (?, ?, ?)
  `).run(key, JSON.stringify(value), Date.now());
}
