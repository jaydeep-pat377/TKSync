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
import org.eclipse.paho.client.mqttv3.*
import org.eclipse.paho.client.mqttv3.persist.MemoryPersistence
import org.json.JSONArray
import org.json.JSONObject

import android.os.BatteryManager
import java.text.SimpleDateFormat
import java.util.*

class LocationTrackingService : Service() {

    companion object {
        /** True while native is uploading GPS records on background thread. JS checks this
         *  before importing native records to avoid duplicate uploads. */
        @Volatile
        var isCurrentlyUploading = false
            internal set

        /** Callback invoked when native saves a GPS record — bridges to JS for MQTT publishing. */
        @Volatile
        var onGpsRecord: ((JSONObject) -> Unit)? = null

        /** Reference to the running service instance so static methods can trigger actions. */
        @Volatile
        private var instance: LocationTrackingService? = null

        private const val TAG = "LocationTrackingService"
        private const val CHANNEL_ID = "tksync-tracking-v3"
        private const val SILENT_CHANNEL_ID = "tksync-sync"
        private const val NOTIFICATION_ID = 9001
        private const val PREFS_NAME = "tksync_native_gps"
        private const val KEY_RECORDS = "gps_records"
        private const val KEY_TICKET_ID = "ticket_id"
        private const val KEY_ACTIVE = "tracking_active"
        private const val KEY_SILENT = "silent_mode"
        private const val MAX_RECORDS = 20000 // ~5.5 hours at 1s intervals; ~4MB JSON — fits in SharedPrefs
        private const val KEY_IDLE = "idle_mode"
        private const val KEY_JS_ALIVE = "js_alive" // When true, JS is recording — native skips saving
        private const val KEY_JS_HEARTBEAT = "js_heartbeat" // Last time JS recorded a GPS fix (epoch ms)
        private const val JS_HEARTBEAT_STALE_MS = 30_000L // If no heartbeat for 30s, JS is frozen/dead
        private const val KEY_API_BASE_URL = "api_base_url"
        private const val KEY_API_TOKEN = "api_token"
        private const val KEY_REFRESH_TOKEN = "refresh_token"
        private const val UPLOAD_BATCH_SIZE = 50
        private const val UPLOAD_INTERVAL_MS = 30_000L // Upload every 30 seconds
        private const val IDLE_SPEED_THRESHOLD = 0.5 // m/s ≈ 1.8 km/h — truly stopped, not crawling in traffic
        private const val IDLE_CONSECUTIVE_THRESHOLD = 2
        private const val IDLE_DISTANCE_THRESHOLD = 50.0 // metres — resume if moved this far from idle position
        private const val DRIFT_DISTANCE_CONFIRM = 15.0 // metres — if moved this far from stop, it's real movement (not GPS drift)
        private const val ACTION_NOTIFICATION_DISMISSED = "com.tksync.TRACKING_NOTIFICATION_DISMISSED"

        // MQTT credential keys
        private const val KEY_MQTT_URL = "mqtt_url"
        private const val KEY_MQTT_USERNAME = "mqtt_username"
        private const val KEY_MQTT_PASSWORD = "mqtt_password"
        private const val KEY_MQTT_TOPIC = "mqtt_topic"
        private const val KEY_MQTT_TICKET_CODE = "mqtt_ticket_code"
        private const val KEY_MQTT_TOKEN_ISSUED_AT = "mqtt_token_issued_at"

        // ── Diagnostics ──────────────────────────────────────────────
        // Kill-mode failures happen while JS is dead, so nothing reports them.
        // Worse, when the OEM kills the process and START_STICKY restarts the
        // service with no Activity, React Native never boots — Sentry.init()
        // lives in JS, so a native Sentry call here would be a silent no-op.
        // Persist events instead; JS drains them to Sentry on the next app open.
        private const val KEY_DIAG_EVENTS = "diag_events"
        private const val KEY_DIAG_LAST_FIX_AT = "diag_last_fix_at"
        private const val KEY_DIAG_LAST_SAVE_AT = "diag_last_save_at"
        private const val KEY_DIAG_LAST_PUBLISH_AT = "diag_last_publish_at"
        private const val KEY_DIAG_SYSTEM_RESTARTS = "diag_system_restarts"
        private const val MAX_DIAG_EVENTS = 100 // Bounded — oldest dropped first

        /** Append a diagnostic event. Safe to call from any thread. */
        fun recordDiag(prefs: SharedPreferences, type: String, detail: Map<String, Any?> = emptyMap()) {
            synchronized(diagLock) {
                try {
                    val raw = prefs.getString(KEY_DIAG_EVENTS, "[]") ?: "[]"
                    val events = try { JSONArray(raw) } catch (e: Exception) { JSONArray() }
                    val event = JSONObject().apply {
                        put("t", System.currentTimeMillis())
                        put("type", type)
                        for ((k, v) in detail) put(k, v ?: JSONObject.NULL)
                    }
                    events.put(event)
                    val trimmed = if (events.length() > MAX_DIAG_EVENTS) {
                        JSONArray().also { out ->
                            for (i in (events.length() - MAX_DIAG_EVENTS) until events.length()) {
                                out.put(events.getJSONObject(i))
                            }
                        }
                    } else events
                    // commit() — the process may be killed moments after this call
                    prefs.edit().putString(KEY_DIAG_EVENTS, trimmed.toString()).commit()
                    Log.d(TAG, "DIAG $type ${detail.entries.joinToString(" ") { "${it.key}=${it.value}" }}")
                } catch (e: Exception) {
                    Log.w(TAG, "recordDiag failed: ${e.message}")
                }
            }
        }

        private val diagLock = Any()

        fun getDiagnostics(context: Context): JSONObject {
            val prefs = context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
            val raw = prefs.getString(KEY_DIAG_EVENTS, "[]") ?: "[]"
            return JSONObject().apply {
                put("events", try { JSONArray(raw) } catch (e: Exception) { JSONArray() })
                put("last_fix_at", prefs.getLong(KEY_DIAG_LAST_FIX_AT, 0L))
                put("last_save_at", prefs.getLong(KEY_DIAG_LAST_SAVE_AT, 0L))
                put("last_publish_at", prefs.getLong(KEY_DIAG_LAST_PUBLISH_AT, 0L))
                put("system_restarts", prefs.getInt(KEY_DIAG_SYSTEM_RESTARTS, 0))
                put("tracking_active", prefs.getBoolean(KEY_ACTIVE, false))
                put("js_alive", prefs.getBoolean(KEY_JS_ALIVE, false))
                put("idle_mode", prefs.getBoolean(KEY_IDLE, false))
                put("now", System.currentTimeMillis())
            }
        }

        fun clearDiagnostics(context: Context) {
            val prefs = context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
            prefs.edit().putString(KEY_DIAG_EVENTS, "[]").apply()
        }
        // MQTT token TTL is 1 hour — refresh 5 minutes early, same lead JS uses.
        private const val MQTT_TOKEN_REFRESH_AFTER_MS = 55 * 60 * 1000L

        fun setJsAlive(context: Context, alive: Boolean) {
            val prefs = context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
            // commit() (synchronous) ensures native saveLocation() sees the updated flag
            // immediately — apply() could race if native reads before async write completes.
            prefs.edit()
                .putBoolean(KEY_JS_ALIVE, alive)
                .putLong(KEY_JS_HEARTBEAT, if (alive) System.currentTimeMillis() else 0L)
                .commit()
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
                // Carry idle through: onStartCommand reads the extra with a false
                // default, so omitting it here silently turned idle mode off.
                intent.putExtra("idle", prefs.getBoolean(KEY_IDLE, false))
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

        fun setApiCredentials(context: Context, baseUrl: String, token: String, refreshToken: String?) {
            val prefs = context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
            val editor = prefs.edit()
                .putString(KEY_API_BASE_URL, baseUrl)
                .putString(KEY_API_TOKEN, token)
            if (refreshToken != null) {
                editor.putString(KEY_REFRESH_TOKEN, refreshToken)
            }
            editor.apply()
            Log.d(TAG, "API credentials updated — baseUrl: $baseUrl")
        }

        fun updateApiToken(context: Context, token: String) {
            val prefs = context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
            prefs.edit().putString(KEY_API_TOKEN, token).apply()
            Log.d(TAG, "API token updated")
        }

        fun setMqttCredentials(context: Context, url: String, username: String, password: String, topic: String, ticketCode: String) {
            val prefs = context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
            prefs.edit()
                .putString(KEY_MQTT_URL, url)
                .putString(KEY_MQTT_USERNAME, username)
                .putString(KEY_MQTT_PASSWORD, password)
                .putString(KEY_MQTT_TOPIC, topic)
                .putString(KEY_MQTT_TICKET_CODE, ticketCode)
                .putLong(KEY_MQTT_TOKEN_ISSUED_AT, System.currentTimeMillis())
                .apply()
            Log.d(TAG, "MQTT credentials updated — topic: $topic")
            // Reconnect with the new credentials, do not just connectMqtt(): that
            // returns immediately while a client is connected, so every rotated token
            // was ignored and native kept publishing with the old one until the broker
            // rejected it twice.
            instance?.let { svc ->
                Handler(Looper.getMainLooper()).post {
                    svc.disconnectMqtt()
                    svc.connectMqtt()
                }
            }
        }

        fun clearMqttCredentials(context: Context) {
            val prefs = context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
            prefs.edit()
                .remove(KEY_MQTT_URL)
                .remove(KEY_MQTT_USERNAME)
                .remove(KEY_MQTT_PASSWORD)
                .remove(KEY_MQTT_TOPIC)
                .remove(KEY_MQTT_TICKET_CODE)
                .remove(KEY_MQTT_TOKEN_ISSUED_AT)
                .apply()
            Log.d(TAG, "MQTT credentials cleared")
        }

        fun isActive(context: Context): Boolean {
            val prefs = context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
            return prefs.getBoolean(KEY_ACTIVE, false)
        }

        /** Whether the service is genuinely running RIGHT NOW, as opposed to
         *  isActive() which only reports the persisted intent flag.
         *
         *  These diverge in the case that matters: if the process dies, the flag
         *  stays true while the service is gone, and START_STICKY does not always
         *  bring a foreground service back. `instance` is null in a fresh process,
         *  so this is an accurate liveness check — the service only ever runs in
         *  the app's main process. */
        fun isServiceRunning(): Boolean = instance != null

        fun getTicketId(context: Context): Int {
            val prefs = context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
            return prefs.getInt(KEY_TICKET_ID, 0)
        }
    }

    private lateinit var fusedClient: FusedLocationProviderClient
    private lateinit var locationCallback: LocationCallback
    private lateinit var prefs: SharedPreferences
    private val prefsLock = Any() // Synchronizes SharedPrefs record read/write across threads
    private var ticketId: Int = 0
    private var isSilent: Boolean = false
    private var isIdleMode: Boolean = false
    private var consecutiveIdleCount: Int = 0
    private var idleLat: Double = 0.0
    private var idleLng: Double = 0.0
    private var wasStationary: Boolean = false // true after first stationary fix is saved — suppresses drift
    private var stationaryLat: Double = 0.0 // WHERE the truck stopped (for distance-based confirmation)
    private var stationaryLng: Double = 0.0
    private var consecutiveMovingCount: Int = 0
    private val MOVING_CONFIRM_THRESHOLD = 2 // Require 2 consecutive moving fixes to clear stationary
    private var lastSavedLat: Double? = null
    private var lastSavedLng: Double? = null
    private var lastSavedTime: Long = 0L // GPS timestamp (ms) of last saved location — for teleport detection
    private var firstGoodFixTime: Long = 0L // When GPS first achieved <25m accuracy — enables strict filter
    private var consecutiveAccuracyRejects = 0 // Resets the strict gate when GPS degrades for a sustained stretch
    private val ACCURACY_REWARMUP_REJECTS = 10 // ~10s of rejections — re-open the gate to 50m
    private var pendingRecords = JSONArray() // Buffer writes to reduce SharedPrefs I/O
    private var pendingCount = 0
    private val WRITE_BATCH_SIZE = 1 // Flush to SharedPrefs immediately — ensures no records lost on foreground transition
    private val isoFormat = SimpleDateFormat("yyyy-MM-dd'T'HH:mm:ss.SSS'Z'", Locale.US).apply {
        timeZone = TimeZone.getTimeZone("UTC")
    }

    /**
     * A point older than this when it reaches the broker was not captured live:
     * it sat in the offline queue. The server writes it into route history as
     * normal but skips the "current position" update, so the live marker does
     * not walk backwards through the backlog while it drains.
     *
     * Same 60s rule as mqttService.publish() on the JS side — the two paths must
     * agree, otherwise the dashboard sees the same record flagged differently
     * depending on which one happened to send it.
     */
    private val BACKFILL_AFTER_MS = 60_000L
    private val backfillFormat = SimpleDateFormat("yyyy-MM-dd'T'HH:mm:ss.SSS'Z'", Locale.US).apply {
        timeZone = TimeZone.getTimeZone("UTC")
    }

    /** Epoch millis for a record's recorded_at, or 0 when it cannot be parsed.
     *  Unparseable records sort to the front of a replay — they are the oldest
     *  thing we can prove, and holding them back would reorder the rest. */
    private fun parseRecordedAt(recordedAt: String): Long {
        if (recordedAt.isEmpty()) return 0L
        // SimpleDateFormat is not thread-safe and replay runs off the main thread.
        return synchronized(backfillFormat) {
            try { backfillFormat.parse(recordedAt)?.time } catch (e: Exception) { null }
        } ?: 0L
    }

    private fun isBackfill(recordedAt: String): Boolean {
        val t = parseRecordedAt(recordedAt)
        if (t == 0L) return false
        return System.currentTimeMillis() - t > BACKFILL_AFTER_MS
    }
    private val uploadHandler = Handler(Looper.getMainLooper())
    private val permissionRetryHandler = Handler(Looper.getMainLooper())
    private val PERMISSION_RETRY_MS = 60_000L // Retry requestLocationUpdates after a SecurityException

    // ─── Native MQTT ─────────────────────────────────────────────────
    private var mqttClient: MqttAsyncClient? = null
    private var mqttTopic: String? = null
    private var lastMqttConnectAttempt: Long = 0L
    private val MQTT_RECONNECT_COOLDOWN_MS = 30_000L

    override fun onCreate() {
        super.onCreate()
        instance = this
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
        // If intent is null, service was restarted by Android after being killed in background.
        // Resume GPS tracking using saved state from SharedPrefs instead of stopping.
        if (intent == null) {
            val wasActive = prefs.getBoolean(KEY_ACTIVE, false)
            if (!wasActive) {
                Log.d(TAG, "Service restarted by system but tracking was inactive — stopping")
                stopSelf()
                return START_NOT_STICKY
            }
            Log.d(TAG, "Service restarted by system — resuming GPS from SharedPrefs")
            // The process was killed and START_STICKY brought the service back with
            // no Activity, so React Native never booted. This is the single most
            // useful signal for "kill mode worked yesterday and not today".
            val restarts = prefs.getInt(KEY_DIAG_SYSTEM_RESTARTS, 0) + 1
            prefs.edit().putInt(KEY_DIAG_SYSTEM_RESTARTS, restarts).commit()
            recordDiag(prefs, "service_restarted_by_system", mapOf(
                "restart_count" to restarts,
                "gap_since_last_save_ms" to (System.currentTimeMillis() - prefs.getLong(KEY_DIAG_LAST_SAVE_AT, 0L)),
            ))
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

        // Samsung One UI may not display the foreground notification on first cold start
        // (seen=false in NotificationManager). Cancel and re-post after delay to force visibility.
        if (!isSilent) {
            val handler = Handler(Looper.getMainLooper())
            handler.postDelayed({
                try {
                    val manager = getSystemService(NotificationManager::class.java)
                    // Cancel the existing notification first
                    manager.cancel(NOTIFICATION_ID)
                    // Re-post after a brief pause so Samsung registers it as new
                    handler.postDelayed({
                        try {
                            val freshNotification = buildNotification()
                            manager.notify(NOTIFICATION_ID, freshNotification)
                            Log.d(TAG, "Notification cancel+re-posted for Samsung visibility")
                        } catch (e: Exception) {
                            Log.w(TAG, "Notification re-post failed: ${e.message}")
                        }
                    }, 500)
                } catch (e: Exception) {
                    Log.w(TAG, "Notification cancel failed: ${e.message}")
                }
            }, 3000)
        }

        // Remove old location updates before starting new ones (prevents duplicates on restart)
        fusedClient.removeLocationUpdates(locationCallback)
        startLocationUpdates()
        scheduleUpload()

        // Connect native MQTT early so it's ready when app goes to background
        connectMqtt()

        // Register receiver to re-post notification if user dismisses it (Android 13+)
        registerNotificationDismissReceiver()

        Log.d(TAG, "Service started — ticket: $ticketId, silent: $isSilent, idle: $isIdleMode, START_STICKY")
        return START_STICKY
    }

    override fun onDestroy() {
        super.onDestroy()
        instance = null
        unregisterNotificationDismissReceiver()
        fusedClient.removeLocationUpdates(locationCallback)
        uploadHandler.removeCallbacksAndMessages(null)
        permissionRetryHandler.removeCallbacksAndMessages(null)
        // Flush any buffered records before dying
        if (pendingCount > 0) {
            flushPendingRecords()
        }
        disconnectMqtt()
        // tracking_active still true here means we were NOT stopped through
        // LocationTrackingService.stop() — something external tore us down.
        recordDiag(prefs, "service_destroyed", mapOf(
            "tracking_active" to prefs.getBoolean(KEY_ACTIVE, false),
            "unexpected" to prefs.getBoolean(KEY_ACTIVE, false),
        ))
        Log.d(TAG, "Service destroyed")
    }

    private fun flushPendingRecords() {
        if (pendingCount == 0) return
        synchronized(prefsLock) {
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

            prefs.edit().putString(KEY_RECORDS, toWrite.toString()).commit()
            Log.d(TAG, "Flushed $pendingCount records to SharedPrefs (total: ${toWrite.length()})")
            pendingRecords = JSONArray()
            pendingCount = 0
        }
    }

    override fun onBind(intent: Intent?): IBinder? = null

    override fun onTaskRemoved(rootIntent: Intent?) {
        super.onTaskRemoved(rootIntent)
        // App swiped away — flush buffered records, let native continue tracking.
        // Do NOT set KEY_ACTIVE=false or call stopSelf() — START_STICKY will restart
        // the service, and it should resume GPS collection in background.
        if (pendingCount > 0) {
            flushPendingRecords()
        }
        // JS is dead after app swipe — native takes over GPS recording.
        // commit() ensures the flag is written before the process dies.
        prefs.edit().putBoolean(KEY_JS_ALIVE, false).commit()
        recordDiag(prefs, "task_removed", mapOf("pending_flushed" to pendingCount))
        Log.d(TAG, "Task removed (app killed) — flushed records, native GPS continues")
    }

    // ─── Native MQTT Connection ──────────────────────────────────────

    private fun convertMqttUrl(rawUrl: String): String {
        // Convert JS mqtt library URL schemes to Paho-compatible schemes
        return when {
            rawUrl.startsWith("mqtt://") -> rawUrl.replaceFirst("mqtt://", "tcp://")
            rawUrl.startsWith("mqtts://") -> rawUrl.replaceFirst("mqtts://", "ssl://")
            else -> rawUrl // ws:// and wss:// are supported by Paho 1.2+
        }
    }

    /** Refresh MQTT token via REST API when the current token has expired.
     *  Called from background thread when MQTT auth fails after app kill. */
    private fun refreshMqttTokenViaApi() {
        val baseUrl = prefs.getString(KEY_API_BASE_URL, "") ?: ""
        val apiToken = prefs.getString(KEY_API_TOKEN, "") ?: ""
        if (baseUrl.isEmpty() || apiToken.isEmpty()) {
            Log.d(TAG, "MQTT token refresh: no API credentials — skipping")
            return
        }

        Thread {
            var conn: java.net.HttpURLConnection? = null
            try {
                val url = java.net.URL("$baseUrl/tracking/mqtt-token")
                conn = url.openConnection() as java.net.HttpURLConnection
                conn.requestMethod = "POST"
                conn.setRequestProperty("Content-Type", "application/json")
                conn.setRequestProperty("Authorization", "Bearer $apiToken")
                conn.connectTimeout = 10000
                conn.readTimeout = 10000
                conn.doInput = true

                val responseCode = conn.responseCode
                if (responseCode == 200) {
                    val body = conn.inputStream.bufferedReader().readText()
                    val json = JSONObject(body)
                    if (json.optBoolean("success", false)) {
                        val data = json.getJSONObject("data")
                        val newUrl = data.getString("url")
                        val newUsername = data.getString("username")
                        val newToken = data.getString("token")
                        val newTopic = data.getString("topic")

                        prefs.edit()
                            .putString(KEY_MQTT_URL, newUrl)
                            .putString(KEY_MQTT_USERNAME, newUsername)
                            .putString(KEY_MQTT_PASSWORD, newToken)
                            .putString(KEY_MQTT_TOPIC, newTopic)
                            .putLong(KEY_MQTT_TOKEN_ISSUED_AT, System.currentTimeMillis())
                            .apply()

                        Log.d(TAG, "MQTT token refreshed via API — reconnecting")
                        Handler(Looper.getMainLooper()).post {
                            disconnectMqtt()
                            connectMqtt()
                        }
                    } else {
                        Log.w(TAG, "MQTT token refresh: API returned success=false")
                    }
                } else if (responseCode == 401) {
                    Log.w(TAG, "MQTT token refresh: API token expired (401) — refreshing access token")
                    if (refreshApiAccessToken()) {
                        // Retry MQTT token refresh with new access token
                        Handler(Looper.getMainLooper()).postDelayed({ refreshMqttTokenViaApi() }, 1000)
                    }
                } else {
                    Log.w(TAG, "MQTT token refresh: HTTP $responseCode")
                }
            } catch (e: Exception) {
                Log.w(TAG, "MQTT token refresh failed: ${e.message}")
            } finally {
                conn?.disconnect()
            }
        }.start()
    }

    /**
     * Refresh the API access_token using the stored refresh_token.
     * Called when refreshMqttTokenViaApi() gets a 401 (access_token expired).
     * Returns true if the token was refreshed successfully.
     */
    private fun refreshApiAccessToken(): Boolean {
        val baseUrl = prefs.getString(KEY_API_BASE_URL, "") ?: ""
        val refreshToken = prefs.getString(KEY_REFRESH_TOKEN, "") ?: ""
        if (baseUrl.isEmpty() || refreshToken.isEmpty()) {
            Log.w(TAG, "API token refresh: no refresh_token — cannot refresh")
            return false
        }

        var conn: java.net.HttpURLConnection? = null
        return try {
            val url = java.net.URL("$baseUrl/auth/refresh-token")
            conn = url.openConnection() as java.net.HttpURLConnection
            conn.requestMethod = "POST"
            conn.setRequestProperty("Content-Type", "application/json")
            conn.connectTimeout = 10000
            conn.readTimeout = 10000
            conn.doInput = true
            conn.doOutput = true

            val body = JSONObject().apply {
                put("refresh_token", refreshToken)
            }
            conn.outputStream.bufferedWriter().use { it.write(body.toString()) }

            if (conn.responseCode == 200) {
                val responseBody = conn.inputStream.bufferedReader().readText()
                val json = JSONObject(responseBody)
                if (json.optBoolean("success", false)) {
                    val newAccessToken = json.getJSONObject("data").getString("access_token")
                    prefs.edit().putString(KEY_API_TOKEN, newAccessToken).apply()
                    Log.d(TAG, "API access_token refreshed via refresh_token")
                    true
                } else {
                    Log.w(TAG, "API token refresh: success=false")
                    false
                }
            } else {
                Log.w(TAG, "API token refresh: HTTP ${conn.responseCode} — refresh_token may be expired")
                false
            }
        } catch (e: Exception) {
            Log.w(TAG, "API token refresh failed: ${e.message}")
            false
        } finally {
            conn?.disconnect()
        }
    }

    private var mqttAuthFailureCount = 0
    private val MAX_MQTT_AUTH_FAILURES = 2 // Refresh token after 2 consecutive auth failures

    private fun connectMqtt() {
        if (mqttClient?.isConnected == true) return

        val url = prefs.getString(KEY_MQTT_URL, "") ?: ""
        val username = prefs.getString(KEY_MQTT_USERNAME, "") ?: ""
        val password = prefs.getString(KEY_MQTT_PASSWORD, "") ?: ""
        val topic = prefs.getString(KEY_MQTT_TOPIC, "") ?: ""

        if (url.isEmpty() || password.isEmpty() || topic.isEmpty()) {
            Log.d(TAG, "MQTT: No credentials — skipping connect")
            return
        }

        mqttTopic = topic

        try {
            // Disconnect any old stale client first
            try { mqttClient?.close(true) } catch (_: Exception) {}
            mqttClient = null

            val pahoUrl = convertMqttUrl(url)
            val clientId = "tksync_native_${username}_${System.currentTimeMillis()}"
            val client = MqttAsyncClient(pahoUrl, clientId, MemoryPersistence())

            client.setCallback(object : MqttCallbackExtended {
                override fun connectComplete(reconnect: Boolean, serverURI: String?) {
                    Log.d(TAG, "MQTT ${if (reconnect) "reconnected" else "connected"} — $serverURI")
                    mqttAuthFailureCount = 0 // Reset on successful connect
                    // Replay offline records saved while MQTT was disconnected.
                    // NOT gated on `reconnect`: ensureMqttConnected() tears the client
                    // down and builds a fresh one every 30s while JS is dead, so that
                    // recovery path always reports reconnect=false. Gating on it meant
                    // records collected after an app kill were saved locally and never
                    // published until the driver reopened the app. replayOfflineRecords()
                    // skips already-synced records and the server dedupes on client_id.
                    replayOfflineRecords()
                }
                override fun connectionLost(cause: Throwable?) {
                    Log.w(TAG, "MQTT connection lost: ${cause?.message}")
                    // Detect auth failure (broker rejects expired token) — trigger token refresh
                    val msg = cause?.message?.lowercase() ?: ""
                    val isAuthError = msg.contains("not authorized") ||
                        msg.contains("bad user name or password") ||
                        msg.contains("connack") && msg.contains("5") ||
                        cause is MqttSecurityException
                    if (isAuthError) {
                        mqttAuthFailureCount++
                        Log.w(TAG, "MQTT auth failure #$mqttAuthFailureCount — token may be expired")
                        recordDiag(prefs, "mqtt_auth_failure", mapOf(
                            "count" to mqttAuthFailureCount,
                            "token_age_ms" to (System.currentTimeMillis() - prefs.getLong(KEY_MQTT_TOKEN_ISSUED_AT, 0L)),
                        ))
                        if (mqttAuthFailureCount >= MAX_MQTT_AUTH_FAILURES) {
                            mqttAuthFailureCount = 0
                            refreshMqttTokenViaApi()
                        }
                    }
                }
                override fun messageArrived(topic: String?, message: MqttMessage?) {}
                override fun deliveryComplete(token: IMqttDeliveryToken?) {}
            })

            val opts = MqttConnectOptions().apply {
                this.userName = username
                this.password = password.toCharArray()
                isCleanSession = true
                connectionTimeout = 10
                keepAliveInterval = 60
                isAutomaticReconnect = true
            }

            // Assign BEFORE connect(): connectComplete() fires on the Paho thread and
            // calls replayOfflineRecords(), which bails when mqttClient is still null.
            mqttClient = client

            client.connect(opts, null, object : IMqttActionListener {
                override fun onSuccess(asyncActionToken: IMqttToken?) {
                    Log.d(TAG, "MQTT connected — topic: $topic")
                    mqttAuthFailureCount = 0
                }
                override fun onFailure(asyncActionToken: IMqttToken?, exception: Throwable?) {
                    Log.w(TAG, "MQTT connect failed: ${exception?.message}")
                    // Check if this is an auth failure on initial connect
                    if (exception is MqttSecurityException ||
                        exception?.message?.lowercase()?.contains("not authorized") == true) {
                        mqttAuthFailureCount++
                        Log.w(TAG, "MQTT initial auth failure #$mqttAuthFailureCount")
                        if (mqttAuthFailureCount >= MAX_MQTT_AUTH_FAILURES) {
                            mqttAuthFailureCount = 0
                            refreshMqttTokenViaApi()
                        }
                    }
                }
            })

            lastMqttConnectAttempt = System.currentTimeMillis()
        } catch (e: Exception) {
            Log.e(TAG, "MQTT connect error: ${e.message}")
            mqttClient = null
        }
    }

    private fun disconnectMqtt() {
        try {
            // close(true) below forces the client shut even mid-reconnect. The old
            // setManualAcks(false) call here claimed to stop auto-reconnect; it does
            // not — it controls manual message acknowledgement and did nothing.
            if (mqttClient?.isConnected == true) {
                mqttClient?.disconnect()
            }
        } catch (e: Exception) {
            Log.w(TAG, "MQTT disconnect error: ${e.message}")
        }
        try {
            mqttClient?.close(true)
        } catch (_: Exception) {}
        mqttClient = null
        mqttTopic = null
        Log.d(TAG, "MQTT disconnected")
    }

    private fun ensureMqttConnected() {
        if (mqttClient?.isConnected == true) return

        // Cooldown — don't hammer reconnect attempts
        val now = System.currentTimeMillis()
        if (now - lastMqttConnectAttempt < MQTT_RECONNECT_COOLDOWN_MS) return
        lastMqttConnectAttempt = now

        // Tear down stale client and reconnect with fresh credentials from SharedPrefs
        disconnectMqtt()
        connectMqtt()
    }

    /** Get battery level as percentage (0-100), or -1 on failure. */
    private fun getBatteryPercent(): Int {
        return try {
            val bm = getSystemService(Context.BATTERY_SERVICE) as BatteryManager
            bm.getIntProperty(BatteryManager.BATTERY_PROPERTY_CAPACITY)
        } catch (e: Exception) {
            -1
        }
    }

    private val REPLAY_BATCH_SIZE = 20 // Publish in batches to avoid flooding broker
    private val MAX_REPLAY_PASSES = 5  // Live fixes arriving mid-replay get swept by a later pass

    /** True while the backlog is draining. publishToMqtt holds live fixes until it clears. */
    @Volatile private var replaying = false
    /** Wall-clock cap on that hold, so a stalled broker cannot freeze the live map. */
    @Volatile private var replayHoldUntil = 0L
    private val MAX_LIVE_HOLD_MS = 60_000L
    private val DELIVERY_TIMEOUT_MS = 10_000L // Per QoS 1 batch — see confirmDelivered()

    /**
     * Replay stored GPS records via MQTT after reconnecting, oldest first.
     * Called when native MQTT reconnects in background after an offline period.
     * Records are published with their original client_id so the server deduplicates.
     *
     * Order matters for the live view only: gps-consumer keeps ONE position per
     * truck in Redis and drops anything older than what it already holds. Sent out
     * of order, every backlog point is rejected on arrival and the dispatch map
     * draws the jump instead of the route. Timescale stores them either way.
     *
     * Runs on a background thread to avoid blocking the Paho callback thread.
     * Publishes in batches of 20 with brief pauses to prevent broker flooding.
     */
    private fun replayOfflineRecords() {
        val client = mqttClient ?: return
        val topic = mqttTopic ?: return
        if (!client.isConnected) return

        val jsAlive = prefs.getBoolean(KEY_JS_ALIVE, false)
        if (jsAlive) return // JS is handling — don't replay from native

        if (replaying) return // Already draining — a second thread would interleave the order
        replaying = true
        // JS polls this before importing native records, so a foreground resume
        // mid-replay waits instead of starting a second, interleaved flush.
        isCurrentlyUploading = true
        // Holding live fixes is only correct while the backlog is actually moving.
        // Without a deadline a stalled broker would freeze the live map indefinitely.
        replayHoldUntil = System.currentTimeMillis() + MAX_LIVE_HOLD_MS

        // Run on background thread to avoid blocking Paho callback thread
        Thread {
            var totalPublished = 0
            var totalBackfilled = 0
            var stillPending = 0
            try {
                // publishToMqtt holds live fixes while `replaying` is set, so each pass
                // sweeps up whatever the truck recorded during the previous one. Bounded
                // so a truck recording faster than we publish cannot spin here forever.
                for (pass in 0 until MAX_REPLAY_PASSES) {
                    // Synchronized read to avoid race with flushPendingRecords on main thread
                    val pending = synchronized(prefsLock) {
                        val stored = getStoredRecords(this)
                        (0 until stored.length())
                            .mapNotNull { stored.optJSONObject(it) }
                            .filter { !it.optBoolean("synced", false) }
                            .sortedBy { parseRecordedAt(it.optString("recorded_at")) }
                    }
                    stillPending = pending.size
                    if (pending.isEmpty()) break

                    val fallbackTicketCode = prefs.getString(KEY_MQTT_TICKET_CODE, "") ?: ""
                    var published = 0
                    var sent = 0
                    val syncedIds = HashSet<String>()

                    // Paho's publish() only means "queued". Marking a record synced on
                    // that alone loses it for good if the process dies before the ACK:
                    // MemoryPersistence drops the message, and JS skips synced records
                    // when it imports. Confirm QoS 1 delivery before writing the flag.
                    val inFlight = ArrayList<Pair<String, IMqttDeliveryToken>>()
                    fun confirmDelivered() {
                        for ((id, token) in inFlight) {
                            try { token.waitForCompletion(DELIVERY_TIMEOUT_MS) } catch (_: Exception) {}
                            if (token.isComplete && token.exception == null) {
                                syncedIds.add(id)
                                published++
                            }
                        }
                        inFlight.clear()
                    }

                    for (r in pending) {
                        if (client != mqttClient || !client.isConnected) break // Client changed or disconnected
                        try {
                            val payload = JSONObject().apply {
                                put("latitude", r.optDouble("latitude"))
                                put("longitude", r.optDouble("longitude"))
                                put("speed", r.optDouble("speed"))
                                put("heading", r.optDouble("heading"))
                                put("accuracy", r.optDouble("accuracy"))
                                put("recorded_at", r.optString("recorded_at"))
                                put("ticket_id", r.optInt("ticket_id"))
                                put("ticket_code", r.optString("ticket_code").ifEmpty { fallbackTicketCode })
                                put("client_id", r.optString("id"))
                                // Use battery stored at record time — accurate for offline replays
                                put("battery_level", r.opt("battery_level") ?: JSONObject.NULL)
                                put("backfill", isBackfill(r.optString("recorded_at")).also {
                                    if (it) totalBackfilled++
                                })
                            }
                            val message = MqttMessage(payload.toString().toByteArray(Charsets.UTF_8))
                            message.qos = 1
                            inFlight.add(r.optString("id") to client.publish(topic, message))
                            sent++

                            // Confirm and pause between batches to avoid flooding broker
                            if (sent % REPLAY_BATCH_SIZE == 0) {
                                confirmDelivered()
                                Thread.sleep(200)
                            }
                        } catch (e: Exception) {
                            Log.w(TAG, "MQTT replay error after $sent sent: ${e.message}")
                            break // Stop on error (e.g. "Too many publishes in progress")
                        }
                    }
                    confirmDelivered()

                    // Re-read inside the lock before writing. Publishing takes seconds, and
                    // saveLocation()/flushPendingRecords() appends new records the whole time —
                    // writing back the list we read at the top of this pass would erase them.
                    if (syncedIds.isNotEmpty()) {
                        synchronized(prefsLock) {
                            val current = getStoredRecords(this)
                            for (i in 0 until current.length()) {
                                val r = current.optJSONObject(i) ?: continue
                                if (syncedIds.contains(r.optString("id"))) {
                                    r.put("synced", true)
                                }
                            }
                            prefs.edit().putString(KEY_RECORDS, current.toString()).apply()
                        }
                    }

                    totalPublished += published
                    stillPending = pending.size - published
                    if (published == 0) break // Nothing moved — another pass will not help
                }

                if (totalPublished == 0 && stillPending == 0) return@Thread

                Log.d(TAG, "MQTT replayed $totalPublished offline records oldest-first ($stillPending left)")
                // [CHECK] lines make an on-device E2E run verifiable from logcat.
                if (stillPending == 0) {
                    Log.i(TAG, "[CHECK] PASS native replay — all $totalPublished records published in time order, $totalBackfilled flagged backfill")
                } else {
                    Log.w(TAG, "[CHECK] FAIL native replay — $stillPending of ${totalPublished + stillPending} not published")
                    recordDiag(prefs, "replay_incomplete", mapOf(
                        "total" to (totalPublished + stillPending),
                        "published" to totalPublished,
                        "missing" to stillPending
                    ))
                }
            } catch (e: Exception) {
                Log.w(TAG, "MQTT replay thread error: ${e.message}")
            } finally {
                // ponytail: a fix landing between the last pass and this line waits for
                // the next reconnect replay. It stays unsynced in prefs, so nothing is
                // lost; add a post-drain sweep if that window ever shows up in practice.
                replaying = false
                replayHoldUntil = 0L
                isCurrentlyUploading = false
            }
        }.start()
    }

    private fun publishToMqtt(record: JSONObject) {
        val client = mqttClient ?: return
        val topic = mqttTopic ?: return

        if (!client.isConnected) return // Will retry on next GPS fix via ensureMqttConnected

        // Hold live fixes while the offline backlog drains. The live pipeline keeps
        // only the newest position per truck, so one live point jumping the queue
        // makes every older replayed point stale on arrival. The record is already
        // stored unsynced, so the replay's next pass publishes it in time order.
        if (replaying && System.currentTimeMillis() < replayHoldUntil) {
            Log.d(TAG, "[CHECK] live fix held — backlog replaying, publishes in time order")
            return
        }

        val ticketCode = prefs.getString(KEY_MQTT_TICKET_CODE, "") ?: ""

        try {
            val payload = JSONObject().apply {
                put("latitude", record.optDouble("latitude"))
                put("longitude", record.optDouble("longitude"))
                put("speed", record.optDouble("speed"))
                put("heading", record.optDouble("heading"))
                put("accuracy", record.optDouble("accuracy"))
                put("recorded_at", record.optString("recorded_at"))
                put("ticket_id", record.optInt("ticket_id"))
                put("ticket_code", ticketCode)
                put("client_id", record.optString("id"))
                // Use battery stored at record time — accurate even for offline replays
                put("battery_level", record.opt("battery_level") ?: JSONObject.NULL)
                put("backfill", isBackfill(record.optString("recorded_at")))
            }

            val message = MqttMessage(payload.toString().toByteArray(Charsets.UTF_8))
            message.qos = 1

            client.publish(topic, message, null, object : IMqttActionListener {
                override fun onSuccess(asyncActionToken: IMqttToken?) {
                    prefs.edit().putLong(KEY_DIAG_LAST_PUBLISH_AT, System.currentTimeMillis()).apply()
                    Log.d(TAG, "MQTT published — lat: ${String.format("%.6f", record.optDouble("latitude"))}, speed: ${String.format("%.1f", record.optDouble("speed"))}")
                }
                override fun onFailure(asyncActionToken: IMqttToken?, exception: Throwable?) {
                    Log.w(TAG, "MQTT publish failed: ${exception?.message}")
                    recordDiag(prefs, "mqtt_publish_failed", mapOf("error" to (exception?.message ?: "unknown")))
                }
            })
        } catch (e: Exception) {
            Log.w(TAG, "MQTT publish error: ${e.message}")
        }
    }

    // ─── Notifications ───────────────────────────────────────────────

    private fun createNotificationChannels() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            val manager = getSystemService(NotificationManager::class.java)

            // Only create channels if they don't exist — preserves user's notification preferences
            if (manager.getNotificationChannel(CHANNEL_ID) == null) {
                val trackingChannel = NotificationChannel(
                    CHANNEL_ID,
                    "Vehicle Tracking",
                    NotificationManager.IMPORTANCE_HIGH
                ).apply {
                    description = "GPS tracking for deliveries"
                    setSound(null, null)
                    enableVibration(false)
                    enableLights(false)
                }
                manager.createNotificationChannel(trackingChannel)
            }

            if (manager.getNotificationChannel(SILENT_CHANNEL_ID) != null) return

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

    private var notificationDismissReceiver: android.content.BroadcastReceiver? = null

    private fun registerNotificationDismissReceiver() {
        if (notificationDismissReceiver != null) return
        notificationDismissReceiver = object : android.content.BroadcastReceiver() {
            override fun onReceive(context: android.content.Context?, intent: android.content.Intent?) {
                if (intent?.action == ACTION_NOTIFICATION_DISMISSED) {
                    Log.d(TAG, "Notification dismissed by user — re-posting immediately")
                    repostNotification()
                }
            }
        }
        val filter = android.content.IntentFilter(ACTION_NOTIFICATION_DISMISSED)
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            registerReceiver(notificationDismissReceiver, filter, android.content.Context.RECEIVER_NOT_EXPORTED)
        } else {
            registerReceiver(notificationDismissReceiver, filter)
        }
    }

    private fun unregisterNotificationDismissReceiver() {
        notificationDismissReceiver?.let {
            try { unregisterReceiver(it) } catch (_: Exception) {}
            notificationDismissReceiver = null
        }
    }

    /** Re-post the foreground notification after user dismisses it. */
    private fun repostNotification() {
        try {
            val notification = buildNotification()
            val manager = getSystemService(NotificationManager::class.java)
            manager.notify(NOTIFICATION_ID, notification)
        } catch (e: SecurityException) {
            Log.w(TAG, "Cannot repost notification — permission revoked: ${e.message}")
        } catch (e: Exception) {
            Log.w(TAG, "Notification repost failed: ${e.message}")
        }
    }

    private fun buildNotification(): Notification {
        val launchIntent = packageManager.getLaunchIntentForPackage(packageName)
        val pendingIntent = PendingIntent.getActivity(
            this, 0, launchIntent,
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
        )

        // deleteIntent: fires when user swipes away the notification (Android 13+)
        // Our BroadcastReceiver catches this and re-posts the notification immediately.
        val deleteIntent = PendingIntent.getBroadcast(
            this, 0,
            Intent(ACTION_NOTIFICATION_DISMISSED).setPackage(packageName),
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
            val builder = NotificationCompat.Builder(this, CHANNEL_ID)
                .setContentTitle("Vehicle Tracking Active")
                .setContentText("GPS location is being recorded.")
                .setSmallIcon(android.R.drawable.ic_menu_mylocation)
                .setOngoing(true)
                .setAutoCancel(false)
                .setDeleteIntent(deleteIntent)
                .setContentIntent(pendingIntent)
                .setPriority(NotificationCompat.PRIORITY_HIGH)
                .setForegroundServiceBehavior(NotificationCompat.FOREGROUND_SERVICE_IMMEDIATE)

            val notification = builder.build()
            notification.flags = notification.flags or
                Notification.FLAG_NO_CLEAR or
                Notification.FLAG_ONGOING_EVENT
            notification
        }
    }

    // ─── Location Updates ────────────────────────────────────────────

    @Suppress("MissingPermission", "DEPRECATION")
    private fun startLocationUpdates() {
        val isSilentMode = prefs.getBoolean(KEY_SILENT, false)
        val isIdle = prefs.getBoolean(KEY_IDLE, false)
        val request = LocationRequest.create().apply {
            if (isIdle) {
                // Low-frequency when parked — native runs in background 24/7,
                // so this must be battery-friendly. 10s detects movement resume
                // within 10-20s while using 3x less battery than 5s.
                priority = LocationRequest.PRIORITY_HIGH_ACCURACY
                interval = 10000L
                fastestInterval = 5000L
            } else if (isSilentMode) {
                // Lower frequency in silent mode to save battery
                priority = LocationRequest.PRIORITY_HIGH_ACCURACY
                interval = 10000L
                fastestInterval = 5000L
            } else {
                priority = LocationRequest.PRIORITY_HIGH_ACCURACY
                interval = 1000L
                fastestInterval = 1000L
            }
        }

        try {
            fusedClient.requestLocationUpdates(request, locationCallback, Looper.getMainLooper())
            Log.d(TAG, "Location updates started")
        } catch (e: SecurityException) {
            // Do NOT stopSelf() — nothing restarts the service until the driver next
            // opens the app, so a momentarily revoked permission killed tracking for
            // the rest of the shift. Keep the service (and tracking_active) alive and
            // retry, so it recovers on its own the moment permission comes back.
            Log.e(TAG, "Location permission not granted — retrying in ${PERMISSION_RETRY_MS / 1000}s", e)
            recordDiag(prefs, "permission_lost", mapOf("retry_in_ms" to PERMISSION_RETRY_MS))
            permissionRetryHandler.removeCallbacksAndMessages(null)
            permissionRetryHandler.postDelayed({ startLocationUpdates() }, PERMISSION_RETRY_MS)
        }
    }

    private fun saveLocation(location: Location) {
        // Stamp liveness BEFORE any filter — distinguishes "FusedLocation stopped
        // delivering" from "fixes arrived but every one was filtered out".
        prefs.edit().putLong(KEY_DIAG_LAST_FIX_AT, System.currentTimeMillis()).apply()

        // Skip saving if JS is alive (foreground) — JS handles recording + JS MQTT, avoids duplicates
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

        // Graduated accuracy filter: accept up to 50m initially (GPS cold start,
        // urban canyons, bridge transitions), tighten to 25m once we have a good fix.
        val accuracy = location.accuracy.toDouble()
        val STRICT_ACCURACY = 25.0
        val INITIAL_ACCURACY = 50.0
        val WARMUP_MS = 30_000L
        val hasWarmedUp = firstGoodFixTime > 0L && (System.currentTimeMillis() - firstGoodFixTime > WARMUP_MS)
        val accuracyLimit = if (hasWarmedUp) STRICT_ACCURACY else INITIAL_ACCURACY

        if (location.hasAccuracy() && accuracy >= accuracyLimit) {
            consecutiveAccuracyRejects++
            Log.d(TAG, "Skipping inaccurate fix: ${String.format("%.0f", accuracy)}m (limit: ${String.format("%.0f", accuracyLimit)}m)")
            // The strict gate is a one-way ratchet without this: the service lives for
            // days, so one good fix at the start of a shift permanently armed the 25m
            // filter and a later stretch of 30-40m accuracy (parking structure, tunnel,
            // dense downtown) dropped every fix with no recovery path. After a sustained
            // run of rejections, re-open the gate to 50m so the truck reappears.
            if (hasWarmedUp && consecutiveAccuracyRejects >= ACCURACY_REWARMUP_REJECTS) {
                firstGoodFixTime = 0L
                consecutiveAccuracyRejects = 0
                Log.d(TAG, "GPS degraded for $ACCURACY_REWARMUP_REJECTS fixes — re-warming accuracy gate to ${String.format("%.0f", INITIAL_ACCURACY)}m")
                recordDiag(prefs, "accuracy_gate_rewarmed", mapOf("accuracy_m" to accuracy))
            }
            return
        }
        consecutiveAccuracyRejects = 0

        // Track when GPS achieves good accuracy — triggers strict filtering
        if (location.hasAccuracy() && accuracy < STRICT_ACCURACY && firstGoodFixTime == 0L) {
            firstGoodFixTime = System.currentTimeMillis()
            Log.d(TAG, "GPS warmed up — switching to strict accuracy filter (${String.format("%.0f", accuracy)}m)")
        }

        // Skip invalid coordinates — (0,0) "Null Island", NaN, or out-of-range
        if (location.latitude.isNaN() || location.longitude.isNaN() ||
            Math.abs(location.latitude) > 90 || Math.abs(location.longitude) > 180 ||
            (location.latitude == 0.0 && location.longitude == 0.0)) {
            Log.d(TAG, "Skipping invalid coordinates: lat=${location.latitude}, lng=${location.longitude}")
            return
        }

        // Skip GPS teleportation — reject if implied speed > 80 m/s (288 km/h)
        if (lastSavedLat != null && lastSavedLng != null && lastSavedTime > 0L) {
            val timeDeltaS = (location.time - lastSavedTime) / 1000.0
            if (timeDeltaS > 0 && timeDeltaS < 60) {
                val jumpResults = FloatArray(1)
                Location.distanceBetween(lastSavedLat!!, lastSavedLng!!, location.latitude, location.longitude, jumpResults)
                val impliedSpeed = jumpResults[0] / timeDeltaS
                if (impliedSpeed > 80) {
                    Log.d(TAG, "Skipping teleport: ${String.format("%.0f", jumpResults[0].toDouble())}m in ${String.format("%.1f", timeDeltaS)}s = ${String.format("%.0f", impliedSpeed * 3.6)} km/h")
                    return
                }
            }
        }

        val speedAvailable = location.hasSpeed() && location.speed >= 0f
        val speedMs = if (speedAvailable) location.speed.toDouble() else 0.0
        val speedKmh = speedMs * 3.6
        val isSpeeding = speedKmh > 80.0
        val isIdle = !speedAvailable || speedMs < IDLE_SPEED_THRESHOLD
        val isConfirmedMoving = speedAvailable && speedMs >= IDLE_SPEED_THRESHOLD

        // ── Stationary drift suppression ──────────────────────────────
        var suppressDrift = false
        var isFirstStop = false

        if (isConfirmedMoving) {
            consecutiveMovingCount++

            // Distance-based confirmation: if truck moved far enough from stop position,
            // it's definitely real movement (GPS drift is typically <10m)
            var distFromStop = 0.0
            if (wasStationary && stationaryLat != 0.0) {
                val stopResults = FloatArray(1)
                Location.distanceBetween(stationaryLat, stationaryLng, location.latitude, location.longitude, stopResults)
                distFromStop = stopResults[0].toDouble()
            }

            if (consecutiveMovingCount >= MOVING_CONFIRM_THRESHOLD || distFromStop >= DRIFT_DISTANCE_CONFIRM) {
                wasStationary = false
                stationaryLat = 0.0
                stationaryLng = 0.0
                Log.d(TAG, "MOVEMENT CONFIRMED: $consecutiveMovingCount consecutive, speed=${String.format("%.1f", speedMs)}, distFromStop=${String.format("%.0f", distFromStop)}m")
            } else if (wasStationary) {
                // Not yet confirmed — discard this fix to prevent GPS drift from:
                // 1. Being saved/published as real movement
                // 2. Creating zigzag routes on the dashboard
                // Real movement will be captured once MOVING_CONFIRM_THRESHOLD is met.
                Log.d(TAG, "PENDING MOVE: speed=${String.format("%.1f", speedMs)}, movingCount=$consecutiveMovingCount/$MOVING_CONFIRM_THRESHOLD, distFromStop=${String.format("%.0f", distFromStop)}m")
                // Exit idle mode NOW so GPS switches to 1s polling immediately —
                // don't wait for confirmed movement (the next fix at 1s will confirm).
                // Without this, native stays in 10s idle polling and misses GPS data.
                if (isIdleMode) {
                    Log.d(TAG, "PENDING MOVE: exiting idle mode early — resuming 1s polling")
                    isIdleMode = false
                    idleLat = 0.0
                    idleLng = 0.0
                    consecutiveIdleCount = 0
                    prefs.edit().putBoolean(KEY_IDLE, false).apply()
                    fusedClient.removeLocationUpdates(locationCallback)
                    startLocationUpdates()
                }
                return
            }
        } else {
            consecutiveMovingCount = 0
            if (wasStationary) {
                suppressDrift = true
                Log.d(TAG, "DRIFT BLOCKED: speed=${String.format("%.1f", speedMs)}, wasStationary=true, " +
                    "lat=${String.format("%.6f", location.latitude)}, lng=${String.format("%.6f", location.longitude)}")
            } else {
                wasStationary = true
                stationaryLat = location.latitude
                stationaryLng = location.longitude
                isFirstStop = true // Must save — bypass distance filter below
                Log.d(TAG, "FIRST STOP: saving stopped-at, lat=${String.format("%.6f", location.latitude)}, lng=${String.format("%.6f", location.longitude)}")
            }
        }

        // Native idle detection — controls polling frequency
        if (isConfirmedMoving) {
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
                    return
                }
            }
        }

