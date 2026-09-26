import {Platform, NativeModules} from 'react-native';
import {captureMessage, captureError, addBreadcrumb} from './sentry';
import * as Sentry from '@sentry/react-native';

const {LocationTrackingModule} = NativeModules;

/**
 * Ships the native GPS service's diagnostic log to Sentry.
 *
 * Kill-mode failures are invisible to Sentry today: they happen while JS is
 * dead, and when the OEM kills the process and START_STICKY restarts the
 * service with no Activity, React Native never boots — so Sentry.init() never
 * runs and a native Sentry call would be a silent no-op. LocationTrackingService
 * persists events to SharedPreferences instead; this drains them on the next
 * app open, preserving the original timestamps.
 */

type DiagEvent = {
  t: number;
  type: string;
  [key: string]: unknown;
};

type DiagSnapshot = {
  events: DiagEvent[];
  last_fix_at: number;
  last_save_at: number;
  last_publish_at: number;
  system_restarts: number;
  tracking_active: boolean;
  js_alive: boolean;
  idle_mode: boolean;
  now: number;
};

/** Events that mean GPS data was lost or at risk — reported at error level. */
const SEVERE = new Set([
  'gps_stalled',
  'mqtt_down',
  'backlog_growing',
  'permission_lost',
  'service_restarted_by_system',
]);

function ageLabel(from: number, now: number): string {
  if (!from) return 'never';
  const s = Math.round((now - from) / 1000);
  if (s < 120) return `${s}s ago`;
  return `${Math.round(s / 60)}m ago`;
}

/**
 * Detects the failure that leaves no trace: the process died, so onDestroy never
 * ran and nothing was recorded — yet tracking_active is still true and the
 * service is gone. START_STICKY does not reliably restart a foreground service
 * after a process death, so GPS stays dead until the driver reopens the app.
 *
 * Returns true if a death was detected, so the caller can restart the service.
 */
export async function detectBackgroundServiceDeath(): Promise<boolean> {
  if (Platform.OS !== 'android' || !LocationTrackingModule?.isServiceRunning) return false;

  try {
    const [trackingActive, serviceRunning] = await Promise.all([
      LocationTrackingModule.isTrackingActive(),
      LocationTrackingModule.isServiceRunning(),
    ]);
    if (!trackingActive || serviceRunning) return false;

    // Flag says we should be tracking, service object says we are not.
    let gapMs = 0;
    let restarts = 0;
    try {
      const snap: DiagSnapshot = JSON.parse(await LocationTrackingModule.getDiagnostics());
      gapMs = snap.last_fix_at ? snap.now - snap.last_fix_at : 0;
      restarts = snap.system_restarts;
    } catch {
      // Diagnostics unavailable — still report the death itself.
    }

    console.warn(`[GpsDiag] Background GPS service died — no fixes for ${Math.round(gapMs / 1000)}s`);
    Sentry.withScope(scope => {
      scope.setTag('gps_failure', 'service_died_in_background');
      scope.setLevel('error');
      scope.setExtras({
        gap_seconds: String(Math.round(gapMs / 1000)),
        system_restarts: String(restarts),
        detail: 'tracking_active=true but service not running — process died and START_STICKY did not restore it',
      });
      Sentry.captureMessage('Background GPS service died and was not restarted', 'error');
    });
    return true;
  } catch (e: any) {
    console.warn('[GpsDiag] Service health check failed:', e?.message);
    return false;
  }
}

export async function reportNativeGpsDiagnostics(): Promise<void> {
  if (Platform.OS !== 'android' || !LocationTrackingModule?.getDiagnostics) return;

  let snapshot: DiagSnapshot;
  try {
    const raw = await LocationTrackingModule.getDiagnostics();
    snapshot = JSON.parse(raw);
  } catch (e: any) {
    console.warn('[GpsDiag] Failed to read native diagnostics:', e?.message);
    return;
  }

  const {events = [], now} = snapshot;
  if (events.length === 0) {
    console.log('[GpsDiag] No native diagnostic events');
    return;
  }

  console.log(`[GpsDiag] Reporting ${events.length} native diagnostic events to Sentry`);

  // Service state at the time of reporting — the same context on every event.
  const context = {
    tracking_active: snapshot.tracking_active,
    js_alive: snapshot.js_alive,
    idle_mode: snapshot.idle_mode,
    system_restarts: snapshot.system_restarts,
    last_fix: ageLabel(snapshot.last_fix_at, now),
    last_save: ageLabel(snapshot.last_save_at, now),
    last_publish: ageLabel(snapshot.last_publish_at, now),
  };

  // Every event becomes a breadcrumb so the timeline survives, then the severe
  // ones are raised individually — one Sentry issue per failure mode, grouped
  // by type rather than by the varying detail values.
  for (const ev of events) {
    const {t, type, ...detail} = ev;
    addBreadcrumb(`native_gps: ${type}`, 'gps.native', {
      at: new Date(t).toISOString(),
      ...detail,
    });
  }

  const severe = events.filter(e => SEVERE.has(e.type));
  for (const ev of severe) {
    const {t, type, ...detail} = ev;
    Sentry.withScope(scope => {
      scope.setTag('gps_failure', type);
      scope.setLevel('error');
      scope.setExtras(
        Object.fromEntries(
          Object.entries({
            occurred_at: new Date(t).toISOString(),
            ...detail,
            ...context,
          }).map(([k, v]) => [k, v == null ? 'null' : String(v)]),
        ),
      );
      Sentry.captureMessage(`Background GPS failure: ${type}`, 'error');
    });
  }

  if (severe.length === 0) {
    captureMessage(`Background GPS diagnostics: ${events.length} events, no failures`, 'info');
  }

  // Only clear once the events are handed to Sentry — a failure above leaves
  // them on disk for the next attempt rather than losing them.
  try {
    await LocationTrackingModule.clearDiagnostics();
  } catch (e: any) {
    console.warn('[GpsDiag] Failed to clear native diagnostics:', e?.message);
    captureError(e instanceof Error ? e : new Error(String(e)), {source: 'gps_diag_clear'});
  }
}
