# Where location leaves the app — and what the backend needs to check

**As of:** 2026-09-29 · **Branch:** `Fix-GPS-issue`
**For:** the TKSync backend team
**Verified by:** reading every call site in `src/services/` and `android/app/src/main/java/com/tksync/location/`, not from memory.

---

## 1. Short answer

Coordinates leave the phone through **three code paths**, reaching **two destinations**.

| # | Path | Destination | Rate | Who sends |
|---|---|---|---|---|
| 1 | `mqttService.publish()` | MQTT topic `.../gps` | ~1 Hz while driving | JS, app in foreground |
| 2 | `publishToMqtt()` / `replayOfflineRecords()` | MQTT topic `.../gps` | 1 Hz driving, 10 s idle | Native service, app backgrounded or killed |
| 3 | `heartbeatApi.ping(position)` | `POST /tracking/heartbeat` | every 30 s | JS only |

Paths 1 and 2 are the same topic and the same payload shape. They are mutually exclusive — the `js_alive` flag plus a 30 s heartbeat decides which one is recording, so they do not both publish.

**Path 3 is the one worth your attention.** It is a second, independent writer of "where the truck is", on a different transport, and we do not know what you do with it. See section 4.

---

## 2. The payload

Identical on paths 1 and 2:

```json
{
  "latitude": 22.2855,
  "longitude": 70.7785,
  "speed": 3.4,
  "heading": 118.0,
  "accuracy": 8.0,
  "recorded_at": "2026-09-29T12:41:07.000Z",
  "ticket_id": 901037,
  "ticket_code": "TK-770-0912",
  "client_id": "gps_1759142467000_a3f9k",
  "battery_level": 62,
  "backfill": false
}
```

- `recorded_at` — UTC, millisecond precision, **capture time not send time**. This is the field that matters for ordering.
- `client_id` — unique per record, stable across retries. Your dedupe key.
- `ticket_id` / `ticket_code` — stamped at capture, never read live at publish time, so a backlog flushing after the driver moves to a new load does not land on the wrong ticket.
- `backfill` — true when the record is over 60 s old at send time. You confirmed nothing reads it. We kept it.

Path 3 sends the same fields minus `ticket_id`, `ticket_code`, `client_id` and `backfill`.

---

## 3. Every endpoint, and whether it carries coordinates

### Sends coordinates to you

| Endpoint / topic | Method | Notes |
|---|---|---|
| MQTT `.../gps` | publish, QoS 1 | The main path. Both JS and native. |
| `/tracking/heartbeat` | POST | Carries the newest stored position, every 30 s |

### Receives coordinates from you (read-only)

| Endpoint | Method | Used by |
|---|---|---|
| `/tracking/gps-history?date=` | GET | Trip History screen |
| `/tickets/{id}/gps` | GET | Per-ticket route replay |

### Carries no coordinates

| Endpoint / topic | Why it looks relevant but isn't |
|---|---|
| `/tracking/trip-summary` | POST — distances, durations, brake and corner counts only |
| `/tracking/mqtt-token` | POST — credentials. Called from JS and from the native service directly |
| `/auth/refresh-token` | POST — called by the native service when the MQTT token refresh returns 401 |
| `/tracking/me` | GET — current load, for stamping `ticket_id` |
| MQTT `.../presence` | Outage window boundaries, no position |

There is **no REST path that uploads GPS points**. `gpsApi` is used only for trip summaries. MQTT is the sole delivery route for positions, which is worth knowing: if the broker or its auth breaks, records accumulate locally to 20 000 and then the oldest are dropped.

---

## 4. Answered by the backend, 29 Sep

> **All resolved.** Kept for the record; the answers are in the table below and
> the remaining actions are noted inline.
>
> | Question | Answer |
> |---|---|
> | Heartbeat changes the truck's location? | No — last seen and battery only |
> | Server rejects older points? | Yes, live position only moves forward |
> | Live position expires? | Yes, after 3 hours |
> | Driver signed in on two phones? | Yes, nothing blocks it |
> | Second login logs out the first? | No |
> | FCM token replace or add? | Adds, one per phone |
> | MQTT token tied to one phone? | No, truck and driver only |
> | Two phones publish for one truck? | Yes |
>
> Agreed: `device_id` on GPS points (**done, shipped**), one login per driver
> (**backend will implement**).

