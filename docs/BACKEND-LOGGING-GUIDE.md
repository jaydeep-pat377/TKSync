# What to log on the backend to test the GPS fixes

**As of:** 2026-09-29 · **For:** the TKSync backend team
**Why this exists:** the test phone is off ADB, so we cannot yet prove the app fixes on the road. Everything below can be proved from your side alone, from logs.

All values are read from the code, not remembered.

---

## 1. The two things to instrument

| | Transport | Where to log |
|---|---|---|
| **A** | MQTT publish on `.../gps` | Broker, and `gps-consumer` on message receipt |
| **B** | `POST /api/tracking/heartbeat` | Your HTTP layer |

Nothing else the app sends carries coordinates. Full list in [LOCATION-API-PATHS.md](LOCATION-API-PATHS.md).

---

## 2. Path A — MQTT

### Connection

Credentials come from `POST /api/tracking/mqtt-token`, which returns:

```json
{ "url": "...", "username": "...", "token": "...", "topic": "...", "expiresIn": 3600 }
```

The app connects with **clean session, QoS 1**, and a client ID that tells you which side of the app is publishing:

| Client ID pattern | Who | When |
|---|---|---|
| `tksync_{username}_{epochMs}` | JS | App in foreground |
| `tksync_native_{username}_{epochMs}` | Native Android service | App backgrounded or killed |

**Log the client ID on every connect and every publish.** It is the single most useful field you can add — it answers "which code path sent this", "did both publish at once", and "are two phones connected" in one go.

The native side converts the URL scheme before connecting: `mqtt://` → `tcp://`, `mqtts://` → `ssl://`. `ws://` and `wss://` pass through.

### Payload

Exactly this shape, from both JS and native:

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
  "backfill": false,
  "device_id": "9f4c2ab17e33d0c5"
}
```

`device_id` is stable for the life of the install — ANDROID_ID on Android, identifierForVendor on iOS — resolved once, persisted, and pushed down to the native service so the foreground and background publishers always report the same value. Two phones on one driver give two different values.

`recorded_at` is **capture time, not send time**, UTC with milliseconds. `client_id` is unique per record and stable across retries — use it as the dedupe key and as the join key across your logs.

Record ID prefixes also identify the origin:

| `client_id` prefix | Origin |
|---|---|
| `gps_` | JS `gpsStorage.addRecord()` |
| `native_` | Android service |

### Minimum useful log line

On every message `gps-consumer` receives:

```
truck=<code> mqtt_client_id=<connection id> client_id=<record id>
recorded_at=<iso> received_at=<iso> lag_ms=<received-recorded>
lat=<..> lng=<..> speed=<..> accuracy=<..> backfill=<bool>
accepted=<bool> reject_reason=<older_than_redis|dup|none>
```

`accepted` and `reject_reason` are the two fields that make everything below provable. Without them we cannot tell "the app did not send it" from "you received it and dropped it".

---

## 3. Path B — heartbeat

```
POST https://tksync.dev-build.in/api/tracking/heartbeat
Content-Type: application/json
Authorization: Bearer <driver access_token>
```

Body (the position is optional — absent when no GPS record exists yet):

```json
{
  "latitude": 22.2855,
  "longitude": 70.7785,
  "speed": 3.4,
  "heading": 118.0,
  "accuracy": 8.0,
  "recorded_at": "2026-09-29T12:41:07.000Z",
  "battery_level": 62
}
```

Fires every **30 s** from JS only. 30 s request timeout, failures swallowed.

**Log whether you write this position anywhere.** This is the open question from the previous report: if the heartbeat updates the same live position that `gps-consumer` writes, you have two writers on two transports with no shared ordering, and they can fight.

---

## 4. Proving each fix from your logs

Everything here is checkable server-side, without the phone.

### 4.1 Backlog goes out oldest first

**Scenario:** driver goes offline a few minutes, drives, reconnects.

**What to look for:** at reconnect, a burst of messages from one client ID where `recorded_at` increases monotonically, and every one has `backfill: true`. No live point should appear in the middle of the burst.

```
PASS  recorded_at strictly increasing across the burst, accepted=true throughout
FAIL  a recent recorded_at in the middle, then older ones rejected as older_than_redis
```

The old behaviour was the FAIL line — a live point jumped the queue and made the rest stale on arrival.

Also watch for a `.../presence` message just before the burst:

```json
{ "status": "online", "backfill_count": 312,
  "backfill_from": "...", "backfill_to": "..." }
