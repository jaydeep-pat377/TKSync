package com.tksync.location

import android.util.Log
import com.facebook.react.bridge.*
import org.json.JSONArray

class LocationTrackingModule(private val reactContext: ReactApplicationContext) :
    ReactContextBaseJavaModule(reactContext) {

    companion object {
        const val NAME = "LocationTrackingModule"
        private const val TAG = "LocationTrackingModule"
    }

    override fun getName(): String = NAME

    @ReactMethod
    fun startTracking(ticketId: Int, promise: Promise) {
        try {
            LocationTrackingService.start(reactContext, ticketId, false)
            Log.d(TAG, "startTracking called — ticket: $ticketId")
            promise.resolve(true)
        } catch (e: Exception) {
            Log.e(TAG, "startTracking failed", e)
            promise.reject("START_ERROR", e.message, e)
        }
    }

    @ReactMethod
    fun stopTracking(promise: Promise) {
        try {
            LocationTrackingService.stop(reactContext)
            Log.d(TAG, "stopTracking called")
            promise.resolve(true)
        } catch (e: Exception) {
            Log.e(TAG, "stopTracking failed", e)
            promise.reject("STOP_ERROR", e.message, e)
        }
    }

    @ReactMethod
    fun setSilentMode(silent: Boolean, promise: Promise) {
        try {
            LocationTrackingService.setSilentMode(reactContext, silent)
            Log.d(TAG, "setSilentMode called — silent: $silent")
            promise.resolve(true)
        } catch (e: Exception) {
            Log.e(TAG, "setSilentMode failed", e)
            promise.reject("SILENT_ERROR", e.message, e)
        }
    }

    @ReactMethod
    fun setIdleMode(idle: Boolean, promise: Promise) {
        try {
            LocationTrackingService.setIdleMode(reactContext, idle)
            Log.d(TAG, "setIdleMode called — idle: $idle")
            promise.resolve(true)
        } catch (e: Exception) {
            Log.e(TAG, "setIdleMode failed", e)
            promise.reject("IDLE_ERROR", e.message, e)
        }
    }

    @ReactMethod
    fun setJsAlive(alive: Boolean, promise: Promise) {
        try {
            LocationTrackingService.setJsAlive(reactContext, alive)
            Log.d(TAG, "setJsAlive called — alive: $alive")
            promise.resolve(true)
        } catch (e: Exception) {
            Log.e(TAG, "setJsAlive failed", e)
            promise.reject("JS_ALIVE_ERROR", e.message, e)
        }
    }

    @ReactMethod
    fun updateJsHeartbeat(promise: Promise) {
        try {
            LocationTrackingService.updateJsHeartbeat(reactContext)
            promise.resolve(true)
        } catch (e: Exception) {
            promise.reject("HEARTBEAT_ERROR", e.message, e)
        }
    }

    @ReactMethod
    fun updateTicketId(ticketId: Int, promise: Promise) {
        try {
            val prefs = reactContext.getSharedPreferences("tksync_native_gps", 0)
            prefs.edit().putInt("ticket_id", ticketId).apply()
            Log.d(TAG, "updateTicketId called — ticket: $ticketId")
            promise.resolve(true)
        } catch (e: Exception) {
            Log.e(TAG, "updateTicketId failed", e)
            promise.reject("UPDATE_ERROR", e.message, e)
        }
    }

    @ReactMethod
    fun getStoredRecords(promise: Promise) {
        try {
            val records = LocationTrackingService.getStoredRecords(reactContext)
            val result = WritableNativeArray()
            for (i in 0 until records.length()) {
                val obj = records.getJSONObject(i)
                val map = WritableNativeMap()
                map.putString("id", obj.optString("id", ""))
                map.putInt("ticket_id", obj.optInt("ticket_id", 0))
                map.putDouble("latitude", obj.optDouble("latitude", 0.0))
                map.putDouble("longitude", obj.optDouble("longitude", 0.0))
                map.putDouble("speed", obj.optDouble("speed", 0.0))
                map.putDouble("heading", obj.optDouble("heading", 0.0))
                map.putDouble("altitude", obj.optDouble("altitude", 0.0))
                map.putDouble("accuracy", obj.optDouble("accuracy", 0.0))
                map.putString("recorded_at", obj.optString("recorded_at", ""))
                map.putBoolean("synced", obj.optBoolean("synced", false))
                map.putBoolean("is_speeding", obj.optBoolean("is_speeding", false))
                map.putBoolean("is_idle", obj.optBoolean("is_idle", false))
                result.pushMap(map)
            }
            promise.resolve(result)
        } catch (e: Exception) {
            Log.e(TAG, "getStoredRecords failed", e)
            promise.reject("READ_ERROR", e.message, e)
        }
    }

    @ReactMethod
    fun clearStoredRecords(promise: Promise) {
        try {
            LocationTrackingService.clearStoredRecords(reactContext)
            promise.resolve(true)
        } catch (e: Exception) {
            promise.reject("CLEAR_ERROR", e.message, e)
        }
    }

    @ReactMethod
    fun isTrackingActive(promise: Promise) {
        try {
            promise.resolve(LocationTrackingService.isActive(reactContext))
        } catch (e: Exception) {
            promise.reject("CHECK_ERROR", e.message, e)
        }
    }

    @ReactMethod
    fun getTicketId(promise: Promise) {
        try {
            promise.resolve(LocationTrackingService.getTicketId(reactContext))
        } catch (e: Exception) {
            promise.reject("CHECK_ERROR", e.message, e)
        }
    }
}
