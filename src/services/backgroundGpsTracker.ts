import {Platform, PermissionsAndroid, AppState, NativeModules} from 'react-native';
import type {AppStateStatus} from 'react-native';
import Config from 'react-native-config';
import Geolocation from 'react-native-geolocation-service';
import {gpsStorage} from './gpsStorage';
import {gpsSyncManager} from './gpsSyncManager';
import {storage} from './storage';
import {DeviceEventEmitter} from 'react-native';
import {startTrackingService, stopTrackingService} from './trackingForegroundService';
import {showToast} from '../utils/toast';
import {getIsOnline, onConnectivityRestored, onConnectivityLost} from '../hooks/useNetworkStatus';

const {LocationTrackingModule} = NativeModules;

export type GpsPosition = {
  latitude: number;
  longitude: number;
  speed: number;
  heading: number;
  altitude: number;
  accuracy: number;
  timestamp: number;
};

export type BehaviorData = {
  is_speeding?: boolean;
  is_idle?: boolean;
  accel_x?: number | null;
  accel_y?: number | null;
  zone?: string | null;
};

type GpsListener = (position: GpsPosition) => void;

let running = false;
let starting = false;
let clearing = false; // Guard against clearAllData/startAlways race
let permissionDenied = false; // True if permission was denied — retry on foreground
let pendingTicketId: number | null = null; // Ticket to use when retrying after permission grant
let watchId: number | null = null;
let lastPosition: GpsPosition | null = null;
let lastSavedPosition: {latitude: number; longitude: number} | null = null;
const MIN_DISTANCE_TO_SAVE = 5; // metres — only save when moved this far
let wasStationary = false; // true after first stationary fix is saved — suppresses drift
let currentBehavior: BehaviorData = {};
const listeners = new Set<GpsListener>();
let appStateSubscription: {remove: () => void} | null = null;
let connectivityRestoredUnsub: (() => void) | null = null;
let connectivityLostUnsub: (() => void) | null = null;
let isOfflineMode = false;

// ─── Idle Auto-Logout ────────────────────────────────────────────
// Auto-logout if no new GPS record is saved for 2 hours.
// A GPS record is only saved when the truck's position actually changes (> 5m),
// so "no record" = truck hasn't moved.
const IDLE_LOGOUT_MS = 2 * 60 * 60 * 1000; // 2 hours
const IDLE_WARNING_MS = (2 * 60 - 10) * 60 * 1000; // 1h 50m (10 min before logout)
export const IDLE_AUTO_LOGOUT_EVENT = 'idle_auto_logout';
let lastMovementTime: number = Date.now();
let idleCheckInterval: ReturnType<typeof setInterval> | null = null;
let idleWarningShown = false;

