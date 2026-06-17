import React from 'react';
import {View, StyleSheet} from 'react-native';
import * as Sentry from '@sentry/react-native';
import {SafeAreaProvider} from 'react-native-safe-area-context';
import {ThemeProvider} from './src/contexts/ThemeContext';
import {AuthProvider} from './src/contexts/AuthContext';
import {OfflineSyncProvider} from './src/contexts/OfflineSyncContext';
import AppNavigator from './src/navigation/AppNavigator';
import NetworkBanner from './src/components/NetworkBanner';
import ToastContainer from './src/components/ToastContainer';
import {initSentry} from './src/services/sentry';

initSentry();

function App() {
  return (
    <View style={s.root}>
      <SafeAreaProvider>
        <ThemeProvider>
          <AuthProvider>
            <OfflineSyncProvider>
              <AppNavigator />
              <NetworkBanner />
              <ToastContainer />
            </OfflineSyncProvider>
          </AuthProvider>
        </ThemeProvider>
      </SafeAreaProvider>
    </View>
  );
}

export default Sentry.wrap(App);

const s = StyleSheet.create({
  root: {flex: 1, backgroundColor: '#367000'},
});
