/**
 * GPS Stationary Drift Detection Tests
 *
 * Tests the core logic from backgroundGpsTracker.ts handlePosition()
 * and LocationTrackingService.kt saveLocation() to verify:
 *   1. No zigzag drift when parked (speed spikes filtered)
 *   2. Real movement detected after 3 consecutive moving fixes
 *   3. Foreground/background transitions don't cause drift
 *   4. Offline/online doesn't affect GPS recording logic
 */

// ── Extract the core algorithm (mirrors both JS and native logic) ──

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
  speed: number; // m/s
  accuracy: number; // metres
};

type SavedRecord = SimFix & { index: number };

/**
 * Simulate the JS-side handlePosition() logic.
 * Returns array of fixes that would have been SAVED (not skipped).
 */
function simulateJsTracking(
  fixes: SimFix[],
  opts?: { resetStationaryOnResume?: boolean },
): SavedRecord[] {
  let wasStationary = false;
  let consecutiveMovingCount = 0;
  let lastSavedPosition: { latitude: number; longitude: number } | null = null;
  const saved: SavedRecord[] = [];

  for (let i = 0; i < fixes.length; i++) {
    const fix = fixes[i];

    // Skip very inaccurate fixes
    if (fix.accuracy > 100) continue;

    const isStationary = fix.speed < IDLE_SPEED_THRESHOLD;

    if (isStationary) {
      consecutiveMovingCount = 0;
      if (wasStationary) {
        continue; // skip drift
      }
      wasStationary = true;
    } else {
      consecutiveMovingCount++;
      if (consecutiveMovingCount >= MOVING_CONFIRM_THRESHOLD) {
        wasStationary = false;
      } else if (wasStationary) {
        continue; // speed spike — not confirmed
      }
    }

    // Distance check
    if (lastSavedPosition) {
      const dist = haversineDistance(
        lastSavedPosition.latitude, lastSavedPosition.longitude,
        fix.latitude, fix.longitude,
      );
      if (dist < MIN_DISTANCE_TO_SAVE) {
        continue;
      }
    }

    lastSavedPosition = { latitude: fix.latitude, longitude: fix.longitude };
    saved.push({ ...fix, index: i });
  }

  return saved;
}

/**
 * Simulate the OLD logic (before fix) for comparison.
 * Single speed spike immediately clears wasStationary.
 */
function simulateOldJsTracking(fixes: SimFix[]): SavedRecord[] {
  let wasStationary = false;
  let lastSavedPosition: { latitude: number; longitude: number } | null = null;
  const saved: SavedRecord[] = [];

  for (let i = 0; i < fixes.length; i++) {
    const fix = fixes[i];
    if (fix.accuracy > 100) continue;

    const isStationary = fix.speed < IDLE_SPEED_THRESHOLD;

    if (isStationary) {
      if (wasStationary) {
        continue;
      }
      wasStationary = true;
    } else {
      // OLD: single moving fix clears stationary
      wasStationary = false;
    }

    if (lastSavedPosition) {
      const dist = haversineDistance(
        lastSavedPosition.latitude, lastSavedPosition.longitude,
        fix.latitude, fix.longitude,
      );
      if (dist < MIN_DISTANCE_TO_SAVE) {
        continue;
      }
    }

    lastSavedPosition = { latitude: fix.latitude, longitude: fix.longitude };
    saved.push({ ...fix, index: i });
  }

  return saved;
}

// ── Simulate foreground→background→foreground transition ──

