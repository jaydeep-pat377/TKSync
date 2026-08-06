package com.tksync.location

import android.app.*
import android.content.Context
import android.content.Intent
import android.content.SharedPreferences
import android.content.pm.ServiceInfo
import android.location.Location
import android.os.Build
import android.os.Handler
import android.os.IBinder
import android.os.Looper
import android.util.Log
import androidx.core.app.NotificationCompat
import com.google.android.gms.location.*
import org.json.JSONArray
import org.json.JSONObject
import java.io.BufferedReader
import java.io.InputStreamReader
import java.io.OutputStreamWriter
import java.net.HttpURLConnection
import java.net.URL
import java.text.SimpleDateFormat
import java.util.*
import java.util.concurrent.Executors

class LocationTrackingService : Service() {

    companion object {
        /** True while native is uploading GPS records on background thread. JS checks this
         *  before importing native records to avoid duplicate uploads. */
        @Volatile
        var isCurrentlyUploading = false
            private set

        private const val TAG = "LocationTrackingService"
        private const val CHANNEL_ID = "tksync-native-tracking"
        private const val SILENT_CHANNEL_ID = "tksync-sync"
        private const val NOTIFICATION_ID = 9001
        private const val PREFS_NAME = "tksync_native_gps"
        private const val KEY_RECORDS = "gps_records"
        private const val KEY_TICKET_ID = "ticket_id"
        private const val KEY_ACTIVE = "tracking_active"
        private const val KEY_SILENT = "silent_mode"
        private const val MAX_RECORDS = 10000 // ~27 hours at 10s intervals; keeps SharedPrefs fast
        private const val KEY_IDLE = "idle_mode"
        private const val KEY_JS_ALIVE = "js_alive" // When true, JS is recording — native skips saving
        private const val KEY_JS_HEARTBEAT = "js_heartbeat" // Last time JS recorded a GPS fix (epoch ms)
        private const val JS_HEARTBEAT_STALE_MS = 30_000L // If no heartbeat for 30s, JS is frozen/dead
        private const val KEY_API_BASE_URL = "api_base_url"
        private const val KEY_API_TOKEN = "api_token"
        private const val UPLOAD_BATCH_SIZE = 50
        private const val UPLOAD_INTERVAL_MS = 30_000L // Upload every 30 seconds
        private const val IDLE_SPEED_THRESHOLD = 1.67 // m/s ≈ 6 km/h — filters out walking
        private const val IDLE_CONSECUTIVE_THRESHOLD = 3
        private const val IDLE_DISTANCE_THRESHOLD = 50.0 // metres — resume if moved this far from idle position

        fun setJsAlive(context: Context, alive: Boolean) {
            val prefs = context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
            prefs.edit()
                .putBoolean(KEY_JS_ALIVE, alive)
                .putLong(KEY_JS_HEARTBEAT, if (alive) System.currentTimeMillis() else 0L)
                .apply()
            Log.d(TAG, "JS alive set to: $alive")
        }

        fun updateJsHeartbeat(context: Context) {
            val prefs = context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
            prefs.edit().putLong(KEY_JS_HEARTBEAT, System.currentTimeMillis()).apply()
        }

        fun setIdleMode(context: Context, idle: Boolean) {
            val prefs = context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
            prefs.edit().putBoolean(KEY_IDLE, idle).apply()

            // Restart service to update location request frequency
            if (prefs.getBoolean(KEY_ACTIVE, false)) {
                val ticketId = prefs.getInt(KEY_TICKET_ID, 0)
                val silent = prefs.getBoolean(KEY_SILENT, false)
                val intent = Intent(context, LocationTrackingService::class.java)
                intent.putExtra("ticket_id", ticketId)
                intent.putExtra("silent", silent)
                intent.putExtra("idle", idle)
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                    context.startForegroundService(intent)
                } else {
                    context.startService(intent)
                }
            }
            Log.d(TAG, "Idle mode set to: $idle")
        }

