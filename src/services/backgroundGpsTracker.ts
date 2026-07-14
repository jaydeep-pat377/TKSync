import {Platform, PermissionsAndroid, NativeModules} from 'react-native';
import Geolocation from 'react-native-geolocation-service';
import {createMMKV} from 'react-native-mmkv';
import {gpsStorage} from './gpsStorage';
import {gpsSyncManager} from './gpsSyncManager';
import {startTrackingService} from './trackingForegroundService';
import notifee from '@notifee/react-native';
import {showToast} from '../utils/toast';
import {getIsOnline} from '../hooks/useNetworkStatus';

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

const store = createMMKV({id: 'tksync-bg-tracker'});
const ACTIVE_KEY = 'tracking_active';
const TICKET_KEY = 'tracking_ticket_id';

let running = false;
let watchId: number | null = null;
let lastPosition: GpsPosition | null = null;
let currentBehavior: BehaviorData = {};
const listeners = new Set<GpsListener>();

function notifyListeners(pos: GpsPosition) {
  for (const cb of listeners) {
    try { cb(pos); } catch {}
  }
}

async function checkPermissions(): Promise<boolean> {
  if (Platform.OS === 'ios') {
    const status = await Geolocation.requestAuthorization('always');
    return status === 'granted' || status === 'restricted';
  }
  const fine = await PermissionsAndroid.check(
    PermissionsAndroid.PERMISSIONS.ACCESS_FINE_LOCATION,
  );
  return fine;
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

/**
 * Import GPS records collected by the native Android service while the app was killed.
 * Moves them into MMKV gpsStorage so gpsSyncManager can sync them to the API.
 */
async function importNativeRecords(): Promise<number> {
  if (Platform.OS !== 'android' || !LocationTrackingModule) return 0;
  try {
    const records = await LocationTrackingModule.getStoredRecords();
    if (!records || records.length === 0) return 0;

    // Deduplicate: check existing MMKV records to avoid duplicates if previous import was interrupted
    const existing = new Set(gpsStorage.getAll().map(r => r.recorded_at));

    let imported = 0;
    for (const r of records) {
      if (r.synced) continue;
      if (existing.has(r.recorded_at)) continue; // skip duplicates
      gpsStorage.addRecord({
        ticket_id: r.ticket_id || null,
        latitude: r.latitude,
        longitude: r.longitude,
        speed: r.speed || 0,
        heading: r.heading || 0,
        altitude: r.altitude || null,
        accuracy: r.accuracy || null,
        recorded_at: r.recorded_at,
        is_speeding: r.is_speeding || false,
        is_idle: r.is_idle || false,
      });
      imported++;
    }

    await LocationTrackingModule.clearStoredRecords();
    if (imported > 0) {
      console.log(`[BackgroundGPS] Imported ${imported} native GPS records from killed state`);
    }
    return imported;
  } catch (e: any) {
    console.warn('[BackgroundGPS] Failed to import native records:', e.message);
    return 0;
  }
}

function startWatch() {
  if (watchId !== null) return;

  watchId = Geolocation.watchPosition(
    (position) => {
      const {latitude, longitude, speed, heading, altitude, accuracy} = position.coords;
      const currentSpeed = Math.max(0, speed || 0);

      const pos: GpsPosition = {
        latitude,
        longitude,
        speed: currentSpeed,
        heading: heading || 0,
        altitude: altitude || 0,
        accuracy: accuracy || 0,
        timestamp: position.timestamp,
      };
      lastPosition = pos;

      gpsStorage.addRecord({
        ticket_id: gpsSyncManager.getTicketId(),
        latitude,
        longitude,
        speed: currentSpeed,
        heading: heading || 0,
        altitude: altitude || null,
        accuracy: accuracy || null,
        recorded_at: new Date(position.timestamp).toISOString(),
        ...currentBehavior,
      });

      notifyListeners(pos);
    },
    (error) => {
      console.warn('[BackgroundGPS] Error:', error.message);
    },
    {
      enableHighAccuracy: true,
      distanceFilter: 10,
      interval: 120000,
      fastestInterval: 60000,
      showLocationDialog: true,
      forceRequestLocation: true,
    },
  );
  console.log('[BackgroundGPS] watchPosition started');
}

function stopWatch() {
  if (watchId !== null) {
    Geolocation.clearWatch(watchId);
    watchId = null;
    console.log('[BackgroundGPS] watchPosition stopped');
  }
}

function persistState(active: boolean, ticketId: number | null) {
  store.set(ACTIVE_KEY, active);
  if (ticketId !== null) {
    store.set(TICKET_KEY, ticketId);
  } else {
    store.set(TICKET_KEY, 0);
  }
}

export const backgroundGpsTracker = {
  /**
   * Start global GPS tracking.
   * @param ticketId - fallback ticket ID (passed from Dashboard/VehicleTracking)
   * @param silent - if true, skip permission request (for auto-resume); just check if already granted
   * Returns false if no ticket or no permission.
   */
  async start(ticketId?: number | null, silent = false): Promise<boolean> {
    if (running) return true;

    // Check/request permissions
    const hasPermission = silent ? await checkPermissions() : await requestPermissions();
    if (!hasPermission) {
      if (!silent) {
        showToast('error', 'Permission Denied', 'Location permission is required for GPS tracking.');
      }
      return false;
    }

    // Resolve ticket via gpsSyncManager
    const hasTicket = await gpsSyncManager.start(ticketId);
    if (!hasTicket) {
      if (!silent) {
        showToast('error', 'No Active Ticket', 'GPS tracking requires an in-process delivery.');
      }
      return false;
    }

    if (!getIsOnline() && !silent) {
      showToast('info', 'Offline Mode', 'GPS data will be uploaded when connection is restored.');
    }

    // Auto-stop when ticket becomes inactive
    gpsSyncManager.setOnTicketInactive(() => {
      backgroundGpsTracker.stop();
      showToast('info', 'Tracking Stopped', 'Ticket is no longer in process.');
    });

    const resolvedTicketId = gpsSyncManager.getTicketId();
    await startTrackingService(resolvedTicketId);
    startWatch();

    running = true;
    persistState(true, resolvedTicketId);
    console.log('[BackgroundGPS] Started globally');
    return true;
  },

  /** Stop visible GPS tracking. Native service continues silently. */
  stop(): void {
    if (!running && watchId === null) return;

    stopWatch();
    gpsSyncManager.stop();

    // Switch native service to silent mode instead of stopping it
    if (Platform.OS === 'android' && LocationTrackingModule) {
      LocationTrackingModule.setSilentMode(true).catch(() => {});
      console.log('[BackgroundGPS] Native service switched to silent mode');
    }

    // Stop only the notifee foreground service (not the native one)
    try {
      notifee.stopForegroundService().catch(() => {});
      notifee.cancelNotification('tracking-foreground').catch(() => {});
    } catch {}

    running = false;
    lastPosition = null;
    persistState(false, null);
    console.log('[BackgroundGPS] Visible tracking stopped — native continues silently');
  },

  /** Whether tracking is currently active. */
  isRunning(): boolean {
    return running;
  },

  /** Get the last known GPS position (null if not tracking). */
  getLastPosition(): GpsPosition | null {
    return lastPosition;
  },

  /**
   * Subscribe to real-time position updates.
   * Returns an unsubscribe function.
   */
  addListener(cb: GpsListener): () => void {
    listeners.add(cb);
    return () => { listeners.delete(cb); };
  },

  /** Update behavior data that gets attached to each GPS record. */
  setBehavior(data: BehaviorData): void {
    currentBehavior = data;
  },

  /** Save a trip summary (called when driver stops tracking). */
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

  /** Clear all GPS data and fully stop everything (called on driver logout). */
  clearAllData(): void {
    // Stop JS watcher
    stopWatch();
    // Stop sync interval
    gpsSyncManager.stop();
    // Stop notifee
    try {
      notifee.stopForegroundService().catch(() => {});
      notifee.cancelNotification('tracking-foreground').catch(() => {});
    } catch {}

    // Fully stop native service
    if (Platform.OS === 'android' && LocationTrackingModule) {
      LocationTrackingModule.stopTracking().catch(() => {});
      LocationTrackingModule.clearStoredRecords().catch(() => {});
    }

    // Clear all local data
    gpsStorage.clear();
    running = false;
    lastPosition = null;
    currentBehavior = {};
    persistState(false, null);
    console.log('[BackgroundGPS] All GPS data cleared + everything stopped (driver logout)');
  },

  /**
   * Auto-resume tracking on app startup if it was active before (e.g., after app kill).
   * Called from OfflineSyncContext. Uses silent mode (no permission prompts, no toasts).
   * Also imports any GPS records collected natively while the app was killed.
   */
  async autoResume(): Promise<void> {
    // Import GPS records collected by native service while app was killed
    const imported = await importNativeRecords();

    // Flush any imported records to server immediately (even if tracking won't resume)
    if (imported > 0 && getIsOnline()) {
      gpsSyncManager.flushUnsynced();
    }

    const wasActive = store.getBoolean(ACTIVE_KEY);
    // Also check native service state (it survives app kill via START_STICKY)
    let nativeActive = false;
    if (Platform.OS === 'android' && LocationTrackingModule) {
      try {
        nativeActive = await LocationTrackingModule.isTrackingActive();
      } catch {}
    }

    if (!wasActive && !nativeActive) return;

    let savedTicketId: number | null = null;
    const raw = store.getNumber(TICKET_KEY);
    savedTicketId = raw && raw > 0 ? raw : null;

    // If no ticket from MMKV, try native service
    if (!savedTicketId && nativeActive && LocationTrackingModule) {
      try {
        const nativeTicket = await LocationTrackingModule.getTicketId();
        if (nativeTicket && nativeTicket > 0) savedTicketId = nativeTicket;
      } catch {}
    }

    console.log(`[BackgroundGPS] Auto-resuming — ticket: ${savedTicketId}, imported: ${imported} native records`);

    const started = await backgroundGpsTracker.start(savedTicketId, true);
    if (!started) {
      console.log('[BackgroundGPS] Auto-resume failed — clearing state');
      persistState(false, null);
    }
  },
};
