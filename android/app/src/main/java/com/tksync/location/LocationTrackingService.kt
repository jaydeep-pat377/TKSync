package com.tksync.location

import android.app.*
import android.content.Context
import android.content.Intent
import android.content.SharedPreferences
import android.content.pm.ServiceInfo
import android.location.Location
import android.os.Build
import android.os.IBinder
import android.os.Looper
import android.util.Log
import androidx.core.app.NotificationCompat
import com.google.android.gms.location.*
import org.json.JSONArray
import org.json.JSONObject
import java.text.SimpleDateFormat
import java.util.*

class LocationTrackingService : Service() {

    companion object {
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
        private const val IDLE_SPEED_THRESHOLD = 1.0 // m/s
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
    private var pendingRecords = JSONArray() // Buffer writes to reduce SharedPrefs I/O
    private var pendingCount = 0
    private val WRITE_BATCH_SIZE = 5 // Flush to SharedPrefs every 5 records
    private val isoFormat = SimpleDateFormat("yyyy-MM-dd'T'HH:mm:ss.SSS'Z'", Locale.US).apply {
        timeZone = TimeZone.getTimeZone("UTC")
    }

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
        // If intent is null, service was restarted by Android after kill (START_STICKY)
        // JS is definitely dead — reset js_alive so native starts recording
        if (intent == null) {
            prefs.edit().putBoolean(KEY_JS_ALIVE, false).apply()
            Log.d(TAG, "Service restarted by system (no intent) — JS is dead, native will record")
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
        Log.d(TAG, "Service started — ticket: $ticketId, silent: $isSilent, idle: $isIdleMode, START_STICKY")
        return START_STICKY
    }

    override fun onDestroy() {
        super.onDestroy()
        fusedClient.removeLocationUpdates(locationCallback)
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
        // JS is dead — native must start saving records
        prefs.edit().putBoolean(KEY_JS_ALIVE, false).apply()
        // Flush buffered records so they survive the restart
        if (pendingCount > 0) {
            flushPendingRecords()
        }
        Log.d(TAG, "Task removed (app killed) — JS dead, native will record, service restart via START_STICKY")
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
                priority = LocationRequest.PRIORITY_HIGH_ACCURACY
                interval = 30000L
                fastestInterval = 15000L
                smallestDisplacement = 20f
            } else if (isSilentMode) {
                priority = LocationRequest.PRIORITY_HIGH_ACCURACY
                interval = 5000L
                fastestInterval = 5000L
                smallestDisplacement = 10f
            } else {
                priority = LocationRequest.PRIORITY_HIGH_ACCURACY
                interval = 5000L
                fastestInterval = 5000L
                smallestDisplacement = 5f
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

        // Re-read ticket ID from prefs in case JS updated it mid-session
        val latestTicketId = prefs.getInt(KEY_TICKET_ID, ticketId)
        if (latestTicketId != ticketId && latestTicketId > 0) {
            Log.d(TAG, "Ticket ID updated: $ticketId → $latestTicketId")
            ticketId = latestTicketId
        }

        val speedAvailable = location.hasSpeed() && location.speed >= 0f
        val speedMs = if (speedAvailable) location.speed.toDouble() else 0.0
        val speedKmh = speedMs * 3.6
        val isSpeeding = speedKmh > 80.0
        val isIdle = speedAvailable && speedMs < IDLE_SPEED_THRESHOLD

        // Native idle detection (works in background/kill mode without JS)
        // Also checks distance from idle position — speed from FusedLocation can be 0 even while driving
        if (isIdle) {
            // Check distance from idle position
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
                        // Restart location updates with idle parameters
                        fusedClient.removeLocationUpdates(locationCallback)
                        startLocationUpdates()
                    }
                    Log.d(TAG, "Idle — skipping GPS record | speed: ${String.format("%.1f", speedMs)} m/s")
                    return
                }
            }
        } else {
            // Movement detected — resume normal tracking if was idle
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
        }

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
}
