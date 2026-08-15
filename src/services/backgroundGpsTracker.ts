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
import {getIsOnline, onConnectivityRestored} from '../hooks/useNetworkStatus';
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
let lastSavedPosition: {latitude: number; longitude: number} | null = null;
const MIN_DISTANCE_TO_SAVE = 5; // metres — only save when moved this far
let wasStationary = false; // true after first stationary fix is saved — suppresses drift
let consecutiveMovingCount = 0;
const MOVING_CONFIRM_THRESHOLD = 3; // Require 3 consecutive moving fixes to clear stationary
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
  const isMoving = speed >= 1.0; // same threshold as stationary detection
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
    ticket_code: gpsSyncManager.getTicketCode(),
    client_id: data.id,
    battery_level: battery,
  };

  if (mqttService.isConnected()) {
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
            LocationTrackingModule.isTrackingActive().then((active: boolean) => {
              if (!active) {
                console.log('[GPS] Native service died in background — restarting');
                startTrackingService(gpsSyncManager.getTicketId()).catch(() => {});
              }
            }).catch(() => {
              // Module not available — try restarting anyway
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
          // 4. Import native records, update idle timer, then restart idle interval
          importNativeRecordsAndUpdateIdle()
            .catch(() => {
              // Import failed — do NOT reset lastMovementTime.
              // If truck was idle for 2h+, the timer should still trigger logout.
            })
            .finally(() => resumeIdleCheck());
        } else {
          // iOS: watcher kept running in background — just resume idle check
          console.log('[GPS] App foregrounded (iOS) — resuming idle check');
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
        // iOS: No native service — keep JS watchPosition running in background.
        // Requires "Location updates" background mode in Info.plist.
        // Switch to stationary poll if not moving to save battery.
        console.log('[GPS] App backgrounded (iOS) — JS GPS continues in background');
        stopStationaryPoll();
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
    if (status === 'granted' || status === 'restricted') return true;
    if (status === 'whenInUse') {
      showToast('info', 'Limited Tracking', 'GPS will only work while the app is open.');
      return true;
    }
    return false;
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
        showToast('info', 'Limited Tracking', 'GPS will only work while the app is open.');
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

/** Publish unsynced background records via MQTT when app returns to foreground. */
let isPublishingBackground = false;
let publishQueued = false; // Re-run after current publish finishes if new records arrived
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

    const unsynced = gpsStorage.getUnsynced();
    if (unsynced.length === 0) return;

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
          ticket_id: r.ticket_id,
          ticket_code: gpsSyncManager.getTicketCode(),
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

  // Skip very inaccurate fixes (50m+ causes visible zigzag on the route map)
  if (accuracy != null && accuracy >= 50) {
    console.log(`[GPS] Skipping inaccurate fix: ${accuracy.toFixed(0)}m`);
    return;
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

  // Update lastPosition only after filtering out mocked/inaccurate/invalid positions
  lastPosition = pos;
  lastGpsFixTime = Date.now();

  // Notify listeners only after filtering out mocked/inaccurate positions
  notifyListeners(pos);

  // Stationary detection: skip GPS drift when truck is not moving
  const isStationary = currentSpeed < 1.0; // < 1.0 m/s ≈ 3.6 km/h — only truly stopped

  if (isStationary) {
    consecutiveMovingCount = 0;
    if (wasStationary) {
      // Already stationary — switch to low-frequency poll to save battery
      if (!stationaryPollTimer && AppState.currentState === 'active') {
        startStationaryPoll();
      }
      return;
    }
    // First stationary fix — save it so we know WHERE the truck stopped
    wasStationary = true;
    console.log(`[GPS] FIRST STOP: saving stopped-at position, lat=${latitude.toFixed(6)}, lng=${longitude.toFixed(6)}`);
  } else {
    consecutiveMovingCount++;
    if (consecutiveMovingCount >= MOVING_CONFIRM_THRESHOLD) {
      // Confirmed real movement — clear stationary flag and resume full GPS
      wasStationary = false;
      if (stationaryPollTimer) {
        stopStationaryPoll();
        startWatch();
        console.log(`[GPS] MOVEMENT CONFIRMED: resumed full GPS, speed=${currentSpeed.toFixed(1)}`);
      } else {
        console.log(`[GPS] MOVEMENT CONFIRMED: ${consecutiveMovingCount} consecutive moving fixes, speed=${currentSpeed.toFixed(1)}`);
      }
    } else if (wasStationary) {
      console.log(`[GPS] SPIKE BLOCKED: speed=${currentSpeed.toFixed(1)}, movingCount=${consecutiveMovingCount}/${MOVING_CONFIRM_THRESHOLD}, lat=${latitude.toFixed(6)}`);
      return;
    }
  }

  // Only save when truck has moved > 5m from last saved position
  if (lastSavedPosition) {
    const dist = haversineDistance(
      lastSavedPosition.latitude, lastSavedPosition.longitude,
      latitude, longitude,
    );
    if (dist < MIN_DISTANCE_TO_SAVE) {
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
  if (mqttService.isConnected()) {
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
      maximumAge: 6000,
      // iOS: show blue location indicator bar when tracking in background
      ...(Platform.OS === 'ios' ? {showsBackgroundLocationIndicator: true} : {}),
    },
  );
  console.log('[GPS] watchPosition started (1s interval, FusedLocationProvider)');
}

/** Switch to low-frequency polling when truck is stationary.
 *  Checks every 10s just to detect when movement resumes. */
function startStationaryPoll() {
  if (stationaryPollTimer) return;
  stopWatch(); // Stop high-frequency GPS

  stationaryPollTimer = setInterval(() => {
    Geolocation.getCurrentPosition(
      (position) => handlePosition(position),
      () => {}, // Ignore errors during stationary poll
      {enableHighAccuracy: true, timeout: 10000, maximumAge: 5000},
    );
  }, 10000);
  console.log('[GPS] Stationary — switched to 10s poll (waiting for movement)');
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
      connectivityRestoredUnsub?.();
      connectivityRestoredUnsub = onConnectivityRestored(() => {
        console.log('[GPS] Connectivity restored — reconnecting MQTT and publishing offline records');
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
      connectivityRestoredUnsub?.();
      connectivityRestoredUnsub = onConnectivityRestored(() => {
        console.log('[GPS] Connectivity restored — reconnecting MQTT and publishing offline records');
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
    stopWatch();
    stopStationaryPoll();
    stopCompass();
    stopIdleCheck();
    stopNativeGpsListener();
    removeAppStateListener();
    connectivityRestoredUnsub?.();
    connectivityRestoredUnsub = null;
    gpsSyncManager.stop();
    lastPosition = null;
    lastGpsFixTime = 0;
    lastSavedPosition = null;
    wasStationary = false;
    consecutiveMovingCount = 0;
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

      // NOW disconnect MQTT
      mqttService.disconnect();

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
      lastSavedPosition = null;
      wasStationary = false;
      consecutiveMovingCount = 0;
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
    // Import native records from previous session (e.g., collected before app was killed)
    const imported = await importNativeRecords();
    if (imported > 0) {
      console.log(`[GPS] autoResume — imported ${imported} native records from previous session`);
    }

    // Clear native SharedPrefs — records are now in MMKV gpsStorage
    if (Platform.OS === 'android' && LocationTrackingModule) {
      LocationTrackingModule.clearStoredRecords().catch(() => {});
    }

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
