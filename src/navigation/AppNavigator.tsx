import React from 'react';
import {NavigationContainer} from '@react-navigation/native';
import {createNativeStackNavigator} from '@react-navigation/native-stack';
import SplashScreen from '../screens/SplashScreen';
import CompanyLoginScreen from '../screens/CompanyLoginScreen';
import DriverLoginScreen from '../screens/DriverLoginScreen';
import DashboardScreen from '../screens/DashboardScreen';
import MobileTicketScreen from '../screens/MobileTicketScreen';
import NotesScreen from '../screens/NotesScreen';
import AcceptTicketScreen from '../screens/AcceptTicketScreen';
import DisputeTicketScreen from '../screens/DisputeTicketScreen';
import CurblineReleaseScreen from '../screens/CurblineReleaseScreen';

const Stack = createNativeStackNavigator();

export default function AppNavigator() {
  return (
    <NavigationContainer>
      <Stack.Navigator
        initialRouteName="Splash"
        screenOptions={{headerShown: false, animation: 'none'}}>
        <Stack.Screen name="Splash" component={SplashScreen} />
        <Stack.Screen
          name="Login"
          component={CompanyLoginScreen}
        />
        <Stack.Screen
          name="CompanyLogin"
          component={CompanyLoginScreen}
        />
        <Stack.Screen
          name="DriverLogin"
          component={DriverLoginScreen}
          options={{animation: 'slide_from_right'}}
        />
        <Stack.Screen name="Dashboard" component={DashboardScreen} />
        <Stack.Screen
          name="MobileTicket"
          component={MobileTicketScreen}
          options={{animation: 'slide_from_bottom'}}
        />
        <Stack.Screen
          name="Notes"
          component={NotesScreen}
          options={{animation: 'slide_from_bottom'}}
        />
        <Stack.Screen
          name="AcceptTicket"
          component={AcceptTicketScreen}
          options={{animation: 'slide_from_right'}}
        />
        <Stack.Screen
          name="DisputeTicket"
          component={DisputeTicketScreen}
          options={{animation: 'slide_from_right'}}
        />
        <Stack.Screen
          name="CurblineRelease"
          component={CurblineReleaseScreen}
          options={{animation: 'slide_from_right'}}
        />
      </Stack.Navigator>
    </NavigationContainer>
  );
}
