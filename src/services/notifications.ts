import {Platform, DeviceEventEmitter} from 'react-native';
import messaging from '@react-native-firebase/messaging';
import notifee, {AndroidImportance, EventType} from '@notifee/react-native';
import {notificationsApi} from './api';
import {storage} from './storage';
import type {DriverNotification} from './api';
import {requestLocationPermissions} from './backgroundGpsTracker';

/** Emitted when a foreground silent push says a delivery record is incomplete. */
export const DELIVERY_RECORD_INCOMPLETE_EVENT = 'delivery_record_incomplete';

// Navigation ref — set from AppNavigator so notification taps can navigate
let _navigationRef: any = null;
export function setNotificationNavigationRef(ref: any) {
  _navigationRef = ref;
}

function navigateToNotifications() {
  if (_navigationRef?.current?.navigate) {
    _navigationRef.current.navigate('Notifications');
  }
}

/** Store a received notification locally for offline history. */
function storeNotificationLocally(data: Record<string, string>) {
  try {
    const raw = storage.getString('notification_history') || '[]';
    const history: DriverNotification[] = JSON.parse(raw);
    history.unshift({
      id: Date.now(),
      employee_code: '',
      truck_code: data.truck_code || null,
      title: data.title || 'TKSync',
      message: data.body || data.message || '',
      sender: null,
      read: false,
      created_at: new Date().toISOString(),
    });
    // Keep last 100
    storage.set('notification_history', JSON.stringify(history.slice(0, 100)));
  } catch {
    // non-fatal
  }
}

async function showLocalNotification(data: Record<string, string> = {}) {
  storeNotificationLocally(data);
  try {
    const channelId = await notifee.createChannel({
      id: 'tksync',
      name: 'TKSync Notifications',
      importance: AndroidImportance.HIGH,
      sound: 'default',
    });
    console.log('Notifee channel created:', channelId);

    const notificationId = await notifee.displayNotification({
      title: data?.title || 'TKSync',
      body: data?.body || data?.message || 'There are missing fields in Plant, Job Site, Returned, Time Adjust, COD. Please fill the required fields.',
      android: {
        channelId,
        smallIcon: 'ic_launcher',
        importance: AndroidImportance.HIGH,
        pressAction: {id: 'open-notifications'},
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

async function showDeliveryIncompleteNotification(data: Record<string, string>) {
  try {
    const channelId = await notifee.createChannel({
      id: 'tksync',
      name: 'TKSync Notifications',
      importance: AndroidImportance.HIGH,
      sound: 'default',
    });
    const ticketLabel = data.ticket_code ? `Ticket ${data.ticket_code}` : 'A completed ticket';
    await notifee.displayNotification({
      title: 'Incomplete Delivery Record',
      body: `${ticketLabel} has missing fields. Please fill the required fields.`,
      android: {
        channelId,
        smallIcon: 'ic_launcher',
        importance: AndroidImportance.HIGH,
        pressAction: {id: 'open-missing-fields'},
        sound: 'default',
      },
      ios: {
        sound: 'default',
        foregroundPresentationOptions: {banner: true, sound: true, badge: true},
      },
      data,
    });
  } catch (e) {
    console.error('Delivery incomplete notification error:', e);
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
  // Request location permission after notification registration
  try {
    await requestLocationPermissions();
  } catch (e) {
    console.warn('Failed to request location permission:', e);
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
    console.log('Push received in background:', remoteMessage.data);
    const data = (remoteMessage.data || {}) as Record<string, string>;
    if (remoteMessage.notification) {
      data.title = data.title || remoteMessage.notification.title || '';
      data.body = data.body || remoteMessage.notification.body || '';
    }

    // Incomplete delivery record — show a meaningful notification that opens Dashboard
    if (data.type === 'delivery_record_incomplete') {
      await showDeliveryIncompleteNotification(data);
      return;
    }

    await showLocalNotification(data);
  });
}

export function setupForegroundHandler() {
  const unsubMessage = messaging().onMessage(async remoteMessage => {
    console.log('Push received in foreground:', remoteMessage.data);
    const data = (remoteMessage.data || {}) as Record<string, string>;
    if (remoteMessage.notification) {
      data.title = data.title || remoteMessage.notification.title || '';
      data.body = data.body || remoteMessage.notification.body || '';
    }

    // Silent push for incomplete delivery record — notify Dashboard directly, no visible notification
    if (data.type === 'delivery_record_incomplete') {
      DeviceEventEmitter.emit(DELIVERY_RECORD_INCOMPLETE_EVENT, {
        ticket_id: data.ticket_id,
        ticket_code: data.ticket_code,
      });
      return;
    }

    await showLocalNotification(data);
  });

  // Handle notification press (foreground)
  const unsubNotifee = notifee.onForegroundEvent(({type, detail}) => {
    if (type === EventType.PRESS) {
      if (detail.pressAction?.id === 'open-missing-fields') {
        // Emit event so Dashboard shows the missing fields modal
        const d = (detail.notification?.data || {}) as Record<string, string>;
        DeviceEventEmitter.emit(DELIVERY_RECORD_INCOMPLETE_EVENT, {
          ticket_id: d.ticket_id,
          ticket_code: d.ticket_code,
        });
      } else if (detail.pressAction?.id === 'open-notifications') {
        navigateToNotifications();
      }
    }
  });

  return () => { unsubMessage(); unsubNotifee(); };
}

/** Handle notification press when app was in background/killed */
export function setupBackgroundNotifeeHandler() {
  notifee.onBackgroundEvent(async ({type, detail}) => {
    if (type === EventType.PRESS) {
      if (detail.pressAction?.id === 'open-missing-fields') {
        // Store flag — Dashboard checks on mount and shows missing fields modal
        storage.set('pending_missing_fields', 'true');
      } else if (detail.pressAction?.id === 'open-notifications') {
        storage.set('pending_notification_nav', 'true');
      }
    }
  });
}
