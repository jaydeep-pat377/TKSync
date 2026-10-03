import {Platform, PermissionsAndroid, AppState, NativeModules, Alert, Linking} from 'react-native';
import type {AppStateStatus} from 'react-native';
import Config from 'react-native-config';
import Geolocation from 'react-native-geolocation-service';
import {orientation, SensorTypes, setUpdateIntervalForType} from 'react-native-sensors';
import type {Subscription} from 'rxjs';
import {gpsStorage} from './gpsStorage';
import {gpsSyncManager} from './gpsSyncManager';
import {mqttService} from './mqttService';
import {storage} from './storage';
import {DeviceEventEmitter} from 'react-native';
import {startTrackingService, stopTrackingService} from './trackingForegroundService';
import {showToast} from '../utils/toast';
import {getIsOnline, onConnectivityRestored, onConnectivityLost} from '../hooks/useNetworkStatus';
import {reportNativeGpsDiagnostics, detectBackgroundServiceDeath} from './gpsDiagnostics';
import {getLocationPermissionLevel} from './locationPermission';
import {captureError} from './sentry';
import {getDeviceId} from './deviceId';
import {setPipAutoEnter} from '../hooks/usePipMode';
import DeviceInfo from 'react-native-device-info';

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

/** Get battery level as percentage (0-100), returns null on failure.
 *  Cached for 30 seconds to avoid async overhead on every GPS fix (~1/s). */
let cachedBatteryLevel: number | null = null;
let batteryLastFetched = 0;
const BATTERY_CACHE_MS = 30_000;

async function getBatteryPercent(): Promise<number | null> {
  const now = Date.now();
  if (now - batteryLastFetched < BATTERY_CACHE_MS && cachedBatteryLevel !== null) {
    return cachedBatteryLevel;
  }
  try {
    const level = await DeviceInfo.getBatteryLevel();
    cachedBatteryLevel = level >= 0 ? Math.round(level * 100) : null;
    batteryLastFetched = now;
    return cachedBatteryLevel;
  } catch {
    return cachedBatteryLevel; // Return stale value on error
  }
}

let running = false;
let starting = false;
let clearing = false; // Guard against clearAllData/startAlways race
let permissionDenied = false; // True if permission was denied — retry on foreground
let pendingTicketId: number | null = null; // Ticket to use when retrying after permission grant
let watchId: number | null = null;
let lastPosition: GpsPosition | null = null;
let lastGpsFixTime: number = 0; // Date.now() of last accepted GPS fix — for freshness indicator
let firstGoodFixTime: number = 0; // Date.now() of first fix with accuracy < 25m — enables strict filter
let consecutiveAccuracyRejects = 0; // Re-opens the strict gate when GPS degrades for a sustained stretch
const ACCURACY_REWARMUP_REJECTS = 10; // ~10 rejected fixes — re-open the gate to 50m
let lastSavedPosition: {latitude: number; longitude: number} | null = null;
const MIN_DISTANCE_TO_SAVE = 5; // metres — only save when moved this far
let wasStationary = false; // true after first stationary fix is saved — suppresses drift
let stationaryPosition: {latitude: number; longitude: number} | null = null; // WHERE the truck stopped
let consecutiveMovingCount = 0;
const MOVING_CONFIRM_THRESHOLD = 2; // Require 2 consecutive moving fixes to clear stationary (captures U-turns faster)
const DISTANCE_CONFIRM_THRESHOLD = 15; // metres — floor for "moved far enough from stop to be real"
/** m/s of position change the reported speed does not explain — above this the fix is multipath. */
const MAX_UNEXPLAINED_SPEED = 10;
/**
 * Longest the map may go without a point while the truck is suppressed as
 * stationary. Drift suppression used to be able to hold for minutes during a
 * stop-start crawl, and the dispatcher saw a parked truck that was actually
 * driving. Only fires when something is happening — a genuinely parked truck
 * stays silent, which is the behaviour the dashboard already relies on.
 */
const STATIONARY_HEARTBEAT_MS = 15_000;
/** Metres from the stop, or m/s, that count as "something is happening". */
const HEARTBEAT_MIN_DRIFT = 5;
const HEARTBEAT_MIN_SPEED = 0.2;
/** Consecutive slow fixes before the moving counter is zeroed — see handlePosition. */
const SLOW_FIXES_TO_RESET = 2;
let consecutiveSlowCount = 0;
let lastHeartbeatAt = 0;
let stationaryPollTimer: ReturnType<typeof setInterval> | null = null;
let currentBehavior: BehaviorData = {};
const listeners = new Set<GpsListener>();
let appStateSubscription: {remove: () => void} | null = null;
let connectivityRestoredUnsub: (() => void) | null = null;
let nativeGpsSubscription: {remove: () => void} | null = null;

// ─── Compass / Heading State ─────────────────────────────────────
// Orientation sensor gives true compass heading on both platforms:
// Android: TYPE_ROTATION_VECTOR → SensorManager.getOrientation() → azimuth from north
// iOS: CMDeviceMotion with CMAttitudeReferenceFrameXMagneticNorthZVertical → yaw from north
//      (patched in react-native-sensors — see patches/react-native-sensors+7.3.6.patch)
let compassHeading: number | null = null;  // null = compass not yet received
let lastGpsHeading: number = 0;            // last reliable GPS heading while moving
let magnetometerSub: Subscription | null = null;

// ─── Idle Auto-Logout ────────────────────────────────────────────
// Auto-logout if no new GPS record is saved for 2 hours.
// A GPS record is only saved when the truck's position actually changes (> 5m),
// so "no record" = truck hasn't moved.
const IDLE_LOGOUT_MS = 2 * 60 * 60 * 1000; // 2 hours
const IDLE_WARNING_MS = (2 * 60 - 10) * 60 * 1000; // 1h 50m (10 min before logout)
export const IDLE_AUTO_LOGOUT_EVENT = 'idle_auto_logout';
const IDLE_STORAGE_KEY = 'last_movement_time';
let lastMovementTime: number = Date.now();
let idleCheckInterval: ReturnType<typeof setInterval> | null = null;
let idleWarningShown = false;

/** Persist lastMovementTime to storage so it survives app kill.
 *  Throttled to once per 30s — avoids MMKV write on every GPS fix. */
let lastMovementPersistTime = 0;
const MOVEMENT_PERSIST_INTERVAL_MS = 30_000;

function persistLastMovementTime() {
  const now = Date.now();
  if (now - lastMovementPersistTime < MOVEMENT_PERSIST_INTERVAL_MS) return;
  lastMovementPersistTime = now;
  storage.set(IDLE_STORAGE_KEY, lastMovementTime);
}

/** Force-persist lastMovementTime (call before app kill / background). */
function forcePeristLastMovementTime() {
  lastMovementPersistTime = Date.now();
  storage.set(IDLE_STORAGE_KEY, lastMovementTime);
}

/** Restore lastMovementTime from storage (app reopen after kill).
 *  If no persisted value exists (e.g. after clearAllData), reset to now
 *  so a new login doesn't inherit a stale in-memory value. */
function restoreLastMovementTime() {
  const saved = storage.getNumber(IDLE_STORAGE_KEY);
  if (saved && saved > 0) {
    lastMovementTime = saved;
  } else {
    lastMovementTime = Date.now();
  }
}

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

// ─── Compass (Orientation Sensor) ────────────────────────────────

function startCompass() {
  if (magnetometerSub) return;
  try {
    setUpdateIntervalForType(SensorTypes.orientation, 500); // 2 readings/sec
    magnetometerSub = orientation.subscribe(
      ({yaw}: {yaw: number; pitch: number; roll: number}) => {
        // yaw = azimuth from magnetic north in radians (both platforms):
        // Android: TYPE_ROTATION_VECTOR → SensorManager.getOrientation()
        // iOS: CMDeviceMotion with XMagneticNorthZVertical reference frame
        // Convert radians → degrees and normalize to 0–360
        compassHeading = (((yaw * 180) / Math.PI) + 360) % 360;
      },
      (err: any) => {
        console.warn('[GPS] Orientation sensor error:', err);
        magnetometerSub = null;
      },
    );
    console.log('[GPS] Compass (orientation sensor) started');
  } catch (e: any) {
    console.warn('[GPS] Failed to start orientation sensor:', e.message);
  }
}

