import React, {useMemo, useRef, useCallback} from 'react';
import {NavigationContainer, DefaultTheme} from '@react-navigation/native';
import {createNativeStackNavigator} from '@react-navigation/native-stack';
import {useTheme} from '../contexts/ThemeContext';
import {addBreadcrumb} from '../services/sentry';
import SplashScreen from '../screens/SplashScreen';
import CompanyLoginScreen from '../screens/CompanyLoginScreen';
import DriverLoginScreen from '../screens/DriverLoginScreen';
import DashboardScreen from '../screens/DashboardScreen';
// NotesScreen removed — delivery entries handled by AdditionalEntriesModal
import MapScreen from '../screens/MapScreen';
import DeliveredToMapScreen from '../screens/DeliveredToMapScreen';
import VehicleTrackingScreen from '../screens/VehicleTrackingScreen';
import TripHistoryScreen from '../screens/TripHistoryScreen';

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

  const onStateChange = useCallback(() => {
    const currentRoute = navigationRef.current?.getCurrentRoute?.()?.name;
    if (currentRoute) {
      addBreadcrumb(`Navigate to ${currentRoute}`, 'navigation');
    }
  }, []);

  return (
    <NavigationContainer ref={navigationRef} theme={navTheme} onStateChange={onStateChange}>
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
      </Stack.Navigator>
    </NavigationContainer>
  );
}
