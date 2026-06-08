import {storage} from './storage';

const BASE_URL = 'http://192.168.1.20:3000/api';

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
    token: accessToken ? `${accessToken.slice(0, 20)}...${accessToken.slice(-10)}` : 'none',
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
  amount: number;
  total_amount: number;
  tax_amount: number;
  active: boolean;
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