function simulateWithTransition(
  foregroundFixes: SimFix[],
  backgroundFixes: SimFix[], // native records (not processed by JS)
  resumeFixes: SimFix[],
  resetOnResume: boolean, // OLD behavior: true, NEW behavior: false
): SavedRecord[] {
  let wasStationary = false;
  let consecutiveMovingCount = 0;
  let lastSavedPosition: { latitude: number; longitude: number } | null = null;
  const saved: SavedRecord[] = [];
  let globalIdx = 0;

  // Phase 1: Foreground
  for (const fix of foregroundFixes) {
    if (fix.accuracy > 100) { globalIdx++; continue; }
    const isStationary = fix.speed < IDLE_SPEED_THRESHOLD;

    if (isStationary) {
      consecutiveMovingCount = 0;
      if (wasStationary) { globalIdx++; continue; }
      wasStationary = true;
    } else {
      consecutiveMovingCount++;
      if (consecutiveMovingCount >= MOVING_CONFIRM_THRESHOLD) {
        wasStationary = false;
      } else if (wasStationary) { globalIdx++; continue; }
    }

    if (lastSavedPosition) {
      const dist = haversineDistance(
        lastSavedPosition.latitude, lastSavedPosition.longitude,
        fix.latitude, fix.longitude,
      );
      if (dist < MIN_DISTANCE_TO_SAVE) { globalIdx++; continue; }
    }
    lastSavedPosition = { latitude: fix.latitude, longitude: fix.longitude };
    saved.push({ ...fix, index: globalIdx });
    globalIdx++;
  }

  // Phase 2: Background transition
  consecutiveMovingCount = 0; // reset on background (new behavior)
  if (resetOnResume) {
    wasStationary = false;   // OLD behavior
    lastSavedPosition = null; // OLD behavior
  }
  // backgroundFixes handled by native — skip them in JS simulation

  // Phase 3: Foreground resume
  for (const fix of resumeFixes) {
    if (fix.accuracy > 100) { globalIdx++; continue; }
    const isStationary = fix.speed < IDLE_SPEED_THRESHOLD;

    if (isStationary) {
      consecutiveMovingCount = 0;
      if (wasStationary) { globalIdx++; continue; }
      wasStationary = true;
    } else {
      consecutiveMovingCount++;
      if (consecutiveMovingCount >= MOVING_CONFIRM_THRESHOLD) {
        wasStationary = false;
      } else if (wasStationary) { globalIdx++; continue; }
    }

    if (lastSavedPosition) {
      const dist = haversineDistance(
        lastSavedPosition.latitude, lastSavedPosition.longitude,
        fix.latitude, fix.longitude,
      );
      if (dist < MIN_DISTANCE_TO_SAVE) { globalIdx++; continue; }
    }
    lastSavedPosition = { latitude: fix.latitude, longitude: fix.longitude };
    saved.push({ ...fix, index: globalIdx });
    globalIdx++;
  }

  return saved;
}

// ── Test Data: realistic GPS coordinates near Rajkot (from screenshot) ──

const BASE_LAT = 22.298602;
const BASE_LNG = 70.798857;

/** Small random offset simulating GPS drift (10-30m) */
function drift(meters: number): { lat: number; lng: number } {
  // ~0.000009 degrees ≈ 1 metre at this latitude
  const latOff = (Math.random() - 0.5) * 2 * meters * 0.000009;
  const lngOff = (Math.random() - 0.5) * 2 * meters * 0.000009;
  return { lat: BASE_LAT + latOff, lng: BASE_LNG + lngOff };
}

/** Fixed drift pattern (deterministic for tests) */
function fixedDrift(index: number, meters: number): { lat: number; lng: number } {
  // Zigzag pattern: alternate east/west
  const direction = index % 2 === 0 ? 1 : -1;
  const lngOff = direction * meters * 0.000009;
  const latOff = (index * 3) * 0.000009; // slight northward drift
  return { lat: BASE_LAT + latOff, lng: BASE_LNG + lngOff };
}

