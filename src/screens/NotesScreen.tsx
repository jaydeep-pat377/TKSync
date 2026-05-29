import React, {useState, useRef, useEffect, useCallback} from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  TextInput,
  StatusBar,
  Animated,
  useWindowDimensions,
  KeyboardAvoidingView,
  Platform,
} from 'react-native';
import {useSafeAreaInsets} from 'react-native-safe-area-context';
import MaterialIcons from 'react-native-vector-icons/MaterialIcons';
import type {NativeStackNavigationProp} from '@react-navigation/native-stack';
import {useTheme} from '../contexts/ThemeContext';
import {Colors} from '../constants/colors';
import {common} from '../constants/commonStyles';
import DateTimePicker from '../components/DateTimePicker';
import ResponsiveModal from '../components/ResponsiveModal';
import {wp, ms} from '../utils/responsive';

type Props = {navigation: NativeStackNavigationProp<any>};

function formatPickerTime(date: Date | undefined): string {
  if (!date) return '';
  const mons = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  const h = date.getHours();
  const m = date.getMinutes();
  return `${mons[date.getMonth()]} ${date.getDate()}, ${h < 10 ? '0' : ''}${h}:${m < 10 ? '0' : ''}${m}`;
}

const TABS = [
  {key: 'plant', label: 'Plant', icon: 'factory'},
  {key: 'jobsite', label: 'Jobsite', icon: 'location-on'},
  {key: 'returned', label: 'Returned', icon: 'undo'},
  {key: 'time', label: 'Time', icon: 'schedule'},
  {key: 'cod', label: 'COD', icon: 'payments'},
];

// ─── SHARED COMPONENTS ───

function Stepper({value, unit, highlight, onIncrement, onDecrement, onChangeValue}: {value: string; unit: string; highlight?: boolean; onIncrement?: () => void; onDecrement?: () => void; onChangeValue?: (val: string) => void}) {
  const {c} = useTheme();
  const scaleM = useRef(new Animated.Value(1)).current;
  const scaleP = useRef(new Animated.Value(1)).current;
  const pulse = useCallback((anim: Animated.Value, cb?: () => void) => {
    Animated.sequence([
      Animated.timing(anim, {toValue: 0.85, duration: 80, useNativeDriver: true}),
      Animated.spring(anim, {toValue: 1, friction: 4, tension: 100, useNativeDriver: true}),
    ]).start();
    cb?.();
  }, []);
  return (
    <View style={st.stepperWrap}>
      <Animated.View style={{transform: [{scale: scaleM}]}}>
        <TouchableOpacity
          style={[st.stepBtn, st.stepBtnMinus, {backgroundColor: c.surface, borderColor: c.border}]}
          activeOpacity={0.7}
          onPress={() => pulse(scaleM, onDecrement)}>
          <MaterialIcons name="remove" size={ms(18)} color={c.textSecondary} />
        </TouchableOpacity>
      </Animated.View>
      <View style={[st.stepVal, {backgroundColor: highlight ? c.highlight : c.white, borderColor: c.border}]}>
        {onChangeValue ? (
          <TextInput
            style={[st.stepValText, {color: c.textPrimary, padding: 0, textAlign: 'center', width: '100%', height: '100%'}]}
            value={value === '0' ? '' : value}
            placeholder="—"
            placeholderTextColor={c.textMuted}
            keyboardType="number-pad"
            onChangeText={text => onChangeValue(text.replace(/[^0-9]/g, ''))}
          />
        ) : (
          <Text style={[st.stepValText, {color: c.textPrimary}]}>{value || '—'}</Text>
        )}
      </View>
      <Animated.View style={{transform: [{scale: scaleP}]}}>
        <TouchableOpacity
          style={[st.stepBtn, st.stepBtnPlus, {backgroundColor: c.primary}]}
          activeOpacity={0.7}
          onPress={() => pulse(scaleP, onIncrement)}>
          <MaterialIcons name="add" size={ms(18)} color={c.textOnPrimary} />
        </TouchableOpacity>
      </Animated.View>
      {unit ? (
        <View style={[st.unitBadge, {backgroundColor: c.surface, borderColor: c.border}]}>
          <Text style={[st.unitBadgeText, {color: c.textSecondary}]}>{unit}</Text>
        </View>
      ) : null}
    </View>
  );
}

function Field({label, children, wide, compact}: {label: string; children: React.ReactNode; wide?: boolean; compact?: boolean}) {
  const {c} = useTheme();
  if (compact) {
    return (
      <View style={[st.fieldCompact, {borderBottomColor: c.borderLight}]}>
        <Text style={[st.fieldCompactLabel, {color: c.textMuted}]}>{label}</Text>
        <View style={st.fieldCompactBody}>{children}</View>
      </View>
    );
  }
  return (
    <View style={[st.field, {borderBottomColor: c.borderLight}, wide && st.fieldWide]}>
      <Text style={[st.fieldLabel, {color: c.textPrimary}, wide && st.fieldLabelWide]}>{label}</Text>
      <View style={st.fieldBody}>{children}</View>
    </View>
  );
}

function FieldRow({children}: {children: React.ReactNode}) {
  return <View style={st.fieldRow}>{children}</View>;
}

function CardsGrid({children}: {children: React.ReactNode}) {
  const {width: sw} = useWindowDimensions();
  const isWide = sw > 680;
  return (
    <View style={isWide ? st.cardsGridWide : st.cardsGridNarrow}>
      {children}
    </View>
  );
}

function FieldCard({children, title, icon, fullWidth}: {children: React.ReactNode; title?: string; icon?: string; fullWidth?: boolean}) {
  const {c} = useTheme();
  const {width: sw} = useWindowDimensions();
  const isWide = sw > 680;
  return (
    <View style={[
      st.fieldCard,
      {backgroundColor: c.white, shadowColor: c.shadowColor, borderColor: c.borderLight},
      isWide && !fullWidth && st.fieldCardHalf,
    ]}>
      {title ? (
        <View style={st.fieldCardHeader}>
          {icon && <MaterialIcons name={icon as any} size={ms(14)} color={c.primary} />}
          <Text style={[st.fieldCardTitle, {color: c.textPrimary}]}>{title}</Text>
        </View>
      ) : null}
      {children}
    </View>
  );
}

function MoreBtn({onPress}: {onPress?: () => void}) {
  const {c} = useTheme();
  return (
    <TouchableOpacity style={[st.moreBtn, {backgroundColor: c.surface}]} activeOpacity={0.6} onPress={onPress}>
      <MaterialIcons name="more-horiz" size={ms(16)} color={c.primary} />
    </TouchableOpacity>
  );
}

function Check({checked, label, onPress}: {checked: boolean; label?: string; onPress?: () => void}) {
  const {c} = useTheme();
  const scale = useRef(new Animated.Value(1)).current;
  const tap = () => {
    Animated.sequence([
      Animated.timing(scale, {toValue: 0.8, duration: 60, useNativeDriver: true}),
      Animated.spring(scale, {toValue: 1, friction: 4, tension: 120, useNativeDriver: true}),
    ]).start();
    onPress?.();
  };
  return (
    <TouchableOpacity style={st.checkTap} activeOpacity={0.7} onPress={tap}>
      <Animated.View style={[
        st.checkBox,
        {borderColor: checked ? c.primary : c.border, backgroundColor: checked ? c.primary : c.white},
        {transform: [{scale}]},
      ]}>
        {checked && <MaterialIcons name="check" size={ms(14)} color={c.textOnPrimary} />}
      </Animated.View>
      {label && <Text style={[st.checkLabel, {color: c.textPrimary}]}>{label}</Text>}
    </TouchableOpacity>
  );
}

function Radio({selected, label, onPress}: {selected: boolean; label: string; onPress?: () => void}) {
  const {c} = useTheme();
  return (
    <TouchableOpacity style={st.radioTap} activeOpacity={0.7} onPress={onPress}>
      <View style={[st.radioCircle, {borderColor: selected ? c.primary : c.border}]}>
        {selected && <View style={[st.radioDot, {backgroundColor: c.primary}]} />}
      </View>
      <Text style={[st.radioLabel, {color: selected ? c.primary : c.textPrimary}]}>{label}</Text>
    </TouchableOpacity>
  );
}

function YellowInput({value}: {value: string}) {
  const {c} = useTheme();
  return (
    <View style={[st.hlInput, {backgroundColor: c.highlight, borderColor: c.primaryBorder}]}>
      <Text style={[st.hlInputText, {color: c.textPrimary}]}>{value}</Text>
    </View>
  );
}

function GrayInput({placeholder}: {placeholder?: string}) {
  const {c} = useTheme();
  return (
    <View style={[st.grayInput, {backgroundColor: c.surface, borderColor: c.border}]}>
      {placeholder && <Text style={[st.grayPlaceholder, {color: c.textMuted}]}>{placeholder}</Text>}
    </View>
  );
}

function LineInput({width: w, placeholder, value, onPress, editable, keyboardType, onChangeText}: {width?: number; placeholder?: string; value?: string; onPress?: () => void; editable?: boolean; keyboardType?: 'default' | 'number-pad' | 'numeric'; onChangeText?: (text: string) => void}) {
  const {c} = useTheme();
  const sizeStyle = w ? {width: w} : {flex: 1};
  // Read-only dropdown trigger: use Text so selected value is always visible
  if (onPress && !onChangeText) {
    return (
      <TouchableOpacity activeOpacity={0.7} onPress={onPress} style={[st.lineInput, {borderBottomColor: c.border, justifyContent: 'center'}, sizeStyle]}>
        <Text style={[st.lineInputText, {color: value ? c.textPrimary : c.textMuted}]} numberOfLines={1}>
          {value || placeholder || ''}
        </Text>
      </TouchableOpacity>
    );
  }
  return (
    <TextInput
      style={[st.lineInput, {borderBottomColor: c.border, color: c.textPrimary}, sizeStyle]}
      placeholderTextColor={c.textMuted}
      placeholder={placeholder || ''}
      value={value}
      editable={editable !== false}
      keyboardType={keyboardType}
      onChangeText={onChangeText}
    />
  );
}

function SaveButton({disabled, onPress}: {disabled?: boolean; onPress?: () => void}) {
  const {c} = useTheme();
  const scale = useRef(new Animated.Value(1)).current;
  return (
    <Animated.View style={{transform: [{scale}], alignSelf: 'flex-end', marginBottom: wp(6)}}>
      <TouchableOpacity
        style={[
          st.saveBtn,
          disabled
            ? {backgroundColor: c.border, borderWidth: 1, borderColor: c.border}
            : {backgroundColor: c.primary, elevation: 3, shadowColor: c.primary, shadowOffset: {width: 0, height: 2}, shadowOpacity: 0.3, shadowRadius: 6},
        ]}
        activeOpacity={disabled ? 1 : 0.8}
        disabled={disabled}
        onPress={onPress}
        onPressIn={() => !disabled && Animated.timing(scale, {toValue: 0.95, duration: 80, useNativeDriver: true}).start()}
        onPressOut={() => !disabled && Animated.spring(scale, {toValue: 1, friction: 4, tension: 100, useNativeDriver: true}).start()}>
        <MaterialIcons name="check-circle" size={ms(16)} color={disabled ? c.textMuted : c.textOnPrimary} />
        <Text style={[st.saveBtnText, {color: disabled ? c.textMuted : c.textOnPrimary}]}>Save Changes</Text>
      </TouchableOpacity>
    </Animated.View>
  );
}

function SectionTitle({title, icon}: {title: string; icon?: string}) {
  const {c} = useTheme();
  return (
    <View style={[st.secTitle, {borderBottomColor: c.border}]}>
      {icon && <MaterialIcons name={icon as any} size={ms(16)} color={c.primary} />}
      <Text style={[st.secTitleText, {color: c.textPrimary}]}>{title}</Text>
    </View>
  );
}

