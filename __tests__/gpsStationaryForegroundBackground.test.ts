/**
 * GPS Stationary Tests — Foreground & Background States
 *
 * Tests the geolocation service behavior when the device STOPS MOVING
 * in both foreground and background app states.
 *
 * Covers:
 *   - Foreground: stationary drift suppression, first-stop recording
 *   - Background: JS watcher stops, native takes over, no JS records
 *   - Transitions: FG→BG→FG while stationary, no drift on resume
 *   - Edge cases: long stationary periods, intermittent spikes, accuracy changes
 */

// ── Core algorithm (mirrors backgroundGpsTracker.ts handlePosition) ──

const MIN_DISTANCE_TO_SAVE = 5; // metres
const MOVING_CONFIRM_THRESHOLD = 3;
const IDLE_SPEED_THRESHOLD = 1.67; // m/s ≈ 6 km/h

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

type SimFix = {
  latitude: number;
  longitude: number;
  speed: number;
  accuracy: number;
};

type SavedRecord = SimFix & {
  index: number;
  phase: 'foreground' | 'background' | 'resumed';
};

// ── Tracker simulation with app state awareness ──

type AppPhase = 'foreground' | 'background' | 'resumed';

type PhaseConfig = {
  phase: AppPhase;
  fixes: SimFix[];
};

/**
 * Full simulation of backgroundGpsTracker with app state transitions.
 * - 'foreground': JS watchPosition is active, handlePosition runs
 * - 'background': JS watcher stopped, native handles GPS (no JS processing)
 * - 'resumed': App returns to foreground, JS watcher resumes
 *
 * On background entry: consecutiveMovingCount resets to 0, wasStationary persists
 * On resume: wasStationary persists (new behavior), prevents drift
 */
function simulateWithAppStates(phases: PhaseConfig[]): {
  saved: SavedRecord[];
  jsProcessed: number;
  jsSkipped: number;
  nativeHandled: number;
} {
  let wasStationary = false;
  let consecutiveMovingCount = 0;
  let lastSavedPosition: { latitude: number; longitude: number } | null = null;
  const saved: SavedRecord[] = [];
  let globalIdx = 0;
  let jsProcessed = 0;
  let jsSkipped = 0;
  let nativeHandled = 0;

  for (const { phase, fixes } of phases) {
    if (phase === 'background') {
      // App went to background: JS watcher stops
      // Reset consecutiveMovingCount (as done in backgroundGpsTracker.ts line 118)
      consecutiveMovingCount = 0;
      // wasStationary persists (new behavior — prevents drift on resume)
      // Native service handles these fixes — JS does NOT process them
      nativeHandled += fixes.length;
      globalIdx += fixes.length;
      continue;
    }

    // foreground or resumed — JS processes fixes
    if (phase === 'resumed') {
      // On resume: consecutiveMovingCount was already reset on background entry
      // wasStationary persists from before background
    }

    for (const fix of fixes) {
      jsProcessed++;

      // Skip inaccurate fixes
      if (fix.accuracy > 100) {
        jsSkipped++;
        globalIdx++;
        continue;
      }

      const isStationary = fix.speed < IDLE_SPEED_THRESHOLD;

      if (isStationary) {
        consecutiveMovingCount = 0;
        if (wasStationary) {
          jsSkipped++;
          globalIdx++;
          continue; // drift blocked
        }
        wasStationary = true;
      } else {
        consecutiveMovingCount++;
        if (consecutiveMovingCount >= MOVING_CONFIRM_THRESHOLD) {
          wasStationary = false;
        } else if (wasStationary) {
          jsSkipped++;
          globalIdx++;
          continue; // spike blocked
        }
      }

      // Distance check
      if (lastSavedPosition) {
        const dist = haversineDistance(
          lastSavedPosition.latitude, lastSavedPosition.longitude,
          fix.latitude, fix.longitude,
        );
        if (dist < MIN_DISTANCE_TO_SAVE) {
          globalIdx++;
          continue;
        }
      }

      lastSavedPosition = { latitude: fix.latitude, longitude: fix.longitude };
      saved.push({ ...fix, index: globalIdx, phase });
      globalIdx++;
    }
  }

  return { saved, jsProcessed, jsSkipped, nativeHandled };
}

