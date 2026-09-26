/**
 * Accuracy gate re-warm-up.
 *
 * Mirrors the graduated accuracy filter in both implementations:
 *   - src/services/backgroundGpsTracker.ts  (foreground / JS)
 *   - LocationTrackingService.kt            (background / native)
 *
 * The gate opens at 50m, hardens to 25m 30s after the first sub-25m fix, and
 * re-opens to 50m after a sustained run of rejections. Without the re-open it
 * is a one-way ratchet: one good fix at the start of a shift arms 25m for the
 * life of the service, and a later stretch of 30-40m accuracy (parking
 * structure, tunnel, dense downtown) drops every fix with no recovery path.
 */

export {}; // Scope this file as a module — sibling test files share the global scope.

const STRICT_ACCURACY = 25;
const INITIAL_ACCURACY = 50;
const WARMUP_MS = 30_000;
const ACCURACY_REWARMUP_REJECTS = 10;
const T0 = 1_700_000_000_000; // firstGoodFixTime uses 0 as its "unset" sentinel — never start at 0

/** Runs a sequence of (accuracy, timestamp) fixes through the gate. */
function runGate(fixes: Array<{accuracy: number; t: number}>) {
  let firstGoodFixTime = 0;
  let consecutiveAccuracyRejects = 0;
  const accepted: number[] = [];

  for (const fix of fixes) {
    const hasWarmedUp =
      firstGoodFixTime > 0 && fix.t - firstGoodFixTime > WARMUP_MS;
    const accuracyLimit = hasWarmedUp ? STRICT_ACCURACY : INITIAL_ACCURACY;

    if (fix.accuracy >= accuracyLimit) {
      consecutiveAccuracyRejects++;
      if (hasWarmedUp && consecutiveAccuracyRejects >= ACCURACY_REWARMUP_REJECTS) {
        firstGoodFixTime = 0;
        consecutiveAccuracyRejects = 0;
      }
      continue;
    }
    consecutiveAccuracyRejects = 0;

    if (fix.accuracy < STRICT_ACCURACY && firstGoodFixTime === 0) {
      firstGoodFixTime = fix.t;
    }
    accepted.push(fix.accuracy);
  }
  return accepted;
}

describe('GPS accuracy gate', () => {
  it('accepts up to 50m before warm-up', () => {
    const accepted = runGate([
      {accuracy: 45, t: T0},
      {accuracy: 38, t: T0 + 1000},
      {accuracy: 55, t: T0 + 2000}, // above 50m even when cold
    ]);
    expect(accepted).toEqual([45, 38]);
  });

  it('hardens to 25m once warmed up', () => {
    const accepted = runGate([
      {accuracy: 12, t: T0}, // arms the gate
      {accuracy: 30, t: T0 + 40_000}, // warmed up — 30m now rejected
      {accuracy: 20, t: T0 + 41_000},
    ]);
    expect(accepted).toEqual([12, 20]);
  });

  it('re-opens the gate to 50m after a sustained run of rejections', () => {
    const fixes = [{accuracy: 12, t: T0}];
    // A parking structure: 34m fixes, all rejected by the 25m gate.
    for (let i = 0; i < ACCURACY_REWARMUP_REJECTS; i++) {
      fixes.push({accuracy: 34, t: T0 + 40_000 + i * 1000});
    }
    // The gate has re-warmed by now, so this one gets through.
    fixes.push({accuracy: 34, t: T0 + 60_000});

    expect(runGate(fixes)).toEqual([12, 34]);
  });

  it('does not re-open before the rejection run is long enough', () => {
    const fixes = [{accuracy: 12, t: T0}];
    for (let i = 0; i < ACCURACY_REWARMUP_REJECTS - 1; i++) {
      fixes.push({accuracy: 34, t: T0 + 40_000 + i * 1000});
    }
    fixes.push({accuracy: 34, t: T0 + 60_000});

    expect(runGate(fixes)).toEqual([12]);
  });

  it('a good fix in between resets the rejection counter', () => {
    const fixes = [{accuracy: 12, t: T0}];
    // Nine rejections, one good fix, nine more — never ten in a row.
    for (let i = 0; i < 9; i++) fixes.push({accuracy: 34, t: T0 + 40_000 + i * 1000});
    fixes.push({accuracy: 18, t: T0 + 50_000});
    for (let i = 0; i < 9; i++) fixes.push({accuracy: 34, t: T0 + 51_000 + i * 1000});

    expect(runGate(fixes)).toEqual([12, 18]);
  });
});
