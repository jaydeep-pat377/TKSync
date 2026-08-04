import {Platform, NativeModules} from 'react-native';
import {gpsStorage} from './gpsStorage';
import {gpsApi, trackingApi, heartbeatApi} from './api';
import {getIsOnline, onConnectivityRestored} from '../hooks/useNetworkStatus';
import {storage} from './storage';
import {createMMKV} from 'react-native-mmkv';
import Config from 'react-native-config';

const {LocationTrackingModule} = NativeModules;

const BASE_SYNC_INTERVAL_MS = 30_000; // 30 seconds
let currentSyncInterval = BASE_SYNC_INTERVAL_MS;
let consecutiveFailures = 0;
const gpsCache = createMMKV({id: 'tksync-gps'});
const CACHED_TICKET_KEY = 'last_ticket_id';

let syncInterval: ReturnType<typeof setInterval> | null = null;
let unsubConnectivity: (() => void) | null = null;
let isSyncing = false;
let currentTicketId: number | null = null;
let onTicketInactive: (() => void) | null = null;

function getCachedTicketId(): number | null {
  const val = gpsCache.getNumber(CACHED_TICKET_KEY);
  return val !== undefined ? val : null;
}

function setCachedTicketId(id: number | null): void {
  if (id !== null) {
    gpsCache.set(CACHED_TICKET_KEY, id);
  } else {
    gpsCache.remove(CACHED_TICKET_KEY);
  }
}

/** Fetch the current in-process ticket ID from tracking/me. Falls back to cached ID when offline. */
async function resolveTicketId(): Promise<number | null> {
  if (!getIsOnline()) {
    const cached = getCachedTicketId();
    if (cached !== null) {
      console.log(`[GpsSyncManager] Offline — using cached ticket_id: ${cached}`);
    }
    return cached;
  }
  try {
    const res = await trackingApi.getMe();
    const id = res.data?.current_load?.id ?? null;
    setCachedTicketId(id);
    return id;
  } catch {
    const cached = getCachedTicketId();
    if (cached !== null) {
      console.log(`[GpsSyncManager] API failed — using cached ticket_id: ${cached}`);
    }
    return cached;
  }
}

/** Check if ticket is still active — called every 5 minutes (not every 30s). */
async function refreshTicket(): Promise<void> {
  const newTicketId = await resolveTicketId();
  if (newTicketId === null && currentTicketId !== null) {
    console.log(`[GpsSyncManager] Ticket ${currentTicketId} is no longer active — auto-stopping`);
    setCachedTicketId(null);
    onTicketInactive?.();
    return;
  }
  if (newTicketId !== null && newTicketId !== currentTicketId) {
    console.log(`[GpsSyncManager] Ticket changed: ${currentTicketId} → ${newTicketId}`);
    currentTicketId = newTicketId;
    if (Platform.OS === 'android' && LocationTrackingModule) {
      LocationTrackingModule.updateTicketId(newTicketId).catch(() => {});
    }
  }
}

const BATCH_SIZE = 100;

async function syncGpsRecords(): Promise<void> {
  if (isSyncing || !getIsOnline()) return;

  // Check if driver is still logged in before making API calls
  const driverData = storage.getString('driver');
  if (!driverData) {
    console.log('[GpsSyncManager] Driver not logged in — skipping sync');
    return;
  }

  const unsynced = gpsStorage.getUnsynced();
  if (unsynced.length === 0) {
    // No GPS records to upload — send heartbeat so server knows we're online
    heartbeatApi.ping().catch(() => {});
    return;
  }

  isSyncing = true;
  let totalSynced = 0;
  try {
    // Send in batches to avoid large payloads
    for (let i = 0; i < unsynced.length; i += BATCH_SIZE) {
      if (!getIsOnline()) break; // Stop if we lose connection mid-sync
      const batch = unsynced.slice(i, i + BATCH_SIZE);
      const records = batch.map(r => ({
        client_id: r.id,
        ticket_id: r.ticket_id,
        latitude: r.latitude,
        longitude: r.longitude,
        speed: r.speed,
        heading: r.heading,
        altitude: r.altitude,
        accuracy: r.accuracy,
        recorded_at: r.recorded_at,
        is_speeding: r.is_speeding,
        is_idle: r.is_idle,
        accel_x: r.accel_x,
        accel_y: r.accel_y,
        zone: r.zone,
      }));

      console.log(`[GpsSyncManager] Sending ${records.length} records to API:`, JSON.stringify(records));
      try {
        const res = await gpsApi.saveRecords(records);
        console.log(`[GpsSyncManager] API response:`, JSON.stringify(res.data));
        gpsStorage.markSynced(batch.map(r => r.id));
        totalSynced += batch.length;
      } catch (batchErr: any) {
        console.warn(`[GpsSyncManager] Batch ${Math.floor(i / BATCH_SIZE) + 1} failed: ${batchErr.message}, continuing with next batch`);
        // Continue with next batch instead of stopping entirely
      }
    }
    console.log(`[GpsSyncManager] Synced ${totalSynced}/${unsynced.length} GPS records`);
    // Reset backoff on success
    if (totalSynced > 0 && consecutiveFailures > 0) {
      consecutiveFailures = 0;
      resetSyncInterval();
    }
    // Check ticket status after successful upload (no separate timer needed)
    if (totalSynced > 0) {
      refreshTicket();
    }
  } catch (err: any) {
    console.warn(`[GpsSyncManager] Sync failed after ${totalSynced} records: ${err.message}`);
    // Exponential backoff: 30s → 60s → 120s → max 5min
    consecutiveFailures++;
    const backoff = Math.min(BASE_SYNC_INTERVAL_MS * Math.pow(2, consecutiveFailures), 300_000);
    if (backoff !== currentSyncInterval) {
      currentSyncInterval = backoff;
      resetSyncInterval();
      console.log(`[GpsSyncManager] Backoff: next sync in ${backoff / 1000}s`);
    }
  } finally {
    isSyncing = false;
  }
}

