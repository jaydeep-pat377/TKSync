import {Platform} from 'react-native';
import messaging from '@react-native-firebase/messaging';
import notifee, {AndroidImportance} from '@notifee/react-native';
import {notificationsApi} from './api';
import {storage} from './storage';

async function showLocalNotification(data: Record<string, string> = {}) {
  try {
    const channelId = await notifee.createChannel({
      id: 'tksync',
      name: 'TKSync Notifications',
      importance: AndroidImportance.HIGH,
      sound: 'default',
    });
    console.log('Notifee channel created:', channelId);

    const notificationId = await notifee.displayNotification({
      title: 'TKSync',
      body: 'There are missing fields in Plant, Job Site, Returned, Time Adjust, COD. Please fill the required fields.',
      android: {
        channelId,
        smallIcon: 'ic_launcher',
        importance: AndroidImportance.HIGH,
        pressAction: {id: 'default'},
        sound: 'default',
      },
      ios: {
        sound: 'default',
        foregroundPresentationOptions: {
          banner: true,
          sound: true,
          badge: true,
        },
      },
      data,
    });
    console.log('Notifee notification displayed:', notificationId);
  } catch (e) {
    console.error('Notifee display error:', e);
  }
}

export async function requestPermission(): Promise<boolean> {
  try {
    const authStatus = await messaging().requestPermission();
    const granted =
      authStatus === messaging.AuthorizationStatus.AUTHORIZED ||
      authStatus === messaging.AuthorizationStatus.PROVISIONAL;
    console.log('Notification permission:', granted ? 'granted' : 'denied');
    return granted;
  } catch (e) {
    console.warn('Notification permission error:', e);
    return false;
  }
}

export async function registerDevice(): Promise<void> {
  try {
    await requestPermission();
    const token = await messaging().getToken();
    console.log('FCM Token:', token);
    await notificationsApi.registerDevice(token, Platform.OS);
    storage.set('fcm_token', token);
    console.log('Device registered for push notifications');
  } catch (e) {
    console.warn('Failed to register device:', e);
  }
}

export async function unregisterDevice(): Promise<void> {
  try {
    const token = storage.getString('fcm_token');
    if (token) {
      await notificationsApi.unregisterDevice(token);
      storage.remove('fcm_token');
      console.log('Device unregistered from push notifications');
    }
  } catch (e) {
    console.warn('Failed to unregister device:', e);
  }
}

export function setupTokenRefreshListener(): () => void {
  return messaging().onTokenRefresh(async newToken => {
    console.log('FCM Token refreshed:', newToken);
    try {
      await notificationsApi.registerDevice(newToken, Platform.OS);
      storage.set('fcm_token', newToken);
    } catch (e) {
      console.warn('Failed to re-register refreshed token:', e);
    }
  });
}

export function setupBackgroundHandler() {
  messaging().setBackgroundMessageHandler(async remoteMessage => {
    console.log('Silent push received in background:', remoteMessage.data);
    await showLocalNotification(remoteMessage.data as Record<string, string>);
  });
}

export function setupForegroundHandler() {
  return messaging().onMessage(async remoteMessage => {
    console.log('Silent push received in foreground:', remoteMessage.data);
    await showLocalNotification(remoteMessage.data as Record<string, string>);
  });
}
