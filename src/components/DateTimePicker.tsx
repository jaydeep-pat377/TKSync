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
} from 'react-native';
import MaterialIcons from 'react-native-vector-icons/MaterialIcons';
import {useTheme} from '../contexts/ThemeContext';

const ITEM_H = 46;
const VISIBLE = 5;
const WHEEL_H = ITEM_H * VISIBLE;
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
};

function Wheel({data, selected, onSelect, width}: WheelProps) {
  const {c} = useTheme();
  const scrollRef = useRef<ScrollView>(null);
  const fromUser = useRef(false);
  const snapTimer = useRef<ReturnType<typeof setTimeout>>(null);
  const prev = useRef(selected);

  // Initial scroll on mount (no animation)
  useEffect(() => {
    const id = setTimeout(() => {
      scrollRef.current?.scrollTo({y: selected * ITEM_H, animated: false});
    }, 50);
    return () => clearTimeout(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Animated scroll when selection changes externally
  useEffect(() => {
    if (fromUser.current) {
      fromUser.current = false;
      prev.current = selected;
      return;
    }
    if (selected !== prev.current) {
      scrollRef.current?.scrollTo({y: selected * ITEM_H, animated: true});
      prev.current = selected;
    }
  }, [selected]);

  const snap = useCallback(
    (y: number) => {
      const i = Math.max(0, Math.min(Math.round(y / ITEM_H), data.length - 1));
      scrollRef.current?.scrollTo({y: i * ITEM_H, animated: true});
      if (i !== selected) {
        fromUser.current = true;
        onSelect(i);
      }
    },
    [data.length, selected, onSelect],
  );

  return (
    <View style={{width, height: WHEEL_H, overflow: 'hidden'}}>
      {/* Selection highlight (behind scroll content) */}
      <View
        style={[
          wS.bar,
          {top: MID * ITEM_H, borderColor: c.primary, backgroundColor: c.primarySurface},
        ]}
      />
      <ScrollView
        ref={scrollRef}
        showsVerticalScrollIndicator={false}
        snapToInterval={ITEM_H}
        decelerationRate="fast"
        bounces={false}
        nestedScrollEnabled
        onMomentumScrollEnd={e => {
          clearTimeout(snapTimer.current);
          snap(e.nativeEvent.contentOffset.y);
        }}
        onScrollEndDrag={e => {
          clearTimeout(snapTimer.current);
          const offsetY = e.nativeEvent.contentOffset.y;
          snapTimer.current = setTimeout(() => snap(offsetY), 120);
        }}
        contentContainerStyle={{
          paddingTop: MID * ITEM_H,
          paddingBottom: MID * ITEM_H,
        }}>
        {data.map((label, i) => (
          <TouchableOpacity
            key={`${label}-${i}`}
            activeOpacity={0.6}
            onPress={() => {
              fromUser.current = true;
              onSelect(i);
              scrollRef.current?.scrollTo({y: i * ITEM_H, animated: true});
            }}
            style={wS.item}>
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
    height: ITEM_H,
    borderRadius: 12,
    borderWidth: 1.5,
    zIndex: 0,
  },
  item: {height: ITEM_H, justifyContent: 'center', alignItems: 'center'},
  text: {fontSize: 17, fontWeight: '500'},
  textSel: {fontSize: 20, fontWeight: '700'},
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
  const fade = useRef(new Animated.Value(0)).current;
  const slide = useRef(new Animated.Value(40)).current;

  const [month, setMonth] = useState(value.getMonth());
  const [day, setDay] = useState(value.getDate());
  const [year, setYear] = useState(value.getFullYear());
  const [hour, setHour] = useState(value.getHours());
  const [minute, setMinute] = useState(value.getMinutes());

  // Sync internal state when value prop changes
  useEffect(() => {
    setMonth(value.getMonth());
    setDay(value.getDate());
    setYear(value.getFullYear());
    setHour(value.getHours());
    setMinute(value.getMinutes());
  }, [value]);

  // Entrance animation
  useEffect(() => {
    if (visible) {
      Animated.parallel([
        Animated.timing(fade, {toValue: 1, duration: 220, useNativeDriver: true}),
        Animated.spring(slide, {toValue: 0, friction: 8, tension: 60, useNativeDriver: true}),
      ]).start();
    } else {
      fade.setValue(0);
      slide.setValue(40);
    }
  }, [visible, fade, slide]);

  // Clamp day when month/year changes
  const maxDays = daysInMonth(month, year);
  useEffect(() => {
    if (day > maxDays) {
      setDay(maxDays);
    }
  }, [month, year, maxDays, day]);

  const dayData = Array.from({length: maxDays}, (_, i) => pad2(i + 1));
  const yearData = Array.from({length: 10}, (_, i) => String(2024 + i));
  const hourData = Array.from({length: 24}, (_, i) => pad2(i));
  const minData = Array.from({length: 60}, (_, i) => pad2(i));

  if (!visible) {
    return null;
  }

  return (
    <Modal transparent visible animationType="none" onRequestClose={onCancel}>
      <Pressable style={[ps.overlay, {backgroundColor: c.overlayModal}]} onPress={onCancel}>
        <Animated.View
          style={[
            ps.card,
            {
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
              <MaterialIcons name="event" size={20} color={c.primary} />
            </View>
            <Text style={[ps.hdrTitle, {color: c.textPrimary}]}>Select Date & Time</Text>
            <TouchableOpacity
              style={[ps.closeBtn, {backgroundColor: c.surface}]}
              onPress={onCancel}
              activeOpacity={0.7}>
              <MaterialIcons name="close" size={18} color={c.textSecondary} />
            </TouchableOpacity>
          </View>

          {/* Date section */}
          <View style={ps.label}>
            <MaterialIcons name="calendar-today" size={14} color={c.primary} />
            <Text style={[ps.labelText, {color: c.primary}]}>DATE</Text>
          </View>
          <View style={ps.wheels}>
            <Wheel data={MONTHS} selected={month} onSelect={setMonth} width={90} />
            <Wheel data={dayData} selected={day - 1} onSelect={i => setDay(i + 1)} width={64} />
            <Wheel data={yearData} selected={year - 2024} onSelect={i => setYear(2024 + i)} width={76} />
          </View>

          {/* Time section */}
          <View style={[ps.label, {marginTop: 6}]}>
            <MaterialIcons name="access-time" size={14} color={c.primary} />
            <Text style={[ps.labelText, {color: c.primary}]}>TIME</Text>
          </View>
          <View style={ps.wheels}>
            <Wheel data={hourData} selected={hour} onSelect={setHour} width={64} />
            <Text style={[ps.colon, {color: c.textPrimary}]}>:</Text>
            <Wheel data={minData} selected={minute} onSelect={setMinute} width={64} />
          </View>

          {/* Footer buttons */}
          <View style={[ps.footer, {borderTopColor: c.borderLight}]}>
            <TouchableOpacity
              style={[ps.cancelBtn, {borderColor: c.border}]}
              onPress={onCancel}
              activeOpacity={0.7}>
              <Text style={[ps.cancelText, {color: c.textSecondary}]}>Cancel</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[ps.confirmBtn, {backgroundColor: c.primary}]}
              onPress={() => onConfirm(new Date(year, month, day, hour, minute))}
              activeOpacity={0.8}>
              <MaterialIcons name="check" size={18} color={c.textOnPrimary} />
              <Text style={[ps.confirmText, {color: c.textOnPrimary}]}>Confirm</Text>
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
    width: '88%',
    maxWidth: 380,
    borderRadius: 20,
    overflow: 'hidden',
    elevation: 16,
    shadowOffset: {width: 0, height: 10},
    shadowOpacity: 0.2,
    shadowRadius: 24,
  },
  hdr: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingHorizontal: 18,
    paddingVertical: 14,
    borderBottomWidth: 1,
  },
  hdrIcon: {
    width: 36,
    height: 36,
    borderRadius: 12,
    justifyContent: 'center',
    alignItems: 'center',
  },
  hdrTitle: {flex: 1, fontSize: 17, fontWeight: '700'},
  closeBtn: {
    width: 32,
    height: 32,
    borderRadius: 16,
    justifyContent: 'center',
    alignItems: 'center',
  },
  label: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 22,
    paddingTop: 12,
    paddingBottom: 2,
  },
  labelText: {fontSize: 11, fontWeight: '800', letterSpacing: 1},
  wheels: {
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 14,
  },
  colon: {fontSize: 24, fontWeight: '800', marginHorizontal: 2, marginTop: -2},
  footer: {
    flexDirection: 'row',
    gap: 12,
    paddingHorizontal: 18,
    paddingVertical: 14,
    borderTopWidth: 1,
    marginTop: 6,
  },
  cancelBtn: {
    flex: 1,
    paddingVertical: 13,
    borderRadius: 12,
    borderWidth: 1.5,
    alignItems: 'center',
  },
  cancelText: {fontSize: 15, fontWeight: '700'},
  confirmBtn: {
    flex: 1,
    flexDirection: 'row',
    paddingVertical: 13,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
  },
  confirmText: {fontSize: 15, fontWeight: '700'},
});
