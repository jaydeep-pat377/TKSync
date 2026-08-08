import Config from 'react-native-config';
import {storage} from './storage';
import {ENDPOINTS} from './endpoints';
import {showToast} from '../utils/toast';
import {captureError, addBreadcrumb} from './sentry';
import {getIsOnline} from '../hooks/useNetworkStatus';

const BASE_URL = Config.API_BASE_URL || '';

let onSessionExpired: (() => void) | null = null;

export function setOnSessionExpired(cb: (() => void) | null) {
  onSessionExpired = cb;
}

type ApiResponse<T = any> = {
  success: boolean;
  message: string;
  data: T;
  errors?: Array<{field: string; message: string}>;
  error_code?: string;
};

const REQUEST_TIMEOUT_MS = 30000;

// Endpoints where errors are handled locally (no global toast)
const SILENT_ENDPOINTS = [
  ENDPOINTS.AUTH_COMPANY_LOGIN,
  ENDPOINTS.AUTH_DRIVER_LOGIN,
  ENDPOINTS.HEALTH,
  ENDPOINTS.NOTIFICATION_REGISTER,
  ENDPOINTS.NOTIFICATION_UNREGISTER,
  ENDPOINTS.TRACKING_ME,
  ENDPOINTS.TRACKING_HEARTBEAT,
  ENDPOINTS.TRACKING_MQTT_TOKEN,
  ENDPOINTS.KRONOS_CLOCK_IN,
  ENDPOINTS.KRONOS_CLOCK_OUT,
  ENDPOINTS.KRONOS_STATUS,
];

function classifyError(err: unknown): {title: string; message: string} {
  if (err instanceof TypeError && err.message === 'Network request failed') {
    return {title: 'Server Error', message: 'Unable to connect to the server. Please try again later.'};
  }
  if (err instanceof DOMException || (err instanceof Error && err.name === 'AbortError')) {
    return {title: 'Server Error', message: 'Server took too long to respond. Please try again later.'};
  }
  if (err instanceof Error && err.message.includes('Network request failed')) {
    return {title: 'Server Error', message: 'Unable to connect to the server. Please try again later.'};
  }
  return {title: 'Server Error', message: 'Something went wrong. Please try again later.'};
}

function classifyHttpStatus(status: number): {title: string; message: string} | null {
  if (status >= 500) return {title: 'Server Error', message: 'The server encountered a problem. Please try again later.'};
  if (status === 408) return {title: 'Request Timeout', message: 'Server took too long to respond.'};
  if (status === 429) return {title: 'Too Many Requests', message: 'Please wait a moment and try again.'};
  return null;
}

