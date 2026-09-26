/**
 * Task B — presence messages.
 *
 * The dashboard currently infers an outage from silence ("last signal 41 min
 * ago"). It has no idea when the truck will be back or how much data is about
 * to arrive, so it cannot mark the gap boundaries or prepare for the backfill.
 *
 * The risk in the implementation is the latch: publishBackgroundRecords() is
 * called from several places on reconnect (the connectivity listener, the MQTT
 * onReconnect callback, and foreground resume), and each one must not produce
 * its own "online" message. These tests pin that.
 */

type Presence =
  | {status: 'offline'; since: string}
  | {status: 'online'; backfill_count: number; backfill_from: string; backfill_to: string};

/** Mirrors the offlineSince latch in backgroundGpsTracker.ts. */
function makeTracker() {
  let offlineSince: string | null = null;
  const sent: Presence[] = [];

  return {
    sent,
    /** onConnectivityLost */
    lose(at: string) {
      if (offlineSince) return; // already in an outage
      offlineSince = at;
      sent.push({status: 'offline', since: at});
    },
    /** publishBackgroundRecords() — may fire several times per reconnect */
    flush(unsynced: {recorded_at: string}[]) {
      if (!offlineSince) return;
      const timestamps = unsynced.map(r => r.recorded_at).sort();
      sent.push({
        status: 'online',
        backfill_count: unsynced.length,
        backfill_from: timestamps[0] ?? offlineSince,
        backfill_to: timestamps[timestamps.length - 1] ?? 'now',
      });
      offlineSince = null;
    },
  };
}

const rec = (t: string) => ({recorded_at: t});

describe('presence', () => {
  it('announces the outage when connectivity drops', () => {
    const t = makeTracker();
    t.lose('2026-09-25T12:20:00.000Z');
    expect(t.sent).toEqual([{status: 'offline', since: '2026-09-25T12:20:00.000Z'}]);
  });

  it('does not re-announce while already offline', () => {
    const t = makeTracker();
    t.lose('2026-09-25T12:20:00.000Z');
    t.lose('2026-09-25T12:21:00.000Z');
    t.lose('2026-09-25T12:22:00.000Z');
    expect(t.sent).toHaveLength(1);
    expect((t.sent[0] as any).since).toBe('2026-09-25T12:20:00.000Z');
  });

  it('reports the backlog size and window on reconnect', () => {
    const t = makeTracker();
    t.lose('2026-09-25T12:20:00.000Z');
    t.flush([
      rec('2026-09-25T12:21:00.000Z'),
      rec('2026-09-25T12:30:00.000Z'),
      rec('2026-09-25T12:40:00.000Z'),
    ]);
    expect(t.sent[1]).toEqual({
      status: 'online',
      backfill_count: 3,
      backfill_from: '2026-09-25T12:21:00.000Z',
      backfill_to: '2026-09-25T12:40:00.000Z',
    });
  });

  it('derives the window from recorded_at, not arrival order', () => {
    const t = makeTracker();
    t.lose('2026-09-25T12:20:00.000Z');
    // Storage order is not guaranteed chronological.
    t.flush([
      rec('2026-09-25T12:40:00.000Z'),
      rec('2026-09-25T12:21:00.000Z'),
      rec('2026-09-25T12:30:00.000Z'),
    ]);
    expect((t.sent[1] as any).backfill_from).toBe('2026-09-25T12:21:00.000Z');
    expect((t.sent[1] as any).backfill_to).toBe('2026-09-25T12:40:00.000Z');
  });

  it('sends exactly one online message however many things trigger a flush', () => {
    const t = makeTracker();
    t.lose('2026-09-25T12:20:00.000Z');
    // connectivity listener, MQTT onReconnect, and foreground resume all fire.
    t.flush([rec('2026-09-25T12:21:00.000Z')]);
    t.flush([]);
    t.flush([]);
    expect(t.sent.filter(p => p.status === 'online')).toHaveLength(1);
  });

  it('stays quiet when a flush happens without an outage', () => {
    const t = makeTracker();
    t.flush([rec('2026-09-25T12:21:00.000Z')]);
    expect(t.sent).toHaveLength(0);
  });

  it('re-arms for the next outage', () => {
    const t = makeTracker();
    t.lose('2026-09-25T12:20:00.000Z');
    t.flush([rec('2026-09-25T12:21:00.000Z')]);
    t.lose('2026-09-25T13:00:00.000Z');
    t.flush([rec('2026-09-25T13:05:00.000Z')]);
    expect(t.sent.map(p => p.status)).toEqual(['offline', 'online', 'offline', 'online']);
  });

  it('falls back to the outage start when the backlog is empty', () => {
    const t = makeTracker();
    t.lose('2026-09-25T12:20:00.000Z');
    t.flush([]);
    expect((t.sent[1] as any).backfill_from).toBe('2026-09-25T12:20:00.000Z');
    expect((t.sent[1] as any).backfill_count).toBe(0);
  });
});