        fun start(context: Context, ticketId: Int, silent: Boolean = false) {
            val prefs = context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
            prefs.edit()
                .putInt(KEY_TICKET_ID, ticketId)
                .putBoolean(KEY_ACTIVE, true)
                .putBoolean(KEY_SILENT, silent)
                .apply()

            val intent = Intent(context, LocationTrackingService::class.java)
            intent.putExtra("ticket_id", ticketId)
            intent.putExtra("silent", silent)
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                context.startForegroundService(intent)
            } else {
                context.startService(intent)
            }
            Log.d(TAG, "Service start requested — ticket: $ticketId, silent: $silent")
        }

        fun setSilentMode(context: Context, silent: Boolean) {
            val prefs = context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
            prefs.edit().putBoolean(KEY_SILENT, silent).apply()

            // Restart service to update notification
            if (prefs.getBoolean(KEY_ACTIVE, false)) {
                val ticketId = prefs.getInt(KEY_TICKET_ID, 0)
                val intent = Intent(context, LocationTrackingService::class.java)
                intent.putExtra("ticket_id", ticketId)
                intent.putExtra("silent", silent)
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                    context.startForegroundService(intent)
                } else {
                    context.startService(intent)
                }
            }
            Log.d(TAG, "Silent mode set to: $silent")
        }

        fun stop(context: Context) {
            val prefs = context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
            prefs.edit()
                .putBoolean(KEY_ACTIVE, false)
                .putBoolean(KEY_SILENT, false)
                .putBoolean(KEY_IDLE, false)
                .apply()

            val intent = Intent(context, LocationTrackingService::class.java)
            context.stopService(intent)
            Log.d(TAG, "Service stop requested")
        }

        fun getStoredRecords(context: Context): JSONArray {
            val prefs = context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
            val raw = prefs.getString(KEY_RECORDS, "[]") ?: "[]"
            return try { JSONArray(raw) } catch (e: Exception) { JSONArray() }
        }

        fun clearStoredRecords(context: Context) {
            val prefs = context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
            prefs.edit().putString(KEY_RECORDS, "[]").apply()
            Log.d(TAG, "Stored records cleared")
        }

        fun setApiCredentials(context: Context, baseUrl: String, token: String) {
            val prefs = context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
            prefs.edit()
                .putString(KEY_API_BASE_URL, baseUrl)
                .putString(KEY_API_TOKEN, token)
                .apply()
            Log.d(TAG, "API credentials updated — baseUrl: $baseUrl")
        }

        fun updateApiToken(context: Context, token: String) {
            val prefs = context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
            prefs.edit().putString(KEY_API_TOKEN, token).apply()
            Log.d(TAG, "API token updated")
        }

        fun isActive(context: Context): Boolean {
            val prefs = context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
            return prefs.getBoolean(KEY_ACTIVE, false)
        }

        fun getTicketId(context: Context): Int {
            val prefs = context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
            return prefs.getInt(KEY_TICKET_ID, 0)
        }
    }

    private lateinit var fusedClient: FusedLocationProviderClient
    private lateinit var locationCallback: LocationCallback
    private lateinit var prefs: SharedPreferences
    private var ticketId: Int = 0
    private var isSilent: Boolean = false
    private var isIdleMode: Boolean = false
    private var consecutiveIdleCount: Int = 0
    private var idleLat: Double = 0.0
    private var idleLng: Double = 0.0
    private var wasStationary: Boolean = false // true after first stationary fix is saved — suppresses drift
    private var consecutiveMovingCount: Int = 0
    private val MOVING_CONFIRM_THRESHOLD = 3 // Require 3 consecutive moving fixes to clear stationary
    private var lastSavedLat: Double = 0.0
    private var lastSavedLng: Double = 0.0
    private var pendingRecords = JSONArray() // Buffer writes to reduce SharedPrefs I/O
    private var pendingCount = 0
    private val WRITE_BATCH_SIZE = 1 // Flush to SharedPrefs immediately — ensures no records lost on foreground transition
    private val isoFormat = SimpleDateFormat("yyyy-MM-dd'T'HH:mm:ss.SSS'Z'", Locale.US).apply {
        timeZone = TimeZone.getTimeZone("UTC")
    }
    private val uploadExecutor = Executors.newSingleThreadExecutor()
    private val uploadHandler = Handler(Looper.getMainLooper())
    private var isUploading = false

    override fun onCreate() {
        super.onCreate()
        prefs = getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
        fusedClient = LocationServices.getFusedLocationProviderClient(this)

        locationCallback = object : LocationCallback() {
            override fun onLocationResult(result: LocationResult) {
                for (location in result.locations) {
                    saveLocation(location)
                }
            }
        }
        Log.d(TAG, "Service created")
    }

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        // If intent is null, service was restarted by Android after kill — stop immediately
        if (intent == null) {
            Log.d(TAG, "Service restarted by system after kill — stopping (background only, not kill)")
            stopSelf()
            return START_NOT_STICKY
        }

        ticketId = intent?.getIntExtra("ticket_id", 0)
            ?: prefs.getInt(KEY_TICKET_ID, 0)
        isSilent = intent?.getBooleanExtra("silent", false)
            ?: prefs.getBoolean(KEY_SILENT, false)
        isIdleMode = intent?.getBooleanExtra("idle", false)
            ?: prefs.getBoolean(KEY_IDLE, false)

        prefs.edit()
            .putInt(KEY_TICKET_ID, ticketId)
            .putBoolean(KEY_ACTIVE, true)
            .putBoolean(KEY_SILENT, isSilent)
            .putBoolean(KEY_IDLE, isIdleMode)
            .apply()

        createNotificationChannels()
        val notification = buildNotification()

        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
            startForeground(NOTIFICATION_ID, notification,
                ServiceInfo.FOREGROUND_SERVICE_TYPE_LOCATION)
        } else {
            startForeground(NOTIFICATION_ID, notification)
        }

        // Remove old location updates before starting new ones (prevents duplicates on restart)
        fusedClient.removeLocationUpdates(locationCallback)
        startLocationUpdates()
        scheduleUpload()
        Log.d(TAG, "Service started — ticket: $ticketId, silent: $isSilent, idle: $isIdleMode, START_NOT_STICKY")
        return START_NOT_STICKY
    }

    override fun onDestroy() {
        super.onDestroy()
        fusedClient.removeLocationUpdates(locationCallback)
        uploadHandler.removeCallbacksAndMessages(null)
        // Flush any buffered records before dying
        if (pendingCount > 0) {
            flushPendingRecords()
        }
        Log.d(TAG, "Service destroyed")
    }

    private fun flushPendingRecords() {
        if (pendingCount == 0) return
        val records = getStoredRecords(this)
        for (i in 0 until pendingRecords.length()) {
            records.put(pendingRecords.getJSONObject(i))
        }

        val toWrite = if (records.length() > MAX_RECORDS) {
            val trimmed = JSONArray()
            for (i in (records.length() - MAX_RECORDS) until records.length()) {
                trimmed.put(records.getJSONObject(i))
            }
            trimmed
        } else {
            records
        }

        prefs.edit().putString(KEY_RECORDS, toWrite.toString()).apply()
        Log.d(TAG, "Flushed $pendingCount records to SharedPrefs (total: ${toWrite.length()})")
        pendingRecords = JSONArray()
        pendingCount = 0
    }

    override fun onBind(intent: Intent?): IBinder? = null

    override fun onTaskRemoved(rootIntent: Intent?) {
        super.onTaskRemoved(rootIntent)
        // App killed — flush any buffered records then stop service
        if (pendingCount > 0) {
            flushPendingRecords()
        }
        prefs.edit()
            .putBoolean(KEY_JS_ALIVE, false)
            .putBoolean(KEY_ACTIVE, false)
            .apply()
        stopSelf()
        Log.d(TAG, "Task removed (app killed) — flushed records, service stopping")
    }

    private fun createNotificationChannels() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            val manager = getSystemService(NotificationManager::class.java)

            val trackingChannel = NotificationChannel(
                CHANNEL_ID,
                "Vehicle Tracking",
                NotificationManager.IMPORTANCE_LOW
            ).apply {
                description = "GPS tracking for deliveries"
                setSound(null, null)
            }
            manager.createNotificationChannel(trackingChannel)

            val silentChannel = NotificationChannel(
                SILENT_CHANNEL_ID,
                "Sync Service",
                NotificationManager.IMPORTANCE_MIN
            ).apply {
                description = "Background data sync"
                setSound(null, null)
                setShowBadge(false)
                enableLights(false)
                enableVibration(false)
                lockscreenVisibility = Notification.VISIBILITY_SECRET
            }
            manager.createNotificationChannel(silentChannel)
        }
    }

    private fun buildNotification(): Notification {
        val launchIntent = packageManager.getLaunchIntentForPackage(packageName)
        val pendingIntent = PendingIntent.getActivity(
            this, 0, launchIntent,
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
        )

        return if (isSilent) {
            NotificationCompat.Builder(this, SILENT_CHANNEL_ID)
                .setContentTitle("")
                .setContentText("")
                .setSmallIcon(android.R.drawable.ic_menu_info_details)
                .setOngoing(true)
                .setContentIntent(pendingIntent)
                .setPriority(NotificationCompat.PRIORITY_MIN)
                .setVisibility(NotificationCompat.VISIBILITY_SECRET)
                .setForegroundServiceBehavior(NotificationCompat.FOREGROUND_SERVICE_DEFERRED)
                .build()
        } else {
            NotificationCompat.Builder(this, CHANNEL_ID)
                .setContentTitle("Vehicle Tracking Active")
                .setContentText("GPS location is being recorded.")
                .setSmallIcon(android.R.drawable.ic_menu_mylocation)
                .setOngoing(true)
                .setContentIntent(pendingIntent)
                .setPriority(NotificationCompat.PRIORITY_LOW)
                .build()
        }
    }

    @Suppress("MissingPermission", "DEPRECATION")
    private fun startLocationUpdates() {
        val isSilentMode = prefs.getBoolean(KEY_SILENT, false)
        val isIdle = prefs.getBoolean(KEY_IDLE, false)
        val request = LocationRequest.create().apply {
            if (isIdle) {
                // Idle mode: reduced frequency but keep HIGH_ACCURACY for reliable distance checks
                // No smallestDisplacement — time-based updates ensure saveLocation() runs
                // so heartbeat staleness can be detected and idle-to-active transitions work
                priority = LocationRequest.PRIORITY_HIGH_ACCURACY
                interval = 30000L
                fastestInterval = 15000L
            } else if (isSilentMode) {
                priority = LocationRequest.PRIORITY_HIGH_ACCURACY
                interval = 3000L
                fastestInterval = 3000L
            } else {
                priority = LocationRequest.PRIORITY_HIGH_ACCURACY
                interval = 3000L
                fastestInterval = 3000L
            }
        }

        try {
            fusedClient.requestLocationUpdates(request, locationCallback, Looper.getMainLooper())
            Log.d(TAG, "Location updates started")
        } catch (e: SecurityException) {
            Log.e(TAG, "Location permission not granted", e)
            stopSelf()
        }
    }

    private fun saveLocation(location: Location) {

        // Skip saving if JS is alive (foreground) — JS handles recording, avoids duplicates
        val jsAlive = prefs.getBoolean(KEY_JS_ALIVE, false)
        if (jsAlive) {
            // Check heartbeat — if JS hasn't updated in 30s, it's probably frozen/backgrounded
            val heartbeat = prefs.getLong(KEY_JS_HEARTBEAT, 0L)
            if (heartbeat > 0 && System.currentTimeMillis() - heartbeat < JS_HEARTBEAT_STALE_MS) {
                return // JS is actively recording — skip native save
            }
            // JS heartbeat stale — JS is frozen/backgrounded, self-correct the flag
            prefs.edit().putBoolean(KEY_JS_ALIVE, false).apply()
            Log.d(TAG, "JS heartbeat stale — set jsAlive=false, native taking over recording")
        }

        // Re-read ticket ID from prefs in case JS updated it mid-session
        val latestTicketId = prefs.getInt(KEY_TICKET_ID, ticketId)
        if (latestTicketId != ticketId && latestTicketId > 0) {
            Log.d(TAG, "Ticket ID updated: $ticketId → $latestTicketId")
            ticketId = latestTicketId
        }

        // Skip very inaccurate fixes (>100m) — in background, GPS can degrade severely
        val accuracy = location.accuracy.toDouble()
        if (location.hasAccuracy() && accuracy > 100.0) {
            Log.d(TAG, "Skipping inaccurate fix: ${String.format("%.0f", accuracy)}m")
            return
        }

        val speedAvailable = location.hasSpeed() && location.speed >= 0f
        val speedMs = if (speedAvailable) location.speed.toDouble() else 0.0
        val speedKmh = speedMs * 3.6
        val isSpeeding = speedKmh > 80.0
        // Treat speed-unavailable as idle (don't assume movement when we don't know)
        val isIdle = !speedAvailable || speedMs < IDLE_SPEED_THRESHOLD
        // Only consider it confirmed movement when speed is available AND above threshold
        val isConfirmedMoving = speedAvailable && speedMs >= IDLE_SPEED_THRESHOLD

        // ── Stationary drift suppression ──────────────────────────────
        // When the truck is not confirmed moving, save ONE "stopped at" position
        // then suppress all subsequent drift points until real movement (speed
        // above threshold) is detected. This mirrors the JS-side wasStationary
        // logic and is the primary fix for the zigzag-while-parked bug.
        //
        // Uses a flag instead of early return so the idle-mode frequency
        // reduction (below) still runs — otherwise the service polls at 5s
        // forever while parked, wasting battery.
        var suppressDrift = false

        if (isConfirmedMoving) {
            consecutiveMovingCount++
            if (consecutiveMovingCount >= MOVING_CONFIRM_THRESHOLD) {
                // Confirmed real movement — clear stationary flag
                wasStationary = false
                Log.d(TAG, "MOVEMENT CONFIRMED: $consecutiveMovingCount consecutive, speed=${String.format("%.1f", speedMs)}")
            } else if (wasStationary) {
                // Speed spike — not enough consecutive moving fixes to confirm
                suppressDrift = true
                Log.d(TAG, "SPIKE BLOCKED: speed=${String.format("%.1f", speedMs)}, movingCount=$consecutiveMovingCount/$MOVING_CONFIRM_THRESHOLD")
            }
        } else {
            consecutiveMovingCount = 0
            if (wasStationary) {
                suppressDrift = true
                Log.d(TAG, "DRIFT BLOCKED: speed=${String.format("%.1f", speedMs)}, wasStationary=true, " +
                    "lat=${String.format("%.6f", location.latitude)}, lng=${String.format("%.6f", location.longitude)}")
            } else {
                // First stationary fix — save it so we know WHERE the truck stopped
                wasStationary = true
                Log.d(TAG, "FIRST STOP: saving stopped-at, lat=${String.format("%.6f", location.latitude)}, lng=${String.format("%.6f", location.longitude)}")
                // Fall through to save this one record
            }
        }

        // Native idle detection — controls polling frequency (5s → 30s when idle)
        // Runs even when drift is suppressed so the service reduces battery usage.
        if (isConfirmedMoving) {
            // Confirmed movement — resume normal 5s polling if was idle
            if (isIdleMode) {
                Log.d(TAG, "Movement detected — resuming normal GPS tracking")
                isIdleMode = false
                idleLat = 0.0
                idleLng = 0.0
                prefs.edit().putBoolean(KEY_IDLE, false).apply()
                fusedClient.removeLocationUpdates(locationCallback)
                startLocationUpdates()
            }
            consecutiveIdleCount = 0
        } else {
            // Idle or speed unknown — build up idle counter for frequency reduction
            var movedFromIdle = false
            if (isIdleMode && idleLat != 0.0 && idleLng != 0.0) {
                val results = FloatArray(1)
                Location.distanceBetween(idleLat, idleLng, location.latitude, location.longitude, results)
                val dist = results[0].toDouble()
                if (dist > IDLE_DISTANCE_THRESHOLD) {
                    Log.d(TAG, "Moved ${String.format("%.0f", dist)}m from idle position — resuming tracking")
                    movedFromIdle = true
                }
            }

            if (movedFromIdle) {
                isIdleMode = false
                idleLat = 0.0
                idleLng = 0.0
                consecutiveIdleCount = 0
                prefs.edit().putBoolean(KEY_IDLE, false).apply()
                fusedClient.removeLocationUpdates(locationCallback)
                startLocationUpdates()
                // Fall through to save this record
            } else {
                consecutiveIdleCount++
                if (consecutiveIdleCount >= IDLE_CONSECUTIVE_THRESHOLD) {
                    if (!isIdleMode) {
                        Log.d(TAG, "Truck idle — switching to low-frequency mode ($consecutiveIdleCount consecutive idle fixes)")
                        isIdleMode = true
                        idleLat = location.latitude
                        idleLng = location.longitude
                        prefs.edit().putBoolean(KEY_IDLE, true).apply()
                        fusedClient.removeLocationUpdates(locationCallback)
                        startLocationUpdates()
                    }
                    // Idle mode active — skip record (drift or not)
                    return
                }
            }
        }

        // Drift was detected — record already suppressed, idle mode handled above
        if (suppressDrift) return

        // Skip if truck hasn't moved enough from last saved position.
        // Scale minimum distance by accuracy — poor fixes need more displacement
        // to confirm real movement (prevents zigzag drift from degraded GPS).
        val minDistance = if (location.hasAccuracy() && accuracy > 15.0) {
            maxOf(10.0, accuracy * 0.75) // 75% of accuracy radius, minimum 10m
        } else {
            5.0
        }
        if (lastSavedLat != 0.0 && lastSavedLng != 0.0) {
            val distResults = FloatArray(1)
            Location.distanceBetween(lastSavedLat, lastSavedLng, location.latitude, location.longitude, distResults)
            if (distResults[0] < minDistance.toFloat()) {
                return
            }
        }
        lastSavedLat = location.latitude
        lastSavedLng = location.longitude

        val record = JSONObject().apply {
            put("ticket_id", ticketId)
            put("latitude", location.latitude)
            put("longitude", location.longitude)
            put("speed", speedMs)
            put("heading", (location.bearing ?: 0f).toDouble())
            put("altitude", location.altitude)
            put("accuracy", location.accuracy.toDouble())
            put("recorded_at", isoFormat.format(Date(location.time)))
            put("synced", false)
            put("id", "native_${System.currentTimeMillis()}_${UUID.randomUUID().toString().take(8)}")
            put("is_speeding", isSpeeding)
            put("is_idle", isIdle)
        }

        pendingRecords.put(record)
        pendingCount++

        // Batch writes — flush to SharedPrefs every WRITE_BATCH_SIZE records
        if (pendingCount >= WRITE_BATCH_SIZE) {
            flushPendingRecords()
        }

        Log.d(TAG, "GPS (pending: $pendingCount) | lat: ${String.format("%.6f", location.latitude)}, " +
                "lng: ${String.format("%.6f", location.longitude)} | " +
                "speed: ${String.format("%.1f", speedMs)} m/s | ticket: $ticketId | silent: $isSilent")
    }

    // ─── Background API Upload ─────────────────────────────────────

    private fun scheduleUpload() {
        uploadHandler.removeCallbacksAndMessages(null)
        uploadHandler.postDelayed(object : Runnable {
            override fun run() {
                // Only upload when JS is NOT alive (background mode)
                val jsAlive = prefs.getBoolean(KEY_JS_ALIVE, false)
                if (!jsAlive) {
                    uploadRecordsToApi()
                }
                uploadHandler.postDelayed(this, UPLOAD_INTERVAL_MS)
            }
        }, UPLOAD_INTERVAL_MS)
    }

    private fun uploadRecordsToApi() {
        // GPS data is now published via MQTT in real-time from JS.
        // The REST endpoint POST /tracking/gps is turned off server-side.
        // Native records are imported by JS on foreground resume and published via MQTT.
        Log.d(TAG, "Upload skipped — GPS now uses MQTT (REST endpoint removed)")
    }

    private fun postToApi(url: String, token: String, body: JSONObject): Boolean {
        var conn: HttpURLConnection? = null
        try {
            conn = URL(url).openConnection() as HttpURLConnection
            conn.requestMethod = "POST"
            conn.setRequestProperty("Content-Type", "application/json")
            conn.setRequestProperty("Authorization", "Bearer $token")
            conn.connectTimeout = 15000
            conn.readTimeout = 15000
            conn.doOutput = true

            OutputStreamWriter(conn.outputStream, "UTF-8").use { it.write(body.toString()) }

            val code = conn.responseCode
            if (code in 200..299) {
                val response = BufferedReader(InputStreamReader(conn.inputStream)).use { it.readText() }
                Log.d(TAG, "API upload success ($code) — ${body.getJSONArray("records").length()} records")
                return true
            } else {
                val error = try {
                    BufferedReader(InputStreamReader(conn.errorStream)).use { it.readText() }
                } catch (_: Exception) { "no error body" }
                Log.w(TAG, "API upload failed ($code): $error")
                return false
            }
        } catch (e: Exception) {
            Log.w(TAG, "API upload error: ${e.message}")
            return false
        } finally {
            conn?.disconnect()
        }
    }
}
