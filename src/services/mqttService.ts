import mqtt from 'mqtt';
import type {MqttClient, IClientOptions} from 'mqtt';
import {storage} from './storage';
import {trackingApi, type MqttTokenResponse} from './api';

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
      // Reconnect with new token
      disconnect();
      connect();
    }
  }, refreshMs);
}

export async function connect(): Promise<boolean> {
  if (client?.connected) return true;
  if (reconnecting) return false;

  reconnecting = true;
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
      client = mqtt.connect(mqttToken!.url, opts);

      client.on('connect', () => {
        console.log('[MQTT] Connected, topic:', mqttToken!.topic);
        reconnecting = false;
        scheduleTokenRefresh(mqttToken!.expiresIn);
        // On reconnect (not first connect), flush offline records
        if (hasConnectedBefore && onReconnectCallback) {
          console.log('[MQTT] Reconnected — flushing offline records');
          onReconnectCallback();
        }
        hasConnectedBefore = true;
        resolve(true);
      });

      client.on('error', (err) => {
        console.warn('[MQTT] Error:', err.message);
        reconnecting = false;
        resolve(false);
      });

      client.on('close', () => {
        console.log('[MQTT] Disconnected');
        reconnecting = false;
      });

      client.on('reconnect', () => {
        console.log('[MQTT] Reconnecting...');
      });

      // Timeout fallback
      setTimeout(() => {
        if (!client?.connected) {
          console.warn('[MQTT] Connection timeout');
          reconnecting = false;
          resolve(false);
        }
      }, 12000);
    } catch (err) {
      console.warn('[MQTT] Connect error:', err);
      reconnecting = false;
      resolve(false);
    }
  });
}

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
  console.log('[MQTT] Disconnected and cleaned up');
}

export function isConnected(): boolean {
  return client?.connected ?? false;
}

export function getTopic(): string | null {
  return mqttToken?.topic || getStoredToken()?.topic || null;
}

export function publish(payload: {
  latitude: number;
  longitude: number;
  speed: number | null;
  heading: number | null;
  accuracy: number | null;
  recorded_at: string;
  ticket_id: number | null;
  ticket_code: string | null;
  client_id: string;
}): boolean {
  const topic = getTopic();
  if (!client?.connected || !topic) {
    return false;
  }

  try {
    client.publish(topic, JSON.stringify(payload), {qos: 1});
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
};