function SubHeader({labels}: {labels: string[]}) {
  const {c} = useTheme();
  return (
    <View style={st.subHeaderRow}>
      {labels.map(l => (
        <View key={l} style={[st.subHeaderPill, {backgroundColor: c.surface, borderColor: c.border}]}>
          <Text style={[st.subHeaderText, {color: c.textMuted}]}>{l}</Text>
        </View>
      ))}
    </View>
  );
}

function TimePicker({label, value, onPress}: {label?: string; value?: Date; onPress?: () => void}) {
  const {c} = useTheme();
  const hasValue = !!value;
  const displayText = hasValue ? formatPickerTime(value) : (label || 'Select Time');
  return (
    <TouchableOpacity
      style={[
        st.timePick,
        {
          backgroundColor: hasValue ? c.primarySurface : c.white,
          borderColor: hasValue ? c.primary : c.border,
        },
      ]}
      activeOpacity={0.6}
      onPress={onPress}>
      <View style={[st.timePickIcon, {backgroundColor: hasValue ? c.primary : c.primarySurface}]}>
        <MaterialIcons name="schedule" size={ms(16)} color={hasValue ? c.textOnPrimary : c.primary} />
      </View>
      <Text style={[st.timePickText, {color: hasValue ? c.primary : c.textMuted}]}>{displayText}</Text>
      <MaterialIcons name="keyboard-arrow-down" size={ms(18)} color={hasValue ? c.primary : c.textMuted} />
    </TouchableOpacity>
  );
}

function NoteInput({placeholder, borderColor, bgColor, textColor, value, onChangeText}: any) {
  const {c} = useTheme();
  const [focused, setFocused] = useState(false);
  return (
    <TextInput
      style={[
        st.textArea,
        {
          borderColor: focused ? c.primary : (borderColor || c.border),
          color: textColor || c.textPrimary,
          backgroundColor: bgColor || c.white,
          borderWidth: focused ? 2 : 1.5,
        },
      ]}
      multiline
      numberOfLines={4}
      placeholderTextColor={c.textMuted}
      placeholder={placeholder || 'Enter notes...'}
      value={value}
      onChangeText={onChangeText}
      onFocus={() => setFocused(true)}
      onBlur={() => setFocused(false)}
    />
  );
}

// ─── PLANT TAB ───
const REASON_OPTIONS = ['NOT ADDED', 'EXCEEDED', 'BRING UP TO'];

function ReasonListModal({
  visible,
  onSelect,
  onClose,
  options,
}: {
  visible: boolean;
  onSelect: (val: string) => void;
  onClose: () => void;
  options?: string[];
}) {
  const {c} = useTheme();
  const items = options || REASON_OPTIONS;
  return (
    <ResponsiveModal
      visible={visible}
      onClose={onClose}
      maxWidth={480}
      maxHeightPercent={75}>
      <View style={[st.popupHeader, {borderBottomColor: c.border}]}>
        <Text style={[st.popupTitle, {color: c.textPrimary}]}>LIST</Text>
        <TouchableOpacity style={[st.popupCloseBtn, {backgroundColor: c.surface}]} onPress={onClose} activeOpacity={0.7} hitSlop={{top: 8, bottom: 8, left: 8, right: 8}}>
          <MaterialIcons name="close" size={ms(20)} color={c.textSecondary} />
        </TouchableOpacity>
      </View>
      <ScrollView showsVerticalScrollIndicator={false} bounces={false} contentContainerStyle={{paddingVertical: wp(4)}}>
        {items.map(opt => (
          <TouchableOpacity
            key={opt}
            style={[common.modalOptionRow, {minHeight: wp(34)}]}
            activeOpacity={0.6}
            onPress={() => { onSelect(opt); onClose(); }}>
            <Text style={[st.modalOptionText, {color: c.textPrimary}]}>{opt}</Text>
          </TouchableOpacity>
        ))}
      </ScrollView>
    </ResponsiveModal>
  );
}

const PRODUCTS_DATA = [
  {code: '6217579', description: '45MPA NON-AIR C1/S3 HREXT HVSCM1 FF', qty: '8.60', unit: 'm3'},
  {code: '13355', description: 'TRUEMASS', qty: '0', unit: '/m'},
  {code: '15906', description: 'FIBERMAX FIREFIBER - 1.5KG/METER', qty: '0', unit: '/m'},
  {code: '2590', description: 'EASYFLOW HIGH EXTENDED', qty: '0', unit: '/m'},
  {code: '12581', description: 'TOARC FEE', qty: '8.60', unit: '/m'},
  {code: '14301', description: 'FLEX FUEL SURCHARGE', qty: '8.60', unit: '/m'},
  {code: '15902', description: 'INDUSTRIAL EMISSIONS CHARGE', qty: '8.60', unit: '/m'},
  {code: '2294', description: 'AFTER HOURS CHARGE', qty: '8.60', unit: '/m'},
  {code: '2571', description: 'ENVIRONMENTAL CHARGE - M3', qty: '8.60', unit: '/m'},
  {code: '5843', description: 'FUEL SURCHARGE - CBM /M3', qty: '8.60', unit: '/m'},
  {code: '9071', description: 'CHUTE WASHOUT', qty: '8.60', unit: '/m'},
];

function ProductsModal({visible, onClose}: {visible: boolean; onClose: () => void}) {
  const {c} = useTheme();
  return (
    <ResponsiveModal
      visible={visible}
      onClose={onClose}
      maxWidth={520}
      maxHeightPercent={80}>
      <View style={[st.popupHeader, {borderBottomColor: c.border}]}>
        <Text style={[st.popupTitle, {color: c.textPrimary}]}>PRODUCTS</Text>
        <TouchableOpacity
          style={[st.popupCloseBtn, {backgroundColor: c.surface}]}
          onPress={onClose}
          activeOpacity={0.7}
          hitSlop={{top: 8, bottom: 8, left: 8, right: 8}}>
          <MaterialIcons name="close" size={ms(14)} color={c.textSecondary} />
        </TouchableOpacity>
      </View>
      <ScrollView showsVerticalScrollIndicator={true} bounces={false} contentContainerStyle={{padding: wp(14)}}>
        {/* Table Header */}
        <View style={st.tableHeader}>
          <Text style={[st.tableCellCode, {fontWeight: '900', color: c.textPrimary}]}>CODE</Text>
          <Text style={[st.tableCellDesc, {fontWeight: '900', color: c.textPrimary}]}>DESCRIPTION</Text>
          <Text style={[st.tableCellQty, {fontWeight: '900', color: c.textPrimary}]}>QTY</Text>
          <Text style={[st.tableCellUnit, {fontWeight: '900', color: c.textPrimary}]}>UNIT</Text>
        </View>
        {/* Table Rows */}
        {PRODUCTS_DATA.map(item => (
          <View key={item.code} style={common.tableRow}>
            <Text style={[st.tableCellCode, {fontWeight: '500', color: c.textPrimary}]}>{item.code}</Text>
            <Text style={[st.tableCellDesc, {fontWeight: '500', color: c.textPrimary}]}>{item.description}</Text>
            <Text style={[st.tableCellQty, {fontWeight: '500', color: c.textPrimary}]}>{item.qty}</Text>
            <Text style={[st.tableCellUnit, {fontWeight: '500', color: c.textPrimary}]}>{item.unit}</Text>
          </View>
        ))}
      </ScrollView>
    </ResponsiveModal>
  );
}

const SLUMP_VALUES = ['120', '130', '140', '150', '160', '170', '180', '190', '200', '210', '220', '230'];

function SlumpPickerModal({
  visible,
  value,
  onConfirm,
  onClose,
  title = 'Slump From Plant',
}: {
  visible: boolean;
  value: string;
  onConfirm: (val: string) => void;
  onClose: () => void;
  title?: string;
}) {
  const {c} = useTheme();
  const [tempSelected, setTempSelected] = useState(value);
  const [customMode, setCustomMode] = useState(false);
  const [customValue, setCustomValue] = useState('');
  const modalScale = useRef(new Animated.Value(0.9)).current;
  const modalOpacity = useRef(new Animated.Value(0)).current;
  const customInputRef = useRef<TextInput>(null);

  useEffect(() => {
    if (visible) {
      const isPreset = SLUMP_VALUES.includes(value);
      setTempSelected(value);
      setCustomMode(!isPreset && value.length > 0);
      setCustomValue(!isPreset && value.length > 0 ? value : '');
      modalScale.setValue(0.9);
      modalOpacity.setValue(0);
      Animated.parallel([
        Animated.spring(modalScale, {toValue: 1, friction: 8, tension: 80, useNativeDriver: true}),
        Animated.timing(modalOpacity, {toValue: 1, duration: 200, useNativeDriver: true}),
      ]).start();
    }
  }, [visible, value, modalScale, modalOpacity]);

  const animateClose = useCallback((cb?: () => void) => {
    Animated.parallel([
      Animated.timing(modalScale, {toValue: 0.9, duration: 150, useNativeDriver: true}),
      Animated.timing(modalOpacity, {toValue: 0, duration: 150, useNativeDriver: true}),
    ]).start(() => cb?.());
  }, [modalScale, modalOpacity]);

  const handleCancel = () => animateClose(onClose);
  const handleConfirm = () => {
    const finalValue = customMode ? customValue.trim() : tempSelected;
    if (finalValue.length > 0) {
      animateClose(() => onConfirm(finalValue));
    }
  };

  const handlePresetSelect = (val: string) => {
    setTempSelected(val);
    setCustomMode(false);
    setCustomValue('');
  };

  const handleCustomToggle = () => {
    setCustomMode(true);
    setTempSelected('');
    setTimeout(() => customInputRef.current?.focus(), 100);
  };

  const handleCustomChange = (text: string) => {
    const numeric = text.replace(/[^0-9]/g, '');
    setCustomValue(numeric);
  };

  const activeValue = customMode ? customValue.trim() : tempSelected;
  const canConfirm = activeValue.length > 0;

  return (
    <ResponsiveModal
      visible={visible}
      onClose={handleCancel}
      maxWidth={460}
      maxHeightPercent={80}
      avoidKeyboard>

      {/* Header */}
      <View style={[sm.header, {backgroundColor: c.primarySurface, borderBottomColor: c.border}]}>
        <View style={[sm.headerIcon, {backgroundColor: c.primary}]}>
          <MaterialIcons name="straighten" size={ms(20)} color={c.textOnPrimary} />
        </View>
        <View style={common.flex1}>
          <Text style={[sm.headerTitle, {color: c.textPrimary}]}>{title}</Text>
          <Text style={[sm.headerSub, {color: c.textMuted}]}>Select or enter value (mm)</Text>
        </View>
        <TouchableOpacity style={[sm.closeBtn, {backgroundColor: c.white}]} onPress={handleCancel} activeOpacity={0.7} hitSlop={{top: 8, bottom: 8, left: 8, right: 8}}>
          <MaterialIcons name="close" size={ms(20)} color={c.textSecondary} />
        </TouchableOpacity>
      </View>

      {/* Preset Grid */}
      <ScrollView style={sm.scroll} showsVerticalScrollIndicator={false} bounces={false} contentContainerStyle={slumpSt.gridWrap}>
        <View style={slumpSt.grid}>
          {SLUMP_VALUES.map(val => {
            const isSelected = !customMode && tempSelected === val;
            return (
              <TouchableOpacity
                key={val}
                style={[
                  slumpSt.gridItem,
                  {backgroundColor: c.surface, borderColor: c.border, borderWidth: 1.5},
                  isSelected && {backgroundColor: c.primarySurface, borderColor: c.primary},
                ]}
                activeOpacity={0.6}
                onPress={() => handlePresetSelect(val)}>
                <Text style={[
                  slumpSt.gridItemText,
                  {color: c.textPrimary},
                  isSelected && {color: c.primary, fontWeight: '900'},
                ]}>
                  {val}
                </Text>
                {isSelected && (
                  <View style={slumpSt.gridCheck}>
                    <MaterialIcons name="check-circle" size={ms(18)} color={c.primary} />
                  </View>
                )}
              </TouchableOpacity>
            );
          })}
        </View>

        {/* Custom Input Section */}
        <View style={slumpSt.customSection}>
          <TouchableOpacity
            style={[
              slumpSt.customToggle,
              {backgroundColor: c.surface, borderColor: c.border, borderWidth: 1.5},
              customMode && {backgroundColor: c.primarySurface, borderColor: c.primary},
            ]}
            activeOpacity={0.6}
            onPress={handleCustomToggle}>
            <View style={[slumpSt.customIcon, {backgroundColor: customMode ? c.primary : c.border}]}>
              <MaterialIcons name="edit" size={ms(16)} color={customMode ? c.textOnPrimary : c.textSecondary} />
            </View>
            <Text style={[slumpSt.customLabel, {color: customMode ? c.primary : c.textSecondary}]}>
              Custom Value
            </Text>
          </TouchableOpacity>
          {customMode && (
            <View style={[slumpSt.customInputWrap, {backgroundColor: c.white, borderColor: c.primary}]}>
              <TextInput
                ref={customInputRef}
                style={[slumpSt.customInput, {color: c.textPrimary}]}
                value={customValue}
                onChangeText={handleCustomChange}
                placeholder="Enter value"
                placeholderTextColor={c.textMuted}
                keyboardType="number-pad"
                maxLength={4}
                autoFocus
              />
              <Text style={[slumpSt.customUnit, {color: c.textSecondary}]}>mm</Text>
            </View>
          )}
        </View>
      </ScrollView>

      {/* Footer */}
      <View style={[sm.footer, {borderTopColor: c.border}]}>
        <TouchableOpacity
          style={[sm.footerBtn, sm.cancelBtn, {backgroundColor: c.surface, borderColor: c.border}]}
          activeOpacity={0.7}
          onPress={handleCancel}>
          <MaterialIcons name="close" size={ms(16)} color={c.textSecondary} />
          <Text style={[sm.footerBtnText, {color: c.textSecondary}]}>Cancel</Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[sm.footerBtn, sm.confirmBtn, {
            backgroundColor: canConfirm ? c.primary : c.border,
          }]}
          activeOpacity={canConfirm ? 0.7 : 1}
          disabled={!canConfirm}
          onPress={handleConfirm}>
          <MaterialIcons name="check" size={ms(16)} color={canConfirm ? c.textOnPrimary : c.textMuted} />
          <Text style={[sm.footerBtnText, {color: canConfirm ? c.textOnPrimary : c.textMuted}]}>
            Confirm
          </Text>
        </TouchableOpacity>
      </View>
    </ResponsiveModal>
  );
}

