import {createMMKV} from 'react-native-mmkv';

const offlineStore = createMMKV({id: 'tksync-offline-queue'});

const QUEUE_KEY = 'pending_saves';
const QUEUE_COUNTER_KEY = 'queue_counter';
const CACHE_PREFIX = 'delivery_cache_';

export type PendingSave = {
  id: string;
  ticketId: number;
  tab: string;
  action?: 'delivery' | 'sign' | 'dispute' | 'curbline-release';
  body: Record<string, any>;
  createdAt: string;
  retryCount: number;
  lastError?: string;
};

function getQueue(): PendingSave[] {
  const raw = offlineStore.getString(QUEUE_KEY);
  if (!raw) return [];
  try {
    return JSON.parse(raw);
  } catch {
    return [];
  }
}

function setQueue(queue: PendingSave[]): void {
  offlineStore.set(QUEUE_KEY, JSON.stringify(queue));
}

function nextId(): string {
  const counter = (offlineStore.getNumber(QUEUE_COUNTER_KEY) ?? 0) + 1;
  offlineStore.set(QUEUE_COUNTER_KEY, counter);
  return `save_${counter}_${Date.now()}`;
}

export const offlineStorage = {
  enqueue(ticketId: number, tab: string, body: Record<string, any>, action?: PendingSave['action']): PendingSave {
    const queue = getQueue();

    // Deduplicate: if there's already a pending save for same ticket+tab, replace it
    const existingIdx = queue.findIndex(
      item => item.ticketId === ticketId && item.tab === tab,
    );

    const entry: PendingSave = {
      id: nextId(),
      ticketId,
      tab,
      action: action || 'delivery',
      body,
      createdAt: new Date().toISOString(),
      retryCount: 0,
    };

    if (existingIdx >= 0) {
      console.log(
        `[OfflineStorage] Replacing existing entry for ticket ${ticketId}/${tab}`,
      );
      queue[existingIdx] = entry;
    } else {
      queue.push(entry);
    }

    setQueue(queue);
    console.log(
      `[OfflineStorage] Enqueued save: ticket ${ticketId}/${tab} (${queue.length} pending)`,
    );
    return entry;
  },

  dequeue(id: string): void {
    const queue = getQueue().filter(item => item.id !== id);
    setQueue(queue);
  },

  updateRetry(id: string, error: string): void {
    const queue = getQueue();
    const item = queue.find(i => i.id === id);
    if (item) {
      item.retryCount += 1;
      item.lastError = error;
      setQueue(queue);
    }
  },

  getAll(): PendingSave[] {
    return getQueue();
  },

  getPendingCount(): number {
    return getQueue().length;
  },

  clear(): void {
    offlineStore.set(QUEUE_KEY, '[]');
  },

  hasPending(): boolean {
    return getQueue().length > 0;
  },

  // ─── Local delivery record cache ───

  cacheDeliveryRecord(ticketId: number, record: Record<string, any>): void {
    offlineStore.set(CACHE_PREFIX + ticketId, JSON.stringify(record));
  },

  getCachedDeliveryRecord(ticketId: number): Record<string, any> | null {
    const raw = offlineStore.getString(CACHE_PREFIX + ticketId);
    if (!raw) return null;
    try {
      return JSON.parse(raw);
    } catch {
      return null;
    }
  },

  /** Merge a saved tab body into the cached record */
  updateCachedTab(ticketId: number, tab: string, body: Record<string, any>): void {
    const cached = this.getCachedDeliveryRecord(ticketId);
    if (!cached) {
      // No cache yet — create a minimal one with just this tab
      this.cacheDeliveryRecord(ticketId, {[tab]: {...body}});
      return;
    }
    cached[tab] = {...(cached[tab] || {}), ...body};
    this.cacheDeliveryRecord(ticketId, cached);
  },

  /** Get pending saves for a specific ticket, optionally filtered by tab */
  getPendingForTicket(ticketId: number, tab?: string): PendingSave[] {
    return getQueue().filter(
      item => item.ticketId === ticketId && (!tab || item.tab === tab),
    );
  },
};
