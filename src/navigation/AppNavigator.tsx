import React, {useMemo, useRef, useCallback, useEffect} from 'react';
import {NavigationContainer, DefaultTheme} from '@react-navigation/native';
import {createNativeStackNavigator} from '@react-navigation/native-stack';
import {useTheme} from '../contexts/ThemeContext';
import {addBreadcrumb} from '../services/sentry';
import {setNotificationNavigationRef} from '../services/notifications';
import {storage} from '../services/storage';
import SplashScreen from '../screens/SplashScreen';
import CompanyLoginScreen from '../screens/CompanyLoginScreen';
import DriverLoginScreen from '../screens/DriverLoginScreen';
import DashboardScreen from '../screens/DashboardScreen';
// NotesScreen removed — delivery entries handled by AdditionalEntriesModal
import MapScreen from '../screens/MapScreen';
import DeliveredToMapScreen from '../screens/DeliveredToMapScreen';
import VehicleTrackingScreen from '../screens/VehicleTrackingScreen';
import TripHistoryScreen from '../screens/TripHistoryScreen';
import NotificationsScreen from '../screens/NotificationsScreen';

const Stack = createNativeStackNavigator();

export default function AppNavigator() {
  const {c} = useTheme();

  const navTheme = useMemo(() => ({
    ...DefaultTheme,
    colors: {
      ...DefaultTheme.colors,
      background: c.primaryDark,
    },
  }), [c.primaryDark]);

  const navigationRef = useRef<any>();

  // Share navigation ref with notification service for tap-to-navigate
  useEffect(() => {
    setNotificationNavigationRef(navigationRef);
  }, []);

  const onStateChange = useCallback(() => {
    const currentRoute = navigationRef.current?.getCurrentRoute?.()?.name;
    if (currentRoute) {
      addBreadcrumb(`Navigate to ${currentRoute}`, 'navigation');
    }
  }, []);

  // Check if app was opened from a background notification tap
  const onReady = useCallback(() => {
    const pending = storage.getString('pending_notification_nav');
    if (pending === 'true') {
      storage.remove('pending_notification_nav');
      setTimeout(() => {
        navigationRef.current?.navigate('Notifications');
      }, 500);
    }
  }, []);

  return (
    <NavigationContainer ref={navigationRef} theme={navTheme} onStateChange={onStateChange} onReady={onReady}>
      <Stack.Navigator
        initialRouteName="Splash"
        screenOptions={{
          headerShown: false,
          animation: 'none',
          contentStyle: {backgroundColor: c.primaryDark},
        }}>
        <Stack.Screen name="Splash" component={SplashScreen} />
        <Stack.Screen name="Login" component={CompanyLoginScreen} />
        <Stack.Screen name="CompanyLogin" component={CompanyLoginScreen} />
        <Stack.Screen
          name="DriverLogin"
          component={DriverLoginScreen}
          options={{animation: 'slide_from_right'}}
        />
        <Stack.Screen
          name="Dashboard"
          component={DashboardScreen}
          options={{contentStyle: {backgroundColor: c.background}}}
        />
        <Stack.Screen
          name="Map"
          component={MapScreen}
          options={{animation: 'slide_from_bottom', contentStyle: {backgroundColor: c.background}}}
        />
        <Stack.Screen
          name="DeliveredToMap"
          component={DeliveredToMapScreen}
          options={{animation: 'slide_from_bottom', contentStyle: {backgroundColor: c.background}}}
        />
        <Stack.Screen
          name="VehicleTracking"
          component={VehicleTrackingScreen}
          options={{animation: 'slide_from_right', contentStyle: {backgroundColor: c.background}}}
        />
        <Stack.Screen
          name="TripHistory"
          component={TripHistoryScreen}
          options={{animation: 'slide_from_right', contentStyle: {backgroundColor: c.background}}}
        />
        <Stack.Screen
          name="Notifications"
          component={NotificationsScreen}
          options={{animation: 'slide_from_right', contentStyle: {backgroundColor: c.background}}}
        />
      </Stack.Navigator>
    </NavigationContainer>
  );
}