const slumpSt = StyleSheet.create({
  gridWrap: {paddingHorizontal: wp(10), paddingTop: wp(8), paddingBottom: wp(4)},
  grid: {flexDirection: 'row', flexWrap: 'wrap', gap: wp(5)},
  gridItem: {width: '22%', flexGrow: 1, minWidth: wp(60), maxWidth: wp(95), paddingVertical: wp(7), borderRadius: wp(8), justifyContent: 'center', alignItems: 'center', position: 'relative', minHeight: wp(32)},
  gridItemText: {fontSize: ms(13), fontWeight: '700'},
  gridCheck: {position: 'absolute', top: wp(2), right: wp(2)},
  customSection: {marginTop: wp(7), gap: wp(5)},
  customToggle: {flexDirection: 'row', alignItems: 'center', paddingVertical: wp(6), paddingHorizontal: wp(10), borderRadius: wp(8), gap: wp(6), minHeight: wp(32)},
  customIcon: {width: wp(22), height: wp(22), borderRadius: wp(6), justifyContent: 'center', alignItems: 'center'},
  customLabel: {fontSize: ms(11), fontWeight: '700'},
  customInputWrap: {flexDirection: 'row', alignItems: 'center', borderRadius: wp(8), borderWidth: 1.5, paddingHorizontal: wp(10), height: wp(34)},
  customInput: {flex: 1, fontSize: ms(14), fontWeight: '700', padding: 0},
  customUnit: {fontSize: ms(11), fontWeight: '600', marginLeft: wp(5)},
});

function PlantTab() {
  const {c} = useTheme();
  const [slumpFromPlant, setSlumpFromPlant] = useState('20');
  const [slumpPickerVisible, setSlumpPickerVisible] = useState(false);
  const [slumpToJob, setSlumpToJob] = useState('140');
  const [slumpToJobPickerVisible, setSlumpToJobPickerVisible] = useState(false);
  const [waterLitres, setWaterLitres] = useState(0);
  const [waterReason, setWaterReason] = useState('');
  const [reasonModalVisible, setReasonModalVisible] = useState(false);
  const [productsModalVisible, setProductsModalVisible] = useState(false);
  const [handAdded, setHandAdded] = useState(false);
  const [nitrogenAdded, setNitrogenAdded] = useState(false);
  const [fibersAdded, setFibersAdded] = useState(false);
  const [loadTested, setLoadTested] = useState<'yes' | 'no' | null>(null);
  const [loadTemp, setLoadTemp] = useState(0);
  const [loadAir, setLoadAir] = useState(0);
  const [loadSlump, setLoadSlump] = useState('');
  const [loadSlumpPickerVisible, setLoadSlumpPickerVisible] = useState(false);
  const [loadCylinders, setLoadCylinders] = useState(0);
  const [truckStart, setTruckStart] = useState<Date | undefined>();
  const [truckEnd, setTruckEnd] = useState<Date | undefined>();
  const [truckPickerField, setTruckPickerField] = useState<'start' | 'end' | null>(null);
  const [truckPickerVisible, setTruckPickerVisible] = useState(false);
  return (
    <View style={[st.tabBody, {backgroundColor: c.surface}]}>
      <SaveButton />
      <CardsGrid>
      <FieldCard title="Mix Properties" icon="science">
      <Field label="SLUMP FROM PLANT">
        <TouchableOpacity activeOpacity={0.7} onPress={() => setSlumpPickerVisible(true)}>
          <YellowInput value={slumpFromPlant} />
        </TouchableOpacity>
        <Text style={[st.unitInline, {color: c.textSecondary}]}>mm</Text>
        <MoreBtn onPress={() => setSlumpPickerVisible(true)} />
      </Field>
      <Field label="WATER ADDED(FULL)">
        <View style={common.rowFlex1Gap12}>
          <View style={common.flex1Gap6}>
            <Text style={[st.inlineLabel, {color: c.textPrimary}]}>Litres</Text>
            <Stepper value={String(waterLitres)} unit="" onIncrement={() => setWaterLitres(v => v + 1)} onDecrement={() => setWaterLitres(v => Math.max(0, v - 1))} onChangeValue={v => setWaterLitres(parseInt(v) || 0)} />
          </View>
          <View style={common.flex1Gap6}>
            <Text style={[st.inlineLabel, {color: c.textPrimary}]}>Reason</Text>
            <View style={common.rowCenterGap8}>
              <LineInput placeholder="Reason" value={waterReason} onPress={() => setReasonModalVisible(true)} />
              <MoreBtn onPress={() => setReasonModalVisible(true)} />
            </View>
          </View>
        </View>
      </Field>
      <Field label="SLUMP TO JOB">
        <TouchableOpacity activeOpacity={0.7} onPress={() => setSlumpToJobPickerVisible(true)}>
          <YellowInput value={slumpToJob} />
        </TouchableOpacity>
        <Text style={[st.unitInline, {color: c.textSecondary}]}>mm</Text>
        <MoreBtn onPress={() => setSlumpToJobPickerVisible(true)} />
      </Field>
      <Field label="TEMP AT PLANT">
        <LineInput width={100} placeholder="Temperature" keyboardType="numeric" />
        <Text style={[st.unitInline, {color: c.textSecondary}]}>°C</Text>
      </Field>
      </FieldCard>
      <FieldCard title="Truck & Additives" icon="local-shipping">
      <FieldRow>
        <Field label="TRUCK START" compact>
          <TimePicker
            label="Select"
            value={truckStart}
            onPress={() => { setTruckPickerField('start'); setTruckPickerVisible(true); }}
          />
        </Field>
        <Field label="TRUCK END" compact>
          <TimePicker
            label="Select"
            value={truckEnd}
            onPress={() => { setTruckPickerField('end'); setTruckPickerVisible(true); }}
          />
        </Field>
      </FieldRow>
      <Field label="HAND-ADDED ITEMS">
        <Check checked={handAdded} onPress={() => setHandAdded(!handAdded)} />
        <TouchableOpacity activeOpacity={0.6} onPress={() => setProductsModalVisible(true)}>
          <Text style={[st.linkText, {color: c.linkBlue}]}>VIEW PRODUCTS</Text>
        </TouchableOpacity>
      </Field>
      <FieldRow>
        <Field label="NITROGEN ADDED" compact><Check checked={nitrogenAdded} label="If not on ticket" onPress={() => setNitrogenAdded(!nitrogenAdded)} /></Field>
        <Field label="FIBERS ADDED" compact><Check checked={fibersAdded} label="If not on ticket" onPress={() => setFibersAdded(!fibersAdded)} /></Field>
      </FieldRow>
      <Field label="LOAD TESTED">
        <View style={st.radioRow}>
          <Radio selected={loadTested === 'yes'} label="Yes" onPress={() => setLoadTested('yes')} />
          <Radio selected={loadTested === 'no'} label="No" onPress={() => setLoadTested('no')} />
        </View>
      </Field>
      {loadTested === 'yes' && (
        <>
          <FieldRow>
            <Field label="TEMP" compact>
              <Stepper value={String(loadTemp)} unit="C" onIncrement={() => setLoadTemp(v => v + 1)} onDecrement={() => setLoadTemp(v => Math.max(0, v - 1))} onChangeValue={v => setLoadTemp(parseInt(v) || 0)} />
            </Field>
            <Field label="AIR" compact>
              <Stepper value={String(loadAir)} unit="%" onIncrement={() => setLoadAir(v => v + 1)} onDecrement={() => setLoadAir(v => Math.max(0, v - 1))} onChangeValue={v => setLoadAir(parseInt(v) || 0)} />
            </Field>
          </FieldRow>
          <FieldRow>
            <Field label="SLUMP" compact>
              <Stepper value={loadSlump} unit="" onIncrement={() => setLoadSlump(v => String((parseInt(v) || 0) + 10))} onDecrement={() => setLoadSlump(v => String(Math.max(0, (parseInt(v) || 0) - 10)))} />
              <Text style={[st.unitInline, {color: c.textSecondary}]}>mm</Text>
              <MoreBtn onPress={() => setLoadSlumpPickerVisible(true)} />
            </Field>
            <Field label="CYLINDERS" compact>
              <Stepper value={String(loadCylinders)} unit="" onIncrement={() => setLoadCylinders(v => v + 1)} onDecrement={() => setLoadCylinders(v => Math.max(0, v - 1))} onChangeValue={v => setLoadCylinders(parseInt(v) || 0)} />
            </Field>
          </FieldRow>
        </>
      )}
      </FieldCard>
      <FieldCard title="Plant Notes" icon="edit-note" fullWidth>
      <Field label="NOTES" wide>
        <NoteInput placeholder="Enter plant notes..." />
      </Field>
      </FieldCard>
      </CardsGrid>
      <SlumpPickerModal
        visible={slumpPickerVisible}
        value={slumpFromPlant}
        title="Slump From Plant"
        onConfirm={(val) => { setSlumpFromPlant(val); setSlumpPickerVisible(false); }}
        onClose={() => setSlumpPickerVisible(false)}
      />
      <SlumpPickerModal
        visible={loadSlumpPickerVisible}
        value={loadSlump}
        title="Load Slump"
        onConfirm={(val) => { setLoadSlump(val); setLoadSlumpPickerVisible(false); }}
        onClose={() => setLoadSlumpPickerVisible(false)}
      />
      <SlumpPickerModal
        visible={slumpToJobPickerVisible}
        value={slumpToJob}
        title="Slump To Job"
        onConfirm={(val) => { setSlumpToJob(val); setSlumpToJobPickerVisible(false); }}
        onClose={() => setSlumpToJobPickerVisible(false)}
      />
      <ReasonListModal
        visible={reasonModalVisible}
        onSelect={setWaterReason}
        onClose={() => setReasonModalVisible(false)}
      />
      <ProductsModal
        visible={productsModalVisible}
        onClose={() => setProductsModalVisible(false)}
      />
      <DateTimePicker
        visible={truckPickerVisible}
        value={(truckPickerField === 'start' ? truckStart : truckEnd) || new Date()}
        onConfirm={(date) => {
          if (truckPickerField === 'start') {setTruckStart(date);}
          else if (truckPickerField === 'end') {setTruckEnd(date);}
          setTruckPickerVisible(false);
        }}
        onCancel={() => setTruckPickerVisible(false)}
      />
    </View>
  );
}