async function request<T = any>(
  endpoint: string,
  options: RequestInit = {},
): Promise<ApiResponse<T>> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...((options.headers as Record<string, string>) || {}),
  };

  const accessToken = storage.getString('access_token');
  if (accessToken) {
    headers.Authorization = `Bearer ${accessToken}`;
  }

  const url = `${BASE_URL}${endpoint}`;
  const method = options.method || 'GET';
  const isSilent = SILENT_ENDPOINTS.some(e => endpoint.startsWith(e));

  // Pre-check internet connection — fail fast instead of waiting for timeout
  if (!getIsOnline()) {
    const offlineMsg = 'You are offline. Please check your internet connection.';
    console.warn(`[API] ${method} ${endpoint} — offline, skipping request`);
    if (!isSilent) showToast('error', 'No Internet', offlineMsg);
    throw new ApiError(offlineMsg, 'OFFLINE');
  }

  try {
    console.log(`[API Request] ${method} ${url}`, options.body
      ? JSON.parse(options.body as string)
      : '(no body)');
  } catch {
    console.log(`[API Request] ${method} ${url}`, '(body not JSON)');
  }
  console.log(`[API Token] ${accessToken ? `Bearer ${accessToken}` : 'NO TOKEN'}`);

  let res: Response;
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
    res = await fetch(url, {
      ...options,
      headers,
      signal: options.signal || controller.signal,
    });
    clearTimeout(timer);
  } catch (err) {
    const {title, message} = classifyError(err);
    console.warn(`[API] ${method} ${endpoint} — ${title}: ${message}`);
    if (!isSilent) showToast('error', title, message);
    captureError(err instanceof Error ? err : new Error(String(err)), {endpoint, method});
    throw err;
  }

  // Server-level errors (5xx, 408, 429)
  const httpErr = classifyHttpStatus(res.status);
  if (httpErr) {
    console.warn(`[API] ${method} ${endpoint} — HTTP ${res.status}`);
    if (!isSilent) showToast('error', httpErr.title, httpErr.message);
    captureError(new Error(`HTTP ${res.status}: ${httpErr.title}`), {endpoint, method, status: res.status});
  }

  let json: ApiResponse<T>;
  try {
    json = await res.json();
  } catch {
    const msg = 'Invalid response from server.';
    console.warn(`[API] ${method} ${endpoint} — JSON parse failed`);
    if (!isSilent) showToast('error', 'Server Error', msg);
    captureError(new Error('API response parse failed'), {endpoint, method, status: res.status});
    throw new ApiError(msg, 'PARSE_ERROR');
  }

  console.log(`[API Response] ${method} ${url}`, {
    status: res.status,
    success: json.success,
    data: json.data,
    ...(json.error_code ? {error_code: json.error_code} : {}),
    ...(json.message ? {message: json.message} : {}),
    ...(json.errors ? {errors: json.errors} : {}),
  });

  addBreadcrumb(`${method} ${endpoint}`, 'api', {status: res.status, success: json.success});

  if (!json.success) {
    // If token expired, try refresh
    if (res.status === 401 && json.error_code === 'TOKEN_EXPIRED') {
      console.log('[API] Access token expired, attempting refresh...');
      const refreshed = await refreshAccessToken();
      if (refreshed) {
        try {
          headers.Authorization = `Bearer ${storage.getString('access_token')}`;
          const retryRes = await fetch(`${BASE_URL}${endpoint}`, {
            ...options,
            headers,
          });
          const retryJson: ApiResponse<T> = await retryRes.json();
          if (!retryRes.ok || !retryJson.success) {
            const retryApiErr = new ApiError(retryJson.message || `HTTP ${retryRes.status}`, retryJson.error_code, retryJson.errors);
            retryApiErr.status = retryRes.status;
            throw retryApiErr;
          }
          return retryJson;
        } catch (retryErr) {
          captureError(retryErr instanceof Error ? retryErr : new Error(String(retryErr)), {endpoint, method, context: 'token_refresh_retry'});
          throw retryErr;
        }
      }
      // refresh failed — onSessionExpired already called by refreshAccessToken
    } else if (res.status === 401) {
      // Non-TOKEN_EXPIRED 401 (session revoked from web, driver logged out, etc.)
      console.log(`[API] Session invalid (401, error_code=${json.error_code}) — logging out`);
      onSessionExpired?.();
    }

    // Toast API-level errors (validation, auth, etc.) — skip silent endpoints
    // Skip on 401 — onSessionExpired already shows "Session Expired" toast
    if (!isSilent && !httpErr && res.status !== 401) {
      const errMsg = json.errors?.map(e => e.message).join(', ') || json.message;
      showToast('error', 'Error', errMsg);
    }

    const apiErr = new ApiError(json.message, json.error_code, json.errors);
    apiErr.status = res.status;
    captureError(apiErr, {endpoint, method, status: res.status, error_code: json.error_code});
    throw apiErr;
  }

  return json;
}

async function refreshAccessToken(): Promise<boolean> {
  const refreshToken = storage.getString('refresh_token');
  if (!refreshToken) {
    // No refresh token — session is dead, trigger logout
    storage.remove('access_token');
    onSessionExpired?.();
    return false;
  }

  try {
    const res = await fetch(`${BASE_URL}${ENDPOINTS.AUTH_REFRESH_TOKEN}`, {
      method: 'POST',
      headers: {'Content-Type': 'application/json'},
      body: JSON.stringify({refresh_token: refreshToken}),
    });

    const json: ApiResponse<{access_token: string; type: string}> =
      await res.json();

    if (json.success) {
      storage.set('access_token', json.data.access_token);
      // Update native service token for background API uploads
      try {
        const {NativeModules: NM, Platform: P} = require('react-native');
        if (P.OS === 'android' && NM.LocationTrackingModule) {
          NM.LocationTrackingModule.updateApiToken(json.data.access_token).catch(() => {});
        }
      } catch {}
      return true;
    }
  } catch {}

  // Refresh failed — clear tokens and notify
  console.log('[API] Refresh token failed — session expired, redirecting to login');
  storage.remove('access_token');
  storage.remove('refresh_token');
  onSessionExpired?.();
  return false;
}

