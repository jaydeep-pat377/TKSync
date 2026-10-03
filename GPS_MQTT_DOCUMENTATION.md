# GPS + MQTT — Complete Documentation

Last verified against the code on 2026-09-25. Every number below was read out of
the source, not remembered — if you change a constant, change it here too.

## Overview

GPS is collected roughly every second and published to MQTT as it is captured.
Which half of the app does the work depends on app state:

- **Foreground**: JS `watchPosition` → JS MQTT (WebSocket)
- **Background**: Native `FusedLocationProviderClient` → Native Paho MQTT
- **Killed**: the native service **keeps running** and keeps publishing

That last line used to say "Service stops. Records saved locally, published on
next app open." That was never what the code did — `stopWithTask="false"` and
`onTaskRemoved()` deliberately keep the service alive through a swipe — and the
belief cost a lot of debugging time. See **App killed** below for what is real,
including the part that genuinely is unreliable.

---

## App States — What Works and What Doesn't

### 1. FOREGROUND (app open and visible)

| Item | Detail |
|---|---|
| **GPS works?** | YES |
| **MQTT upload works?** | YES |
| GPS source | JS `Geolocation.watchPosition()` |
| GPS interval | 1 second |
| Distance filter | 3 m to trigger the callback, then the save filter below |
| MQTT transport | `mqtt` npm package (WebSocket) |
| MQTT QoS | 1 (at least once) |
| Upload delay | Real-time |
| Native service | Running but idle (`jsAlive=true`, native skips saving) |

### 2. BACKGROUND (app minimized / screen off)

| Item | Detail |
|---|---|
| **GPS works?** | YES |
| **MQTT upload works?** | YES |
| GPS source | Native `FusedLocationProviderClient` (foreground service) |
| GPS interval | 1 second normally, 10 seconds in idle mode |
| MQTT transport | Eclipse Paho (Java, TCP/TLS/WebSocket) |
| MQTT QoS | 1 |
| Upload delay | Real-time |
| JS bridge | Also emits to JS as a fallback; the server dedupes on `client_id` |

**Idle mode** activates after `IDLE_CONSECUTIVE_THRESHOLD = 2` consecutive fixes
below `IDLE_SPEED_THRESHOLD = 0.5 m/s` (1.8 km/h). It resumes full rate on
movement or once the truck is `IDLE_DISTANCE_THRESHOLD = 50 m` from where it
stopped.

### 3. APP KILLED (swiped away from recents)

| Item | Detail |
|---|---|
| **GPS works?** | YES — usually. See the caveat. |
| **MQTT upload works?** | YES |
| What happens | `onTaskRemoved()` keeps the service alive; it does NOT call `stopSelf()` and does NOT clear `KEY_ACTIVE` |
| Manifest | `android:stopWithTask="false"`, `foregroundServiceType="location"` |
| `onStartCommand` | Returns `START_STICKY` |
| Data loss | None in the normal case — records go to SharedPreferences and publish as they are captured |

**The caveat, measured on a real device.** Two runs of the same `am crash` gave
opposite outcomes:

- 17:26:17 — `Scheduling restart ... for start-requested`, recording again in
  100 ms, then `MQTT replayed 3/3 offline records`.
- 17:18:43 — no restart line at all. GPS silently dead while
  `tracking_active` stayed `true`.

`START_STICKY` does not reliably restore a foreground service after the process
itself is killed (OEM task killers, memory pressure). The app cannot currently
recover on its own: `isActive()` returns the persisted flag rather than
liveness, so a "restart if the service died" check always passes. That is what
`detectBackgroundServiceDeath()` in `src/services/gpsDiagnostics.ts` reports to
Sentry. An AlarmManager/WorkManager watchdog is the real fix and is not built.

### 4. APP KILLED → REOPENED

| Item | Detail |
|---|---|
| **GPS works?** | YES |
| **MQTT upload works?** | YES |
| What happens | `importNativeRecords()` loads anything the native side saved but could not publish, then `publishBackgroundRecords()` flushes it |
| Upload delay | Immediate catch-up, then real-time |

---

## Offline and catch-up

While there is no network the phone keeps recording into local storage and
publishes nothing. On reconnect the backlog flushes.

**Replay is not gated on `reconnect`.** `MqttCallbackExtended.connectComplete`
receives `reconnect=false` every time `ensureMqttConnected()` builds a fresh
client, which it does every 30 s while JS is dead. Replay used to sit behind
`if (reconnect)`, so a killed app collected GPS for the whole shift and never
sent a single point. Do not put that condition back.

