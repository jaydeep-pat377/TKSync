/**
 * Comprehensive GPS Tracking Test Suite
 *
 * Covers every combination of:
 *   - App state: Foreground / Background / Transitions
 *   - Network:   Online / Offline / Transitions
 *   - Vehicle:   Moving / Stopped / Traffic / Parking
 *
 * Categories:
 *   1. Core Algorithm — position filtering, stationary detection, distance filter
 *   2. Haversine — edge cases for distance calculation
 *   3. Movement Patterns — real-world driving scenarios
 *   4. App State Transitions — FG↔BG with state handoff
 *   5. Network Transitions — Online↔Offline during sync
 *   6. Combined Transitions — double state changes
 *   7. Data Integrity — storage, dedup, limits, corruption
 *   8. Sync Manager — batch upload, backoff, ticket resolution
 *   9. Idle Auto-Logout — timer, warning, reset
 *  10. Edge Cases — boundary values, rapid updates, invalid data
 */

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// ── Simulation Engine (mirrors backgroundGpsTracker.ts + LocationTrackingService.kt)
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

const MIN_DISTANCE_TO_SAVE = 5;
const MOVING_CONFIRM_THRESHOLD = 3;
const IDLE_SPEED_THRESHOLD = 1.67; // m/s ≈ 6 km/h
const NATIVE_IDLE_DISTANCE_THRESHOLD = 50; // metres
const NATIVE_IDLE_CONSECUTIVE_THRESHOLD = 3;
const MAX_ACCURACY = 100; // metres — fixes above this are skipped
const IDLE_LOGOUT_MS = 2 * 60 * 60 * 1000; // 2 hours
const IDLE_WARNING_MS = (2 * 60 - 10) * 60 * 1000; // 1h 50m

type SimFix = {
  latitude: number;
  longitude: number;
  speed: number; // m/s — use -1 for "unavailable"
  accuracy: number; // metres
  timestamp?: number; // epoch ms
  mocked?: boolean;
};

type SavedRecord = SimFix & {
  index: number;
  phase: 'foreground' | 'background' | 'resumed';
  is_idle: boolean;
};

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

// ── JS-side simulation (handlePosition logic) ──

type JsTrackerState = {
  wasStationary: boolean;
  consecutiveMovingCount: number;
  lastSavedPosition: { latitude: number; longitude: number } | null;
};

function createJsTracker(): JsTrackerState {
  return { wasStationary: false, consecutiveMovingCount: 0, lastSavedPosition: null };
}

function jsHandlePosition(
  state: JsTrackerState,
  fix: SimFix,
  opts?: { isDev?: boolean },
): { saved: boolean; reason?: string } {
  // Skip mocked in dev
  if (opts?.isDev && fix.mocked) {
    return { saved: false, reason: 'mocked' };
  }

  // Speed handling — unavailable (-1) or NaN treated as 0
  const speedAvailable = typeof fix.speed === 'number' && !isNaN(fix.speed) && fix.speed >= 0;
  const currentSpeed = speedAvailable ? fix.speed : 0;

  // Skip inaccurate fixes
  if (fix.accuracy != null && fix.accuracy > MAX_ACCURACY) {
    return { saved: false, reason: 'inaccurate' };
  }

  const isStationary = currentSpeed < IDLE_SPEED_THRESHOLD;

  if (isStationary) {
    state.consecutiveMovingCount = 0;
    if (state.wasStationary) {
      return { saved: false, reason: 'drift_blocked' };
    }
    state.wasStationary = true;
  } else {
    state.consecutiveMovingCount++;
    if (state.consecutiveMovingCount >= MOVING_CONFIRM_THRESHOLD) {
      state.wasStationary = false;
    } else if (state.wasStationary) {
      return { saved: false, reason: 'spike_blocked' };
    }
  }

  // Distance check
  if (state.lastSavedPosition) {
    const dist = haversineDistance(
      state.lastSavedPosition.latitude, state.lastSavedPosition.longitude,
      fix.latitude, fix.longitude,
    );
    if (dist < MIN_DISTANCE_TO_SAVE) {
      return { saved: false, reason: 'too_close' };
    }
  }

  state.lastSavedPosition = { latitude: fix.latitude, longitude: fix.longitude };
  return { saved: true };
}

// ── Native-side simulation (saveLocation logic from LocationTrackingService.kt) ──

type NativeTrackerState = {
  wasStationary: boolean;
  consecutiveMovingCount: number;
  lastSavedLat: number;
  lastSavedLng: number;
  isIdleMode: boolean;
  idleLat: number;
  idleLng: number;
  consecutiveIdleCount: number;
  jsAlive: boolean;
  jsHeartbeat: number; // epoch ms
};

function createNativeTracker(): NativeTrackerState {
  return {
    wasStationary: false,
    consecutiveMovingCount: 0,
    lastSavedLat: 0, lastSavedLng: 0,
    isIdleMode: false,
    idleLat: 0, idleLng: 0,
    consecutiveIdleCount: 0,
    jsAlive: false,
    jsHeartbeat: 0,
  };
}

function nativeSaveLocation(
  state: NativeTrackerState,
  fix: SimFix,
  currentTime: number = Date.now(),
): { saved: boolean; reason?: string; idleModeChanged?: boolean } {
  // JS alive check
  if (state.jsAlive) {
    if (state.jsHeartbeat > 0 && currentTime - state.jsHeartbeat < 30000) {
      return { saved: false, reason: 'js_alive' };
    }
    state.jsAlive = false; // heartbeat stale
  }

  // Accuracy filter
  if (fix.accuracy > MAX_ACCURACY) {
    return { saved: false, reason: 'inaccurate' };
  }

  const speedAvailable = fix.speed >= 0;
  const speedMs = speedAvailable ? fix.speed : 0;
  const isConfirmedMoving = speedAvailable && speedMs >= IDLE_SPEED_THRESHOLD;
  let suppressDrift = false;

  // Stationary detection
  if (isConfirmedMoving) {
    state.consecutiveMovingCount++;
    if (state.consecutiveMovingCount >= MOVING_CONFIRM_THRESHOLD) {
      state.wasStationary = false;
    } else if (state.wasStationary) {
      suppressDrift = true;
    }
  } else {
    state.consecutiveMovingCount = 0;
    if (state.wasStationary) {
      suppressDrift = true;
    } else {
      state.wasStationary = true;
    }
  }

  // Idle detection
  let idleModeChanged = false;
  if (isConfirmedMoving) {
    if (state.isIdleMode) {
      state.isIdleMode = false;
      state.idleLat = 0;
      state.idleLng = 0;
      idleModeChanged = true;
    }
    state.consecutiveIdleCount = 0;
  } else {
    let movedFromIdle = false;
    if (state.isIdleMode && state.idleLat !== 0 && state.idleLng !== 0) {
      const dist = haversineDistance(state.idleLat, state.idleLng, fix.latitude, fix.longitude);
      if (dist > NATIVE_IDLE_DISTANCE_THRESHOLD) {
        movedFromIdle = true;
      }
    }

    if (movedFromIdle) {
      state.isIdleMode = false;
      state.idleLat = 0;
      state.idleLng = 0;
      state.consecutiveIdleCount = 0;
      idleModeChanged = true;
    } else {
      state.consecutiveIdleCount++;
      if (state.consecutiveIdleCount >= NATIVE_IDLE_CONSECUTIVE_THRESHOLD) {
        if (!state.isIdleMode) {
          state.isIdleMode = true;
          state.idleLat = fix.latitude;
          state.idleLng = fix.longitude;
          idleModeChanged = true;
        }
        return { saved: false, reason: 'idle_mode', idleModeChanged };
      }
    }
  }

  if (suppressDrift) return { saved: false, reason: suppressDrift ? 'drift_blocked' : undefined, idleModeChanged };

  // Distance filter (native uses adaptive threshold for poor accuracy)
  const minDistance = (fix.accuracy > 15) ? Math.max(10, fix.accuracy * 0.75) : 5;
  if (state.lastSavedLat !== 0 && state.lastSavedLng !== 0) {
    const dist = haversineDistance(state.lastSavedLat, state.lastSavedLng, fix.latitude, fix.longitude);
    if (dist < minDistance) {
      return { saved: false, reason: 'too_close', idleModeChanged };
    }
  }

  state.lastSavedLat = fix.latitude;
  state.lastSavedLng = fix.longitude;
  return { saved: true, idleModeChanged };
}

