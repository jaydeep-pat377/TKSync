import React, {
  createContext,
  useContext,
  useEffect,
  useState,
  useCallback,
  useRef,
  useMemo,
} from 'react';
import {Alert} from 'react-native';
import {useNetworkStatus} from '../hooks/useNetworkStatus';
import {syncManager, SyncEvent} from '../services/syncManager';
import {gpsSyncManager} from '../services/gpsSyncManager';
import {backgroundGpsTracker} from '../services/backgroundGpsTracker';

import {offlineStorage} from '../services/offlineStorage';
import {ticketsApi, trackingApi} from '../services/api';
import {validateDeliveryTab} from '../utils/validateDeliveryTab';
import {useAuth} from './AuthContext';

type OfflineSyncContextType = {
  isOnline: boolean;
  pendingCount: number;
  isSyncing: boolean;
  lastSyncEvent: SyncEvent | null;
  /** Save a delivery tab — goes to API if online, queues offline if not */
  saveDeliveryTab: (
    ticketId: number,
    tab: string,
    body: Record<string, any>,
  ) => Promise<{success: boolean; message: string; offline: boolean}>;
  /** Queue any action for offline sync */
  enqueueOffline: (ticketId: number, tab: string, body: Record<string, any>, action: 'sign' | 'dispute' | 'curbline-release') => void;
  /** Manually trigger sync */
  triggerSync: () => void;
};

const OfflineSyncContext = createContext<OfflineSyncContextType | null>(null);

