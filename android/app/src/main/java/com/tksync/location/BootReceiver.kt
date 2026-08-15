package com.tksync.location

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.util.Log

/**
 * Restarts the GPS tracking service after device reboot if tracking was active
 * before the device was shut down. Checks the ACTIVE flag in SharedPreferences
 * that LocationTrackingService persists during normal operation.
 */
class BootReceiver : BroadcastReceiver() {

    companion object {
        private const val TAG = "BootReceiver"
        private const val PREFS_NAME = "tksync_native_gps"
        private const val KEY_ACTIVE = "tracking_active"
        private const val KEY_TICKET_ID = "ticket_id"
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
            Log.e(TAG, "Failed to restart tracking after boot: ${e.message}")
        }
    }
}
