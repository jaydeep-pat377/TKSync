import Config from 'react-native-config';
import {storage} from './storage';
import {ENDPOINTS} from './endpoints';
import {showToast} from '../utils/toast';
import {captureError, addBreadcrumb} from './sentry';

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
  const body = options.body ? JSON.parse(options.body as string) : undefined;
  const isSilent = SILENT_ENDPOINTS.some(e => endpoint.startsWith(e));

  console.log(`[API Request] ${method} ${url}`, {
    ...(body ? {params: body} : {}),
    token: accessToken || 'none',
  });

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
          return retryRes.json();
        } catch (retryErr) {
          captureError(retryErr instanceof Error ? retryErr : new Error(String(retryErr)), {endpoint, method, context: 'token_refresh_retry'});
          throw retryErr;
        }
      }
    }

    // Toast API-level errors (validation, auth, etc.) — skip silent endpoints
    if (!isSilent && !httpErr) {
      const errMsg = json.errors?.map(e => e.message).join(', ') || json.message;
      showToast('error', 'Error', errMsg);
    }

    const apiErr = new ApiError(json.message, json.error_code, json.errors);
    captureError(apiErr, {endpoint, method, status: res.status, error_code: json.error_code});
    throw apiErr;
  }

  return json;
}

async function refreshAccessToken(): Promise<boolean> {
  const refreshToken = storage.getString('refresh_token');
  if (!refreshToken) {
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
  getLatest: (params?: {page?: number; limit?: number; date?: string; all?: boolean; status?: string}) => {
    const query = new URLSearchParams();
    if (params?.status) query.set('status', params.status);
    if (params?.page) query.set('page', String(params.page));
    if (params?.limit) query.set('limit', String(params.limit));
    if (params?.date) query.set('date', params.date);
    if (params?.all) query.set('all', 'true');
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

const HEALTH_TIMEOUT_MS = 5000;

export async function checkApiHealth(): Promise<{healthy: boolean; latency: number}> {
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
    return {healthy, latency: Date.now() - start};
  } catch {
    console.log(`[Health] unreachable (${Date.now() - start}ms)`);
    return {healthy: false, latency: Date.now() - start};
  }
}
