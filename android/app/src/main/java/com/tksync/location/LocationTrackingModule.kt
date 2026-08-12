package com.tksync.location

import android.util.Log
import com.facebook.react.bridge.*
import com.facebook.react.modules.core.DeviceEventManagerModule
import org.json.JSONArray

class LocationTrackingModule(private val reactContext: ReactApplicationContext) :
    ReactContextBaseJavaModule(reactContext) {

    companion object {
        const val NAME = "LocationTrackingModule"
        private const val TAG = "LocationTrackingModule"
    }

    override fun getName(): String = NAME

    override fun initialize() {
        super.initialize()
        LocationTrackingService.onGpsRecord = { record ->
            try {
                if (reactContext.hasActiveReactInstance()) {
                    val params = Arguments.createMap().apply {
                        putString("id", record.optString("id", ""))
                        putInt("ticket_id", record.optInt("ticket_id", 0))
                        putDouble("latitude", record.optDouble("latitude", 0.0))
                        putDouble("longitude", record.optDouble("longitude", 0.0))
                        putDouble("speed", record.optDouble("speed", 0.0))
                        putDouble("heading", record.optDouble("heading", 0.0))
                        putDouble("accuracy", record.optDouble("accuracy", 0.0))
                        putString("recorded_at", record.optString("recorded_at", ""))
                        putBoolean("is_idle", record.optBoolean("is_idle", false))
                    }
                    reactContext
                        .getJSModule(DeviceEventManagerModule.RCTDeviceEventEmitter::class.java)
                        .emit("nativeGpsRecord", params)
                }
            } catch (e: Exception) {
                Log.w(TAG, "Failed to emit nativeGpsRecord: ${e.message}")
            }
        }
        Log.d(TAG, "Initialized — nativeGpsRecord bridge active")
    }

    override fun onCatalystInstanceDestroy() {
        super.onCatalystInstanceDestroy()
        LocationTrackingService.onGpsRecord = null
        Log.d(TAG, "Catalyst destroyed — nativeGpsRecord bridge cleared")
    }

    // Required for RN NativeEventEmitter
    @ReactMethod
    fun addListener(eventName: String) {}

    @ReactMethod
    fun removeListeners(count: Int) {}

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
    fun setApiCredentials(baseUrl: String, token: String, promise: Promise) {
        try {
            LocationTrackingService.setApiCredentials(reactContext, baseUrl, token)
            Log.d(TAG, "setApiCredentials called")
            promise.resolve(true)
        } catch (e: Exception) {
            Log.e(TAG, "setApiCredentials failed", e)
            promise.reject("API_CRED_ERROR", e.message, e)
        }
    }

    @ReactMethod
    fun updateApiToken(token: String, promise: Promise) {
        try {
            LocationTrackingService.updateApiToken(reactContext, token)
            Log.d(TAG, "updateApiToken called")
            promise.resolve(true)
        } catch (e: Exception) {
            Log.e(TAG, "updateApiToken failed", e)
            promise.reject("API_TOKEN_ERROR", e.message, e)
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

    @ReactMethod
    fun setMqttCredentials(url: String, username: String, password: String, topic: String, ticketCode: String, promise: Promise) {
        try {
            LocationTrackingService.setMqttCredentials(reactContext, url, username, password, topic, ticketCode)
            Log.d(TAG, "setMqttCredentials called — topic: $topic")
            promise.resolve(true)
        } catch (e: Exception) {
            Log.e(TAG, "setMqttCredentials failed", e)
            promise.reject("MQTT_CRED_ERROR", e.message, e)
        }
    }

    @ReactMethod
    fun clearMqttCredentials(promise: Promise) {
        try {
            LocationTrackingService.clearMqttCredentials(reactContext)
            Log.d(TAG, "clearMqttCredentials called")
            promise.resolve(true)
        } catch (e: Exception) {
            promise.reject("MQTT_CLEAR_ERROR", e.message, e)
        }
    }

    @ReactMethod
    fun isUploading(promise: Promise) {
        promise.resolve(LocationTrackingService.isCurrentlyUploading)
    }

    @ReactMethod
    fun requestBatteryOptimizationExemption(promise: Promise) {
        try {
            val context = reactContext
            val pm = context.getSystemService(android.content.Context.POWER_SERVICE) as android.os.PowerManager
            if (!pm.isIgnoringBatteryOptimizations(context.packageName)) {
                val intent = android.content.Intent(
                    android.provider.Settings.ACTION_REQUEST_IGNORE_BATTERY_OPTIMIZATIONS,
                    android.net.Uri.parse("package:${context.packageName}")
                )
                intent.addFlags(android.content.Intent.FLAG_ACTIVITY_NEW_TASK)
                context.startActivity(intent)
                Log.d(TAG, "Battery optimization exemption requested")
            } else {
                Log.d(TAG, "Battery optimization already exempt")
            }
            promise.resolve(true)
        } catch (e: Exception) {
            Log.w(TAG, "Battery optimization request failed: ${e.message}")
            promise.resolve(false)
        }
    }
}
