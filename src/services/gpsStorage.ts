import {createMMKV} from 'react-native-mmkv';
import {captureError} from './sentry';

const gpsStore = createMMKV({id: 'tksync-gps'});

const RECORDS_KEY = 'gps_records';
const TRIP_SUMMARIES_KEY = 'trip_summaries';

export type GpsRecord = {
  id: string;
  ticket_id: number | null;
  latitude: number;
  longitude: number;
  speed: number | null;
  heading: number | null;
  altitude: number | null;
  accuracy: number | null;
  recorded_at: string;
  synced: boolean;
  battery_level?: number | null;
  // Behavior fields (per-point)
  is_speeding?: boolean;
  is_idle?: boolean;
  accel_x?: number | null;
  accel_y?: number | null;
  zone?: string | null;
};

export type TripSummary = {
  id: string;
  ticket_id: number | null;
  started_at: string;
  ended_at: string;
  total_distance_m: number;
  total_duration_s: number;
  max_speed_ms: number;
  avg_speed_ms: number;
  hard_brakes: number;
  hard_corners: number;
  total_idle_time_s: number;
  synced: boolean;
};

// ─── In-memory cache ─────────────────────────────────────────────
// Avoids full JSON parse/stringify on every GPS fix (~1/s).
// Cache is loaded lazily from MMKV on first access and flushed
// periodically or on important mutations (clear, import batch).
let cachedRecords: GpsRecord[] | null = null;
let cacheDirty = false;
let flushTimer: ReturnType<typeof setTimeout> | null = null;
const FLUSH_INTERVAL_MS = 5000; // Persist to MMKV every 5 seconds

function ensureCache(): GpsRecord[] {
  if (cachedRecords !== null) return cachedRecords;
  const raw = gpsStore.getString(RECORDS_KEY);
  if (!raw) {
    cachedRecords = [];
    return cachedRecords;
  }
  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) {
      console.error('[gpsStorage] Corrupted data: not an array, resetting');
      gpsStore.set(RECORDS_KEY, '[]');
      cachedRecords = [];
      return cachedRecords;
    }
    cachedRecords = parsed;
    return cachedRecords;
  } catch (err: any) {
    console.error('[gpsStorage] Corrupted JSON data, resetting:', err);
    captureError(err instanceof Error ? err : new Error(String(err)), {source: 'gps_storage_corruption'});
    gpsStore.set(RECORDS_KEY, '[]');
    cachedRecords = [];
    return cachedRecords;
  }
}

function markDirty() {
  cacheDirty = true;
  if (!flushTimer) {
    flushTimer = setTimeout(flushToStorage, FLUSH_INTERVAL_MS);
  }
}

function flushToStorage() {
  if (flushTimer) {
    clearTimeout(flushTimer);
    flushTimer = null;
  }
  if (!cacheDirty || cachedRecords === null) return;
  gpsStore.set(RECORDS_KEY, JSON.stringify(cachedRecords));
  cacheDirty = false;
}

/** Force immediate flush — call before app kill, logout, or import. */
function flushNow() {
  flushToStorage();
}

// 20,000 unsynced records ≈ 5.5 hours of continuous driving at 1 save/sec.
// Each record is ~200 bytes → 20,000 × 200 = ~4MB — fits easily in MMKV.
const MAX_UNSYNCED_RECORDS = 20000;
const TRIM_THRESHOLD = 1000; // Start trimming when total exceeds this

function trimRecords(records: GpsRecord[]): GpsRecord[] {
  if (records.length <= TRIM_THRESHOLD) return records;
  let unsynced = records.filter(r => !r.synced);
  const synced = records.filter(r => r.synced);
  if (unsynced.length > MAX_UNSYNCED_RECORDS) {
    unsynced = unsynced.slice(-MAX_UNSYNCED_RECORDS);
  }
  const recentSynced = synced.slice(-100);
  return [...recentSynced, ...unsynced];
}

function getTripSummaries(): TripSummary[] {
  const raw = gpsStore.getString(TRIP_SUMMARIES_KEY);
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) {
      console.error('[gpsStorage] Corrupted trip summaries data, resetting');
      gpsStore.set(TRIP_SUMMARIES_KEY, '[]');
      return [];
    }
    return parsed;
  } catch (err: any) {
    console.error('[gpsStorage] Corrupted trip summaries JSON, resetting:', err);
    captureError(err instanceof Error ? err : new Error(String(err)), {source: 'trip_summary_corruption'});
    gpsStore.set(TRIP_SUMMARIES_KEY, '[]');
    return [];
  }
}

