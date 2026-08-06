import {storage} from './storage';

// ─── Mock Mode Flag ───
// Set to false when real Kronos backend endpoints are ready
export const KRONOS_MOCK_MODE = true;

const SHIFTS_KEY = 'kronos_mock_shifts';
const CLOCK_IN_KEY = 'kronos_clock_in_time';
const BREAK_KEY = 'kronos_current_break';

export const BREAK_REASONS = [
  {key: 'LUNCH', label: 'Lunch Break'},
  {key: 'PERSONAL', label: 'Personal Break'},
  {key: 'MEDICAL', label: 'Medical Break'},
  {key: 'REST', label: 'Rest Break'},
  {key: 'OTHER', label: 'Other'},
] as const;

export type BreakReason = typeof BREAK_REASONS[number]['key'];

export type MockBreak = {
  start: string;
  end: string | null;
  reason: BreakReason;
  duration_minutes: number | null;
};

export type MockShift = {
  clock_in: string;
  clock_out: string | null;
  duration_minutes: number | null;
  breaks: MockBreak[];
  break_minutes: number;
  paid_minutes: number | null;
};

function getShifts(): MockShift[] {
  const raw = storage.getString(SHIFTS_KEY);
  if (!raw) return [];
  try {
    return JSON.parse(raw);
  } catch {
    return [];
  }
}

function saveShifts(shifts: MockShift[]) {
  storage.set(SHIFTS_KEY, JSON.stringify(shifts.slice(0, 30)));
}

function getCurrentBreak(): {start: string; reason: BreakReason} | null {
  const raw = storage.getString(BREAK_KEY);
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

export const kronosMock = {
  clockIn(): {punched_at: string; status: 'clocked_in'} {
    const now = new Date().toISOString();
    storage.set(CLOCK_IN_KEY, now);
    storage.remove(BREAK_KEY);
    return {punched_at: now, status: 'clocked_in'};
  },

  clockOut(): {punched_at: string; status: 'clocked_out'} {
    const now = new Date();
    const clockInStr = storage.getString(CLOCK_IN_KEY);

    // End any active break first
    const activeBreak = getCurrentBreak();
    let finalBreaks: MockBreak[] = [];

    if (clockInStr) {
      // Get any breaks stored during this shift
      finalBreaks = this._getShiftBreaks();

      // If there's an active break, end it
      if (activeBreak) {
        const breakDuration = Math.round((now.getTime() - new Date(activeBreak.start).getTime()) / 60000);
        finalBreaks.push({
          start: activeBreak.start,
          end: now.toISOString(),
          reason: activeBreak.reason,
          duration_minutes: breakDuration,
        });
      }

      const clockInDate = new Date(clockInStr);
      const totalMinutes = Math.round((now.getTime() - clockInDate.getTime()) / 60000);
      const breakMinutes = finalBreaks.reduce((sum, b) => sum + (b.duration_minutes || 0), 0);

      const shift: MockShift = {
        clock_in: clockInStr,
        clock_out: now.toISOString(),
        duration_minutes: totalMinutes,
        breaks: finalBreaks,
        break_minutes: breakMinutes,
        paid_minutes: totalMinutes - breakMinutes,
      };

      const existing = getShifts();
      saveShifts([shift, ...existing]);
    }

    storage.remove(CLOCK_IN_KEY);
    storage.remove(BREAK_KEY);
    storage.remove('kronos_shift_breaks');
    return {punched_at: now.toISOString(), status: 'clocked_out'};
  },

  startBreak(reason: BreakReason): {start: string; reason: BreakReason} {
    const now = new Date().toISOString();
    const brk = {start: now, reason};
    storage.set(BREAK_KEY, JSON.stringify(brk));
    return brk;
  },

  endBreak(): MockBreak | null {
    const activeBreak = getCurrentBreak();
    if (!activeBreak) return null;

    const now = new Date();
    const duration = Math.round((now.getTime() - new Date(activeBreak.start).getTime()) / 60000);

    const completedBreak: MockBreak = {
      start: activeBreak.start,
      end: now.toISOString(),
      reason: activeBreak.reason,
      duration_minutes: duration,
    };

    // Store completed break in shift breaks list
    const shiftBreaks = this._getShiftBreaks();
    shiftBreaks.push(completedBreak);
    storage.set('kronos_shift_breaks', JSON.stringify(shiftBreaks));

    storage.remove(BREAK_KEY);
    return completedBreak;
  },

  _getShiftBreaks(): MockBreak[] {
    const raw = storage.getString('kronos_shift_breaks');
    if (!raw) return [];
    try {
      return JSON.parse(raw);
    } catch {
      return [];
    }
  },

  getStatus(): {
    is_clocked_in: boolean;
    is_on_break: boolean;
    current_break: {start: string; reason: BreakReason} | null;
    last_punch_at: string | null;
    shifts: MockShift[];
    weekly_hours: number;
    today_break_minutes: number;
    shift_breaks: MockBreak[];
  } {
    const clockInStr = storage.getString(CLOCK_IN_KEY);
    const shifts = getShifts();
    const activeBreak = getCurrentBreak();
    const shiftBreaks = this._getShiftBreaks();

    const weekStart = new Date();
    weekStart.setDate(weekStart.getDate() - weekStart.getDay());
    weekStart.setHours(0, 0, 0, 0);

    const weeklyMinutes = shifts
      .filter(s => new Date(s.clock_in).getTime() >= weekStart.getTime())
      .reduce((sum, s) => sum + (s.paid_minutes || s.duration_minutes || 0), 0);

    // Today's total break minutes (completed shifts + current shift)
    const todayStr = new Date().toDateString();
    const todayBreakMinutes = shifts
      .filter(s => new Date(s.clock_in).toDateString() === todayStr)
      .reduce((sum, s) => sum + s.break_minutes, 0)
      + shiftBreaks.reduce((sum, b) => sum + (b.duration_minutes || 0), 0);

    return {
      is_clocked_in: !!clockInStr,
      is_on_break: !!activeBreak,
      current_break: activeBreak,
      last_punch_at: clockInStr || null,
      shifts,
      weekly_hours: weeklyMinutes / 60,
      today_break_minutes: todayBreakMinutes,
      shift_breaks: shiftBreaks,
    };
  },

  clearAll() {
    storage.remove(SHIFTS_KEY);
    storage.remove(CLOCK_IN_KEY);
    storage.remove(BREAK_KEY);
    storage.remove('kronos_shift_breaks');
  },
};
