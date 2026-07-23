import {useState, useEffect, useRef} from 'react';
import NetInfo, {NetInfoState} from '@react-native-community/netinfo';

type NetworkStatus = {
  isConnected: boolean;
  isInternetReachable: boolean | null;
};

type UseNetworkStatusReturn = {
  isOnline: boolean;
  networkStatus: NetworkStatus;
};

const listeners = new Set<(online: boolean) => void>();
let currentOnline = true;
let initialFetchDone = false;

// DEV-only: force offline for testing. Call setForceOffline(true) to simulate no connectivity.
let _forceOffline = false;
const forceOfflineListeners = new Set<() => void>();

export function setForceOffline(value: boolean) {
  if (!__DEV__) return;
  const wasEffectivelyOnline = getIsOnline();
  _forceOffline = value;
  const nowEffectivelyOnline = getIsOnline();
  console.log(`[Network] Force offline: ${value} (effective online=${nowEffectivelyOnline})`);
  forceOfflineListeners.forEach(cb => cb());
  // Trigger offline->online transition if toggling back to online
  if (nowEffectivelyOnline && !wasEffectivelyOnline) {
    console.log('[Network] Force offline disabled — triggering sync');
    listeners.forEach(cb => cb(true));
  }
}

export function getForceOffline(): boolean {
  return _forceOffline;
}

// Eagerly fetch initial state so getIsOnline() is accurate before the hook mounts
NetInfo.fetch().then((state: NetInfoState) => {
  if (!initialFetchDone) {
    initialFetchDone = true;
    const isConnected = state.isConnected ?? false;
    const isInternetReachable = state.isInternetReachable ?? isConnected;
    currentOnline = isConnected && isInternetReachable !== false;
  }
});

export function onConnectivityRestored(cb: (online: boolean) => void) {
  listeners.add(cb);
  return () => {
    listeners.delete(cb);
  };
}

const offlineListeners = new Set<() => void>();

export function onConnectivityLost(cb: () => void) {
  offlineListeners.add(cb);
  return () => {
    offlineListeners.delete(cb);
  };
}

export function useNetworkStatus(): UseNetworkStatusReturn {
  const [status, setStatus] = useState<NetworkStatus>({
    isConnected: true,
    isInternetReachable: true,
  });
  const [, forceRender] = useState(0);
  const prevOnline = useRef(true);

  useEffect(() => {
    const unsubscribe = NetInfo.addEventListener((state: NetInfoState) => {
      const isConnected = state.isConnected ?? false;
      const isInternetReachable = state.isInternetReachable ?? isConnected;
      const realOnline = isConnected && isInternetReachable !== false;

      setStatus({isConnected, isInternetReachable});
      initialFetchDone = true;
      // Store real network state — never polluted by _forceOffline
      currentOnline = realOnline;

      // Detect real network offline -> online transition (ignore force flag here)
      const effectiveOnline = realOnline && !_forceOffline;
      if (effectiveOnline && !prevOnline.current) {
        console.log('[Network] Connection restored — triggering sync');
        listeners.forEach(cb => cb(true));
      }

      if (!effectiveOnline && prevOnline.current) {
        console.log('[Network] Connection lost — saves will be queued offline');
        offlineListeners.forEach(cb => cb());
      }

      prevOnline.current = effectiveOnline;
    });

    // Re-render when forceOffline toggles so isOnline updates immediately
    const unsubForce = __DEV__
      ? (() => {
          const cb = () => forceRender(n => n + 1);
          forceOfflineListeners.add(cb);
          return () => forceOfflineListeners.delete(cb);
        })()
      : undefined;

    return () => {
      unsubscribe();
      unsubForce?.();
    };
  }, []);

  const isOnline =
    status.isConnected && status.isInternetReachable !== false && !_forceOffline;

  return {isOnline, networkStatus: status};
}

export function getIsOnline(): boolean {
  return currentOnline && !_forceOffline;
}
