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
const FIELD_DEFS_CACHE_KEY = 'field_definitions_cache';

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

    // Deduplicate: if there's already a pending save for same ticket+tab+action, MERGE bodies
    const effectiveAction = action || 'delivery';
    const existingIdx = queue.findIndex(
      item => item.ticketId === ticketId && item.tab === tab && (item.action || 'delivery') === effectiveAction,
    );

    if (existingIdx >= 0) {
      // Merge new body into existing entry (preserves previously saved fields)
      const existing = queue[existingIdx];
      existing.body = {...existing.body, ...body};
      existing.createdAt = new Date().toISOString();
      existing.retryCount = 0;
      console.log(
        `[OfflineStorage] Merged into existing entry for ticket ${ticketId}/${tab}:`,
        Object.keys(existing.body).join(', '),
      );
    } else {
      const entry: PendingSave = {
        id: nextId(),
        ticketId,
        tab,
        action: action || 'delivery',
        body,
        createdAt: new Date().toISOString(),
        retryCount: 0,
      };
      queue.push(entry);
    }

    setQueue(queue);
    const result = existingIdx >= 0 ? queue[existingIdx] : queue[queue.length - 1];
    console.log(
      `[OfflineStorage] Enqueued save: ticket ${ticketId}/${tab} (${queue.length} pending)`,
    );
    return result;
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
    // For time tab: also update steps array so UI reflects saved values
    if (tab === 'time' && cached[tab]?.steps) {
      cached[tab].steps = cached[tab].steps.map((s: any) => {
        if (body[s.key]) {
          // Extract HH:mm directly — don't use getHours() which converts +00:00 to local timezone
          const match = String(body[s.key]).match(/T(\d{2}):(\d{2})/);
          const time_local = match ? `${match[1]}:${match[2]}` : '--';
          return {...s, done: true, time: body[s.key], time_local};
        }
        return s;
      });
    }
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

  // ─── Field definitions cache (persists across tickets) ───

  cacheFieldDefinitions(fd: Record<string, any>): void {
    offlineStore.set(FIELD_DEFS_CACHE_KEY, JSON.stringify(fd));
  },

  getCachedFieldDefinitions(): Record<string, any> | null {
    const raw = offlineStore.getString(FIELD_DEFS_CACHE_KEY);
    if (!raw) return null;
    try {
      return JSON.parse(raw);
    } catch {
      return null;
    }
  },

  /** Wipe all offline data — queue, caches, field definitions. Called on full logout. */
  clearAll(): void {
    offlineStore.clearAll();
  },
};
