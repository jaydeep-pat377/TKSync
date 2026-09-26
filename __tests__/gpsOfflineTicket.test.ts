/**
 * Offline ticket handling.
 *
 * Mirrors two rules that only misbehave across an offline -> online transition:
 *
 *  1. Back-fill (backgroundGpsTracker.ts, publishBackgroundRecords)
 *     Records captured before a ticket was known carry ticket_id: null. The real
 *     id arrives within 30s via refreshTicket() but was never written back, so
 *     the points reached the server attached to no ticket.
 *
 *  2. Ticket code pairing (gpsStorage.GpsRecord.ticket_code)
 *     ticket_code must come from the record, not from the live value at publish
 *     time. A backlog flushing after the driver moved to a new ticket otherwise
 *     pairs a historical ticket_id with a current ticket_code.
 *
 *  3. Auto-stop debounce (gpsSyncManager.refreshTicket)
 *     Tracking may only stop after INACTIVE_TICKET_CONFIRMATIONS consecutive
 *     "no current load" replies, so one odd 200 cannot end a driver's shift.
 */

export {}; // Scope this file as a module — sibling test files share the global scope.

type StoredRecord = {
  id: string;
  ticket_id: number | null;
  ticket_code?: string | null;
};

/** Mirrors the payload built in publishBackgroundRecords(). */
function buildPayload(r: StoredRecord, liveTicketId: number | null) {
  return {
    client_id: r.id,
    ticket_id: r.ticket_id ?? liveTicketId,
    ticket_code: r.ticket_code ?? null,
  };
}

const INACTIVE_TICKET_CONFIRMATIONS = 2;

/** Mirrors the auto-stop state machine in refreshTicket(). */
function runRefreshTicket(replies: Array<number | null>, startingTicket: number | null) {
  let currentTicketId = startingTicket;
  let inactiveTicketCount = 0;
  let stopped = false;

  for (const newTicketId of replies) {
    if (newTicketId === null && currentTicketId !== null) {
      inactiveTicketCount++;
      if (inactiveTicketCount < INACTIVE_TICKET_CONFIRMATIONS) continue;
      inactiveTicketCount = 0;
      stopped = true;
      break;
    }
    inactiveTicketCount = 0;
    if (newTicketId !== null && newTicketId !== currentTicketId) {
      currentTicketId = newTicketId;
    }
  }
  return {stopped, currentTicketId};
}

describe('offline ticket back-fill', () => {
  it('stamps the live ticket id onto orphaned records', () => {
    const r = {id: 'a', ticket_id: null, ticket_code: null};
    expect(buildPayload(r, 901037).ticket_id).toBe(901037);
  });

  it('never overwrites a ticket id the record already carries', () => {
    const r = {id: 'a', ticket_id: 900001, ticket_code: 'OLD-1'};
    // Driver has since moved to 901037 — the record keeps its own load.
    expect(buildPayload(r, 901037).ticket_id).toBe(900001);
  });

  it('leaves ticket_id null when no ticket is known yet', () => {
    const r = {id: 'a', ticket_id: null};
    expect(buildPayload(r, null).ticket_id).toBeNull();
  });

  it('publishes the captured code, not the live one', () => {
    const r = {id: 'a', ticket_id: 900001, ticket_code: 'OLD-1'};
    // The live code is now NEW-2; pairing it with ticket_id 900001 is the bug.
    expect(buildPayload(r, 901037).ticket_code).toBe('OLD-1');
  });

  it('back-filled records still do not borrow a live code', () => {
    const r = {id: 'a', ticket_id: null, ticket_code: null};
    const payload = buildPayload(r, 901037);
    expect(payload.ticket_id).toBe(901037);
    expect(payload.ticket_code).toBeNull();
  });
});

describe('ticket auto-stop debounce', () => {
  it('does not stop on a single no-current-load reply', () => {
    expect(runRefreshTicket([null], 901037).stopped).toBe(false);
  });

  it('stops after consecutive confirmations', () => {
    expect(runRefreshTicket([null, null], 901037).stopped).toBe(true);
  });

  it('a valid reply in between resets the counter', () => {
    // The reconnect case: one odd 200, then the ticket is there again.
    expect(runRefreshTicket([null, 901037, null], 901037).stopped).toBe(false);
  });

  it('never stops when tracking started without a ticket', () => {
    expect(runRefreshTicket([null, null, null], null).stopped).toBe(false);
  });

  it('follows a ticket change without stopping', () => {
    const {stopped, currentTicketId} = runRefreshTicket([901037, 901038], 901037);
    expect(stopped).toBe(false);
    expect(currentTicketId).toBe(901038);
  });
});

/**
 * Ticket id coercion — mirrors toTicketId() in gpsSyncManager.ts.
 *
 * /tracking/me types current_load.id as a number but returns a string. The
 * uncoerced value throws in the native updateTicketId bridge AND poisons the
 * MMKV cache (set() writes a string, getNumber() reads undefined), so the
 * offline ticket cache never hits and records are saved with ticket_id: null.
 * Caught in production by Sentry REACT-NATIVE-12.
 */
function toTicketId(value: unknown): number | null {
  if (value === null || value === undefined || value === '') return null;
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? n : null;
}

describe('ticket id coercion', () => {
  it('coerces the string the API actually returns', () => {
    expect(toTicketId('901037')).toBe(901037);
  });

  it('passes a real number through', () => {
    expect(toTicketId(901037)).toBe(901037);
  });

  it('treats absent values as no ticket', () => {
    expect(toTicketId(null)).toBeNull();
    expect(toTicketId(undefined)).toBeNull();
    expect(toTicketId('')).toBeNull();
  });

  it('rejects junk rather than producing NaN', () => {
    expect(toTicketId('abc')).toBeNull();
    expect(toTicketId({})).toBeNull();
  });

  it('rejects zero and negatives — not valid ticket ids', () => {
    expect(toTicketId(0)).toBeNull();
    expect(toTicketId('0')).toBeNull();
    expect(toTicketId(-5)).toBeNull();
  });

  it('result is a number, so MMKV getNumber() can read it back', () => {
    expect(typeof toTicketId('901037')).toBe('number');
  });
});