// ─── JOBSITE TAB ───
function JobsiteTab() {
  const {c} = useTheme();
  const [fullLoadLitres, setFullLoadLitres] = useState(0);
  const [fullLoadReason, setFullLoadReason] = useState('');
  const [fullLoadReasonModal, setFullLoadReasonModal] = useState(false);
  const [fullLoadMm, setFullLoadMm] = useState('');
  const [custWaterLitres, setCustWaterLitres] = useState(0);
  const [custWaterMm, setCustWaterMm] = useState('');
  const [maintWaterLitres, setMaintWaterLitres] = useState(0);
  const [maintWaterMm, setMaintWaterMm] = useState('');
  const [mmModalField, setMmModalField] = useState<'fullLoad' | 'custWater' | 'maintWater' | null>(null);
  const [addedValues, setAddedValues] = useState<Record<string, string>>({});
  const [addedModalItem, setAddedModalItem] = useState<string | null>(null);
  const [washoutArea, setWashoutArea] = useState('');
  const [washoutModalVisible, setWashoutModalVisible] = useState(false);
  const [jobsiteNotes, setJobsiteNotes] = useState('');
  const [jobsiteNotesModal, setJobsiteNotesModal] = useState(false);
  const [conveyorOrdered, setConveyorOrdered] = useState(false);
  const [unloadedConveyor, setUnloadedConveyor] = useState(false);
  const [loadDisputed, setLoadDisputed] = useState(false);
  const [jobLoadTested, setJobLoadTested] = useState<'yes' | 'no' | null>(null);
  const [jobLoadTemp, setJobLoadTemp] = useState(0);
  const [jobLoadAir, setJobLoadAir] = useState(0);
  const [jobLoadSlump, setJobLoadSlump] = useState('');
  const [jobLoadSlumpPickerVisible, setJobLoadSlumpPickerVisible] = useState(false);
  const [jobLoadCylinders, setJobLoadCylinders] = useState(0);
  return (
    <View style={[st.tabBody, {backgroundColor: c.surface}]}>
      <SaveButton />
      <CardsGrid>
      <FieldCard title="Water" icon="water-drop">
      <Field label="FULL LOAD (LITRES)">
        <Stepper value={String(fullLoadLitres)} unit="L" highlight onIncrement={() => setFullLoadLitres(v => v + 1)} onDecrement={() => setFullLoadLitres(v => Math.max(0, v - 1))} onChangeValue={v => setFullLoadLitres(parseInt(v) || 0)} />
      </Field>
      <Field label="FULL LOAD (REASON)">
        <LineInput placeholder="Reason" value={fullLoadReason} onPress={() => setFullLoadReasonModal(true)} />
        <MoreBtn onPress={() => setFullLoadReasonModal(true)} />
      </Field>
      <Field label="FULL LOAD (MM)">
        <LineInput width={80} placeholder="mm" value={fullLoadMm} onPress={() => setMmModalField('fullLoad')} />
        <MoreBtn onPress={() => setMmModalField('fullLoad')} />
      </Field>
      <Field label="CUSTOMER WATER">
        <Stepper value={String(custWaterLitres)} unit="L" onIncrement={() => setCustWaterLitres(v => v + 1)} onDecrement={() => setCustWaterLitres(v => Math.max(0, v - 1))} onChangeValue={v => setCustWaterLitres(parseInt(v) || 0)} />
        <LineInput width={80} placeholder="mm" value={custWaterMm} onPress={() => setMmModalField('custWater')} />
        <MoreBtn onPress={() => setMmModalField('custWater')} />
      </Field>
      <Field label="MAINTENANCE WATER">
        <Stepper value={String(maintWaterLitres)} unit="L" onIncrement={() => setMaintWaterLitres(v => v + 1)} onDecrement={() => setMaintWaterLitres(v => Math.max(0, v - 1))} onChangeValue={v => setMaintWaterLitres(parseInt(v) || 0)} />
        <LineInput width={80} placeholder="mm" value={maintWaterMm} onPress={() => setMmModalField('maintWater')} />
        <MoreBtn onPress={() => setMmModalField('maintWater')} />
      </Field>
      </FieldCard>
      <ReasonListModal
        visible={fullLoadReasonModal}
        onSelect={setFullLoadReason}
        onClose={() => setFullLoadReasonModal(false)}
      />
      <SlumpPickerModal
        visible={mmModalField !== null}
        value={(mmModalField === 'fullLoad' ? fullLoadMm : mmModalField === 'custWater' ? custWaterMm : maintWaterMm) || ''}
        title={mmModalField === 'fullLoad' ? 'Full Load (mm)' : mmModalField === 'custWater' ? 'Customer Water (mm)' : 'Maintenance Water (mm)'}
        onConfirm={(val) => {
          if (mmModalField === 'fullLoad') setFullLoadMm(val);
          else if (mmModalField === 'custWater') setCustWaterMm(val);
          else if (mmModalField === 'maintWater') setMaintWaterMm(val);
          setMmModalField(null);
        }}
        onClose={() => setMmModalField(null)}
      />

      <FieldCard title="Added, Not Ordered" icon="playlist-add">
      {['SUPER PLASTICIZER', 'CONVEYOR (IF NOT ON TICKET)', 'COLOR', 'FIBER', 'Other'].map(item => (
        <Field key={item} label={item}>
          <LineInput placeholder="Value" value={addedValues[item] || ''} onPress={item !== 'Other' ? () => setAddedModalItem(item) : undefined} onChangeText={item === 'Other' ? (text) => setAddedValues(prev => ({...prev, [item]: text})) : undefined} />
          {item !== 'Other' && <MoreBtn onPress={() => setAddedModalItem(item)} />}
        </Field>
      ))}
      </FieldCard>
      <ReasonListModal
        visible={addedModalItem !== null}
        options={['NOT ADDED', 'CUSTOMER', 'DRIVER']}
        onSelect={(val) => { if (addedModalItem) setAddedValues(prev => ({...prev, [addedModalItem]: val})); }}
        onClose={() => setAddedModalItem(null)}
      />

      <FieldCard title="Options & Testing" icon="checklist">
      <FieldRow>
        <Field label="CONVEYOR ORDERED" compact><Check checked={conveyorOrdered} label="Not used" onPress={() => setConveyorOrdered(!conveyorOrdered)} /></Field>
        <Field label="UNLOADED CONVEYOR" compact><Check checked={unloadedConveyor} onPress={() => setUnloadedConveyor(!unloadedConveyor)} /></Field>
      </FieldRow>
      <FieldRow>
        <Field label="LOAD DISPUTED" compact><Check checked={loadDisputed} onPress={() => setLoadDisputed(!loadDisputed)} /></Field>
        <Field label="WASHOUT AREA" compact>
          <LineInput placeholder="Area" value={washoutArea} onPress={() => setWashoutModalVisible(true)} />
          <MoreBtn onPress={() => setWashoutModalVisible(true)} />
        </Field>
      </FieldRow>
      <Field label="LOAD TESTED">
        <View style={st.radioRow}>
          <Radio selected={jobLoadTested === 'yes'} label="Yes" onPress={() => setJobLoadTested('yes')} />
          <Radio selected={jobLoadTested === 'no'} label="No" onPress={() => setJobLoadTested('no')} />
        </View>
      </Field>
      {jobLoadTested === 'yes' && (
        <>
          <FieldRow>
            <Field label="TEMP" compact>
              <Stepper value={String(jobLoadTemp)} unit="C" onIncrement={() => setJobLoadTemp(v => v + 1)} onDecrement={() => setJobLoadTemp(v => Math.max(0, v - 1))} onChangeValue={v => setJobLoadTemp(parseInt(v) || 0)} />
            </Field>
            <Field label="AIR" compact>
              <Stepper value={String(jobLoadAir)} unit="%" onIncrement={() => setJobLoadAir(v => v + 1)} onDecrement={() => setJobLoadAir(v => Math.max(0, v - 1))} onChangeValue={v => setJobLoadAir(parseInt(v) || 0)} />
            </Field>
          </FieldRow>
          <FieldRow>
            <Field label="SLUMP" compact>
              <Stepper value={jobLoadSlump} unit="" onIncrement={() => setJobLoadSlump(v => String((parseInt(v) || 0) + 10))} onDecrement={() => setJobLoadSlump(v => String(Math.max(0, (parseInt(v) || 0) - 10)))} onChangeValue={setJobLoadSlump} />
              <Text style={[st.unitInline, {color: c.textSecondary}]}>mm</Text>
              <MoreBtn onPress={() => setJobLoadSlumpPickerVisible(true)} />
            </Field>
            <Field label="CYLINDERS" compact>
              <Stepper value={String(jobLoadCylinders)} unit="" onIncrement={() => setJobLoadCylinders(v => v + 1)} onDecrement={() => setJobLoadCylinders(v => Math.max(0, v - 1))} onChangeValue={v => setJobLoadCylinders(parseInt(v) || 0)} />
            </Field>
          </FieldRow>
          <SlumpPickerModal
            visible={jobLoadSlumpPickerVisible}
            title="Load Slump"
            value={jobLoadSlump}
            onConfirm={(val) => { setJobLoadSlump(val); setJobLoadSlumpPickerVisible(false); }}
            onClose={() => setJobLoadSlumpPickerVisible(false)}
          />
        </>
      )}
      </FieldCard>
      <ReasonListModal
        visible={washoutModalVisible}
        options={['WHEELBARROW', 'DUMPSTER', 'BEHIND CURB LINE', 'STONE PILE ON JOB SITE', 'TRUCK MOUNTED WASHOUT', 'PUMP', 'OTHER']}
        onSelect={setWashoutArea}
        onClose={() => setWashoutModalVisible(false)}
      />
      <FieldCard title="Jobsite Notes" icon="edit-note" fullWidth>
      <Field label="NOTES" wide>
        <View style={common.rowStartFullW}>
          <View style={common.flex1}>
            <NoteInput placeholder="Enter jobsite notes..." value={jobsiteNotes} onChangeText={setJobsiteNotes} />
          </View>
          <MoreBtn onPress={() => setJobsiteNotesModal(true)} />
        </View>
      </Field>
      </FieldCard>
      <ReasonListModal
        visible={jobsiteNotesModal}
        options={[
          'Uneven Subgrade', 'Wet/Hot/Frozen Subgrade', 'Old Concrete > 2 Hours',
          'Blessed Surface', 'Surface Rained-on', 'No Curing of Concrete',
          'Incorrect Amount of Cust. Added Product', 'Not Sampling Between 10 & 90% of Load',
          'Minimum Sample Size Not 1ft/3 Buckets', 'Slump Test Incorrect',
          'Air Test Incorrect', 'Cylinder Making Incorrect',
          'Cylinder Storage Incorrect', 'No Comment',
        ]}
        onSelect={(val) => setJobsiteNotes(prev => prev ? prev + '\n' + val : val)}
        onClose={() => setJobsiteNotesModal(false)}
      />
      </CardsGrid>
    </View>
  );
}

