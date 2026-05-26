import React, {useState, useRef, useEffect, useCallback} from 'react';
import {
  View,
  Text,
  Modal,
  Pressable,
  ScrollView,
  TouchableOpacity,
  StyleSheet,
  Animated,
  useWindowDimensions,
  Platform,
  StatusBar,
} from 'react-native';
import {useSafeAreaInsets} from 'react-native-safe-area-context';
import MaterialIcons from 'react-native-vector-icons/MaterialIcons';
import {useTheme} from '../contexts/ThemeContext';
import {ms} from '../utils/responsive';

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

const wS = StyleSheet.create({
  bar: {
    position: 'absolute',
    left: 4,
    right: 4,
    borderRadius: 10,
    borderWidth: 1.5,
    zIndex: 0,
  },
  item: {justifyContent: 'center', alignItems: 'center'},
  text: {fontSize: ms(15), fontWeight: '500'},
  textSel: {fontSize: ms(17), fontWeight: '700'},
});

// ────────── Date Time Picker Modal ──────────

type Props = {
  visible: boolean;
  value: Date;
  onConfirm: (date: Date) => void;
  onCancel: () => void;
};

export default function DateTimePicker({visible, value, onConfirm, onCancel}: Props) {
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

  // Landscape: compact layout to fit within limited height
  // Show 3 items in landscape, 5 in portrait for better fit
  const visibleItems = isLandscape ? 3 : VISIBLE;
  const itemH = isLandscape ? Math.floor(availH * 0.12) : Math.max(36, Math.floor(availH * 0.065));
  const wheelH = itemH * visibleItems;
  const midIdx = Math.floor(visibleItems / 2);

  const modalW = Math.min(screenW * 0.92, isTabletDevice ? 620 : isLandscape ? 560 : 380);
  const maxModalH = availH * (isLandscape ? 0.94 : 0.88);

  // Wheel widths based on available space
  const wMonth = isSmall ? 62 : isTabletDevice ? 90 : isLandscape ? 70 : 80;
  const wDay = isSmall ? 44 : isTabletDevice ? 60 : isLandscape ? 52 : 58;
  const wYear = isSmall ? 54 : isTabletDevice ? 80 : isLandscape ? 60 : 68;
  const wHour = isSmall ? 44 : isTabletDevice ? 60 : isLandscape ? 52 : 58;
  const wMin = isSmall ? 44 : isTabletDevice ? 60 : isLandscape ? 52 : 58;

  if (!visible) return null;

  return (
    <Modal transparent visible animationType="none" onRequestClose={onCancel} statusBarTranslucent>
      <Pressable style={[ps.overlay, {backgroundColor: c.overlayModal}]} onPress={onCancel}>
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
              <MaterialIcons name="event" size={ms(18)} color={c.primary} />
            </View>
            <Text style={[ps.hdrTitle, {color: c.textPrimary}]}>Select Date & Time</Text>
            <TouchableOpacity
              style={[ps.closeBtn, {backgroundColor: c.surface}]}
              onPress={onCancel}
              activeOpacity={0.7}
              hitSlop={{top: 10, bottom: 10, left: 10, right: 10}}>
              <MaterialIcons name="close" size={ms(16)} color={c.textSecondary} />
            </TouchableOpacity>
          </View>

          <ScrollView
            showsVerticalScrollIndicator={false}
            bounces={false}
            nestedScrollEnabled
            contentContainerStyle={isLandscape ? ps.landscapeContent : ps.portraitContent}>

            {isLandscape ? (
              <View style={ps.landscapeRow}>
                <View style={ps.landscapeCol}>
                  <View style={ps.sectionLabel}>
                    <MaterialIcons name="calendar-today" size={ms(12)} color={c.primary} />
                    <Text style={[ps.labelText, {color: c.primary}]}>DATE</Text>
                  </View>
                  <View style={ps.wheels}>
                    <Wheel data={MONTHS} selected={month} onSelect={setMonth} width={wMonth} itemH={itemH} />
                    <Wheel data={dayData} selected={day - 1} onSelect={i => setDay(i + 1)} width={wDay} itemH={itemH} />
                    <Wheel data={yearData} selected={year - 2024} onSelect={i => setYear(2024 + i)} width={wYear} itemH={itemH} />
                  </View>
                </View>
                <View style={[ps.dividerV, {backgroundColor: c.borderLight}]} />
                <View style={ps.landscapeCol}>
                  <View style={ps.sectionLabel}>
                    <MaterialIcons name="access-time" size={ms(12)} color={c.primary} />
                    <Text style={[ps.labelText, {color: c.primary}]}>TIME</Text>
                  </View>
                  <View style={ps.wheels}>
                    <Wheel data={hourData} selected={hour} onSelect={setHour} width={wHour} itemH={itemH} />
                    <Text style={[ps.colon, {color: c.textPrimary}]}>:</Text>
                    <Wheel data={minData} selected={minute} onSelect={setMinute} width={wMin} itemH={itemH} />
                  </View>
                </View>
              </View>
            ) : (
              <>
                <View style={ps.sectionLabel}>
                  <MaterialIcons name="calendar-today" size={ms(12)} color={c.primary} />
                  <Text style={[ps.labelText, {color: c.primary}]}>DATE</Text>
                </View>
                <View style={ps.wheels}>
                  <Wheel data={MONTHS} selected={month} onSelect={setMonth} width={wMonth} itemH={itemH} />
                  <Wheel data={dayData} selected={day - 1} onSelect={i => setDay(i + 1)} width={wDay} itemH={itemH} />
                  <Wheel data={yearData} selected={year - 2024} onSelect={i => setYear(2024 + i)} width={wYear} itemH={itemH} />
                </View>
                <View style={ps.sectionLabel}>
                  <MaterialIcons name="access-time" size={ms(12)} color={c.primary} />
                  <Text style={[ps.labelText, {color: c.primary}]}>TIME</Text>
                </View>
                <View style={ps.wheels}>
                  <Wheel data={hourData} selected={hour} onSelect={setHour} width={wHour} itemH={itemH} />
                  <Text style={[ps.colon, {color: c.textPrimary}]}>:</Text>
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
              <Text style={[ps.btnText, {color: c.textSecondary}]}>Cancel</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[ps.confirmBtn, {backgroundColor: c.primary}]}
              onPress={() => onConfirm(new Date(year, month, day, hour, minute))}
              activeOpacity={0.8}>
              <MaterialIcons name="check" size={ms(16)} color={c.textOnPrimary} />
              <Text style={[ps.btnText, {color: c.textOnPrimary}]}>Confirm</Text>
            </TouchableOpacity>
          </View>
        </Animated.View>
      </Pressable>
    </Modal>
  );
}

const ps = StyleSheet.create({
  overlay: {flex: 1, justifyContent: 'center', alignItems: 'center'},
  card: {
    borderRadius: 18,
    overflow: 'hidden',
    elevation: 16,
    shadowOffset: {width: 0, height: 8},
    shadowOpacity: 0.2,
    shadowRadius: 24,
  },
  hdr: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: 1,
  },
  hdrIcon: {
    width: 34,
    height: 34,
    borderRadius: 10,
    justifyContent: 'center',
    alignItems: 'center',
  },
  hdrTitle: {flex: 1, fontSize: ms(16), fontWeight: '700'},
  closeBtn: {
    width: 34,
    height: 34,
    borderRadius: 17,
    justifyContent: 'center',
    alignItems: 'center',
  },
  sectionLabel: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    paddingHorizontal: 18,
    paddingTop: 10,
    paddingBottom: 2,
  },
  labelText: {fontSize: ms(10), fontWeight: '800', letterSpacing: 1},
  wheels: {
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 6,
  },
  colon: {fontSize: ms(20), fontWeight: '800', marginHorizontal: 2, marginTop: -2},
  footer: {
    flexDirection: 'row',
    gap: 10,
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderTopWidth: 1,
  },
  cancelBtn: {
    flex: 1,
    paddingVertical: 12,
    borderRadius: 10,
    borderWidth: 1.5,
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: 44,
  },
  confirmBtn: {
    flex: 1,
    flexDirection: 'row',
    paddingVertical: 12,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 5,
    minHeight: 44,
  },
  btnText: {fontSize: ms(14), fontWeight: '700'},
  portraitContent: {paddingBottom: 4},
  landscapeContent: {paddingVertical: 4},
  landscapeRow: {flexDirection: 'row', alignItems: 'center'},
  landscapeCol: {flex: 1, alignItems: 'center'},
  dividerV: {width: 1, alignSelf: 'stretch', marginVertical: 8},
});
