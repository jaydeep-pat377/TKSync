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
import {getIsOnline, onConnectivityRestored} from '../hooks/useNetworkStatus';

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
        // 2. Pause idle check — prevent false logout before native records are imported
        stopIdleCheck();
        // 3. Resume JS watcher
        if (watchId === null) {
          console.log('[GPS] App foregrounded — resuming JS GPS');
          startWatch();
        }
        // 4. Import native records, update idle timer, then restart idle interval
        importNativeRecordsAndUpdateIdle()
          .catch(() => {
            // Import failed — reset timer to avoid false logout with stale data
            lastMovementTime = Date.now();
          })
          .finally(() => resumeIdleCheck());
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
 * Wait for any in-flight native GPS upload to complete.
 * After setJsAlive(true), no NEW uploads start, but one may be mid-flight.
 * Polls the native isUploading flag every 500ms, up to 20 seconds max.
 */
async function waitForNativeUpload(): Promise<void> {
  if (!LocationTrackingModule?.isUploading) return;
  const maxWait = 20000;
  const start = Date.now();
  while (Date.now() - start < maxWait) {
    try {
      const uploading = await LocationTrackingModule.isUploading();
      if (!uploading) return;
      console.log('[GPS] Waiting for native upload to finish...');
    } catch {
      return; // Module not available — skip wait
    }
    await new Promise<void>(resolve => setTimeout(resolve, 500));
  }
  console.warn('[GPS] Native upload still running after 20s — importing anyway');
}

/**
 * Import GPS records collected by the native Android service while the app was in background/killed.
 * Moves them into MMKV gpsStorage so gpsSyncManager can sync them to the API.
 */
async function importNativeRecords(): Promise<number> {
  if (Platform.OS !== 'android' || !LocationTrackingModule) return 0;
  try {
    // Wait for any in-flight native upload to complete before reading records.
    // Without this, we import records that native is actively uploading,
    // creating duplicate routes on the server.
    await waitForNativeUpload();

    const records = await LocationTrackingModule.getStoredRecords();
    if (!records || records.length === 0) return 0;

    let imported = 0;
    for (const r of records) {
      if (r.synced) continue;
      // Preserve the original native ID — if native already uploaded this record,
      // gpsSyncManager will send the same client_id, avoiding duplicate routes.
      const nativeId = r.id || `native_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
      const added = gpsStorage.importRecord(nativeId, {
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
      if (added) imported++;
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

/**
 * Import native background GPS records and update the idle timer.
 * If native records show the truck was moving while the app was backgrounded,
 * reset the idle timer to prevent false auto-logout on foreground resume.
 * If no new positions (truck was stationary), leave the idle timer as-is
 * so it correctly reflects the last actual movement time.
 */
async function importNativeRecordsAndUpdateIdle(): Promise<void> {
  const count = await importNativeRecords();
  if (count > 0) {
    console.log(`[GPS] Imported ${count} native records from background`);
    // New positions imported — truck was moving in background, reset idle timer
    lastMovementTime = Date.now();
    idleWarningShown = false;
  }
  // count === 0: truck was stationary in background — lastMovementTime stays as-is,
  // idle timer will correctly fire if 2h has elapsed since last real movement.
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

  // Skip mock/emulator GPS — default Android emulator location is Google HQ (37.42, -122.08)
  if (__DEV__ && position.mocked) {
    console.log('[GPS] Skipping mocked/emulator GPS position');
    return;
  }

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

/** Start idle check from scratch — resets timer to now. Used on GPS tracker start. */
function startIdleCheck() {
  stopIdleCheck();
  lastMovementTime = Date.now();
  idleWarningShown = false;
  resumeIdleCheck();
}

/** Resume idle interval without resetting lastMovementTime. Used after foreground import. */
function resumeIdleCheck() {
  if (idleCheckInterval) return; // already running
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

  // FusedLocationProvider works with GPS satellites even without internet —
  // A-GPS just speeds up the initial satellite fix. Using forceLocationManager
  // with enableHighAccuracy causes timeout errors on many Android devices
  // (see: github.com/Agontuk/react-native-geolocation-service/issues/402).
  // Always use FusedLocationProvider for reliability.
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
    },
  );
  console.log('[GPS] watchPosition started (5s interval, FusedLocationProvider)');
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
          // Save driver-scoped auth token so orphaned records can be uploaded
          // on next login with the correct driver identity.
          // Only save if driver is still in storage (not after normal logout
          // where the token is company-scoped and has no driver identity).
          const token = storage.getString('access_token');
          const driver = storage.getString('driver');
          if (token && driver) {
            storage.set('orphaned_gps_token', token);
            console.log(`[GPS] ${stillUnsynced.length} records orphaned — saved auth token for deferred upload`);
          } else {
            console.log(`[GPS] ${stillUnsynced.length} records failed to upload — no driver token to save`);
          }
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