function setTripSummaries(summaries: TripSummary[]): void {
  gpsStore.set(TRIP_SUMMARIES_KEY, JSON.stringify(summaries));
}

// Dedup set for fast importRecord lookups — avoids O(n) .some() scan on each import
let idSet: Set<string> | null = null;

function ensureIdSet(): Set<string> {
  if (idSet !== null) return idSet;
  idSet = new Set(ensureCache().map(r => r.id));
  return idSet;
}

function invalidateIdSet() {
  idSet = null;
}

export const gpsStorage = {
  /** Append a GPS fix. Returns the record ID.
   *  Writes to MMKV immediately to prevent data loss on sudden app kill. */
  addRecord(record: Omit<GpsRecord, 'id' | 'synced'>): string {
    const records = ensureCache();
    const id = `gps_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
    records.push({
      ...record,
      id,
      synced: false,
    });
    ensureIdSet().add(id);
    if (__DEV__) {
      console.log(`[GPS] #${records.length} | lat: ${record.latitude.toFixed(6)}, lng: ${record.longitude.toFixed(6)} | speed: ${record.speed?.toFixed(1) ?? '-'} m/s | accuracy: ${record.accuracy ?? '-'}m | ticket: ${record.ticket_id}`);
    }
    if (records.length > TRIM_THRESHOLD) {
      cachedRecords = trimRecords(records);
      invalidateIdSet();
    }
    // Flush immediately — GPS records must survive sudden app kill.
    // addRecord is called ~1/s when moving, MMKV writes are fast (~1ms).
    flushNow();
    return id;
  },

  /** Import a record with a specific ID (used for native background records).
   *  Skips if a record with the same ID already exists.
   *  Writes to MMKV immediately to prevent data loss. */
  importRecord(id: string, record: Omit<GpsRecord, 'id' | 'synced'>): boolean {
    const ids = ensureIdSet();
    if (ids.has(id)) return false;
    const records = ensureCache();
    records.push({...record, id, synced: false});
    ids.add(id);
    if (records.length > TRIM_THRESHOLD) {
      cachedRecords = trimRecords(records);
      invalidateIdSet();
    }
    // Flush immediately — imported records must survive before native clears them
    flushNow();
    return true;
  },

  /** Get all records not yet synced. */
  getUnsynced(): GpsRecord[] {
    return ensureCache().filter(r => !r.synced);
  },

  /** Mark records as synced after confirmed delivery. */
  markSynced(ids: string[]): void {
    const records = ensureCache();
    const toMark = new Set(ids);
    for (const r of records) {
      if (toMark.has(r.id)) {
        r.synced = true;
      }
    }
    markDirty();
  },

  getAll(): GpsRecord[] {
    return ensureCache();
  },

  getCount(): number {
    return ensureCache().length;
  },

  clear(): void {
    cachedRecords = [];
    cacheDirty = false;
    invalidateIdSet();
    if (flushTimer) { clearTimeout(flushTimer); flushTimer = null; }
    gpsStore.set(RECORDS_KEY, '[]');
    gpsStore.set(TRIP_SUMMARIES_KEY, '[]');
    gpsStore.remove('last_ticket_id');
  },

  /** Remove only synced records — keep unsynced for next login. */
  clearSynced(): void {
    cachedRecords = ensureCache().filter(r => !r.synced);
    invalidateIdSet();
    flushNow();
    const summaries = getTripSummaries().filter(s => !s.synced);
    setTripSummaries(summaries);
  },

  /** Force-flush the in-memory cache to MMKV (call before app kill / logout). */
  flush(): void {
    flushNow();
  },

  /** Save a trip summary when tracking stops. */
  addTripSummary(summary: Omit<TripSummary, 'id' | 'synced'>): void {
    const summaries = getTripSummaries();
    const id = `trip_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
    summaries.push({...summary, id, synced: false});
    setTripSummaries(summaries);
    console.log(`[GPS] Trip summary saved — distance: ${summary.total_distance_m.toFixed(0)}m, duration: ${summary.total_duration_s}s, brakes: ${summary.hard_brakes}, corners: ${summary.hard_corners}`);
  },

  /** Get unsynced trip summaries. */
  getUnsyncedTripSummaries(): TripSummary[] {
    return getTripSummaries().filter(s => !s.synced);
  },

  /** Mark trip summaries as synced. */
  markTripSummariesSynced(ids: string[]): void {
    const summaries = getTripSummaries();
    const idSet = new Set(ids);
    for (const s of summaries) {
      if (idSet.has(s.id)) {
        s.synced = true;
      }
    }
    setTripSummaries(summaries);
  },
};