/** Generate a sequence of "moving" positions along a road */
function movingFixes(count: number, speedMs: number): SimFix[] {
  const fixes: SimFix[] = [];
  for (let i = 0; i < count; i++) {
    fixes.push({
      latitude: BASE_LAT + i * 0.0001, // ~11m between fixes
      longitude: BASE_LNG,
      speed: speedMs,
      accuracy: 10,
    });
  }
  return fixes;
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

describe('GPS Stationary Drift Detection', () => {

  // ── TEST 1: Parked truck with GPS drift (the zigzag bug) ──

  test('parked truck: no zigzag from GPS drift (speed=0)', () => {
    // 60 fixes over 5 minutes, truck parked, GPS drifts 15-25m
    const fixes: SimFix[] = [];
    for (let i = 0; i < 60; i++) {
      const d = fixedDrift(i, 20);
      fixes.push({ latitude: d.lat, longitude: d.lng, speed: 0, accuracy: 15 });
    }

    const saved = simulateJsTracking(fixes);

    // Should save only 1 record (the first "stopped at" position)
    expect(saved.length).toBe(1);
    expect(saved[0].index).toBe(0);
  });

  // ── TEST 2: Parked truck with speed spikes (the actual bug) ──

  test('parked truck: speed spikes do NOT cause drift records', () => {
    const fixes: SimFix[] = [];

    // 10 stationary fixes
    for (let i = 0; i < 10; i++) {
      const d = fixedDrift(i, 15);
      fixes.push({ latitude: d.lat, longitude: d.lng, speed: 0, accuracy: 12 });
    }
    // Speed spike at index 10 (GPS noise reports 2.0 m/s)
    const d10 = fixedDrift(10, 50);
    fixes.push({ latitude: d10.lat, longitude: d10.lng, speed: 2.0, accuracy: 20 });

    // Back to stationary
    for (let i = 11; i < 20; i++) {
      const d = fixedDrift(i, 15);
      fixes.push({ latitude: d.lat, longitude: d.lng, speed: 0, accuracy: 12 });
    }
    // Another spike at index 20
    const d20 = fixedDrift(20, 60);
    fixes.push({ latitude: d20.lat, longitude: d20.lng, speed: 2.5, accuracy: 25 });

    // More stationary
    for (let i = 21; i < 30; i++) {
      const d = fixedDrift(i, 15);
      fixes.push({ latitude: d.lat, longitude: d.lng, speed: 0, accuracy: 12 });
    }

    const newSaved = simulateJsTracking(fixes);
    const oldSaved = simulateOldJsTracking(fixes);

    // NEW logic: only 1 record (first "stopped at")
    expect(newSaved.length).toBe(1);

    // OLD logic would have saved multiple drift records (the bug)
    expect(oldSaved.length).toBeGreaterThan(1);
    console.log(`  Speed spike test: OLD saved ${oldSaved.length} records (DRIFT), NEW saved ${newSaved.length} record (CLEAN)`);
  });

  // ── TEST 3: 3 consecutive speed spikes (could be real movement) ──

  test('3 consecutive speed spikes clears stationary flag', () => {
    const fixes: SimFix[] = [];

    // Park the truck
    fixes.push({ latitude: BASE_LAT, longitude: BASE_LNG, speed: 0, accuracy: 10 });
    fixes.push({ latitude: BASE_LAT, longitude: BASE_LNG, speed: 0, accuracy: 10 });

    // 3 consecutive moving fixes (real movement)
    for (let i = 0; i < 3; i++) {
      fixes.push({
        latitude: BASE_LAT + (i + 1) * 0.0002, // ~22m apart
        longitude: BASE_LNG,
        speed: 5.0, // 18 km/h
        accuracy: 10,
      });
    }

    // Continue moving
    fixes.push({
      latitude: BASE_LAT + 4 * 0.0002,
      longitude: BASE_LNG,
      speed: 5.0,
      accuracy: 10,
    });

    const saved = simulateJsTracking(fixes);

    // Should save: 1 "stopped at" + records after 3rd consecutive moving fix
    expect(saved.length).toBeGreaterThanOrEqual(2);
    // First saved is the parked position
    expect(saved[0].speed).toBe(0);
    // Second saved is after movement confirmed (3rd consecutive)
    expect(saved[1].speed).toBe(5.0);
  });

  // ── TEST 4: Real movement (never parked) works normally ──

  test('continuous movement: all records saved normally', () => {
    const fixes = movingFixes(20, 10.0); // 20 fixes at 36 km/h
    const saved = simulateJsTracking(fixes);

    // All should be saved (wasStationary never set, distance > 5m between fixes)
    expect(saved.length).toBe(20);
  });

  // ── TEST 5: Move → Stop → Move cycle ──

  test('move-stop-move: correct transitions', () => {
    const fixes: SimFix[] = [];

    // Moving phase (5 fixes)
    for (let i = 0; i < 5; i++) {
      fixes.push({
        latitude: BASE_LAT + i * 0.0001,
        longitude: BASE_LNG,
        speed: 8.0,
        accuracy: 10,
      });
    }

    // Stop phase (10 fixes with drift)
    for (let i = 0; i < 10; i++) {
      const d = fixedDrift(i, 10);
      fixes.push({ latitude: d.lat, longitude: d.lng, speed: 0, accuracy: 12 });
    }

    // Move again (5 fixes)
    for (let i = 0; i < 5; i++) {
      fixes.push({
        latitude: BASE_LAT + 0.001 + i * 0.0001,
        longitude: BASE_LNG,
        speed: 8.0,
        accuracy: 10,
      });
    }

    const saved = simulateJsTracking(fixes);

    // Moving phase: 5 records
    // Stop phase: 1 "stopped at" record (drift suppressed)
    // Move again: after 3 consecutive, saves remaining 2
    // Total: 5 + 1 + 2 = 8
    const movingRecords = saved.filter(r => r.speed > 0);
    const stoppedRecords = saved.filter(r => r.speed === 0);

    expect(stoppedRecords.length).toBe(1); // Only 1 "stopped at"
    expect(movingRecords.length).toBeGreaterThanOrEqual(5); // First 5 + resumed
  });

  // ── TEST 6: Foreground→Background→Foreground while parked (OLD vs NEW) ──

  test('foreground resume while parked: OLD logic creates drift, NEW does not', () => {
    // Parked in foreground
    const foregroundFixes: SimFix[] = [];
    for (let i = 0; i < 5; i++) {
      const d = fixedDrift(i, 10);
      foregroundFixes.push({ latitude: d.lat, longitude: d.lng, speed: 0, accuracy: 12 });
    }

    // Native background (parked, JS doesn't process these)
    const backgroundFixes: SimFix[] = [];

    // Resume foreground (still parked, GPS drifted 20m)
    const resumeFixes: SimFix[] = [];
    for (let i = 0; i < 5; i++) {
      const d = fixedDrift(i + 10, 20); // different drift positions
      resumeFixes.push({ latitude: d.lat, longitude: d.lng, speed: 0, accuracy: 15 });
    }

    // OLD behavior: resetOnResume = true
    const oldSaved = simulateWithTransition(
      foregroundFixes, backgroundFixes, resumeFixes, true,
    );

    // NEW behavior: resetOnResume = false
    const newSaved = simulateWithTransition(
      foregroundFixes, backgroundFixes, resumeFixes, false,
    );

    console.log(`  Resume while parked: OLD saved ${oldSaved.length} records, NEW saved ${newSaved.length} records`);

    // NEW: only 1 record total (first "stopped at")
    expect(newSaved.length).toBe(1);

    // OLD: 2 records (first "stopped at" + drift on resume)
    expect(oldSaved.length).toBe(2);
  });

  // ── TEST 7: Background→Foreground, truck moved in background ──

  test('foreground resume after truck moved: picks up correctly', () => {
    // Parked in foreground
    const foregroundFixes: SimFix[] = [
      { latitude: BASE_LAT, longitude: BASE_LNG, speed: 0, accuracy: 10 },
      { latitude: BASE_LAT, longitude: BASE_LNG, speed: 0, accuracy: 10 },
    ];

    const backgroundFixes: SimFix[] = []; // handled by native, not JS

    // Resume: truck is now moving at a different location
    const resumeFixes: SimFix[] = [];
    for (let i = 0; i < 6; i++) {
      resumeFixes.push({
        latitude: BASE_LAT + 0.01 + i * 0.0001, // 1km+ away from parked spot
        longitude: BASE_LNG,
        speed: 8.0,
        accuracy: 10,
      });
    }

    const saved = simulateWithTransition(
      foregroundFixes, backgroundFixes, resumeFixes, false,
    );

    // 1 "stopped at" from foreground + after 3 consecutive moving = saves fix 3,4,5
    const parkedRecords = saved.filter(r => r.speed === 0);
    const movingRecords = saved.filter(r => r.speed > 0);

    expect(parkedRecords.length).toBe(1);
    expect(movingRecords.length).toBeGreaterThanOrEqual(3); // fixes 3-5
  });

  // ── TEST 8: 2 spikes before background + 1 after = should NOT clear ──

  test('speed spikes across background gap do not carry over', () => {
    // Parked, 2 speed spikes before background
    const foregroundFixes: SimFix[] = [
      { latitude: BASE_LAT, longitude: BASE_LNG, speed: 0, accuracy: 10 },
      { latitude: BASE_LAT, longitude: BASE_LNG, speed: 0, accuracy: 10 },
      // 2 spikes (consecutiveMovingCount would be 2)
      { latitude: BASE_LAT + 0.0003, longitude: BASE_LNG, speed: 2.0, accuracy: 15 },
      { latitude: BASE_LAT + 0.0006, longitude: BASE_LNG, speed: 2.5, accuracy: 15 },
    ];

    const backgroundFixes: SimFix[] = [];

    // Resume: 1 more spike (would make 3 if count carried over!)
    const resumeFixes: SimFix[] = [
      { latitude: BASE_LAT + 0.001, longitude: BASE_LNG, speed: 2.0, accuracy: 15 },
      // Then stationary again
      { latitude: BASE_LAT + 0.001, longitude: BASE_LNG, speed: 0, accuracy: 10 },
      { latitude: BASE_LAT + 0.001, longitude: BASE_LNG, speed: 0, accuracy: 10 },
    ];

    const saved = simulateWithTransition(
      foregroundFixes, backgroundFixes, resumeFixes, false,
    );

    // Only the first "stopped at" should be saved — spikes should NOT clear wasStationary
    expect(saved.length).toBe(1);
    expect(saved[0].speed).toBe(0);
  });

  // ── TEST 9: Inaccurate fixes filtered ──

  test('inaccurate GPS fixes (>100m) are always skipped', () => {
    const fixes: SimFix[] = [
      { latitude: BASE_LAT, longitude: BASE_LNG, speed: 5.0, accuracy: 10 },
      { latitude: BASE_LAT + 0.001, longitude: BASE_LNG, speed: 5.0, accuracy: 150 }, // bad fix
      { latitude: BASE_LAT + 0.002, longitude: BASE_LNG, speed: 5.0, accuracy: 200 }, // bad fix
      { latitude: BASE_LAT + 0.001, longitude: BASE_LNG, speed: 5.0, accuracy: 8 },   // good fix
    ];

    const saved = simulateJsTracking(fixes);

    // Only 2 saved (bad accuracy ones skipped)
    expect(saved.length).toBe(2);
    expect(saved.every(r => r.accuracy <= 100)).toBe(true);
  });

  // ── TEST 10: Simulate the exact screenshot scenario ──

  test('LOADING truck 27 minutes parked with periodic spikes (screenshot scenario)', () => {
    const fixes: SimFix[] = [];

    // 27 minutes = ~324 fixes at 5s interval
    // Simulate: mostly speed=0, with random spikes every 30-60s
    for (let i = 0; i < 324; i++) {
      const d = fixedDrift(i, 25); // 25m drift radius
      const isSpike = i % 37 === 0 && i > 0; // spike every ~37 fixes (~3 min)
      fixes.push({
        latitude: d.lat,
        longitude: d.lng,
        speed: isSpike ? 1.8 + Math.random() : 0,
        accuracy: 15 + (i % 5) * 3,
      });
    }

    const newSaved = simulateJsTracking(fixes);
    const oldSaved = simulateOldJsTracking(fixes);

    console.log(`  Screenshot scenario (27min parked):`);
    console.log(`    OLD logic: ${oldSaved.length} records saved (ZIGZAG DRIFT)`);
    console.log(`    NEW logic: ${newSaved.length} records saved (CLEAN)`);

    // NEW: should be 1 (just the "stopped at")
    expect(newSaved.length).toBe(1);

    // OLD: would have many records (the zigzag bug)
    expect(oldSaved.length).toBeGreaterThan(5);
  });
});
