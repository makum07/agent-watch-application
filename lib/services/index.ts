import { getDatabase } from '@/lib/db/database';
import { startThresholdMonitor } from './threshold-monitor';
import { syncModelPricing } from './pricing-sync';

let initialized = false;

export function initServices() {
  if (initialized) return;
  initialized = true;
  getDatabase();
  startThresholdMonitor();

  // Non-blocking: cost calculation already falls back to the last-synced (or
  // committed baseline) pricebank, so startup shouldn't wait on the network.
  syncModelPricing()
    .then((result) => {
      if (result.ok) {
        console.log(`> Model pricing synced (${result.modelCount} models, ${result.updatedAt})`);
      } else {
        console.warn(`> Model pricing sync skipped: ${result.error}`);
      }
    })
    .catch((err) => console.warn('> Model pricing sync failed:', err));
}

export {
  discoverSessions,
  ingestSession,
  getAgentMessages,
  backfillContentIndex,
} from './session-ingester';

export {
  recordSessionOpen,
  getSessionHistory,
  listSessionHistory,
  searchSessionHistory,
  searchSessions,
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
