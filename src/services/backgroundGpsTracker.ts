import {Platform, PermissionsAndroid, AppState} from 'react-native';
import type {AppStateStatus} from 'react-native';
import Geolocation from 'react-native-geolocation-service';
import {gpsStorage} from './gpsStorage';
import {gpsSyncManager} from './gpsSyncManager';
import {showToast} from '../utils/toast';
import {getIsOnline, onConnectivityRestored, onConnectivityLost} from '../hooks/useNetworkStatus';

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
// GPS fetches ONLY in foreground. Stop on background/killed.

function setupAppStateListener() {
  if (appStateSubscription) return;
  appStateSubscription = AppState.addEventListener('change', (state: AppStateStatus) => {
    if (state === 'active') {
      if (permissionDenied) {
        // User might have granted permission in Settings — retry
        console.log('[GPS] App foregrounded — retrying after permission denial');
        permissionDenied = false;
        backgroundGpsTracker.startAlways(pendingTicketId).catch(() => {});
      } else if (running && watchId === null) {
        // Normal resume from background
        console.log('[GPS] App foregrounded — resuming GPS');
        startWatch();
      }
    } else if (state === 'background' || state === 'inactive') {
      // App went to background — stop GPS immediately
      if (watchId !== null) {
        console.log('[GPS] App backgrounded — stopping GPS');
        stopWatch();
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

function notifyListeners(pos: GpsPosition) {
  for (const cb of listeners) {
    try { cb(pos); } catch {}
  }
}

async function requestPermissions(): Promise<boolean> {
  if (Platform.OS === 'ios') {
    const status = await Geolocation.requestAuthorization('whenInUse');
    return status === 'granted' || status === 'restricted';
  }
  const granted = await PermissionsAndroid.request(
    PermissionsAndroid.PERMISSIONS.ACCESS_FINE_LOCATION,
    {title: 'Location Permission', message: 'Vehicle tracking needs access to your location.', buttonPositive: 'OK'},
  );
  return granted === PermissionsAndroid.RESULTS.GRANTED;
}

export async function requestLocationPermissions(): Promise<boolean> {
  return requestPermissions();
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

      // Only start GPS if app is currently in foreground
      if (AppState.currentState === 'active') {
        startWatch();
      }
      setupAppStateListener();

      running = true;
      console.log(`[GPS] Started — foreground only — ticket: ${ticketId || 'none'}`);
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

  /** Stop GPS tracking completely. */
  stop(): void {
    if (!running && watchId === null && !permissionDenied) return;

    running = false;
    starting = false;
    permissionDenied = false;
    pendingTicketId = null;
    stopWatch();
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
    console.log('[GPS] Stopped');
  },

  /** Stop GPS, upload pending records, clear only uploaded records, then logout. */
  async clearAllData(): Promise<void> {
    clearing = true;
    stopWatch();
    removeAppStateListener();
    connectivityRestoredUnsub?.();
    connectivityRestoredUnsub = null;
    connectivityLostUnsub?.();
    connectivityLostUnsub = null;
    isOfflineMode = false;

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
    console.log('[GPS] Logout complete');
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

  /** No-op — kept for OfflineSyncContext compatibility. */
  async autoResume(): Promise<void> {
    // Foreground-only mode: no background/killed state to resume from.
    // GPS starts fresh via startAlways() after login.
    console.log('[GPS] autoResume skipped — foreground-only mode');
  },
};
