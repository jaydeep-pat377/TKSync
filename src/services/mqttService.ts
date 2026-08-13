import mqtt from 'mqtt';
import type {MqttClient, IClientOptions} from 'mqtt';
import {Platform, NativeModules} from 'react-native';
import {storage} from './storage';
import {trackingApi, type MqttTokenResponse} from './api';

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
  } catch (err) {
    console.warn('[MQTT] Token fetch failed:', err);
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

  mqttToken = getStoredToken();

  if (!mqttToken) {
    mqttToken = await fetchAndStoreToken();
  }

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
          try { newClient.end(true); } catch {}
          if (client === newClient) client = null;
          reconnecting = false;
          settle(false);
        }
      }, 12000);
    } catch (err) {
      console.warn('[MQTT] Connect error:', err);
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
};

/**
 * Publish a GPS payload via MQTT.
 * Returns true if the message was accepted by the client (not yet ACKed by broker).
 * Use onDelivered callback to know when the broker has confirmed receipt (QoS 1 ACK).
 */
export function publish(
  payload: GpsPayload,
  onDelivered?: (err: Error | null) => void,
): boolean {
  const topic = getTopic();
  if (!client?.connected || !topic) {
    return false;
  }

  try {
    client.publish(topic, JSON.stringify(payload), {qos: 1}, (err) => {
      if (onDelivered) onDelivered(err ?? null);
    });
    return true;
  } catch (err) {
    console.warn('[MQTT] Publish error:', err);
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
  publish,
  getTopic,
  fetchAndStoreToken,
  setOnReconnect,
  setTicketCode,
};