export class ApiError extends Error {
  status?: number;
  error_code?: string;
  errors?: Array<{field: string; message: string}>;

  constructor(
    message: string,
    error_code?: string,
    errors?: Array<{field: string; message: string}>,
  ) {
    super(message);
    this.name = 'ApiError';
    this.error_code = error_code;
    this.errors = errors;
  }
}

// --- Auth API ---

export type CompanyLoginResponse = {
  company_id: number;
  company_name: string;
  company_code: string;
  tenant_selected: boolean;
  token: string;
  access_token: string;
  refresh_token: string;
};

export type DriverLoginResponse = {
  driver_id: number;
  driver_code: string;
  driver_name: string;
  truck_id: number;
  truck_code: string;
  access_token: string;
  refresh_token: string;
};

export type DriverLogoutResponse = {
  tenant_selected: boolean;
  company_code: string;
  token: string;
  access_token: string;
  refresh_token: string;
};

export type CompanyLogoutResponse = {
  tenant_selected: boolean;
};

// --- Ticket API ---

export type Ticket = {
  id: number;
  ticket_id: number;
  ticket_code: string;
  order_code: string;
  order_id: number;
  created_date: string;
  order_date: string;
  current_status: number;
  order_current_status: number;
  payment_form: string;
  truck_code: string;
  driver_code: string;
  driver_name: string;
  plant_code: string;
  plant_name: string;
  location_code: string;
  location_name: string;
  customer_code: string;
  customer_name: string;
  customer_job: string;
  project_code: string;
  project_name: string;
  delivery_addr1: string;
  delivery_addr2: string;
  delivery_addr3: string;
  load_time: string | null;
  to_job_time: string | null;
  on_job_time: string | null;
  unload_time: string | null;
  end_unload: string | null;
  wash_time: string | null;
  to_plant_time: string | null;
  at_plant_time: string | null;
  load_time_local: string | null;
  to_job_time_local: string | null;
  on_job_time_local: string | null;
  unload_time_local: string | null;
  end_unload_local: string | null;
  wash_time_local: string | null;
  to_plant_time_local: string | null;
  at_plant_time_local: string | null;
  amount: number;
  total_amount: number;
  tax_amount: number;
  active: boolean;
  status_label?: string;
  mix?: {
    mix_code: string | null;
    description: string | null;
    slump: string | null;
    quantity: string | null;
    load_size: string | null;
  };
};

export type TicketsResponse = {
  page: number;
  limit: number;
  total: number;
  total_pages: number;
  has_next: boolean;
  has_prev: boolean;
  data: Ticket[];
  filters: {
    date_from: string | null;
    date_to: string | null;
    active: boolean | null;
    defaulted_to_latest_day: boolean;
  };
};

export type ProgressStep = {
  key: string;
  label: string;
  time: string | null;
  time_local: string | null;
  done: boolean;
};