**The backlog goes out oldest first, ahead of any live point.** `gps-consumer`
keeps ONE position per truck in Redis and drops anything older than what it
already holds. If a fresh live point is published first, every older backlog
point is rejected for the live map and the dispatch map draws only the jump.
So both sides sort the backlog by `recorded_at` before publishing, and hold new
live fixes back until it has drained — the held record is already in local
storage, so it is a delay, not a drop. Timescale stores the points either way;
this only affects the live view.

| Side | Where |
|---|---|
| JS | `publishBackgroundRecords()` sorts; `deferLivePublish()` holds |
| Native | `replayOfflineRecords()` sorts; `publishToMqtt()` returns while `replaying` |

Native replays in up to `MAX_REPLAY_PASSES` passes, so fixes recorded while the
backlog drains are swept up by the next pass instead of waiting for the next
reconnect. JS does the same via the `publishQueued` re-run.

**Suppression cannot latch, and it cannot go quiet.** Drift suppression holds a
fix back until movement is confirmed. Two guards stop that becoming a silence:

- A fix beyond `max(15 m, accuracy x 1.5)` from the stop clears suppression on
  distance alone, whatever the reported speed is. Without this, a stop-start
  crawl straddling `IDLE_SPEED_THRESHOLD` zeroed the moving counter on every dip
  and never confirmed — measured at up to 158 s of silence over 90 m of driving.
- While suppressed and something is still happening (over 5 m of drift or
  0.2 m/s), the stop anchor is republished every `STATIONARY_HEARTBEAT_MS`
  (15 s). The anchor, not the live fix: the live fix is inside the drift band
  being suppressed. A truly parked truck stays silent on purpose.

**Backfilled points are flagged.** Any record whose `recorded_at` is more than
60 s old when it reaches the broker is published with `backfill: true`. The
server writes it into route history as normal but skips the "current position"
update, so the live marker does not walk backwards through the backlog while it
drains. The rule lives in exactly two places and they must agree:

| Side | Where |
|---|---|
| JS | `mqttService.publish()` — `BACKFILL_AFTER_MS` |
| Native | `LocationTrackingService.isBackfill()` — `BACKFILL_AFTER_MS` |

**Presence.** On losing connectivity the app publishes
`{status: "offline", since}` and on reconnect, just before the flush,
`{status: "online", backfill_count, backfill_from, backfill_to}` — so the
dashboard knows the gap's boundaries and how much is about to arrive instead of
inferring an outage from silence. Topic is the GPS topic with `/gps` replaced by
`/presence`. Best-effort: it never blocks or delays GPS publishing, and the
offline message often does not make it out because the socket is already gone.

---

## GPS Filters (applied before MQTT upload)

These run in both foreground (JS) and background (native) and are kept in sync
by hand.

| Filter | Condition | Result |
|---|---|---|
| Mock GPS | Emulator/mocked position (`__DEV__` only, JS side) | Skipped |
| Accuracy | Worse than the current gate — see below | Skipped |
| Invalid coords | (0,0), NaN, out of range | Skipped |
| Teleportation | Implied speed > 80 m/s (288 km/h) over a gap under 60 s | Skipped |
| Stationary drift | Speed < 0.5 m/s after the first stop | Blocked |
| Movement confirm | Fewer than 2 consecutive moving fixes | Blocked |
| Distance | Less than the minimum below from the last saved point | Skipped |

**The accuracy gate is a ratchet, not a fixed 100 m.**

| Phase | Limit |
|---|---|
| First 30 s after the first good fix (`WARMUP_MS`) | 50 m (`INITIAL_ACCURACY`) |
| After warm-up | 25 m (`STRICT_ACCURACY`) |

Once it tightens to 25 m it used to stay there for the life of the service, so a
truck in a tunnel, a parking structure or downtown had every fix dropped with no
way back. After `ACCURACY_REWARMUP_REJECTS = 10` consecutive rejections the gate
re-opens to 50 m (`firstGoodFixTime` is reset) and logs
`accuracy_gate_rewarmed`.

**Minimum distance to save** is 5 m normally. When accuracy is worse than 15 m it
scales to `max(10 m, accuracy × 0.75)` so a poor fix cannot fake movement. The
first stop record is exempt — where the truck stopped matters even if it is
under 5 m from the last driving point.

---

## MQTT Connection Details

### JS MQTT (foreground)