// ─── DISPOSAL METHOD OPTIONS ───
const DISPOSAL_METHODS = [
  {key: 'RESHIPPED IN YARD', icon: 'local-shipping'},
  {key: 'DUMPED IN YARD', icon: 'terrain'},
  {key: 'DUMPED AT THIRD PARTY YARD', icon: 'warehouse'},
  {key: 'MADE BLOCKS', icon: 'view-module'},
  {key: 'USED FOR PLANT/SHOP', icon: 'factory'},
  {key: 'RE-ROUTED TO DIFFERENT SITE', icon: 'alt-route'},
  {key: 'GRANULIZE', icon: 'grain'},
];

const RETURN_REASONS = [
  {key: 'REJECTED - AIR OUT OF SPEC', icon: 'air'},
  {key: 'REJECTED - SLUMP OUT OF SPEC', icon: 'trending-down'},
  {key: 'REJECTED - TEMPERATURE', icon: 'thermostat'},
  {key: 'REJECTED - BALLING', icon: 'circle'},
  {key: 'REJECTED - TIME LIMIT EXCEEDED', icon: 'timer-off'},
  {key: 'POUR COMPLETE - NOT NEEDED', icon: 'check-circle-outline'},
  {key: 'OTHER - DRIVER ADD NOTES', icon: 'edit-note'},
];

// ─── ENHANCED SELECTION MODAL ───
function SelectionModal({
  visible,
  title,
  subtitle,
  headerIcon,
  options,
  selected,
  onSave,
  onClose,
}: {
  visible: boolean;
  title: string;
  subtitle: string;
  headerIcon: string;
  options: {key: string; icon: string}[];
  selected: string;
  onSave: (val: string) => void;
  onClose: () => void;
}) {
  const {c} = useTheme();
  const [tempSelected, setTempSelected] = useState(selected);
  const modalScale = useRef(new Animated.Value(0.9)).current;
  const modalOpacity = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    if (visible) {
      setTempSelected(selected);
      modalScale.setValue(0.9);
      modalOpacity.setValue(0);
      Animated.parallel([
        Animated.spring(modalScale, {toValue: 1, friction: 8, tension: 80, useNativeDriver: true}),
        Animated.timing(modalOpacity, {toValue: 1, duration: 200, useNativeDriver: true}),
      ]).start();
    }
  }, [visible, selected, modalScale, modalOpacity]);

  const animateClose = useCallback((cb?: () => void) => {
    Animated.parallel([
      Animated.timing(modalScale, {toValue: 0.9, duration: 150, useNativeDriver: true}),
      Animated.timing(modalOpacity, {toValue: 0, duration: 150, useNativeDriver: true}),
    ]).start(() => cb?.());
  }, [modalScale, modalOpacity]);

  const handleCancel = () => animateClose(onClose);
  const handleSave = () => animateClose(() => {
    onSave(tempSelected);
    onClose();
  });

  const hasChanged = tempSelected !== selected;
  const hasTempSelection = tempSelected.length > 0;

  return (
    <ResponsiveModal
      visible={visible}
      onClose={handleCancel}
      maxWidth={460}
      maxHeightPercent={80}>

      {/* Header */}
      <View style={[sm.header, {backgroundColor: c.primarySurface, borderBottomColor: c.border}]}>
        <View style={[sm.headerIcon, {backgroundColor: c.primary}]}>
          <MaterialIcons name={headerIcon as any} size={ms(20)} color={c.textOnPrimary} />
        </View>
        <View style={common.flex1}>
          <Text style={[sm.headerTitle, {color: c.textPrimary}]}>{title}</Text>
          <Text style={[sm.headerSub, {color: c.textMuted}]}>{subtitle}</Text>
        </View>
        <TouchableOpacity style={[sm.closeBtn, {backgroundColor: c.white}]} onPress={handleCancel} activeOpacity={0.7} hitSlop={{top: 8, bottom: 8, left: 8, right: 8}}>
          <MaterialIcons name="close" size={ms(20)} color={c.textSecondary} />
        </TouchableOpacity>
      </View>

      {/* Options */}
      <ScrollView style={sm.scroll} showsVerticalScrollIndicator={false} bounces={false} contentContainerStyle={sm.scrollContent}>
        {options.map(opt => {
          const isSelected = opt.key === tempSelected;
          return (
            <TouchableOpacity
              key={opt.key}
              style={[
                sm.item,
                {borderColor: 'transparent', borderWidth: 1.5},
                isSelected && {backgroundColor: c.primarySurface, borderColor: c.primary},
              ]}
              activeOpacity={0.6}
              onPress={() => setTempSelected(opt.key)}>
              <View style={[sm.itemIcon, {backgroundColor: isSelected ? c.primary : c.surface}]}>
                <MaterialIcons name={opt.icon as any} size={ms(20)} color={isSelected ? c.textOnPrimary : c.textSecondary} />
              </View>
              <Text style={[
                sm.itemText,
                {color: c.textPrimary},
                isSelected && {color: c.primary, fontWeight: '800'},
              ]}>
                {opt.key}
              </Text>
              {isSelected ? (
                <MaterialIcons name="check-circle" size={ms(22)} color={c.primary} />
              ) : (
                <View style={[sm.itemCircle, {borderColor: c.border}]} />
              )}
            </TouchableOpacity>
          );
        })}
      </ScrollView>

      {/* Footer */}
      <View style={[sm.footer, {borderTopColor: c.border}]}>
        <TouchableOpacity
          style={[sm.footerBtn, sm.cancelBtn, {backgroundColor: c.surface, borderColor: c.border}]}
          activeOpacity={0.7}
          onPress={handleCancel}>
          <MaterialIcons name="close" size={ms(16)} color={c.textSecondary} />
          <Text style={[sm.footerBtnText, {color: c.textSecondary}]}>Cancel</Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[sm.footerBtn, sm.confirmBtn, {
            backgroundColor: hasTempSelection ? c.primary : c.border,
          }]}
          activeOpacity={hasTempSelection ? 0.7 : 1}
          disabled={!hasTempSelection}
          onPress={handleSave}>
          <MaterialIcons name="check" size={ms(16)} color={hasTempSelection ? c.textOnPrimary : c.textMuted} />
          <Text style={[sm.footerBtnText, {color: hasTempSelection ? c.textOnPrimary : c.textMuted}]}>
            {hasChanged ? 'Save' : 'Confirm'}
          </Text>
        </TouchableOpacity>
      </View>
    </ResponsiveModal>
  );
}

const sm = StyleSheet.create({
  header: {flexDirection: 'row', alignItems: 'center', gap: wp(6), paddingHorizontal: wp(12), paddingVertical: wp(6), borderBottomWidth: 1},
  headerIcon: {width: wp(26), height: wp(26), borderRadius: wp(8), justifyContent: 'center', alignItems: 'center'},
  headerTitle: {fontSize: ms(14), fontWeight: '900', letterSpacing: 0.3},
  headerSub: {fontSize: ms(9), fontWeight: '500', marginTop: 0},
  closeBtn: {width: wp(28), height: wp(28), borderRadius: wp(14), justifyContent: 'center', alignItems: 'center', elevation: 2, shadowColor: Colors.shadowColor, shadowOffset: {width: 0, height: 1}, shadowOpacity: 0.1, shadowRadius: 3},
  scroll: {flexGrow: 0},
  scrollContent: {paddingHorizontal: wp(10), paddingTop: wp(6), paddingBottom: wp(4)},
  item: {flexDirection: 'row', alignItems: 'center', paddingVertical: wp(7), paddingHorizontal: wp(8), borderRadius: wp(8), marginVertical: 2, gap: wp(8), minHeight: wp(36)},
  itemIcon: {width: wp(28), height: wp(28), borderRadius: wp(8), justifyContent: 'center', alignItems: 'center'},
  itemText: {fontSize: ms(12), fontWeight: '700', flex: 1, letterSpacing: 0.2},
  itemCircle: {width: wp(18), height: wp(18), borderRadius: wp(9), borderWidth: 2},
  footer: {flexDirection: 'row', gap: wp(8), paddingHorizontal: wp(12), paddingVertical: wp(8), borderTopWidth: 1},
  footerBtn: {flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: wp(5), paddingVertical: wp(8), borderRadius: wp(10), minHeight: wp(30)},
  footerBtnText: {fontSize: ms(12), fontWeight: '700'},
  cancelBtn: {borderWidth: 1.5},
  confirmBtn: {elevation: 2, shadowColor: Colors.shadowColor, shadowOffset: {width: 0, height: 1}, shadowOpacity: 0.15, shadowRadius: 4},
});

// ─── RETURNED TAB ───
function ReturnedTab() {
  const {c} = useTheme();
  const [concreteVal, setConcreteVal] = useState('');
  const [disposalMethod, setDisposalMethod] = useState('');
  const [returnReason, setReturnReason] = useState('');
  const [disposalModal, setDisposalModal] = useState(false);
  const [reasonModal, setReasonModal] = useState(false);

  const handleConcreteChange = (text: string) => {
    let cleaned = text.replace(/[^0-9.]/g, '');
    const dotIndex = cleaned.indexOf('.');
    if (dotIndex !== -1) {
      cleaned = cleaned.substring(0, dotIndex + 1) + cleaned.substring(dotIndex + 1).replace(/\./g, '');
    }
    if (cleaned.startsWith('.')) {cleaned = '0' + cleaned;}
    const parts = cleaned.split('.');
    if (parts[1] && parts[1].length > 2) {
      cleaned = parts[0] + '.' + parts[1].substring(0, 2);
    }
    if (parts[0].length > 1 && parts[0].startsWith('0') && !cleaned.includes('.')) {
      cleaned = String(parseInt(parts[0], 10));
    }
    setConcreteVal(cleaned);
  };

  // Silent validation
  const isValidNumber = (val: string): boolean => {
    const trimmed = val.trim();
    if (trimmed.length === 0 || trimmed !== val || trimmed.endsWith('.')) {return false;}
    if (!/^\d+(\.\d{1,2})?$/.test(trimmed)) {return false;}
    const num = Number(trimmed);
    return !isNaN(num) && isFinite(num) && num >= 0;
  };

  const isConcreteValid = isValidNumber(concreteVal);
  const isDisposalValid = DISPOSAL_METHODS.some(m => m.key === disposalMethod);
  const isReasonValid = RETURN_REASONS.some(r => r.key === returnReason);
  const isFormValid = isConcreteValid && isDisposalValid && isReasonValid;

  const handleSave = () => {
    if (!isFormValid) {return;}
    // All valid — safe to proceed with save
  };

  return (
    <View style={[st.tabBody, {backgroundColor: c.surface}]}>
      <SaveButton disabled={!isFormValid} onPress={handleSave} />

      <CardsGrid>
      <FieldCard title="Return Details" icon="assignment-return">
      {/* Returned Concrete */}
      <Field label="RETURNED CONCRETE">
        <View style={[st.numericInput, {backgroundColor: isConcreteValid ? c.primarySurface : c.surface, borderColor: isConcreteValid ? c.primary : c.border}]}>
          <TextInput
            style={[st.numericInputText, {color: isConcreteValid ? c.primary : c.textPrimary}]}
            value={concreteVal}
            onChangeText={handleConcreteChange}
            keyboardType="decimal-pad"
            maxLength={8}
            selectTextOnFocus
            placeholder="0.00"
            placeholderTextColor={c.textMuted}
          />
        </View>
        <Text style={[st.unitInline, {color: c.textSecondary}]}>M3</Text>
      </Field>

      {/* Disposal Method */}
      <Field label="DISPOSAL METHOD">
        <TouchableOpacity
          style={[st.selectorBtn, common.selectorCompact, {backgroundColor: isDisposalValid ? c.primarySurface : c.surface, borderColor: isDisposalValid ? c.primary : c.border}]}
          activeOpacity={0.6}
          onPress={() => setDisposalModal(true)}>
          {isDisposalValid && (
            <View style={[{width: wp(22), height: wp(22), borderRadius: wp(6), justifyContent: 'center', alignItems: 'center', backgroundColor: c.primary}]}>
              <MaterialIcons name={DISPOSAL_METHODS.find(m => m.key === disposalMethod)?.icon as any} size={ms(16)} color={c.textOnPrimary} />
            </View>
          )}
          <Text style={[st.selectorText, {color: isDisposalValid ? c.primary : c.textMuted}]} numberOfLines={1}>
            {disposalMethod || 'Select method'}
          </Text>
          <MaterialIcons name="keyboard-arrow-down" size={ms(20)} color={isDisposalValid ? c.primary : c.textMuted} />
        </TouchableOpacity>
      </Field>

      {/* Reason for Return */}
      <Field label="REASON FOR RETURN">
        <TouchableOpacity
          style={[st.selectorBtn, common.selectorCompact, {backgroundColor: isReasonValid ? c.primarySurface : c.surface, borderColor: isReasonValid ? c.primary : c.border}]}
          activeOpacity={0.6}
          onPress={() => setReasonModal(true)}>
          {isReasonValid && (
            <View style={[{width: wp(22), height: wp(22), borderRadius: wp(6), justifyContent: 'center', alignItems: 'center', backgroundColor: c.primary}]}>
              <MaterialIcons name={RETURN_REASONS.find(r => r.key === returnReason)?.icon as any} size={ms(16)} color={c.textOnPrimary} />
            </View>
          )}
          <Text style={[st.selectorText, {color: isReasonValid ? c.primary : c.textMuted}]} numberOfLines={1}>
            {returnReason || 'Select reason'}
          </Text>
          <MaterialIcons name="keyboard-arrow-down" size={ms(20)} color={isReasonValid ? c.primary : c.textMuted} />
        </TouchableOpacity>
      </Field>
      </FieldCard>
      </CardsGrid>

      {/* Modals */}
      <SelectionModal
        visible={disposalModal}
        title="Disposal Method"
        subtitle="Select a disposal method"
        headerIcon="delete-sweep"
        options={DISPOSAL_METHODS}
        selected={disposalMethod}
        onSave={setDisposalMethod}
        onClose={() => setDisposalModal(false)}
      />
      <SelectionModal
        visible={reasonModal}
        title="Reason for Return"
        subtitle="Select a return reason"
        headerIcon="assignment-return"
        options={RETURN_REASONS}
        selected={returnReason}
        onSave={setReturnReason}
        onClose={() => setReasonModal(false)}
      />
    </View>
  );
}