export type TicketDetail = {
  ticket: {
    id: number;
    ticket_id: number;
    ticket_code: string;
    order_code: string;
    truck_code: string;
    driver_code: string;
    driver_name: string;
    active: boolean;
    in_process?: boolean;
    delivery_state?: 'active' | 'completed' | 'voided';
    status_label?: string;
    current_status: number;
    order_current_status: number;
    payment_form: string;
    payment_terms: string | null;
    amount: number;
    total_amount: number;
    tax_amount: number;
    created_date: string;
    order_date: string;
  };
  progress: {
    completed: number;
    total: number;
    steps: ProgressStep[];
  };
  job: {
    customer_code: string;
    customer_name: string;
    project_code: string | null;
    project_name: string | null;
    job: string | null;
    time_due: string | null;
    time_due_local: string | null;
    delivered_to: string | null;
    lot_block: string | null;
    instructions: string | null;
  };
  mix: {
    mix_code: string | null;
    usage: string | null;
    slump: string | null;
    quantity: string | null;
    loads: {current: number | null; total: number};
    truck_code: string;
    products?: {code: string; description: string; is_mix: boolean; slump: number | null; slump_text: string | null; delivered_qty: number | null; delivered_unit: string | null; order_qty: number | null; order_unit: string | null}[];
    trucks?: {truck_code: string; name?: string; status: string; is_current: boolean; position?: {lat: number; lng: number; updated_at: string | null} | null}[];
    truck_ahead?: {truck_code: string; status: string} | null;
    truck_behind?: {truck_code: string; status: string} | null;
  };
  location?: {
    delivery?: {lat: number; lng: number; radius_m?: number};
    plant?: {lat: number; lng: number};
    route?: {distance_miles: number | null; duration: number | null; calculated_at: string | null};
    truck?: {lat: number; lng: number; updated_at: string | null};
  };
  weather?: {
    captured_at: string;
    condition: string;
    description: string;
    icon: string;
    temperature_c: number;
    temperature_f: number;
    humidity: number;
    wind_speed_mph: number;
    wind_direction: string;
    evaporation_rate: number;
    evaporation_level: string;
  } | null;
  map?: {
    type: string;
    address?: string;
    value?: string;
    mapPage?: string;
    latitude: number | null;
    longitude: number | null;
    status: string;
    is_current: boolean;
    directions: boolean;
  }[];
  mandatory_fields?: {
    plant: string[];
    jobsite: string[];
    returned: string[];
    time: string[];
    cod: string[];
  };
};

export type DeliveryRecord = {
  ticket: {
    id: number;
    ticket_id: number;
    ticket_code: string;
    order_code: string;
    truck_code: string;
    driver_name: string;
    plant_name: string;
  };
  saved_at: string | null;
  saved_by: string | null;
  plant: {
    slump_from_plant: number | null;
    slump_to_job: number | null;
    temp_at_plant: number | null;
    water_added_full: number | null;
    water_reason: string | null;
    truck_start: string | null;
    truck_end: string | null;
    hand_added: boolean | null;
    nitrogen_added: boolean | null;
    fibers_added: boolean | null;
    load_tested: boolean | null;
    notes: string | null;
    products: {item_code: string; description: string; quantity: number | null; unit: string | null}[];
    measured: {
      slump_from_plant: string | null;
      slump_to_job: string | null;
      temp_at_plant: string | null;
      temper_water: number | null;
      temper_water_unit: string | null;
    };
  };
  jobsite: {
    full_load_litres: number | null;
    full_load_reason: string | null;
    full_load_mm: number | null;
    customer_water_litres: number | null;
    customer_water_mm: number | null;
    maintenance_water_litres: number | null;
    maintenance_water_mm: number | null;
    super_plasticizer: string | null;
    conveyor: string | null;
    color: string | null;
    fiber: string | null;
    other: string | null;
    conveyor_ordered_not_used: boolean | null;
    unloaded_conveyor: boolean | null;
    load_disputed: boolean | null;
    washout_area: string | null;
    load_tested: boolean | null;
    notes: string | null;
    measured: {
      full_load_total: string | null;
      max_allowed_water: string | null;
    };
  };
  returned: {
    returned_concrete_m3: number | null;
    disposal_method: string | null;
    reason_for_return: string | null;
    options: {
      disposal_methods: {code: string; label: string}[];
      return_reasons: {code: string; label: string}[];
    };
  };
  time: {
    completed: number;
    total: number;
    steps: {key: string; label: string; time: string | null; done: boolean}[];
  };
  cod: {
    payment_type: string | null;
    payment_form_code: number | null;
    amount: number | null;
    wait_time_minutes: number | null;
    notes: string | null;
    options: {
      payment_types: {code: string; label: string}[];
    };
  };
  mandatory_fields?: {
    plant: string[];
    jobsite: string[];
    returned: string[];
    time: string[];
    cod: string[];
  };
  field_definitions?: {
    [tab: string]: {
      [field: string]: {
        field_type: string;
        value_type: string;
        title: string;
        mandatory: boolean;
        sort_order?: number;
        depends_on?: { field: string; value: any };
        config?: {
          group?: string;
          group_title?: string;
          group_icon?: string;
          group_sort?: number;
          input_style?: string;
          options?: (string | number)[];
          min?: number;
          max?: number;
          placeholder?: string;
          lockable?: boolean;
          companion?: string;
          is_companion?: boolean;
          row_group?: string;
          sub_label?: string;
          step?: number;
          full_width?: boolean;
          section_title?: string;
          section_icon?: string;
          show_products_link?: boolean;
        };
      };
    };
  };
};

