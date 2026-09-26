package com.tksync

import android.content.res.Configuration
import android.os.Build
import android.os.Bundle
import android.util.Log
import android.view.WindowManager
import com.facebook.react.ReactActivity
import com.facebook.react.ReactApplication
import com.facebook.react.bridge.Arguments
import com.facebook.react.modules.core.DeviceEventManagerModule
import com.tksync.pip.PipModule
import com.facebook.react.ReactActivityDelegate
import com.facebook.react.defaults.DefaultNewArchitectureEntryPoint.fabricEnabled
import com.facebook.react.defaults.DefaultReactActivityDelegate

class MainActivity : ReactActivity() {

  /**
   * Returns the name of the main component registered from JavaScript. This is used to schedule
   * rendering of the component.
   */
  override fun getMainComponentName(): String = "TKSync"

  override fun onCreate(savedInstanceState: Bundle?) {
    // Pass null to prevent ScreenStackFragment crash on activity recreation
    // (e.g., after "Only this time" permission selection kills and restores the activity)
    super.onCreate(null)
    window.addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)
  }

  /**
   * Returns the instance of the [ReactActivityDelegate]. We use [DefaultReactActivityDelegate]
   * which allows you to enable New Architecture with a single boolean flags [fabricEnabled]
   */
  override fun createReactActivityDelegate(): ReactActivityDelegate =
      DefaultReactActivityDelegate(this, mainComponentName, fabricEnabled)

  /**
   * Fires when the user leaves via Home (not Back, and not a config change), which
   * is the exact moment Google Maps floats its mini map. Enter PiP here rather than
   * onPause so we do not hijack normal in-app navigation.
   *
   * Gated on PipModule.autoEnterEnabled, which JS only turns on while a ticket is
   * being tracked — no point floating a login screen.
   */
  override fun onUserLeaveHint() {
    super.onUserLeaveHint()
    if (!PipModule.autoEnterEnabled) return
    if (!PipModule.isSupported(this)) return
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O && isInPictureInPictureMode) return
    try {
      PipModule.buildParams()?.let { enterPictureInPictureMode(it) }
    } catch (e: Exception) {
      // Throws when the user has disabled PiP for this app in system settings.
      Log.w("MainActivity", "Auto-enter PiP failed: ${e.message}")
    }
  }

  /** Tell JS to swap to / from its compact layout. */
  override fun onPictureInPictureModeChanged(
    isInPictureInPictureMode: Boolean,
    newConfig: Configuration,
  ) {
    super.onPictureInPictureModeChanged(isInPictureInPictureMode, newConfig)
    // Must not throw: this is an OS lifecycle callback, so any exception here takes
    // the whole app down mid-transition. reactInstanceManager is unavailable under
    // the New Architecture (bridgeless) and throws IllegalStateException — reach the
    // context through reactHost instead.
    try {
      val ctx = (application as? ReactApplication)?.reactHost?.currentReactContext
      if (ctx == null) {
        Log.w("MainActivity", "PiP change: no React context yet — inPip=$isInPictureInPictureMode")
        return
      }
      // Emit straight to the event emitter rather than resolving the module
      // instance: getNativeModule() is unreliable for legacy-registered modules
      // under bridgeless, and silently returning null left the JS overlay dead.
      ctx.getJSModule(DeviceEventManagerModule.RCTDeviceEventEmitter::class.java)
        .emit(
          PipModule.EVENT_PIP_CHANGED,
          Arguments.createMap().apply { putBoolean("inPipMode", isInPictureInPictureMode) },
        )
      Log.d("MainActivity", "PiP change emitted to JS: inPip=$isInPictureInPictureMode")
    } catch (e: Exception) {
      Log.w("MainActivity", "PiP mode change dispatch failed: ${e.message}")
    }
  }
}
