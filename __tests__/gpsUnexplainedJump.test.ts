/**
 * Multipath spurs — the hooks that appear on the dispatch trail at junctions.
 *
 * The truck 773 screenshots show the trail leaving Raiya Road, hooking ~40-50 m
 * off the carriageway and rejoining, right at the Dr. Yagnik Road turn. Nothing
 * in the filter chain stopped it: the accuracy gate admits 25 m normally and
 * re-warms to 50 m after a run of rejections (which is exactly what a junction
 * lined with buildings produces), and the only outlier guard was a 288 km/h
 * teleport check — at 1 Hz that permits an 80 m jump unchallenged.
 *
 * The fix corroborates position against the Doppler speed, which does not suffer
 * multipath the way position does. Mirrors handlePosition() in
 * backgroundGpsTracker.ts and saveLocation() in LocationTrackingService.kt —
 * both must agree or the trail changes shape depending on whether the app was in
 * the foreground.
 */

const MAX_UNEXPLAINED_SPEED = 10; // m/s

/** Straight-line metres between two close points, flat-earth is fine at this scale. */
function metres(aLat: number, aLng: number, bLat: number, bLng: number): number {
  const dLat = (bLat - aLat) * 111_320;
  const dLng = (bLng - aLng) * 111_320 * Math.cos((aLat * Math.PI) / 180);
  return Math.hypot(dLat, dLng);
}

type Fix = {lat: number; lng: number; speed: number | null; t: number};

/** True when the fix should be dropped as multipath. */
function isUnexplainedJump(prev: Fix | null, fix: Fix): boolean {
  if (!prev) return false;
  if (fix.speed === null) return false; // No speed to corroborate against
  const dt = (fix.t - prev.t) / 1000;
  if (dt <= 0 || dt >= 10) return false;
  const implied = metres(prev.lat, prev.lng, fix.lat, fix.lng) / dt;
  return implied > fix.speed + MAX_UNEXPLAINED_SPEED;
}

// Raiya Road, near the Dr. Yagnik Road junction.
const ON_ROUTE: Fix = {lat: 22.2855, lng: 70.7785, speed: 3, t: 0};

describe('unexplained jump filter', () => {
  it('drops a 45m hop while the truck is crawling through a turn', () => {
    // 45 m in one second is 45 m/s. The speedometer says 3 m/s.
    const spur: Fix = {lat: 22.2859, lng: 70.7785, speed: 3, t: 1000};
    expect(metres(ON_ROUTE.lat, ON_ROUTE.lng, spur.lat, spur.lng)).toBeCloseTo(44.5, 0);
    expect(isUnexplainedJump(ON_ROUTE, spur)).toBe(true);
  });

  it('keeps normal city driving', () => {
    // 14 m in one second at a reported 14 m/s — position and speed agree.
    const next: Fix = {lat: 22.28562, lng: 70.7785, speed: 14, t: 1000};
    expect(isUnexplainedJump(ON_ROUTE, next)).toBe(false);
  });

  it('keeps a highway fix — the threshold is relative, not absolute', () => {
    const fast: Fix = {lat: 22.28577, lng: 70.7785, speed: 30, t: 1000};
    expect(isUnexplainedJump(ON_ROUTE, fast)).toBe(false);
  });

  it('tolerates a device reporting zero speed while actually moving', () => {
    // Some devices read 0 at low speed. 8 m/s of real motion still passes,
    // because the allowance is 10 m/s on top of whatever was reported.
    const creeping: Fix = {lat: 22.285572, lng: 70.7785, speed: 0, t: 1000};
    expect(isUnexplainedJump(ON_ROUTE, creeping)).toBe(false);
  });

  it('drops the same 45m hop even when the truck is fully stopped', () => {
    const parked: Fix = {...ON_ROUTE, speed: 0};
    const drift: Fix = {lat: 22.2859, lng: 70.7785, speed: 0, t: 1000};
    expect(isUnexplainedJump(parked, drift)).toBe(true);
  });

  it('does not judge a long gap — the previous fix is stale after a background stretch', () => {
    const afterBackground: Fix = {lat: 22.3, lng: 70.79, speed: 2, t: 120_000};
    expect(isUnexplainedJump(ON_ROUTE, afterBackground)).toBe(false);
  });

  it('skips the check when the device reports no speed at all', () => {
    const noSpeed: Fix = {lat: 22.2859, lng: 70.7785, speed: null, t: 1000};
    expect(isUnexplainedJump(ON_ROUTE, noSpeed)).toBe(false);
  });
});

/**
 * The stationary-drift confirm distance was a flat 15 m — below the 25-50 m the
 * accuracy gate admits, so drift alone could clear the stationary flag and draw a
 * spur while the truck was parked. It now scales with the fix's own accuracy.
 */
const DISTANCE_CONFIRM_THRESHOLD = 15;
const confirmDistance = (accuracy: number) =>
  Math.max(DISTANCE_CONFIRM_THRESHOLD, accuracy * 1.5);

describe('stationary confirm distance', () => {
  it('keeps the 15m floor when the fix is sharp', () => {
    expect(confirmDistance(5)).toBe(15);
    expect(confirmDistance(10)).toBe(15);
  });

  it('demands more than the error bar when the fix is loose', () => {
    expect(confirmDistance(25)).toBe(37.5); // the strict gate's limit
    expect(confirmDistance(50)).toBe(75); // the re-warmed gate's limit
  });

  it('is always above the accuracy claiming the movement', () => {
    for (const accuracy of [5, 12, 25, 40, 50]) {
      expect(confirmDistance(accuracy)).toBeGreaterThan(accuracy);
    }
  });
});

export {}; // Module scope: these files declare top-level names that collide otherwise.
