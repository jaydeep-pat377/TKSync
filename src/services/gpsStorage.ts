import {createMMKV} from 'react-native-mmkv';

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

function getRecords(): GpsRecord[] {
  const raw = gpsStore.getString(RECORDS_KEY);
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) {
      console.error('[gpsStorage] Corrupted data: not an array, resetting');
      gpsStore.set(RECORDS_KEY, '[]');
      return [];
    }
    return parsed;
  } catch (err) {
    console.error('[gpsStorage] Corrupted JSON data, resetting:', err);
    gpsStore.set(RECORDS_KEY, '[]');
    return [];
  }
}

function setRecords(records: GpsRecord[]): void {
  gpsStore.set(RECORDS_KEY, JSON.stringify(records));
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
  } catch (err) {
    console.error('[gpsStorage] Corrupted trip summaries JSON, resetting:', err);
    gpsStore.set(TRIP_SUMMARIES_KEY, '[]');
    return [];
  }
}

function setTripSummaries(summaries: TripSummary[]): void {
  gpsStore.set(TRIP_SUMMARIES_KEY, JSON.stringify(summaries));
}

export const gpsStorage = {
  /** Append a GPS fix. Keeps only the last 500 unsynced + trims synced. */
  addRecord(record: Omit<GpsRecord, 'id' | 'synced'>): void {
    let records = getRecords();
    const id = `gps_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
    records.push({
      ...record,
      id,
      synced: false,
    });
    if (__DEV__) {
      console.log(`[GPS] #${records.length} | lat: ${record.latitude.toFixed(6)}, lng: ${record.longitude.toFixed(6)} | speed: ${record.speed?.toFixed(1) ?? '-'} m/s | accuracy: ${record.accuracy ?? '-'}m | ticket: ${record.ticket_id}`);
    }
    // Remove synced records to prevent unbounded growth
    // Keep all unsynced + most recent 100 synced (for dedup reference)
    if (records.length > 600) {
      const unsynced = records.filter(r => !r.synced);
      const synced = records.filter(r => r.synced);
      // Keep latest 100 synced records for dedup
      const recentSynced = synced.slice(-100);
      records = [...recentSynced, ...unsynced];
    }
    setRecords(records);
  },

  /** Get all records not yet synced to the API. */
  getUnsynced(): GpsRecord[] {
    return getRecords().filter(r => !r.synced);
  },

  /** Mark records as synced after successful API call. */
  markSynced(ids: string[]): void {
    const records = getRecords();
    const idSet = new Set(ids);
    for (const r of records) {
      if (idSet.has(r.id)) {
        r.synced = true;
      }
    }
    setRecords(records);
  },

  getAll(): GpsRecord[] {
    return getRecords();
  },

  getCount(): number {
    return getRecords().length;
  },

  clear(): void {
    gpsStore.set(RECORDS_KEY, '[]');
    gpsStore.set(TRIP_SUMMARIES_KEY, '[]');
  },

  /** Remove only synced records — keep unsynced for next login. */
  clearSynced(): void {
    const records = getRecords().filter(r => !r.synced);
    setRecords(records);
    const summaries = getTripSummaries().filter(s => !s.synced);
    setTripSummaries(summaries);
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
