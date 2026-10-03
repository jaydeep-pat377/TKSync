/**
 * device_id on every GPS point.
 *
 * The backend confirmed: a driver can be signed in on two phones at once, a
 * second login does not log the first one out, and the MQTT token is tied to the
 * truck and driver rather than the phone. Two phones therefore publish to the
 * same topic, and device_id is the only thing that tells their points apart or
 * lets the server cut one of them off.
 *
 * Mirrors getDeviceId() in deviceId.ts. The value must be resolved once and then
 * never change, including across the JS and native publishers, which is why JS
 * pushes the persisted value down rather than each side resolving its own.
 */

type Store = Record<string, string>;

function makeResolver(store: Store, uniqueId: () => string) {
  let cached: string | null = null;
  return function getDeviceId(): string {
    if (cached) return cached;
    const stored = store.device_id;
    if (stored) {
      cached = stored;
      return stored;
    }
    let id: string;
    try {
      id = uniqueId();
    } catch {
      id = '';
    }
    if (!id) id = `dev_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
    store.device_id = id;
    cached = id;
    return id;
  };
}

describe('device id', () => {
  it('returns the same value on every call', () => {
    const get = makeResolver({}, () => 'android-id-aaa');
    expect(get()).toBe('android-id-aaa');
    expect(get()).toBe('android-id-aaa');
    expect(get()).toBe('android-id-aaa');
  });

  it('survives a restart by reading what was persisted', () => {
    const store: Store = {};
    makeResolver(store, () => 'android-id-aaa')();
    // Fresh process: cache gone, storage kept.
    const afterRestart = makeResolver(store, () => 'something-else')();
    expect(afterRestart).toBe('android-id-aaa');
  });

  it('never returns empty when the platform id is unavailable', () => {
    const get = makeResolver({}, () => '');
    expect(get()).not.toBe('');
    expect(get()).toMatch(/^dev_/);
  });

  it('never returns empty when the platform call throws', () => {
    const get = makeResolver({}, () => {
      throw new Error('not available');
    });
    expect(get()).toMatch(/^dev_/);
  });

  it('gives two phones two different ids', () => {
    const phoneA = makeResolver({}, () => 'android-id-aaa')();
    const phoneB = makeResolver({}, () => 'android-id-bbb')();
    expect(phoneA).not.toBe(phoneB);
  });

  it('gives one phone one id even when the fallback is used twice', () => {
    // Same store = same install. The second resolver must not mint a new id.
    const store: Store = {};
    const first = makeResolver(store, () => '')();
    const second = makeResolver(store, () => '')();
    expect(second).toBe(first);
  });
});

export {}; // Module scope: these files declare top-level names that collide otherwise.
