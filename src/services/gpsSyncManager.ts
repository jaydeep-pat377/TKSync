import {Platform, NativeModules, DeviceEventEmitter} from 'react-native';
import {gpsStorage} from './gpsStorage';
import {gpsApi, trackingApi, heartbeatApi} from './api';
import {getIsOnline, onConnectivityRestored} from '../hooks/useNetworkStatus';
import {storage} from './storage';
import {createMMKV} from 'react-native-mmkv';
import Config from 'react-native-config';
import {mqttService} from './mqttService';
import {IDLE_AUTO_LOGOUT_EVENT} from './backgroundGpsTracker';
import {captureError} from './sentry';

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
let currentTicketCode: string | null = null;
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
    currentTicketCode = res.data?.current_load?.ticket_code ?? null;
    // Sync ticket code to native MQTT so background publishes include it
    mqttService.setTicketCode(currentTicketCode);
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

const IDLE_LOGOUT_MS = 2 * 60 * 60 * 1000; // 2 hours — must match backgroundGpsTracker
const IDLE_STORAGE_KEY = 'last_movement_time';

async function syncGpsRecords(): Promise<void> {
  if (isSyncing || !getIsOnline()) return;

  // Check if driver is still logged in before making API calls
  const driverData = storage.getString('driver');
  if (!driverData) {
    console.log('[GpsSyncManager] Driver not logged in — skipping sync');
    return;
  }

  // Background idle check: JS idle timer in backgroundGpsTracker stops when app
  // is backgrounded (JS timers are unreliable in BG). This sync interval (30s)
  // continues running, so check idle timeout here as a backup.
  const lastMovement = storage.getNumber(IDLE_STORAGE_KEY);
  if (lastMovement && lastMovement > 0) {
    const idleMs = Date.now() - lastMovement;
    if (idleMs >= IDLE_LOGOUT_MS) {
      console.log(`[GpsSyncManager] Idle auto-logout — no movement for ${Math.round(idleMs / 60000)} minutes`);
      DeviceEventEmitter.emit(IDLE_AUTO_LOGOUT_EVENT);
      return;
    }
  }

  // GPS data is published via MQTT in real-time (backgroundGpsTracker.ts).
  // DO NOT mark records as synced here — only MQTT publish should mark them synced.
  // Marking them here would silently discard offline records that haven't been published yet.
  isSyncing = true;
  try {
    await heartbeatApi.ping().catch(() => {});
    await refreshTicket();
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

  /** Get the current ticket code. */
  getTicketCode(): string | null {
    return currentTicketCode;
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
        captureError(err instanceof Error ? err : new Error(String(err)), {source: 'trip_summary_sync', ticket_id: String(s.ticket_id)});
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

    // Orphaned records from previous sessions — try to publish via MQTT before clearing.
    // These records were saved while offline during a force logout.
    const unsynced = gpsStorage.getUnsynced();
    if (unsynced.length > 0) {
      console.log(`[GpsSyncManager] ${unsynced.length} orphaned GPS records — attempting MQTT publish before clearing`);
      // Don't delete them here — autoResume() will try to publish them via MQTT.
      // If MQTT succeeds, they'll be marked synced. If not, they stay for next attempt.
      // Only remove the orphaned token flag so this doesn't re-run.
    }
    storage.remove('orphaned_gps_token');
    // Only clear records that were successfully synced — keep unsynced for MQTT publish
    gpsStorage.clearSynced();
  },

  /**
   * Flush leftover unsynced GPS records on app startup.
   * Records already have ticket_id stamped from when they were recorded.
   * No interval or tracking started — just sends and done.
   */
  async flushUnsynced(): Promise<void> {
    // DO NOT mark GPS records as synced here — autoResume() handles publishing
    // them to MQTT. If MQTT was unavailable, records are kept for startAlways().
    // Only sync trip summaries here.
    await gpsSyncManager.syncTripSummaries();
  },
};
