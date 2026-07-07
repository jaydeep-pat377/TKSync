import {createMMKV} from 'react-native-mmkv';

const offlineStore = createMMKV({id: 'tksync-offline-queue'});

const QUEUE_KEY = 'pending_saves';
const QUEUE_COUNTER_KEY = 'queue_counter';
const CACHE_PREFIX = 'delivery_cache_';
const TICKETS_CACHE_KEY = 'tickets_cache';
const DETAIL_CACHE_PREFIX = 'detail_cache_';
const CURBLINE_CACHE_PREFIX = 'curbline_cache_';
const CURBLINE_INFO_PREFIX = 'curbline_info_';
const SIGNING_CACHE_PREFIX = 'signing_cache_';

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

    // Deduplicate: if there's already a pending save for same ticket+tab+action, replace it
    const effectiveAction = action || 'delivery';
    const existingIdx = queue.findIndex(
      item => item.ticketId === ticketId && item.tab === tab && (item.action || 'delivery') === effectiveAction,
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

  // ─── Tickets list cache ───

  cacheTickets(data: { tickets: any[]; dateFrom: string | null }): void {
    offlineStore.set(TICKETS_CACHE_KEY, JSON.stringify(data));
  },

  getCachedTickets(): { tickets: any[]; dateFrom: string | null } | null {
    const raw = offlineStore.getString(TICKETS_CACHE_KEY);
    if (!raw) return null;
    try {
      return JSON.parse(raw);
    } catch {
      return null;
    }
  },

  // ─── Ticket detail cache ───

  cacheTicketDetail(ticketId: number, detail: Record<string, any>): void {
    offlineStore.set(DETAIL_CACHE_PREFIX + ticketId, JSON.stringify(detail));
  },

  getCachedTicketDetail(ticketId: number): Record<string, any> | null {
    const raw = offlineStore.getString(DETAIL_CACHE_PREFIX + ticketId);
    if (!raw) return null;
    try {
      return JSON.parse(raw);
    } catch {
      return null;
    }
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

  /** Get pending saves for a specific ticket, optionally filtered by tab and action */
  getPendingForTicket(ticketId: number, tab?: string, action?: PendingSave['action']): PendingSave[] {
    return getQueue().filter(
      item => item.ticketId === ticketId && (!tab || item.tab === tab) && (!action || (item.action || 'delivery') === action),
    );
  },

  // ─── Curbline release cache ───

  cacheCurblineRelease(ticketId: number, data: {id: number; signed_name: string; signature_image: string; signed_at?: string}): void {
    offlineStore.set(CURBLINE_CACHE_PREFIX + ticketId, JSON.stringify(data));
  },

  getCachedCurblineRelease(ticketId: number): {id: number; signed_name: string; signature_image: string; signed_at?: string} | null {
    const raw = offlineStore.getString(CURBLINE_CACHE_PREFIX + ticketId);
    if (!raw) return null;
    try {
      return JSON.parse(raw);
    } catch {
      return null;
    }
  },

  cacheCurblineTicketInfo(ticketId: number, info: {customer_name: string; customer_code: string; project_name: string; project_code: string; order_code: string; ticket_code: string}): void {
    offlineStore.set(CURBLINE_INFO_PREFIX + ticketId, JSON.stringify(info));
  },

  getCachedCurblineTicketInfo(ticketId: number): {customer_name: string; customer_code: string; project_name: string; project_code: string; order_code: string; ticket_code: string} | null {
    const raw = offlineStore.getString(CURBLINE_INFO_PREFIX + ticketId);
    if (!raw) return null;
    try {
      return JSON.parse(raw);
    } catch {
      return null;
    }
  },

  // ─── Signing data cache (Accept / Dispute) ───

  cacheSigningData(ticketId: number, data: Record<string, any>): void {
    offlineStore.set(SIGNING_CACHE_PREFIX + ticketId, JSON.stringify(data));
  },

  getCachedSigningData(ticketId: number): Record<string, any> | null {
    const raw = offlineStore.getString(SIGNING_CACHE_PREFIX + ticketId);
    if (!raw) return null;
    try {
      return JSON.parse(raw);
    } catch {
      return null;
    }
  },
};