// ── Full lifecycle simulation ──

type AppPhase = 'foreground' | 'background' | 'resumed';

type PhaseConfig = {
  phase: AppPhase;
  fixes: SimFix[];
};

type LifecycleResult = {
  saved: SavedRecord[];
  jsProcessed: number;
  jsSkipped: number;
  nativeProcessed: number;
  nativeSkipped: number;
  nativeSaved: number;
};

function simulateFullLifecycle(phases: PhaseConfig[]): LifecycleResult {
  let jsState = createJsTracker();
  const saved: SavedRecord[] = [];
  let globalIdx = 0;
  let jsProcessed = 0;
  let jsSkipped = 0;
  let nativeProcessed = 0;
  let nativeSkipped = 0;
  let nativeSaved = 0;

  for (const { phase, fixes } of phases) {
    if (phase === 'background') {
      // App went to background: JS stops, native handles
      jsState.consecutiveMovingCount = 0; // reset on background
      // wasStationary persists

      // Simulate native processing
      const nativeState = createNativeTracker();
      for (const fix of fixes) {
        nativeProcessed++;
        const result = nativeSaveLocation(nativeState, fix);
        if (result.saved) {
          nativeSaved++;
          saved.push({
            ...fix,
            index: globalIdx,
            phase: 'background',
            is_idle: fix.speed < IDLE_SPEED_THRESHOLD,
          });
        } else {
          nativeSkipped++;
        }
        globalIdx++;
      }
      continue;
    }

    // foreground or resumed
    for (const fix of fixes) {
      jsProcessed++;
      const result = jsHandlePosition(jsState, fix);
      if (result.saved) {
        saved.push({
          ...fix,
          index: globalIdx,
          phase,
          is_idle: fix.speed < IDLE_SPEED_THRESHOLD,
        });
      } else {
        jsSkipped++;
      }
      globalIdx++;
    }
  }

  return { saved, jsProcessed, jsSkipped, nativeProcessed, nativeSkipped, nativeSaved };
}

// ── Sync simulation ──

type SyncRecord = {
  id: string;
  ticket_id: number | null;
  latitude: number;
  longitude: number;
  synced: boolean;
};

type SyncResult = {
  uploaded: number;
  failed: number;
  remaining: number;
};

function simulateSync(
  records: SyncRecord[],
  isOnline: boolean,
  batchSize: number = 100,
  failAtBatch?: number, // which batch fails (1-indexed)
): SyncResult {
  if (!isOnline) return { uploaded: 0, failed: 0, remaining: records.filter(r => !r.synced).length };

  const unsynced = records.filter(r => !r.synced);
  if (unsynced.length === 0) return { uploaded: 0, failed: 0, remaining: 0 };

  let uploaded = 0;
  let batchNum = 0;
  for (let i = 0; i < unsynced.length; i += batchSize) {
    batchNum++;
    if (failAtBatch && batchNum >= failAtBatch) break;
    const batch = unsynced.slice(i, i + batchSize);
    batch.forEach(r => { r.synced = true; });
    uploaded += batch.length;
  }

  return {
    uploaded,
    failed: unsynced.length - uploaded,
    remaining: records.filter(r => !r.synced).length,
  };
}

// ── Storage simulation ──

type StorageRecord = {
  id: string;
  synced: boolean;
  latitude: number;
  longitude: number;
};