| Setting | Value |
|---|---|
| Library | `mqtt` npm package |
| Transport | WebSocket (`ws://` / `wss://`) |
| Auto-reconnect | Every 5 s |
| Connect timeout | 10 s |
| Keepalive | 60 s |
| Token refresh | 5 minutes before expiry |

### Native Paho MQTT (background)

| Setting | Value |
|---|---|
| Library | `org.eclipse.paho.client.mqttv3:1.2.5` |
| Transport | TCP, TLS or WebSocket (from the URL) |
| Auto-reconnect | `isAutomaticReconnect = true` |
| Manual reconnect | 30 s cooldown (`MQTT_RECONNECT_COOLDOWN_MS`) |
| Connect timeout | 10 s |
| Keepalive | 60 s |
| Replay batch | 20 records, then a pause (`REPLAY_BATCH_SIZE`) |
| Token refresh | Proactive at 55 min (`MQTT_TOKEN_REFRESH_AFTER_MS`) |

The MQTT token lives one hour. The native side refreshes it at 55 minutes
without needing JS, which is what lets a killed app stay connected across a long
shift. Verified live at 19:02:36–19:02:42: proactive refresh → 401 → access
token refresh → MQTT token refresh → reconnect, entirely native, app killed.

### Credential sync

1. JS fetches the MQTT token from the API
2. JS connects to the broker
3. JS syncs credentials to native via `setMqttCredentials()`
4. Native connects to the same broker
5. On refresh: JS reconnects → syncs the new credentials → native reconnects

---

## MQTT Payload

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
  "client_id": "native_1723034400000_a1b2c3d4",
  "battery_level": 47,
  "backfill": false
}
```

`client_id` is unique per record and is what the server dedupes on.
`battery_level` is the level **at capture time**, not at publish time, so it
stays accurate through a replay. `backfill` is described above.

> `ticket_id` must be a number. `/tracking/me` returns `current_load.id` as a
> string, which broke both the native bridge and the numeric MMKV cache and left
> GPS points attached to no ticket. `toTicketId()` in `gpsSyncManager.ts` is the
> single coercion point — use it.

---

## Diagnostics

The native service keeps a ring buffer of up to `MAX_DIAG_EVENTS = 100` events
in SharedPreferences (`recordDiag()`), which JS drains to Sentry on resume and
on AppState `active`. None of this is visible in logcat once the app is killed,
which is the whole point.

A watchdog latches one alert per episode:

| Alert | Trigger |
|---|---|
| `gps_stalled` | No fix for 120 s (`GPS_STALL_MS`) |
| `mqtt_down` | Saving but not publishing for 5 min (`MQTT_DOWN_MS`) |
| `backlog_growing` | 500 records stranded on disk (`BACKLOG_ALERT`) |

---

## Idle Auto-Logout

| Event | Time |
|---|---|
| No movement (truck parked) | Timer starts |
| Warning notification | 1 h 50 min |
| Auto-logout | 2 h |
| Timer reset | Any GPS record saved |

---

## File Locations

| Component | File |
|---|---|
| JS GPS tracker | `src/services/backgroundGpsTracker.ts` |
| JS MQTT service | `src/services/mqttService.ts` |
| JS GPS sync manager | `src/services/gpsSyncManager.ts` |
| GPS diagnostics → Sentry | `src/services/gpsDiagnostics.ts` |
| Native GPS + MQTT service | `android/.../location/LocationTrackingService.kt` |
| Native module bridge | `android/.../location/LocationTrackingModule.kt` |
| Foreground service control | `src/services/trackingForegroundService.ts` |
| GPS local storage | `src/services/gpsStorage.ts` |
| Location permission level | `src/services/locationPermission.ts` |

---

## Summary

| Question | Answer |
|---|---|
| Does GPS work in the foreground? | Yes — about every second |
| Does GPS work in the background? | Yes — every second, 10 s when idle |
| Does GPS work when killed? | Yes, and it publishes — but the service does not always survive a process kill |
| Does MQTT upload in the foreground? | Yes, real-time |
| Does MQTT upload in the background? | Yes, real-time |
| Does MQTT upload when killed? | Yes — replay is no longer gated on `reconnect` |
| Does tracking resume after a reboot? | Not by itself on Android 14+. The OS refuses to let a `location` foreground service start from `BOOT_COMPLETED`, so `BootReceiver` posts a "GPS tracking paused" notification and one tap resumes it. Older Android restarts silently as before. |
| Max transition gap? | 0–1 second |
| Data loss possible? | Yes, in one case: the process is killed and `START_STICKY` does not bring the service back. Sentry reports it; nothing restarts it. |
