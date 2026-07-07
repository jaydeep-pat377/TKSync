import React, {useState, useRef, useEffect, useCallback} from 'react';
import {
  View,
  Text,
  Modal,
  ScrollView,
  TouchableOpacity,
  StyleSheet,
  Animated,
  useWindowDimensions,
  StatusBar,
  Platform,
} from 'react-native';
import {useSafeAreaInsets} from 'react-native-safe-area-context';
import Icon from './Icon';
import {useTheme} from '../contexts/ThemeContext';
import {wp, ms} from '../utils/responsive';

const MONO = Platform.OS === 'ios' ? 'Menlo' : 'monospace';

// Item height is computed at render time via the hook, not at module level
const VISIBLE = 5;
const MID = Math.floor(VISIBLE / 2);
const MONTHS = [
  'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
  'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec',
];

function pad2(n: number): string {
  return n < 10 ? `0${n}` : String(n);
}

function daysInMonth(m: number, y: number): number {
  return new Date(y, m + 1, 0).getDate();
}

// ────────── Scroll Wheel Column ──────────

type WheelProps = {
  data: string[];
  selected: number;
  onSelect: (index: number) => void;
  width: number;
  itemH: number;
};

function Wheel({data, selected, onSelect, width, itemH}: WheelProps) {
  const wS = createWS();
  const {c} = useTheme();
  const scrollRef = useRef<ScrollView>(null);
  const fromUser = useRef(false);
  const snapTimer = useRef<ReturnType<typeof setTimeout>>(null);
  const prev = useRef(selected);
  const wheelH = itemH * VISIBLE;

  useEffect(() => {
    const id = setTimeout(() => {
      scrollRef.current?.scrollTo({y: selected * itemH, animated: false});
    }, 50);
    return () => clearTimeout(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (fromUser.current) {
      fromUser.current = false;
      prev.current = selected;
      return;
    }
    if (selected !== prev.current) {
      scrollRef.current?.scrollTo({y: selected * itemH, animated: true});
      prev.current = selected;
    }
  }, [selected, itemH]);

  const snap = useCallback(
    (y: number) => {
      const i = Math.max(0, Math.min(Math.round(y / itemH), data.length - 1));
      scrollRef.current?.scrollTo({y: i * itemH, animated: true});
      if (i !== selected) {
        fromUser.current = true;
        onSelect(i);
      }
    },
    [data.length, selected, onSelect, itemH],
  );

  return (
    <View style={{width, height: wheelH, overflow: 'hidden'}}>
      <View
        style={[
          wS.bar,
          {top: MID * itemH, height: itemH, borderColor: c.primary, backgroundColor: c.primarySurface},
        ]}
      />
      <ScrollView
        ref={scrollRef}
        showsVerticalScrollIndicator={false}
        snapToInterval={itemH}
        decelerationRate="fast"
        bounces={false}
        nestedScrollEnabled
        onMomentumScrollEnd={e => {
          if (snapTimer.current) clearTimeout(snapTimer.current);
          snap(e.nativeEvent.contentOffset.y);
        }}
        onScrollEndDrag={e => {
          if (snapTimer.current) clearTimeout(snapTimer.current);
          const offsetY = e.nativeEvent.contentOffset.y;
          snapTimer.current = setTimeout(() => snap(offsetY), 120);
        }}
        contentContainerStyle={{
          paddingTop: MID * itemH,
          paddingBottom: MID * itemH,
        }}>
        {data.map((label, i) => (
          <TouchableOpacity
            key={`${label}-${i}`}
            activeOpacity={0.6}
            onPress={() => {
              fromUser.current = true;
              onSelect(i);
              scrollRef.current?.scrollTo({y: i * itemH, animated: true});
            }}
            style={[wS.item, {height: itemH}]}>
            <Text
              style={[
                wS.text,
                {color: i === selected ? c.textPrimary : c.textMuted},
                i === selected && wS.textSel,
              ]}>
              {label}
            </Text>
          </TouchableOpacity>
        ))}
      </ScrollView>
    </View>
  );
}

const createWS = () => StyleSheet.create({
  bar: {
    position: 'absolute',
    left: wp(2),
    right: wp(2),
    borderRadius: wp(6),
    borderWidth: 1.5,
    zIndex: 0,
  },
  item: {justifyContent: 'center', alignItems: 'center'},
  text: {fontSize: ms(11), fontWeight: '500'},
  textSel: {fontSize: ms(13), fontWeight: '700'},
});

// ────────── Date Time Picker Modal ──────────

type Props = {
  visible: boolean;
  value: Date;
  onConfirm: (date: Date) => void;
  onCancel: () => void;
  mode?: 'datetime' | 'time';
};

export default function DateTimePicker({visible, value, onConfirm, onCancel, mode = 'datetime'}: Props) {
  const ps = createPs();
  const {c} = useTheme();
  const {width: screenW, height: screenH} = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const isLandscape = screenW > screenH;
  const shortDim = Math.min(screenW, screenH);

  const fade = useRef(new Animated.Value(0)).current;
  const slide = useRef(new Animated.Value(30)).current;

  const [month, setMonth] = useState(value.getMonth());
  const [day, setDay] = useState(value.getDate());
  const [year, setYear] = useState(value.getFullYear());
  const [hour, setHour] = useState(value.getHours());
  const [minute, setMinute] = useState(value.getMinutes());

  useEffect(() => {
    setMonth(value.getMonth());
    setDay(value.getDate());
    setYear(value.getFullYear());
    setHour(value.getHours());
    setMinute(value.getMinutes());
  }, [value]);

  useEffect(() => {
    if (visible) {
      Animated.parallel([
        Animated.timing(fade, {toValue: 1, duration: 220, useNativeDriver: true}),
        Animated.spring(slide, {toValue: 0, friction: 8, tension: 60, useNativeDriver: true}),
      ]).start();
    } else {
      fade.setValue(0);
      slide.setValue(30);
    }
  }, [visible, fade, slide]);

  const maxDays = daysInMonth(month, year);
  useEffect(() => {
    if (day > maxDays) setDay(maxDays);
  }, [month, year, maxDays, day]);

  const dayData = Array.from({length: maxDays}, (_, i) => pad2(i + 1));
  const yearData = Array.from({length: 10}, (_, i) => String(2024 + i));
  const hourData = Array.from({length: 24}, (_, i) => pad2(i));
  const minData = Array.from({length: 60}, (_, i) => pad2(i));

  // ── All sizing computed at render time using live dimensions ──
  const safeV = insets.top + insets.bottom + (StatusBar.currentHeight || 0);
  const availH = screenH - safeV;
  const isSmall = shortDim < 375;
  const isTabletDevice = shortDim > 600;

  // Tight item height
  const itemH = isLandscape ? Math.floor(availH * 0.085) : Math.max(28, Math.floor(availH * 0.045));

  const safeH = insets.left + insets.right;
  const availW = screenW - safeH;
  const modalW = Math.min(availW * (isSmall ? 0.88 : 0.78), isTabletDevice ? 380 : isLandscape ? 360 : 300);
  const maxModalH = availH * (isLandscape ? 0.78 : 0.62);

  // Wheel widths — tight
  const wMonth = isSmall ? 50 : isTabletDevice ? 66 : isLandscape ? 58 : 60;
  const wDay = isSmall ? 34 : isTabletDevice ? 44 : isLandscape ? 38 : 42;
  const wYear = isSmall ? 44 : isTabletDevice ? 58 : isLandscape ? 50 : 52;
  const wHour = isSmall ? 34 : isTabletDevice ? 44 : isLandscape ? 38 : 42;
  const wMin = isSmall ? 34 : isTabletDevice ? 44 : isLandscape ? 38 : 42;

  if (!visible) return null;

  return (
    <Modal transparent visible animationType="none" onRequestClose={onCancel} statusBarTranslucent>
      <View style={[ps.overlay, {backgroundColor: c.overlayModal}]}>
        <View style={ps.overlayTouch} />
        <Animated.View
          style={[
            ps.card,
            {
              width: modalW,
              maxHeight: maxModalH,
              backgroundColor: c.white,
              shadowColor: c.shadowColor,
              opacity: fade,
              transform: [{translateY: slide}],
            },
          ]}
          onStartShouldSetResponder={() => true}>

          {/* Header */}
          <View style={[ps.hdr, {borderBottomColor: c.borderLight}]}>
            <View style={[ps.hdrIcon, {backgroundColor: c.primarySurface}]}>
              <Icon name={mode === 'time' ? 'access-time' : 'event'} size={ms(14)} color={c.primary} />
            </View>
            <Text style={[ps.hdrTitle, {color: c.textPrimary, fontFamily: MONO}]}>{mode === 'time' ? 'Select Time' : 'Select Date & Time'}</Text>
            <TouchableOpacity
              style={[ps.closeBtn, {backgroundColor: c.surface}]}
              onPress={onCancel}
              activeOpacity={0.7}
              hitSlop={{top: 10, bottom: 10, left: 10, right: 10}}>
              <Icon name="close" size={ms(13)} color={c.textSecondary} />
            </TouchableOpacity>
          </View>

          <ScrollView
            showsVerticalScrollIndicator={false}
            bounces={false}
            nestedScrollEnabled
            contentContainerStyle={isLandscape ? ps.landscapeContent : ps.portraitContent}>

            {isLandscape ? (
              <View style={[ps.landscapeRow]}>
                {mode !== 'time' && (
                  <>
                    <View style={[ps.landscapeCol]}>
                      <View style={[ps.sectionLabel]}>
                        <Icon name="calendar-today" size={ms(10)} color={c.primary} />
                        <Text style={[ps.labelText, {color: c.primary, fontFamily: MONO}]}>DATE</Text>
                      </View>
                      <View style={[ps.wheels]}>
                        <Wheel data={MONTHS} selected={month} onSelect={setMonth} width={wMonth} itemH={itemH} />
                        <Wheel data={dayData} selected={day - 1} onSelect={i => setDay(i + 1)} width={wDay} itemH={itemH} />
                        <Wheel data={yearData} selected={year - 2024} onSelect={i => setYear(2024 + i)} width={wYear} itemH={itemH} />
                      </View>
                    </View>
                    <View style={[ps.dividerV, {backgroundColor: c.borderLight}]} />
                  </>
                )}
                <View style={[ps.landscapeCol]}>
                  <View style={[ps.sectionLabel]}>
                    <Icon name="access-time" size={ms(10)} color={c.primary} />
                    <Text style={[ps.labelText, {color: c.primary, fontFamily: MONO}]}>TIME</Text>
                  </View>
                  <View style={[ps.wheels]}>
                    <Wheel data={hourData} selected={hour} onSelect={setHour} width={wHour} itemH={itemH} />
                    <Text style={[ps.colon, {color: c.textPrimary, fontFamily: MONO}]}>:</Text>
                    <Wheel data={minData} selected={minute} onSelect={setMinute} width={wMin} itemH={itemH} />
                  </View>
                </View>
              </View>
            ) : (
              <>
                {mode !== 'time' && (
                  <>
                    <View style={[ps.sectionLabel]}>
                      <Icon name="calendar-today" size={ms(10)} color={c.primary} />
                      <Text style={[ps.labelText, {color: c.primary, fontFamily: MONO}]}>DATE</Text>
                    </View>
                    <View style={[ps.wheels]}>
                      <Wheel data={MONTHS} selected={month} onSelect={setMonth} width={wMonth} itemH={itemH} />
                      <Wheel data={dayData} selected={day - 1} onSelect={i => setDay(i + 1)} width={wDay} itemH={itemH} />
                      <Wheel data={yearData} selected={year - 2024} onSelect={i => setYear(2024 + i)} width={wYear} itemH={itemH} />
                    </View>
                  </>
                )}
                <View style={[ps.sectionLabel]}>
                  <Icon name="access-time" size={ms(10)} color={c.primary} />
                  <Text style={[ps.labelText, {color: c.primary, fontFamily: MONO}]}>TIME</Text>
                </View>
                <View style={[ps.wheels]}>
                  <Wheel data={hourData} selected={hour} onSelect={setHour} width={wHour} itemH={itemH} />
                  <Text style={[ps.colon, {color: c.textPrimary, fontFamily: MONO}]}>:</Text>
                  <Wheel data={minData} selected={minute} onSelect={setMinute} width={wMin} itemH={itemH} />
                </View>
              </>
            )}
          </ScrollView>

          {/* Footer */}
          <View style={[ps.footer, {borderTopColor: c.borderLight}]}>
            <TouchableOpacity
              style={[ps.cancelBtn, {borderColor: c.border}]}
              onPress={onCancel}
              activeOpacity={0.7}>
              <Text style={[ps.btnText, {color: c.textSecondary, fontFamily: MONO}]}>Cancel</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[ps.confirmBtn, {backgroundColor: c.primary}]}
              onPress={() => onConfirm(new Date(year, month, day, hour, minute))}
              activeOpacity={0.8}>
              <Icon name="check" size={ms(13)} color={c.textOnPrimary} />
              <Text style={[ps.btnText, {color: c.textOnPrimary, fontFamily: MONO}]}>Confirm</Text>
            </TouchableOpacity>
          </View>
        </Animated.View>
      </View>
    </Modal>
  );
}