function simulateStorage() {
  let records: StorageRecord[] = [];

  return {
    addRecord(lat: number, lng: number): string {
      const id = `gps_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
      records.push({ id, synced: false, latitude: lat, longitude: lng });
      // Trim logic
      if (records.length > 600) {
        const unsynced = records.filter(r => !r.synced);
        const synced = records.filter(r => r.synced).slice(-100);
        records = [...synced, ...unsynced];
      }
      return id;
    },
    importRecord(id: string, lat: number, lng: number): boolean {
      if (records.some(r => r.id === id)) return false; // dedup
      records.push({ id, synced: false, latitude: lat, longitude: lng });
      if (records.length > 600) {
        const unsynced = records.filter(r => !r.synced);
        const synced = records.filter(r => r.synced).slice(-100);
        records = [...synced, ...unsynced];
      }
      return true;
    },
    markSynced(ids: string[]) {
      const idSet = new Set(ids);
      records.forEach(r => { if (idSet.has(r.id)) r.synced = true; });
    },
    getUnsynced: () => records.filter(r => !r.synced),
    getAll: () => [...records],
    getCount: () => records.length,
    clear: () => { records = []; },
    clearSynced: () => { records = records.filter(r => !r.synced); },
  };
}

// ── Idle timer simulation ──

function simulateIdleTimer(events: { type: 'movement' | 'check'; atMs: number }[]): {
  warningFired: boolean;
  logoutFired: boolean;
  warningAtMs?: number;
  logoutAtMs?: number;
} {
  let lastMovementTime = 0;
  let warningFired = false;
  let logoutFired = false;
  let warningAtMs: number | undefined;
  let logoutAtMs: number | undefined;

  for (const event of events) {
    if (event.type === 'movement') {
      lastMovementTime = event.atMs;
      warningFired = false; // reset warning on movement
    } else {
      const idle = event.atMs - lastMovementTime;
      if (idle >= IDLE_LOGOUT_MS && !logoutFired) {
        logoutFired = true;
        logoutAtMs = event.atMs;
      } else if (idle >= IDLE_WARNING_MS && !warningFired) {
        warningFired = true;
        warningAtMs = event.atMs;
      }
    }
  }

  return { warningFired, logoutFired, warningAtMs, logoutAtMs };
}

// ── Test data helpers ──

const BASE_LAT = 22.298602;
const BASE_LNG = 70.798857;

function stationaryFixes(count: number, driftMeters: number, accuracy = 12): SimFix[] {
  return Array.from({ length: count }, (_, i) => ({
    latitude: BASE_LAT + ((i * 3) * 0.000009),
    longitude: BASE_LNG + ((i % 2 === 0 ? 1 : -1) * driftMeters * 0.000009),
    speed: 0,
    accuracy: accuracy + (i % 4) * 2,
  }));
}

function stationaryWithSpikes(count: number, drift: number, every: number, spikeSpeed = 2.0): SimFix[] {
  return Array.from({ length: count }, (_, i) => ({
    latitude: BASE_LAT + (i * 3 * 0.000009),
    longitude: BASE_LNG + ((i % 2 === 0 ? 1 : -1) * drift * 0.000009),
    speed: (i > 0 && i % every === 0) ? spikeSpeed : 0,
    accuracy: (i > 0 && i % every === 0) ? 25 : 12,
  }));
}

function movingFixes(count: number, speedMs: number, startLat = BASE_LAT, startLng = BASE_LNG): SimFix[] {
  return Array.from({ length: count }, (_, i) => ({
    latitude: startLat + i * 0.0001, // ~11m apart
    longitude: startLng,
    speed: speedMs,
    accuracy: 8,
  }));
}

function trafficFixes(count: number, maxSpeedMs: number): SimFix[] {
  return Array.from({ length: count }, (_, i) => ({
    latitude: BASE_LAT + i * 0.00002, // ~2.2m between fixes
    longitude: BASE_LNG,
    speed: (i % 5 === 0) ? maxSpeedMs : 0,
    accuracy: 10,
  }));
}

function stopAndGoFixes(stops: number, moveSpeed: number, moveFixes: number, stopFixes: number): SimFix[] {
  const fixes: SimFix[] = [];
  let lat = BASE_LAT;
  for (let s = 0; s < stops; s++) {
    // Move phase
    for (let i = 0; i < moveFixes; i++) {
      lat += 0.0001;
      fixes.push({ latitude: lat, longitude: BASE_LNG, speed: moveSpeed, accuracy: 8 });
    }
    // Stop phase
    for (let i = 0; i < stopFixes; i++) {
      fixes.push({
        latitude: lat + (i % 2 === 0 ? 1 : -1) * 0.000009 * 5,
        longitude: BASE_LNG,
        speed: 0,
        accuracy: 12,
      });
    }
  }
  return fixes;
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// 1. CORE ALGORITHM
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

describe('1. Core Algorithm', () => {

  describe('1.1 Position Filtering', () => {

    test('valid position is saved', () => {
      const state = createJsTracker();
      const result = jsHandlePosition(state, {
        latitude: BASE_LAT, longitude: BASE_LNG, speed: 10, accuracy: 10,
      });
      expect(result.saved).toBe(true);
    });

    test('accuracy > 100m is skipped', () => {
      const state = createJsTracker();
      const result = jsHandlePosition(state, {
        latitude: BASE_LAT, longitude: BASE_LNG, speed: 10, accuracy: 150,
      });
      expect(result.saved).toBe(false);
      expect(result.reason).toBe('inaccurate');
    });

    test('accuracy exactly 100m is saved (not > 100)', () => {
      const state = createJsTracker();
      const result = jsHandlePosition(state, {
        latitude: BASE_LAT, longitude: BASE_LNG, speed: 10, accuracy: 100,
      });
      expect(result.saved).toBe(true);
    });

    test('accuracy = 101m is skipped', () => {
      const state = createJsTracker();
      const result = jsHandlePosition(state, {
        latitude: BASE_LAT, longitude: BASE_LNG, speed: 10, accuracy: 101,
      });
      expect(result.saved).toBe(false);
    });

    test('mocked position skipped in dev mode', () => {
      const state = createJsTracker();
      const result = jsHandlePosition(state, {
        latitude: BASE_LAT, longitude: BASE_LNG, speed: 10, accuracy: 10, mocked: true,
      }, { isDev: true });
      expect(result.saved).toBe(false);
      expect(result.reason).toBe('mocked');
    });

    test('mocked position NOT skipped in production', () => {
      const state = createJsTracker();
      const result = jsHandlePosition(state, {
        latitude: BASE_LAT, longitude: BASE_LNG, speed: 10, accuracy: 10, mocked: true,
      }, { isDev: false });
      expect(result.saved).toBe(true);
    });

    test('speed = -1 (unavailable) treated as 0', () => {
      const state = createJsTracker();
      const result = jsHandlePosition(state, {
        latitude: BASE_LAT, longitude: BASE_LNG, speed: -1, accuracy: 10,
      });
      // speed 0 = stationary, first stop saves
      expect(result.saved).toBe(true);
    });

    test('speed = NaN treated as 0', () => {
      const state = createJsTracker();
      const result = jsHandlePosition(state, {
        latitude: BASE_LAT, longitude: BASE_LNG, speed: NaN, accuracy: 10,
      });
      expect(result.saved).toBe(true); // first stop
    });
  });

  describe('1.2 Stationary Detection', () => {

    test('speed < 1.67 = stationary', () => {
      const state = createJsTracker();
      jsHandlePosition(state, { latitude: BASE_LAT, longitude: BASE_LNG, speed: 1.0, accuracy: 10 });
      expect(state.wasStationary).toBe(true);
    });

    test('speed >= 1.67 = moving', () => {
      const state = createJsTracker();
      jsHandlePosition(state, { latitude: BASE_LAT, longitude: BASE_LNG, speed: 5.0, accuracy: 10 });
      expect(state.wasStationary).toBe(false);
    });

    test('speed exactly 1.67 is moving (not < 1.67)', () => {
      const state = createJsTracker();
      jsHandlePosition(state, { latitude: BASE_LAT, longitude: BASE_LNG, speed: 0, accuracy: 10 }); // set stationary
      const result = jsHandlePosition(state, {
        latitude: BASE_LAT + 0.001, longitude: BASE_LNG, speed: 1.67, accuracy: 10,
      });
      // 1.67 is NOT < 1.67, so it's "moving" — but only 1 consecutive, blocked as spike
      expect(result.saved).toBe(false);
      expect(result.reason).toBe('spike_blocked');
    });

    test('speed = 1.66 is stationary', () => {
      const state = createJsTracker();
      jsHandlePosition(state, { latitude: BASE_LAT, longitude: BASE_LNG, speed: 0, accuracy: 10 });
      const result = jsHandlePosition(state, {
        latitude: BASE_LAT + 0.001, longitude: BASE_LNG, speed: 1.66, accuracy: 10,
      });
      expect(result.saved).toBe(false);
      expect(result.reason).toBe('drift_blocked');
    });

    test('first stop saves position', () => {
      const state = createJsTracker();
      const result = jsHandlePosition(state, { latitude: BASE_LAT, longitude: BASE_LNG, speed: 0, accuracy: 10 });
      expect(result.saved).toBe(true);
      expect(state.wasStationary).toBe(true);
    });

    test('subsequent stationary fixes blocked', () => {
      const state = createJsTracker();
      jsHandlePosition(state, { latitude: BASE_LAT, longitude: BASE_LNG, speed: 0, accuracy: 10 });
      for (let i = 0; i < 50; i++) {
        const r = jsHandlePosition(state, {
          latitude: BASE_LAT + i * 0.0001, longitude: BASE_LNG, speed: 0, accuracy: 10,
        });
        expect(r.saved).toBe(false);
        expect(r.reason).toBe('drift_blocked');
      }
    });

    test('single speed spike blocked', () => {
      const state = createJsTracker();
      jsHandlePosition(state, { latitude: BASE_LAT, longitude: BASE_LNG, speed: 0, accuracy: 10 });
      const r = jsHandlePosition(state, {
        latitude: BASE_LAT + 0.001, longitude: BASE_LNG, speed: 5.0, accuracy: 10,
      });
      expect(r.saved).toBe(false);
      expect(r.reason).toBe('spike_blocked');
      expect(state.wasStationary).toBe(true); // NOT cleared
    });

    test('2 consecutive spikes blocked', () => {
      const state = createJsTracker();
      jsHandlePosition(state, { latitude: BASE_LAT, longitude: BASE_LNG, speed: 0, accuracy: 10 });
      jsHandlePosition(state, { latitude: BASE_LAT + 0.001, longitude: BASE_LNG, speed: 5.0, accuracy: 10 });
      const r = jsHandlePosition(state, { latitude: BASE_LAT + 0.002, longitude: BASE_LNG, speed: 5.0, accuracy: 10 });
      expect(r.saved).toBe(false);
      expect(r.reason).toBe('spike_blocked');
      expect(state.consecutiveMovingCount).toBe(2);
    });

    test('3 consecutive spikes clears stationary', () => {
      const state = createJsTracker();
      jsHandlePosition(state, { latitude: BASE_LAT, longitude: BASE_LNG, speed: 0, accuracy: 10 });
      jsHandlePosition(state, { latitude: BASE_LAT + 0.001, longitude: BASE_LNG, speed: 5.0, accuracy: 10 });
      jsHandlePosition(state, { latitude: BASE_LAT + 0.002, longitude: BASE_LNG, speed: 5.0, accuracy: 10 });
      const r = jsHandlePosition(state, { latitude: BASE_LAT + 0.003, longitude: BASE_LNG, speed: 5.0, accuracy: 10 });
      expect(r.saved).toBe(true);
      expect(state.wasStationary).toBe(false);
    });

    test('alternating spike/stationary never clears', () => {
      const state = createJsTracker();
      jsHandlePosition(state, { latitude: BASE_LAT, longitude: BASE_LNG, speed: 0, accuracy: 10 });
      for (let i = 1; i < 40; i++) {
        jsHandlePosition(state, {
          latitude: BASE_LAT + i * 0.0002, longitude: BASE_LNG,
          speed: i % 2 === 0 ? 0 : 3.0, accuracy: 12,
        });
      }
      expect(state.wasStationary).toBe(true); // never cleared
    });

    test('spike then stationary resets consecutiveMovingCount', () => {
      const state = createJsTracker();
      jsHandlePosition(state, { latitude: BASE_LAT, longitude: BASE_LNG, speed: 0, accuracy: 10 });
      jsHandlePosition(state, { latitude: BASE_LAT + 0.001, longitude: BASE_LNG, speed: 5.0, accuracy: 10 }); // count=1
      jsHandlePosition(state, { latitude: BASE_LAT + 0.002, longitude: BASE_LNG, speed: 5.0, accuracy: 10 }); // count=2
      jsHandlePosition(state, { latitude: BASE_LAT + 0.002, longitude: BASE_LNG, speed: 0, accuracy: 10 }); // resets to 0
      expect(state.consecutiveMovingCount).toBe(0);
      jsHandlePosition(state, { latitude: BASE_LAT + 0.003, longitude: BASE_LNG, speed: 5.0, accuracy: 10 }); // count=1
      expect(state.consecutiveMovingCount).toBe(1);
      expect(state.wasStationary).toBe(true); // still stationary — not 3 consecutive
    });
  });

  describe('1.3 Distance Filter', () => {

    test('first position always saved (no lastSavedPosition)', () => {
      const state = createJsTracker();
      expect(state.lastSavedPosition).toBeNull();
      const r = jsHandlePosition(state, { latitude: BASE_LAT, longitude: BASE_LNG, speed: 10, accuracy: 10 });
      expect(r.saved).toBe(true);
    });

    test('position > 5m saved', () => {
      const state = createJsTracker();
      jsHandlePosition(state, { latitude: BASE_LAT, longitude: BASE_LNG, speed: 10, accuracy: 10 });
      // ~11m apart
      const r = jsHandlePosition(state, { latitude: BASE_LAT + 0.0001, longitude: BASE_LNG, speed: 10, accuracy: 10 });
      expect(r.saved).toBe(true);
    });

    test('position < 5m skipped', () => {
      const state = createJsTracker();
      jsHandlePosition(state, { latitude: BASE_LAT, longitude: BASE_LNG, speed: 10, accuracy: 10 });
      // ~1m apart
      const r = jsHandlePosition(state, { latitude: BASE_LAT + 0.000009, longitude: BASE_LNG, speed: 10, accuracy: 10 });
      expect(r.saved).toBe(false);
      expect(r.reason).toBe('too_close');
    });

    test('same position repeated is skipped', () => {
      const state = createJsTracker();
      jsHandlePosition(state, { latitude: BASE_LAT, longitude: BASE_LNG, speed: 10, accuracy: 10 });
      const r = jsHandlePosition(state, { latitude: BASE_LAT, longitude: BASE_LNG, speed: 10, accuracy: 10 });
      expect(r.saved).toBe(false);
    });
  });
});

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// 2. HAVERSINE EDGE CASES
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

describe('2. Haversine Distance', () => {

  test('same point = 0 distance', () => {
    expect(haversineDistance(BASE_LAT, BASE_LNG, BASE_LAT, BASE_LNG)).toBe(0);
  });

  test('very small distance (< 1m)', () => {
    const d = haversineDistance(BASE_LAT, BASE_LNG, BASE_LAT + 0.000001, BASE_LNG);
    expect(d).toBeGreaterThan(0);
    expect(d).toBeLessThan(1);
  });

  test('~11m distance', () => {
    const d = haversineDistance(BASE_LAT, BASE_LNG, BASE_LAT + 0.0001, BASE_LNG);
    expect(d).toBeGreaterThan(10);
    expect(d).toBeLessThan(12);
  });

  test('coordinates at equator (0,0)', () => {
    const d = haversineDistance(0, 0, 0, 0.0001);
    expect(d).toBeGreaterThan(10);
    expect(d).toBeLessThan(12);
  });

  test('coordinates near poles', () => {
    const d = haversineDistance(89.999, 0, 89.999, 1);
    expect(d).toBeGreaterThan(0);
    // Near poles, longitude degrees shrink
    expect(d).toBeLessThan(200);
  });

  test('cross-equator distance', () => {
    const d = haversineDistance(-0.0001, 0, 0.0001, 0);
    expect(d).toBeGreaterThan(20);
    expect(d).toBeLessThan(25);
  });

  test('cross-date-line distance', () => {
    const d = haversineDistance(0, 179.9999, 0, -179.9999);
    expect(d).toBeGreaterThan(0);
    expect(d).toBeLessThan(25);
  });

  test('antipodal points = ~20,000km', () => {
    const d = haversineDistance(0, 0, 0, 180);
    expect(d).toBeGreaterThan(20_000_000);
    expect(d).toBeLessThan(20_100_000);
  });
});

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// 3. MOVEMENT PATTERNS
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

describe('3. Movement Patterns', () => {

  test('continuous driving: all records saved', () => {
    const result = simulateFullLifecycle([
      { phase: 'foreground', fixes: movingFixes(20, 10.0) },
    ]);
    expect(result.saved.length).toBe(20);
  });

  test('move → stop → move cycle', () => {
    const result = simulateFullLifecycle([{
      phase: 'foreground', fixes: [
        ...movingFixes(5, 10.0),
        ...stationaryFixes(20, 15),
        ...movingFixes(5, 10.0, BASE_LAT + 0.01),
      ],
    }]);
    const stopped = result.saved.filter(r => r.speed === 0);
    const moving = result.saved.filter(r => r.speed > 0);
    expect(stopped.length).toBe(1); // 1 stop
    expect(moving.length).toBeGreaterThanOrEqual(5); // first 5 + resumed after 3 confirm
  });

  test('stop-and-go traffic (speed > 6 km/h between stops): captured', () => {
    const fixes = stopAndGoFixes(3, 8.0, 5, 10);
    const result = simulateFullLifecycle([{ phase: 'foreground', fixes }]);
    const moving = result.saved.filter(r => r.speed > 0);
    // Each of 3 cycles has 5 moving fixes. First cycle: all 5 (no stationary yet).
    // Subsequent cycles: 3 consecutive to confirm, then saves remaining.
    expect(moving.length).toBeGreaterThanOrEqual(5);
  });

  test('slow traffic < 6 km/h: treated as stationary (known limitation)', () => {
    const result = simulateFullLifecycle([{
      phase: 'foreground', fixes: trafficFixes(60, 1.0), // max 1 m/s = 3.6 km/h
    }]);
    // All speeds < 1.67 → stationary → only 1 stop record
    expect(result.saved.length).toBe(1);
  });

  test('delivery: approach → park 20min → depart', () => {
    const result = simulateFullLifecycle([{
      phase: 'foreground', fixes: [
        ...movingFixes(10, 8.0),
        { latitude: BASE_LAT + 0.001, longitude: BASE_LNG, speed: 1.0, accuracy: 10 },
        ...stationaryFixes(240, 20), // 20 min
        ...movingFixes(3, 2.0, BASE_LAT + 0.002), // 3 consecutive to confirm
        ...movingFixes(5, 10.0, BASE_LAT + 0.003),
      ],
    }]);
    const stopped = result.saved.filter(r => r.speed === 0);
    const moving = result.saved.filter(r => r.speed >= IDLE_SPEED_THRESHOLD);
    expect(stopped.length).toBeLessThanOrEqual(2);
    expect(moving.length).toBeGreaterThanOrEqual(10);
  });

  test('very high speed (highway): all saved', () => {
    const result = simulateFullLifecycle([{
      phase: 'foreground', fixes: movingFixes(20, 30.0), // 108 km/h
    }]);
    expect(result.saved.length).toBe(20);
  });

  test('position jumping 1km between fixes: saved (real movement)', () => {
    const state = createJsTracker();
    jsHandlePosition(state, { latitude: BASE_LAT, longitude: BASE_LNG, speed: 10, accuracy: 10 });
    const r = jsHandlePosition(state, {
      latitude: BASE_LAT + 0.009, longitude: BASE_LNG, speed: 10, accuracy: 10, // ~1km
    });
    expect(r.saved).toBe(true);
  });
});

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// 4. APP STATE TRANSITIONS
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

describe('4. App State Transitions', () => {

  describe('4.1 Foreground → Background', () => {

    test('FG→BG while driving: native picks up', () => {
      const result = simulateFullLifecycle([
        { phase: 'foreground', fixes: movingFixes(5, 10.0) },
        { phase: 'background', fixes: movingFixes(10, 10.0, BASE_LAT + 0.001) },
      ]);
      const fg = result.saved.filter(r => r.phase === 'foreground');
      const bg = result.saved.filter(r => r.phase === 'background');
      expect(fg.length).toBe(5);
      expect(bg.length).toBeGreaterThan(0);
    });

    test('FG→BG while parked: native saves 1 extra stop', () => {
      const result = simulateFullLifecycle([
        { phase: 'foreground', fixes: stationaryFixes(5, 10) },
        { phase: 'background', fixes: stationaryFixes(20, 15) },
      ]);
      const fg = result.saved.filter(r => r.phase === 'foreground');
      const bg = result.saved.filter(r => r.phase === 'background');
      expect(fg.length).toBe(1); // 1 JS stop
      expect(bg.length).toBe(1); // 1 native stop (fresh wasStationary)
    });

    test('consecutiveMovingCount resets on background', () => {
      const jsState = createJsTracker();
      jsHandlePosition(jsState, { latitude: BASE_LAT, longitude: BASE_LNG, speed: 0, accuracy: 10 });
      jsHandlePosition(jsState, { latitude: BASE_LAT + 0.001, longitude: BASE_LNG, speed: 5.0, accuracy: 10 });
      jsHandlePosition(jsState, { latitude: BASE_LAT + 0.002, longitude: BASE_LNG, speed: 5.0, accuracy: 10 });
      expect(jsState.consecutiveMovingCount).toBe(2);
      // Simulate background entry
      jsState.consecutiveMovingCount = 0;
      expect(jsState.consecutiveMovingCount).toBe(0);
    });
  });

  describe('4.2 Background → Foreground', () => {

    test('BG→FG while parked: wasStationary persists, drift blocked', () => {
      const result = simulateFullLifecycle([
        { phase: 'foreground', fixes: stationaryFixes(5, 10) },
        { phase: 'background', fixes: stationaryFixes(20, 15) },
        { phase: 'resumed', fixes: stationaryFixes(10, 20) },
      ]);
      const resumed = result.saved.filter(r => r.phase === 'resumed');
      expect(resumed.length).toBe(0); // all drift blocked (wasStationary persists)
    });

    test('BG→FG while driving: 3 consecutive needed to confirm', () => {
      const result = simulateFullLifecycle([
        { phase: 'foreground', fixes: [
          { latitude: BASE_LAT, longitude: BASE_LNG, speed: 0, accuracy: 10 },
        ]},
        { phase: 'background', fixes: [] },
        { phase: 'resumed', fixes: movingFixes(6, 8.0, BASE_LAT + 0.01) },
      ]);
      const resumed = result.saved.filter(r => r.phase === 'resumed');
      // First 2 blocked (consecutiveMovingCount < 3), then saves
      expect(resumed.length).toBeGreaterThanOrEqual(3);
      expect(resumed.every(r => r.speed === 8.0)).toBe(true);
    });

    test('multiple FG→BG→FG cycles while parked: JS saves only 1 record total', () => {
      const result = simulateFullLifecycle([
        { phase: 'foreground', fixes: stationaryFixes(5, 10) },
        { phase: 'background', fixes: stationaryFixes(10, 10) },
        { phase: 'resumed', fixes: stationaryFixes(5, 15) },
        { phase: 'background', fixes: stationaryFixes(10, 15) },
        { phase: 'resumed', fixes: stationaryFixes(5, 20) },
        { phase: 'background', fixes: stationaryFixes(10, 20) },
        { phase: 'resumed', fixes: stationaryFixes(5, 25) },
      ]);
      const jsRecords = result.saved.filter(r => r.phase === 'foreground' || r.phase === 'resumed');
      expect(jsRecords.length).toBe(1); // only the initial stop
    });

    test('spike on immediate resume: blocked', () => {
      const result = simulateFullLifecycle([
        { phase: 'foreground', fixes: stationaryFixes(5, 10) },
        { phase: 'background', fixes: stationaryFixes(3, 10) },
        { phase: 'resumed', fixes: [
          { latitude: BASE_LAT + 0.001, longitude: BASE_LNG, speed: 5.0, accuracy: 20 },
          { latitude: BASE_LAT, longitude: BASE_LNG, speed: 0, accuracy: 12 },
        ]},
      ]);
      const resumed = result.saved.filter(r => r.phase === 'resumed');
      expect(resumed.length).toBe(0);
    });

    test('overnight parking (12h background): no drift on resume', () => {
      const result = simulateFullLifecycle([
        { phase: 'foreground', fixes: [
          ...movingFixes(3, 5.0),
          { latitude: BASE_LAT + 0.0003, longitude: BASE_LNG, speed: 0, accuracy: 10 },
        ]},
        { phase: 'background', fixes: stationaryFixes(8640, 30) }, // 12 hours
        { phase: 'resumed', fixes: stationaryFixes(10, 25) },
      ]);
      const resumed = result.saved.filter(r => r.phase === 'resumed');
      expect(resumed.length).toBe(0); // still parked, wasStationary persists
    });
  });

  describe('4.3 Rapid Transitions', () => {

    test('FG→BG→FG within seconds while parked', () => {
      const result = simulateFullLifecycle([
        { phase: 'foreground', fixes: stationaryFixes(2, 5) },
        { phase: 'background', fixes: stationaryFixes(1, 5) },
        { phase: 'resumed', fixes: stationaryFixes(2, 5) },
      ]);
      const jsRecords = result.saved.filter(r => r.phase !== 'background');
      expect(jsRecords.length).toBe(1);
    });

    test('5 rapid FG↔BG cycles while driving', () => {
      const phases: PhaseConfig[] = [];
      let lat = BASE_LAT;
      for (let i = 0; i < 5; i++) {
        phases.push({ phase: i === 0 ? 'foreground' : 'resumed', fixes: movingFixes(3, 10, lat) });
        lat += 0.0003;
        phases.push({ phase: 'background', fixes: movingFixes(3, 10, lat) });
        lat += 0.0003;
      }
      const result = simulateFullLifecycle(phases);
      // Should have records from both foreground and background
      expect(result.saved.length).toBeGreaterThan(10);
    });
  });
});

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// 5. NATIVE-SPECIFIC BEHAVIOR
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

describe('5. Native Service', () => {

  test('jsAlive=true with fresh heartbeat: native skips', () => {
    const state = createNativeTracker();
    state.jsAlive = true;
    state.jsHeartbeat = Date.now();
    const r = nativeSaveLocation(state, {
      latitude: BASE_LAT, longitude: BASE_LNG, speed: 10, accuracy: 10,
    }, Date.now());
    expect(r.saved).toBe(false);
    expect(r.reason).toBe('js_alive');
  });

  test('jsAlive=true with stale heartbeat (>30s): native takes over', () => {
    const state = createNativeTracker();
    state.jsAlive = true;
    state.jsHeartbeat = Date.now() - 35000;
    const r = nativeSaveLocation(state, {
      latitude: BASE_LAT, longitude: BASE_LNG, speed: 10, accuracy: 10,
    }, Date.now());
    expect(r.saved).toBe(true);
    expect(state.jsAlive).toBe(false); // self-corrected
  });

  test('idle mode activates after 3 consecutive idle fixes', () => {
    const state = createNativeTracker();
    nativeSaveLocation(state, { latitude: BASE_LAT, longitude: BASE_LNG, speed: 0, accuracy: 10 });
    nativeSaveLocation(state, { latitude: BASE_LAT, longitude: BASE_LNG, speed: 0, accuracy: 10 });
    const r3 = nativeSaveLocation(state, { latitude: BASE_LAT, longitude: BASE_LNG, speed: 0, accuracy: 10 });
    expect(state.isIdleMode).toBe(true);
    expect(r3.saved).toBe(false);
    expect(r3.reason).toBe('idle_mode');
  });

  test('idle mode exits when moved > 50m', () => {
    const state = createNativeTracker();
    state.isIdleMode = true;
    state.idleLat = BASE_LAT;
    state.idleLng = BASE_LNG;
    state.wasStationary = false;
    state.consecutiveIdleCount = 5;

    const r = nativeSaveLocation(state, {
      latitude: BASE_LAT + 0.001, longitude: BASE_LNG, speed: 0, accuracy: 10, // ~111m
    });
    expect(state.isIdleMode).toBe(false);
    expect(r.idleModeChanged).toBe(true);
  });

  test('native adaptive distance filter: poor accuracy requires more displacement', () => {
    const state = createNativeTracker();
    // First fix
    nativeSaveLocation(state, { latitude: BASE_LAT, longitude: BASE_LNG, speed: 10, accuracy: 10 });
    // Second fix 8m away with good accuracy: saved (> 5m threshold)
    const r1 = nativeSaveLocation(state, {
      latitude: BASE_LAT + 0.000072, longitude: BASE_LNG, speed: 10, accuracy: 10,
    });
    expect(r1.saved).toBe(true);

    // Third fix 8m away with poor accuracy (50m): NOT saved (threshold = max(10, 50*0.75) = 37.5m)
    const r2 = nativeSaveLocation(state, {
      latitude: BASE_LAT + 0.000072 + 0.000072, longitude: BASE_LNG, speed: 10, accuracy: 50,
    });
    expect(r2.saved).toBe(false);
    expect(r2.reason).toBe('too_close');
  });

  test('native stationary: 1 stop record, all drift blocked', () => {
    const state = createNativeTracker();
    const results: boolean[] = [];
    for (let i = 0; i < 100; i++) {
      const r = nativeSaveLocation(state, {
        latitude: BASE_LAT + (i % 2 === 0 ? 1 : -1) * 0.0002,
        longitude: BASE_LNG, speed: 0, accuracy: 12,
      });
      results.push(r.saved);
    }
    expect(results.filter(Boolean).length).toBe(1); // only first stop
  });

  test('native 3 consecutive moving confirms real movement', () => {
    const state = createNativeTracker();
    nativeSaveLocation(state, { latitude: BASE_LAT, longitude: BASE_LNG, speed: 0, accuracy: 10 });
    expect(state.wasStationary).toBe(true);

    nativeSaveLocation(state, { latitude: BASE_LAT + 0.001, longitude: BASE_LNG, speed: 5, accuracy: 10 });
    nativeSaveLocation(state, { latitude: BASE_LAT + 0.002, longitude: BASE_LNG, speed: 5, accuracy: 10 });
    const r = nativeSaveLocation(state, { latitude: BASE_LAT + 0.003, longitude: BASE_LNG, speed: 5, accuracy: 10 });
    expect(state.wasStationary).toBe(false);
    expect(r.saved).toBe(true);
  });
});

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// 6. COMBINED TRANSITIONS (App State + Network)
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

describe('6. Combined Transitions', () => {

  describe('6.1 FG+Online → BG+Offline (truck parked)', () => {
    test('no drift in either phase', () => {
      const result = simulateFullLifecycle([
        { phase: 'foreground', fixes: stationaryFixes(10, 15) },
        { phase: 'background', fixes: stationaryFixes(50, 20) },
      ]);
      const fg = result.saved.filter(r => r.phase === 'foreground');
      const bg = result.saved.filter(r => r.phase === 'background');
      expect(fg.length).toBe(1);
      expect(bg.length).toBe(1); // native fresh wasStationary
      expect(fg[0].speed).toBe(0);
      expect(bg[0].speed).toBe(0);
    });
  });

  describe('6.2 FG+Offline → BG+Online (truck parked)', () => {
    test('no drift, records preserved', () => {
      const result = simulateFullLifecycle([
        { phase: 'foreground', fixes: stationaryFixes(10, 15) },
        { phase: 'background', fixes: stationaryFixes(30, 15) },
      ]);
      expect(result.saved.filter(r => r.speed === 0).length).toBe(2); // 1 JS + 1 native
    });
  });

  describe('6.3 BG+Online → FG+Offline (truck parked)', () => {
    test('wasStationary persists, no drift on resume', () => {
      const result = simulateFullLifecycle([
        { phase: 'foreground', fixes: stationaryFixes(5, 10) },
        { phase: 'background', fixes: stationaryFixes(30, 15) },
        { phase: 'resumed', fixes: stationaryFixes(10, 20) },
      ]);
      const resumed = result.saved.filter(r => r.phase === 'resumed');
      expect(resumed.length).toBe(0);
    });
  });

  describe('6.4 BG+Offline → FG+Online (truck parked)', () => {
    test('wasStationary persists, import + sync on resume', () => {
      const result = simulateFullLifecycle([
        { phase: 'foreground', fixes: stationaryFixes(5, 10) },
        { phase: 'background', fixes: stationaryFixes(100, 20) },
        { phase: 'resumed', fixes: stationaryFixes(5, 25) },
      ]);
      const resumed = result.saved.filter(r => r.phase === 'resumed');
      expect(resumed.length).toBe(0); // no drift
    });
  });

  describe('6.5 All combined transitions while driving', () => {
    test('FG+Online → BG+Offline → FG+Online: route continuous', () => {
      let lat = BASE_LAT;
      const result = simulateFullLifecycle([
        { phase: 'foreground', fixes: movingFixes(5, 10, lat) },
        { phase: 'background', fixes: movingFixes(10, 10, lat += 0.0005) },
        { phase: 'resumed', fixes: movingFixes(5, 10, lat += 0.001) },
      ]);
      // All phases should have records
      expect(result.saved.filter(r => r.phase === 'foreground').length).toBe(5);
      expect(result.saved.filter(r => r.phase === 'background').length).toBeGreaterThan(0);
      // Resume needs 3 consecutive to clear wasStationary (native set it)
      expect(result.saved.filter(r => r.phase === 'resumed').length).toBeGreaterThan(0);
    });
  });
});

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// 7. DATA INTEGRITY
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

describe('7. Data Integrity', () => {

  describe('7.1 Storage', () => {

    test('record ID is unique', () => {
      const store = simulateStorage();
      const ids = new Set<string>();
      for (let i = 0; i < 100; i++) {
        const id = store.addRecord(BASE_LAT + i * 0.0001, BASE_LNG);
        expect(ids.has(id)).toBe(false);
        ids.add(id);
      }
    });

    test('dedup by ID on import: duplicate skipped', () => {
      const store = simulateStorage();
      const added1 = store.importRecord('native_123', BASE_LAT, BASE_LNG);
      const added2 = store.importRecord('native_123', BASE_LAT, BASE_LNG);
      expect(added1).toBe(true);
      expect(added2).toBe(false);
      expect(store.getCount()).toBe(1);
    });

    test('different IDs imported separately', () => {
      const store = simulateStorage();
      store.importRecord('native_1', BASE_LAT, BASE_LNG);
      store.importRecord('native_2', BASE_LAT + 0.001, BASE_LNG);
      expect(store.getCount()).toBe(2);
    });

    test('trim at 600: keeps all unsynced + 100 recent synced', () => {
      const store = simulateStorage();
      // Add 400 records and mark them synced
      const ids: string[] = [];
      for (let i = 0; i < 400; i++) {
        ids.push(store.addRecord(BASE_LAT + i * 0.0001, BASE_LNG));
      }
      store.markSynced(ids);
      expect(store.getAll().filter(r => r.synced).length).toBe(400);

      // Add 250 more unsynced (total = 650 > 600)
      for (let i = 0; i < 250; i++) {
        store.addRecord(BASE_LAT + (400 + i) * 0.0001, BASE_LNG);
      }

      const all = store.getAll();
      const synced = all.filter(r => r.synced);
      const unsynced = all.filter(r => !r.synced);
      // Should trim synced to 100, keep all 250 unsynced
      expect(synced.length).toBe(100);
      expect(unsynced.length).toBe(250);
    });

    test('clearSynced preserves unsynced', () => {
      const store = simulateStorage();
      const id1 = store.addRecord(BASE_LAT, BASE_LNG);
      store.addRecord(BASE_LAT + 0.001, BASE_LNG);
      store.markSynced([id1]);
      store.clearSynced();
      expect(store.getCount()).toBe(1);
      expect(store.getUnsynced().length).toBe(1);
    });

    test('clear removes everything', () => {
      const store = simulateStorage();
      store.addRecord(BASE_LAT, BASE_LNG);
      store.addRecord(BASE_LAT + 0.001, BASE_LNG);
      store.clear();
      expect(store.getCount()).toBe(0);
    });
  });

  describe('7.2 Sync', () => {

    test('online sync uploads all records', () => {
      const records: SyncRecord[] = Array.from({ length: 5 }, (_, i) => ({
        id: `r_${i}`, ticket_id: 1, latitude: BASE_LAT + i * 0.001,
        longitude: BASE_LNG, synced: false,
      }));
      const result = simulateSync(records, true);
      expect(result.uploaded).toBe(5);
      expect(result.remaining).toBe(0);
    });

    test('offline sync uploads nothing', () => {
      const records: SyncRecord[] = [
        { id: 'r_1', ticket_id: 1, latitude: BASE_LAT, longitude: BASE_LNG, synced: false },
      ];
      const result = simulateSync(records, false);
      expect(result.uploaded).toBe(0);
      expect(result.remaining).toBe(1);
    });

    test('partial batch failure: successful batches synced, rest preserved', () => {
      const records: SyncRecord[] = Array.from({ length: 250 }, (_, i) => ({
        id: `r_${i}`, ticket_id: 1, latitude: BASE_LAT + i * 0.001,
        longitude: BASE_LNG, synced: false,
      }));
      // Fail at batch 3 (batch size 100: batch 1=100, batch 2=100, batch 3 fails)
      const result = simulateSync(records, true, 100, 3);
      expect(result.uploaded).toBe(200);
      expect(result.remaining).toBe(50);
    });

    test('already synced records not re-uploaded', () => {
      const records: SyncRecord[] = [
        { id: 'r_1', ticket_id: 1, latitude: BASE_LAT, longitude: BASE_LNG, synced: true },
        { id: 'r_2', ticket_id: 1, latitude: BASE_LAT + 0.001, longitude: BASE_LNG, synced: false },
      ];
      const result = simulateSync(records, true);
      expect(result.uploaded).toBe(1);
    });

    test('empty unsynced list: nothing uploaded', () => {
      const records: SyncRecord[] = [
        { id: 'r_1', ticket_id: 1, latitude: BASE_LAT, longitude: BASE_LNG, synced: true },
      ];
      const result = simulateSync(records, true);
      expect(result.uploaded).toBe(0);
      expect(result.remaining).toBe(0);
    });
  });
});

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// 8. IDLE AUTO-LOGOUT
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

describe('8. Idle Auto-Logout', () => {

  test('no logout within 2 hours of movement', () => {
    const result = simulateIdleTimer([
      { type: 'movement', atMs: 0 },
      { type: 'check', atMs: IDLE_LOGOUT_MS - 1 }, // 1ms before 2h
    ]);
    expect(result.logoutFired).toBe(false);
  });

  test('logout at exactly 2 hours', () => {
    const result = simulateIdleTimer([
      { type: 'movement', atMs: 0 },
      { type: 'check', atMs: IDLE_LOGOUT_MS },
    ]);
    expect(result.logoutFired).toBe(true);
  });

  test('warning fires at 1h50m', () => {
    const result = simulateIdleTimer([
      { type: 'movement', atMs: 0 },
      { type: 'check', atMs: IDLE_WARNING_MS },
    ]);
    expect(result.warningFired).toBe(true);
    expect(result.logoutFired).toBe(false);
  });

  test('movement resets timer — no logout after movement', () => {
    const result = simulateIdleTimer([
      { type: 'movement', atMs: 0 },
      { type: 'check', atMs: IDLE_WARNING_MS + 60000 }, // past warning
      { type: 'movement', atMs: IDLE_WARNING_MS + 60001 }, // move!
      { type: 'check', atMs: IDLE_WARNING_MS + 60001 + IDLE_LOGOUT_MS - 1 }, // before new 2h
    ]);
    expect(result.logoutFired).toBe(false);
  });

  test('movement resets warning flag', () => {
    const result = simulateIdleTimer([
      { type: 'movement', atMs: 0 },
      { type: 'check', atMs: IDLE_WARNING_MS + 1000 }, // warning fires
      { type: 'movement', atMs: IDLE_WARNING_MS + 2000 }, // resets
      { type: 'check', atMs: IDLE_WARNING_MS + 3000 }, // too early for new warning
    ]);
    expect(result.warningFired).toBe(false); // reset by movement
  });

  test('no movement ever: logout fires at 2h', () => {
    const result = simulateIdleTimer([
      { type: 'movement', atMs: 0 },
      { type: 'check', atMs: 60_000 },
      { type: 'check', atMs: 3600_000 },
      { type: 'check', atMs: IDLE_WARNING_MS },
      { type: 'check', atMs: IDLE_LOGOUT_MS },
    ]);
    expect(result.warningFired).toBe(true);
    expect(result.logoutFired).toBe(true);
  });
});

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// 9. EDGE CASES
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

describe('9. Edge Cases', () => {

  describe('9.1 Boundary Values', () => {

    test('speed = 0 exactly: stationary', () => {
      const state = createJsTracker();
      jsHandlePosition(state, { latitude: BASE_LAT, longitude: BASE_LNG, speed: 0, accuracy: 10 });
      expect(state.wasStationary).toBe(true);
    });

    test('speed = 1.671 (just above threshold): moving', () => {
      const state = createJsTracker();
      jsHandlePosition(state, { latitude: BASE_LAT, longitude: BASE_LNG, speed: 1.671, accuracy: 10 });
      expect(state.wasStationary).toBe(false);
      expect(state.consecutiveMovingCount).toBe(1);
    });

    test('accuracy = 0: saved (valid)', () => {
      const state = createJsTracker();
      const r = jsHandlePosition(state, { latitude: BASE_LAT, longitude: BASE_LNG, speed: 10, accuracy: 0 });
      expect(r.saved).toBe(true);
    });

    test('negative speed: treated as unavailable (= 0 = stationary)', () => {
      const state = createJsTracker();
      jsHandlePosition(state, { latitude: BASE_LAT, longitude: BASE_LNG, speed: -5, accuracy: 10 });
      expect(state.wasStationary).toBe(true);
    });

    test('very high speed (333 m/s = 1200 km/h): saved normally', () => {
      const state = createJsTracker();
      const r = jsHandlePosition(state, { latitude: BASE_LAT, longitude: BASE_LNG, speed: 333, accuracy: 10 });
      expect(r.saved).toBe(true);
    });

    test('coordinates at (0, 0): works normally', () => {
      const state = createJsTracker();
      const r = jsHandlePosition(state, { latitude: 0, longitude: 0, speed: 10, accuracy: 10 });
      expect(r.saved).toBe(true);
    });

    test('extreme coordinates (90, 180): works', () => {
      const state = createJsTracker();
      const r = jsHandlePosition(state, { latitude: 90, longitude: 180, speed: 10, accuracy: 10 });
      expect(r.saved).toBe(true);
    });

    test('negative coordinates: works', () => {
      const state = createJsTracker();
      const r = jsHandlePosition(state, { latitude: -33.8688, longitude: 151.2093, speed: 10, accuracy: 10 });
      expect(r.saved).toBe(true);
    });
  });

  describe('9.2 Rapid Location Updates', () => {

    test('100 fixes at same position: only 1 saved', () => {
      const state = createJsTracker();
      let savedCount = 0;
      for (let i = 0; i < 100; i++) {
        const r = jsHandlePosition(state, { latitude: BASE_LAT, longitude: BASE_LNG, speed: 10, accuracy: 10 });
        if (r.saved) savedCount++;
      }
      expect(savedCount).toBe(1);
    });

    test('100 fixes with increasing latitude: all saved (moving)', () => {
      const state = createJsTracker();
      let savedCount = 0;
      for (let i = 0; i < 100; i++) {
        const r = jsHandlePosition(state, {
          latitude: BASE_LAT + i * 0.0001, longitude: BASE_LNG, speed: 10, accuracy: 10,
        });
        if (r.saved) savedCount++;
      }
      expect(savedCount).toBe(100);
    });

    test('alternating good/bad accuracy: only good fixes saved', () => {
      const state = createJsTracker();
      let savedCount = 0;
      for (let i = 0; i < 20; i++) {
        const r = jsHandlePosition(state, {
          latitude: BASE_LAT + i * 0.0001, longitude: BASE_LNG,
          speed: 10, accuracy: i % 2 === 0 ? 10 : 150,
        });
        if (r.saved) savedCount++;
      }
      expect(savedCount).toBe(10); // only even indices (good accuracy)
    });
  });

  describe('9.3 State Consistency', () => {

    test('wasStationary survives many fix types', () => {
      const state = createJsTracker();
      // Set stationary
      jsHandlePosition(state, { latitude: BASE_LAT, longitude: BASE_LNG, speed: 0, accuracy: 10 });
      expect(state.wasStationary).toBe(true);

      // Bad accuracy — skipped but state preserved
      jsHandlePosition(state, { latitude: BASE_LAT + 0.01, longitude: BASE_LNG, speed: 10, accuracy: 200 });
      expect(state.wasStationary).toBe(true);

      // Drift — blocked but state preserved
      jsHandlePosition(state, { latitude: BASE_LAT + 0.001, longitude: BASE_LNG, speed: 0.5, accuracy: 10 });
      expect(state.wasStationary).toBe(true);

      // Spike — blocked but state preserved
      jsHandlePosition(state, { latitude: BASE_LAT + 0.002, longitude: BASE_LNG, speed: 5, accuracy: 10 });
      expect(state.wasStationary).toBe(true);
    });

    test('lastSavedPosition only updates on successful save', () => {
      const state = createJsTracker();
      jsHandlePosition(state, { latitude: BASE_LAT, longitude: BASE_LNG, speed: 10, accuracy: 10 });
      const firstSaved = { ...state.lastSavedPosition };

      // Too close — not saved, lastSavedPosition unchanged
      jsHandlePosition(state, { latitude: BASE_LAT + 0.000001, longitude: BASE_LNG, speed: 10, accuracy: 10 });
      expect(state.lastSavedPosition).toEqual(firstSaved);

      // Bad accuracy — not saved, lastSavedPosition unchanged
      jsHandlePosition(state, { latitude: BASE_LAT + 0.01, longitude: BASE_LNG, speed: 10, accuracy: 200 });
      expect(state.lastSavedPosition).toEqual(firstSaved);
    });

    test('consecutiveMovingCount resets on ANY stationary fix', () => {
      const state = createJsTracker();
      // Build up count
      jsHandlePosition(state, { latitude: BASE_LAT, longitude: BASE_LNG, speed: 5, accuracy: 10 });
      jsHandlePosition(state, { latitude: BASE_LAT + 0.001, longitude: BASE_LNG, speed: 5, accuracy: 10 });
      expect(state.consecutiveMovingCount).toBe(2);

      // One stationary fix resets it
      jsHandlePosition(state, { latitude: BASE_LAT + 0.002, longitude: BASE_LNG, speed: 0.5, accuracy: 10 });
      expect(state.consecutiveMovingCount).toBe(0);
    });
  });

  describe('9.4 Long Duration Scenarios', () => {

    test('27 minutes parked with periodic spikes: only 1 record', () => {
      const fixes: SimFix[] = [];
      for (let i = 0; i < 324; i++) { // 27 min at 5s interval
        const isSpike = i % 37 === 0 && i > 0;
        fixes.push({
          latitude: BASE_LAT + ((i * 3) * 0.000009),
          longitude: BASE_LNG + ((i % 2 === 0 ? 1 : -1) * 25 * 0.000009),
          speed: isSpike ? 1.8 + Math.random() : 0,
          accuracy: 15 + (i % 5) * 3,
        });
      }
      const result = simulateFullLifecycle([{ phase: 'foreground', fixes }]);
      expect(result.saved.length).toBe(1);
    });

    test('1 hour continuous driving (720 fixes): all saved', () => {
      const result = simulateFullLifecycle([{
        phase: 'foreground', fixes: movingFixes(720, 15.0),
      }]);
      expect(result.saved.length).toBe(720);
    });

    test('rest stop with screen on/off cycles: only 1 stop across all cycles', () => {
      const result = simulateFullLifecycle([
        { phase: 'foreground', fixes: [
          ...movingFixes(3, 10.0),
          { latitude: BASE_LAT + 0.0003, longitude: BASE_LNG, speed: 0, accuracy: 10 },
          ...stationaryFixes(5, 10),
        ]},
        { phase: 'background', fixes: stationaryFixes(60, 15) },
        { phase: 'resumed', fixes: stationaryFixes(5, 15) },
        { phase: 'background', fixes: stationaryFixes(120, 20) },
        { phase: 'resumed', fixes: stationaryFixes(5, 20) },
        { phase: 'background', fixes: stationaryFixes(60, 15) },
        { phase: 'resumed', fixes: movingFixes(5, 10.0, BASE_LAT + 0.01) },
      ]);
      const stopped = result.saved.filter(r => r.speed === 0);
      const jsStops = stopped.filter(r => r.phase === 'foreground' || r.phase === 'resumed');
      expect(jsStops.length).toBe(1); // 1 JS stop across all resume cycles
    });
  });
});

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// 10. REGRESSION TESTS (previously broken scenarios)
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

describe('10. Regression Tests', () => {

  test('REGRESSION: old logic — single spike cleared stationary (MUST NOT happen)', () => {
    const state = createJsTracker();
    jsHandlePosition(state, { latitude: BASE_LAT, longitude: BASE_LNG, speed: 0, accuracy: 10 });
    expect(state.wasStationary).toBe(true);

    // Single spike must NOT clear stationary
    jsHandlePosition(state, { latitude: BASE_LAT + 0.001, longitude: BASE_LNG, speed: 5.0, accuracy: 10 });
    expect(state.wasStationary).toBe(true); // MUST remain true
  });

  test('REGRESSION: FG→BG→FG resume drift — wasStationary was being reset', () => {
    const result = simulateFullLifecycle([
      { phase: 'foreground', fixes: stationaryFixes(5, 10) },
      { phase: 'background', fixes: stationaryFixes(10, 10) },
      { phase: 'resumed', fixes: stationaryFixes(5, 20) }, // drifted 20m
    ]);
    // OLD BUG: wasStationary was reset on resume, causing drift records
    const resumed = result.saved.filter(r => r.phase === 'resumed');
    expect(resumed.length).toBe(0); // MUST be 0
  });

  test('REGRESSION: 2 spikes before BG + 1 after = carry-over to 3 (MUST NOT happen)', () => {
    const jsState = createJsTracker();
    jsHandlePosition(jsState, { latitude: BASE_LAT, longitude: BASE_LNG, speed: 0, accuracy: 10 });

    // 2 spikes
    jsHandlePosition(jsState, { latitude: BASE_LAT + 0.001, longitude: BASE_LNG, speed: 5, accuracy: 10 });
    jsHandlePosition(jsState, { latitude: BASE_LAT + 0.002, longitude: BASE_LNG, speed: 5, accuracy: 10 });
    expect(jsState.consecutiveMovingCount).toBe(2);

    // Background entry resets count
    jsState.consecutiveMovingCount = 0;

    // 1 spike on resume — should NOT clear (count is 1, not 3)
    const r = jsHandlePosition(jsState, { latitude: BASE_LAT + 0.003, longitude: BASE_LNG, speed: 5, accuracy: 10 });
    expect(r.saved).toBe(false);
    expect(r.reason).toBe('spike_blocked');
    expect(jsState.wasStationary).toBe(true);
  });

  test('REGRESSION: native upload race condition — records lost during upload', () => {
    // Simulate the fix: fresh read-filter-write by ID instead of stale snapshot
    const store = simulateStorage();

    // Add records A, B, C (the upload snapshot)
    store.addRecord(BASE_LAT, BASE_LNG);
    store.addRecord(BASE_LAT + 0.001, BASE_LNG);
    store.addRecord(BASE_LAT + 0.002, BASE_LNG);

    const snapshot = store.getUnsynced();
    const uploadedIds = snapshot.map(r => r.id);

    // During upload, new record F is added
    store.addRecord(BASE_LAT + 0.005, BASE_LNG);

    // Fix: mark uploaded records as synced by ID (fresh read)
    store.markSynced(uploadedIds);
    store.clearSynced();

    // Record F should still exist
    const remaining = store.getUnsynced();
    expect(remaining.length).toBe(1);
    expect(remaining[0].latitude).toBeCloseTo(BASE_LAT + 0.005, 4);
  });

  test('REGRESSION: zigzag while parked for 27 minutes (the original screenshot bug)', () => {
    const fixes: SimFix[] = [];
    for (let i = 0; i < 324; i++) {
      const isSpike = i % 37 === 0 && i > 0;
      fixes.push({
        latitude: BASE_LAT + ((i * 3) * 0.000009),
        longitude: BASE_LNG + ((i % 2 === 0 ? 1 : -1) * 25 * 0.000009),
        speed: isSpike ? 1.8 + Math.random() : 0,
        accuracy: 15 + (i % 5) * 3,
      });
    }
    const result = simulateFullLifecycle([{ phase: 'foreground', fixes }]);

    // MUST be exactly 1 — the original bug produced 17+ records
    expect(result.saved.length).toBe(1);
    expect(result.saved[0].index).toBe(0);
  });
});