export function OfflineSyncProvider({children}: {children: React.ReactNode}) {
  const {isOnline} = useNetworkStatus();
  const {isDriverLoggedIn, isLoading: authLoading} = useAuth();
  const [pendingCount, setPendingCount] = useState(
    offlineStorage.getPendingCount(),
  );
  const [isSyncing, setIsSyncing] = useState(false);
  const [lastSyncEvent, setLastSyncEvent] = useState<SyncEvent | null>(null);
  const initialized = useRef(false);

  useEffect(() => {
    if (initialized.current) return;
    initialized.current = true;
    syncManager.init();
    // Import any native GPS records left from previous session (e.g., after app kill)
    backgroundGpsTracker.autoResume().catch(err => {
      console.error('[OfflineSync] autoResume failed:', err);
    });
    gpsSyncManager.flushUnsynced().catch(err => {
      console.error('[OfflineSync] flushUnsynced failed:', err);
    });

    const failedItems: string[] = [];
    const unsub = syncManager.addListener((event: SyncEvent) => {
      setLastSyncEvent(event);

      switch (event.type) {
        case 'sync_start':
          setIsSyncing(true);
          failedItems.length = 0;
          break;
        case 'sync_complete':
          setIsSyncing(false);
          setPendingCount(offlineStorage.getPendingCount());
          // Show alert if any items permanently failed
          if (failedItems.length > 0) {
            Alert.alert(
              'Sync Failed',
              `Some saved data could not be synced and was lost:\n\n${failedItems.join('\n')}\n\nPlease re-enter the data.`,
              [{text: 'OK'}],
            );
          }
          break;
        case 'queue_changed':
          setPendingCount(event.count);
          break;
        case 'item_synced':
          setPendingCount(event.remaining);
          break;
        case 'item_failed': {
          const tab = event.item.tab;
          const ticketId = event.item.ticketId;
          const reason = event.error || 'Unknown error';
          failedItems.push(`• Ticket ${ticketId} / ${capitalize(tab)}: ${reason}`);
          break;
        }
      }
    });

    return () => {
      unsub();
      syncManager.destroy();
    };
  }, []);

  // Auto-start GPS tracking after driver login — always, regardless of ticket
  // Auto-stop on logout
  useEffect(() => {
    // Don't act while auth is still restoring from storage — isDriverLoggedIn
    // is false during loading, which would incorrectly call clearAllData()
    if (authLoading) return;

    if (!isDriverLoggedIn) {
      backgroundGpsTracker.clearAllData().catch(() => {});
      return;
    }

    if (backgroundGpsTracker.isRunning()) return;

    // Start GPS — fetch ticket for tagging, but start regardless
    const startGps = async () => {
      try {
        const res = await trackingApi.getMe();
        const ticketId = res.data?.current_load?.id ?? null;
        console.log(`[OfflineSync] Auto-starting GPS — ticketId: ${ticketId || 'none'}`);
        await backgroundGpsTracker.startAlways(ticketId);
      } catch {
        console.log('[OfflineSync] Auto-starting GPS — no ticket info (API failed)');
        await backgroundGpsTracker.startAlways(null);
      }
    };
    startGps().catch(err => {
      console.error('[OfflineSync] GPS start failed:', err);
    });
  }, [isDriverLoggedIn, authLoading]);

  const saveDeliveryTab = useCallback(
    async (
      ticketId: number,
      tab: string,
      body: Record<string, any>,
    ): Promise<{success: boolean; message: string; offline: boolean}> => {
      // Client-side validation (mirrors backend cleanTabPayload) — prevents
      // invalid data from being queued offline and silently lost on sync.
      const validation = validateDeliveryTab(tab, body);
      if (!validation.valid) {
        const fieldErrors = validation.errors.map(e => `${e.field}: ${e.message}`).join('; ');
        console.warn(`[OfflineSync] Validation failed for ${tab}: ${fieldErrors}`);
        return {
          success: false,
          message: `Validation error: ${fieldErrors}`,
          offline: false,
        };
      }
      // Use cleaned/coerced values (matching backend types)
      const cleanedBody = validation.cleaned;

      if (isOnline) {
        try {
          await ticketsApi.saveDeliveryTab(ticketId, tab, cleanedBody);
          return {success: true, message: `${capitalize(tab)} data saved.`, offline: false};
        } catch (err: any) {
          // Network error during save — fall through to offline queue
          if (isNetworkError(err)) {
            console.log(
              `[OfflineSync] Network error during save, queuing offline: ${err.message}`,
            );
          } else {
            // API-level error (validation, auth, etc.) — don't queue
            return {
              success: false,
              message: err.message || `Failed to save ${tab} data.`,
              offline: false,
            };
          }
        }
      }

      // Offline or network error — queue locally (already validated + cleaned)
      offlineStorage.enqueue(ticketId, tab, cleanedBody);
      offlineStorage.updateCachedTab(ticketId, tab, cleanedBody);
      setPendingCount(offlineStorage.getPendingCount());
      return {
        success: true,
        message: `${capitalize(tab)} data saved offline. It will sync when connection is restored.`,
        offline: true,
      };
    },
    [isOnline],
  );

  const enqueueOffline = useCallback((ticketId: number, tab: string, body: Record<string, any>, action: 'sign' | 'dispute' | 'curbline-release') => {
    offlineStorage.enqueue(ticketId, tab, body, action);
    setPendingCount(offlineStorage.getPendingCount());
  }, []);

  const triggerSync = useCallback(() => {
    syncManager.sync();
  }, []);

  const value = useMemo(() => ({
    isOnline,
    pendingCount,
    isSyncing,
    lastSyncEvent,
    saveDeliveryTab,
    enqueueOffline,
    triggerSync,
  }), [isOnline, pendingCount, isSyncing, lastSyncEvent, saveDeliveryTab, enqueueOffline, triggerSync]);

  return (
    <OfflineSyncContext.Provider value={value}>
      {children}
    </OfflineSyncContext.Provider>
  );
}

export function useOfflineSync(): OfflineSyncContextType {
  const ctx = useContext(OfflineSyncContext);
  if (!ctx) {
    throw new Error('useOfflineSync must be used within OfflineSyncProvider');
  }
  return ctx;
}

function capitalize(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

function isNetworkError(err: any): boolean {
  if (err?.name === 'AbortError') return true;
  if (err instanceof TypeError) return true; // fetch throws TypeError on network failure
  const msg = err?.message?.toLowerCase() || '';
  if (msg.includes('network request failed')) return true;
  if (msg.includes('network error')) return true;
  if (msg.includes('failed to fetch')) return true;
  if (msg.includes('timeout')) return true;
  if (msg.includes('econnrefused') || msg.includes('enotfound')) return true;
  if (msg.includes('unable to resolve host')) return true;
  if (msg.includes('no internet')) return true;
  if (msg.includes('socket') || msg.includes('connect')) return true;
  // Server errors (5xx) — treat as network-like (retryable)
  if (err?.status >= 500) return true;
  return false;
}
