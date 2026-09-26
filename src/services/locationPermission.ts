import {Platform, PermissionsAndroid, NativeModules} from 'react-native';

const {LocationAuthModule} = NativeModules;

/**
 * How much location access we actually have.
 *
 * `foregroundOnly` is the dangerous one: the OS reports the app as permitted,
 * the driver sees no error, and background GPS silently returns nothing for the
 * whole shift. It has to be surfaced in the UI, not logged.
 */
export type LocationPermissionLevel =
  | 'always'         // background tracking works
  | 'foregroundOnly' // "While using the app" — no background fixes
  | 'denied'         // no location at all
  | 'unknown';       // not determined yet, or we could not read it

/**
 * Read the current level. Never prompts — safe to poll.
 *
 * iOS needs the native read: react-native-geolocation-service collapses
 * `.authorizedAlways` and `.authorizedWhenInUse` into a single `granted`, so its
 * result cannot distinguish the two. See ios/TKSync/LocationAuthModule.swift.
 */
export async function getLocationPermissionLevel(): Promise<LocationPermissionLevel> {
  try {
    if (Platform.OS === 'ios') {
      if (!LocationAuthModule?.getAuthorizationStatus) return 'unknown';
      const status: string = await LocationAuthModule.getAuthorizationStatus();
      switch (status) {
        case 'always':
          return 'always';
        case 'whenInUse':
          return 'foregroundOnly';
        case 'denied':
        case 'disabled':
        case 'restricted':
          return 'denied';
        default:
          return 'unknown';
      }
    }

    const fine = await PermissionsAndroid.check(
      PermissionsAndroid.PERMISSIONS.ACCESS_FINE_LOCATION,
    );
    if (!fine) return 'denied';

    // ACCESS_BACKGROUND_LOCATION only exists on Android 10+; below that,
    // foreground permission already covers background.
    if (Number(Platform.Version) < 29) return 'always';

    const background = await PermissionsAndroid.check(
      PermissionsAndroid.PERMISSIONS.ACCESS_BACKGROUND_LOCATION,
    );
    return background ? 'always' : 'foregroundOnly';
  } catch {
    return 'unknown';
  }
}
