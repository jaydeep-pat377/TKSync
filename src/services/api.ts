import Config from 'react-native-config';
import {storage} from './storage';

const BASE_URL = Config.API_BASE_URL || '';

type ApiResponse<T = any> = {
  success: boolean;
  message: string;
  data: T;
  errors?: Array<{field: string; message: string}>;
  error_code?: string;
};

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

  console.log(`[API Request] ${method} ${url}`, {
    ...(body ? {params: body} : {}),
    token: accessToken || 'none',
  });

  const res = await fetch(url, {
    ...options,
    headers,
  });

  const json: ApiResponse<T> = await res.json();

  console.log(`[API Response] ${method} ${url}`, {
    status: res.status,
    success: json.success,
    data: json.data,
    ...(json.error_code ? {error_code: json.error_code} : {}),
    ...(json.message ? {message: json.message} : {}),
    ...(json.errors ? {errors: json.errors} : {}),
  });

  if (!json.success) {
    // If token expired, try refresh
    if (res.status === 401 && json.error_code === 'TOKEN_EXPIRED') {
      const refreshed = await refreshAccessToken();
      if (refreshed) {
        headers.Authorization = `Bearer ${storage.getString('access_token')}`;
        const retryRes = await fetch(`${BASE_URL}${endpoint}`, {
          ...options,
          headers,
        });
        return retryRes.json();
      }
    }
    throw new ApiError(json.message, json.error_code, json.errors);
  }

  return json;
}

async function refreshAccessToken(): Promise<boolean> {
  const refreshToken = storage.getString('refresh_token');
  if (!refreshToken) {
    return false;
  }

  try {
    const res = await fetch(`${BASE_URL}/auth/refresh-token`, {
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

  // Refresh failed — clear tokens
  storage.remove('access_token');
  storage.remove('refresh_token');
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
  };
  trucks?: {truck_code: string; status: string; is_current: boolean}[];
  location?: {
    delivery?: {lat: number; lng: number; radius_m?: number};
    plant?: {lat: number; lng: number};
    route?: {distance_miles: number | null; duration: number | null; calculated_at: string | null};
    truck?: {lat: number; lng: number; updated_at: string | null};
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

export const ticketsApi = {
  getLatest: (params?: {page?: number; limit?: number; date?: string; all?: boolean}) => {
    const query = new URLSearchParams();
    if (params?.page) query.set('page', String(params.page));
    if (params?.limit) query.set('limit', String(params.limit));
    if (params?.date) query.set('date', params.date);
    if (params?.all) query.set('all', 'true');
    const qs = query.toString();
    return request<TicketsResponse>(`/tickets/latest${qs ? `?${qs}` : ''}`);
  },
  getById: (id: number) =>
    request<TicketDetail>(`/tickets/${id}`),
  getPrintable: (id: number) =>
    request<MobileTicketPrint>(`/tickets/${id}/print`),
  getDeliveryRecord: (id: number) =>
    request<DeliveryRecord>(`/tickets/${id}/delivery-record`),
  saveDeliveryTab: (id: number, tab: string, body: Record<string, any>) =>
    request<DeliveryRecord>(`/tickets/${id}/delivery-record/${tab}`, {
      method: 'PUT',
      body: JSON.stringify(body),
    }),
  sign: (id: number, body: {email?: string; customer_notes?: string; signed_name: string; signature_image: string}) =>
    request(`/tickets/${id}/sign`, {
      method: 'POST',
      body: JSON.stringify(body),
    }),
  dispute: (id: number, body: {quantity: number; reason: string; signed_name: string; signature_image: string; product_code?: string; product_description?: string; quantity_unit?: string}) =>
    request(`/tickets/${id}/dispute`, {
      method: 'POST',
      body: JSON.stringify(body),
    }),
};

export const authApi = {
  companyLogin: (company_code: string) =>
    request<CompanyLoginResponse>('/auth/company-login', {
      method: 'POST',
      body: JSON.stringify({company_code}),
    }),

  driverLogin: (truck_code: string, employee_code: string) =>
    request<DriverLoginResponse>('/auth/driver-login', {
      method: 'POST',
      body: JSON.stringify({truck_code, employee_code}),
    }),

  driverLogout: () =>
    request<DriverLogoutResponse>('/auth/driver-logout', {
      method: 'POST',
    }),

  companyLogout: () =>
    request<CompanyLogoutResponse>('/auth/company-logout', {
      method: 'POST',
    }),
};