export type MobileTicketPrint = {
  header: {
    id: number;
    ticket_id: number;
    ticket_code: string;
    order_code: string;
    order_date: string;
    qr_value: string;
  };
  customer: {
    customer_name: string;
    project_name: string | null;
    address: string | null;
    map_page: string | null;
    ordered_by: string | null;
    ordered_by_phone: string | null;
    job: string | null;
    purchase_order: string | null;
    instructions: string | null;
  };
  driver_truck: {
    driver_code: string;
    driver_name: string;
    truck_code: string;
    truck_ahead: string | null;
    plant_name: string;
    usage: string | null;
    slump: string | null;
    mix_code: string | null;
    load: {
      size: number | null;
      unit: string | null;
      poured: number;
      display: string | null;
    };
    quantity: {
      this_load: number | null;
      order_total: number | null;
      unit: string | null;
      display: string | null;
    };
  };
  timeline: {
    completed: number;
    total: number;
    steps: {key: string; label: string; time: string | null; done: boolean}[];
  };
  totals: {
    subtotal: number | null;
    tax: number | null;
    total: number | null;
    on_account: boolean;
    total_display: string | number | null;
    payment_form: string | null;
    payment_terms: string | null;
  };
  charges: {
    code: string;
    product_id: number;
    description: string;
    is_mix: boolean;
    quantity: number | null;
    unit: string | null;
    price: number | null;
    amount: number | null;
  }[];
  signature_status: {
    is_signed: boolean;
    is_disputed: boolean;
    signed_name: string | null;
    signed_at: string | null;
  };
};

export type SigningData = {
  ticket: {
    id: number;
    ticket_id: number;
    ticket_code: string;
    order_code: string;
    order_date: string;
    customer_name: string;
    project_name: string;
    job: string;
    address: string;
    driver_code: string;
    driver_name: string;
    truck_code: string;
    plant_name: string;
    amount: number;
    total_amount: number;
    tax_amount: number;
  };
  products: {
    code: string;
    product_id: string;
    description: string;
    is_mix: boolean;
    quantity: number;
    unit: string;
    price: number;
    amount: number | null;
  }[];
  legal: {
    caution: string;
    terms_en: string;
    terms_fr: string;
  };
  status: {
    is_signed: boolean;
    is_disputed: boolean;
    accepted: {
      email: string | null;
      customer_notes: string | null;
      signed_name: string | null;
      signature_image: string | null;
    } | null;
    dispute: {
      quantity: number | null;
      reason: string | null;
      signed_name: string | null;
      signature_image: string | null;
    } | null;
  };
};

