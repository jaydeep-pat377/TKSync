import DeviceInfo from 'react-native-device-info';
import {storage} from './storage';

/**
 * Stable identifier for this install, sent on every GPS point as `device_id`.
 *
 * The backend confirmed a driver can be signed in on two phones at once, that a
 * second login does not log the first one out, and that the MQTT token is tied
 * to the truck and driver rather than to a phone. So two phones publish to the
 * same topic and, without this, the server cannot tell their points apart or cut
 * one of them off.
 *
 * Resolved once and persisted. `getUniqueIdSync()` returns ANDROID_ID on Android
 * and identifierForVendor on iOS; both are stable for the life of the install.
 * The persisted copy is what is used from then on, so the value cannot change
 * under us if the underlying API ever does, and it is the same value the native
 * service receives through setDeviceId().
 */
const DEVICE_ID_KEY = 'device_id';

let cached: string | null = null;

export function getDeviceId(): string {
  if (cached) return cached;

  const stored = storage.getString(DEVICE_ID_KEY);
  if (stored) {
    cached = stored;
    return stored;
  }

  let id: string;
  try {
    id = DeviceInfo.getUniqueIdSync();
  } catch {
    id = '';
  }
  // Fall back to a random id rather than an empty one: a blank device_id on
  // every phone is worse than an arbitrary but stable one, because it silently
  // merges two devices back into one as far as the server can tell.
  if (!id) {
    id = `dev_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
  }

  storage.set(DEVICE_ID_KEY, id);
  cached = id;
  return id;
}

/** Forget the cached value — only for tests. */
export function resetDeviceIdCache(): void {
  cached = null;
}