/** Haversine distance in metres between two lat/lng points. */
function haversineDistance(
  lat1: number, lon1: number, lat2: number, lon2: number,
): number {
  const R = 6371000;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

// ─── App Lifecycle ───────────────────────────────────────────────
// JS GPS runs in foreground. Native service handles background/killed.

function setupAppStateListener() {
  if (appStateSubscription) return;
  appStateSubscription = AppState.addEventListener('change', (state: AppStateStatus) => {
    if (state === 'active') {
      if (permissionDenied) {
        console.log('[GPS] App foregrounded — retrying after permission denial');
        permissionDenied = false;
        backgroundGpsTracker.startAlways(pendingTicketId).catch(() => {});
      } else if (running) {
        // 1. Tell native to stop saving FIRST — prevents race condition
        if (Platform.OS === 'android' && LocationTrackingModule) {
          LocationTrackingModule.setJsAlive(true).catch(() => {});
        }
        // 2. Resume JS watcher
        if (watchId === null) {
          console.log('[GPS] App foregrounded — resuming JS GPS');
          startWatch();
        }
        // 3. Import native records (WRITE_BATCH_SIZE=1 means all records are already flushed)
        importNativeRecords().then(count => {
          if (count > 0) console.log(`[GPS] Imported ${count} native records from background`);
        });
      }
    } else if (state === 'background' || state === 'inactive') {
      // Stop JS watcher — native service continues tracking in background
      if (watchId !== null) {
        console.log('[GPS] App backgrounded — JS GPS stopped, native service continues');
        stopWatch();
      }
      // Tell native service JS is dead — native starts saving records
      if (Platform.OS === 'android' && LocationTrackingModule) {
        LocationTrackingModule.setJsAlive(false).catch(() => {});
      }
    }
  });
}

function removeAppStateListener() {
  if (appStateSubscription) {
    appStateSubscription.remove();
    appStateSubscription = null;
  }
}

// ─── Helpers ─────────────────────────────────────────────────────

/** Pass API credentials to native service for background uploads. */
function syncApiCredentialsToNative() {
  if (Platform.OS !== 'android' || !LocationTrackingModule) return;
  const baseUrl = Config.API_BASE_URL || '';
  const token = storage.getString('access_token') || '';
  if (baseUrl && token) {
    LocationTrackingModule.setApiCredentials(baseUrl, token).catch(() => {});
  }
}

function notifyListeners(pos: GpsPosition) {
  for (const cb of listeners) {
    try { cb(pos); } catch {}
  }
}

async function requestPermissions(): Promise<boolean> {
  if (Platform.OS === 'ios') {
    const status = await Geolocation.requestAuthorization('always');
    return status === 'granted' || status === 'restricted';
  }
  const fineGranted = await PermissionsAndroid.request(
    PermissionsAndroid.PERMISSIONS.ACCESS_FINE_LOCATION,
    {title: 'Location Permission', message: 'Vehicle tracking needs access to your location.', buttonPositive: 'OK'},
  );
  if (fineGranted !== PermissionsAndroid.RESULTS.GRANTED) return false;
  // Request background location for Android 10+
  if (Number(Platform.Version) >= 29) {
    const bgGranted = await PermissionsAndroid.request(
      PermissionsAndroid.PERMISSIONS.ACCESS_BACKGROUND_LOCATION,
      {title: 'Background Location', message: 'Allow background location so tracking continues when the screen is off.', buttonPositive: 'OK'},
    );
    if (bgGranted !== PermissionsAndroid.RESULTS.GRANTED) {
      showToast('info', 'Limited Tracking', 'GPS will only work while the app is open.');
    }
  }
  return true;
}

export async function requestLocationPermissions(): Promise<boolean> {
  return requestPermissions();
}

/**
 * Import GPS records collected by the native Android service while the app was in background/killed.
 * Moves them into MMKV gpsStorage so gpsSyncManager can sync them to the API.
 */
async function importNativeRecords(): Promise<number> {
  if (Platform.OS !== 'android' || !LocationTrackingModule) return 0;
  try {
    const records = await LocationTrackingModule.getStoredRecords();
    if (!records || records.length === 0) return 0;

    // Deduplicate by timestamp+coordinates
    const existing = new Set(
      gpsStorage.getAll().map(r => `${r.recorded_at}_${r.latitude}_${r.longitude}`),
    );

    let imported = 0;
    for (const r of records) {
      if (r.synced) continue;
      const key = `${r.recorded_at}_${r.latitude}_${r.longitude}`;
      if (existing.has(key)) continue;
      gpsStorage.addRecord({
        ticket_id: r.ticket_id || null,
        latitude: r.latitude,
        longitude: r.longitude,
        speed: r.speed || 0,
        heading: r.heading ?? 0,
        altitude: r.altitude || null,
        accuracy: r.accuracy || null,
        recorded_at: r.recorded_at,
        is_speeding: r.is_speeding || false,
        is_idle: r.is_idle || false,
      });
      imported++;
    }

    // Clear native records after import
    try {
      await LocationTrackingModule.clearStoredRecords();
    } catch (clearErr: any) {
      console.warn('[GPS] clearStoredRecords failed, retrying:', clearErr.message);
      try { await LocationTrackingModule.clearStoredRecords(); } catch {}
    }
    return imported;
  } catch (e: any) {
    console.error('[GPS] Failed to import native records:', e.message);
    return 0;
  }
}

// ─── Position Handling ───────────────────────────────────────────

function handlePosition(position: any) {
  const {latitude, longitude, speed, heading, altitude, accuracy} = position.coords;
  const speedAvailable = typeof speed === 'number' && !isNaN(speed) && speed >= 0;
  const currentSpeed = speedAvailable ? speed : 0;

  const pos: GpsPosition = {
    latitude,
    longitude,
    speed: currentSpeed,
    heading: heading ?? 0,
    altitude: altitude || 0,
    accuracy: accuracy || 0,
    timestamp: position.timestamp,
  };
  lastPosition = pos;
  notifyListeners(pos);

  console.log(`[GPS] Position: lat=${latitude.toFixed(6)}, lng=${longitude.toFixed(6)}, speed=${currentSpeed.toFixed(1)}, accuracy=${accuracy?.toFixed(0)}m`);

  // Update native heartbeat so it knows JS is actively recording
  if (Platform.OS === 'android' && LocationTrackingModule) {
    LocationTrackingModule.updateJsHeartbeat().catch(() => {});
  }

  // Skip very inaccurate fixes
  if (accuracy != null && accuracy > 200) {
    console.log(`[GPS] Skipping inaccurate fix: ${accuracy.toFixed(0)}m`);
    return;
  }

  // Stationary detection: skip GPS drift when truck is not moving
  const isStationary = currentSpeed < 1.0; // < 1 m/s ≈ 3.6 km/h

  if (isStationary) {
    if (wasStationary) {
      // Already saved the "stopped at" position — skip drift records
      return;
    }
    // First stationary fix — save it so we know WHERE the truck stopped
    wasStationary = true;
  } else {
    // Moving — reset stationary flag
    wasStationary = false;
  }

  // Only save when truck has moved > 5m from last saved position
  if (!isStationary && lastSavedPosition) {
    const dist = haversineDistance(
      lastSavedPosition.latitude, lastSavedPosition.longitude,
      latitude, longitude,
    );
    if (dist < MIN_DISTANCE_TO_SAVE) {
      return; // Truck hasn't moved — skip saving
    }
  }

  lastSavedPosition = {latitude, longitude};

  // Reset idle auto-logout timer — a new GPS record means position changed
  lastMovementTime = Date.now();
  idleWarningShown = false;

  gpsStorage.addRecord({
    ticket_id: gpsSyncManager.getTicketId(),
    latitude,
    longitude,
    speed: currentSpeed,
    heading: heading ?? 0,
    altitude: altitude || null,
    accuracy: accuracy || null,
    recorded_at: new Date(position.timestamp).toISOString(),
    ...currentBehavior,
  });

  console.log(`[GPS] Record saved — lat=${latitude.toFixed(6)}, lng=${longitude.toFixed(6)}`);
}

function handleError(error: any) {
  console.warn('[GPS] Error:', error.code, error.message);
  if (error.code === 1) {
    console.error('[GPS] Location permission denied — stopping tracking');
    showToast('error', 'GPS Permission Lost', 'Location permission was revoked. Tracking stopped.');
    backgroundGpsTracker.stop();
  }
}

// ─── Idle Auto-Logout Timer ──────────────────────────────────────

async function showIdleWarningNotification() {
  try {
    const notifee = (await import('@notifee/react-native')).default;
    const {AndroidImportance} = await import('@notifee/react-native');
    const channelId = await notifee.createChannel({
      id: 'tksync-idle',
      name: 'Idle Warnings',
      importance: AndroidImportance.HIGH,
      sound: 'default',
    });
    await notifee.displayNotification({
      title: 'Inactivity Warning',
      body: 'No movement detected for nearly 2 hours. You will be logged out in 10 minutes.',
      android: {channelId, smallIcon: 'ic_launcher', importance: AndroidImportance.HIGH, sound: 'default'},
      ios: {sound: 'default', foregroundPresentationOptions: {banner: true, sound: true, badge: true}},
    });
  } catch (e) {
    console.warn('[GPS] Failed to show idle warning notification:', e);
  }
}

function startIdleCheck() {
  stopIdleCheck();
  lastMovementTime = Date.now();
  idleWarningShown = false;
  idleCheckInterval = setInterval(() => {
    const idleMs = Date.now() - lastMovementTime;

    // Warning at 1h 50m
    if (idleMs >= IDLE_WARNING_MS && !idleWarningShown) {
      idleWarningShown = true;
      console.log('[GPS] Idle warning — no movement for 1h 50m');
      showIdleWarningNotification();
    }

    // Auto-logout at 2h
    if (idleMs >= IDLE_LOGOUT_MS) {
      console.log('[GPS] Idle auto-logout — no movement for 2 hours');
      stopIdleCheck();
      DeviceEventEmitter.emit(IDLE_AUTO_LOGOUT_EVENT);
    }
  }, 60_000); // Check every 60 seconds
}

function stopIdleCheck() {
  if (idleCheckInterval) {
    clearInterval(idleCheckInterval);
    idleCheckInterval = null;
  }
  idleWarningShown = false;
}

// ─── Watch Control ───────────────────────────────────────────────

function stopWatch() {
  if (watchId !== null) {
    Geolocation.clearWatch(watchId);
    watchId = null;
    console.log('[GPS] watchPosition stopped');
  }
}

function startWatch() {
  if (watchId !== null) return;

  // When offline, use GPS-only mode (no Google A-GPS servers needed)
  const online = getIsOnline();
  isOfflineMode = !online;

  watchId = Geolocation.watchPosition(
    (position) => handlePosition(position),
    (error) => handleError(error),
    {
      enableHighAccuracy: true,
      distanceFilter: 5,
      interval: 5000,
      fastestInterval: 5000,
      showLocationDialog: true,
      forceRequestLocation: true,
      maximumAge: 10000,
      // When offline, bypass Google FusedLocationProvider and use Android's
      // raw LocationManager with GPS_PROVIDER — works without network
      forceLocationManager: !online,
    },
  );
  console.log(`[GPS] watchPosition started (5s interval, forceLocationManager=${!online})`);

  // Listen for network going OFF — switch to GPS-only (forceLocationManager)
  if (!connectivityLostUnsub) {
    connectivityLostUnsub = onConnectivityLost(() => {
      if (running && !isOfflineMode) {
        console.log('[GPS] Network lost — restarting GPS with forceLocationManager (satellite-only)');
        stopWatch();
        isOfflineMode = true;
        startWatch();
      }
    });
  }

  // Listen for network coming BACK — switch to FusedLocationProvider
  if (!connectivityRestoredUnsub) {
    connectivityRestoredUnsub = onConnectivityRestored(() => {
      if (running && isOfflineMode) {
        console.log('[GPS] Network restored — restarting GPS with FusedLocationProvider');
        stopWatch();
        isOfflineMode = false;
        startWatch();
      }
    });
  }
}

// ─── Public API ──────────────────────────────────────────────────

export const backgroundGpsTracker = {
  /**
   * Start GPS tracking after login.
   * Only fetches in foreground. Stops on background/logout.
   */
  async startAlways(ticketId?: number | null): Promise<boolean> {
    if (running || starting || clearing) {
      console.log(`[GPS] startAlways skipped — running=${running}, starting=${starting}, clearing=${clearing}`);
      return running;
    }
    starting = true;

    try {
      const hasPermission = await requestPermissions();
      if (!hasPermission) {
        console.warn('[GPS] Permission denied — will retry when app returns to foreground');
        permissionDenied = true;
        pendingTicketId = ticketId ?? null;
        setupAppStateListener(); // Listen for foreground to retry
        return false;
      }
      permissionDenied = false;

      // Start sync manager for uploading records
      const hasTicket = await gpsSyncManager.start(ticketId);
      if (!hasTicket) {
        gpsSyncManager.startWithoutTicket();
      }

      if (!getIsOnline()) {
        showToast('info', 'Offline Mode', 'GPS data will be uploaded when connection is restored.');
      }

      // Import any leftover native records before starting fresh
      await importNativeRecords();

      // Start native background service (Android)
      syncApiCredentialsToNative();
      await startTrackingService(gpsSyncManager.getTicketId());
      if (Platform.OS === 'android' && LocationTrackingModule) {
        LocationTrackingModule.setJsAlive(true).catch(() => {});
      }

      // Start JS GPS if app is currently in foreground
      if (AppState.currentState === 'active') {
        startWatch();
      }
      setupAppStateListener();

      running = true;
      startIdleCheck();
      console.log(`[GPS] Started — native background enabled — ticket: ${ticketId || 'none'}`);
      return true;
    } catch (err: any) {
      console.error(`[GPS] startAlways failed: ${err.message}`);
      return false;
    } finally {
      starting = false;
    }
  },

  /**
   * Start with ticket requirement (used from VehicleTrackingScreen).
   */
  async start(ticketId?: number | null, silent = false): Promise<boolean> {
    if (running || starting || clearing) return running;
    starting = true;

    try {
      const hasPermission = await requestPermissions();
      if (!hasPermission) {
        if (!silent) {
          showToast('error', 'Permission Denied', 'Location permission is required for GPS tracking.');
        }
        return false;
      }

      const hasTicket = await gpsSyncManager.start(ticketId);
      if (!hasTicket) {
        if (!silent) {
          showToast('error', 'No Active Ticket', 'GPS tracking requires an in-process delivery.');
        }
        return false;
      }

      gpsSyncManager.setOnTicketInactive(() => {
        backgroundGpsTracker.stop();
        showToast('info', 'Tracking Stopped', 'Ticket is no longer in process.');
      });

      if (AppState.currentState === 'active') {
        startWatch();
      }
      setupAppStateListener();

      running = true;
      console.log(`[GPS] Started — foreground only — ticket: ${gpsSyncManager.getTicketId()}`);
      return true;
    } catch (err: any) {
      console.error(`[GPS] start failed: ${err.message}`);
      return false;
    } finally {
      starting = false;
    }
  },

  /** Stop UI tracking — native service continues collecting GPS silently. */
  stop(): void {
    if (!running && watchId === null && !permissionDenied) return;

    running = false;
    starting = false;
    permissionDenied = false;
    pendingTicketId = null;
    stopWatch();
    stopIdleCheck();
    removeAppStateListener();
    connectivityRestoredUnsub?.();
    connectivityRestoredUnsub = null;
    connectivityLostUnsub?.();
    connectivityLostUnsub = null;
    isOfflineMode = false;
    gpsSyncManager.stop();
    lastPosition = null;
    lastSavedPosition = null;
    wasStationary = false;
    // Switch native service to silent mode — keeps collecting GPS in background
    if (Platform.OS === 'android' && LocationTrackingModule) {
      LocationTrackingModule.setJsAlive(false).catch(() => {});
      LocationTrackingModule.setSilentMode(true).catch(() => {});
    }
    console.log('[GPS] UI stopped — native GPS continues silently');
  },

  /** Stop GPS, upload pending records, fully stop native service, then logout. */
  async clearAllData(): Promise<void> {
    if (clearing) return; // Prevent double execution
    clearing = true;
    stopWatch();
    stopIdleCheck();
    removeAppStateListener();
    connectivityRestoredUnsub?.();
    connectivityRestoredUnsub = null;
    connectivityLostUnsub?.();
    connectivityLostUnsub = null;
    isOfflineMode = false;

    // Stop native service FIRST so it stops writing new records
    await stopTrackingService();

    // Now import native records (no new ones being written)
    await importNativeRecords();
    if (Platform.OS === 'android' && LocationTrackingModule) {
      LocationTrackingModule.clearStoredRecords().catch(() => {});
    }

    try {
      const unsynced = gpsStorage.getUnsynced();
      if (unsynced.length > 0) {
        console.log(`[GPS] ${unsynced.length} unsynced records — uploading before logout...`);
        await gpsSyncManager.flushUnsynced();

        const stillUnsynced = gpsStorage.getUnsynced();
        if (stillUnsynced.length === 0) {
          console.log('[GPS] All records uploaded — clearing storage');
          gpsStorage.clear();
        } else {
          console.log(`[GPS] ${stillUnsynced.length} records failed to upload — keeping for next login`);
          gpsStorage.clearSynced();
        }
      } else {
        gpsStorage.clear();
      }
    } catch (err: any) {
      console.warn(`[GPS] clearAllData flush error: ${err.message}`);
    }

    gpsSyncManager.stop();
    running = false;
    starting = false;
    permissionDenied = false;
    pendingTicketId = null;
    lastPosition = null;
    lastSavedPosition = null;
    wasStationary = false;
    currentBehavior = {};
    clearing = false;
    console.log('[GPS] Logout complete — native service stopped');
  },

  /** Whether tracking is active. */
  isRunning(): boolean {
    return running;
  },

  /** Get last known position. */
  getLastPosition(): GpsPosition | null {
    return lastPosition;
  },

  /** Whether idle (kept for VehicleTrackingScreen compatibility). */
  isCurrentlyIdle(): boolean {
    return false; // No idle detection in foreground-only mode
  },

  /** Subscribe to position updates. */
  addListener(cb: GpsListener): () => void {
    listeners.add(cb);
    return () => { listeners.delete(cb); };
  },

  /** Attach behavior data to GPS records. */
  setBehavior(data: BehaviorData): void {
    currentBehavior = data;
  },

  /** Save a trip summary. */
  saveTripSummary(summary: {
    ticket_id: number | null;
    started_at: string;
    ended_at: string;
    total_distance_m: number;
    total_duration_s: number;
    max_speed_ms: number;
    avg_speed_ms: number;
    hard_brakes: number;
    hard_corners: number;
    total_idle_time_s: number;
  }): void {
    gpsStorage.addTripSummary(summary);
    gpsSyncManager.syncTripSummaries();
  },

  /** Import any leftover native records on app startup. */
  async autoResume(): Promise<void> {
    // Import any GPS records left in native storage (from previous background session)
    const imported = await importNativeRecords();
    if (imported > 0) {
      console.log(`[GPS] autoResume — imported ${imported} leftover native records`);
      if (getIsOnline()) {
        gpsSyncManager.flushUnsynced().catch(() => {});
      } else {
        const unsub = onConnectivityRestored(() => {
          unsub();
          gpsSyncManager.flushUnsynced().catch(() => {});
        });
      }
    }
  },
};
