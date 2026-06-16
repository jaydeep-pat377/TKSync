import React, {
  createContext,
  useContext,
  useEffect,
  useState,
  useCallback,
  useRef,
} from 'react';
import {useNetworkStatus} from '../hooks/useNetworkStatus';
import {syncManager, SyncEvent} from '../services/syncManager';
import {offlineStorage} from '../services/offlineStorage';
import {ticketsApi} from '../services/api';

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
  /** Manually trigger sync */
  triggerSync: () => void;
};

const OfflineSyncContext = createContext<OfflineSyncContextType | null>(null);

export function OfflineSyncProvider({children}: {children: React.ReactNode}) {
  const {isOnline} = useNetworkStatus();
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

    const unsub = syncManager.addListener((event: SyncEvent) => {
      setLastSyncEvent(event);

      switch (event.type) {
        case 'sync_start':
          setIsSyncing(true);
          break;
        case 'sync_complete':
          setIsSyncing(false);
          setPendingCount(offlineStorage.getPendingCount());
          break;
        case 'queue_changed':
          setPendingCount(event.count);
          break;
        case 'item_synced':
          setPendingCount(event.remaining);
          break;
      }
    });

    return () => {
      unsub();
      syncManager.destroy();
    };
  }, []);

  const saveDeliveryTab = useCallback(
    async (
      ticketId: number,
      tab: string,
      body: Record<string, any>,
    ): Promise<{success: boolean; message: string; offline: boolean}> => {
      if (isOnline) {
        try {
          await ticketsApi.saveDeliveryTab(ticketId, tab, body);
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

      // Offline or network error — queue locally
      offlineStorage.enqueue(ticketId, tab, body);
      setPendingCount(offlineStorage.getPendingCount());
      return {
        success: true,
        message: `${capitalize(tab)} data saved offline. It will sync when connection is restored.`,
        offline: true,
      };
    },
    [isOnline],
  );

  const triggerSync = useCallback(() => {
    syncManager.sync();
  }, []);

  return (
    <OfflineSyncContext.Provider
      value={{
        isOnline,
        pendingCount,
        isSyncing,
        lastSyncEvent,
        saveDeliveryTab,
        triggerSync,
      }}>
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
  if (err instanceof TypeError && err.message === 'Network request failed') {
    return true;
  }
  return err?.message?.includes('Network request failed') ?? false;
}
