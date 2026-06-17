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
  TICKET_SIGN: (id: number) => `/tickets/${id}/sign`,
  TICKET_DISPUTE: (id: number) => `/tickets/${id}/dispute`,
  TICKET_QR: (id: number) => `/tickets/${id}/qr`,

  // Plants
  PLANTS: '/plants',
} as const;
