import React, {useState, useEffect, useRef, useCallback} from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  ActivityIndicator,
  StyleSheet,
  Platform,
  useWindowDimensions,
  ScrollView,
  RefreshControl,
} from 'react-native';
import {useSafeAreaInsets} from 'react-native-safe-area-context';
import Icon from '../components/Icon';
import ResponsiveModal from '../components/ResponsiveModal';
import type {NativeStackNavigationProp} from '@react-navigation/native-stack';
import {useTheme} from '../contexts/ThemeContext';
import {useAuth} from '../contexts/AuthContext';
import {ms, wp} from '../utils/responsive';
import {kronosApi} from '../services/api';
import {storage} from '../services/storage';
import {showToast} from '../utils/toast';
import {useFontScaleRefresh} from '../contexts/FontSizeContext';
import {KRONOS_MOCK_MODE, kronosMock, BREAK_REASONS, type MockBreak, type BreakReason} from '../services/kronosMock';

const MONO = Platform.OS === 'ios' ? 'Menlo' : 'monospace';
const STORAGE_KEY = 'kronos_clock_in_time';

type Props = {
  navigation: NativeStackNavigationProp<any>;
};

function formatDuration(milliseconds: number): string {
  const totalSecs = Math.floor(milliseconds / 1000);
  const h = Math.floor(totalSecs / 3600);
  const m = Math.floor((totalSecs % 3600) / 60);
  const s = totalSecs % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

function formatMinutes(mins: number): string {
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return h > 0 ? `${h}h ${m}m` : `${m}m`;
}

function formatTimeOfDay(date: Date): string {
  return date.toLocaleTimeString([], {hour: '2-digit', minute: '2-digit', hour12: true});
}

function formatDateShort(date: Date): string {
  return date.toLocaleDateString([], {month: 'short', day: 'numeric'});
}

function getBreakLabel(reason: string): string {
  return BREAK_REASONS.find(r => r.key === reason)?.label || reason;
}

type Shift = {
  clock_in: string;
  clock_out: string | null;
  duration_minutes: number | null;
  breaks?: MockBreak[];
  break_minutes?: number;
  paid_minutes?: number | null;
};

export default function TimeCardScreen({navigation}: Props) {
  useFontScaleRefresh();
  const {c, isDark} = useTheme();
  const insets = useSafeAreaInsets();
  const {width, height} = useWindowDimensions();
  const isLandscape = width > height;
  const {driver} = useAuth();

  const [isClockedIn, setIsClockedIn] = useState(false);
  const [isOnBreak, setIsOnBreak] = useState(false);
  const [currentBreak, setCurrentBreak] = useState<{start: string; reason: BreakReason} | null>(null);
  const [clockInTime, setClockInTime] = useState<Date | null>(null);
  const [elapsed, setElapsed] = useState(0);
  const [breakElapsed, setBreakElapsed] = useState(0);
  const [loading, setLoading] = useState(true);
  const [actionLoading, setActionLoading] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [shifts, setShifts] = useState<Shift[]>([]);
  const [weeklyHours, setWeeklyHours] = useState(0);
  const [todayBreakMinutes, setTodayBreakMinutes] = useState(0);
  const [shiftBreaks, setShiftBreaks] = useState<MockBreak[]>([]);
  const [breakPickerVisible, setBreakPickerVisible] = useState(false);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Restore clock-in state from local storage
  useEffect(() => {
    const saved = storage.getString(STORAGE_KEY);
    if (saved) {
      const savedTime = new Date(saved);
      if (!isNaN(savedTime.getTime())) {
        setClockInTime(savedTime);
        setIsClockedIn(true);
      }
    }
  }, []);

  const fetchStatus = useCallback(async () => {
    try {
      if (KRONOS_MOCK_MODE) {
        const status = kronosMock.getStatus();
        setIsClockedIn(status.is_clocked_in);
        setIsOnBreak(status.is_on_break);
        setCurrentBreak(status.current_break);
        if (status.is_clocked_in && status.last_punch_at) {
          const punchTime = new Date(status.last_punch_at);
          if (!isNaN(punchTime.getTime())) setClockInTime(punchTime);
        } else {
          setClockInTime(null);
        }
        setShifts(status.shifts);
        setWeeklyHours(status.weekly_hours);
        setTodayBreakMinutes(status.today_break_minutes);
        setShiftBreaks(status.shift_breaks);
      } else {
        const res = await kronosApi.getStatus();
        if (res.data) {
          setIsClockedIn(res.data.is_clocked_in);
          if (res.data.is_clocked_in && res.data.last_punch_at) {
            const punchTime = new Date(res.data.last_punch_at);
            if (!isNaN(punchTime.getTime())) {
              setClockInTime(punchTime);
              storage.set(STORAGE_KEY, punchTime.toISOString());
            }
          } else if (!res.data.is_clocked_in) {
            setClockInTime(null);
            storage.remove(STORAGE_KEY);
          }
          if (res.data.shifts) setShifts(res.data.shifts || []);
          if (res.data.weekly_hours != null) setWeeklyHours(res.data.weekly_hours);
        }
      }
    } catch {
      // Use local state as fallback
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchStatus();
  }, [fetchStatus]);

  // Running timer (shift + break)
  useEffect(() => {
    if (isClockedIn && clockInTime) {
      const tick = () => {
        setElapsed(Date.now() - clockInTime.getTime());
        if (currentBreak) {
          setBreakElapsed(Date.now() - new Date(currentBreak.start).getTime());
        } else {
          setBreakElapsed(0);
        }
      };
      tick();
      timerRef.current = setInterval(tick, 1000);
    } else {
      setElapsed(0);
      setBreakElapsed(0);
    }
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, [isClockedIn, clockInTime, currentBreak]);

  const handleClockIn = async () => {
    setActionLoading(true);
    try {
      if (KRONOS_MOCK_MODE) {
        kronosMock.clockIn();
      } else {
        await kronosApi.clockIn();
      }
      const now = new Date();
      setClockInTime(now);
      setIsClockedIn(true);
      setIsOnBreak(false);
      setCurrentBreak(null);
      setShiftBreaks([]);
      storage.set(STORAGE_KEY, now.toISOString());
      showToast('success', 'Clocked In', 'Your shift has started.');
    } catch {
      showToast('error', 'Clock In Failed', 'Could not start the clock. Please try again.');
    } finally {
      setActionLoading(false);
    }
  };

  const handleClockOut = async () => {
    setActionLoading(true);
    try {
      if (KRONOS_MOCK_MODE) {
        kronosMock.clockOut();
      } else {
        await kronosApi.clockOut();
      }
      setIsClockedIn(false);
      setIsOnBreak(false);
      setCurrentBreak(null);
      setClockInTime(null);
      setShiftBreaks([]);
      storage.remove(STORAGE_KEY);
      showToast('success', 'Clocked Out', 'Your shift has ended.');
      fetchStatus();
    } catch {
      showToast('error', 'Clock Out Failed', 'Could not stop the clock. Please try again.');
    } finally {
      setActionLoading(false);
    }
  };

  const handleStartBreak = (reason: BreakReason) => {
    setBreakPickerVisible(false);
    if (KRONOS_MOCK_MODE) {
      const brk = kronosMock.startBreak(reason);
      setIsOnBreak(true);
      setCurrentBreak(brk);
      showToast('success', 'Break Started', `${getBreakLabel(reason)} started.`);
    }
  };

  const handleEndBreak = () => {
    if (KRONOS_MOCK_MODE) {
      const completed = kronosMock.endBreak();
      setIsOnBreak(false);
      setCurrentBreak(null);
      if (completed) {
        setShiftBreaks(prev => [...prev, completed]);
        setTodayBreakMinutes(prev => prev + (completed.duration_minutes || 0));
        showToast('success', 'Break Ended', `${getBreakLabel(completed.reason)} — ${completed.duration_minutes}m`);
      }
    }
  };

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await fetchStatus();
    setRefreshing(false);
  }, [fetchStatus]);

  // Calculate today's totals
  const todayStr = new Date().toDateString();
  const todayShifts = shifts.filter(s => new Date(s.clock_in).toDateString() === todayStr);
  const todayMinutes = todayShifts.reduce((sum, s) => sum + (s.duration_minutes || 0), 0);
  const currentSessionMinutes = isClockedIn ? Math.floor(elapsed / 60000) : 0;
  const todayTotalMinutes = todayMinutes + currentSessionMinutes;
  const currentBreakMinutes = isOnBreak ? Math.floor(breakElapsed / 60000) : 0;
  const allBreakMinutes = todayBreakMinutes + currentBreakMinutes;
  const todayPaidMinutes = todayTotalMinutes - allBreakMinutes;

  const btnSize = isLandscape ? 100 : Math.min(wp(120), 150);

  // Status text and color
  const statusLabel = !isClockedIn ? 'OFF THE CLOCK' : isOnBreak ? 'ON BREAK' : 'WORKING';
  const statusColor = !isClockedIn ? '#F44336' : isOnBreak ? '#FF9800' : '#4CAF50';
  const statusBg = !isClockedIn
    ? (isDark ? '#2A1015' : '#FFF0F0')
    : isOnBreak
    ? (isDark ? '#2A1A00' : '#FFF3E0')
    : '#E8F5E9';

  return (
    <View style={[styles.container, {backgroundColor: c.background}]}>
      {/* Header */}
      <View style={[styles.header, {
        backgroundColor: c.primary,
        paddingTop: insets.top + (isLandscape ? 4 : wp(6)),
        paddingBottom: isLandscape ? 4 : wp(6),
        paddingLeft: Math.max(wp(12), insets.left + wp(4)),
        paddingRight: Math.max(wp(12), insets.right + wp(4)),
      }]}>
        <TouchableOpacity onPress={() => navigation.goBack()} style={styles.backBtn} activeOpacity={0.7}>
          <Icon name="arrow-back" size={ms(20)} color="#fff" />
        </TouchableOpacity>
        <Text style={[styles.headerTitle, {fontSize: ms(16)}]}>TIME CARD</Text>
        <View style={{width: ms(20)}} />
      </View>

      {loading ? (
        <View style={styles.centered}>
          <ActivityIndicator size="large" color={c.primary} />
          <Text style={[styles.loadingText, {color: c.textMuted}]}>Loading time card...</Text>
        </View>
      ) : (
        <ScrollView
          contentContainerStyle={[styles.scrollContent, {
            paddingHorizontal: Math.max(wp(12), insets.left + wp(4)),
            paddingBottom: insets.bottom + wp(20),
          }]}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={c.primary} colors={[c.primary]} />}
          showsVerticalScrollIndicator={false}>

          {/* Driver Info */}
          <View style={[styles.card, {backgroundColor: c.white, borderColor: c.border}]}>
            <View style={styles.driverRow}>
              <View style={[styles.driverAvatar, {backgroundColor: c.primarySurface}]}>
                <Icon name="person" size={ms(22)} color={c.primary} />
              </View>
              <View style={{flex: 1}}>
                <Text style={[styles.driverName, {color: c.textPrimary}]}>{driver?.driver_name || driver?.driver_code || 'Driver'}</Text>
                <Text style={[styles.driverCode, {color: c.textMuted}]}>TRUCK {driver?.truck_code || '-'}</Text>
              </View>
              <View style={[styles.statusBadge, {backgroundColor: statusBg}]}>
                <View style={[styles.statusDot, {backgroundColor: statusColor}]} />
                <Text style={[styles.statusText, {color: statusColor}]}>{statusLabel}</Text>
              </View>
            </View>
          </View>

          {/* Clock Display + Buttons */}
          <View style={[styles.card, styles.clockCard, {backgroundColor: c.white, borderColor: c.border}]}>
            {isClockedIn && clockInTime && (
              <Text style={[styles.clockedInSince, {color: c.textMuted}]}>
                Clocked in at {formatTimeOfDay(clockInTime)}
              </Text>
            )}

            {/* Break timer (shown during break) */}
            {isOnBreak && currentBreak && (
              <View style={{alignItems: 'center', marginBottom: wp(8)}}>
                <Text style={[styles.breakLabel, {color: '#FF9800'}]}>
                  {getBreakLabel(currentBreak.reason)}
                </Text>
                <Text style={[styles.breakTimer, {color: '#FF9800'}]}>
                  {formatDuration(breakElapsed)}
                </Text>
              </View>
            )}

            {/* Main timer */}
            <Text style={[styles.timerDisplay, {color: isClockedIn ? (isOnBreak ? c.textMuted : c.primary) : c.textMuted}]}>
              {isClockedIn ? formatDuration(elapsed) : '00:00:00'}
            </Text>
            {isClockedIn && <Text style={[styles.timerLabel, {color: c.textMuted}]}>TOTAL SHIFT</Text>}

            {/* Action Buttons */}
            {!isClockedIn ? (
              // Not clocked in → Show Clock In
              <TouchableOpacity
                style={[styles.clockBtn, {width: btnSize, height: btnSize, borderRadius: btnSize / 2, backgroundColor: '#4CAF50'}]}
                activeOpacity={0.7}
                onPress={handleClockIn}
                disabled={actionLoading}>
                {actionLoading ? <ActivityIndicator size="large" color="#fff" /> : (
                  <>
                    <Icon name="play-arrow" size={ms(32)} color="#fff" />
                    <Text style={styles.clockBtnText}>CLOCK IN</Text>
                  </>
                )}
              </TouchableOpacity>
            ) : isOnBreak ? (
              // On break → Show End Break
              <TouchableOpacity
                style={[styles.clockBtn, {width: btnSize, height: btnSize, borderRadius: btnSize / 2, backgroundColor: '#FF9800'}]}
                activeOpacity={0.7}
                onPress={handleEndBreak}>
                <Icon name="play-arrow" size={ms(32)} color="#fff" />
                <Text style={styles.clockBtnText}>END BREAK</Text>
              </TouchableOpacity>
            ) : (
              // Working → Show Take Break + Clock Out
              <View style={{flexDirection: 'row', gap: wp(16), alignItems: 'center'}}>
                <TouchableOpacity
                  style={[styles.clockBtn, {width: btnSize, height: btnSize, borderRadius: btnSize / 2, backgroundColor: '#FF9800'}]}
                  activeOpacity={0.7}
                  onPress={() => setBreakPickerVisible(true)}>
                  <Icon name="free-breakfast" size={ms(28)} color="#fff" />
                  <Text style={styles.clockBtnText}>BREAK</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={[styles.clockBtn, {width: btnSize, height: btnSize, borderRadius: btnSize / 2, backgroundColor: '#F44336'}]}
                  activeOpacity={0.7}
                  onPress={handleClockOut}
                  disabled={actionLoading}>
                  {actionLoading ? <ActivityIndicator size="large" color="#fff" /> : (
                    <>
                      <Icon name="stop" size={ms(32)} color="#fff" />
                      <Text style={styles.clockBtnText}>CLOCK OUT</Text>
                    </>
                  )}
                </TouchableOpacity>
              </View>
            )}
          </View>

          {/* Current Shift Breaks */}
          {isClockedIn && shiftBreaks.length > 0 && (
            <View style={[styles.card, {backgroundColor: c.white, borderColor: c.border}]}>
              <Text style={[styles.sectionTitle, {color: c.textMuted}]}>CURRENT SHIFT BREAKS</Text>
              {shiftBreaks.map((brk, i) => (
                <View key={i} style={[styles.breakRow, i < shiftBreaks.length - 1 && {borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: c.borderLight}]}>
                  <Icon name="free-breakfast" size={ms(14)} color="#FF9800" />
                  <View style={{flex: 1}}>
                    <Text style={[styles.breakReason, {color: c.textPrimary}]}>{getBreakLabel(brk.reason)}</Text>
                    <Text style={[styles.breakTime, {color: c.textMuted}]}>
                      {formatTimeOfDay(new Date(brk.start))} — {brk.end ? formatTimeOfDay(new Date(brk.end)) : '--'}
                    </Text>
                  </View>
                  <Text style={[styles.breakDuration, {color: '#FF9800'}]}>{brk.duration_minutes}m</Text>
                </View>
              ))}
            </View>
          )}

          {/* Today's Summary */}
          <View style={[styles.card, {backgroundColor: c.white, borderColor: c.border}]}>
            <Text style={[styles.sectionTitle, {color: c.textMuted}]}>TODAY&apos;S SUMMARY</Text>
            <View style={styles.summaryRow}>
              <View style={styles.summaryItem}>
                <Icon name="schedule" size={ms(18)} color={c.primary} />
                <Text style={[styles.summaryValue, {color: c.primary}]}>
                  {formatMinutes(todayPaidMinutes > 0 ? todayPaidMinutes : 0)}
                </Text>
                <Text style={[styles.summaryLabel, {color: c.textMuted}]}>Paid Hours</Text>
              </View>
              <View style={[styles.summaryDivider, {backgroundColor: c.borderLight}]} />
              <View style={styles.summaryItem}>
                <Icon name="free-breakfast" size={ms(18)} color="#FF9800" />
                <Text style={[styles.summaryValue, {color: '#FF9800'}]}>
                  {formatMinutes(allBreakMinutes)}
                </Text>
                <Text style={[styles.summaryLabel, {color: c.textMuted}]}>Breaks</Text>
              </View>
              <View style={[styles.summaryDivider, {backgroundColor: c.borderLight}]} />
              <View style={styles.summaryItem}>
                <Icon name="date-range" size={ms(18)} color={c.primary} />
                <Text style={[styles.summaryValue, {color: c.textPrimary}]}>
                  {Math.floor(weeklyHours)}h {Math.round((weeklyHours % 1) * 60)}m
                </Text>
                <Text style={[styles.summaryLabel, {color: c.textMuted}]}>This Week</Text>
              </View>
            </View>
          </View>

          {/* Shift History */}
          <View style={[styles.card, {backgroundColor: c.white, borderColor: c.border}]}>
            <Text style={[styles.sectionTitle, {color: c.textMuted}]}>RECENT SHIFTS</Text>
            {shifts.length === 0 && !isClockedIn ? (
              <Text style={[styles.emptyText, {color: c.textMuted}]}>No shift history available.</Text>
            ) : (
              <>
                {isClockedIn && clockInTime && (
                  <View style={[styles.shiftRow, {borderBottomWidth: shifts.length > 0 ? StyleSheet.hairlineWidth : 0, borderBottomColor: c.borderLight}]}>
                    <View style={[styles.shiftDot, {backgroundColor: statusColor}]} />
                    <View style={{flex: 1}}>
                      <Text style={[styles.shiftDate, {color: c.textPrimary}]}>{formatDateShort(clockInTime)}</Text>
                      <Text style={[styles.shiftTime, {color: c.textMuted}]}>
                        {formatTimeOfDay(clockInTime)} — {isOnBreak ? 'On Break' : 'In Progress'}
                      </Text>
                      {shiftBreaks.length > 0 && (
                        <Text style={[styles.shiftBreakInfo, {color: '#FF9800'}]}>
                          {shiftBreaks.length} break{shiftBreaks.length > 1 ? 's' : ''} ({shiftBreaks.reduce((s, b) => s + (b.duration_minutes || 0), 0)}m)
                        </Text>
                      )}
                    </View>
                    <Text style={[styles.shiftDuration, {color: statusColor}]}>
                      {formatDuration(elapsed)}
                    </Text>
                  </View>
                )}
                {shifts.map((shift, i) => {
                  const inTime = new Date(shift.clock_in);
                  const outTime = shift.clock_out ? new Date(shift.clock_out) : null;
                  const paidMins = shift.paid_minutes ?? shift.duration_minutes ?? 0;
                  const durH = Math.floor(paidMins / 60);
                  const durM = paidMins % 60;
                  const breakCount = shift.breaks?.length || 0;
                  const breakMins = shift.break_minutes || 0;
                  return (
                    <View key={i} style={[styles.shiftRow, i < shifts.length - 1 && {borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: c.borderLight}]}>
                      <View style={[styles.shiftDot, {backgroundColor: c.textMuted}]} />
                      <View style={{flex: 1}}>
                        <Text style={[styles.shiftDate, {color: c.textPrimary}]}>{formatDateShort(inTime)}</Text>
                        <Text style={[styles.shiftTime, {color: c.textMuted}]}>
                          {formatTimeOfDay(inTime)} — {outTime ? formatTimeOfDay(outTime) : '--'}
                        </Text>
                        {breakCount > 0 && (
                          <Text style={[styles.shiftBreakInfo, {color: '#FF9800'}]}>
                            {breakCount} break{breakCount > 1 ? 's' : ''} ({breakMins}m)
                          </Text>
                        )}
                      </View>
                      <View style={{alignItems: 'flex-end'}}>
                        <Text style={[styles.shiftDuration, {color: c.textPrimary}]}>
                          {durH}h {durM}m
                        </Text>
                        {breakMins > 0 && (
                          <Text style={[styles.shiftBreakSub, {color: c.textMuted}]}>paid</Text>
                        )}
                      </View>
                    </View>
                  );
                })}
              </>
            )}
          </View>

        </ScrollView>
      )}

      {/* Break Reason Picker Modal */}
      <ResponsiveModal
        visible={breakPickerVisible}
        onClose={() => setBreakPickerVisible(false)}
        maxWidth={isLandscape ? 280 : 300}
        widthPercent={isLandscape ? 25 : 70}>
        <View style={{padding: wp(12)}}>
          <Text style={[styles.modalTitle, {color: c.textPrimary}]}>SELECT BREAK REASON</Text>
          {BREAK_REASONS.map((reason, i) => (
            <TouchableOpacity
              key={reason.key}
              style={[styles.reasonItem, {
                borderBottomWidth: i < BREAK_REASONS.length - 1 ? StyleSheet.hairlineWidth : 0,
                borderBottomColor: c.borderLight,
              }]}
              activeOpacity={0.6}
              onPress={() => handleStartBreak(reason.key)}>
              <Icon name="free-breakfast" size={ms(16)} color="#FF9800" />
              <Text style={[styles.reasonText, {color: c.textPrimary}]}>{reason.label}</Text>
              <Icon name="chevron-right" size={ms(16)} color={c.textMuted} />
            </TouchableOpacity>
          ))}
          <TouchableOpacity
            style={[styles.cancelBtn, {backgroundColor: c.surface}]}
            activeOpacity={0.7}
            onPress={() => setBreakPickerVisible(false)}>
            <Text style={[styles.cancelText, {color: c.textMuted}]}>Cancel</Text>
          </TouchableOpacity>
        </View>
      </ResponsiveModal>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {flex: 1},
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  backBtn: {padding: 4},
  headerTitle: {
    fontWeight: '800',
    color: '#fff',
    letterSpacing: 1,
    fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace',
  },
  centered: {flex: 1, justifyContent: 'center', alignItems: 'center', gap: 12},
  loadingText: {fontSize: ms(12), fontFamily: MONO},
  scrollContent: {paddingTop: wp(12), gap: wp(10)},
  card: {
    borderRadius: 8,
    borderWidth: StyleSheet.hairlineWidth,
    padding: wp(12),
  },
  clockCard: {alignItems: 'center', paddingVertical: wp(16)},
  driverRow: {flexDirection: 'row', alignItems: 'center', gap: wp(10)},
  driverAvatar: {
    width: wp(40),
    height: wp(40),
    borderRadius: wp(20),
    justifyContent: 'center',
    alignItems: 'center',
  },
  driverName: {fontSize: ms(14), fontWeight: '800', fontFamily: MONO},
  driverCode: {fontSize: ms(10), fontWeight: '600', fontFamily: MONO, marginTop: 2},
  statusBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingVertical: 6,
    paddingHorizontal: 10,
    borderRadius: 20,
  },
  statusDot: {width: 8, height: 8, borderRadius: 4},
  statusText: {fontSize: ms(9), fontWeight: '800', letterSpacing: 0.5, fontFamily: MONO},
  clockedInSince: {fontSize: ms(11), fontFamily: MONO, marginBottom: wp(4)},
  breakLabel: {fontSize: ms(12), fontWeight: '800', fontFamily: MONO, letterSpacing: 0.5},
  breakTimer: {fontSize: ms(24), fontWeight: '300', fontFamily: MONO, letterSpacing: 1},
  timerDisplay: {fontSize: ms(36), fontWeight: '200', fontFamily: MONO, letterSpacing: 2, marginBottom: wp(4)},
  timerLabel: {fontSize: ms(9), fontWeight: '600', fontFamily: MONO, letterSpacing: 1, marginBottom: wp(12)},
  clockBtn: {
    justifyContent: 'center',
    alignItems: 'center',
    elevation: 4,
    shadowColor: '#000',
    shadowOffset: {width: 0, height: 2},
    shadowOpacity: 0.25,
    shadowRadius: 4,
  },
  clockBtnText: {color: '#fff', fontSize: ms(11), fontWeight: '800', fontFamily: MONO, marginTop: 4},
  sectionTitle: {fontSize: ms(10), fontWeight: '800', letterSpacing: 0.8, fontFamily: MONO, marginBottom: wp(10)},
  summaryRow: {flexDirection: 'row', alignItems: 'center'},
  summaryItem: {flex: 1, alignItems: 'center', gap: 4},
  summaryValue: {fontSize: ms(14), fontWeight: '800', fontFamily: MONO},
  summaryLabel: {fontSize: ms(9), fontWeight: '600', fontFamily: MONO},
  summaryDivider: {width: 1, height: 40, marginHorizontal: 8},
  breakRow: {flexDirection: 'row', alignItems: 'center', gap: wp(8), paddingVertical: wp(8)},
  breakReason: {fontSize: ms(11), fontWeight: '700', fontFamily: MONO},
  breakTime: {fontSize: ms(9), fontFamily: MONO, marginTop: 2},
  breakDuration: {fontSize: ms(12), fontWeight: '800', fontFamily: MONO},
  shiftRow: {flexDirection: 'row', alignItems: 'center', gap: wp(8), paddingVertical: wp(8)},
  shiftDot: {width: 10, height: 10, borderRadius: 5},
  shiftDate: {fontSize: ms(11), fontWeight: '700', fontFamily: MONO},
  shiftTime: {fontSize: ms(9), fontFamily: MONO, marginTop: 2},
  shiftBreakInfo: {fontSize: ms(8), fontFamily: MONO, marginTop: 2},
  shiftDuration: {fontSize: ms(12), fontWeight: '800', fontFamily: MONO},
  shiftBreakSub: {fontSize: ms(8), fontFamily: MONO, marginTop: 1},
  emptyText: {fontSize: ms(11), fontFamily: MONO, textAlign: 'center', paddingVertical: wp(16)},
  modalTitle: {fontSize: ms(12), fontWeight: '800', fontFamily: MONO, letterSpacing: 0.5, textAlign: 'center', marginBottom: wp(12)},
  reasonItem: {flexDirection: 'row', alignItems: 'center', gap: wp(10), paddingVertical: wp(12)},
  reasonText: {flex: 1, fontSize: ms(12), fontWeight: '600', fontFamily: MONO},
  cancelBtn: {marginTop: wp(8), paddingVertical: wp(10), borderRadius: 8, alignItems: 'center'},
  cancelText: {fontSize: ms(11), fontWeight: '700', fontFamily: MONO},
});
