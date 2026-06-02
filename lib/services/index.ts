import { getDatabase } from '@/lib/db/database';

let initialized = false;

export function initServices() {
  if (initialized) return;
  initialized = true;
  getDatabase();
}

export {
  discoverSessions,
  ingestSession,
  getAgentMessages,
} from './session-ingester';

export {
  recordSessionOpen,
  getSessionHistory,
  listSessionHistory,
  searchSessionHistory,
  updateSessionHistory,
} from './session-history';

export {
  saveSnapshot,
  getLatestSnapshot,
  getAutoSave,
  listNamedSnapshots,
  deleteSnapshot,
  createAutoSaveId,
} from './workspace-snapshots';

export {
  getPreferences,
  getPreference,
  setPreference,
} from './preferences';
