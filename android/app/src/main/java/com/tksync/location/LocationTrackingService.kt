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
        private const val MAX_RECORDS = 50000

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
        ticketId = intent?.getIntExtra("ticket_id", 0)
            ?: prefs.getInt(KEY_TICKET_ID, 0)
        isSilent = intent?.getBooleanExtra("silent", false)
            ?: prefs.getBoolean(KEY_SILENT, false)

        prefs.edit()
            .putInt(KEY_TICKET_ID, ticketId)
            .putBoolean(KEY_ACTIVE, true)
            .putBoolean(KEY_SILENT, isSilent)
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
        Log.d(TAG, "Service started — ticket: $ticketId, silent: $isSilent, START_STICKY")
        return START_STICKY
    }

    override fun onDestroy() {
        super.onDestroy()
        fusedClient.removeLocationUpdates(locationCallback)
        Log.d(TAG, "Service destroyed")
    }

    override fun onBind(intent: Intent?): IBinder? = null

    override fun onTaskRemoved(rootIntent: Intent?) {
        super.onTaskRemoved(rootIntent)
        Log.d(TAG, "Task removed (app killed) — service will restart via START_STICKY")
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
        val request = LocationRequest.create().apply {
            priority = LocationRequest.PRIORITY_HIGH_ACCURACY
            if (isSilentMode) {
                interval = 10000L
                fastestInterval = 10000L
                smallestDisplacement = 10f
            } else {
                interval = 10000L
                fastestInterval = 10000L
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
        val speedMs = Math.max(0.0, (location.speed ?: 0f).toDouble())
        val speedKmh = speedMs * 3.6
        val isSpeeding = speedKmh > 80.0
        val isIdle = speedMs < 1.0

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
            put("id", "native_${System.currentTimeMillis()}_${(Math.random() * 100000).toInt()}")
            put("is_speeding", isSpeeding)
            put("is_idle", isIdle)
        }

        val records = getStoredRecords(this)
        records.put(record)

        if (records.length() > MAX_RECORDS) {
            val trimmed = JSONArray()
            for (i in (records.length() - MAX_RECORDS) until records.length()) {
                trimmed.put(records.getJSONObject(i))
            }
            prefs.edit().putString(KEY_RECORDS, trimmed.toString()).apply()
        } else {
            prefs.edit().putString(KEY_RECORDS, records.toString()).apply()
        }

        Log.d(TAG, "GPS #${records.length()} | lat: ${String.format("%.6f", location.latitude)}, " +
                "lng: ${String.format("%.6f", location.longitude)} | " +
                "speed: ${String.format("%.1f", location.speed)} m/s | ticket: $ticketId | silent: $isSilent")
    }
}