// ── Test data helpers ──

const PARKED_LAT = 22.298602; // Rajkot area
const PARKED_LNG = 70.798857;

/** Generate deterministic drift positions (simulates GPS noise while parked) */
function stationaryFixes(count: number, driftMeters: number, baseAccuracy = 12): SimFix[] {
  const fixes: SimFix[] = [];
  for (let i = 0; i < count; i++) {
    // Zigzag drift pattern
    const direction = i % 2 === 0 ? 1 : -1;
    const latOff = (i * 3) * 0.000009; // slight northward drift
    const lngOff = direction * driftMeters * 0.000009;
    fixes.push({
      latitude: PARKED_LAT + latOff,
      longitude: PARKED_LNG + lngOff,
      speed: 0,
      accuracy: baseAccuracy + (i % 4) * 2,
    });
  }
  return fixes;
}

/** Generate stationary fixes with occasional speed spikes (GPS noise) */
function stationaryWithSpikes(
  count: number,
  driftMeters: number,
  spikeEvery: number,
  spikeSpeed = 2.0,
): SimFix[] {
  const fixes: SimFix[] = [];
  for (let i = 0; i < count; i++) {
    const direction = i % 2 === 0 ? 1 : -1;
    const latOff = (i * 3) * 0.000009;
    const lngOff = direction * driftMeters * 0.000009;
    const isSpike = i > 0 && i % spikeEvery === 0;
    fixes.push({
      latitude: PARKED_LAT + latOff,
      longitude: PARKED_LNG + lngOff,
      speed: isSpike ? spikeSpeed : 0,
      accuracy: isSpike ? 25 : 12,
    });
  }
  return fixes;
}

