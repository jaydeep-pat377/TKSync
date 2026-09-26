import {validateDeliveryTab} from '../src/utils/validateDeliveryTab';

/**
 * This mirrors the backend's cleanTabPayload(). When the two drift, a save
 * queues offline, replays hours later and the backend rejects it with a 422 —
 * the driver's entry is gone and nobody finds out until the paperwork does not
 * match. Pure logic, no dependencies, so there is no excuse for it to be
 * untested.
 */
describe('validateDeliveryTab', () => {
  it('rejects an unknown tab', () => {
    const r = validateDeliveryTab('nope', {});
    expect(r.valid).toBe(false);
    expect(r.errors).toEqual([{field: 'tab', message: 'Unknown tab "nope"'}]);
  });

  it('rejects a field that does not belong to the tab', () => {
    const r = validateDeliveryTab('time', {slump_from_plant: 5});
    expect(r.valid).toBe(false);
    expect(r.errors[0].field).toBe('slump_from_plant');
  });

  describe('numbers', () => {
    it('coerces numeric strings, because TextInput only ever gives strings', () => {
      const r = validateDeliveryTab('plant', {temp_at_plant: '23.5'});
      expect(r.valid).toBe(true);
      expect(r.cleaned.temp_at_plant).toBe(23.5);
    });

    it('rejects text that is not a number', () => {
      const r = validateDeliveryTab('plant', {temp_at_plant: 'warm'});
      expect(r.valid).toBe(false);
      expect(r.errors[0].message).toBe('Must be a number');
    });

    it('rejects an empty string rather than saving NaN', () => {
      const r = validateDeliveryTab('plant', {temp_at_plant: ''});
      expect(r.valid).toBe(false);
    });

    it('keeps zero — a real reading, not a missing one', () => {
      const r = validateDeliveryTab('jobsite', {customer_water_litres: 0});
      expect(r.valid).toBe(true);
      expect(r.cleaned.customer_water_litres).toBe(0);
    });
  });

  describe('booleans', () => {
    it.each([
      [true, true],
      [false, false],
      ['true', true],
      ['false', false],
      ['YES', true],
      ['NO', false],
      ['yes', true],
      ['no', false],
    ])('accepts %p as %p', (input, expected) => {
      const r = validateDeliveryTab('plant', {hand_added: input});
      expect(r.valid).toBe(true);
      expect(r.cleaned.hand_added).toBe(expected);
    });

    it('rejects anything else instead of guessing', () => {
      const r = validateDeliveryTab('plant', {hand_added: 'maybe'});
      expect(r.valid).toBe(false);
      expect(r.errors[0].message).toBe('Must be true or false');
    });
  });

  describe('strings', () => {
    it('trims', () => {
      const r = validateDeliveryTab('plant', {notes: '  poured late  '});
      expect(r.cleaned.notes).toBe('poured late');
    });

    it('turns a blank field into null, not an empty string', () => {
      const r = validateDeliveryTab('plant', {notes: '   '});
      expect(r.valid).toBe(true);
      expect(r.cleaned.notes).toBeNull();
    });
  });

  describe('datetimes', () => {
    it('normalises to ISO', () => {
      const r = validateDeliveryTab('time', {leave_plant: '2026-09-25T10:30:00.000Z'});
      expect(r.valid).toBe(true);
      expect(r.cleaned.leave_plant).toBe('2026-09-25T10:30:00.000Z');
    });

    it('rejects an unparseable date', () => {
      const r = validateDeliveryTab('time', {leave_plant: 'half past ten'});
      expect(r.valid).toBe(false);
      expect(r.errors[0].message).toBe('Must be a valid date/time');
    });
  });

  describe('enums', () => {
    it('upper-cases before comparing', () => {
      const r = validateDeliveryTab('cod', {payment_type: 'cash'});
      expect(r.valid).toBe(true);
      expect(r.cleaned.payment_type).toBe('CASH');
    });

    it('rejects a value outside the list and names the allowed ones', () => {
      const r = validateDeliveryTab('returned', {disposal_method: 'THREW_IT_AWAY'});
      expect(r.valid).toBe(false);
      expect(r.errors[0].message).toContain('DUMPED_IN_YARD');
    });
  });

  it('passes null and undefined straight through as null', () => {
    const r = validateDeliveryTab('plant', {notes: null, temp_at_plant: undefined});
    expect(r.valid).toBe(true);
    expect(r.cleaned.notes).toBeNull();
    expect(r.cleaned.temp_at_plant).toBeNull();
  });

  it('collects every error, not just the first', () => {
    const r = validateDeliveryTab('plant', {
      temp_at_plant: 'warm',
      hand_added: 'maybe',
      truck_start: 'never',
    });
    expect(r.valid).toBe(false);
    expect(r.errors).toHaveLength(3);
  });

  it('still returns the valid fields alongside the errors', () => {
    const r = validateDeliveryTab('plant', {temp_at_plant: 'warm', notes: 'ok'});
    expect(r.valid).toBe(false);
    expect(r.cleaned.notes).toBe('ok');
  });
});
