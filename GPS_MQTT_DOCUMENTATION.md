# GPS + MQTT — Complete Documentation

## Overview

GPS data is collected every **1 second** and published to MQTT in real-time. The system uses two mechanisms depending on app state:

- **Foreground**: JS `watchPosition` → JS MQTT (WebSocket)
- **Background**: Native `FusedLocationProviderClient` → Native Paho MQTT (TCP/WebSocket)
- **Killed**: Service stops. Records saved locally, published on next app open.

---

## App States — What Works and What Doesn't

### 1. FOREGROUND (App open and visible)

| Item | Detail |
|---|---|
| **GPS works?** | YES |
| **MQTT upload works?** | YES |
| GPS Source | JS `Geolocation.watchPosition()` |
| GPS Interval | **1 second** |
| Distance Filter | 3m to trigger callback, 5m to save/publish |
| MQTT Transport | JS `mqtt` npm package (WebSocket) |
| MQTT QoS | 1 (at least once) |
| Upload Delay | **0 seconds — real-time** |
| Native Service | Running but idle (`jsAlive=true`, native skips saving) |

---

### 2. BACKGROUND (App minimized / screen off)

| Item | Detail |
|---|---|
| **GPS works?** | YES |
| **MQTT upload works?** | YES |
| GPS Source | Native `FusedLocationProviderClient` (foreground service) |
| GPS Interval | **1 second** (normal) / **30 seconds** (idle mode) |
| Distance Filter | 5m minimum (scales with poor accuracy) |
| MQTT Transport | Native Eclipse Paho MQTT (Java TCP/WebSocket) |
| MQTT QoS | 1 (at least once) |
| Upload Delay | **0 seconds — real-time** |
| JS Bridge | Also emits to JS as fallback (server deduplicates by `client_id`) |

**When does idle mode activate?**
- 3 consecutive GPS fixes with speed < 1.0 m/s (3.6 km/h)
- GPS interval changes from 1 second → 30 seconds to save battery
- Resumes 1-second interval when movement detected (speed ≥ 1.0 m/s or moved > 50m)

---

### 3. APP KILLED (Swiped away from recent apps)

| Item | Detail |
|---|---|
| **GPS works?** | NO |
| **MQTT upload works?** | NO |
| What happens | Service flushes pending records to local storage, disconnects MQTT, stops |
| Data loss | **None** — all pending records saved to SharedPreferences before stopping |
| Recovery | On next app open, saved records are imported and published via MQTT |

---

### 4. APP KILLED → REOPENED

| Item | Detail |
|---|---|
| **GPS works?** | YES (after tracking starts) |
| **MQTT upload works?** | YES |
| What happens | `importNativeRecords()` loads saved records → `publishBackgroundRecords()` publishes them |
| Upload Delay | **Immediate catch-up** of all saved records, then real-time |

---

## Transitions

### Foreground → Background

| Step | Time | What happens |
|---|---|---|
| 1 | 0 ms | JS `watchPosition` stops |
| 2 | 0 ms | `setJsAlive(false)` — native takes over GPS |
| 3 | 0-1 sec | Native gets first GPS fix |
| 4 | 0-1 sec | Native Paho MQTT publishes |
| **GPS gap** | **0-1 second** | |
| **MQTT gap** | **0-1 second** | |

### Background → Foreground

| Step | Time | What happens |
|---|---|---|
| 1 | 0 ms | `setJsAlive(true)` — native stops saving |
| 2 | 0 ms | JS `watchPosition` resumes |
| 3 | 0-1 sec | JS gets first GPS fix |
| 4 | 0-1 sec | JS MQTT publishes |
| 5 | Async | Imports native records from background, publishes any unsynced |
| **GPS gap** | **0-1 second** | |
| **MQTT gap** | **0-1 second** | |

---

## Complete Timing Table

| State | GPS Active? | GPS Interval | MQTT Upload? | Upload Delay | Notes |
|---|---|---|---|---|---|
| Foreground — moving | YES | 1 sec | YES | Real-time | JS watchPosition → JS MQTT |
| Foreground — stationary | YES | 1 sec | NO | — | Drift blocked, one stop position saved |
| Background — moving | YES | 1 sec | YES | Real-time | Native GPS → Native MQTT |
| Background — idle | YES | 30 sec | YES | Real-time | Battery saver after 3 idle fixes |
| Background — stationary | YES | 30 sec | NO | — | Drift blocked |
| Foreground ↔ Background | — | — | — | 0-1 sec gap | Transition handoff |
| App killed | NO | — | NO | — | Records saved locally |
| App killed → reopened | YES | 1 sec | YES | Immediate catch-up | Saved records published first |

