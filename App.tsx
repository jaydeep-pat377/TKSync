import React, {useEffect} from 'react';
import {View, StyleSheet, Platform, PermissionsAndroid} from 'react-native';
import * as Sentry from '@sentry/react-native';
import {SafeAreaProvider} from 'react-native-safe-area-context';
import {ThemeProvider} from './src/contexts/ThemeContext';
import {AuthProvider} from './src/contexts/AuthContext';
import {OfflineSyncProvider} from './src/contexts/OfflineSyncContext';
import {FontSizeProvider, useFontSize} from './src/contexts/FontSizeContext';
import AppNavigator from './src/navigation/AppNavigator';
import NetworkBanner from './src/components/NetworkBanner';
import ToastContainer from './src/components/ToastContainer';
import {initSentry} from './src/services/sentry';

initSentry();

function AppContent() {
  // Subscribe so child tree re-renders when fontScale changes
  useFontSize();
  return (
    <ThemeProvider>
      <AuthProvider>
        <OfflineSyncProvider>
          <AppNavigator />
          <NetworkBanner />
          <ToastContainer />
        </OfflineSyncProvider>
      </AuthProvider>
    </ThemeProvider>
  );
}

function App() {
  useEffect(() => {
    if (Platform.OS === 'android') {
      PermissionsAndroid.request(PermissionsAndroid.PERMISSIONS.RECORD_AUDIO, {
        title: 'Microphone Permission',
        message: 'TKSync needs microphone access for voice input.',
        buttonPositive: 'Allow',
      }).catch(() => {});
    }
  }, []);

  return (
    <View style={s.root}>
      <SafeAreaProvider>
        <FontSizeProvider>
          <AppContent />
        </FontSizeProvider>
      </SafeAreaProvider>
    </View>
  );
}

export default Sentry.wrap(App);

const s = StyleSheet.create({
  root: {flex: 1, backgroundColor: '#367000'},
});