function resetSyncInterval(): void {
  if (!syncInterval) return; // Stopped — don't recreate
  clearInterval(syncInterval);
  syncInterval = setInterval(syncGpsRecords, currentSyncInterval);
}

export const gpsSyncManager = {
  /**
   * Start periodic GPS sync (call when tracking begins).
   * @param fallbackTicketId - ticket ID passed from Dashboard (used when /tracking/me has no current_load)
   * Returns false if no in-process ticket found — tracking should be blocked.
   */
  async start(fallbackTicketId?: number | null): Promise<boolean> {
    if (syncInterval) return true;
    currentTicketId = await resolveTicketId();
    if (currentTicketId === null && fallbackTicketId) {
      console.log(`[GpsSyncManager] API returned no current_load — using fallback ticket_id: ${fallbackTicketId}`);
      currentTicketId = fallbackTicketId;
      setCachedTicketId(fallbackTicketId);
    }
    if (currentTicketId === null) {
      console.warn('[GpsSyncManager] No in-process ticket — blocking tracking');
      return false;
    }
    console.log(`[GpsSyncManager] Started — ticket_id: ${currentTicketId}`);
    consecutiveFailures = 0;
    currentSyncInterval = BASE_SYNC_INTERVAL_MS;
    syncInterval = setInterval(syncGpsRecords, currentSyncInterval);
    unsubConnectivity = onConnectivityRestored(() => syncGpsRecords());
    syncGpsRecords();
    return true;
  },

  /** Start periodic sync without requiring a ticket (GPS records will have ticket_id = null). */
  startWithoutTicket(): void {
    if (syncInterval) return;
    currentTicketId = null;
    console.log('[GpsSyncManager] Started without ticket — GPS records will have no ticket_id');
    consecutiveFailures = 0;
    currentSyncInterval = BASE_SYNC_INTERVAL_MS;
    syncInterval = setInterval(syncGpsRecords, currentSyncInterval);
    unsubConnectivity = onConnectivityRestored(() => syncGpsRecords());
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

  /** Sync trip summaries to API. */
  async syncTripSummaries(): Promise<void> {
    if (!getIsOnline()) return;
    if (!storage.getString('driver')) return;
    const unsynced = gpsStorage.getUnsyncedTripSummaries();
    if (unsynced.length === 0) return;

    for (const s of unsynced) {
      try {
        await gpsApi.saveTripSummary({
          ticket_id: s.ticket_id,
          started_at: s.started_at,
          ended_at: s.ended_at,
          total_distance_m: s.total_distance_m,
          total_duration_s: s.total_duration_s,
          max_speed_ms: s.max_speed_ms,
          avg_speed_ms: s.avg_speed_ms,
          hard_brakes: s.hard_brakes,
          hard_corners: s.hard_corners,
          total_idle_time_s: s.total_idle_time_s,
        });
        gpsStorage.markTripSummariesSynced([s.id]);
        console.log(`[GpsSyncManager] Trip summary synced — ticket: ${s.ticket_id}`);
      } catch (err: any) {
        console.warn(`[GpsSyncManager] Trip summary sync failed: ${err.message}`);
      }
    }
  },

  /**
   * Flush orphaned GPS records left from a force logout while offline.
   * Uses a direct fetch() with the saved auth token (from the original driver
   * session) — bypasses the normal request() pipeline to avoid:
   *   - Token swap race conditions with concurrent syncGpsRecords
   *   - Unintended token refresh that would use the new driver's refresh_token
   */
  async flushOrphaned(): Promise<void> {
    const orphanedToken = storage.getString('orphaned_gps_token');
    if (!orphanedToken) return;

    const unsynced = gpsStorage.getUnsynced();
    if (unsynced.length === 0) {
      storage.remove('orphaned_gps_token');
      return;
    }

    if (!getIsOnline()) {
      // Register a one-time listener to retry when connectivity is restored
      const unsub = onConnectivityRestored(() => {
        unsub();
        gpsSyncManager.flushOrphaned().catch(() => {});
      });
      return;
    }

    const baseUrl = Config.API_BASE_URL || '';
    console.log(`[GpsSyncManager] Flushing ${unsynced.length} orphaned GPS records with saved token`);

    let totalSynced = 0;
    try {
      for (let i = 0; i < unsynced.length; i += BATCH_SIZE) {
        if (!getIsOnline()) break;
        const batch = unsynced.slice(i, i + BATCH_SIZE);
        const records = batch.map(r => ({
          client_id: r.id,
          ticket_id: r.ticket_id,
          latitude: r.latitude,
          longitude: r.longitude,
          speed: r.speed,
          heading: r.heading,
          altitude: r.altitude,
          accuracy: r.accuracy,
          recorded_at: r.recorded_at,
          is_speeding: r.is_speeding,
          is_idle: r.is_idle,
          accel_x: r.accel_x,
          accel_y: r.accel_y,
          zone: r.zone,
        }));
        try {
          const res = await fetch(`${baseUrl}/tracking/gps`, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              Authorization: `Bearer ${orphanedToken}`,
            },
            body: JSON.stringify({records}),
          });
          if (!res.ok) {
            console.warn(`[GpsSyncManager] Orphaned batch failed: HTTP ${res.status}`);
            break; // Token expired or invalid — stop trying
          }
          gpsStorage.markSynced(batch.map(r => r.id));
          totalSynced += batch.length;
        } catch (err: any) {
          console.warn(`[GpsSyncManager] Orphaned batch failed: ${err.message}`);
          break;
        }
      }
      console.log(`[GpsSyncManager] Orphaned flush: ${totalSynced}/${unsynced.length} records uploaded`);
    } finally {
      storage.remove('orphaned_gps_token');
      gpsStorage.clearSynced();
    }
  },

  /**
   * Flush leftover unsynced GPS records on app startup.
   * Records already have ticket_id stamped from when they were recorded.
   * No interval or tracking started — just sends and done.
   */
  async flushUnsynced(): Promise<void> {
    if (!getIsOnline()) return;
    // Check if driver is still logged in before making API calls
    if (!storage.getString('driver')) return;
    const unsynced = gpsStorage.getUnsynced();
    if (unsynced.length === 0) {
      await gpsSyncManager.syncTripSummaries();
      return;
    }
    // Flush directly — bypass the currentTicketId check since these are
    // leftover records from a previous session that already have ticket_id stamped
    console.log(`[GpsSyncManager] Flushing ${unsynced.length} leftover GPS records`);
    let totalSynced = 0;
    for (let i = 0; i < unsynced.length; i += BATCH_SIZE) {
      if (!getIsOnline()) break;
      const batch = unsynced.slice(i, i + BATCH_SIZE);
      const records = batch.map(r => ({
        client_id: r.id,
        ticket_id: r.ticket_id,
        latitude: r.latitude,
        longitude: r.longitude,
        speed: r.speed,
        heading: r.heading,
        altitude: r.altitude,
        accuracy: r.accuracy,
        recorded_at: r.recorded_at,
        is_speeding: r.is_speeding,
        is_idle: r.is_idle,
        accel_x: r.accel_x,
        accel_y: r.accel_y,
        zone: r.zone,
      }));
      try {
        await gpsApi.saveRecords(records);
        gpsStorage.markSynced(batch.map(r => r.id));
        totalSynced += batch.length;
      } catch (err: any) {
        console.warn(`[GpsSyncManager] Flush batch failed: ${err.message}`);
      }
    }
    console.log(`[GpsSyncManager] Flushed ${totalSynced}/${unsynced.length} records`);
    await gpsSyncManager.syncTripSummaries();
  },
};
