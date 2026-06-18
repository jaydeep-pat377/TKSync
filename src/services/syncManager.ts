import {ticketsApi, checkApiHealth} from './api';
import {offlineStorage, PendingSave} from './offlineStorage';
import {getIsOnline, onConnectivityRestored} from '../hooks/useNetworkStatus';
import {captureError, addBreadcrumb} from './sentry';

const MAX_RETRIES = 5;
const RETRY_DELAYS = [1000, 3000, 10000, 30000, 60000]; // progressive backoff

type SyncListener = (event: SyncEvent) => void;
export type SyncEvent =
  | {type: 'sync_start'; count: number}
  | {type: 'item_synced'; item: PendingSave; remaining: number}
  | {type: 'item_failed'; item: PendingSave; error: string}
  | {type: 'sync_complete'; synced: number; failed: number}
  | {type: 'queue_changed'; count: number};

const syncListeners = new Set<SyncListener>();
let isSyncing = false;

function emit(event: SyncEvent) {
  syncListeners.forEach(cb => cb(event));
}

async function syncOne(item: PendingSave): Promise<boolean> {
  try {
    const action = item.action || 'delivery';
    if (action === 'sign') {
      await ticketsApi.sign(item.ticketId, item.body as any);
    } else if (action === 'dispute') {
      await ticketsApi.dispute(item.ticketId, item.body as any);
    } else {
      await ticketsApi.saveDeliveryTab(item.ticketId, item.tab, item.body);
    }
    console.log(
      `[SyncManager] Synced: ticket ${item.ticketId}/${action}`,
    );
    offlineStorage.dequeue(item.id);
    return true;
  } catch (err: any) {
    const message = err?.message || 'Unknown error';
    console.warn(
      `[SyncManager] Failed: ticket ${item.ticketId}/${item.action || item.tab} — ${message}`,
    );
    captureError(err instanceof Error ? err : new Error(message), {
      ticketId: item.ticketId,
      tab: item.tab,
      action: item.action,
      retryCount: item.retryCount,
    });
    offlineStorage.updateRetry(item.id, message);
    return false;
  }
}

async function processQueue(): Promise<void> {
  if (isSyncing) {
    console.log('[SyncManager] Sync already in progress, skipping');
    return;
  }

  const pending = offlineStorage.getAll();
  if (pending.length === 0) return;

  if (!getIsOnline()) {
    console.log('[SyncManager] Still offline, deferring sync');
    return;
  }

  const {healthy} = await checkApiHealth();
  if (!healthy) {
    console.log('[SyncManager] API unhealthy, deferring sync');
    return;
  }

  isSyncing = true;
  let synced = 0;
  let failed = 0;

  console.log(`[SyncManager] Starting sync of ${pending.length} items`);
  emit({type: 'sync_start', count: pending.length});

  for (const item of pending) {
    if (!getIsOnline()) {
      console.log('[SyncManager] Lost connection during sync, stopping');
      break;
    }

    if (item.retryCount >= MAX_RETRIES) {
      console.warn(
        `[SyncManager] Skipping ticket ${item.ticketId}/${item.tab} — exceeded max retries`,
      );
      failed++;
      emit({type: 'item_failed', item, error: 'Max retries exceeded'});
      continue;
    }

    const success = await syncOne(item);
    if (success) {
      synced++;
      const remaining = offlineStorage.getPendingCount();
      emit({type: 'item_synced', item, remaining});
    } else {
      failed++;
      emit({type: 'item_failed', item, error: item.lastError || 'Unknown'});

      // Wait before next retry (backoff)
      const delay = RETRY_DELAYS[Math.min(item.retryCount, RETRY_DELAYS.length - 1)];
      await new Promise<void>(resolve => setTimeout(resolve, delay));
    }
  }

  isSyncing = false;
  const remaining = offlineStorage.getPendingCount();
  console.log(
    `[SyncManager] Sync complete: ${synced} synced, ${failed} failed, ${remaining} remaining`,
  );
  addBreadcrumb('Sync complete', 'sync', {synced, failed, remaining});
  emit({type: 'sync_complete', synced, failed});
  emit({type: 'queue_changed', count: remaining});
}

let unsubConnectivity: (() => void) | null = null;

export const syncManager = {
  /** Start listening for connectivity changes and auto-sync */
  init(): void {
    if (unsubConnectivity) return; // already initialized
    unsubConnectivity = onConnectivityRestored(() => {
      processQueue();
    });
    console.log('[SyncManager] Initialized — listening for connectivity');

    // Sync any items that were queued while the app was closed
    if (getIsOnline() && offlineStorage.hasPending()) {
      setTimeout(() => processQueue(), 2000);
    }
  },

  /** Stop listening */
  destroy(): void {
    unsubConnectivity?.();
    unsubConnectivity = null;
  },

  /** Manually trigger sync */
  sync(): Promise<void> {
    return processQueue();
  },

  /** Subscribe to sync events */
  addListener(cb: SyncListener): () => void {
    syncListeners.add(cb);
    return () => {
      syncListeners.delete(cb);
    };
  },

  /** Check if a sync is in progress */
  isSyncing(): boolean {
    return isSyncing;
  },
};