export const ticketsApi = {
  getLatest: (params?: {page?: number; limit?: number; date?: string; all?: boolean; status?: string; active?: boolean}) => {
    const query = new URLSearchParams();
    if (params?.status) query.set('status', params.status);
    if (params?.page) query.set('page', String(params.page));
    if (params?.limit) query.set('limit', String(params.limit));
    if (params?.date) query.set('date', params.date);
    if (params?.all) query.set('all', 'true');
    if (params?.active !== undefined) query.set('active', String(params.active));
    const qs = query.toString();
    return request<TicketsResponse>(`${ENDPOINTS.TICKETS_LATEST}${qs ? `?${qs}` : ''}`);
  },
  getById: (id: number) =>
    request<TicketDetail>(ENDPOINTS.TICKET_BY_ID(id)),
  getSigning: (id: number) =>
    request<SigningData>(ENDPOINTS.TICKET_SIGNING(id)),
  getPrintable: (id: number) =>
    request<MobileTicketPrint>(ENDPOINTS.TICKET_PRINT(id)),
  getDeliveryRecord: (id: number) =>
    request<DeliveryRecord>(ENDPOINTS.TICKET_DELIVERY_RECORD(id)),
  saveDeliveryTab: (id: number, tab: string, body: Record<string, any>) =>
    request<DeliveryRecord>(ENDPOINTS.TICKET_DELIVERY_TAB(id, tab), {
      method: 'PUT',
      body: JSON.stringify(body),
    }),
  sign: (id: number, body: {email?: string; customer_notes?: string; signed_name: string; signature_image: string}) =>
    request(ENDPOINTS.TICKET_SIGN(id), {
      method: 'POST',
      body: JSON.stringify(body),
    }),
  dispute: (id: number, body: {quantity: number; reason: string; signed_name: string; signature_image: string; product_code?: string; product_description?: string; quantity_unit?: string}) =>
    request(ENDPOINTS.TICKET_DISPUTE(id), {
      method: 'POST',
      body: JSON.stringify(body),
    }),
  getQr: (id: number) =>
    request<TicketQr>(ENDPOINTS.TICKET_QR(id)),
  curblineRelease: (id: number, body: {name: string; sign: string}) =>
    request(ENDPOINTS.TICKET_CURBLINE_RELEASE(id), {
      method: 'POST',
      body: JSON.stringify(body),
    }),
  getGpsRecords: (id: number) =>
    request<{count: number; points: {latitude: number; longitude: number; speed: number | null; heading: number | null; altitude: number | null; accuracy: number | null; recorded_at: string}[]}>(ENDPOINTS.TICKET_GPS(id)),
  getCurblineRelease: (id: number) =>
    request<{curbline_release: {id: number; signed_name: string; signature_image: string; signed_at: string} | null; ticket_id: number; ticket_code: string}>(ENDPOINTS.TICKET_CURBLINE_RELEASE(id)),
  updateCurblineRelease: (id: number, body: {name: string; sign: string}) =>
    request(ENDPOINTS.TICKET_CURBLINE_RELEASE(id), {
      method: 'PUT',
      body: JSON.stringify(body),
    }),
};

export type TicketQr = {
  qr_token: string;
  order_code: string;
  ticket_code: string;
  truck_code: string;
  driver_code: string;
  plant_name: string;
};

export type Plant = {
  id: number;
  code: string;
  name: string;
  description: string;
  address: string | null;
  phone: string | null;
  location_code: string;
  timezone: string;
  location: { lat: number; lng: number } | null;
  max_batch_size: number;
  max_batch_size_unit: string | null;
};

export type PlantsResponse = {
  truck: {
    code: string;
    assigned_plant_code: string;
    assigned_plant_name: string;
    current_plant_code: string;
    current_plant_name: string;
  };
  count: number;
  page: number;
  limit: number;
  total: number;
  total_pages: number;
  has_next: boolean;
  has_prev: boolean;
  plants: Plant[];
};

export const plantsApi = {
  getAll: (page = 1, limit = 20) =>
    request<PlantsResponse>(`${ENDPOINTS.PLANTS}?page=${page}&limit=${limit}`),
};

export type DriverNotification = {
  id: number;
  employee_code: string;
  truck_code: string | null;
  title: string;
  message: string;
  sender: string | null;
  read: boolean;
  created_at: string;
};

export type NotificationHistoryResponse = {
  notifications: DriverNotification[];
  unread: number;
};

export const notificationsApi = {
  registerDevice: (fcm_token: string, platform: string) =>
    request(ENDPOINTS.NOTIFICATION_REGISTER, {
      method: 'POST',
      body: JSON.stringify({fcm_token, platform}),
    }),
  unregisterDevice: (fcm_token: string) =>
    request(ENDPOINTS.NOTIFICATION_UNREGISTER, {
      method: 'DELETE',
      body: JSON.stringify({fcm_token}),
    }),
  getHistory: (limit = 50, offset = 0) =>
    request<NotificationHistoryResponse>(
      `${ENDPOINTS.NOTIFICATION_HISTORY}?limit=${limit}&offset=${offset}`,
    ),
  markRead: (id: number) =>
    request(ENDPOINTS.NOTIFICATION_MARK_READ(id), {method: 'POST'}),
  markAllRead: () =>
    request(ENDPOINTS.NOTIFICATION_READ_ALL, {method: 'POST'}),
};

export type MqttTokenResponse = {
  url: string;
  username: string;
  token: string;
  topic: string;
  expiresIn: number;
};

