import {createMMKV} from 'react-native-mmkv';

const gpsStore = createMMKV({id: 'tksync-gps'});

const RECORDS_KEY = 'gps_records';


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
    const unsynced = records.filter(r => !r.synced);
    if (records.length > 600) {
      records = unsynced;
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
