/**
 * Client-side validation for delivery record tab saves.
 * Mirrors the backend's cleanTabPayload() so invalid data is caught
 * BEFORE queueing for offline sync — preventing silent data loss
 * when the sync replays and the backend rejects with 422.
 */

type FieldType = 'number' | 'boolean' | 'string' | 'datetime' | string; // string covers 'enum:...'

// Matches backend FIELD_TYPES in constants/deliveryRecord.js
const FIELD_TYPES: Record<string, Record<string, FieldType>> = {
  plant: {
    slump_from_plant: 'number',
    slump_to_job: 'number',
    temp_at_plant: 'number',
    water_added_full: 'number',
    water_reason: 'string',
    truck_start: 'datetime',
    truck_end: 'datetime',
    hand_added: 'boolean',
    nitrogen_added: 'string',
    fibers_added: 'string',
    load_tested: 'string',
    load_temp: 'number',
    load_air: 'number',
    load_slump: 'number',
    load_cylinders: 'number',
    notes: 'string',
  },
  jobsite: {
    full_load_litres: 'number',
    full_load_reason: 'string',
    full_load_mm: 'number',
    customer_water_litres: 'number',
    customer_water_mm: 'number',
    maintenance_water_litres: 'number',
    maintenance_water_mm: 'number',
    super_plasticizer: 'string',
    super_plasticizer_qty: 'number',
    conveyor: 'string',
    conveyor_qty: 'number',
    color: 'string',
    color_qty: 'number',
    fiber: 'string',
    fiber_qty: 'number',
    other: 'string',
    conveyor_ordered_not_used: 'boolean',
    unloaded_conveyor: 'boolean',
    load_disputed: 'boolean',
    washout_area: 'string',
    washout_comments: 'string',
    load_tested: 'string',
    load_temp: 'number',
    load_air: 'number',
    load_slump: 'number',
    load_cylinders: 'number',
    notes: 'string',
  },
  returned: {
    returned_concrete_m3: 'number',
    disposal_method: 'enum:DISPOSAL_METHODS',
    reason_for_return: 'enum:RETURN_REASONS',
  },
  time: {
    leave_plant: 'datetime',
    arrive_job: 'datetime',
    start_pour: 'datetime',
    washing: 'datetime',
    leave_job: 'datetime',
    at_plant: 'datetime',
  },
  cod: {
    payment_type: 'enum:PAYMENT_TYPES',
    amount: 'number',
    wait_time_minutes: 'number',
    notes: 'string',
  },
};

// Matches backend enum lists in constants/deliveryRecord.js
const ENUM_LISTS: Record<string, string[]> = {
  DISPOSAL_METHODS: [
    'RESHIPPED_IN_YARD', 'DUMPED_IN_YARD', 'DUMPED_AT_THIRD_PARTY_YARD',
    'MADE_BLOCKS', 'USED_FOR_PLANT_SHOP', 'RE_ROUTED_TO_DIFFERENT_SITE', 'GRANULIZE',
  ],
  RETURN_REASONS: [
    'REJECTED_AIR_OUT_OF_SPEC', 'REJECTED_SLUMP_OUT_OF_SPEC', 'REJECTED_TEMPERATURE',
    'REJECTED_BALLING', 'REJECTED_TIME_LIMIT_EXCEEDED', 'POUR_COMPLETE_NOT_NEEDED',
    'OTHER_DRIVER_ADD_NOTES',
  ],
  PAYMENT_TYPES: ['PREPAID_CREDIT_CARD', 'CASH', 'CHECK', 'OTHER'],
};

export type ValidationError = { field: string; message: string };
export type ValidationResult = {
  valid: boolean;
  cleaned: Record<string, any>;
  errors: ValidationError[];
};

/**
 * Validate and coerce a delivery tab payload client-side.
 * Returns cleaned values + any validation errors.
 * Mirrors backend cleanTabPayload() exactly.
 */
export function validateDeliveryTab(
  tab: string,
  body: Record<string, any>,
): ValidationResult {
  const spec = FIELD_TYPES[tab];
  const cleaned: Record<string, any> = {};
  const errors: ValidationError[] = [];

  if (!spec) {
    return { valid: false, cleaned, errors: [{ field: 'tab', message: `Unknown tab "${tab}"` }] };
  }

  for (const [key, raw] of Object.entries(body)) {
    if (!(key in spec)) {
      errors.push({ field: key, message: `Unknown field for "${tab}" tab` });
      continue;
    }
    if (raw === null || raw === undefined) {
      cleaned[key] = null;
      continue;
    }
    const type = spec[key];

    if (type === 'number') {
      const n = typeof raw === 'number' ? raw : parseFloat(raw);
      if (!Number.isFinite(n)) {
        errors.push({ field: key, message: 'Must be a number' });
      } else {
        cleaned[key] = n;
      }
    } else if (type === 'boolean') {
      if (typeof raw === 'boolean') {
        cleaned[key] = raw;
      } else if (raw === 'true' || raw === 'YES' || raw === 'yes') {
        cleaned[key] = true;
      } else if (raw === 'false' || raw === 'NO' || raw === 'no') {
        cleaned[key] = false;
      } else {
        errors.push({ field: key, message: 'Must be true or false' });
      }
    } else if (type === 'string') {
      const s = String(raw).trim();
      cleaned[key] = s === '' ? null : s;
    } else if (type === 'datetime') {
      const d = new Date(raw);
      if (Number.isNaN(d.getTime())) {
        errors.push({ field: key, message: 'Must be a valid date/time' });
      } else {
        cleaned[key] = d.toISOString();
      }
    } else if (type.startsWith('enum:')) {
      const listName = type.slice(5);
      const allowed = ENUM_LISTS[listName] || [];
      const val = String(raw).toUpperCase();
      if (!allowed.includes(val)) {
        errors.push({ field: key, message: `Must be one of: ${allowed.join(', ')}` });
      } else {
        cleaned[key] = val;
      }
    }
  }

  return { valid: errors.length === 0, cleaned, errors };
}
