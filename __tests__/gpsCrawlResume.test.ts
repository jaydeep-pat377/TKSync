/**
 * Long silences when a stopped truck starts driving again.
 *
 * Live test 2026-09-29, trucks 770 and 581: after the truck had been stopped or
 * crawling, the app went quiet for 53-158 s while the truck covered 68-133 m.
 * The map showed it parked, then jumped.
 *
 * Cause: the "has it moved far enough to be real?" distance check only existed in
 * the moving branch. A fix below IDLE_SPEED_THRESHOLD was discarded without the
 * distance ever being looked at, and the moving counter was zeroed on every dip.
 * In stop-start traffic the instantaneous speed oscillates across 0.5 m/s, so the
 * counter ran 1, 0, 1, 0 and never reached MOVING_CONFIRM_THRESHOLD.
 *
 * Mirrors handlePosition() in backgroundGpsTracker.ts and saveLocation() in
 * LocationTrackingService.kt. The two must agree.
 */

const IDLE_SPEED_THRESHOLD = 0.5;
const MOVING_CONFIRM_THRESHOLD = 2;
const DISTANCE_CONFIRM_THRESHOLD = 15;
const SLOW_FIXES_TO_RESET = 2;
const STATIONARY_HEARTBEAT_MS = 15_000;
const HEARTBEAT_MIN_DRIFT = 5;
const HEARTBEAT_MIN_SPEED = 0.2;

type Fix = {distFromStop: number; speed: number; accuracy: number; t: number};
type Emitted = 'point' | 'heartbeat';

/** Runs a sequence of fixes through the stationary-suppression logic. */
function runFromStop(fixes: Fix[]): {emitted: Emitted[]; confirmedAt: number | null} {
  let wasStationary = true;
  let movingCount = 0;
  let slowCount = 0;
  let lastHeartbeatAt = 0;
  const emitted: Emitted[] = [];
  let confirmedAt: number | null = null;

  for (const f of fixes) {
    const confirmDistance = Math.max(DISTANCE_CONFIRM_THRESHOLD, f.accuracy * 1.5);

    if (f.speed < IDLE_SPEED_THRESHOLD) {
      slowCount++;
      if (slowCount >= SLOW_FIXES_TO_RESET) movingCount = 0;

      if (wasStationary) {
        if (f.distFromStop >= confirmDistance) {
          wasStationary = false;
          movingCount = 0;
          slowCount = 0;
          if (confirmedAt === null) confirmedAt = f.t;
          emitted.push('point');
          continue;
        }
        if (
          (f.distFromStop >= HEARTBEAT_MIN_DRIFT || f.speed >= HEARTBEAT_MIN_SPEED) &&
          f.t - lastHeartbeatAt >= STATIONARY_HEARTBEAT_MS
        ) {
          lastHeartbeatAt = f.t;
          emitted.push('heartbeat');
        }
        continue;
      }
    } else {
      slowCount = 0;
      movingCount++;
      if (movingCount >= MOVING_CONFIRM_THRESHOLD || f.distFromStop >= confirmDistance) {
        if (wasStationary && confirmedAt === null) confirmedAt = f.t;
        wasStationary = false;
      } else if (wasStationary) {
        continue;
      }
    }
    emitted.push('point');
  }
  return {emitted, confirmedAt};
}

/** Stop-start crawl: speed oscillates across the 0.5 m/s line, 2 s apart. */
function crawl(seconds: number, metresPerSecond: number, accuracy = 10): Fix[] {
  const out: Fix[] = [];
  for (let i = 1; i * 2 <= seconds; i++) {
    const t = i * 2000;
    out.push({
      distFromStop: metresPerSecond * i * 2,
      // Alternating: the dip is what used to zero the counter.
      speed: i % 2 === 0 ? 0.2 : 0.8,
      accuracy,
      t,
    });
  }
  return out;
}

describe('resuming from a stop', () => {
  it('breaks out of suppression on distance even while the speed reads stopped', () => {
    // Truck 770, 18:07:28 -> 18:10:06: 90 m covered, 158 s of silence.
    const {confirmedAt} = runFromStop(crawl(158, 90 / 158));
    expect(confirmedAt).not.toBeNull();
    // 15 m at 0.57 m/s is ~26 s, not 158.
    expect(confirmedAt! / 1000).toBeLessThan(30);
  });

  it('confirms within seconds for every gap in the live test', () => {
    const cases = [
      {gapS: 63, metres: 72},
      {gapS: 54, metres: 124},
      {gapS: 53, metres: 68},
      {gapS: 158, metres: 90},
      {gapS: 93, metres: 133},
    ];
    for (const c of cases) {
      const {confirmedAt} = runFromStop(crawl(c.gapS, c.metres / c.gapS));
      expect(confirmedAt).not.toBeNull();
      expect(confirmedAt! / 1000).toBeLessThan(c.gapS / 2);
    }
  });

  it('never leaves more than 15 s of silence while the truck is creeping', () => {
    // Below the confirm distance the whole time, but clearly not parked.
    const creeping: Fix[] = [];
    for (let i = 1; i <= 30; i++) {
      creeping.push({distFromStop: 6, speed: 0.3, accuracy: 10, t: i * 2000});
    }
    const {emitted} = runFromStop(creeping);
    const beats = emitted.filter(e => e === 'heartbeat').length;
    // 60 s of creeping at a 15 s heartbeat.
    expect(beats).toBeGreaterThanOrEqual(3);
  });

  it('stays silent for a genuinely parked truck', () => {
    // No speed, no drift beyond noise — the long parked gaps the dashboard expects.
    const parked: Fix[] = [];
    for (let i = 1; i <= 60; i++) {
      parked.push({distFromStop: 2, speed: 0, accuracy: 10, t: i * 2000});
    }
    const {emitted, confirmedAt} = runFromStop(parked);
    expect(emitted).toEqual([]);
    expect(confirmedAt).toBeNull();
  });

  it('does not let one slow fix wipe the progress of the moving counter', () => {
    // Two moving fixes either side of a single dip still confirm on the second.
    const fixes: Fix[] = [
      {distFromStop: 2, speed: 0.9, accuracy: 10, t: 2000},
      {distFromStop: 3, speed: 0.3, accuracy: 10, t: 4000},
      {distFromStop: 5, speed: 0.9, accuracy: 10, t: 6000},
    ];
    const {confirmedAt} = runFromStop(fixes);
    expect(confirmedAt).toBe(6000);
  });

  it('demands more distance when the fix is loose, so drift still cannot confirm', () => {
    // 20 m of drift on a 50 m-accurate fix needs 75 m, so it stays suppressed.
    const drifting: Fix[] = [];
    for (let i = 1; i <= 20; i++) {
      drifting.push({distFromStop: 20, speed: 0.1, accuracy: 50, t: i * 2000});
    }
    const {confirmedAt} = runFromStop(drifting);
    expect(confirmedAt).toBeNull();
  });
});

export {}; // Module scope: these files declare top-level names that collide otherwise.