// ─── TIME ADJUST TAB ───
const TIME_EVENTS = [
  {key: 'LEAVE PLANT', icon: 'local-shipping'},
  {key: 'ARRIVE JOB', icon: 'location-on'},
  {key: 'START POUR', icon: 'water-drop'},
  {key: 'WASHING', icon: 'clean-hands'},
  {key: 'LEAVE JOB', icon: 'route'},
  {key: 'AT PLANT', icon: 'factory'},
];

function TimeAdjustTab() {
  const {c, isDark} = useTheme();
  const [selectedTimes, setSelectedTimes] = useState<{[key: string]: Date}>({});
  const [pickerVisible, setPickerVisible] = useState(false);
  const [pickerField, setPickerField] = useState<string | null>(null);

  const filledCount = TIME_EVENTS.filter(e => !!selectedTimes[e.key]).length;
  const allFilled = filledCount === TIME_EVENTS.length;

  return (
    <View style={[st.tabBody, {backgroundColor: c.surface}]}>

      {/* Header card */}
      <View style={[tt.headerCard, {backgroundColor: c.white, shadowColor: c.shadowColor}]}>
        <View style={tt.headerTop}>
          <View style={[tt.headerIconWrap, {backgroundColor: c.primarySurface}]}>
            <MaterialIcons name="schedule" size={ms(18)} color={c.primary} />
          </View>
          <View style={common.flex1}>
            <Text style={[tt.headerTitle, {color: c.textPrimary}]}>Delivery Timeline</Text>
            <Text style={[tt.headerSub, {color: c.textMuted}]}>
              {allFilled ? 'All timestamps recorded' : `${filledCount} of ${TIME_EVENTS.length} completed`}
            </Text>
          </View>
          <View style={[tt.countPill, {backgroundColor: allFilled ? c.successSurface : c.surface, borderColor: allFilled ? c.success : c.border}]}>
            <Text style={[tt.countText, {color: allFilled ? c.successDark : c.textMuted}]}>{filledCount}/{TIME_EVENTS.length}</Text>
          </View>
        </View>
        {/* Progress */}
        <View style={[tt.track, {backgroundColor: c.border}]}>
          <View style={[tt.fill, {backgroundColor: allFilled ? c.success : c.primary, width: `${(filledCount / TIME_EVENTS.length) * 100}%`}]} />
        </View>
      </View>

      {/* Timeline list */}
      <View style={[tt.listCard, {backgroundColor: c.white, shadowColor: c.shadowColor}]}>
        {TIME_EVENTS.map((event, i) => {
          const hasValue = !!selectedTimes[event.key];
          const isLast = i === TIME_EVENTS.length - 1;
          return (
            <TouchableOpacity
              key={event.key}
              activeOpacity={0.6}
              onPress={() => {
                setPickerField(event.key);
                setPickerVisible(true);
              }}
              style={[tt.row, !isLast && {borderBottomWidth: 1, borderBottomColor: c.borderLight}]}>

              {/* Left: step connector */}
              <View style={tt.stepCol}>
                <View style={[tt.dot, {backgroundColor: hasValue ? c.primary : c.border, borderColor: hasValue ? c.primarySurface : c.surface}]}>
                  {hasValue
                    ? <MaterialIcons name="check" size={ms(10)} color={c.textOnPrimary} />
                    : <Text style={[tt.dotNum, {color: c.textMuted}]}>{i + 1}</Text>
                  }
                </View>
                {!isLast && <View style={[tt.line, {backgroundColor: selectedTimes[TIME_EVENTS[i + 1]?.key] || hasValue ? c.primaryMuted : c.border}]} />}
              </View>

              {/* Center: icon + label */}
              <View style={[tt.iconWrap, {backgroundColor: hasValue ? c.primarySurface : c.surface}]}>
                <MaterialIcons name={event.icon as any} size={ms(15)} color={hasValue ? c.primary : c.textTertiary} />
              </View>
              <View style={common.flex1}>
                <Text style={[tt.label, {color: c.textPrimary}]}>{event.key}</Text>
                <Text style={[tt.value, {color: hasValue ? c.primary : c.textMuted}]}>
                  {hasValue ? formatPickerTime(selectedTimes[event.key]) : 'Not set'}
                </Text>
              </View>

              {/* Right: action */}
              <View style={[tt.editBtn, {backgroundColor: hasValue ? c.primarySurface : c.surface}]}>
                <MaterialIcons name={hasValue ? 'edit' : 'add'} size={ms(13)} color={hasValue ? c.primary : c.textMuted} />
              </View>
            </TouchableOpacity>
          );
        })}
      </View>

      {/* Save */}
      <SaveButton disabled={!allFilled} />

      <DateTimePicker
        visible={pickerVisible}
        value={pickerField && selectedTimes[pickerField] ? selectedTimes[pickerField] : new Date()}
        onConfirm={(date) => {
          if (pickerField) {
            setSelectedTimes(prev => ({...prev, [pickerField]: date}));
          }
          setPickerVisible(false);
        }}
        onCancel={() => setPickerVisible(false)}
      />
    </View>
  );
}

const tt = StyleSheet.create({
  headerCard: {borderRadius: wp(10), padding: wp(10), marginBottom: wp(8), elevation: 2, shadowOffset: {width: 0, height: 1}, shadowOpacity: 0.06, shadowRadius: 4},
  headerTop: {flexDirection: 'row', alignItems: 'center', gap: wp(8), marginBottom: wp(6)},
  headerIconWrap: {width: wp(28), height: wp(28), borderRadius: wp(8), justifyContent: 'center', alignItems: 'center'},
  headerTitle: {fontSize: ms(12), fontWeight: '800', letterSpacing: 0.2},
  headerSub: {fontSize: ms(9), fontWeight: '500', marginTop: 1},
  countPill: {paddingHorizontal: wp(7), paddingVertical: wp(2), borderRadius: wp(8), borderWidth: 1.5},
  countText: {fontSize: ms(9), fontWeight: '800'},
  track: {height: wp(3), borderRadius: wp(2), overflow: 'hidden'},
  fill: {position: 'absolute', left: 0, top: 0, bottom: 0, borderRadius: wp(2)},
  listCard: {borderRadius: wp(10), overflow: 'hidden', marginBottom: wp(8), elevation: 2, shadowOffset: {width: 0, height: 1}, shadowOpacity: 0.06, shadowRadius: 4},
  row: {flexDirection: 'row', alignItems: 'center', paddingVertical: wp(6), paddingHorizontal: wp(10), gap: wp(8)},
  stepCol: {alignItems: 'center', width: wp(20)},
  dot: {width: wp(18), height: wp(18), borderRadius: wp(9), borderWidth: 2, justifyContent: 'center', alignItems: 'center', zIndex: 1},
  dotNum: {fontSize: ms(8), fontWeight: '800'},
  line: {width: 2, flex: 1, marginTop: -1, marginBottom: wp(-6)},
  iconWrap: {width: wp(26), height: wp(26), borderRadius: wp(7), justifyContent: 'center', alignItems: 'center'},
  label: {fontSize: ms(10), fontWeight: '700', letterSpacing: 0.2},
  value: {fontSize: ms(9), fontWeight: '600', marginTop: 1},
  editBtn: {width: wp(24), height: wp(24), borderRadius: wp(7), justifyContent: 'center', alignItems: 'center'},
});

// ─── COD PAYMENT TYPES ───
const PAYMENT_TYPES = [
  {key: 'prepaid_cc', label: 'PREPAID CREDIT CARD', icon: 'credit-card'},
  {key: 'cash', label: 'CASH', icon: 'payments'},
  {key: 'check', label: 'CHECK', icon: 'receipt-long'},
  {key: 'other', label: 'OTHER', icon: 'more-horiz'},
];