function stopCompass() {
  if (magnetometerSub) {
    magnetometerSub.unsubscribe();
    magnetometerSub = null;
    console.log('[GPS] Compass (orientation sensor) stopped');
  }
}

/**
 * Resolve heading: use GPS heading when moving, best available fallback when stopped.
 *
 * Priority:
 * 1. Moving + valid GPS heading → GPS heading (most accurate travel direction)
 * 2. Stopped + compass available → compass heading (real-time direction phone faces)
 * 3. Stopped + compass not ready (sensor error / startup) → last known GPS heading
 */
function resolveHeading(gpsHeading: number | null, speed: number): number {
  const isMoving = speed >= 0.5; // same threshold as stationary detection
  if (isMoving && gpsHeading != null && Number.isFinite(gpsHeading)) {
    // Save as last known GPS heading for fallback
    lastGpsHeading = gpsHeading;
    return gpsHeading;
  }
  // Stopped — use compass if available, otherwise last GPS heading
  if (compassHeading != null) {
    return compassHeading;
  }
  return lastGpsHeading;
}

// ─── Native GPS → MQTT Bridge (Background) ─────────────────────
// When the app is backgrounded, JS watchPosition stops. Native service
// collects GPS and emits events to JS via the RN bridge so MQTT can publish.

async function handleNativeGpsRecord(data: {
  id: string;
  ticket_id: number;
  latitude: number;
  longitude: number;
  speed: number;
  heading: number;
  accuracy: number;
  recorded_at: string;
  is_idle: boolean;
}) {
  // Validate coordinates from native bridge (defense-in-depth — native already filters)
  if (!Number.isFinite(data.latitude) || !Number.isFinite(data.longitude) ||
      Math.abs(data.latitude) > 90 || Math.abs(data.longitude) > 180 ||
      (data.latitude === 0 && data.longitude === 0)) {
    console.log(`[GPS/Native] Skipping invalid coordinates from bridge: lat=${data.latitude}, lng=${data.longitude}`);
    return;
  }

  const ticketId = data.ticket_id || gpsSyncManager.getTicketId();
  // Use battery from native record (stored at GPS fix time) — accurate even for replays
  const battery = (data as any).battery_level ?? await getBatteryPercent();

  // Update GPS freshness — native background records are also "live" GPS
  lastGpsFixTime = Date.now();

  // Always save to gpsStorage first — ensures no records are lost during MQTT reconnect.
  // importRecord deduplicates by ID, so this is safe even if native also stores the record.
  gpsStorage.importRecord(data.id, {
    ticket_id: ticketId,
    // Stamp the code at capture time — see GpsRecord.ticket_code
    ticket_code: (data as any).ticket_code ?? gpsSyncManager.getTicketCode(),
    latitude: data.latitude,
    longitude: data.longitude,
    speed: data.speed,
    heading: data.heading,
    altitude: null,
    accuracy: data.accuracy,
    recorded_at: data.recorded_at,
    battery_level: battery,
    is_idle: data.is_idle,
  });

  const payload = {
    latitude: data.latitude,
    longitude: data.longitude,
    speed: data.speed,
    heading: data.heading,
    accuracy: data.accuracy,
    recorded_at: data.recorded_at,
    ticket_id: ticketId,
    ticket_code: (data as any).ticket_code ?? gpsSyncManager.getTicketCode(),
    client_id: data.id,
    battery_level: battery,
  };

  if (deferLivePublish()) {
    console.log('[CHECK] live fix held (native bridge) — backlog flushing, publishes in time order');
  } else if (mqttService.isConnected()) {
    const published = mqttService.publish(payload, (err) => {
      if (!err) {
        gpsStorage.markSynced([data.id]);
      }
    });
    console.log(`[MQTT/Native] ${published ? 'Queued' : 'FAILED'} — lat=${data.latitude.toFixed(6)}, speed=${data.speed.toFixed(1)}, battery=${battery}%`);
  } else {
    console.log('[MQTT/Native] Not connected — record saved locally, reconnecting...');
    mqttService.connect().then(connected => {
      if (connected) {
        mqttService.publish(payload, (err) => {
          if (!err) {
            gpsStorage.markSynced([data.id]);
          }
        });
        console.log('[MQTT/Native] Reconnected and published');
      }
    }).catch(() => {});
  }
}

function startNativeGpsListener() {
  if (nativeGpsSubscription || Platform.OS !== 'android') return;
  nativeGpsSubscription = DeviceEventEmitter.addListener('nativeGpsRecord', handleNativeGpsRecord);
  console.log('[GPS] Native GPS → MQTT bridge started');
}