        if (suppressDrift) return

        // Skip if truck hasn't moved enough from last saved position.
        // Exception: first stop record always saved — the stop position matters
        // even if it's < 5m from the last driving position.
        if (!isFirstStop) {
            val minDistance = if (location.hasAccuracy() && accuracy > 15.0) {
                maxOf(10.0, accuracy * 0.75)
            } else {
                5.0
            }
            val prevLat = lastSavedLat
            val prevLng = lastSavedLng
            if (prevLat != null && prevLng != null) {
                val distResults = FloatArray(1)
                Location.distanceBetween(prevLat, prevLng, location.latitude, location.longitude, distResults)
                if (distResults[0] < minDistance.toFloat()) {
                    return
                }
            }
        }
        lastSavedLat = location.latitude
        lastSavedLng = location.longitude
        lastSavedTime = location.time

        val battery = getBatteryPercent()
        val record = JSONObject().apply {
            put("ticket_id", ticketId)
            put("latitude", location.latitude)
            put("longitude", location.longitude)
            put("speed", speedMs)
            put("heading", if (location.hasBearing()) location.bearing.toDouble() else 0.0)
            put("altitude", location.altitude)
            put("accuracy", location.accuracy.toDouble())
            put("recorded_at", isoFormat.format(Date(location.time)))
            put("synced", false)
            put("id", "native_${System.currentTimeMillis()}_${UUID.randomUUID().toString().take(8)}")
            put("is_speeding", isSpeeding)
            put("is_idle", isIdle)
            put("battery_level", if (battery >= 0) battery else JSONObject.NULL)
            // Captured now, not read live at replay time — a backlog flushing after
            // the driver moved to a new ticket would otherwise pair this record's
            // ticket_id with whatever code is current. Mirrors GpsRecord.ticket_code.
            put("ticket_code", prefs.getString(KEY_MQTT_TICKET_CODE, "") ?: "")
        }

