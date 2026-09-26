/**
 * Task A — the backfill flag.
 *
 * On reconnect the phone flushes its whole offline backlog. Server-side every
 * point overwrites the "current position" hash in Redis, so the dispatcher
 * watches the truck marker walk backwards through the entire old route at
 * whatever speed the backlog drains, and only then land where the truck really
 * is. The web team cannot filter it out: a backfilled point looks identical to
 * a live one from their side.
 *
 * `backfill: true` lets the server write the point into route history but skip
 * the current-position update.
 *
 * The rule is an age check rather than a per-call-site flag, so it holds for
 * every path — live foreground, the native bridge and the catch-up flush —
 * including the ones that do not exist yet. These tests pin the rule itself.
 */

const BACKFILL_AFTER_MS = 60_000;

/** Same expression as mqttService.publish() and LocationTrackingService.isBackfill(). */
function isBackfill(recordedAt: string, now: number): boolean {
  const t = Date.parse(recordedAt);
  return Number.isFinite(t) && now - t > BACKFILL_AFTER_MS;
}

const NOW = Date.parse('2026-09-25T12:00:00.000Z');
const at = (msAgo: number) => new Date(NOW - msAgo).toISOString();

describe('backfill flag', () => {
  it('is false for a fix published the instant it was captured', () => {
    expect(isBackfill(at(0), NOW)).toBe(false);
  });

  it('is false for a live fix that took a few seconds to reach the broker', () => {
    expect(isBackfill(at(5_000), NOW)).toBe(false);
  });

  it('is false right up to the 60s boundary', () => {
    expect(isBackfill(at(60_000), NOW)).toBe(false);
  });

  it('is true just past it', () => {
    expect(isBackfill(at(60_001), NOW)).toBe(true);
  });

  it('is true for a backlog that sat through a 40-minute outage', () => {
    expect(isBackfill(at(40 * 60_000), NOW)).toBe(true);
  });

  it('flags the whole backlog, including its newest point', () => {
    // A 10-minute offline drive, flushed 2 minutes after reconnect.
    const backlog = Array.from({length: 20}, (_, i) => at(2 * 60_000 + i * 30_000));
    expect(backlog.every(r => isBackfill(r, NOW))).toBe(true);
  });

  it('does not flag the live points of the same drive', () => {
    const live = [at(0), at(1_000), at(2_000)];
    expect(live.some(r => isBackfill(r, NOW))).toBe(false);
  });

  it('is false for an unparseable timestamp — never guess at a backfill', () => {
    expect(isBackfill('', NOW)).toBe(false);
    expect(isBackfill('not a date', NOW)).toBe(false);
  });

  it('is false for a clock-skewed future timestamp', () => {
    expect(isBackfill(at(-60 * 60_000), NOW)).toBe(false);
  });
});