const createPs = () => StyleSheet.create({
  overlay: {flex: 1, justifyContent: 'center', alignItems: 'center'},
  overlayTouch: {...StyleSheet.absoluteFill},
  card: {
    borderRadius: wp(12),
    overflow: 'hidden',
    elevation: 10,
    shadowOffset: {width: 0, height: 4},
    shadowOpacity: 0.15,
    shadowRadius: 12,
  },
  hdr: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: wp(6),
    paddingHorizontal: wp(10),
    paddingVertical: wp(6),
    borderBottomWidth: 1,
  },
  hdrIcon: {
    width: wp(24),
    height: wp(24),
    borderRadius: wp(7),
    justifyContent: 'center',
    alignItems: 'center',
  },
  hdrTitle: {flex: 1, fontSize: ms(12), fontWeight: '700'},
  closeBtn: {
    width: wp(24),
    height: wp(24),
    borderRadius: wp(12),
    justifyContent: 'center',
    alignItems: 'center',
  },
  sectionLabel: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: wp(3),
    paddingHorizontal: wp(10),
    paddingTop: wp(4),
    paddingBottom: wp(1),
  },
  labelText: {fontSize: ms(8), fontWeight: '800', letterSpacing: 0.8},
  wheels: {
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: wp(2),
  },
  colon: {fontSize: ms(14), fontWeight: '800', marginHorizontal: wp(1), marginTop: -1},
  footer: {
    flexDirection: 'row',
    gap: wp(6),
    paddingHorizontal: wp(10),
    paddingVertical: wp(6),
    borderTopWidth: 1,
  },
  cancelBtn: {
    flex: 1,
    paddingVertical: wp(6),
    borderRadius: wp(7),
    borderWidth: 1.5,
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: wp(30),
  },
  confirmBtn: {
    flex: 1,
    flexDirection: 'row',
    paddingVertical: wp(6),
    borderRadius: wp(7),
    alignItems: 'center',
    justifyContent: 'center',
    gap: wp(3),
    minHeight: wp(30),
  },
  btnText: {fontSize: ms(11), fontWeight: '700'},
  portraitContent: {paddingBottom: wp(1)},
  landscapeContent: {paddingVertical: wp(1)},
  landscapeRow: {flexDirection: 'row', alignItems: 'center'},
  landscapeCol: {flex: 1, alignItems: 'center'},
  dividerV: {width: 1, alignSelf: 'stretch', marginVertical: wp(4)},
});