function stopNativeGpsListener() {
  if (nativeGpsSubscription) {
    nativeGpsSubscription.remove();
    nativeGpsSubscription = null;
    console.log('[GPS] Native GPS → MQTT bridge stopped');
  }
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
        stopIdleCheck();

        if (Platform.OS === 'android') {
          // 1. Tell native to stop saving FIRST — prevents race condition
          if (LocationTrackingModule) {
            LocationTrackingModule.setJsAlive(true).catch(() => {});
            // Ensure native service is still alive — Samsung/Android may kill it
            // while app is in background. Restart if needed (idempotent — if already
            // running, onStartCommand just updates the notification).
            //
            // This used to check isTrackingActive(), which reads the persisted
            // tracking_active flag. That flag stays true when the process dies, so
            // the check passed and the restart never fired — dead code in exactly
            // the situation it was written for. detectBackgroundServiceDeath()
            // compares the flag against real service liveness and reports to Sentry.
            detectBackgroundServiceDeath().then((died: boolean) => {
              if (died) {
                console.log('[GPS] Native service died in background — restarting');
                startTrackingService(gpsSyncManager.getTicketId()).catch(() => {});
              }
            }).catch(() => {
              // Detection unavailable — try restarting anyway (idempotent)
              startTrackingService(gpsSyncManager.getTicketId()).catch(() => {});
            });
          }
          // 2. Stationary flag persists across foreground/background transitions
          //    to prevent GPS drift on resume. Real movement will be confirmed
          //    by consecutive speed checks (MOVING_CONFIRM_THRESHOLD).
          // 3. Resume JS watcher (was stopped on background for Android)
          if (watchId === null) {
            console.log('[GPS] App foregrounded — resuming JS GPS');
            startWatch();
          }
          // 4. Sync fresh API credentials to native service (token may have refreshed)
          syncApiCredentialsToNative();

          // 5. Reconnect MQTT if disconnected (token may have expired in background)
          //    Reset state first — JS may have been frozen mid-reconnect, leaving
          //    the reconnecting guard stuck true.
          if (!mqttService.isConnected()) {
            console.log('[GPS] App foregrounded — reconnecting MQTT');
            mqttService.resetConnectionState();
            mqttService.connect().then(connected => {
              if (connected) publishBackgroundRecords();
            }).catch(() => {});
          }

          // 6. Ship anything the native service logged while JS was dead. First
          //    opportunity to report a background failure — see gpsDiagnostics.ts.
          reportNativeGpsDiagnostics().catch(() => {});

          // 7. Import native records, update idle timer, then restart idle interval
          importNativeRecordsAndUpdateIdle()
            .catch(() => {
              // Import failed — do NOT reset lastMovementTime.
              // If truck was idle for 2h+, the timer should still trigger logout.
            })
            .finally(() => resumeIdleCheck());
        } else {
          // iOS: watcher kept running in background — resume idle check
          console.log('[GPS] App foregrounded (iOS) — resuming idle check');
          // Stationary poll was stopped on background (line ~394). If the truck
          // was stationary, neither watchPosition nor stationaryPoll is active.
          // Restart the appropriate one so GPS tracking doesn't silently stop.
          if (watchId === null && !stationaryPollTimer) {
            if (wasStationary) {
              console.log('[GPS] App foregrounded (iOS) — restarting stationary poll');
              startStationaryPoll();
            } else {
              console.log('[GPS] App foregrounded (iOS) — restarting GPS watcher');
              startWatch();
            }
          }
          // Reconnect MQTT if disconnected (token may have expired in background)
          if (!mqttService.isConnected()) {
            console.log('[GPS] App foregrounded (iOS) — reconnecting MQTT');
            mqttService.resetConnectionState();
            mqttService.connect().then(connected => {
              if (connected) publishBackgroundRecords();
            }).catch(() => {});
          }
          resumeIdleCheck();
        }
      }
    } else if (state === 'background' || state === 'inactive') {
      consecutiveMovingCount = 0;
      // Flush in-memory GPS cache and idle timer to storage before backgrounding
      gpsStorage.flush();
      forcePeristLastMovementTime();
      // Stop idle interval — JS timers don't fire reliably in background.
      // Will be resumed with immediate check on foreground via resumeIdleCheck().
      stopIdleCheck();

      if (Platform.OS === 'android') {
        // Android: JS watchPosition is unreliable in background.
        // Stop it and let native service take over GPS collection.
        console.log('[GPS] App backgrounded — native GPS + JS MQTT bridge');
        stopWatch();
        stopStationaryPoll();
        // Tell native to take over GPS immediately (no 30s heartbeat gap)
        if (LocationTrackingModule) {
          LocationTrackingModule.setJsAlive(false).catch(() => {});
        }
      } else {
        // iOS: No native service — only watchPosition survives backgrounding
        // (UIBackgroundModes: location). The 5s stationary poll is a plain JS
        // timer and iOS suspends it, so backgrounding while stopped used to
        // leave BOTH collectors off until the driver reopened the app.
        // startWatch() stops the poll itself and is a no-op if already watching.
        console.log('[GPS] App backgrounded (iOS) — JS GPS continues in background');
        startWatch();
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

/** Request battery optimization exemption so Samsung/OEMs don't kill the foreground service. */
function requestBatteryOptimizationExemption() {
  if (Platform.OS !== 'android' || !LocationTrackingModule) return;
  LocationTrackingModule.requestBatteryOptimizationExemption().catch(() => {
    console.log('[GPS] Battery optimization exemption not available');
  });
}

/** Pass API credentials to native service for background uploads and token refresh. */
function syncApiCredentialsToNative() {
  if (Platform.OS !== 'android' || !LocationTrackingModule) return;
  const baseUrl = Config.API_BASE_URL || '';
  const token = storage.getString('access_token') || '';
  const refreshToken = storage.getString('refresh_token') || '';
  if (baseUrl && token) {
    LocationTrackingModule.setApiCredentials(baseUrl, token, refreshToken).catch(() => {});
  }
  // Same id as the JS side stamps, so the two publishers are never mistaken for
  // two phones. Pushed here rather than read natively: this is the value that
  // was actually persisted, whatever getUniqueIdSync() returns later.
  LocationTrackingModule.setDeviceId?.(getDeviceId()).catch(() => {});
}

function notifyListeners(pos: GpsPosition) {
  for (const cb of listeners) {
    try { cb(pos); } catch {}
  }
}

async function requestPermissions(): Promise<boolean> {
  if (Platform.OS === 'ios') {
    const status = await Geolocation.requestAuthorization('always');
    if (status !== 'granted' && status !== 'restricted') return false;
    // 'granted' covers BOTH Always and While-Using on iOS — the library folds
    // them together, so this is the only way to know background GPS will work.
    // BackgroundPermissionBanner keeps warning until it is fixed; a toast here
    // would be seen once and then never again.
    if ((await getLocationPermissionLevel()) === 'foregroundOnly') {
      console.warn('[GPS] iOS permission is While-Using — no background fixes');
    }
    return true;
  }
  // Check if already granted first — avoid re-requesting on app reopen
  const alreadyGranted = await PermissionsAndroid.check(
    PermissionsAndroid.PERMISSIONS.ACCESS_FINE_LOCATION,
  );
  if (alreadyGranted) {
    // Fine location already granted — check background too
    if (Number(Platform.Version) >= 29) {
      const bgGranted = await PermissionsAndroid.check(
        PermissionsAndroid.PERMISSIONS.ACCESS_BACKGROUND_LOCATION,
      );
      if (!bgGranted) {
        // Warned persistently by BackgroundPermissionBanner — a toast at login
        // is gone in seconds and the driver loses the whole shift's background
        // GPS without ever seeing why.
        console.warn('[GPS] Background location denied — no fixes while backgrounded');
      }
    }
    return true;
  }
  // Not yet granted — request permissions
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
      // Driver didn't select "Allow all the time" — prompt to open Settings
      await new Promise<void>(resolve => {
        Alert.alert(
          'Background Location Required',
          'GPS tracking needs "Allow all the time" to work when the screen is off or the app is in the background.\n\nPlease select "Allow all the time" in Location Settings.',
          [
            {
              text: 'Not Now',
              style: 'cancel',
              onPress: () => {
                showToast('info', 'Limited Tracking', 'GPS will only work while the app is open.');
                resolve();
              },
            },
            {
              text: 'Open Settings',
              onPress: () => {
                Linking.openSettings();
                resolve();
              },
            },
          ],
        );
      });
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
    let importError = false;
    for (const r of records) {
      try {
        if (r.synced) continue;
        // Preserve the original native ID — if native already uploaded this record,
        // gpsSyncManager will send the same client_id, avoiding duplicate routes.
        const nativeId = r.id || `native_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
        const added = gpsStorage.importRecord(nativeId, {
          ticket_id: r.ticket_id || null,
          ticket_code: r.ticket_code ?? null,
          latitude: r.latitude,
          longitude: r.longitude,
          speed: r.speed || 0,
          heading: r.heading ?? 0,
          altitude: r.altitude || null,
          accuracy: r.accuracy || null,
          recorded_at: r.recorded_at,
          battery_level: r.battery_level ?? null,
          is_speeding: r.is_speeding || false,
          is_idle: r.is_idle || false,
        });
        if (added) imported++;
      } catch (recordErr: any) {
        importError = true;
        console.warn('[GPS] Failed to import native record:', recordErr.message);
      }
    }

    // Only clear native records if ALL were processed successfully.
    // If some failed, keep them so they can be retried next time.
    if (!importError) {
      try {
        await LocationTrackingModule.clearStoredRecords();
      } catch (clearErr: any) {
        console.warn('[GPS] clearStoredRecords failed, retrying:', clearErr.message);
        try { await LocationTrackingModule.clearStoredRecords(); } catch {}
      }
    } else {
      console.warn(`[GPS] Partial import (${imported}/${records.length}) — keeping native records for retry`);
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
    forcePeristLastMovementTime();
    idleWarningShown = false;

    // Publish missed background records via MQTT (catch-up)
    publishBackgroundRecords();
  }
  // count === 0: truck was stationary in background — lastMovementTime stays as-is,
  // idle timer will correctly fire if 2h has elapsed since last real movement.
}

/**
 * Start of the current connectivity outage, or null while online.
 *
 * Set when NetInfo reports the drop and cleared by the "online" presence
 * message, so exactly one online message goes out per outage no matter how many
 * things trigger a backlog flush (connectivity restored, MQTT reconnect,
 * foreground resume all call publishBackgroundRecords).
 */
let offlineSince: string | null = null;
let connectivityLostUnsub: (() => void) | null = null;

function trackConnectivityLoss(): void {
  connectivityLostUnsub?.();
  connectivityLostUnsub = onConnectivityLost(() => {
    if (offlineSince) return; // Already in an outage
    offlineSince = new Date().toISOString();
    console.log(`[CHECK] offline window opened at ${offlineSince} — GPS keeps recording locally`);
    // Best-effort: the socket is usually already gone by the time we get here.
    mqttService.publishPresence({status: 'offline', since: offlineSince});
  });
}

/** Publish unsynced background records via MQTT when app returns to foreground. */
let isPublishingBackground = false;
let publishQueued = false; // Re-run after current publish finishes if new records arrived

/**
 * Hold a live GPS fix back while the offline backlog is draining.
 *
 * The live pipeline (gps-consumer -> Redis -> ws-gateway) keeps only the newest
 * position per truck. One live point jumping the queue makes the whole backlog
 * look stale, so every replayed point is rejected for the live map and the
 * dispatch map shows nothing but the jump.
 *
 * The record is already in gpsStorage, so it costs nothing to hold: the flush
 * re-runs on publishQueued and picks it up in its proper place in time order.
 */
function deferLivePublish(): boolean {
  if (!isPublishingBackground || Date.now() >= liveHoldUntil) return false;
  publishQueued = true;
  return true;
}

/**
 * Deadline for the hold above, and the cap on one flush.
 *
 * Holding is only correct while a real backlog is draining. Two ways it could
 * turn into a permanently stale live map without these:
 *   - A slow broker makes every flush hit its 15 s delivery timeout, nothing is
 *     confirmed, and each re-run holds the next batch of live fixes forever.
 *   - A 5 h backlog is 20 000 records; publishing them all in one flush cannot
 *     finish inside 15 s, so none get marked synced and the next flush sends the
 *     same 20 000 again.
 * So: hold only when the backlog is genuinely old, never past the deadline, and
 * send at most MAX_FLUSH_BATCH per run — publishQueued carries on the rest.
 */
const MAX_LIVE_HOLD_MS = 60_000;
const MAX_FLUSH_BATCH = 500;
let liveHoldUntil = 0;
async function publishBackgroundRecords(): Promise<void> {
  if (isPublishingBackground) {
    publishQueued = true; // Will re-run after current publish completes
    return;
  }
  isPublishingBackground = true;
  publishQueued = false;
  try {
    if (!mqttService.isConnected()) {
      const connected = await mqttService.connect();
      if (!connected) {
        console.log('[MQTT] Cannot publish background records — not connected');
        return;
      }
    }

    // Oldest first. gps-consumer keeps ONE position per truck in Redis, so the
    // live map only accepts a point newer than what it already holds. Out of
    // order, every older backlog point is dropped on arrival and dispatchers see
    // the straight jump; in order, each one is accepted and streams through.
    // Timescale stores them either way — this is purely the live view.
    const backlog = gpsStorage
      .getUnsynced()
      .slice()
      .sort((a, b) => (Date.parse(a.recorded_at) || 0) - (Date.parse(b.recorded_at) || 0));

    // Announce the end of the outage before the flush, so the dashboard knows how
    // many points are coming and which window they cover instead of guessing.
    //
    // This runs BEFORE the empty-backlog return on purpose. An outage the truck
    // spent parked produces no records, and skipping it would leave offlineSince
    // latched forever — suppressing the "offline" message for every later outage.
    if (offlineSince) {
      mqttService.publishPresence({
        status: 'online',
        backfill_count: backlog.length,
        backfill_from: backlog[0]?.recorded_at ?? offlineSince,
        backfill_to: backlog[backlog.length - 1]?.recorded_at ?? new Date().toISOString(),
      });
      offlineSince = null;
    }

    if (backlog.length === 0) {
      liveHoldUntil = 0; // Nothing left to order around — stop holding live fixes
      return;
    }

    // Only a genuine catch-up needs live fixes held back. A steady-state re-run
    // of one or two fresh records has no ordering problem to solve, and holding
    // there would stall the live map for nothing.
    const oldestAgeMs = Date.now() - (Date.parse(backlog[0].recorded_at) || Date.now());
    if (oldestAgeMs > 60_000) {
      liveHoldUntil = Date.now() + MAX_LIVE_HOLD_MS;
    }

    const unsynced = backlog.slice(0, MAX_FLUSH_BATCH);
    if (backlog.length > unsynced.length) {
      publishQueued = true; // Remaining records go out on the next run, still in order
    }

    // Records captured before a ticket was known (app started offline with no
    // cached last_ticket_id -> startWithoutTicket) carry ticket_id: null forever.
    // refreshTicket() learns the real id within 30s but never back-fills, so the
    // points reach the server attached to no ticket and vanish from the map.
    // Stamp the now-known id on them at publish time.
    const liveTicketId = gpsSyncManager.getTicketId();
    const orphaned = unsynced.filter(r => r.ticket_id === null).length;
    if (orphaned > 0 && liveTicketId !== null) {
      console.log(`[MQTT] Back-filling ticket_id ${liveTicketId} onto ${orphaned} orphaned records`);
    }

    const now = Date.now();
    const backfillCount = unsynced.filter(r => {
      const t = Date.parse(r.recorded_at);
      return Number.isFinite(t) && now - t > 60_000;
    }).length;
    console.log(
      `[CHECK] flush ${unsynced.length} of ${backlog.length} records — ` +
        `${backfillCount} backfill, ${unsynced.length - backfillCount} live`,
    );
    console.log(
      `[CHECK] order oldest→newest: ${unsynced[0].recorded_at} → ` +
        `${unsynced[unsynced.length - 1].recorded_at}`,
    );
    console.log(`[MQTT] Publishing ${unsynced.length} background GPS records...`);
    let queued = 0;
    let delivered = 0;
    const deliveryPromises: Promise<void>[] = [];
    for (const r of unsynced) {
      const promise = new Promise<void>((resolve) => {
        const accepted = mqttService.publish({
          latitude: r.latitude,
          longitude: r.longitude,
          speed: r.speed,
          heading: r.heading,
          accuracy: r.accuracy,
          recorded_at: r.recorded_at,
          ticket_id: r.ticket_id ?? liveTicketId,
          // Captured code, NOT the live one — a backlog flushing after the driver
          // moved to a new ticket would otherwise pair an old id with a new code.
          ticket_code: r.ticket_code ?? null,
          client_id: r.id,
          // Use battery stored at record time — accurate for offline replays
          battery_level: r.battery_level ?? null,
        }, (err) => {
          if (!err) {
            delivered++;
            gpsStorage.markSynced([r.id]);
          } else {
            console.warn(`[MQTT] Background delivery failed for ${r.id}: ${err.message}`);
          }
          resolve();
        });
        if (accepted) {
          queued++;
        } else {
          resolve(); // Not accepted — resolve immediately
        }
      });
      deliveryPromises.push(promise);
    }
    // Wait for all delivery confirmations (with 15s timeout to avoid blocking forever)
    await Promise.race([
      Promise.all(deliveryPromises),
      new Promise<void>(resolve => setTimeout(resolve, 15000)),
    ]);
    console.log(`[MQTT] Background catch-up: ${queued} queued, ${delivered}/${unsynced.length} confirmed`);
    if (delivered === unsynced.length) {
      console.log(`[CHECK] PASS catch-up — all ${delivered} records confirmed by broker`);
      if (backlog.length === unsynced.length) {
        liveHoldUntil = 0; // Backlog fully drained — live fixes publish immediately again
      }
    } else {
      console.warn(
        `[CHECK] FAIL catch-up — ${unsynced.length - delivered} of ${unsynced.length} not confirmed`,
      );
      // captureError, not captureMessage — captureMessage's second arg is a
      // severity level, and we want the counts attached as searchable extras.
      captureError(new Error('GPS catch-up incomplete'), {
        total: unsynced.length,
        delivered,
        queued,
        missing: unsynced.length - delivered,
      });
    }
  } finally {
    isPublishingBackground = false;
    // If new records arrived during this publish cycle, re-run
    if (publishQueued) {
      publishQueued = false;
      publishBackgroundRecords();
    }
  }
}

// ─── Position Handling ───────────────────────────────────────────

/**
 * Republish the parked position with a fresh timestamp.
 *
 * Publishes the stop anchor, not the fix that triggered it: the fix is inside
 * the drift band we are deliberately suppressing, and sending it would draw the
 * same spurs off the route that the accuracy work removed. The anchor with a
 * current timestamp tells the dashboard "still here, still alive" and costs the
 * map nothing.
 */
async function saveStationaryHeartbeat(accuracy: number | null): Promise<void> {
  if (!stationaryPosition) return;
  lastHeartbeatAt = Date.now();

  const recordedAt = new Date().toISOString();
  const ticketId = gpsSyncManager.getTicketId();
  const battery = await getBatteryPercent();
  const {latitude, longitude} = stationaryPosition;

  const recordId = gpsStorage.addRecord({
    ticket_id: ticketId,
    ticket_code: gpsSyncManager.getTicketCode(),
    latitude,
    longitude,
    speed: 0,
    heading: lastGpsHeading,
    altitude: null,
    accuracy,
    recorded_at: recordedAt,
    battery_level: battery,
    is_idle: true,
    ...currentBehavior,
  });

  if (!deferLivePublish() && mqttService.isConnected()) {
    mqttService.publish(
      {
        latitude,
        longitude,
        speed: 0,
        heading: lastGpsHeading,
        accuracy,
        recorded_at: recordedAt,
        ticket_id: ticketId,
        ticket_code: gpsSyncManager.getTicketCode(),
        client_id: recordId,
        battery_level: battery,
      },
      err => {
        if (!err) gpsStorage.markSynced([recordId]);
      },
    );
  }
  console.log(`[CHECK] stationary heartbeat — parked position resent, next in ${STATIONARY_HEARTBEAT_MS / 1000}s`);
}

async function handlePosition(position: any) {
  const {latitude, longitude, speed, heading, altitude, accuracy} = position.coords;
  const speedAvailable = typeof speed === 'number' && !isNaN(speed) && speed >= 0;
  const currentSpeed = speedAvailable ? speed : 0;

  // Hybrid heading: GPS when moving, compass (magnetometer) when stopped
  const resolvedHeading = resolveHeading(heading, currentSpeed);

  const pos: GpsPosition = {
    latitude,
    longitude,
    speed: currentSpeed,
    heading: resolvedHeading,
    altitude: altitude || 0,
    accuracy: accuracy || 0,
    timestamp: position.timestamp,
  };

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

  // Graduated accuracy filter: accept up to 50m initially (GPS cold start,
  // urban canyons, bridge transitions), tighten to 25m once we have a good fix.
  // Real-world GPS often starts at 30-40m accuracy before locking to 5-15m.
  const STRICT_ACCURACY = 25;
  const INITIAL_ACCURACY = 50;
  const WARMUP_MS = 30_000; // 30 seconds warmup
  const hasWarmedUp = firstGoodFixTime > 0 && (Date.now() - firstGoodFixTime > WARMUP_MS);
  const accuracyLimit = hasWarmedUp ? STRICT_ACCURACY : INITIAL_ACCURACY;

  if (accuracy != null && accuracy >= accuracyLimit) {
    consecutiveAccuracyRejects++;
    console.log(`[GPS] Skipping inaccurate fix: ${accuracy.toFixed(0)}m (limit: ${accuracyLimit}m)`);
    // Mirrors LocationTrackingService.kt — without this the gate is a one-way
    // ratchet: one good fix arms 25m for the rest of the session and a later
    // stretch of 30-40m accuracy drops every fix with no recovery path.
    if (hasWarmedUp && consecutiveAccuracyRejects >= ACCURACY_REWARMUP_REJECTS) {
      firstGoodFixTime = 0;
      consecutiveAccuracyRejects = 0;
      console.log(`[GPS] GPS degraded for ${ACCURACY_REWARMUP_REJECTS} fixes — re-warming accuracy gate to ${INITIAL_ACCURACY}m`);
    }
    return;
  }
  consecutiveAccuracyRejects = 0;

  // Track when GPS achieves good accuracy — triggers strict filtering
  if (accuracy != null && accuracy < STRICT_ACCURACY && firstGoodFixTime === 0) {
    firstGoodFixTime = Date.now();
  }

  // Skip invalid coordinates — (0,0) "Null Island", NaN, or out-of-range
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude) ||
      Math.abs(latitude) > 90 || Math.abs(longitude) > 180 ||
      (latitude === 0 && longitude === 0)) {
    console.log(`[GPS] Skipping invalid coordinates: lat=${latitude}, lng=${longitude}`);
    return;
  }

  // Skip GPS teleportation — reject if implied speed > 80 m/s (288 km/h)
  if (lastPosition) {
    const timeDeltaS = (position.timestamp - lastPosition.timestamp) / 1000;
    if (timeDeltaS > 0 && timeDeltaS < 60) {
      const jumpDist = haversineDistance(lastPosition.latitude, lastPosition.longitude, latitude, longitude);
      const impliedSpeed = jumpDist / timeDeltaS;
      if (impliedSpeed > 80) {
        console.log(`[GPS] Skipping teleport: ${jumpDist.toFixed(0)}m in ${timeDeltaS.toFixed(1)}s = ${(impliedSpeed * 3.6).toFixed(0)} km/h`);
        return;
      }
    }
  }

  // Reject a jump the speedometer cannot account for.
  //
  // The teleport gate above only catches 288 km/h, which at 1 Hz still lets an
  // 80 m jump through unchallenged. That is the whole reason the trail grows
  // spurs at junctions: accuracy degrades near buildings, the gate re-warms to
  // 50 m, and a 40-50 m multipath fix is accepted as real movement.
  //
  // GPS speed is Doppler-derived and far more trustworthy than differencing two
  // positions, so if the position moved much further than the reported speed
  // allows, the position is wrong — not the speed.
  if (lastPosition && speedAvailable) {
    const dt = (position.timestamp - lastPosition.timestamp) / 1000;
    // Only over short gaps. After a background stretch lastPosition is stale and
    // a large, entirely legitimate gap would average out to nothing useful.
    if (dt > 0 && dt < 10) {
      const jump = haversineDistance(
        lastPosition.latitude, lastPosition.longitude, latitude, longitude,
      );
      const implied = jump / dt;
      if (implied > currentSpeed + MAX_UNEXPLAINED_SPEED) {
        console.log(
          `[GPS] Skipping unexplained jump: ${jump.toFixed(0)}m in ${dt.toFixed(1)}s ` +
            `= ${implied.toFixed(1)} m/s, but speed reads ${currentSpeed.toFixed(1)} m/s ` +
            `(accuracy ${accuracy?.toFixed(0)}m)`,
        );
        return;
      }
    }
  }

  // Update lastPosition only after filtering out mocked/inaccurate/invalid positions
  lastPosition = pos;
  lastGpsFixTime = Date.now();

  // Notify listeners only after filtering out mocked/inaccurate positions
  notifyListeners(pos);

  // Stationary detection: skip GPS drift when truck is not moving
  const isStationary = currentSpeed < 0.5; // < 0.5 m/s ≈ 1.8 km/h — truly stopped, not crawling in traffic

  let isFirstStop = false; // Track if this is the first stationary fix — must bypass distance filter

  if (isStationary) {
    // One slow fix is not a stop. Zeroing the counter on every dip below
    // 1.8 km/h is what made a stop-start crawl unable to ever reach
    // MOVING_CONFIRM_THRESHOLD: the count went 1, 0, 1, 0 for minutes.
    consecutiveSlowCount++;
    if (consecutiveSlowCount >= SLOW_FIXES_TO_RESET) {
      consecutiveMovingCount = 0;
    }

    if (wasStationary) {
      // Escape hatch. A truck 40 m from where it stopped has moved, whatever the
      // speedometer says. This check used to live only in the moving branch, so a
      // crawl below 1.8 km/h was discarded here without the distance ever being
      // looked at — the truck drove 130 m while the map showed it parked.
      const crawlDist = stationaryPosition
        ? haversineDistance(
            stationaryPosition.latitude, stationaryPosition.longitude,
            latitude, longitude,
          )
        : 0;
      const crawlConfirm = Math.max(DISTANCE_CONFIRM_THRESHOLD, (accuracy ?? 0) * 1.5);

      if (crawlDist >= crawlConfirm) {
        wasStationary = false;
        stationaryPosition = null;
        consecutiveMovingCount = 0;
        consecutiveSlowCount = 0;
        if (stationaryPollTimer) {
          stopStationaryPoll();
          startWatch();
        }
        console.log(
          `[CHECK] crawl confirmed — ${crawlDist.toFixed(0)}m from stop at ` +
            `${currentSpeed.toFixed(1)} m/s, resuming full rate`,
        );
        // Fall through and save this fix.
      } else {
        // Still parked as far as we can tell — keep the low-frequency poll.
        if (!stationaryPollTimer && AppState.currentState === 'active') {
          startStationaryPoll();
        }
        // ...but do not let the map go quiet while anything is happening.
        if (
          (crawlDist >= HEARTBEAT_MIN_DRIFT || currentSpeed >= HEARTBEAT_MIN_SPEED) &&
          Date.now() - lastHeartbeatAt >= STATIONARY_HEARTBEAT_MS
        ) {
          saveStationaryHeartbeat(accuracy ?? null);
        }
        return;
      }
    } else {
      // First stationary fix — save it so we know WHERE the truck stopped
      wasStationary = true;
      stationaryPosition = {latitude, longitude};
      isFirstStop = true; // Must save this record — skip distance filter below
      lastHeartbeatAt = Date.now();
      console.log(`[GPS] FIRST STOP: saving stopped-at position, lat=${latitude.toFixed(6)}, lng=${longitude.toFixed(6)}`);
    }
  } else {
    consecutiveSlowCount = 0;
    consecutiveMovingCount++;

    // Distance-based confirmation: if truck moved far enough from stop position,
    // it's definitely real movement (GPS drift is typically <10m)
    let distFromStop = 0;
    if (wasStationary && stationaryPosition) {
      distFromStop = haversineDistance(
        stationaryPosition.latitude, stationaryPosition.longitude,
        latitude, longitude,
      );
    }

    // Scale the "definitely moved" distance with the accuracy of the fix claiming
    // it. A flat 15 m was below the 25-50 m the accuracy gate admits, so ordinary
    // drift while parked cleared the stationary flag and drew a spur off the route.
    const confirmDistance = Math.max(
      DISTANCE_CONFIRM_THRESHOLD,
      (accuracy ?? 0) * 1.5,
    );
    if (consecutiveMovingCount >= MOVING_CONFIRM_THRESHOLD || distFromStop >= confirmDistance) {
      // Confirmed real movement — clear stationary flag and resume full GPS
      wasStationary = false;
      stationaryPosition = null;
      if (stationaryPollTimer) {
        stopStationaryPoll();
        startWatch();
        console.log(`[GPS] MOVEMENT CONFIRMED: resumed full GPS, speed=${currentSpeed.toFixed(1)}, distFromStop=${distFromStop.toFixed(0)}m`);
      } else {
        console.log(`[GPS] MOVEMENT CONFIRMED: ${consecutiveMovingCount} consecutive moving fixes, speed=${currentSpeed.toFixed(1)}, distFromStop=${distFromStop.toFixed(0)}m`);
      }
    } else if (wasStationary) {
      // Not yet confirmed — discard this fix to prevent GPS drift from:
      // 1. Being saved/published as real movement
      // 2. Resetting the idle auto-logout timer
      // 3. Updating lastSavedPosition to a drifted location
      // Real movement will be captured once MOVING_CONFIRM_THRESHOLD is met.
      console.log(`[GPS] PENDING MOVE: speed=${currentSpeed.toFixed(1)}, movingCount=${consecutiveMovingCount}/${MOVING_CONFIRM_THRESHOLD}, distFromStop=${distFromStop.toFixed(0)}m, lat=${latitude.toFixed(6)}`);
      return;
    }
  }

  // Only save when truck has moved enough from last saved position.
  // Adaptive: if accuracy is poor (>15m), require more distance to avoid
  // saving GPS drift as real movement.
  // Exception: first stop record always saved — the stop position matters
  // even if it's < 5m from the last driving position.
  if (lastSavedPosition && !isFirstStop) {
    const dist = haversineDistance(
      lastSavedPosition.latitude, lastSavedPosition.longitude,
      latitude, longitude,
    );
    const minDist = (accuracy != null && accuracy > 15)
      ? Math.max(10, accuracy * 0.75)
      : MIN_DISTANCE_TO_SAVE;
    if (dist < minDist) {
      return; // Truck hasn't moved enough — skip saving
    }
  }

  lastSavedPosition = {latitude, longitude};

  // Reset idle auto-logout timer — a new GPS record means activity
  lastMovementTime = Date.now();
  persistLastMovementTime();
  idleWarningShown = false;

  const recordedAt = new Date(position.timestamp).toISOString();
  const ticketId = gpsSyncManager.getTicketId();
  const battery = await getBatteryPercent();

  const recordId = gpsStorage.addRecord({
    ticket_id: ticketId,
    ticket_code: gpsSyncManager.getTicketCode(),
    latitude,
    longitude,
    speed: currentSpeed,
    heading: resolvedHeading,
    altitude: altitude || null,
    accuracy: accuracy || null,
    recorded_at: recordedAt,
    battery_level: battery,
    is_idle: isStationary,
    ...currentBehavior,
  });

  // Publish via MQTT in real-time (non-blocking)
  if (deferLivePublish()) {
    console.log('[CHECK] live fix held — backlog flushing, publishes in time order');
  } else if (mqttService.isConnected()) {
    const payload = {
      latitude,
      longitude,
      speed: currentSpeed,
      heading: resolvedHeading,
      accuracy: accuracy || null,
      recorded_at: recordedAt,
      ticket_id: ticketId,
      ticket_code: gpsSyncManager.getTicketCode(),
      client_id: recordId,
      battery_level: battery,
    };
    const published = mqttService.publish(payload, (err) => {
      if (!err) {
        // Broker confirmed receipt (QoS 1 ACK) — safe to mark synced
        gpsStorage.markSynced([recordId]);
      } else {
        console.warn(`[MQTT] Delivery failed for ${recordId}: ${err.message}`);
      }
    });
    console.log(`[MQTT] GPS ${published ? 'queued' : 'FAILED'} — lat=${latitude.toFixed(6)}, lng=${longitude.toFixed(6)}, speed=${currentSpeed.toFixed(1)}, battery=${battery}%`);
  } else {
    // MQTT not connected — record saved locally. Library's built-in reconnect
    // (reconnectPeriod: 5000) and connectivity-restored callback handle reconnection.
    // Don't call connect() on every GPS fix — it duplicates the library's own retry.
  }

  console.log(`[GPS] Record saved — lat=${latitude.toFixed(6)}, lng=${longitude.toFixed(6)}`);
}

function handleError(error: any) {
  console.warn('[GPS] Error:', error.code, error.message);
  if (error.code === 1) {
    console.error('[GPS] Location permission denied — stopping tracking');
    showToast('error', 'GPS Permission Lost', 'Location permission was revoked. Tracking stopped.');
    const ticketId = gpsSyncManager.getTicketId();
    backgroundGpsTracker.stop();
    // stop() clears permissionDenied and removes the AppState listener, so nothing
    // used to restart JS tracking for the rest of the session — a momentary
    // permission blip left the app on native-silent GPS only until the next login.
    // Re-arm the retry so the next foreground re-requests permission and resumes.
    permissionDenied = true;
    pendingTicketId = ticketId;
    setupAppStateListener();
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
  // Restore persisted time if available (app was killed while idle).
  // If no persisted value (fresh login after clearAllData), defaults to Date.now().
  restoreLastMovementTime();
  const elapsed = Date.now() - lastMovementTime;
  if (elapsed < 0) {
    // Clock went backward (device time changed) — reset to now
    lastMovementTime = Date.now();
  }
  // If elapsed >= IDLE_LOGOUT_MS, checkIdleNow() will fire auto-logout immediately
  // on resumeIdleCheck(). This is correct — driver was idle the whole time.
  forcePeristLastMovementTime();
  idleWarningShown = false;
  resumeIdleCheck();
}

/** Check idle time once and take action if needed. */
function checkIdleNow() {
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
}

/** Resume idle interval without resetting lastMovementTime. Used after foreground import. */
function resumeIdleCheck() {
  if (idleCheckInterval) return; // already running
  // Immediate check — catches 2h+ idle that accumulated during background
  checkIdleNow();
  idleCheckInterval = setInterval(checkIdleNow, 60_000); // Then check every 60 seconds
}

function stopIdleCheck() {
  if (idleCheckInterval) {
    clearInterval(idleCheckInterval);
    idleCheckInterval = null;
  }
  // Don't reset idleWarningShown here — it's reset in startIdleCheck()
  // and when movement occurs. Resetting here caused duplicate warnings
  // on background→foreground transitions.
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
  stopStationaryPoll(); // Stop low-frequency poll if running

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
      distanceFilter: 3,
      interval: 1000,
      fastestInterval: 1000,
      showLocationDialog: true,
      forceRequestLocation: true,
      // No maximumAge here: it belongs to getCurrentPosition, not watchPosition.
      // The native watch ignored it, so it only ever looked like a cache bound.
      // iOS: show blue location indicator bar when tracking in background
      ...(Platform.OS === 'ios' ? {showsBackgroundLocationIndicator: true} : {}),
    },
  );
  console.log('[GPS] watchPosition started (1s interval, FusedLocationProvider)');
}

/** Switch to low-frequency polling when truck is stationary.
 *  Checks every 5s to detect when movement resumes. */
function startStationaryPoll() {
  if (stationaryPollTimer) return;
  stopWatch(); // Stop high-frequency GPS

  stationaryPollTimer = setInterval(() => {
    Geolocation.getCurrentPosition(
      (position) => handlePosition(position),
      () => {}, // Ignore errors during stationary poll
      // maximumAge 0: a cached fix still reports the speed it had when it was
      // taken, so accepting a 3 s old one delayed noticing the truck had set off.
      {enableHighAccuracy: true, timeout: 5000, maximumAge: 0},
    );
  }, 5000);
  console.log('[GPS] Stationary — switched to 5s poll (waiting for movement)');
}

function stopStationaryPoll() {
  if (stationaryPollTimer) {
    clearInterval(stationaryPollTimer);
    stationaryPollTimer = null;
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
      // Abort if stop()/clearAllData() was called while awaiting permission
      if (!starting) { console.log('[GPS] startAlways aborted after permission check'); return false; }
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
      // Abort if stop()/clearAllData() was called while awaiting ticket
      if (!starting) { console.log('[GPS] startAlways aborted after ticket check'); return false; }
      if (!hasTicket) {
        gpsSyncManager.startWithoutTicket();
      }

      if (!getIsOnline()) {
        showToast('info', 'Offline Mode', 'GPS data will be uploaded when connection is restored.');
      }

      // Import any leftover native records before starting fresh
      await importNativeRecords();
      if (!starting) { console.log('[GPS] startAlways aborted after native import'); return false; }

      // Start native background service (Android)
      syncApiCredentialsToNative();
      await startTrackingService(gpsSyncManager.getTicketId());
      if (!starting) { console.log('[GPS] startAlways aborted after service start'); return false; }
      if (Platform.OS === 'android' && LocationTrackingModule) {
        LocationTrackingModule.setJsAlive(true).catch(() => {});
        // Request battery optimization exemption so Samsung/OEMs don't kill the service
        requestBatteryOptimizationExemption();
      }

      // Float a mini map when the driver leaves via Home. startAlways() is the
      // path the app actually boots through (OfflineSyncContext), so arming it
      // only in start() left PiP dead.
      setPipAutoEnter(true);

      // Start compass for hybrid heading (GPS + magnetometer)
      startCompass();

      // Start JS GPS if app is currently in foreground
      if (AppState.currentState === 'active') {
        startWatch();
      }
      setupAppStateListener();
      startNativeGpsListener();

      running = true;
      startIdleCheck();

      // Publish offline GPS records when connectivity is restored
      trackConnectivityLoss();
      connectivityRestoredUnsub?.();
      connectivityRestoredUnsub = onConnectivityRestored(() => {
        console.log('[GPS] Connectivity restored — reconnecting MQTT and publishing offline records');
        // Reset connection state first — mqtt.js may be mid-reconnect with expired token,
        // leaving the reconnecting guard stuck. A fresh connect() with new token is needed.
        mqttService.resetConnectionState();
        mqttService.connect().then(connected => {
          if (connected) {
            publishBackgroundRecords();
          }
        }).catch(() => {});
      });

      // Connect MQTT for real-time GPS publishing (non-blocking, with retry)
      mqttService.setOnReconnect(() => publishBackgroundRecords());
      const onMqttConnected = () => {
        // Publish any GPS fixes that were saved before MQTT connected
        publishBackgroundRecords();
      };
      mqttService.connect().then(connected => {
        if (connected) {
          console.log('[MQTT] GPS tracking connect: OK');
          onMqttConnected();
        } else {
          console.log('[MQTT] GPS tracking connect: failed, retrying in 5s...');
          setTimeout(() => {
            mqttService.connect().then(retry => {
              console.log(`[MQTT] GPS tracking retry: ${retry ? 'OK' : 'failed (will retry on next GPS fix)'}`);
              if (retry) onMqttConnected();
            });
          }, 5000);
        }
      });

      console.log(`[GPS] Started — native background enabled, compass active — ticket: ${ticketId || 'none'}`);
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
      if (!starting) { return false; }
      if (!hasPermission) {
        if (!silent) {
          showToast('error', 'Permission Denied', 'Location permission is required for GPS tracking.');
        }
        return false;
      }

      const hasTicket = await gpsSyncManager.start(ticketId);
      if (!starting) { return false; }
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

      // Start native background service (Android) so GPS continues when app is backgrounded
      syncApiCredentialsToNative();
      await startTrackingService(gpsSyncManager.getTicketId());
      if (!starting) { return false; }
      if (Platform.OS === 'android' && LocationTrackingModule) {
        LocationTrackingModule.setJsAlive(true).catch(() => {});
        requestBatteryOptimizationExemption();
      }

      // Float a mini map when the driver leaves via Home — only meaningful while
      // a ticket is actually being tracked, so it is armed here, not at boot.
      setPipAutoEnter(true);

      // Start compass for hybrid heading
      startCompass();

      if (AppState.currentState === 'active') {
        startWatch();
      }
      setupAppStateListener();
      startNativeGpsListener();

      running = true;
      startIdleCheck();

      // Publish offline GPS records when connectivity is restored
      trackConnectivityLoss();
      connectivityRestoredUnsub?.();
      connectivityRestoredUnsub = onConnectivityRestored(() => {
        console.log('[GPS] Connectivity restored — reconnecting MQTT and publishing offline records');
        mqttService.resetConnectionState();
        mqttService.connect().then(connected => {
          if (connected) {
            publishBackgroundRecords();
          }
        }).catch(() => {});
      });

      // Connect MQTT for real-time GPS publishing (non-blocking, with retry)
      mqttService.setOnReconnect(() => publishBackgroundRecords());
      const onMqttConnected2 = () => {
        publishBackgroundRecords();
      };
      mqttService.connect().then(connected => {
        if (connected) {
          console.log('[MQTT] GPS tracking connect: OK');
          onMqttConnected2();
        } else {
          console.log('[MQTT] GPS tracking connect: failed, retrying in 5s...');
          setTimeout(() => {
            mqttService.connect().then(retry => {
              console.log(`[MQTT] GPS tracking retry: ${retry ? 'OK' : 'failed (will retry on next GPS fix)'}`);
              if (retry) onMqttConnected2();
            });
          }, 5000);
        }
      });

      console.log(`[GPS] Started — foreground only, compass active — ticket: ${gpsSyncManager.getTicketId()}`);
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
    // Don't interfere with clearAllData() — it needs MQTT alive to publish records
    if (clearing) return;

    // Flush in-memory GPS cache to MMKV before stopping
    gpsStorage.flush();

    running = false;
    starting = false;
    permissionDenied = false;
    pendingTicketId = null;
    setPipAutoEnter(false); // Nothing worth floating once tracking ends
    stopWatch();
    stopStationaryPoll();
    stopCompass();
    stopIdleCheck();
    stopNativeGpsListener();
    removeAppStateListener();
    connectivityRestoredUnsub?.();
    connectivityRestoredUnsub = null;
    connectivityLostUnsub?.();
    connectivityLostUnsub = null;
    gpsSyncManager.stop();
    lastPosition = null;
    lastGpsFixTime = 0;
    firstGoodFixTime = 0;
    lastSavedPosition = null;
    wasStationary = false;
    stationaryPosition = null;
    consecutiveMovingCount = 0;
    consecutiveSlowCount = 0;
    lastHeartbeatAt = 0;
    compassHeading = null;
    lastGpsHeading = 0;
    // Switch native service to silent mode — keeps collecting GPS in background
    if (Platform.OS === 'android' && LocationTrackingModule) {
      LocationTrackingModule.setJsAlive(false).catch(() => {});
      LocationTrackingModule.setSilentMode(true).catch(() => {});
    }
    mqttService.disconnect();
    console.log('[GPS] UI stopped — native GPS continues silently');
  },

  /** Stop GPS, upload pending records, fully stop native service, then logout. */
  async clearAllData(): Promise<void> {
    if (clearing) return; // Prevent double execution
    clearing = true;
    try {
      stopWatch();
      stopStationaryPoll();
      stopCompass();
      stopIdleCheck();
      stopNativeGpsListener();
      removeAppStateListener();
      connectivityRestoredUnsub?.();
      connectivityRestoredUnsub = null;
      connectivityLostUnsub?.();
      connectivityLostUnsub = null;

      // Flush in-memory GPS cache to MMKV before stopping
      gpsStorage.flush();

      // Stop native service FIRST so it stops writing new records
      await stopTrackingService();

      // Now import native records (no new ones being written)
      await importNativeRecords();

      // Publish all remaining GPS records to MQTT BEFORE disconnecting
      let publishedAll = false;
      try {
        await publishBackgroundRecords();
        const remaining = gpsStorage.getUnsynced();
        publishedAll = remaining.length === 0;
      } catch (err: any) {
        console.warn(`[GPS] MQTT flush on logout failed: ${err.message}`);
      }

      // NOW disconnect MQTT — this also clears the native MQTT credentials and
      // tears down the native Paho client, which used to keep publishing after
      // logout on credentials it still held in memory.
      mqttService.disconnect();

      // Forget the driver's API tokens on the native side too. They were written
      // by setApiCredentials() at login and nothing ever removed them, so a
      // logged-out phone still held everything needed to mint a fresh MQTT token.
      if (Platform.OS === 'android' && LocationTrackingModule?.clearApiCredentials) {
        LocationTrackingModule.clearApiCredentials().catch(() => {});
      }

      if (publishedAll) {
        // All records published — safe to clear
        gpsStorage.clear();
      } else {
        // Offline — keep unsynced records for next app launch.
        // autoResume() will publish them when internet is available.
        console.log('[GPS] Offline logout — keeping unsynced records for next launch');
        gpsStorage.clearSynced();
      }

      gpsSyncManager.stop();
      running = false;
      starting = false;
      permissionDenied = false;
      pendingTicketId = null;
      lastPosition = null;
      lastGpsFixTime = 0;
      firstGoodFixTime = 0;
      lastSavedPosition = null;
      wasStationary = false;
      stationaryPosition = null;
      consecutiveMovingCount = 0;
      consecutiveSlowCount = 0;
      lastHeartbeatAt = 0;
      compassHeading = null;
      lastGpsHeading = 0;
      currentBehavior = {};
      listeners.clear();
      // Clear persisted idle timer on logout AND reset in-memory variable
      // so a new user login doesn't inherit the stale 2h+ value
      storage.remove(IDLE_STORAGE_KEY);
      lastMovementTime = Date.now();
      idleWarningShown = false;
      console.log('[GPS] Logout complete — native service stopped');
    } finally {
      clearing = false;
    }
  },

  /** Whether tracking is active. */
  isRunning(): boolean {
    return running;
  },

  /** Get last known position. */
  getLastPosition(): GpsPosition | null {
    return lastPosition;
  },

  /** Whether the truck is currently stationary (speed < 1.0 m/s). */
  isCurrentlyIdle(): boolean {
    return wasStationary;
  },

  /**
   * GPS signal freshness based on time since last accepted fix.
   * - 'live':    < 10s  — actively receiving GPS
   * - 'recent':  < 60s  — briefly interrupted but recent
   * - 'stale':   < 5min — GPS signal degraded or app backgrounded
   * - 'offline': > 5min — no GPS data, likely no signal or tracking stopped
   */
  getGpsFreshness(): 'live' | 'recent' | 'stale' | 'offline' {
    if (!running || lastGpsFixTime === 0) return 'offline';
    const age = Date.now() - lastGpsFixTime;
    if (age < 10_000) return 'live';
    if (age < 60_000) return 'recent';
    if (age < 300_000) return 'stale';
    return 'offline';
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

  /** Import any leftover native records on app startup, publish to MQTT, then clear. */
  async autoResume(): Promise<void> {
    // Report whatever the native service logged while the app was gone. Runs on
    // every cold start, so a failure that happened overnight still reaches Sentry.
    reportNativeGpsDiagnostics().catch(() => {});

    // Import native records from previous session (e.g., collected before app was killed)
    const imported = await importNativeRecords();
    if (imported > 0) {
      console.log(`[GPS] autoResume — imported ${imported} native records from previous session`);
    }

    // Note: importNativeRecords() already clears native SharedPrefs on success.
    // Do NOT clear again here — if import had errors, records are kept for retry.

    // Try to publish leftover records to MQTT
    const unsynced = gpsStorage.getUnsynced();
    if (unsynced.length > 0) {
      console.log(`[GPS] autoResume — ${unsynced.length} leftover records, attempting MQTT publish...`);
      try {
        const connected = await mqttService.connect();
        if (connected) {
          await publishBackgroundRecords();
          // Only clear records that were successfully synced — keep failed ones for retry
          gpsStorage.clearSynced();
          const remaining = gpsStorage.getUnsynced();
          if (remaining.length > 0) {
            console.log(`[GPS] autoResume — ${remaining.length} records still unsynced, keeping for later`);
          } else {
            console.log('[GPS] autoResume — all leftover records published');
          }
        } else {
          // MQTT not available — keep records in gpsStorage for later.
          // startAlways() will connect MQTT and publishBackgroundRecords() on login.
          console.log('[GPS] autoResume — MQTT not available, keeping records for later publish');
        }
      } catch (err: any) {
        console.warn(`[GPS] autoResume — publish failed, keeping records: ${err.message}`);
      }
    } else {
      gpsStorage.clear();
      console.log('[GPS] autoResume — no leftover records');
    }
  },
};
