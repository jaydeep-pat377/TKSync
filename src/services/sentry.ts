import * as Sentry from '@sentry/react-native';
import Config from 'react-native-config';

const DSN = Config.SENTRY_DSN || '';
const ENVIRONMENT = Config.SENTRY_ENVIRONMENT || (__DEV__ ? 'debug' : 'production');
const IS_DEBUG = __DEV__ || ENVIRONMENT === 'debug';

export function initSentry() {
  if (!DSN) {
    console.log('[Sentry] No DSN configured, skipping init');
    return;
  }

  Sentry.init({
    dsn: DSN,
    environment: ENVIRONMENT,
    debug: false,
    enabled: true,
    // release auto-detected from native build info by @sentry/react-native
    tracesSampleRate: IS_DEBUG ? 1.0 : 0.2,
    sampleRate: 1.0,
    maxBreadcrumbs: IS_DEBUG ? 100 : 50,
    sendDefaultPii: true,

    beforeSend(event) {
      if (event.request?.headers) {
        delete event.request.headers.Authorization;
        delete event.request.headers.authorization;
      }
      return event;
    },

    beforeBreadcrumb(breadcrumb) {
      if (!IS_DEBUG && breadcrumb.category === 'console') {
        return null;
      }
      // Android native SDK expects timestamp as ISO string, not a number
      if (typeof breadcrumb.timestamp === 'number') {
        breadcrumb.timestamp = new Date(breadcrumb.timestamp * 1000).toISOString() as any;
      }
      // Android requires all breadcrumb data values to be strings
      if (breadcrumb.data) {
        try {
          breadcrumb.data = Object.fromEntries(
            Object.entries(breadcrumb.data).map(([k, v]) => [
              k,
              v == null ? 'null' : typeof v === 'object' ? JSON.stringify(v) : String(v),
            ]),
          );
        } catch {
          breadcrumb.data = undefined;
        }
      }
      return breadcrumb;
    },
  });

  console.log(`[Sentry] Initialized (${ENVIRONMENT})`);
}

export function captureError(error: Error, context?: Record<string, any>) {
  Sentry.withScope(scope => {
    if (context) {
      // Android Sentry requires all extra values to be strings
      const safe = Object.fromEntries(
        Object.entries(context).map(([k, v]) => [k, v == null ? 'null' : String(v)]),
      );
      scope.setExtras(safe);
    }
    Sentry.captureException(error);
  });
}

export function captureMessage(message: string, level: Sentry.SeverityLevel = 'info') {
  Sentry.captureMessage(message, level);
}

export function setSentryUser(user: {id: string; driverCode?: string; truckCode?: string; companyCode?: string} | null) {
  if (user) {
    Sentry.setUser({id: user.id, username: user.driverCode});
    Sentry.setTag('truck_code', user.truckCode || 'unknown');
    Sentry.setTag('company_code', user.companyCode || 'unknown');
  } else {
    Sentry.setUser(null);
  }
}

export function addBreadcrumb(message: string, category: string, data?: Record<string, any>) {
  // Android Sentry requires all breadcrumb data values to be strings
  const safeData = data
    ? Object.fromEntries(Object.entries(data).map(([k, v]) => [k, String(v)]))
    : undefined;
  Sentry.addBreadcrumb({message, category, data: safeData, level: 'info'});
}