        pendingRecords.put(record)
        pendingCount++
        prefs.edit().putLong(KEY_DIAG_LAST_SAVE_AT, System.currentTimeMillis()).apply()

        // Publish via native MQTT (works reliably in background)
        ensureMqttConnected()
        publishToMqtt(record)

        // Also emit to JS bridge as fallback (server deduplicates by client_id)
        try {
            onGpsRecord?.invoke(record)
        } catch (e: Exception) {
            Log.w(TAG, "onGpsRecord callback error: ${e.message}")
        }

        // Batch writes — flush to SharedPrefs every WRITE_BATCH_SIZE records
        if (pendingCount >= WRITE_BATCH_SIZE) {
            flushPendingRecords()
        }

        Log.d(TAG, "GPS (pending: $pendingCount) | lat: ${String.format("%.6f", location.latitude)}, " +
                "lng: ${String.format("%.6f", location.longitude)} | " +
                "speed: ${String.format("%.1f", speedMs)} m/s | ticket: $ticketId | silent: $isSilent")
    }

    // ─── Background Upload (legacy — kept for compatibility) ─────────

    private fun scheduleUpload() {
        uploadHandler.removeCallbacksAndMessages(null)
        uploadHandler.postDelayed(object : Runnable {
            override fun run() {
                val jsAlive = prefs.getBoolean(KEY_JS_ALIVE, false)
                if (!jsAlive) {
                    // The MQTT token has a 1h TTL and JS refreshes it 5 minutes early —
                    // but that is a JS timer, and it cannot fire while the app is
                    // backgrounded or killed. Native owns the refresh whenever JS is
                    // not alive, instead of waiting for the broker to reject us twice.
                    refreshMqttTokenIfStale()
                    // Ensure MQTT stays connected in background
                    ensureMqttConnected()
                    runWatchdog()
                }
                uploadHandler.postDelayed(this, UPLOAD_INTERVAL_MS)
            }
        }, UPLOAD_INTERVAL_MS)
    }

    // ─── Watchdog ────────────────────────────────────────────────────
    // The dangerous kill-mode failures are silent: no crash, no exception, just
    // an absence of records. Nothing can report what never happened, so poll for
    // the absence itself and latch one event per episode (not per 30s tick).
    private var warnedGpsStalled = false
    private var warnedMqttDown = false
    private var warnedBacklog = false
    private val GPS_STALL_MS = 120_000L      // 4x the 10s idle interval + slack
    private val MQTT_DOWN_MS = 300_000L      // 5 min of failing to publish
    private val BACKLOG_ALERT = 500          // records stranded on disk

    private fun runWatchdog() {
        if (!prefs.getBoolean(KEY_ACTIVE, false)) return
        val now = System.currentTimeMillis()

        // 1. FusedLocation stopped delivering callbacks entirely.
        val lastFix = prefs.getLong(KEY_DIAG_LAST_FIX_AT, 0L)
        if (lastFix > 0L && now - lastFix > GPS_STALL_MS) {
            if (!warnedGpsStalled) {
                warnedGpsStalled = true
                recordDiag(prefs, "gps_stalled", mapOf(
                    "silent_for_ms" to (now - lastFix),
                    "idle_mode" to isIdleMode,
                ))
            }
        } else if (lastFix > 0L) {
            warnedGpsStalled = false
        }

        // 2. Fixes are arriving and being saved, but nothing is reaching the broker.
        val lastSave = prefs.getLong(KEY_DIAG_LAST_SAVE_AT, 0L)
        val lastPublish = prefs.getLong(KEY_DIAG_LAST_PUBLISH_AT, 0L)
        val mqttUp = mqttClient?.isConnected == true
        if (!mqttUp && lastSave > 0L && now - lastPublish > MQTT_DOWN_MS) {
            if (!warnedMqttDown) {
                warnedMqttDown = true
                recordDiag(prefs, "mqtt_down", mapOf(
                    "no_publish_for_ms" to (now - lastPublish),
                    "token_age_ms" to (now - prefs.getLong(KEY_MQTT_TOKEN_ISSUED_AT, 0L)),
                    "has_credentials" to !(prefs.getString(KEY_MQTT_URL, "") ?: "").isEmpty(),
                ))
            }
        } else if (mqttUp) {
            warnedMqttDown = false
        }

        // 3. Records piling up unsent — the shape of the original bug report.
        val stranded = synchronized(prefsLock) {
            val records = getStoredRecords(this)
            var n = 0
            for (i in 0 until records.length()) {
                if (!(records.optJSONObject(i)?.optBoolean("synced", false) ?: true)) n++
            }
            n
        }
        if (stranded >= BACKLOG_ALERT) {
            if (!warnedBacklog) {
                warnedBacklog = true
                recordDiag(prefs, "backlog_growing", mapOf("unsynced" to stranded, "mqtt_connected" to mqttUp))
            }
        } else if (stranded == 0) {
            warnedBacklog = false
        }
    }

    /** Proactively refresh the MQTT token before its 1h TTL expires.
     *  The clock starts when JS hands credentials down (setMqttCredentials) and is
     *  re-stamped on every successful native refresh, so a long background stretch
     *  never publishes with an expired token. */
    private fun refreshMqttTokenIfStale() {
        val issuedAt = prefs.getLong(KEY_MQTT_TOKEN_ISSUED_AT, 0L)
        if (issuedAt <= 0L) return // No credentials yet — nothing to refresh
        if (System.currentTimeMillis() - issuedAt < MQTT_TOKEN_REFRESH_AFTER_MS) return
        // Stamp first so a slow or failing refresh cannot retry every 30 seconds.
        prefs.edit().putLong(KEY_MQTT_TOKEN_ISSUED_AT, System.currentTimeMillis()).apply()
        Log.d(TAG, "MQTT token nearing expiry — refreshing proactively")
        refreshMqttTokenViaApi()
    }

}
