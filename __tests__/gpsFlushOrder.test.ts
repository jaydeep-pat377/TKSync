/**
 * Offline backlog must reach the broker oldest-first, ahead of any live fix.
 *
 * gps-consumer keeps ONE position per truck in Redis and drops anything older
 * than what it already holds. So a single live point jumping the queue makes
 * the whole backlog stale on arrival: every replayed point is rejected for the
 * live map and dispatchers see only the straight jump. Timescale stores them
 * either way — this is purely about the live view.
 *
 * Mirrors the ordering + hold logic in backgroundGpsTracker.ts
 * (publishBackgroundRecords / deferLivePublish) and its Kotlin twin in
 * LocationTrackingService.replayOfflineRecords().
 */

type Rec = {id: string; recorded_at: string; synced: boolean};

function makePipeline() {
  const wire: string[] = []; // recorded_at values, in the order they hit the broker
  const store: Rec[] = [];
  let flushing = false;
  let queued = false;

  /** deferLivePublish() — hold the fix, the flush re-run will carry it. */
  function deferLive(): boolean {
    if (!flushing) return false;
    queued = true;
    return true;
  }

  function flush(during?: () => void): void {
    if (flushing) {
      queued = true;
      return;
    }
    flushing = true;
    queued = false;
    try {
      const unsynced = store
        .filter(r => !r.synced)
        .slice()
        .sort((a, b) => (Date.parse(a.recorded_at) || 0) - (Date.parse(b.recorded_at) || 0));
      let fired = false;
      for (const r of unsynced) {
        wire.push(r.recorded_at);
        r.synced = true;
        // Publishing is async in the real thing; a GPS fix can land mid-flush.
        if (!fired && during) {
          fired = true;
          during();
        }
      }
    } finally {
      flushing = false;
      if (queued) {
        queued = false;
        flush();
      }
    }
  }

  return {
    wire,
    flush,
    /** A record saved while offline — never published at capture time. */
    save(recorded_at: string) {
      store.push({id: `r${store.length}`, recorded_at, synced: false});
    },
    /** handlePosition() / handleNativeGpsRecord() — live fix, publishes unless held. */
    live(recorded_at: string) {
      const r: Rec = {id: `r${store.length}`, recorded_at, synced: false};
      store.push(r);
      if (deferLive()) return;
      wire.push(recorded_at);
      r.synced = true;
    },
  };
}

const T = (mm: number) => `2026-09-25T12:${String(mm).padStart(2, '0')}:00.000Z`;

describe('offline flush ordering', () => {
  it('sends the backlog oldest first', () => {
    const p = makePipeline();
    p.save(T(20));
    p.save(T(21));
    p.save(T(22));
    p.flush();
    expect(p.wire).toEqual([T(20), T(21), T(22)]);
  });

  it('sorts by recorded_at, not by storage order', () => {
    // Native background records are imported on foreground and appended AFTER
    // the JS records, even though they were captured earlier.
    const p = makePipeline();
    p.save(T(40)); // JS record, captured last
    p.save(T(20)); // native import, captured first
    p.save(T(30));
    p.flush();
    expect(p.wire).toEqual([T(20), T(30), T(40)]);
  });

  it('holds a live fix that arrives mid-flush until the backlog is out', () => {
    const p = makePipeline();
    p.save(T(20));
    p.save(T(21));
    p.save(T(22));
    p.flush(() => p.live(T(45))); // driver keeps moving while the backlog drains
    expect(p.wire).toEqual([T(20), T(21), T(22), T(45)]);
  });

  it('still delivers the held fix — holding is a delay, not a drop', () => {
    const p = makePipeline();
    p.save(T(20));
    p.flush(() => {
      p.live(T(45));
      p.live(T(46));
    });
    expect(p.wire).toEqual([T(20), T(45), T(46)]);
  });

  it('publishes a live fix immediately when no flush is running', () => {
    const p = makePipeline();
    p.live(T(50));
    expect(p.wire).toEqual([T(50)]);
  });

  it('sends nothing when the backlog is empty', () => {
    const p = makePipeline();
    p.flush();
    expect(p.wire).toEqual([]);
  });

  it('keeps unparseable timestamps at the front instead of reordering the rest', () => {
    const p = makePipeline();
    p.save(T(30));
    p.save('');
    p.save(T(20));
    p.flush();
    expect(p.wire).toEqual(['', T(20), T(30)]);
  });
});
