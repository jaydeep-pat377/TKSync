package com.tksync.pip

import android.app.Activity
import android.app.PictureInPictureParams
import android.os.Build
import android.util.Log
import android.util.Rational
import com.facebook.react.bridge.*
import com.facebook.react.modules.core.DeviceEventManagerModule

/**
 * Picture-in-picture bridge.
 *
 * PiP floats the activity over other apps, so the driver keeps a live mini map
 * while using navigation, phone or messages. It is NOT a substitute for the
 * native GPS service: the PiP window dies with the task, whereas
 * LocationTrackingService survives a swipe. The two are complementary — PiP is
 * visibility, the service is data.
 */
class PipModule(private val reactContext: ReactApplicationContext) :
    ReactContextBaseJavaModule(reactContext) {

    companion object {
        private const val TAG = "PipModule"
        const val EVENT_PIP_CHANGED = "pipModeChanged"

        /** Set from JS. onUserLeaveHint() consults this so PiP only triggers
         *  when the app actually has something worth floating (tracking a ticket). */
        @Volatile
        var autoEnterEnabled: Boolean = false

        fun isSupported(activity: Activity?): Boolean {
            if (activity == null) return false
            // PiP needs API 26; minSdkVersion is 24, so this guard is load-bearing.
            if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return false
            return activity.packageManager.hasSystemFeature(
                android.content.pm.PackageManager.FEATURE_PICTURE_IN_PICTURE
            )
        }

        /** Portrait-ish 2:3 — matches the Google Maps PiP proportions. */
        fun buildParams(): PictureInPictureParams? {
            if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return null
            return PictureInPictureParams.Builder()
                .setAspectRatio(Rational(2, 3))
                .build()
        }
    }

    override fun getName() = "PipModule"

    @ReactMethod
    fun addListener(eventName: String) {}

    @ReactMethod
    fun removeListeners(count: Int) {}

    @ReactMethod
    fun isSupported(promise: Promise) {
        promise.resolve(isSupported(reactContext.currentActivity))
    }

    /** Enable/disable auto-enter on Home press. JS turns this on once tracking starts. */
    @ReactMethod
    fun setAutoEnter(enabled: Boolean, promise: Promise) {
        autoEnterEnabled = enabled
        Log.d(TAG, "PiP auto-enter: $enabled")
        promise.resolve(true)
    }

    /** Enter PiP now. Only valid while the activity is in the foreground. */
    @ReactMethod
    fun enterPipMode(promise: Promise) {
        val activity = reactContext.currentActivity
        // Inline SDK check so the compiler narrows for enterPictureInPictureMode(params),
        // which only exists from API 26 — minSdkVersion here is 24.
        if (activity == null || Build.VERSION.SDK_INT < Build.VERSION_CODES.O || !isSupported(activity)) {
            promise.resolve(false)
            return
        }
        try {
            val params = buildParams()
            promise.resolve(if (params != null) activity.enterPictureInPictureMode(params) else false)
        } catch (e: Exception) {
            // Throws if the activity is already backgrounded or PiP is user-disabled
            // in system settings — not worth crashing over.
            Log.w(TAG, "enterPipMode failed: ${e.message}")
            promise.resolve(false)
        }
    }

    /** Emit the PiP state to JS so the UI can swap to its compact layout. */
    fun emitPipChanged(inPip: Boolean) {
        try {
            reactContext
                .getJSModule(DeviceEventManagerModule.RCTDeviceEventEmitter::class.java)
                .emit(EVENT_PIP_CHANGED, Arguments.createMap().apply { putBoolean("inPipMode", inPip) })
        } catch (e: Exception) {
            Log.w(TAG, "emitPipChanged failed: ${e.message}")
        }
    }
}
