package com.tksync.location

import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.os.Build
import android.util.Log
import androidx.core.app.NotificationCompat

/**
 * Restarts the GPS tracking service after device reboot if tracking was active
 * before the device was shut down. Checks the ACTIVE flag in SharedPreferences
 * that LocationTrackingService persists during normal operation.
 *
 * Android 14 does not allow a `location` foreground service to be started from
 * BOOT_COMPLETED — only health, remoteMessaging, systemExempted, shortService,
 * fileManagement and specialUse are permitted. The start therefore throws on
 * modern devices, and swallowing that throw meant a rebooted phone silently
 * stopped sending GPS until the driver happened to reopen the app. When the
 * start is refused we post a notification instead, so one tap resumes tracking.
 */
class BootReceiver : BroadcastReceiver() {

    companion object {
        private const val TAG = "BootReceiver"
        private const val PREFS_NAME = "tksync_native_gps"
        private const val KEY_ACTIVE = "tracking_active"
        private const val KEY_TICKET_ID = "ticket_id"
        private const val RESUME_CHANNEL_ID = "tksync-resume"
        /** Cancelled by LocationTrackingService once tracking is actually running again. */
        const val RESUME_NOTIFICATION_ID = 9002
    }

    override fun onReceive(context: Context, intent: Intent) {
        if (intent.action != Intent.ACTION_BOOT_COMPLETED) return

        val prefs = context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
        val wasActive = prefs.getBoolean(KEY_ACTIVE, false)

        if (!wasActive) {
            Log.d(TAG, "Boot completed — tracking was not active, skipping")
            return
        }

        val ticketId = prefs.getInt(KEY_TICKET_ID, 0)
        Log.d(TAG, "Boot completed — restarting GPS tracking (ticket: $ticketId)")

        try {
            LocationTrackingService.start(context, ticketId, silent = true)
        } catch (e: Exception) {
            // ForegroundServiceStartNotAllowedException on Android 14+, but catch
            // broadly: the OEM-specific variants are not worth enumerating and the
            // fallback is correct for any failure to start.
            Log.w(TAG, "Boot restart refused (${e.javaClass.simpleName}): ${e.message}")
            LocationTrackingService.recordDiag(
                prefs,
                "boot_restart_blocked",
                mapOf("error" to e.javaClass.simpleName, "sdk" to Build.VERSION.SDK_INT),
            )
            showResumeNotification(context)
        }
    }

    /** Ask the driver to reopen the app, since the OS will not let us start on our own. */
    private fun showResumeNotification(context: Context) {
        try {
            val manager = context.getSystemService(NotificationManager::class.java) ?: return

            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                manager.createNotificationChannel(
                    NotificationChannel(
                        RESUME_CHANNEL_ID,
                        "Tracking Paused",
                        NotificationManager.IMPORTANCE_HIGH,
                    ).apply {
                        description = "Shown when GPS tracking could not restart by itself"
                    },
                )
            }

            val launch = context.packageManager.getLaunchIntentForPackage(context.packageName)
                ?.apply { flags = Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TOP }
            val pending = launch?.let {
                PendingIntent.getActivity(
                    context,
                    0,
                    it,
                    PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
                )
            }

            val notification = NotificationCompat.Builder(context, RESUME_CHANNEL_ID)
                .setContentTitle("GPS tracking paused")
                .setContentText("Your phone restarted. Open TKSync to resume tracking.")
                .setSmallIcon(android.R.drawable.ic_dialog_map)
                .setPriority(NotificationCompat.PRIORITY_HIGH)
                .setAutoCancel(true)
                .setOngoing(true) // Tracking really is off — do not let it be swiped away
                .apply { pending?.let { setContentIntent(it) } }
                .build()

            // No POST_NOTIFICATIONS check: notify() is a silent no-op when the
            // permission is denied, and there is nothing better to do in that case.
            manager.notify(RESUME_NOTIFICATION_ID, notification)
            Log.d(TAG, "Posted resume-tracking notification")
        } catch (e: Exception) {
            Log.w(TAG, "Failed to post resume notification: ${e.message}")
        }
    }
}
