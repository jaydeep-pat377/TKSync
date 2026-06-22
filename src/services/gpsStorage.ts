import {createMMKV} from 'react-native-mmkv';

const gpsStore = createMMKV({id: 'tksync-gps'});

const RECORDS_KEY = 'gps_records';
const MAX_RECORDS = 50;

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
};

function getRecords(): GpsRecord[] {
  const raw = gpsStore.getString(RECORDS_KEY);
  if (!raw) return [];
  try {
    return JSON.parse(raw);
  } catch {
    return [];
  }
}

function setRecords(records: GpsRecord[]): void {
  gpsStore.set(RECORDS_KEY, JSON.stringify(records));
}

export const gpsStorage = {
  /** Append a GPS fix. Keeps only the last 50 records. */
  addRecord(record: Omit<GpsRecord, 'id' | 'synced'>): void {
    const records = getRecords();
    records.push({
      ...record,
      id: `gps_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
      synced: false,
    });
    // Trim oldest records beyond the cap
    if (records.length > MAX_RECORDS) {
      records.splice(0, records.length - MAX_RECORDS);
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
  },
};
