import {useCallback, useEffect, useState} from 'react';
import {AppState} from 'react-native';
import type {AppStateStatus} from 'react-native';
import {
  getLocationPermissionLevel,
  type LocationPermissionLevel,
} from '../services/locationPermission';

/**
 * Current location permission level, re-checked whenever the app comes back to
 * the foreground — which is exactly when the driver returns from Settings, so
 * the banner clears itself the moment they fix it.
 */
export function useBackgroundLocationPermission(): LocationPermissionLevel {
  const [level, setLevel] = useState<LocationPermissionLevel>('unknown');

  const check = useCallback(() => {
    getLocationPermissionLevel().then(setLevel).catch(() => {});
  }, []);

  useEffect(() => {
    check();
    const sub = AppState.addEventListener('change', (s: AppStateStatus) => {
      if (s === 'active') check();
    });
    return () => sub.remove();
  }, [check]);

  return level;
}