### 4.1 What does `/tracking/heartbeat` do with the position? — ANSWERED: nothing

Last seen and battery only. No second writer, so the race described below cannot
happen. The newest-by-`recorded_at` fix stays in anyway, since it costs nothing
and the position is still sent.

It fires every 30 s with the newest stored position, independently of MQTT. If it feeds the same live-position store that `gps-consumer` writes, then you have **two writers on one value over two transports with no shared ordering**, and they can fight: MQTT publishes a fresh point, then a heartbeat 20 s later carries a slightly older one, and the marker moves backwards.

Tell us which of these is true:

- It only updates a "last seen" timestamp for the GPS online/offline badge → nothing to do.
- It also updates the live position → we should either stop sending the position on it, or you should apply the same newest-wins rule you apply in `gps-consumer`.

We already fixed one defect here: the heartbeat was picking the **last appended** record rather than the newest by `recorded_at`. Native background records are imported on foreground resume and land at the end of the array despite being captured earlier, so the heartbeat could report the truck back where it used to be. It now picks by `recorded_at`.

### 4.2 Does `gps-consumer` compare `recorded_at`? — ANSWERED: yes

You told us the live pipeline keeps one position per truck and drops anything older. Our whole oldest-first backlog fix depends on that being a real comparison rather than a plain overwrite. Please confirm.

If it is a plain overwrite, the ordering fix still helps, but a late duplicate could still move the marker backwards.

### 4.3 Does anything expire a truck's Redis position? — ANSWERED: yes, 3 hours

If a phone stops publishing, does its last position linger forever? A TTL would let the map show "no GPS" instead of a stale marker that looks live.

### 4.4 Concurrent sessions — ANSWERED: unrestricted today

From the earlier report, unanswered:

1. Does `POST /auth/driver-login` allow a second concurrent session?
2. Does a second login fire `force_logout` at the first device?
3. Does `registerDevice(fcm_token, platform)` replace or append when two devices share one driver?
4. Does `POST /tracking/mqtt-token` bind a token to a device or session?
5. Does the broker allow two simultaneous publishers on one topic?

The payload carries no `device_id`, so today you cannot attribute a point to a phone or cut one off without cutting both.

### 4.5 `device_id` — AGREED, now shipped

Adding `device_id` to the payload. We need the field name, whether it also belongs on the HTTP routes, and whether `gps-consumer` should ignore points from any device other than the most recently authenticated one.

---

## 5. What we changed on the app side

Nothing below is proven on a device — the test phone has not been on ADB, so **none of this was in the build your 29 Sep live test ran on**. All of it compiles and passes tests.

### 5.1 Backlog goes out oldest first, live points wait

`gps-consumer` keeps one position per truck and drops older ones, so a live point published ahead of the backlog made every replayed point stale on arrival and the map drew a straight line across the gap. Both sides now sort the backlog by `recorded_at` and hold new live fixes until it drains.

Bounded so it cannot backfire: the hold expires after 60 s, applies only when the backlog is genuinely old, and one flush sends at most 500 records so a large backlog can still be acknowledged inside the delivery window.

### 5.2 Position jumps the speed cannot explain are dropped

The trail grew 40-50 m spurs at junctions. The accuracy gate admits 25 m, re-opening to 50 m after 10 rejections — which is exactly what a junction ringed with buildings produces — and the only outlier guard was a 288 km/h teleport check, which at 1 Hz permits an 80 m jump.

GPS speed is Doppler-derived and does not suffer multipath the way position does, so a fix whose implied speed exceeds the reported speed by more than 10 m/s is now dropped. The stationary-drift confirm distance also scales with accuracy now, `max(15 m, accuracy x 1.5)`, instead of a flat 15 m that sat below the gate's own error bar.

