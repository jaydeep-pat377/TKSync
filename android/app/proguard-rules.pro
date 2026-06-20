# Add project specific ProGuard rules here.
# By default, the flags in this file are appended to flags specified
# in /usr/local/Cellar/android-sdk/24.3.3/tools/proguard/proguard-android.txt
# You can edit the include path and order by changing the proguardFiles
# directive in build.gradle.
#
# For more details, see
#   http://developer.android.com/guide/developing/tools/proguard.html

# React Native / Hermes
-keep class com.facebook.hermes.unicode.** { *; }
-keep class com.facebook.jni.** { *; }

# react-native-config
-keep class com.tksync.BuildConfig { *; }

# react-native-mmkv
-keep class com.tencent.mmkv.** { *; }

# react-native-sensors
-keep class com.sensors.** { *; }

# Sentry
-keep class io.sentry.** { *; }
-dontwarn io.sentry.**

# Firebase
-keep class com.google.firebase.** { *; }
-dontwarn com.google.firebase.**

# Mapbox
-keep class com.mapbox.** { *; }
-dontwarn com.mapbox.**

# react-native-svg
-keep public class com.horcrux.svg.** { *; }

# react-native-vector-icons
-keep class com.oblador.vectoricons.** { *; }

# Keep JavaScript interface methods
-keepclassmembers class * {
    @com.facebook.react.bridge.ReactMethod *;
}
-keepclassmembers class * {
    @com.facebook.proguard.annotations.DoNotStrip *;
}
-keep @com.facebook.proguard.annotations.DoNotStrip class *

# OkHttp (used by networking)
-dontwarn okhttp3.**
-dontwarn okio.**