export const trackingApi = {
  getMe: () =>
    request<{truck: any; current_load: {id: number; ticket_id: number; ticket_code: string} | null; eta: any}>(ENDPOINTS.TRACKING_ME),
  getGpsHistory: (date: string) =>
    request<{truck_code: string; date: string; count: number; points: {latitude: number; longitude: number; speed: number | null; heading: number | null; altitude: number | null; accuracy: number | null; recorded_at: string}[]}>(ENDPOINTS.TRACKING_GPS_HISTORY(date)),
  getMqttToken: () =>
    request<MqttTokenResponse>(ENDPOINTS.TRACKING_MQTT_TOKEN, {method: 'POST'}),
};

export const heartbeatApi = {
  ping: () =>
    request(ENDPOINTS.TRACKING_HEARTBEAT, { method: 'POST' }),
};

export const gpsApi = {
  saveTripSummary: (summary: {ticket_id: number | null; started_at: string; ended_at: string; total_distance_m: number; total_duration_s: number; max_speed_ms: number; avg_speed_ms: number; hard_brakes: number; hard_corners: number; total_idle_time_s: number}) =>
    request<{id: number}>(ENDPOINTS.TRACKING_TRIP_SUMMARY, {
      method: 'POST',
      body: JSON.stringify(summary),
    }),
};

export const authApi = {
  companyLogin: (company_code: string) =>
    request<CompanyLoginResponse>(ENDPOINTS.AUTH_COMPANY_LOGIN, {
      method: 'POST',
      body: JSON.stringify({company_code}),
    }),

  driverLogin: (truck_code: string, employee_code: string) =>
    request<DriverLoginResponse>(ENDPOINTS.AUTH_DRIVER_LOGIN, {
      method: 'POST',
      body: JSON.stringify({truck_code, employee_code}),
    }),

  driverLogout: () =>
    request<DriverLogoutResponse>(ENDPOINTS.AUTH_DRIVER_LOGOUT, {
      method: 'POST',
    }),

  companyLogout: () =>
    request<CompanyLogoutResponse>(ENDPOINTS.AUTH_COMPANY_LOGOUT, {
      method: 'POST',
    }),
};

// --- Kronos Time & Attendance API ---

export type KronosClockResponse = {
  punched_at: string;
  kronos_employee_id: string;
  status: 'clocked_in' | 'clocked_out';
};

export type KronosShift = {
  clock_in: string;
  clock_out: string | null;
  duration_minutes: number | null;
};

export type KronosStatusResponse = {
  is_clocked_in: boolean;
  last_punch_at: string | null;
  kronos_employee_id: string | null;
  shifts?: KronosShift[];
  weekly_hours?: number;
};

export const kronosApi = {
  clockIn: () =>
    request<KronosClockResponse>(ENDPOINTS.KRONOS_CLOCK_IN, {
      method: 'POST',
    }),

  clockOut: () =>
    request<KronosClockResponse>(ENDPOINTS.KRONOS_CLOCK_OUT, {
      method: 'POST',
    }),

  startBreak: (reason: string) =>
    request<{start: string; reason: string}>(ENDPOINTS.KRONOS_BREAK_START, {
      method: 'POST',
      body: JSON.stringify({reason}),
    }),

  endBreak: () =>
    request<{start: string; end: string; reason: string; duration_minutes: number}>(ENDPOINTS.KRONOS_BREAK_END, {
      method: 'POST',
    }),

  getStatus: () =>
    request<KronosStatusResponse>(ENDPOINTS.KRONOS_STATUS),
};

const HEALTH_TIMEOUT_MS = 5000;

export async function checkApiHealth(): Promise<{healthy: boolean; latency: number; version?: string}> {
  const start = Date.now();
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), HEALTH_TIMEOUT_MS);
    const res = await fetch(`${BASE_URL}${ENDPOINTS.HEALTH}`, {
      method: 'GET',
      signal: controller.signal,
    });
    clearTimeout(timer);
    const json = await res.json();
    const healthy = res.status === 200 && json.status === 'healthy';
    console.log(`[Health] ${healthy ? 'healthy' : 'unhealthy'} (${Date.now() - start}ms)`);
    return {healthy, latency: Date.now() - start, version: json.version || undefined};
  } catch {
    console.log(`[Health] unreachable (${Date.now() - start}ms)`);
    return {healthy: false, latency: Date.now() - start};
  }
}
