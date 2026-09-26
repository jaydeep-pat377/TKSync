import React from 'react';
import {View, StyleSheet, Text, TextInput, TouchableOpacity} from 'react-native';
import * as Sentry from '@sentry/react-native';
import {SafeAreaProvider} from 'react-native-safe-area-context';
import {ThemeProvider} from './src/contexts/ThemeContext';
import {AuthProvider} from './src/contexts/AuthContext';
import {OfflineSyncProvider} from './src/contexts/OfflineSyncContext';
import {NotificationProvider} from './src/contexts/NotificationContext';
import {FontSizeProvider, useFontSize} from './src/contexts/FontSizeContext';
import AppNavigator from './src/navigation/AppNavigator';
import NetworkBanner from './src/components/NetworkBanner';
import BackgroundPermissionBanner from './src/components/BackgroundPermissionBanner';
import ToastContainer from './src/components/ToastContainer';
import {initSentry} from './src/services/sentry';
import {setupBackgroundNotifeeHandler} from './src/services/notifications';
import {logCapture} from './src/utils/logCapture';
import {DebugLogViewer} from './src/components/DebugLogViewer';
import PipMapView from './src/components/PipMapView';

// Debug builds only: logCapture keeps every console line in an on-device ring
// buffer that DebugLogViewer exposes to the driver, and OEM loggers can copy it
// out of the app sandbox. Not something to ship to trucks.
if (__DEV__) {
  logCapture.install(); // Intercept console.log/warn/error before anything else
}
initSentry();
setupBackgroundNotifeeHandler();

// Set Roboto Mono as the default font for all Text and TextInput
const defaultFontFamily = 'RobotoMono-Regular';
const oldTextRender = (Text as any).render;
(Text as any).render = function (...args: any[]) {
  const origin = oldTextRender.call(this, ...args);
  const style = origin.props.style;
  const fontWeight = StyleSheet.flatten(style)?.fontWeight;
  let fontFamily = defaultFontFamily;
  if (fontWeight === '700' || fontWeight === 'bold') fontFamily = 'RobotoMono-Bold';
  else if (fontWeight === '600') fontFamily = 'RobotoMono-SemiBold';
  else if (fontWeight === '500') fontFamily = 'RobotoMono-Medium';
  else if (fontWeight === '300' || fontWeight === 'light') fontFamily = 'RobotoMono-Light';
  return React.cloneElement(origin, {
    style: [{fontFamily}, StyleSheet.flatten(style)?.fontFamily ? style : style, {fontFamily}],
  });
};
const oldTextInputRender = (TextInput as any).render;
(TextInput as any).render = function (...args: any[]) {
  const origin = oldTextInputRender.call(this, ...args);
  return React.cloneElement(origin, {
    style: [{fontFamily: defaultFontFamily}, origin.props.style],
  });
};

function AppContent() {
  // Subscribe so child tree re-renders when fontScale changes
  useFontSize();
  return (
    <ThemeProvider>
      <AuthProvider>
        <NotificationProvider>
          <OfflineSyncProvider>
            <AppNavigator />
            <NetworkBanner />
            <BackgroundPermissionBanner />
            <ToastContainer />
            <PipMapView />
          </OfflineSyncProvider>
        </NotificationProvider>
      </AuthProvider>
    </ThemeProvider>
  );
}

function App() {
  return (
    <View style={s.root}>
      {/*
        Sentry.wrap() does NOT take a `fallback` — ReactNativeWrapperOptions is
        only profilerProps and touchEventBoundaryProps, so the one we used to
        pass there was silently dropped and this screen never rendered. A JS
        crash left the driver on a blank view with no way back.
      */}
      <Sentry.ErrorBoundary fallback={props => <ErrorFallback {...props} />}>
        <SafeAreaProvider>
          <FontSizeProvider>
            <AppContent />
            {__DEV__ && <DebugLogViewer />}
          </FontSizeProvider>
        </SafeAreaProvider>
      </Sentry.ErrorBoundary>
    </View>
  );
}

function ErrorFallback({resetError}: {resetError: () => void}) {
  return (
    <View style={s.fallback}>
      <Text style={s.fallbackTitle}>Something went wrong</Text>
      <Text style={s.fallbackMsg}>The app encountered an unexpected error. Please try again.</Text>
      <TouchableOpacity style={s.fallbackBtn} onPress={resetError}>
        <Text style={s.fallbackBtnText}>Try Again</Text>
      </TouchableOpacity>
    </View>
  );
}

export default Sentry.wrap(App);

const s = StyleSheet.create({
  root: {flex: 1, backgroundColor: '#367000'},
  fallback: {flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: '#1a1a1a', padding: 32},
  fallbackTitle: {fontSize: 20, fontWeight: '700', color: '#fff', marginBottom: 12},
  fallbackMsg: {fontSize: 14, color: '#aaa', textAlign: 'center', marginBottom: 24},
  fallbackBtn: {backgroundColor: '#367000', paddingHorizontal: 24, paddingVertical: 12, borderRadius: 8},
  fallbackBtnText: {color: '#fff', fontSize: 16, fontWeight: '600'},
});
