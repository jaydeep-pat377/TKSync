# TKSync app — everything changed on the mobile side

**Branch:** `Fix-GPS-issue` · **Base:** `e229af8` · **As of:** 2026-09-29
**Scope:** 76 files · 3 commits + uncommitted work
**Status:** all checks green — `tsc` clean, `eslint` clean, jest 254/254, `gradlew compileDebugKotlin` BUILD SUCCESSFUL
**Not pushed.** Nothing has been sent to GitHub.

---

## Contents

1. [Offline GPS — the straight-line bug](#1-offline-gps--the-straight-line-bug)
2. [GPS accuracy — the spurs off the route](#2-gps-accuracy--the-spurs-off-the-route)
2b. [Long silences when a stopped truck drives off](#2b-long-silences-when-a-stopped-truck-drives-off)
3. [Native MQTT — six defects found while auditing](#3-native-mqtt--six-defects-found-while-auditing)
4. [Reboot — tracking never came back on Android 14+](#4-reboot--tracking-never-came-back-on-android-14)
5. [Session leaks — logged-out phone kept publishing](#5-session-leaks--logged-out-phone-kept-publishing)
6. [Backfill flag and presence messages](#6-backfill-flag-and-presence-messages)
7. [Release hardening](#7-release-hardening)
8. [Permissions — background location](#8-permissions--background-location)
9. [Code health — types, lint, tests, CI](#9-code-health--types-lint-tests-ci)
10. [Two real bugs found by fixing the types](#10-two-real-bugs-found-by-fixing-the-types)
11. [Documentation](#11-documentation)
12. [Full file list](#12-full-file-list)
13. [Still open](#13-still-open)

---

## 1. Offline GPS — the straight-line bug

**Symptom.** Truck goes through a dead zone. On reconnect the dispatch map draws a straight line across the gap instead of the road actually driven.

**Cause.** `gps-consumer` keeps one position per truck in Redis and drops anything older than what it already holds. The phone was flushing its backlog in storage order, and any new live fix that went out first made the entire backlog stale on arrival — every replayed point was rejected for the live map, so only the jump showed.

**Fix.** Both sides now sort the backlog by `recorded_at` and hold new live fixes until it drains.

| Side | Sorts | Holds live fixes |
|---|---|---|
| JS | `publishBackgroundRecords()` | `deferLivePublish()` |
| Native | `replayOfflineRecords()` | `publishToMqtt()` while `replaying` |

**Files:** `src/services/backgroundGpsTracker.ts`, `android/.../LocationTrackingService.kt`

**Safety limits added with it**

- `MAX_LIVE_HOLD_MS = 60_000` — the hold expires after 60 s, so a stalled broker can never freeze the live marker. Only applies when the oldest backlog record is genuinely over 60 s old; a steady-state flush of one or two fresh points is not held.
- `MAX_FLUSH_BATCH = 500` — one flush sends at most 500 records. 20 000 publishes cannot be acknowledged inside the 15 s delivery window, so nothing got marked synced and the next flush sent the same 20 000 again. `publishQueued` carries the remainder, still in order.
- Native replays in up to `MAX_REPLAY_PASSES = 5` passes, so fixes recorded during the drain are swept up rather than waiting for the next reconnect.

**New log lines**

```
[CHECK] flush 312 of 312 records — 310 backfill, 2 live
[CHECK] order oldest→newest: 2026-09-29T09:12:04.000Z → 2026-09-29T09:41:57.000Z
[CHECK] live fix held — backlog flushing, publishes in time order
[CHECK] PASS catch-up — all 312 records confirmed by broker
```

**Tests:** `__tests__/gpsFlushOrder.test.ts` — 7 tests covering sort order, storage-order independence, a live fix arriving mid-flush, held-fix delivery, empty backlog, and unparseable timestamps.

---

## 2. GPS accuracy — the spurs off the route

**Symptom.** At junctions the trail leaves the road, hooks 40–50 m out and rejoins. Clearest at the Raiya Road / Dr. Yagnik Road turn on truck 773.

**Cause.** Three things line up at exactly that spot:

1. The accuracy gate admits 25 m normally, and **re-opens to 50 m** after `ACCURACY_REWARMUP_REJECTS = 10` consecutive rejections — which is precisely what a junction ringed with buildings produces. The gate is widest where GPS is worst.
2. The only outlier guard was a 288 km/h teleport check. At 1 Hz that permits an **80 metre jump** unchallenged.
3. The stationary-drift confirm was a flat 15 m — **below** the 25–50 m the gate admits, so ordinary drift counted as real movement.

**Fix — corroborate position against speed.** GPS speed comes from Doppler shift, not from differencing two positions, so it does not suffer multipath. A fix is dropped when its implied speed exceeds the reported speed by more than `MAX_UNEXPLAINED_SPEED = 10 m/s`, over gaps under 10 s so a legitimate background gap is never judged.

| Situation | Before | After |
|---|---|---|
| 45 m hop while crawling at 3 m/s | accepted | **dropped** |
| 14 m/s city driving | accepted | accepted |
| 30 m/s highway | accepted | accepted |
| Device reporting 0 m/s while creeping at 8 m/s | accepted | accepted |
| Long gap after a background stretch | accepted | not judged |

**Fix — drift confirm scales with accuracy.** Now `max(15 m, accuracy × 1.5)`. A 50 m-accurate fix needs 75 m of movement to count as real.

Both filters are duplicated in JS and Kotlin and **must stay identical**, otherwise the trail changes shape depending on whether the app was in the foreground. Noted in both files.

**Files:** `src/services/backgroundGpsTracker.ts`, `android/.../LocationTrackingService.kt`
**Tests:** `__tests__/gpsUnexplainedJump.test.ts` — 10 tests.
**New log line:** `[GPS] Skipping unexplained jump: 45m in 1.0s = 45.0 m/s, but speed reads 3.0 m/s (accuracy 38m)`

---

## 2b. Long silences when a stopped truck drives off

**Symptom.** Live test 2026-09-29, trucks 770 and 581, 17:04-18:20 IST. After the truck had been stopped or crawling, the app went quiet for 53-158 s while the truck covered 68-133 m. The map showed it parked, then jumped ahead.

| No update from | Until | Gap | Moved | Speed before |
|---|---|---|---|---|
| 17:56:52 | 17:57:56 | 63 s | 72 m | 0 km/h |
| 17:59:56 | 18:00:50 | 54 s | 124 m | 1 km/h |
| 18:05:11 | 18:06:04 | 53 s | 68 m | 1 km/h |
| 18:07:28 | 18:10:06 | 158 s | 90 m | 2 km/h |
| 18:13:57 | 18:15:30 | 93 s | 133 m | 0 km/h |

**Cause — a latch, not battery saving.** The "has it moved far enough to be real?" distance check existed only in the *moving* branch of the stationary-drift logic. A fix below `IDLE_SPEED_THRESHOLD` (0.5 m/s, 1.8 km/h) was discarded without the distance ever being looked at, and `consecutiveMovingCount` was zeroed on every dip.

In stop-start traffic the instantaneous speed oscillates across that line, so the counter ran 1, 0, 1, 0 and never reached `MOVING_CONFIRM_THRESHOLD`. The escape hatch was unreachable. A truck 133 m from where it stopped stayed suppressed.

The gap averages confirm it: 68-133 m over 53-158 s is 2-8 km/h. Crawling, straddling the threshold — exactly the case that latches.

**Fix 1 — distance escape hatch in the slow branch.** A truck beyond `max(15 m, accuracy x 1.5)` from where it stopped has moved, whatever the speedometer says. Suppression clears and the fix is saved. Native also leaves 10 s idle polling at the same moment, so the next fix is 1 s away rather than 10.

**Fix 2 — the counter no longer hard-resets.** `SLOW_FIXES_TO_RESET = 2`: it takes two consecutive slow fixes to zero the moving counter, so one dip no longer wipes the progress.

**Fix 3 — a stationary heartbeat.** `STATIONARY_HEARTBEAT_MS = 15_000`. While suppressed, a point goes out at least every 15 s, so the map is never more than 15 s stale. Two deliberate limits:

- It publishes the **stop anchor**, not the fix that triggered it. That fix is inside the drift band being suppressed, and sending it would redraw the spurs section 2 removed.
- It only fires when something is happening — over `HEARTBEAT_MIN_DRIFT` (5 m) of drift or `HEARTBEAT_MIN_SPEED` (0.2 m/s). A genuinely parked truck stays silent, which is the behaviour the dashboard already relies on and which the backend confirmed is wanted.

**Fix 4 — faster resume out of the JS poll.** The stationary poll asked for a fix up to 3 s old. A cached fix reports the speed it had when taken, so it could report 0 after the truck had set off. `maximumAge` is now 0.

**Fix 5 — battery state is now reported.** `getDiagnostics()` includes `battery_optimized`, so "is Doze throttling us?" is answerable from a Sentry event instead of guessed. The app already requests the exemption at login via `REQUEST_IGNORE_BATTERY_OPTIMIZATIONS`.

**On the backend's three asks**

| Ask | Status |
|---|---|
| Fast updates the moment movement is detected | Fixes 1, 2 and 4 |
| A point every 10-15 s even while stopped | Fix 3, at 15 s |
| Check battery optimisation / Doze | Fix 5 reports it; not the cause here |

**Files:** `src/services/backgroundGpsTracker.ts`, `android/.../LocationTrackingService.kt`
**Tests:** `__tests__/gpsCrawlResume.test.ts` — 6 tests, including all five gaps from the live test and the parked-stays-silent case.
**New log lines:** `[CHECK] crawl confirmed — 22m from stop at 0.3 m/s, resuming full rate` and `[CHECK] stationary heartbeat — parked position resent, next in 15s`

**Note on the live test.** Those gaps were recorded on the old build. None of this week's work was installed, since the test phone has not been on ADB. This was a pre-existing bug, and the accuracy work in section 2 did not cause it.

---

## 3. Native MQTT — six defects found while auditing

All in `android/.../LocationTrackingService.kt`.

### 3.1 `isCurrentlyUploading` was never set to `true`

Declared, exposed through `LocationTrackingModule.isUploading()`, polled by JS `waitForNativeUpload()` — and nothing ever assigned it. The whole guard against JS and native flushing at the same time was dead code. Now set around the replay thread, so a foreground resume mid-replay waits instead of starting a second, interleaved flush.

### 3.2 Records marked synced on *queue*, not *delivery* — silent GPS loss

`client.publish()` returning only means Paho accepted the message. With `MemoryPersistence`, a process kill before the QoS 1 acknowledgement drops it — and JS skips `synced` records on import, so the point was gone from both sides. Now waits for delivery confirmation per batch of 20 and only flags what actually landed.

### 3.3 Rotated MQTT token never reached native

JS rotates the token every 55 minutes and calls `setMqttCredentials`, which posted `connectMqtt()` — and `connectMqtt()` returns immediately if a client is connected. Native kept publishing with the old token until the broker rejected it twice. Now disconnects first.

### 3.4 `connectComplete` could fire before `mqttClient` was assigned

`mqttClient = client` ran *after* `client.connect()`. The Paho callback thread calls `replayOfflineRecords()`, which bails when `mqttClient` is null. Lost race meant the backlog silently waited for the next reconnect. Assignment moved before `connect()`.

### 3.5 `setSilentMode` wiped idle mode

Its restart intent carried `ticket_id` and `silent` but not `idle`, and `onStartCommand` reads that extra with a `false` default. Toggling silent turned idle off. Extra now carried through.

### 3.6 A comment that lied

`setManualAcks(false)` was commented as "disable auto-reconnect". It controls manual message acknowledgement and did nothing. Removed, comment corrected.

---

## 4. Reboot — tracking never came back on Android 14+

**Symptom.** Driver reboots the phone. GPS silently stops until they happen to reopen the app.

**Cause.** Android 14 does not allow a `location` foreground service to be started from `BOOT_COMPLETED`. Only `health`, `remoteMessaging`, `systemExempted`, `shortService`, `fileManagement` and `specialUse` are permitted. `BootReceiver` caught the resulting throw and logged it — so it failed silently on every modern device.

**Fix.** There is no way to make the start legal, so the app asks instead:

- On a refused start, `BootReceiver` posts an ongoing high-importance notification: *"GPS tracking paused — open TKSync to resume."* One tap opens the app and tracking restarts.
- Records a `boot_restart_blocked` diagnostic, which reaches Sentry on the next app open.
- `LocationTrackingService.onStartCommand` cancels the notification once tracking is genuinely running again.
- Android 13 and below: unchanged, silent restart exactly as before.

**Also guarded `startForeground()` itself.** An uncaught refusal there took the whole process down. It now records `start_foreground_refused` and stands down, leaving the notification as the way back.

**Files:** `android/.../BootReceiver.kt`, `android/.../LocationTrackingService.kt`

---

## 5. Session leaks — logged-out phone kept publishing

**Symptom.** Two phones signed into the same driver account. One logs out; the map keeps showing movement.

### 5.1 `clearMqttCredentials()` now disconnects the live client

Deleting the stored credentials never touched the connected Paho client, which holds url, username, password and topic **in memory** and is built with `isAutomaticReconnect = true`. It kept publishing after logout and reconnected itself if the socket dropped.

```kotlin
instance?.let { svc ->
    Handler(Looper.getMainLooper()).post { svc.disconnectMqtt() }
}
```

### 5.2 `clearApiCredentials()` added and called on logout

`api_base_url`, `api_token` and `refresh_token` were written into native SharedPreferences at login and nothing ever removed them. A logged-out phone still held everything `refreshMqttTokenViaApi()` needs to mint fresh publish credentials. New native method, exposed through `LocationTrackingModule`, called from `clearAllData()`. Both logout paths and the `force_logout` push all route through `clearAllData()`, so all three are covered.

### 5.3 `autoResume()` gated on a signed-in driver

It ran on every app start with no login check and published leftover GPS under the previous driver's ticket.

```ts
if (!storage.getString('driver')) {
  console.log('[OfflineSync] autoResume skipped — no driver signed in');
} else {
  await backgroundGpsTracker.autoResume();
}
```

Read from storage, not `isDriverLoggedIn` — this effect fires before auth finishes restoring, when that flag is still false for everyone. Records are not lost when skipped; they stay in `gpsStorage` and go out on the next login.

**Files:** `android/.../LocationTrackingService.kt`, `android/.../LocationTrackingModule.kt`, `src/services/backgroundGpsTracker.ts`, `src/contexts/OfflineSyncContext.tsx`

### Not fixed — needs the backend

Two devices on one account still both publish while both are signed in. The GPS payload carries no `device_id`, so the server cannot tell them apart or cut one off. Adding it, and enforcing one session per driver, is on the backend team. See the questions listed in §13.

### Known remaining app-side leak

`backgroundGpsTracker.stop()` deliberately keeps the native service alive in silent mode — reached when the ticket goes inactive or location permission is revoked. Tracking looks stopped to the driver while the phone keeps sending. **Left as-is:** it is intentional behaviour, not an accident, and changing it would drop GPS in cases the original author cared about. Flagging it so the decision is visible.

---

## 6. Backfill flag and presence messages

**Backfill.** Any record more than 60 s old when it reaches the broker is published with `backfill: true`. One age check per side covers every call site — live foreground, the native bridge and the catch-up flush all route through `publish()`.

The backend confirmed nothing reads this field today; the ordering fix in §1 is what actually solves the straight line. Kept anyway, for later use.

| Side | Where |
|---|---|
| JS | `mqttService.publish()` — `BACKFILL_AFTER_MS` |
| Native | `LocationTrackingService.isBackfill()` — `BACKFILL_AFTER_MS` |

**Presence.** On losing connectivity the app publishes `{status: "offline", since}`; on reconnect, just before the flush, `{status: "online", backfill_count, backfill_from, backfill_to}`. The dashboard no longer has to infer an outage from silence. Topic is the GPS topic with `/gps` replaced by `/presence`.

Best-effort by design — never blocks or delays GPS. The offline message often does not make it out because the socket is already gone by the time NetInfo reports the drop.

**One real bug this found.** `if (unsynced.length === 0) return;` sat above the presence block, so an outage the truck spent parked would latch `offlineSince` forever and suppress the offline message for every later outage. The block was moved above the early return.

**Files:** `src/services/mqttService.ts`, `src/services/backgroundGpsTracker.ts`
**Tests:** `__tests__/gpsBackfillFlag.test.ts` (9), `__tests__/gpsPresence.test.ts` (8)

---

## 7. Release hardening

### Version

`versionCode 2`, `versionName "1.0.1"` in `android/app/build.gradle`.

### Release signing

Release builds were signed with the debug key. Now reads a real keystore from `android/keystore.properties` or `TKSYNC_KEYSTORE_*` environment variables, falling back to debug only when neither exists:

```gradle
signingConfig releaseKeystore.containsKey('storeFile')
    ? signingConfigs.release
    : signingConfigs.debug
```

Added `android/keystore.properties.example`. `.gitignore` now excludes `android/keystore.properties`, `*.jks` and `*.keystore` (with an exception for `debug.keystore`).

**Not done:** the real keystore has not been generated. Release APKs are still debug-signed.

### Network security

| | Release | Debug |
|---|---|---|
| Cleartext HTTP | blocked | allowed |
| User-installed CAs | rejected | trusted |

`usesCleartextTraffic="true"` removed from the main manifest. A `src/debug/` source set restores both for development, via `AndroidManifest.xml` with `tools:replace` and its own `res/xml/network_security_config.xml`.

### Debug tools out of release

`DebugLogViewer`, `logCapture` and the API-token display are absent from the release bundle. Verified by inspecting the built APK, not just the source — checked the Hermes bytecode in both ASCII and UTF-16 encodings.

---

## 8. Permissions — background location

**Symptom.** A driver who picks "While using the app" loses the whole shift's background GPS and is never told.

**Fix.** `src/services/locationPermission.ts` — `getLocationPermissionLevel()` returns `'always' | 'foregroundOnly' | 'denied' | 'unknown'`.

- Android: `PermissionsAndroid.check(ACCESS_BACKGROUND_LOCATION)` when `Platform.Version >= 29`.
- iOS: a new native module reading the real `CLLocationManager.authorizationStatus`. The `react-native-geolocation-service` library folds "Always" and "While Using" together into `'granted'`, so there was no other way to tell.

`src/components/BackgroundPermissionBanner.tsx` — a persistent orange banner that opens system settings on tap. Re-checks whenever the app becomes active (`src/hooks/useBackgroundLocationPermission.ts`). Hidden while offline so it does not stack with the network banner; `zIndex: 9998`, below `NetworkBanner`'s 9999.

A toast was considered and rejected — it is gone in seconds and the driver loses the shift without ever seeing why.

**iOS module:** `ios/TKSync/LocationAuthModule.swift` + `.m`, wired into `project.pbxproj` (verified with `plutil -lint`). **Unverified on device** — the iOS build fails on a pre-existing `FirebaseMessaging` modular-headers issue unrelated to any of this.

---

## 9. Code health — types, lint, tests, CI

### Force Offline actually works now

The DEV "Force Offline" toggle only gated REST, so GPS kept flowing over MQTT and every offline test silently passed. `mqttService.publish()` and `publishPresence()` now honour it.

Still not a full substitute for airplane mode: the native service has its own MQTT client and knows nothing about the flag, so a backgrounded app keeps publishing. Use it for foreground checks; use real airplane mode for the background and replay paths.

### Type errors: 82 → 0

`npm run typecheck` added to `package.json`. All 82 pre-existing errors fixed — see §10 for the two that were real bugs.

### Lint errors: 180 → 0

- 94 were the jest environment missing from `.eslintrc.js` — added an override for `jest.setup.js`, `jest.config.js` and `__tests__/**`.
- ~10 were `react-hooks/exhaustive-deps`, now `'warn'`.
- ~76 unused variables, deleted or prefixed.

**One thing deliberately not deleted.** Removing a 53-line dead `startTracking` function cascaded into 14 new errors — it was the sole writer for a dozen pieces of state the screen renders. Restored and marked with `eslint-disable-next-line` plus an explanation instead.

### Tests: 231 → 248

| File | Tests | Covers |
|---|---|---|
| `__tests__/gpsFlushOrder.test.ts` | 7 | backlog ordering and the live-fix hold |
| `__tests__/gpsUnexplainedJump.test.ts` | 10 | the multipath spur filter |
| `__tests__/gpsBackfillFlag.test.ts` | 9 | the 60 s backfill rule |
| `__tests__/gpsPresence.test.ts` | 8 | offline/online presence and the latch |
| `__tests__/validateDeliveryTab.test.ts` | 24 | delivery tab validation |

### CI

`.github/workflows/ci.yml` — a `checks` job (npm ci, lint, typecheck, test) and an `android` job (Java 17, placeholder `.env`, `./gradlew assembleDebug`).

---

## 10. Two real bugs found by fixing the types

### The crash screen never rendered

`Sentry.wrap(App, {fallback})` — `Sentry.wrap` takes no `fallback` option, so a JS crash showed a blank white screen. Replaced with a real `<Sentry.ErrorBoundary fallback={...}>` around the tree.

### `maximumAge` was never read

`Geolocation.watchPosition` was passed `maximumAge`, which belongs to `getCurrentPosition`. The native watch ignored it, so it only ever looked like a cache bound. Removed, with a comment so nobody adds it back.

---

## 11. Documentation

`GPS_MQTT_DOCUMENTATION.md` fully rewritten (286 lines) against the real constants rather than from memory:

- accuracy ratchet 50 m → 25 m, `ACCURACY_REWARMUP_REJECTS = 10`
- `IDLE_SPEED_THRESHOLD = 0.5`, `MOVING_CONFIRM_THRESHOLD = 2`
- distance filter 5 m, or `max(10, accuracy × 0.75)` when accuracy > 15 m
- teleport gate 80 m/s, `MQTT_TOKEN_REFRESH_AFTER_MS = 55 min`, watchdog thresholds
- new sections on backlog ordering, backfill and presence
- corrected "app killed" section, including the measured intermittent-restart caveat
- new FAQ row on reboot behaviour

---

## 12. Full file list

**Commits**

| Commit | What |
|---|---|
| `0f7ed06` | backlog ordering + 6 native MQTT fixes + the week's work (72 files) |
| `453b2c8` | reboot notification |
| `6be879a` | multipath spur filter |

**Uncommitted** — the session-leak fixes from §5:
`LocationTrackingService.kt`, `LocationTrackingModule.kt`, `backgroundGpsTracker.ts`, `OfflineSyncContext.tsx`

**New files**

```
src/services/locationPermission.ts
src/hooks/useBackgroundLocationPermission.ts
src/components/BackgroundPermissionBanner.tsx
ios/TKSync/LocationAuthModule.swift
ios/TKSync/LocationAuthModule.m
android/app/src/debug/AndroidManifest.xml
android/app/src/debug/res/xml/network_security_config.xml
android/keystore.properties.example
.github/workflows/ci.yml
__tests__/gpsFlushOrder.test.ts
__tests__/gpsUnexplainedJump.test.ts
__tests__/gpsBackfillFlag.test.ts
__tests__/gpsPresence.test.ts
__tests__/gpsAccuracyGate.test.ts
__tests__/gpsOfflineTicket.test.ts
__tests__/validateDeliveryTab.test.ts
docs/APP-SIDE-CHANGES.md
docs/gps-workflow.html
```

**Heaviest edits**

```
src/services/backgroundGpsTracker.ts
src/services/mqttService.ts
android/app/src/main/java/com/tksync/location/LocationTrackingService.kt
android/app/src/main/java/com/tksync/location/BootReceiver.kt
android/app/build.gradle
GPS_MQTT_DOCUMENTATION.md
App.tsx
```

---

## 13. Still open

### Blocking a road test

The phone dropped off ADB — answers ping, port 5555 refused, nothing on mDNS. Needs one USB connection to run `adb tcpip 5555`. Nothing here has been tested on a device.

### Not pushed

`dfaldu387` has no write access to `jaydeep-pat377/TKSync` — push returns 403. All three commits are local only.

### Waiting on the backend team

1. Does `POST /auth/driver-login` allow a second concurrent session?
2. Does a second login fire `force_logout` at the first device?
3. Does `registerDevice(fcm_token, platform)` replace or append when two devices share one driver?
4. Does `POST /tracking/mqtt-token` bind a token to a device or session?
5. Does the broker allow two simultaneous publishers on one topic?
6. Does `gps-consumer` reject a point older than the position already in Redis? (The ordering fix in §1 depends on this.)
7. Does anything expire a truck's Redis position?

Two changes need their agreement before we start: adding `device_id` to the GPS payload, and enforcing one session per driver. A REST fallback for GPS was considered and dropped — `REST_GPS_INGEST_ENABLED=false` in production and the HTTP route writes to a different table.

### Decisions for you and Jaydeep

- Generate the release keystore. Not needed for testing.
- `backgroundGpsTracker.stop()` keeping native alive in silent mode — intentional today, see §5.

### Known ceilings, marked in code

- A native fix landing between the last replay pass and the flag clear waits for the next reconnect. It stays unsynced in SharedPreferences, so nothing is lost.
- GPS records live in SharedPreferences as one ~4 MB JSON string, rewritten on every fix. Works, but belongs in SQLite. Backend team agreed it is not urgent.
- `useNetworkStatus()` is mounted in 4 components, so every connectivity transition fires its listeners 4 times. The guards absorb it; it should be one module-level subscription.
