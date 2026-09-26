import mqtt from 'mqtt';
import type {MqttClient, IClientOptions} from 'mqtt';
import {Platform, NativeModules} from 'react-native';
import {storage} from './storage';
import {trackingApi, type MqttTokenResponse} from './api';
import {captureError} from './sentry';
import {getForceOffline} from '../hooks/useNetworkStatus';

const {LocationTrackingModule} = NativeModules;

let client: MqttClient | null = null;
let mqttToken: MqttTokenResponse | null = null;
let refreshTimer: ReturnType<typeof setTimeout> | null = null;
let reconnecting = false;
let onReconnectCallback: (() => void) | null = null;
let hasConnectedBefore = false;

function getStoredToken(): MqttTokenResponse | null {
  const raw = storage.getString('mqtt_token');
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

async function fetchAndStoreToken(): Promise<MqttTokenResponse | null> {
  try {
    const res = await trackingApi.getMqttToken();
    if (res.data) {
      storage.set('mqtt_token', JSON.stringify(res.data));
      mqttToken = res.data;
      return res.data;
    }
  } catch (err: any) {
    console.warn('[MQTT] Token fetch failed:', err);
    captureError(err instanceof Error ? err : new Error(String(err)), {source: 'mqtt_token_fetch'});
  }
  return null;
}

function scheduleTokenRefresh(expiresIn: number) {
  if (refreshTimer) clearTimeout(refreshTimer);
  // Refresh 5 minutes before expiry
  const refreshMs = Math.max((expiresIn - 300) * 1000, 30000);
  refreshTimer = setTimeout(async () => {
    console.log('[MQTT] Refreshing token...');
    const newToken = await fetchAndStoreToken();
    if (newToken) {
      // Connect-then-disconnect: build the new client FIRST so there's no gap
      // where GPS records can't be published (old client stays live until new one is ready)
      const oldClient = client;
      client = null; // Allow connect() to proceed
      reconnecting = false; // Reset so connect() isn't blocked

      const connected = await connect();
      // Now tear down the old client — new one is already active
      if (oldClient) {
        try { oldClient.end(true); } catch {}
      }
      if (!connected) {
        console.warn('[MQTT] Token rotation: new connection failed, records will queue locally');
        captureError(new Error('MQTT token rotation: new connection failed'), {source: 'mqtt_token_rotation'});
      } else {
        console.log('[MQTT] Token rotation complete — seamless handoff');
      }
    }
  }, refreshMs);
}

export async function connect(): Promise<boolean> {
  if (client?.connected) return true;
  if (reconnecting) return false;

  reconnecting = true;

  // Tear down any existing non-connected client to prevent orphans.
  // The mqtt.js library fires 'close' before each reconnect, which resets
  // `reconnecting` to false. A second connect() call at that moment would
  // create a new client and orphan the old one (still reconnecting internally).
  if (client) {
    try { client.end(true); } catch {}
    client = null;
  }

  // Always fetch a fresh token on connect — the stored one may have expired
  // while the app was in background/killed. Fall back to stored token only
  // if the API call fails (e.g. offline).
  mqttToken = await fetchAndStoreToken() || getStoredToken();

  if (!mqttToken) {
    console.warn('[MQTT] No token available, cannot connect');
    reconnecting = false;
    return false;
  }

  return new Promise(resolve => {
    let resolved = false;
    const settle = (value: boolean) => {
      if (resolved) return;
      resolved = true;
      resolve(value);
    };

    const opts: IClientOptions = {
      username: mqttToken!.username,
      password: mqttToken!.token,
      clientId: `tksync_${mqttToken!.username}_${Date.now()}`,
      clean: true,
      reconnectPeriod: 5000,
      connectTimeout: 10000,
      protocolVersion: 4,
    };

    console.log(`[MQTT] Connecting to ${mqttToken!.url}...`);

    try {
      const newClient = mqtt.connect(mqttToken!.url, opts);

      newClient.on('connect', () => {
        // Guard: only process if this is still the active client
        if (client !== newClient) return;
        console.log('[MQTT] Connected, topic:', mqttToken!.topic);
        reconnecting = false;
        scheduleTokenRefresh(mqttToken!.expiresIn);
        syncCredentialsToNative();
        if (hasConnectedBefore && onReconnectCallback) {
          console.log('[MQTT] Reconnected — flushing offline records');
          onReconnectCallback();
        }
        hasConnectedBefore = true;
        settle(true);
      });

      newClient.on('error', (err) => {
        if (client !== newClient) return;
        console.warn('[MQTT] Error:', err.message);
        captureError(err instanceof Error ? err : new Error(String(err)), {source: 'mqtt_connection'});
        reconnecting = false;
        settle(false);
      });

      newClient.on('close', () => {
        if (client !== newClient) return;
        console.log('[MQTT] Disconnected');
        // Don't reset reconnecting here — the library's built-in reconnect
        // fires 'close' before each attempt, which would falsely clear the guard
        // and allow duplicate clients. Let 'connect' or 'error' clear it.
      });

      newClient.on('reconnect', () => {
        console.log('[MQTT] Reconnecting...');
      });

      client = newClient;

      // Timeout fallback — only kill client if it never connected
      setTimeout(() => {
        if (!resolved && client === newClient && !newClient.connected) {
          console.warn('[MQTT] Connection timeout — cleaning up stale client');
          captureError(new Error('MQTT connection timeout (12s)'), {source: 'mqtt_timeout'});
          try { newClient.end(true); } catch {}
          if (client === newClient) client = null;
          reconnecting = false;
          settle(false);
        }
      }, 12000);
    } catch (err: any) {
      console.warn('[MQTT] Connect error:', err);
      captureError(err instanceof Error ? err : new Error(String(err)), {source: 'mqtt_connect'});
      reconnecting = false;
      settle(false);
    }
  });
}

/** Pass MQTT credentials to native Android service for background publishing. */
function syncCredentialsToNative() {
  if (Platform.OS !== 'android' || !LocationTrackingModule || !mqttToken) return;
  LocationTrackingModule.setMqttCredentials(
    mqttToken.url,
    mqttToken.username,
    mqttToken.token,
    mqttToken.topic,
    currentTicketCode || '',
  ).catch(() => {});
  console.log('[MQTT] Credentials synced to native service');
}

/** Set ticket code for native MQTT payload. */
export function setTicketCode(code: string | null) {
  currentTicketCode = code;
}

let currentTicketCode: string | null = null;

export function disconnect() {
  if (refreshTimer) {
    clearTimeout(refreshTimer);
    refreshTimer = null;
  }
  if (client) {
    try {
      client.end(true);
    } catch {}
    client = null;
  }
  reconnecting = false;
  hasConnectedBefore = false;
  onReconnectCallback = null;
  // Clear native MQTT credentials on disconnect
  if (Platform.OS === 'android' && LocationTrackingModule) {
    LocationTrackingModule.clearMqttCredentials().catch(() => {});
  }
  console.log('[MQTT] Disconnected and cleaned up');
}

export function isConnected(): boolean {
  return client?.connected ?? false;
}

/** Force-reset connection state so connect() isn't blocked by a stale reconnecting guard.
 *  Call before connect() on foreground resume — JS may have been frozen mid-reconnect. */
export function resetConnectionState() {
  reconnecting = false;
  if (client && !client.connected) {
    try { client.end(true); } catch {}
    client = null;
  }
}

export function getTopic(): string | null {
  return mqttToken?.topic || getStoredToken()?.topic || null;
}

type GpsPayload = {
  latitude: number;
  longitude: number;
  speed: number | null;
  heading: number | null;
  accuracy: number | null;
  recorded_at: string;
  ticket_id: number | null;
  ticket_code: string | null;
  client_id: string;
  battery_level: number | null;
  /** Set automatically by publish() — see BACKFILL_AFTER_MS. */
  backfill?: boolean;
};

/**
 * A point older than this when it reaches the broker was not captured live: it
 * sat in the offline queue. The server writes it into route history as normal
 * but skips the "current position" update, so the live marker does not walk
 * backwards through the backlog while it drains.
 *
 * One age check here covers every call site — live foreground, the native
 * bridge and the catch-up flush all go through publish().
 */
const BACKFILL_AFTER_MS = 60_000;

/** Last value published, so the [CHECK] line fires on change rather than per point. */
let lastBackfillState: boolean | null = null;
let forceOfflineAnnounced = false;

/**
 * Publish a GPS payload via MQTT.
 * Returns true if the message was accepted by the client (not yet ACKed by broker).
 * Use onDelivered callback to know when the broker has confirmed receipt (QoS 1 ACK).
 */
export function publish(
  payload: GpsPayload,
  onDelivered?: (err: Error | null) => void,
): boolean {
  // The DEV "Force Offline" toggle used to gate only REST, so GPS kept flowing
  // over MQTT and offline tests silently passed. Honour it here too.
  if (getForceOffline()) {
    if (!forceOfflineAnnounced) {
      forceOfflineAnnounced = true;
      console.log('[CHECK] Force Offline is ON — MQTT publish blocked, records queue locally');
    }
    return false;
  }
  if (forceOfflineAnnounced) {
    forceOfflineAnnounced = false;
    console.log('[CHECK] Force Offline is OFF — MQTT publish resumed');
  }

  const topic = getTopic();
  if (!client?.connected || !topic) {
    return false;
  }

  const recordedAt = Date.parse(payload.recorded_at);
  const isBackfill =
    Number.isFinite(recordedAt) && Date.now() - recordedAt > BACKFILL_AFTER_MS;
  const body: GpsPayload = {...payload, backfill: isBackfill};

  // One line per transition, not per point — at 1 Hz a per-point log is noise.
  // [CHECK] lines exist to make an on-device E2E run verifiable from logcat.
  if (isBackfill !== lastBackfillState) {
    lastBackfillState = isBackfill;
    const ageS = Math.round((Date.now() - recordedAt) / 1000);
    console.log(
      `[CHECK] backfill=${isBackfill} (record is ${ageS}s old, threshold ${
        BACKFILL_AFTER_MS / 1000
      }s)`,
    );
  }

  try {
    client.publish(topic, JSON.stringify(body), {qos: 1}, (err) => {
      if (onDelivered) onDelivered(err ?? null);
    });
    return true;
  } catch (err: any) {
    console.warn('[MQTT] Publish error:', err);
    captureError(err instanceof Error ? err : new Error(String(err)), {source: 'mqtt_publish'});
    return false;
  }
}

export type PresencePayload =
  | {status: 'offline'; since: string}
  | {
      status: 'online';
      backfill_count: number;
      backfill_from: string;
      backfill_to: string;
    };

/**
 * Tell the dashboard the truck went quiet, and how much is about to arrive.
 *
 * Without this the dashboard infers an outage from silence ("last signal 41 min
 * ago") — it cannot know when the truck is back or how many backlog points are
 * coming, so it cannot mark the gap boundaries or prepare for the flush.
 *
 * Best-effort by design: never block or delay GPS publishing for it. The offline
 * message in particular often will not make it out, because by the time NetInfo
 * reports the drop the socket may already be gone. That is fine — the dashboard
 * still has silence to fall back on, and the online message carries the window.
 *
 * Topic comes from the MQTT token, which grants pub on .../presence alongside
 * .../gps.
 */
export function publishPresence(payload: PresencePayload): boolean {
  if (getForceOffline()) return false;
  const topic = getTopic();
  if (!client?.connected || !topic) return false;

  const presenceTopic = topic.replace(/\/gps$/, '/presence');
  if (presenceTopic === topic) {
    // The ACL grants pub on .../presence alongside .../gps. If the GPS topic is
    // not shaped as expected the derived topic is wrong and the broker will
    // reject it, so surface this rather than publishing into the void.
    console.warn('[CHECK] FAIL presence — unexpected topic shape:', topic);
    captureError(new Error(`Unexpected MQTT topic shape: ${topic}`), {
      source: 'mqtt_presence_topic',
    });
    return false;
  }

  try {
    client.publish(presenceTopic, JSON.stringify(payload), {qos: 1});
    console.log(`[CHECK] presence ${payload.status} -> ${presenceTopic} ${JSON.stringify(payload)}`);
    return true;
  } catch (err: any) {
    console.warn('[MQTT] Presence publish error:', err?.message);
    captureError(err instanceof Error ? err : new Error(String(err)), {
      source: 'mqtt_presence',
      status: payload.status,
    });
    return false;
  }
}

export function setOnReconnect(cb: (() => void) | null) {
  onReconnectCallback = cb;
}

export const mqttService = {
  connect,
  disconnect,
  isConnected,
  resetConnectionState,
  publish,
  publishPresence,
  getTopic,
  fetchAndStoreToken,
  setOnReconnect,
  setTicketCode,
};
