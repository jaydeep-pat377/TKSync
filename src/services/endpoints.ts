export const ENDPOINTS = {
  // Health
  HEALTH: '/health',

  // Auth
  AUTH_COMPANY_LOGIN: '/auth/company-login',
  AUTH_DRIVER_LOGIN: '/auth/driver-login',
  AUTH_DRIVER_LOGOUT: '/auth/driver-logout',
  AUTH_COMPANY_LOGOUT: '/auth/company-logout',
  AUTH_REFRESH_TOKEN: '/auth/refresh-token',

  // Tickets
  TICKETS_LATEST: '/tickets/latest',
  TICKET_BY_ID: (id: number) => `/tickets/${id}`,
  TICKET_PRINT: (id: number) => `/tickets/${id}/print`,
  TICKET_DELIVERY_RECORD: (id: number) => `/tickets/${id}/delivery-record`,
  TICKET_DELIVERY_TAB: (id: number, tab: string) => `/tickets/${id}/delivery-record/${tab}`,
  TICKET_SIGNING: (id: number) => `/tickets/${id}/signing`,
  TICKET_SIGN: (id: number) => `/tickets/${id}/sign`,
  TICKET_DISPUTE: (id: number) => `/tickets/${id}/dispute`,
  TICKET_QR: (id: number) => `/tickets/${id}/qr`,
  TICKET_GPS: (id: number) => `/tickets/${id}/gps`,

  // Plants
  PLANTS: '/plants',

  // Curbline Release
  TICKET_CURBLINE_RELEASE: (id: number) => `/tickets/${id}/curbline-release`,

  // Tracking
  TRACKING_ME: '/tracking/me',
  TRACKING_GPS: '/tracking/gps',
  TRACKING_GPS_HISTORY: (date: string) => `/tracking/gps-history?date=${date}`,
  TRACKING_TRIP_SUMMARY: '/tracking/trip-summary',
  TRACKING_HEARTBEAT: '/tracking/heartbeat',

  // Notifications
  NOTIFICATION_REGISTER: '/notifications/register-device',
  NOTIFICATION_UNREGISTER: '/notifications/unregister-device',
  NOTIFICATION_HISTORY: '/notifications/history',
  NOTIFICATION_MARK_READ: (id: number) => `/notifications/${id}/read`,
  NOTIFICATION_READ_ALL: '/notifications/read-all',

  // Field Definitions
  FIELD_DEFINITIONS: '/field-definitions',
} as const;