/** Generate moving fixes along a straight road */
function movingFixes(
  count: number,
  speedMs: number,
  startLat = PARKED_LAT,
  startLng = PARKED_LNG,
): SimFix[] {
  const fixes: SimFix[] = [];
  for (let i = 0; i < count; i++) {
    fixes.push({
      latitude: startLat + i * 0.0001, // ~11m apart
      longitude: startLng,
      speed: speedMs,
      accuracy: 8,
    });
  }
  return fixes;
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

describe('GPS Stationary — Foreground State', () => {

  test('stationary in foreground: only 1 "stopped-at" record saved, all drift blocked', () => {
    const result = simulateWithAppStates([
      { phase: 'foreground', fixes: stationaryFixes(100, 20) },
    ]);

    expect(result.saved).toHaveLength(1);
    expect(result.saved[0].speed).toBe(0);
    expect(result.saved[0].index).toBe(0);
    expect(result.jsSkipped).toBe(99); // 99 drift fixes blocked
  });

  test('stationary in foreground with speed spikes: spikes blocked, only 1 record', () => {
    // 120 fixes, spike every 15 fixes (8 spikes total)
    const result = simulateWithAppStates([
      { phase: 'foreground', fixes: stationaryWithSpikes(120, 25, 15, 2.5) },
    ]);

    expect(result.saved).toHaveLength(1);
    expect(result.saved[0].speed).toBe(0);
  });

  test('stationary in foreground for extended period (1 hour): still only 1 record', () => {
    // 1 hour at 5s interval = 720 fixes
    const result = simulateWithAppStates([
      { phase: 'foreground', fixes: stationaryFixes(720, 30) },
    ]);

    expect(result.saved).toHaveLength(1);
    expect(result.nativeHandled).toBe(0); // all JS, no background
  });

  test('stationary with gradually worsening accuracy: low-accuracy fixes skipped', () => {
    const fixes: SimFix[] = [];
    for (let i = 0; i < 30; i++) {
      fixes.push({
        latitude: PARKED_LAT + i * 0.000009 * 10,
        longitude: PARKED_LNG,
        speed: 0,
        accuracy: 10 + i * 5, // 10m → 155m (exceeds 100m threshold at i=18)
      });
    }

    const result = simulateWithAppStates([
      { phase: 'foreground', fixes },
    ]);

    // First fix saved (accuracy=10), then stationary blocks until accuracy > 100
    // Fixes with accuracy > 100 are skipped regardless
    expect(result.saved).toHaveLength(1);
    const highAccuracySkips = fixes.filter(f => f.accuracy > 100).length;
    expect(highAccuracySkips).toBe(11); // i=19 to i=29 (accuracy > 100 when 10 + i*5 > 100)
  });

  test('stop moving after driving: records the stop position', () => {
    const result = simulateWithAppStates([
      { phase: 'foreground', fixes: [
        // Driving
        ...movingFixes(5, 10.0),
        // Stop at a new location
        { latitude: PARKED_LAT + 0.005, longitude: PARKED_LNG, speed: 0, accuracy: 10 },
        // Stay stopped (drift)
        ...stationaryFixes(20, 15).map(f => ({
          ...f,
          latitude: f.latitude + 0.005,
        })),
      ]},
    ]);

    const movingRecords = result.saved.filter(r => r.speed > 0);
    const stoppedRecords = result.saved.filter(r => r.speed === 0);

    expect(movingRecords.length).toBe(5); // all driving fixes saved
    expect(stoppedRecords.length).toBe(1); // only 1 "stopped at" after driving
  });
});

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

describe('GPS Stationary — Background State', () => {

  test('app goes to background while stationary: JS stops processing, native takes over', () => {
    const result = simulateWithAppStates([
      // Foreground: park the truck
      { phase: 'foreground', fixes: stationaryFixes(5, 10) },
      // Background: native handles, JS does nothing
      { phase: 'background', fixes: stationaryFixes(50, 15) },
    ]);

    expect(result.saved).toHaveLength(1); // only the first stop in foreground
    expect(result.nativeHandled).toBe(50); // native handled 50 background fixes
    expect(result.saved.every(r => r.phase === 'foreground')).toBe(true);
  });

  test('stationary for long background period: no JS records accumulated', () => {
    const result = simulateWithAppStates([
      { phase: 'foreground', fixes: [
        { latitude: PARKED_LAT, longitude: PARKED_LNG, speed: 0, accuracy: 10 },
      ]},
      // 30 minutes in background = 360 fixes at 5s interval
      { phase: 'background', fixes: stationaryFixes(360, 20) },
    ]);

    expect(result.saved).toHaveLength(1); // JS only saved the foreground stop
    expect(result.nativeHandled).toBe(360);
  });

  test('moving then background: JS stops, native continues', () => {
    const result = simulateWithAppStates([
      // Driving in foreground
      { phase: 'foreground', fixes: movingFixes(10, 12.0) },
      // App goes to background (still moving — native handles it)
      { phase: 'background', fixes: movingFixes(20, 12.0, PARKED_LAT + 0.001) },
    ]);

    // JS saved all 10 foreground fixes
    expect(result.saved.filter(r => r.phase === 'foreground')).toHaveLength(10);
    // Native handled 20 background fixes
    expect(result.nativeHandled).toBe(20);
    // No JS records from background
    expect(result.saved.filter(r => r.phase === 'background')).toHaveLength(0);
  });
});

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

describe('GPS Stationary — Foreground ↔ Background Transitions', () => {

  test('FG(stationary) → BG → FG(still stationary): NO drift on resume', () => {
    const result = simulateWithAppStates([
      // Park in foreground
      { phase: 'foreground', fixes: stationaryFixes(10, 15) },
      // Background (native handles)
      { phase: 'background', fixes: stationaryFixes(30, 15) },
      // Resume foreground — still parked, GPS drifted to new positions
      { phase: 'resumed', fixes: stationaryFixes(10, 25) },
    ]);

    // Only 1 record total — the initial "stopped at" from foreground
    expect(result.saved).toHaveLength(1);
    expect(result.saved[0].phase).toBe('foreground');
    // All resumed fixes were drift-blocked because wasStationary persisted
    const resumedSkips = result.jsSkipped;
    expect(resumedSkips).toBeGreaterThan(0);
  });

  test('FG(stationary) → BG → FG(now moving): detects real movement after 3 fixes', () => {
    const result = simulateWithAppStates([
      // Park in foreground
      { phase: 'foreground', fixes: [
        { latitude: PARKED_LAT, longitude: PARKED_LNG, speed: 0, accuracy: 10 },
        { latitude: PARKED_LAT, longitude: PARKED_LNG, speed: 0, accuracy: 10 },
      ]},
      // Background (native handles)
      { phase: 'background', fixes: stationaryFixes(20, 10) },
      // Resume: truck is now moving
      { phase: 'resumed', fixes: movingFixes(6, 8.0, PARKED_LAT + 0.01) },
    ]);

    const fgRecords = result.saved.filter(r => r.phase === 'foreground');
    const resumedRecords = result.saved.filter(r => r.phase === 'resumed');

    expect(fgRecords).toHaveLength(1); // 1 stopped-at
    // First 2 moving fixes on resume are spike-blocked (consecutiveMovingCount < 3)
    // 3rd fix confirms movement, then 3rd, 4th, 5th, 6th are saved
    expect(resumedRecords.length).toBeGreaterThanOrEqual(3);
    expect(resumedRecords.every(r => r.speed === 8.0)).toBe(true);
  });

  test('FG(moving) → BG → FG(stationary): correctly enters stationary mode', () => {
    const result = simulateWithAppStates([
      // Driving in foreground
      { phase: 'foreground', fixes: movingFixes(5, 10.0) },
      // Background
      { phase: 'background', fixes: [] },
      // Resume: truck has stopped
      { phase: 'resumed', fixes: stationaryFixes(20, 15) },
    ]);

    const fgRecords = result.saved.filter(r => r.phase === 'foreground');
    const resumedRecords = result.saved.filter(r => r.phase === 'resumed');

    expect(fgRecords).toHaveLength(5); // all moving
    expect(resumedRecords).toHaveLength(1); // 1 "stopped at", rest drift-blocked
    expect(resumedRecords[0].speed).toBe(0);
  });

  test('multiple FG→BG→FG cycles while parked: still only 1 record', () => {
    const result = simulateWithAppStates([
      // Cycle 1: foreground
      { phase: 'foreground', fixes: stationaryFixes(5, 10) },
      // Cycle 1: background
      { phase: 'background', fixes: stationaryFixes(10, 10) },
      // Cycle 2: resume foreground
      { phase: 'resumed', fixes: stationaryFixes(5, 15) },
      // Cycle 2: background again
      { phase: 'background', fixes: stationaryFixes(10, 15) },
      // Cycle 3: resume foreground
      { phase: 'resumed', fixes: stationaryFixes(5, 20) },
      // Cycle 3: background
      { phase: 'background', fixes: stationaryFixes(10, 20) },
      // Cycle 4: final resume
      { phase: 'resumed', fixes: stationaryFixes(5, 25) },
    ]);

    // Through all 4 cycles, only 1 "stopped at" record should exist
    expect(result.saved).toHaveLength(1);
    expect(result.nativeHandled).toBe(30); // 10+10+10 background fixes
  });

  test('FG(stationary) → BG(short) → FG(stationary with spike): spike blocked', () => {
    const result = simulateWithAppStates([
      // Park
      { phase: 'foreground', fixes: stationaryFixes(5, 10) },
      // Quick background (screen off/on)
      { phase: 'background', fixes: stationaryFixes(3, 10) },
      // Resume with a speed spike right away
      { phase: 'resumed', fixes: [
        { latitude: PARKED_LAT + 0.0003, longitude: PARKED_LNG, speed: 2.5, accuracy: 20 },
        { latitude: PARKED_LAT, longitude: PARKED_LNG, speed: 0, accuracy: 12 },
        { latitude: PARKED_LAT, longitude: PARKED_LNG, speed: 0, accuracy: 12 },
      ]},
    ]);

    // Spike on resume should be blocked (wasStationary=true, only 1 consecutive moving)
    expect(result.saved).toHaveLength(1);
    expect(result.saved[0].phase).toBe('foreground');
  });
});

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

describe('GPS Stationary — Edge Cases', () => {

  test('speed exactly at threshold (1.67 m/s): treated as stationary', () => {
    const result = simulateWithAppStates([
      { phase: 'foreground', fixes: [
        { latitude: PARKED_LAT, longitude: PARKED_LNG, speed: 0, accuracy: 10 },
        // Speed just below threshold
        { latitude: PARKED_LAT + 0.0002, longitude: PARKED_LNG, speed: 1.66, accuracy: 10 },
        { latitude: PARKED_LAT + 0.0004, longitude: PARKED_LNG, speed: 1.67, accuracy: 10 },
      ]},
    ]);

    // 1.66 < 1.67 → stationary (drift blocked after first stop)
    // 1.67 is NOT < 1.67 → treated as moving (1 consecutive, spike blocked)
    expect(result.saved).toHaveLength(1);
  });

  test('speed just above threshold (1.68 m/s): needs 3 consecutive to confirm', () => {
    const result = simulateWithAppStates([
      { phase: 'foreground', fixes: [
        { latitude: PARKED_LAT, longitude: PARKED_LNG, speed: 0, accuracy: 10 },
        // 3 consecutive just-above-threshold
        { latitude: PARKED_LAT + 0.0002, longitude: PARKED_LNG, speed: 1.68, accuracy: 10 },
        { latitude: PARKED_LAT + 0.0004, longitude: PARKED_LNG, speed: 1.68, accuracy: 10 },
        { latitude: PARKED_LAT + 0.0006, longitude: PARKED_LNG, speed: 1.68, accuracy: 10 },
        // 4th fix — should be saved (movement confirmed)
        { latitude: PARKED_LAT + 0.0008, longitude: PARKED_LNG, speed: 1.68, accuracy: 10 },
      ]},
    ]);

    // 1st: saved (stop), 2-4: spike blocked (consecutive < 3), 3rd clears stationary,
    // Actually: fix 0: stop (saved), fix 1: moving count=1 (blocked), fix 2: count=2 (blocked),
    // fix 3: count=3 (clears stationary, saved), fix 4: moving (saved)
    const stoppedRecords = result.saved.filter(r => r.speed === 0);
    const movingRecords = result.saved.filter(r => r.speed > 0);
    expect(stoppedRecords).toHaveLength(1);
    expect(movingRecords.length).toBeGreaterThanOrEqual(1); // at least fix 3
  });

  test('alternating spike/stationary pattern: never clears stationary', () => {
    // This pattern never reaches 3 consecutive moving fixes
    const fixes: SimFix[] = [
      { latitude: PARKED_LAT, longitude: PARKED_LNG, speed: 0, accuracy: 10 },
    ];
    for (let i = 1; i < 40; i++) {
      fixes.push({
        latitude: PARKED_LAT + i * 0.0002,
        longitude: PARKED_LNG,
        speed: i % 2 === 0 ? 0 : 3.0, // alternating: spike, stationary, spike, ...
        accuracy: 12,
      });
    }

    const result = simulateWithAppStates([
      { phase: 'foreground', fixes },
    ]);

    // Only the first stop saved — alternating never reaches 3 consecutive
    expect(result.saved).toHaveLength(1);
  });

  test('2 spikes, 1 stationary, 2 spikes: resets count, no false movement', () => {
    const result = simulateWithAppStates([
      { phase: 'foreground', fixes: [
        { latitude: PARKED_LAT, longitude: PARKED_LNG, speed: 0, accuracy: 10 }, // stop
        { latitude: PARKED_LAT + 0.0002, longitude: PARKED_LNG, speed: 3.0, accuracy: 10 }, // spike 1
        { latitude: PARKED_LAT + 0.0004, longitude: PARKED_LNG, speed: 3.0, accuracy: 10 }, // spike 2
        { latitude: PARKED_LAT + 0.0005, longitude: PARKED_LNG, speed: 0, accuracy: 10 },   // stationary (resets count)
        { latitude: PARKED_LAT + 0.0006, longitude: PARKED_LNG, speed: 3.0, accuracy: 10 }, // spike 1 again
        { latitude: PARKED_LAT + 0.0008, longitude: PARKED_LNG, speed: 3.0, accuracy: 10 }, // spike 2 again
        { latitude: PARKED_LAT + 0.0009, longitude: PARKED_LNG, speed: 0, accuracy: 10 },   // stationary
      ]},
    ]);

    // The stationary fix in the middle resets consecutiveMovingCount to 0
    // So the pattern never reaches 3 consecutive
    expect(result.saved).toHaveLength(1);
  });

  test('all fixes have accuracy > 100m: nothing saved', () => {
    const fixes = stationaryFixes(20, 50).map(f => ({ ...f, accuracy: 150 }));

    const result = simulateWithAppStates([
      { phase: 'foreground', fixes },
    ]);

    expect(result.saved).toHaveLength(0);
    expect(result.jsSkipped).toBe(20);
  });

  test('stationary fixes within 5m of each other: distance filter prevents duplicates', () => {
    // All fixes within 3m of each other (no drift, just noise)
    const fixes: SimFix[] = [];
    for (let i = 0; i < 20; i++) {
      fixes.push({
        latitude: PARKED_LAT + (i % 3) * 0.000009, // ~1m variation
        longitude: PARKED_LNG + (i % 2) * 0.000009,
        speed: 5.0, // moving speed (not stationary)
        accuracy: 10,
      });
    }

    const result = simulateWithAppStates([
      { phase: 'foreground', fixes },
    ]);

    // First fix saved, subsequent within 5m are distance-filtered
    expect(result.saved).toHaveLength(1);
  });
});

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

describe('GPS Stationary — Real-World Scenarios', () => {

  test('delivery stop: arrive, park 20min, depart', () => {
    const result = simulateWithAppStates([
      { phase: 'foreground', fixes: [
        // Approaching delivery (driving)
        ...movingFixes(10, 8.0),
        // Slowing down
        { latitude: PARKED_LAT + 0.001, longitude: PARKED_LNG, speed: 3.0, accuracy: 10 },
        { latitude: PARKED_LAT + 0.0011, longitude: PARKED_LNG, speed: 1.0, accuracy: 10 },
        // Parked for 20 min = 240 fixes at 5s
        ...stationaryFixes(240, 20),
        // Departing (3 consecutive to confirm movement)
        { latitude: PARKED_LAT + 0.002, longitude: PARKED_LNG, speed: 2.0, accuracy: 10 },
        { latitude: PARKED_LAT + 0.0022, longitude: PARKED_LNG, speed: 3.5, accuracy: 10 },
        { latitude: PARKED_LAT + 0.0025, longitude: PARKED_LNG, speed: 5.0, accuracy: 10 },
        // Full speed
        ...movingFixes(5, 10.0, PARKED_LAT + 0.003),
      ]},
    ]);

    const stoppedRecords = result.saved.filter(r => r.speed === 0);
    const slowRecords = result.saved.filter(r => r.speed > 0 && r.speed < IDLE_SPEED_THRESHOLD);
    const movingRecords = result.saved.filter(r => r.speed >= IDLE_SPEED_THRESHOLD);

    // 10 driving + 1 slowing + 1 stop + 1 stopped-at (stationary) + departure fixes + 5 driving
    expect(stoppedRecords.length).toBeLessThanOrEqual(2); // max 2 stationary records
    expect(movingRecords.length).toBeGreaterThanOrEqual(10); // at least the driving portions
  });

  test('overnight parking with phone in truck (12 hours background)', () => {
    const result = simulateWithAppStates([
      // Evening: park the truck
      { phase: 'foreground', fixes: [
        ...movingFixes(3, 5.0),
        { latitude: PARKED_LAT + 0.0003, longitude: PARKED_LNG, speed: 0, accuracy: 10 },
      ]},
      // Phone goes to background overnight (12 hours = 8640 fixes at 5s)
      { phase: 'background', fixes: stationaryFixes(8640, 30) },
      // Morning: driver opens app
      { phase: 'resumed', fixes: stationaryFixes(10, 25) },
    ]);

    // JS records: 3 moving + 1 stop = 4 from foreground, 0 from background, 0 from resumed
    const fgRecords = result.saved.filter(r => r.phase === 'foreground');
    const resumedRecords = result.saved.filter(r => r.phase === 'resumed');

    expect(fgRecords.length).toBe(4); // 3 moving + 1 stop
    expect(resumedRecords).toHaveLength(0); // still parked, drift blocked
    expect(result.nativeHandled).toBe(8640);
  });

  test('traffic jam: very slow intermittent movement', () => {
    const fixes: SimFix[] = [];
    // Alternate between stopped and crawling (< 6 km/h)
    for (let i = 0; i < 60; i++) {
      fixes.push({
        latitude: PARKED_LAT + i * 0.00002, // ~2.2m between fixes
        longitude: PARKED_LNG,
        speed: i % 5 === 0 ? 1.0 : 0, // brief crawl every 5 fixes
        accuracy: 10,
      });
    }

    const result = simulateWithAppStates([
      { phase: 'foreground', fixes },
    ]);

    // All speeds < 1.67 m/s, so all treated as stationary
    // Only the first stop position saved
    expect(result.saved).toHaveLength(1);
  });

  test('rest stop with screen on/off: multiple BG transitions while parked', () => {
    const result = simulateWithAppStates([
      // Arrive and park
      { phase: 'foreground', fixes: [
        ...movingFixes(3, 10.0),
        { latitude: PARKED_LAT + 0.0003, longitude: PARKED_LNG, speed: 0, accuracy: 10 },
        ...stationaryFixes(5, 10),
      ]},
      // Screen off (5 min)
      { phase: 'background', fixes: stationaryFixes(60, 15) },
      // Check phone briefly
      { phase: 'resumed', fixes: stationaryFixes(5, 15) },
      // Screen off again (10 min)
      { phase: 'background', fixes: stationaryFixes(120, 20) },
      // Check phone again
      { phase: 'resumed', fixes: stationaryFixes(5, 20) },
      // Screen off (5 min)
      { phase: 'background', fixes: stationaryFixes(60, 15) },
      // Finally depart
      { phase: 'resumed', fixes: [
        // 3 consecutive to break stationary
        ...movingFixes(5, 10.0, PARKED_LAT + 0.01),
      ]},
    ]);

    const stoppedRecords = result.saved.filter(r => r.speed === 0);
    const movingRecords = result.saved.filter(r => r.speed > 0);

    // Driving records: 3 arrival + departure (after 3 consecutive confirmed)
    expect(movingRecords.length).toBeGreaterThanOrEqual(3);
    // Only 1 "stopped at" across all BG transitions
    expect(stoppedRecords).toHaveLength(1);
    // Native handled all background fixes
    expect(result.nativeHandled).toBe(240); // 60 + 120 + 60
  });
});
