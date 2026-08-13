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
            private set

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
        private const val UPLOAD_BATCH_SIZE = 50
        private const val UPLOAD_INTERVAL_MS = 30_000L // Upload every 30 seconds
        private const val IDLE_SPEED_THRESHOLD = 1.0 // m/s ≈ 3.6 km/h — only truly stopped
        private const val IDLE_CONSECUTIVE_THRESHOLD = 3
        private const val IDLE_DISTANCE_THRESHOLD = 50.0 // metres — resume if moved this far from idle position
        private const val ACTION_NOTIFICATION_DISMISSED = "com.tksync.TRACKING_NOTIFICATION_DISMISSED"

        // MQTT credential keys
        private const val KEY_MQTT_URL = "mqtt_url"
        private const val KEY_MQTT_USERNAME = "mqtt_username"
        private const val KEY_MQTT_PASSWORD = "mqtt_password"
        private const val KEY_MQTT_TOPIC = "mqtt_topic"
        private const val KEY_MQTT_TICKET_CODE = "mqtt_ticket_code"

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

        fun setMqttCredentials(context: Context, url: String, username: String, password: String, topic: String, ticketCode: String) {
            val prefs = context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
            prefs.edit()
                .putString(KEY_MQTT_URL, url)
                .putString(KEY_MQTT_USERNAME, username)
                .putString(KEY_MQTT_PASSWORD, password)
                .putString(KEY_MQTT_TOPIC, topic)
                .putString(KEY_MQTT_TICKET_CODE, ticketCode)
                .apply()
            Log.d(TAG, "MQTT credentials updated — topic: $topic")
            // Connect native MQTT immediately so it's ready before screen lock
            instance?.let { svc ->
                Handler(Looper.getMainLooper()).post { svc.connectMqtt() }
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
                .apply()
            Log.d(TAG, "MQTT credentials cleared")
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
    private val prefsLock = Any() // Synchronizes SharedPrefs record read/write across threads
    private var ticketId: Int = 0
    private var isSilent: Boolean = false
    private var isIdleMode: Boolean = false
    private var consecutiveIdleCount: Int = 0
    private var idleLat: Double = 0.0
    private var idleLng: Double = 0.0
    private var wasStationary: Boolean = false // true after first stationary fix is saved — suppresses drift
    private var consecutiveMovingCount: Int = 0
    private val MOVING_CONFIRM_THRESHOLD = 3 // Require 3 consecutive moving fixes to clear stationary
    private var lastSavedLat: Double? = null
    private var lastSavedLng: Double? = null
    private var lastSavedTime: Long = 0L // GPS timestamp (ms) of last saved location — for teleport detection
    private var pendingRecords = JSONArray() // Buffer writes to reduce SharedPrefs I/O
    private var pendingCount = 0
    private val WRITE_BATCH_SIZE = 1 // Flush to SharedPrefs immediately — ensures no records lost on foreground transition
    private val isoFormat = SimpleDateFormat("yyyy-MM-dd'T'HH:mm:ss.SSS'Z'", Locale.US).apply {
        timeZone = TimeZone.getTimeZone("UTC")
    }
    private val uploadHandler = Handler(Looper.getMainLooper())

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
        // Flush any buffered records before dying
        if (pendingCount > 0) {
            flushPendingRecords()
        }
        disconnectMqtt()
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

            prefs.edit().putString(KEY_RECORDS, toWrite.toString()).apply()
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
        // JS is dead after app swipe — native takes over GPS recording
        prefs.edit().putBoolean(KEY_JS_ALIVE, false).apply()
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
                    Log.w(TAG, "MQTT token refresh: API token expired (401) — cannot refresh, waiting for app reopen")
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
                    // Replay offline records that were saved while MQTT was disconnected
                    if (reconnect) {
                        replayOfflineRecords()
                    }
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

            mqttClient = client
            lastMqttConnectAttempt = System.currentTimeMillis()
        } catch (e: Exception) {
            Log.e(TAG, "MQTT connect error: ${e.message}")
            mqttClient = null
        }
    }

    private fun disconnectMqtt() {
        try {
            // Disable auto-reconnect before disconnecting to prevent the library
            // from racing to reconnect between disconnect() and close()
            mqttClient?.setManualAcks(false)
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

    /**
     * Replay stored GPS records via MQTT after reconnecting.
     * Called when native MQTT reconnects in background after an offline period.
     * Records are published with their original client_id so the server deduplicates.
     */
    private val REPLAY_BATCH_SIZE = 20 // Publish in batches to avoid flooding broker

    /**
     * Replay stored GPS records via MQTT after reconnecting.
     * Runs on a background thread to avoid blocking the Paho callback thread.
     * Publishes in batches of 20 with brief pauses to prevent broker flooding.
     */
    private fun replayOfflineRecords() {
        val client = mqttClient ?: return
        val topic = mqttTopic ?: return
        if (!client.isConnected) return

        val jsAlive = prefs.getBoolean(KEY_JS_ALIVE, false)
        if (jsAlive) return // JS is handling — don't replay from native

        // Run on background thread to avoid blocking Paho callback thread
        Thread {
            try {
                // Synchronized read to avoid race with flushPendingRecords on main thread
                val records: JSONArray
                synchronized(prefsLock) {
                    records = getStoredRecords(this)
                }
                if (records.length() == 0) return@Thread

                val ticketCode = prefs.getString(KEY_MQTT_TICKET_CODE, "") ?: ""
                var published = 0
                var modified = false

                for (i in 0 until records.length()) {
                    if (client != mqttClient || !client.isConnected) break // Client changed or disconnected
                    try {
                        val r = records.getJSONObject(i)
                        if (r.optBoolean("synced", false)) continue
                        val payload = JSONObject().apply {
                            put("latitude", r.optDouble("latitude"))
                            put("longitude", r.optDouble("longitude"))
                            put("speed", r.optDouble("speed"))
                            put("heading", r.optDouble("heading"))
                            put("accuracy", r.optDouble("accuracy"))
                            put("recorded_at", r.optString("recorded_at"))
                            put("ticket_id", r.optInt("ticket_id"))
                            put("ticket_code", ticketCode)
                            put("client_id", r.optString("id"))
                            // Use battery stored at record time — accurate for offline replays
                            put("battery_level", r.opt("battery_level") ?: JSONObject.NULL)
                        }
                        val message = MqttMessage(payload.toString().toByteArray(Charsets.UTF_8))
                        message.qos = 1
                        client.publish(topic, message)
                        r.put("synced", true)
                        modified = true
                        published++

                        // Pause between batches to avoid flooding broker
                        if (published % REPLAY_BATCH_SIZE == 0) {
                            Thread.sleep(200)
                        }
                    } catch (e: Exception) {
                        Log.w(TAG, "MQTT replay error at index $i: ${e.message}")
                        break // Stop on error (e.g. "Too many publishes in progress")
                    }
                }
                // Synchronized write to avoid race with flushPendingRecords
                if (modified) {
                    synchronized(prefsLock) {
                        prefs.edit().putString(KEY_RECORDS, records.toString()).apply()
                    }
                }
                Log.d(TAG, "MQTT replayed $published/${records.length()} offline records")
            } catch (e: Exception) {
                Log.w(TAG, "MQTT replay thread error: ${e.message}")
            }
        }.start()
    }

    private fun publishToMqtt(record: JSONObject) {
        val client = mqttClient ?: return
        val topic = mqttTopic ?: return

        if (!client.isConnected) return // Will retry on next GPS fix via ensureMqttConnected

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
            }

            val message = MqttMessage(payload.toString().toByteArray(Charsets.UTF_8))
            message.qos = 1

            client.publish(topic, message, null, object : IMqttActionListener {
                override fun onSuccess(asyncActionToken: IMqttToken?) {
                    Log.d(TAG, "MQTT published — lat: ${String.format("%.6f", record.optDouble("latitude"))}, speed: ${String.format("%.1f", record.optDouble("speed"))}")
                }
                override fun onFailure(asyncActionToken: IMqttToken?, exception: Throwable?) {
                    Log.w(TAG, "MQTT publish failed: ${exception?.message}")
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
                priority = LocationRequest.PRIORITY_HIGH_ACCURACY
                interval = 30000L
                fastestInterval = 15000L
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
            Log.e(TAG, "Location permission not granted", e)
            stopSelf()
        }
    }

    private fun saveLocation(location: Location) {

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

        // Skip very inaccurate fixes (>100m) — in background, GPS can degrade severely
        val accuracy = location.accuracy.toDouble()
        if (location.hasAccuracy() && accuracy > 100.0) {
            Log.d(TAG, "Skipping inaccurate fix: ${String.format("%.0f", accuracy)}m")
            return
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

        if (isConfirmedMoving) {
            consecutiveMovingCount++
            if (consecutiveMovingCount >= MOVING_CONFIRM_THRESHOLD) {
                wasStationary = false
                Log.d(TAG, "MOVEMENT CONFIRMED: $consecutiveMovingCount consecutive, speed=${String.format("%.1f", speedMs)}")
            } else if (wasStationary) {
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
                wasStationary = true
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

        // Skip if truck hasn't moved enough from last saved position
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
        }

        pendingRecords.put(record)
        pendingCount++

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
                    // Ensure MQTT stays connected in background
                    ensureMqttConnected()
                }
                uploadHandler.postDelayed(this, UPLOAD_INTERVAL_MS)
            }
        }, UPLOAD_INTERVAL_MS)
    }

}