```

`backfill_count` tells you how many to expect. If you receive fewer, the difference is real loss and we want to know.

### 4.2 No more 40-50 m spurs at junctions

**What to look for:** two consecutive accepted points from the same truck where the distance between them, divided by the time between them, far exceeds the `speed` field on the second point.

```
suspicious when  haversine(prev, this) / (this.recorded_at - prev.recorded_at) > this.speed + 10
```

That is exactly the rule the app now applies before sending. After the fix, this should be **zero occurrences**. Any hit means the filter did not run — most likely an old build.

### 4.3 The 53-158 s silences

**What to look for:** gap between consecutive `recorded_at` values for one truck, paired with the distance covered.

```
PASS  no gap over 20 s while the distance covered implies the truck was moving
FAIL  a gap over 30 s with 50 m+ of movement across it
```

Your 29 Sep table is the FAIL case: 53-158 s gaps covering 68-133 m.

**Long gaps with no movement are expected and correct.** A parked truck stays silent on purpose.

### 4.4 The 15 s stationary heartbeat

While the truck is stopped but something is still happening, a point goes out every 15 s carrying the **stop anchor**, not the drifting fix.

**How to recognise it:** `speed` is exactly `0`, and `latitude`/`longitude` are byte-identical to an earlier point, but `recorded_at` is new.

> If you would rather identify these explicitly, we can add `is_idle: true` to the MQTT payload — the field already exists on the stored record, it is just not published today. One line on our side. Say the word and we will add it before the next build.

### 4.5 Records marked sent but never delivered

We fixed the native side marking a record synced on queue rather than on QoS 1 acknowledgement.

**What to look for:** compare `backfill_count` from the presence message against the number of records you actually receive in the burst. They should match. A shortfall that survives the fix is real loss.

### 4.6 Two devices on one account

**What to look for:** two distinct MQTT client IDs connected to the same topic at the same time, with the same `username`.

Every point now carries `device_id`, so you can attribute a point to a phone directly. The MQTT client ID remains useful alongside it because it also tells you *which half of the app* published (JS vs native).

---

## 5. What we want back from a test run

Pick one truck, one shift. For that truck:

1. Every MQTT publish with the fields in section 2.
2. Every `accepted=false` with its `reject_reason`.
3. Every `/tracking/heartbeat` POST with its body and what you did with it.
4. The connected MQTT client IDs across the run.

That is enough to settle all six checks above and to answer whether the heartbeat is a second writer.

---

## 6. Answered — no longer open

The backend confirmed, 29 Sep:

| Question | Answer | What it means for us |
|---|---|---|
| Does the heartbeat change the truck's location? | No — last seen and battery only | No second writer. The race we were worried about does not exist |
| Does the server reject older points? | Yes, the live position only moves forward | The oldest-first backlog fix works as designed |
| Does the live position expire? | Yes, after 3 hours | Stale markers time out |
| Can a driver be signed in on two phones? | Yes, nothing blocks it | The two-phone problem is real |
| Does a second login log out the first? | No | Nothing mitigates it today |
| FCM token: replace or add? | Adds, one per phone | `force_logout` would reach both |
| Is the MQTT token tied to one phone? | No, only truck and driver | Cannot revoke one phone alone |
| Can two phones publish for one truck? | Yes | Confirmed |

Agreed and now shipped on our side: **`device_id` on every GPS point** (section 2).
Agreed on theirs: **one login per driver**.

---

## 7. Status of the app side

| | |
|---|---|
| Kotlin | `gradlew compileDebugKotlin` BUILD SUCCESSFUL |
| Types | `tsc --noEmit` exit 0 |
| Lint | 0 errors |
| Tests | 254 passing, 13 suites |
| On a device | **Not yet** — test phone off ADB |
| On GitHub | **Not yet** — no write access to `jaydeep-pat377/TKSync` |

The 29 Sep live test ran on the old build. None of these fixes were in it.
