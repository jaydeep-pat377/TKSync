import {Platform} from 'react-native';
import notifee, {AndroidImportance, AndroidCategory} from '@notifee/react-native';

const CHANNEL_ID = 'tksync-tracking';
const NOTIFICATION_ID = 'tracking-foreground';

async function ensureChannel(): Promise<string> {
  return notifee.createChannel({
    id: CHANNEL_ID,
    name: 'Vehicle Tracking',
    importance: AndroidImportance.LOW,
    sound: '',
  });
}

export async function startTrackingService(): Promise<void> {
  if (Platform.OS !== 'android') return;

  const channelId = await ensureChannel();
  await notifee.displayNotification({
    id: NOTIFICATION_ID,
    title: 'Vehicle Tracking Active',
    body: 'GPS location is being recorded.',
    android: {
      channelId,
      smallIcon: 'ic_launcher',
      importance: AndroidImportance.LOW,
      ongoing: true,
      pressAction: {id: 'default'},
      asForegroundService: true,
      category: AndroidCategory.SERVICE,
    },
  });
  console.log('[TrackingService] Foreground service started');
}

export async function stopTrackingService(): Promise<void> {
  if (Platform.OS !== 'android') return;

  await notifee.stopForegroundService();
  await notifee.cancelNotification(NOTIFICATION_ID);
  console.log('[TrackingService] Foreground service stopped');
}