// ─── COD TAB ───
function CodTab() {
  const {c} = useTheme();
  const [paymentType, setPaymentType] = useState('');
  const [paymentModal, setPaymentModal] = useState(false);
  const [waitTime, setWaitTime] = useState(0);
  const [codNotes, setCodNotes] = useState('');
  const [codAmount, setCodAmount] = useState('');
  const [notesFocused, setNotesFocused] = useState(false);

  const scaleMinus = useRef(new Animated.Value(1)).current;
  const scalePlus = useRef(new Animated.Value(1)).current;
  const modalScale = useRef(new Animated.Value(0.9)).current;
  const modalOpacity = useRef(new Animated.Value(0)).current;

  const pulse = useCallback((anim: Animated.Value) => {
    Animated.sequence([
      Animated.timing(anim, {toValue: 0.85, duration: 80, useNativeDriver: true}),
      Animated.spring(anim, {toValue: 1, friction: 4, tension: 100, useNativeDriver: true}),
    ]).start();
  }, []);

  const openModal = useCallback(() => {
    setPaymentModal(true);
    modalScale.setValue(0.9);
    modalOpacity.setValue(0);
    Animated.parallel([
      Animated.spring(modalScale, {toValue: 1, friction: 8, tension: 80, useNativeDriver: true}),
      Animated.timing(modalOpacity, {toValue: 1, duration: 200, useNativeDriver: true}),
    ]).start();
  }, [modalScale, modalOpacity]);

  const closeModal = useCallback(() => {
    Animated.parallel([
      Animated.timing(modalScale, {toValue: 0.9, duration: 150, useNativeDriver: true}),
      Animated.timing(modalOpacity, {toValue: 0, duration: 150, useNativeDriver: true}),
    ]).start(() => setPaymentModal(false));
  }, [modalScale, modalOpacity]);

  const increment = () => {
    pulse(scalePlus);
    setWaitTime(prev => prev + 1);
  };

  const decrement = () => {
    pulse(scaleMinus);
    setWaitTime(prev => Math.max(0, prev - 1));
  };

  const selectedPayment = PAYMENT_TYPES.find(p => p.key === paymentType);

  const handleAmountChange = (text: string) => {
    let cleaned = text.replace(/[^0-9.]/g, '');
    const dotIndex = cleaned.indexOf('.');
    if (dotIndex !== -1) {
      cleaned = cleaned.substring(0, dotIndex + 1) + cleaned.substring(dotIndex + 1).replace(/\./g, '');
    }
    if (cleaned.startsWith('.')) {cleaned = '0' + cleaned;}
    const parts = cleaned.split('.');
    if (parts[1] && parts[1].length > 2) {
      cleaned = parts[0] + '.' + parts[1].substring(0, 2);
    }
    setCodAmount(cleaned);
  };

  return (
    <View style={[st.tabBody, {backgroundColor: c.surface}]}>
      <SaveButton />

      <CardsGrid>
      <FieldCard title="Payment Details" icon="payments">
      {/* Payment Type Selector */}
      <Field label="PAYMENT">
        <TouchableOpacity
          style={[cod.selectorBtn, common.selectorCompact, {
            backgroundColor: paymentType ? c.primarySurface : c.white,
            borderColor: paymentType ? c.primary : c.border,
          }]}
          activeOpacity={0.6}
          onPress={openModal}>
          {selectedPayment && (
            <View style={[cod.selectorIcon, {backgroundColor: paymentType ? c.primary : c.surface}]}>
              <MaterialIcons
                name={selectedPayment.icon as any}
                size={ms(16)}
                color={paymentType ? c.textOnPrimary : c.textMuted}
              />
            </View>
          )}
          <Text style={[cod.selectorText, {color: paymentType ? c.primary : c.textMuted}]} numberOfLines={1}>
            {selectedPayment?.label || 'Select Payment Type'}
          </Text>
          <MaterialIcons name="keyboard-arrow-down" size={ms(20)} color={paymentType ? c.primary : c.textMuted} />
        </TouchableOpacity>
      </Field>

      {/* COD Amount */}
      <Field label="AMOUNT">
        <View style={[cod.amountWrap, {
          backgroundColor: codAmount ? c.primarySurface : c.white,
          borderColor: codAmount ? c.primary : c.border,
        }]}>
          <Text style={[cod.amountCurrency, {color: codAmount ? c.primary : c.textMuted}]}>$</Text>
          <TextInput
            style={[cod.amountInput, {color: codAmount ? c.primary : c.textPrimary}]}
            value={codAmount}
            onChangeText={handleAmountChange}
            keyboardType="decimal-pad"
            maxLength={10}
            selectTextOnFocus
            placeholder="0.00"
            placeholderTextColor={c.textMuted}
          />
        </View>
      </Field>

      {/* Wait Time Stepper */}
      <Field label="WAIT TIME">
        <View style={st.stepperWrap}>
          <Animated.View style={{transform: [{scale: scaleMinus}]}}>
            <TouchableOpacity
              style={[st.stepBtn, st.stepBtnMinus, {
                backgroundColor: waitTime > 0 ? c.white : c.surface,
                borderColor: waitTime > 0 ? c.primary : c.border,
              }]}
              activeOpacity={0.7}
              onPress={decrement}>
              <MaterialIcons name="remove" size={ms(18)} color={waitTime > 0 ? c.primary : c.textMuted} />
            </TouchableOpacity>
          </Animated.View>
          <View style={[st.stepVal, {
            backgroundColor: waitTime > 0 ? c.primarySurface : c.white,
            borderColor: waitTime > 0 ? c.primary : c.border,
          }]}>
            <Text style={[st.stepValText, {color: waitTime > 0 ? c.primary : c.textPrimary}]}>{waitTime}</Text>
          </View>
          <Animated.View style={{transform: [{scale: scalePlus}]}}>
            <TouchableOpacity
              style={[st.stepBtn, st.stepBtnPlus, {backgroundColor: c.primary}]}
              activeOpacity={0.7}
              onPress={increment}>
              <MaterialIcons name="add" size={ms(18)} color={c.textOnPrimary} />
            </TouchableOpacity>
          </Animated.View>
          <View style={[st.unitBadge, {backgroundColor: c.surface, borderColor: c.border}]}>
            <Text style={[st.unitBadgeText, {color: c.textSecondary}]}>Min</Text>
          </View>
        </View>
      </Field>
      </FieldCard>

      <FieldCard fullWidth>
      {/* COD Notes */}
      <Field label="COD NOTES" wide>
        <TextInput
          style={[st.textArea, {
            borderColor: notesFocused ? c.primary : c.border,
            color: c.textPrimary,
            backgroundColor: c.white,
            borderWidth: notesFocused ? 2 : 1.5,
            minHeight: wp(60),
          }]}
          multiline
          numberOfLines={5}
          value={codNotes}
          onChangeText={setCodNotes}
          placeholderTextColor={c.textMuted}
          placeholder="Enter COD notes here..."
          onFocus={() => setNotesFocused(true)}
          onBlur={() => setNotesFocused(false)}
          textAlignVertical="top"
        />
      </Field>
      </FieldCard>
      </CardsGrid>

      {/* Payment Type Modal */}
      <ResponsiveModal
        visible={paymentModal}
        onClose={closeModal}
        maxWidth={420}
        maxHeightPercent={75}>
        {/* Modal Header */}
        <View style={[cod.modalHeader, {backgroundColor: c.primarySurface, borderBottomColor: c.border}]}>
          <View style={[cod.modalHeaderIcon, {backgroundColor: c.primary}]}>
            <MaterialIcons name="payments" size={ms(20)} color={c.textOnPrimary} />
          </View>
          <View style={common.flex1}>
            <Text style={[cod.modalTitle, {color: c.textPrimary}]}>Payment Type</Text>
            <Text style={[cod.modalSubtitle, {color: c.textMuted}]}>Select a payment method</Text>
          </View>
          <TouchableOpacity style={[cod.modalCloseBtn, {backgroundColor: c.white}]} onPress={closeModal} activeOpacity={0.7} hitSlop={{top: 8, bottom: 8, left: 8, right: 8}}>
            <MaterialIcons name="close" size={ms(20)} color={c.textSecondary} />
          </TouchableOpacity>
        </View>

        {/* Modal Options */}
        <ScrollView bounces={false} showsVerticalScrollIndicator={false} contentContainerStyle={cod.modalBody}>
          {PAYMENT_TYPES.map((opt, i) => {
            const isSelected = opt.key === paymentType;
            return (
              <TouchableOpacity
                key={opt.key}
                style={[
                  cod.modalItem,
                  {borderColor: 'transparent', borderWidth: 1.5},
                  isSelected && {backgroundColor: c.primarySurface, borderColor: c.primary},
                ]}
                activeOpacity={0.6}
                onPress={() => {
                  setPaymentType(opt.key);
                  closeModal();
                }}>
                <View style={[cod.modalItemIcon, {
                  backgroundColor: isSelected ? c.primary : c.surface,
                }]}>
                  <MaterialIcons
                    name={opt.icon as any}
                    size={ms(20)}
                    color={isSelected ? c.textOnPrimary : c.textSecondary}
                  />
                </View>
                <Text style={[
                  cod.modalItemText,
                  {color: c.textPrimary},
                  isSelected && {color: c.primary, fontWeight: '800'},
                ]}>
                  {opt.label}
                </Text>
                {isSelected ? (
                  <MaterialIcons name="check-circle" size={ms(22)} color={c.primary} />
                ) : (
                  <View style={[cod.modalItemCircle, {borderColor: c.border}]} />
                )}
              </TouchableOpacity>
            );
          })}
        </ScrollView>
      </ResponsiveModal>
    </View>
  );
}

const cod = StyleSheet.create({
  selectorBtn: {flexDirection: 'row', alignItems: 'center', flex: 1, height: wp(30), paddingHorizontal: wp(8), borderRadius: wp(7), borderWidth: 1.5, gap: wp(4)},
  selectorIcon: {width: wp(20), height: wp(20), borderRadius: wp(6), justifyContent: 'center', alignItems: 'center'},
  selectorText: {fontSize: ms(11), fontWeight: '700', flex: 1},
  amountWrap: {flexDirection: 'row', alignItems: 'center', minWidth: wp(80), maxWidth: wp(130), height: wp(30), borderRadius: wp(7), borderWidth: 1.5, paddingHorizontal: wp(8)},
  amountCurrency: {fontSize: ms(13), fontWeight: '800', marginRight: wp(2)},
  amountInput: {flex: 1, fontSize: ms(13), fontWeight: '800', padding: 0, textAlign: 'left'},
  modalHeader: {flexDirection: 'row', alignItems: 'center', gap: wp(8), paddingHorizontal: wp(12), paddingVertical: wp(8), borderBottomWidth: 1},
  modalHeaderIcon: {width: wp(28), height: wp(28), borderRadius: wp(8), justifyContent: 'center', alignItems: 'center'},
  modalTitle: {fontSize: ms(14), fontWeight: '900', letterSpacing: 0.3},
  modalSubtitle: {fontSize: ms(10), fontWeight: '500', marginTop: 1},
  modalCloseBtn: {width: wp(30), height: wp(30), borderRadius: wp(15), justifyContent: 'center', alignItems: 'center', elevation: 2, shadowColor: Colors.shadowColor, shadowOffset: {width: 0, height: 1}, shadowOpacity: 0.1, shadowRadius: 3},
  modalBody: {paddingHorizontal: wp(10), paddingTop: wp(6), paddingBottom: wp(8)},
  modalItem: {flexDirection: 'row', alignItems: 'center', paddingVertical: wp(7), paddingHorizontal: wp(8), borderRadius: wp(8), marginVertical: 2, gap: wp(8), minHeight: wp(36)},
  modalItemIcon: {width: wp(28), height: wp(28), borderRadius: wp(8), justifyContent: 'center', alignItems: 'center'},
  modalItemText: {fontSize: ms(12), fontWeight: '700', flex: 1, letterSpacing: 0.2},
  modalItemCircle: {width: wp(18), height: wp(18), borderRadius: wp(9), borderWidth: 2},
});