---

## GPS Filters (Applied Before MQTT Upload)

These filters run in both foreground (JS) and background (native):

| Filter | Condition | Result |
|---|---|---|
| Accuracy | > 100m | **Skipped** — GPS fix too inaccurate |
| Invalid coords | (0,0), NaN, out-of-range | **Skipped** — prevents Null Island / corrupt fixes |
| Teleportation | Implied speed > 80 m/s (288 km/h) | **Skipped** — prevents GPS jumps / multipath errors |
| Distance | < 5m from last save | **Skipped** — hasn't moved enough |
| Stationary drift | Speed < 1.0 m/s after first stop | **Blocked** — prevents fake movement while parked |
| Speed spike | < 3 consecutive moving fixes after stationary | **Blocked** — prevents single GPS spike |
| Mock GPS | Emulator/mocked position (dev only) | **Skipped** |

**Result**: MQTT only receives GPS data when the truck is **actually moving** and the fix is **accurate**.

---

## MQTT Connection Details

### JS MQTT (Foreground)

| Setting | Value |
|---|---|
| Library | `mqtt` npm package |
| Transport | WebSocket (`ws://` or `wss://`) |
| Auto-reconnect | Every **5 seconds** |
| Connect timeout | **10 seconds** |
| Keepalive | **60 seconds** |
| Token refresh | **5 minutes before expiry** |

### Native Paho MQTT (Background)

| Setting | Value |
|---|---|
| Library | Eclipse Paho `org.eclipse.paho.client.mqttv3:1.2.5` |
| Transport | TCP, TLS, or WebSocket (auto-detected from URL) |
| Auto-reconnect | Built-in (`isAutomaticReconnect = true`) |
| Manual reconnect | Every **30 seconds** cooldown |
| Connect timeout | **10 seconds** |
| Keepalive | **60 seconds** |

### Credential Sync

1. JS fetches MQTT token from API
2. JS connects to MQTT broker
3. JS syncs credentials to native via `setMqttCredentials()`
4. Native connects to same broker
5. Token refresh → JS reconnects → syncs new credentials to native → native reconnects

---

## MQTT Payload

Every GPS upload (foreground and background) sends:

```json
{
  "latitude": 40.712776,
  "longitude": -74.005974,
  "speed": 12.5,
  "heading": 270.0,
  "accuracy": 8.0,
  "recorded_at": "2026-08-07T12:30:00.000Z",
  "ticket_id": 12345,
  "ticket_code": "TC-001",
  "client_id": "native_1723034400000_a1b2c3d4"
}
```

`client_id` is unique per record — server uses it for deduplication.

---

## Idle Auto-Logout

| Event | Time |
|---|---|
| No movement (truck parked) | Timer starts |
| Warning notification | **1 hour 50 minutes** |
| Auto-logout | **2 hours** |
| Timer reset | Any GPS record saved (truck moved > 5m) |

---

## Stationary Drift Prevention

| Rule | Detail |
|---|---|
| Speed threshold | < 1.0 m/s (3.6 km/h) = stationary |
| First stop | Saves ONE position (where truck stopped) |
| All subsequent drift | **BLOCKED** until confirmed movement |
| Confirmed movement | 3 consecutive fixes with speed ≥ 1.0 m/s |
| Applies in | Both foreground (JS) and background (native) |

---

## File Locations

| Component | File |
|---|---|
| JS GPS Tracker | `src/services/backgroundGpsTracker.ts` |
| JS MQTT Service | `src/services/mqttService.ts` |
| JS GPS Sync Manager | `src/services/gpsSyncManager.ts` |
| Native GPS + MQTT Service | `android/.../LocationTrackingService.kt` |
| Native Module Bridge | `android/.../LocationTrackingModule.kt` |
| Foreground Service | `src/services/trackingForegroundService.ts` |
| GPS Local Storage | `src/services/gpsStorage.ts` |

---

## Summary

| Question | Answer |
|---|---|
| Does GPS work in foreground? | **YES** — every 1 second |
| Does GPS work in background? | **YES** — every 1 second (30 sec when idle) |
| Does GPS work when killed? | **NO** — saved locally, published on reopen |
| Does MQTT upload in foreground? | **YES** — real-time, 0 delay |
| Does MQTT upload in background? | **YES** — real-time, 0 delay |
| Does MQTT upload when killed? | **NO** — catch-up on reopen |
| Max transition gap? | **0-1 second** |
| Data loss possible? | **NO** — always saved locally as backup |
