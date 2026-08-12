import {Platform, NativeModules} from 'react-native';
import notifee, {AndroidImportance, AndroidCategory, AndroidForegroundServiceType} from '@notifee/react-native';

const {LocationTrackingModule} = NativeModules;

const CHANNEL_ID = 'tksync-tracking';
const NOTIFICATION_ID = 'tracking-foreground';

async function ensureChannel(): Promise<string> {
  return notifee.createChannel({
    id: CHANNEL_ID,
    name: 'Vehicle Tracking',
    importance: AndroidImportance.DEFAULT,
    sound: '',
  });
}

export async function startTrackingService(ticketId?: number | null): Promise<void> {
  if (Platform.OS !== 'android') return;

  // Use native service for background GPS tracking
  if (LocationTrackingModule) {
    try {
      await LocationTrackingModule.startTracking(Number(ticketId) || 0);
      console.log('[TrackingService] Native sticky service started');
      return;
    } catch (e: any) {
      console.warn('[TrackingService] Native service failed, falling back to notifee:', e.message);
    }
  }

  // Fallback to notifee foreground service
  const channelId = await ensureChannel();
  await notifee.displayNotification({
    id: NOTIFICATION_ID,
    title: 'Vehicle Tracking Active',
    body: 'GPS location is being recorded.',
    android: {
      channelId,
      smallIcon: 'ic_launcher',
      importance: AndroidImportance.DEFAULT,
      ongoing: true,
      pressAction: {id: 'default'},
      asForegroundService: true,
      foregroundServiceTypes: [AndroidForegroundServiceType.FOREGROUND_SERVICE_TYPE_LOCATION],
      category: AndroidCategory.SERVICE,
    },
  });
  console.log('[TrackingService] Notifee foreground service started');
}

/** Fully stop everything — native service + notifee. Used on logout. */
export async function stopTrackingService(): Promise<void> {
  if (Platform.OS !== 'android') return;

  // Stop native service completely
  if (LocationTrackingModule) {
    try {
      await LocationTrackingModule.stopTracking();
      console.log('[TrackingService] Native sticky service stopped');
    } catch (e: any) {
      console.warn('[TrackingService] Native stop failed:', e.message);
    }
  }

  // Also stop notifee service
  try {
    await notifee.stopForegroundService();
    await notifee.cancelNotification(NOTIFICATION_ID);
  } catch {}
  console.log('[TrackingService] Foreground service stopped');
}