// ─── MAIN SCREEN ───
export default function NotesScreen({navigation}: Props) {
  const [activeTab, setActiveTab] = useState(0);
  const {c} = useTheme();
  const insets = useSafeAreaInsets();
  const {width, height: winHeight} = useWindowDimensions();
  const isTablet = Math.min(width, winHeight) > 600;
  const isLandscape = width > winHeight;
  const slideAnim = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    slideAnim.setValue(20);
    Animated.spring(slideAnim, {toValue: 0, friction: 8, tension: 60, useNativeDriver: true}).start();
  }, [activeTab, slideAnim]);

  const renderTab = () => {
    switch (activeTab) {
      case 0: return <PlantTab />;
      case 1: return <JobsiteTab />;
      case 2: return <ReturnedTab />;
      case 3: return <TimeAdjustTab />;
      case 4: return <CodTab />;
      default: return <PlantTab />;
    }
  };

  return (
    <View style={[st.container, {backgroundColor: c.primaryDark}]}>
      <StatusBar translucent backgroundColor="transparent" barStyle="light-content" />

      <View style={[st.header, {paddingTop: insets.top + wp(1), paddingLeft: Math.max(wp(12), insets.left), paddingRight: Math.max(wp(12), insets.right)}]}>
        <View style={st.headerRow}>
          <View>
            <Text style={[st.headerTitle, {color: c.textOnPrimary}]}>ORDER 2605 / TICKET 26209538</Text>
            <Text style={[st.headerSub, {color: c.textOnDark60}]}>Delivery Notes & Records</Text>
          </View>
          <TouchableOpacity
            style={[st.closeBtn, {backgroundColor: c.overlay10}]}
            onPress={() => navigation.goBack()}
            activeOpacity={0.7}>
            <MaterialIcons name="close" size={ms(20)} color={c.textOnPrimary} />
          </TouchableOpacity>
        </View>

        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={st.tabsRow}>
          {TABS.map((tab, i) => {
            const active = activeTab === i;
            return (
              <TouchableOpacity
                key={tab.key}
                style={[st.tab, active ? {backgroundColor: c.primary, borderColor: c.primary} : {backgroundColor: c.overlay06, borderColor: c.overlay15}]}
                activeOpacity={0.7}
                onPress={() => setActiveTab(i)}>
                <View style={[st.tabIconWrap, {backgroundColor: active ? c.overlay20 : c.overlay08}]}>
                  <MaterialIcons name={tab.icon as any} size={ms(14)} color={active ? c.textOnPrimary : c.textOnDark60} />
                </View>
                <Text style={[st.tabLabel, {color: active ? c.textOnPrimary : c.textOnDark60}]}>
                  {tab.label}
                </Text>
              </TouchableOpacity>
            );
          })}
        </ScrollView>
      </View>

      <KeyboardAvoidingView
        style={st.flex1}
        behavior="padding"
        keyboardVerticalOffset={Platform.OS === 'ios' ? 0 : 20}>
        <Animated.View style={[st.content, {backgroundColor: c.background, transform: [{translateY: slideAnim}]}]}>
          <ScrollView style={st.scroll} showsVerticalScrollIndicator={false} contentContainerStyle={[st.scrollInner, {paddingLeft: insets.left, paddingRight: insets.right}]} keyboardShouldPersistTaps="handled">
            {renderTab()}
          </ScrollView>
        </Animated.View>
      </KeyboardAvoidingView>
    </View>
  );
}

const st = StyleSheet.create({
  container: {flex: 1},
  flex1: {flex: 1},

  // Header
  header: {paddingBottom: wp(3)},
  headerRow: {flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: wp(3)},
  headerTitle: {color: Colors.textOnPrimary, fontSize: ms(13), fontWeight: '800', letterSpacing: 0.3},
  headerSub: {fontSize: ms(9), fontWeight: '500', marginTop: 0},
  closeBtn: {width: wp(30), height: wp(30), borderRadius: wp(15), justifyContent: 'center', alignItems: 'center'},

  // Tabs
  tabsRow: {flexDirection: 'row', gap: wp(5), paddingVertical: wp(1), paddingRight: wp(5)},
  tab: {flexDirection: 'row', alignItems: 'center', gap: wp(4), paddingVertical: wp(4), paddingHorizontal: wp(10), borderRadius: wp(8), borderWidth: 1},
  tabIconWrap: {width: wp(20), height: wp(20), borderRadius: wp(6), justifyContent: 'center', alignItems: 'center'},
  tabLabel: {fontSize: ms(10), fontWeight: '700', letterSpacing: 0.2},

  // Content
  content: {flex: 1, borderTopLeftRadius: wp(16), borderTopRightRadius: wp(16), overflow: 'hidden'},
  scroll: {flex: 1},
  scrollInner: {paddingBottom: wp(20), flexGrow: 1},

  // Tab body
  tabBody: {paddingHorizontal: wp(8), paddingTop: wp(8), paddingBottom: wp(10), flex: 1},

  // Cards grid
  cardsGridNarrow: {gap: wp(10)},
  cardsGridWide: {flexDirection: 'row', flexWrap: 'wrap', gap: wp(10), alignItems: 'stretch'},

  // Field card
  fieldCard: {borderRadius: wp(10), paddingHorizontal: wp(10), paddingTop: wp(2), paddingBottom: wp(2), borderWidth: 1, width: '100%'},
  fieldCardHalf: {flexGrow: 1, flexShrink: 1, flexBasis: '47%', width: undefined},
  fieldCardHeader: {flexDirection: 'row', alignItems: 'center', gap: wp(4), paddingVertical: wp(5)},
  fieldCardTitle: {fontSize: ms(10), fontWeight: '800', letterSpacing: 0.3},

  // Save
  saveBtn: {flexDirection: 'row', alignItems: 'center', gap: wp(5), paddingHorizontal: wp(12), paddingVertical: wp(5), borderRadius: wp(8), elevation: 3, shadowColor: Colors.shadowColor, shadowOffset: {width: 0, height: 2}, shadowOpacity: 0.15, shadowRadius: 6},
  saveBtnText: {fontSize: ms(10), fontWeight: '700'},

  // Field
  field: {flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', paddingVertical: wp(5), gap: wp(4), borderBottomWidth: 0.5},
  fieldLast: {borderBottomWidth: 0},
  fieldWide: {flexDirection: 'column', alignItems: 'flex-start'},
  fieldLabel: {fontSize: ms(10), fontWeight: '800', minWidth: wp(70), maxWidth: wp(120), letterSpacing: 0.2},
  fieldLabelWide: {width: '100%', marginBottom: wp(3)},
  fieldBody: {flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: wp(4), flex: 1},

  // Compact field (label-above for FieldRow)
  fieldCompact: {paddingVertical: wp(5), gap: wp(3), flex: 1, borderBottomWidth: 0},
  fieldCompactLabel: {fontSize: ms(8.5), fontWeight: '700', textTransform: 'uppercase', letterSpacing: 0.3},
  fieldCompactBody: {flexDirection: 'row', alignItems: 'center', gap: wp(4)},

  // Field row
  fieldRow: {flexDirection: 'row', gap: wp(8), borderBottomWidth: 0.5},

  // Stepper
  stepperWrap: {flexDirection: 'row', alignItems: 'center', gap: wp(1)},
  stepBtn: {width: wp(26), height: wp(26), borderRadius: wp(7), justifyContent: 'center', alignItems: 'center'},
  stepBtnMinus: {borderWidth: 1},
  stepBtnPlus: {},
  stepVal: {width: wp(40), height: wp(26), justifyContent: 'center', alignItems: 'center', borderWidth: 1, borderRadius: wp(6), marginHorizontal: wp(1)},
  stepValText: {fontSize: ms(11), fontWeight: '700'},
  unitInline: {fontSize: ms(10), fontWeight: '600', marginLeft: wp(3)},
  unitBadge: {marginLeft: wp(5), paddingHorizontal: wp(7), paddingVertical: wp(3), borderRadius: wp(7), borderWidth: 1},
  unitBadgeText: {fontSize: ms(10), fontWeight: '700'},

  // More
  moreBtn: {width: wp(26), height: wp(26), borderRadius: wp(13), justifyContent: 'center', alignItems: 'center'},

  // Highlighted input
  hlInput: {minWidth: wp(55), maxWidth: wp(100), height: wp(28), justifyContent: 'center', alignItems: 'center', borderRadius: wp(7), borderWidth: 1.5},
  hlInputText: {fontSize: ms(13), fontWeight: '800'},

  // Gray input
  grayInput: {minWidth: wp(90), maxWidth: wp(150), height: wp(32), borderRadius: wp(8), borderWidth: 1, justifyContent: 'center', paddingHorizontal: wp(8)},
  grayPlaceholder: {fontSize: ms(11), fontWeight: '500'},

  // Line input
  lineInput: {borderBottomWidth: 1.5, minHeight: wp(28), fontSize: ms(11), paddingVertical: wp(3)},
  lineInputText: {fontSize: ms(11), fontWeight: '500'},

  // Checkbox
  checkTap: {flexDirection: 'row', alignItems: 'center', gap: wp(4), paddingVertical: wp(1), paddingRight: wp(4)},
  checkBox: {width: wp(18), height: wp(18), borderWidth: 2, borderRadius: wp(5), justifyContent: 'center', alignItems: 'center'},
  checkLabel: {fontSize: ms(10), fontWeight: '600'},

  // Radio
  radioRow: {flexDirection: 'row', alignItems: 'center', gap: wp(2)},
  radioTap: {flexDirection: 'row', alignItems: 'center', gap: wp(4), paddingVertical: wp(2), paddingHorizontal: wp(4), borderRadius: wp(6)},
  radioCircle: {width: wp(16), height: wp(16), borderRadius: wp(8), borderWidth: 2, justifyContent: 'center', alignItems: 'center'},
  radioDot: {width: wp(7), height: wp(7), borderRadius: wp(4)},
  radioLabel: {fontSize: ms(11), fontWeight: '600'},

  // Text area
  textArea: {borderRadius: wp(8), padding: wp(8), fontSize: ms(12), minHeight: wp(60), textAlignVertical: 'top', width: '100%', lineHeight: ms(18)},

  // Link
  linkText: {fontSize: ms(10), fontWeight: '700', textDecorationLine: 'underline'},

  // Inline
  inlineLabel: {fontSize: ms(9), fontWeight: '800'},

  // Time picker
  timePick: {flexDirection: 'row', alignItems: 'center', gap: wp(3), paddingHorizontal: wp(6), paddingVertical: wp(4), borderRadius: wp(7), borderWidth: 1},
  timePickIcon: {width: wp(18), height: wp(18), borderRadius: wp(5), justifyContent: 'center', alignItems: 'center'},
  timePickText: {fontSize: ms(10), fontWeight: '600'},

  // Sub headers
  subHeaderRow: {flexDirection: 'row', gap: wp(6), marginBottom: wp(6)},
  subHeaderPill: {paddingHorizontal: wp(8), paddingVertical: wp(3), borderRadius: wp(6), borderWidth: 1},
  subHeaderText: {fontSize: ms(10), fontWeight: '600'},

  // Section title
  secTitle: {flexDirection: 'row', alignItems: 'center', gap: wp(6), borderBottomWidth: 1, paddingBottom: wp(6), marginBottom: wp(6), marginTop: wp(8)},
  secTitleText: {fontSize: ms(11), fontWeight: '800', letterSpacing: 0.3},

  // Popups
  popupOverlay: {flex: 1, backgroundColor: Colors.overlayModal, justifyContent: 'center', alignItems: 'center'},
  popupHeader: {flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: wp(10), paddingVertical: wp(5), borderBottomWidth: 1},
  popupTitle: {fontSize: ms(14), fontWeight: '900', letterSpacing: 0.3},
  popupCloseBtn: {width: wp(28), height: wp(28), borderRadius: wp(14), justifyContent: 'center', alignItems: 'center'},
  popupScroll: {paddingHorizontal: wp(8)},
  popupItem: {flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingVertical: wp(16), paddingHorizontal: wp(14), borderBottomWidth: 0.5, borderRadius: wp(8), marginVertical: 2, minHeight: wp(52)},
  popupItemText: {fontSize: ms(15), fontWeight: '600', flex: 1},

  // Selector
  selectorBtn: {flexDirection: 'row', alignItems: 'center', flex: 1, height: wp(30), paddingHorizontal: wp(8), borderRadius: wp(7), borderWidth: 1.5, gap: wp(4)},
  selectorText: {fontSize: ms(11), fontWeight: '600', flex: 1},

  // Numeric input
  numericInput: {minWidth: wp(65), maxWidth: wp(110), height: wp(30), borderRadius: wp(7), borderWidth: 1.5, justifyContent: 'center', paddingHorizontal: wp(8)},
  numericInputText: {fontSize: ms(14), fontWeight: '800', textAlign: 'center', padding: 0},

  // Modal text
  modalOptionText: {fontSize: ms(13), fontWeight: '800'},
  modalCloseText: {fontSize: ms(13), fontWeight: '700'},

  // Table
  tableHeader: {flexDirection: 'row', marginBottom: wp(12)},
  tableCellCode: {width: wp(80), fontSize: ms(13)},
  tableCellDesc: {flex: 1, fontSize: ms(13)},
  tableCellQty: {width: wp(50), fontSize: ms(13), textAlign: 'right'},
  tableCellUnit: {width: wp(45), fontSize: ms(13), textAlign: 'right'},
});
