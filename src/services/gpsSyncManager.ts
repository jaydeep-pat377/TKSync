import {gpsStorage} from './gpsStorage';
import {gpsApi, trackingApi} from './api';
import {getIsOnline, onConnectivityRestored} from '../hooks/useNetworkStatus';

const SYNC_INTERVAL_MS = 30_000; // 30 seconds

let syncInterval: ReturnType<typeof setInterval> | null = null;
let unsubConnectivity: (() => void) | null = null;
let isSyncing = false;
let currentTicketId: number | null = null;
let onTicketInactive: (() => void) | null = null;

/** Fetch the current in-process ticket ID from tracking/me. */
async function resolveTicketId(): Promise<number | null> {
  try {
    const res = await trackingApi.getMe();
    return res.data?.current_load?.id ?? null;
  } catch {
    return null;
  }
}

/** Sync unsynced GPS records + re-resolve ticket ID for new records. */
async function syncAndRefreshTicket(): Promise<void> {
  await syncGpsRecords();
  // Re-resolve ticket ID — check if ticket is still active
  const newTicketId = await resolveTicketId();
  if (newTicketId === null && currentTicketId !== null) {
    console.log(`[GpsSyncManager] Ticket ${currentTicketId} is no longer active — auto-stopping`);
    onTicketInactive?.();
    return;
  }
  if (newTicketId !== null && newTicketId !== currentTicketId) {
    console.log(`[GpsSyncManager] Ticket changed: ${currentTicketId} → ${newTicketId}`);
    currentTicketId = newTicketId;
  }
}

const BATCH_SIZE = 100;

async function syncGpsRecords(): Promise<void> {
  if (isSyncing || !getIsOnline()) return;

  const unsynced = gpsStorage.getUnsynced();
  if (unsynced.length === 0) return;

  isSyncing = true;
  let totalSynced = 0;
  try {
    // Send in batches to avoid large payloads
    for (let i = 0; i < unsynced.length; i += BATCH_SIZE) {
      if (!getIsOnline()) break; // Stop if we lose connection mid-sync
      const batch = unsynced.slice(i, i + BATCH_SIZE);
      const records = batch.map(r => ({
        ticket_id: r.ticket_id,
        latitude: r.latitude,
        longitude: r.longitude,
        speed: r.speed,
        heading: r.heading,
        altitude: r.altitude,
        accuracy: r.accuracy,
        recorded_at: r.recorded_at,
      }));

      await gpsApi.saveRecords(records);
      gpsStorage.markSynced(batch.map(r => r.id));
      totalSynced += batch.length;
    }
    console.log(`[GpsSyncManager] Synced ${totalSynced}/${unsynced.length} GPS records`);
  } catch (err: any) {
    console.warn(`[GpsSyncManager] Sync failed after ${totalSynced} records: ${err.message}`);
  } finally {
    isSyncing = false;
  }
}

export const gpsSyncManager = {
  /**
   * Start periodic GPS sync (call when tracking begins).
   * Returns false if no in-process ticket found — tracking should be blocked.
   */
  async start(): Promise<boolean> {
    if (syncInterval) return true;
    currentTicketId = await resolveTicketId();
    if (currentTicketId === null) {
      console.warn('[GpsSyncManager] No in-process ticket — blocking tracking');
      return false;
    }
    console.log(`[GpsSyncManager] Started — ticket_id: ${currentTicketId}`);
    syncInterval = setInterval(syncAndRefreshTicket, SYNC_INTERVAL_MS);
    unsubConnectivity = onConnectivityRestored(() => syncGpsRecords());
    syncGpsRecords();
    return true;
  },

  /** Stop periodic sync (call when tracking ends). */
  stop(): void {
    if (syncInterval) {
      clearInterval(syncInterval);
      syncInterval = null;
    }
    unsubConnectivity?.();
    unsubConnectivity = null;
    syncGpsRecords();
    currentTicketId = null;
    onTicketInactive = null;
    console.log('[GpsSyncManager] Stopped');
  },

  /** Get the current ticket ID (resolved at start, refreshed every 30s). */
  getTicketId(): number | null {
    return currentTicketId;
  },

  /** Set callback for when the ticket becomes inactive (auto-stop tracking). */
  setOnTicketInactive(cb: (() => void) | null): void {
    onTicketInactive = cb;
  },

  /** Manual sync trigger. */
  sync(): Promise<void> {
    return syncGpsRecords();
  },

  /**
   * Flush leftover unsynced GPS records on app startup.
   * Records already have ticket_id stamped from when they were recorded.
   * No interval or tracking started — just sends and done.
   */
  flushUnsynced(): void {
    const count = gpsStorage.getUnsynced().length;
    if (count > 0) {
      console.log(`[GpsSyncManager] Flushing ${count} leftover GPS records`);
      syncGpsRecords();
    }
  },
};
