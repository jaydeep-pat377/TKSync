import {Platform, PermissionsAndroid} from 'react-native';
import Geolocation from 'react-native-geolocation-service';
import {createMMKV} from 'react-native-mmkv';
import {gpsStorage} from './gpsStorage';
import {gpsSyncManager} from './gpsSyncManager';
import {startTrackingService, stopTrackingService} from './trackingForegroundService';
import {showToast} from '../utils/toast';
import {getIsOnline} from '../hooks/useNetworkStatus';

export type GpsPosition = {
  latitude: number;
  longitude: number;
  speed: number;
  heading: number;
  altitude: number;
  accuracy: number;
  timestamp: number;
};

type GpsListener = (position: GpsPosition) => void;

const store = createMMKV({id: 'tksync-bg-tracker'});
const ACTIVE_KEY = 'tracking_active';
const TICKET_KEY = 'tracking_ticket_id';

let running = false;
let watchId: number | null = null;
let lastPosition: GpsPosition | null = null;
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
      });

      notifyListeners(pos);
    },
    (error) => {
      console.warn('[BackgroundGPS] Error:', error.message);
    },
    {
      enableHighAccuracy: true,
      distanceFilter: 5,
      interval: 2000,
      fastestInterval: 1000,
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

    await startTrackingService();
    startWatch();

    running = true;
    persistState(true, gpsSyncManager.getTicketId());
    console.log('[BackgroundGPS] Started globally');
    return true;
  },

  /** Stop global GPS tracking. */
  stop(): void {
    if (!running && watchId === null) return;

    stopWatch();
    gpsSyncManager.stop();
    stopTrackingService();

    running = false;
    lastPosition = null;
    persistState(false, null);
    console.log('[BackgroundGPS] Stopped globally');
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

  /**
   * Auto-resume tracking on app startup if it was active before (e.g., after app kill).
   * Called from OfflineSyncContext. Uses silent mode (no permission prompts, no toasts).
   */
  async autoResume(): Promise<void> {
    const wasActive = store.getBoolean(ACTIVE_KEY);
    if (!wasActive) return;

    const raw = store.getNumber(TICKET_KEY);
    const savedTicketId = raw && raw > 0 ? raw : null;
    console.log('[BackgroundGPS] Auto-resuming — ticket:', savedTicketId);

    const started = await backgroundGpsTracker.start(savedTicketId, true);
    if (!started) {
      console.log('[BackgroundGPS] Auto-resume failed — clearing state');
      persistState(false, null);
    }
  },
};
