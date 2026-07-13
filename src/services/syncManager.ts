import {ticketsApi, checkApiHealth} from './api';
import {offlineStorage, PendingSave} from './offlineStorage';
import {getIsOnline, onConnectivityRestored} from '../hooks/useNetworkStatus';
import {captureError, addBreadcrumb} from './sentry';
import {validateDeliveryTab} from '../utils/validateDeliveryTab';

const MAX_RETRIES = 10;
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

function isRetryableError(err: any): boolean {
  // Offline pre-check error is retryable
  if (err?.error_code === 'OFFLINE') return true;
  // Network errors are retryable
  if (err instanceof TypeError && err.message?.includes('Network request failed')) return true;
  if (err?.name === 'AbortError') return true;
  if (err?.message?.includes('Network request failed')) return true;
  // Server errors (5xx) are retryable
  if (err?.status >= 500) return true;
  // 401 is retryable (token may refresh on next attempt)
  if (err?.status === 401) return true;
  // Other client errors (4xx) are NOT retryable (validation, not found)
  if (err?.status >= 400 && err?.status < 500) return false;
  // Default: treat as retryable
  return true;
}

async function syncOne(item: PendingSave): Promise<'synced' | 'retry' | 'permanent_fail'> {
  try {
    const action = item.action || 'delivery';
    if (action === 'sign') {
      await ticketsApi.sign(item.ticketId, item.body as any);
    } else if (action === 'dispute') {
      await ticketsApi.dispute(item.ticketId, item.body as any);
    } else if (action === 'curbline-release') {
      await ticketsApi.curblineRelease(item.ticketId, item.body as any);
    } else {
      // Validate and clean body before sending — removes stale/unknown fields
      const validation = validateDeliveryTab(item.tab, item.body);
      const cleanBody: Record<string, any> = {};
      for (const [k, v] of Object.entries(validation.cleaned)) {
        if (v !== null && v !== undefined) cleanBody[k] = v;
      }
      await ticketsApi.saveDeliveryTab(item.ticketId, item.tab, Object.keys(cleanBody).length > 0 ? cleanBody : validation.cleaned);
    }
    console.log(
      `[SyncManager] Synced: ticket ${item.ticketId}/${action}`,
    );
    offlineStorage.dequeue(item.id);
    return 'synced';
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

    if (!isRetryableError(err)) {
      // Permanent failure (validation, auth) — remove from queue
      console.warn(`[SyncManager] Permanent failure, removing from queue: ${message}`);
      item.lastError = message;
      offlineStorage.dequeue(item.id);
      return 'permanent_fail';
    }

    offlineStorage.updateRetry(item.id, message);
    return 'retry';
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
    console.log('[SyncManager] API unhealthy, retrying in 10s');
    setTimeout(() => processQueue(), 10000);
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
        `[SyncManager] Removing ticket ${item.ticketId}/${item.tab} — exceeded max retries`,
      );
      offlineStorage.dequeue(item.id);
      failed++;
      emit({type: 'item_failed', item, error: 'Max retries exceeded'});
      continue;
    }

    const result = await syncOne(item);
    if (result === 'synced') {
      synced++;
      const remaining = offlineStorage.getPendingCount();
      emit({type: 'item_synced', item, remaining});
    } else if (result === 'permanent_fail') {
      failed++;
      emit({type: 'item_failed', item, error: item.lastError || 'Permanent failure'});
    } else {
      failed++;
      emit({type: 'item_failed', item, error: item.lastError || 'Unknown'});
      // Brief pause before next item (don't block entire loop)
      await new Promise<void>(resolve => setTimeout(resolve, 500));
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

  // If items remain (retryable failures), schedule another attempt
  if (remaining > 0 && getIsOnline()) {
    const nextDelay = RETRY_DELAYS[Math.min(failed - 1, RETRY_DELAYS.length - 1)] || 10000;
    console.log(`[SyncManager] ${remaining} items remaining, retrying in ${nextDelay}ms`);
    setTimeout(() => processQueue(), nextDelay);
  }
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

    // Clean stale queue items that would fail validation
    const pending = offlineStorage.getAll();
    let removed = 0;
    for (const item of pending) {
      if ((item.action || 'delivery') === 'delivery') {
        const v = validateDeliveryTab(item.tab, item.body);
        if (!v.valid) {
          console.warn(`[SyncManager] Removing invalid queued item: ticket ${item.ticketId}/${item.tab}`, v.errors);
          offlineStorage.dequeue(item.id);
          removed++;
        }
      }
    }
    if (removed > 0) console.log(`[SyncManager] Cleaned ${removed} invalid items from queue`);

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