### 5.3 The 53-158 s silences from your live test

Your 29 Sep report. **This was a latch, not battery saving.**

The "has it moved far enough to be real?" distance check existed only in the moving branch. A fix below 0.5 m/s was discarded without the distance ever being looked at, and the moving counter was zeroed on every dip. In stop-start traffic the instantaneous speed oscillates across that line, so the counter ran 1, 0, 1, 0 and never confirmed. A truck 133 m from where it stopped stayed suppressed.

Your own figures confirm it: 68-133 m over 53-158 s is 2-8 km/h, straddling the threshold.

Five fixes, against your three asks:

| Your ask | What we did |
|---|---|
| Fast updates the moment movement resumes | Distance escape hatch in the slow branch; the counter no longer hard-resets; native leaves 10 s idle polling at the same moment; the JS poll no longer accepts a 3 s old cached fix that still reports the old speed |
| A point every 10-15 s even while stopped | A 15 s stationary heartbeat. It republishes the **stop anchor**, not the drifting fix, so it cannot redraw the spurs from 5.2. It only fires when something is happening — over 5 m of drift or 0.2 m/s — so a genuinely parked truck stays silent, which you said is wanted |
| Check battery optimisation / Doze | `getDiagnostics()` now reports `battery_optimized`, so this is answerable from a Sentry event rather than guessed. The app already requests the exemption at login. It was not the cause here |

### 5.4 Native MQTT defects found while auditing

- `isCurrentlyUploading` was never assigned, so the guard against JS and native flushing at once was dead code
- Replay marked records synced on `publish()` queue rather than QoS 1 delivery — a process kill before the acknowledgement lost the point from both sides
- A rotated MQTT token never reached the native client, because `connectMqtt()` no-ops while connected
- `mqttClient` was assigned after `connect()`, so `connectComplete` could fire first and skip the replay entirely
- `setSilentMode` wiped idle mode
- A `setManualAcks(false)` call commented as disabling auto-reconnect, which it does not do

### 5.5 Session leaks

A logged-out phone could keep publishing. `clearMqttCredentials()` deleted the stored credentials but never disconnected the running Paho client, which holds them in memory and auto-reconnects. Native API tokens were written at login and never removed. `autoResume()` published leftover GPS on every app start with no login check. All three fixed.

Two devices signed into one account still both publish while both are signed in. That needs 4.4 and 4.5 above.

### 5.6 Reboot

Android 14 refuses to let a `location` foreground service start from `BOOT_COMPLETED`, and the throw was being swallowed — so after a reboot the driver silently stopped sending GPS until they reopened the app. The phone now shows a "GPS tracking paused" notification that resumes tracking in one tap, and records a `boot_restart_blocked` diagnostic.

---

## 6. How to test this together

Install the build, then repeat the truck 744 run: offline for a few minutes, drive, reconnect.

Expected: the saved points stream onto the live map **in order** as the phone uploads them, and your catch-up fallback becomes a safety net rather than the thing doing the work.

Also worth watching in the same run, since they are all in this build:

- no 40-50 m spurs at the junctions
- no silence over 15 s once the truck starts moving again
- long parked gaps unchanged

Logcat lines to grep for, all prefixed `[CHECK]`:

```
[CHECK] order oldest→newest: <first> → <last>
[CHECK] live fix held — backlog flushing, publishes in time order
[CHECK] crawl confirmed — 22m from stop at 0.3 m/s, resuming full rate
[CHECK] stationary heartbeat — parked position resent, next in 15s
[GPS] Skipping unexplained jump: 45m in 1.0s = 45.0 m/s, but speed reads 3.0 m/s
```

---

## 7. Status

| | |
|---|---|
| Kotlin | `gradlew compileDebugKotlin` BUILD SUCCESSFUL |
| Types | `tsc --noEmit` exit 0 |
| Lint | 0 errors |
| Tests | 254 passing, 13 suites |
| On a device | **Not yet.** Test phone is off ADB |
| On GitHub | **Not yet.** `dfaldu387` has no write access to `jaydeep-pat377/TKSync` |
