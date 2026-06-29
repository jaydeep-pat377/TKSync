import React, {useState, useRef, useEffect, useCallback, createContext, useContext} from 'react';
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
  LayoutAnimation,
  UIManager,
  ActivityIndicator,
} from 'react-native';

if (Platform.OS === 'android' && UIManager.setLayoutAnimationEnabledExperimental) {
  UIManager.setLayoutAnimationEnabledExperimental(true);
}
import {useSafeAreaInsets} from 'react-native-safe-area-context';
import MaterialIcons from 'react-native-vector-icons/MaterialIcons';
import type {NativeStackNavigationProp} from '@react-navigation/native-stack';
import type {RouteProp} from '@react-navigation/native';
import {useTheme} from '../contexts/ThemeContext';
import {Colors} from '../constants/colors';
import {common} from '../constants/commonStyles';
import DateTimePicker from '../components/DateTimePicker';
import ResponsiveModal from '../components/ResponsiveModal';
import {wp, ms} from '../utils/responsive';
import {ticketsApi, type DeliveryRecord} from '../services/api';
import {useOfflineSync} from '../contexts/OfflineSyncContext';
import {offlineStorage} from '../services/offlineStorage';
import {setForceOffline, getForceOffline} from '../hooks/useNetworkStatus';
import {getFontScale, useFontScaleRefresh} from '../contexts/FontSizeContext';
import VoiceFormWizard, {type VoiceField, type VoiceResults} from '../components/VoiceFormWizard';

type Props = {
  navigation: NativeStackNavigationProp<any>;
  route: RouteProp<any>;
};

function formatPickerTime(date: Date | undefined): string {
  if (!date) return '';
  const Y = date.getFullYear();
  const M = (date.getMonth() + 1).toString().padStart(2, '0');
  const D = date.getDate().toString().padStart(2, '0');
  const h = date.getHours().toString().padStart(2, '0');
  const m = date.getMinutes().toString().padStart(2, '0');
  const s = date.getSeconds().toString().padStart(2, '0');
  return `${h}:${m}`;
}

const TABS = [
  {key: 'plant', label: 'Plant', icon: 'factory'},
  {key: 'jobsite', label: 'Jobsite', icon: 'location-on'},
  {key: 'returned', label: 'Returned', icon: 'undo'},
  {key: 'time', label: 'Time', icon: 'schedule'},
  {key: 'cod', label: 'COD', icon: 'payments'},
];

// ─── SHARED COMPONENTS ───

function Stepper({value, unit, highlight, onChangeValue, pickerValues}: {value: string; unit: string; highlight?: boolean; onIncrement?: () => void; onDecrement?: () => void; onChangeValue?: (val: string) => void; pickerValues?: string[]}) {
  const {c} = useTheme();
  const isMandatory = useMandatory();
  const isHL = highlight || isMandatory;
  const {width: _sw, height: _sh} = useWindowDimensions();
  const _land = _sw > _sh;
  const [pickerOpen, setPickerOpen] = useState(false);
  const defaults = pickerValues || ['0','5','10','15','20','25','30','40','50','60','70','80','90','100'];
  return (
    <View style={[st.stepperWrap, _land && {gap: wp(2)}]}>
      <View style={[st.numInput, _land && {minWidth: wp(32), height: wp(22), borderRadius: wp(5), paddingHorizontal: wp(4)}, {backgroundColor: isHL ? c.highlight : c.surface, borderColor: isHL ? c.primaryBorder : 'transparent'}]}>
        {onChangeValue ? (
          <TextInput
            style={[st.numInputText, _land && {fontSize: ms(9), minWidth: wp(16)}, {color: c.textPrimary}]}
            value={value === '0' ? '' : value}
            placeholder="0"
            placeholderTextColor={c.textMuted}
            keyboardType="number-pad"
            onChangeText={text => onChangeValue(text.replace(/[^0-9]/g, ''))}
          />
        ) : (
          <Text style={[st.numInputText, _land && {fontSize: ms(9), minWidth: wp(16)}, {color: c.textPrimary}]}>{value || '0'}</Text>
        )}
      </View>
      <TouchableOpacity style={[st.pickerToggle, _land && {width: wp(18), height: wp(18), borderRadius: wp(5)}, {backgroundColor: c.surface, borderColor: c.border}]} activeOpacity={0.7} onPress={() => setPickerOpen(true)}>
        <MaterialIcons name="unfold-more" size={_land ? ms(9) : ms(11)} color={c.textSecondary} />
      </TouchableOpacity>
      {unit ? (
        <View style={[st.unitBadge, _land && {marginLeft: wp(1), paddingHorizontal: wp(3), paddingVertical: wp(1), borderRadius: wp(4)}, {backgroundColor: c.surface, borderColor: c.border}]}>
          <Text style={[st.unitBadgeText, _land && {fontSize: ms(8)}, {color: c.textSecondary}]}>{unit}</Text>
        </View>
      ) : null}
      <ResponsiveModal visible={pickerOpen} onClose={() => setPickerOpen(false)} maxWidth={320} maxHeightPercent={50}>
        <View style={[st.pickerHeader, {borderBottomColor: c.border}]}>
          <Text style={[st.pickerTitle, {color: c.textPrimary}]}>Select Value</Text>
          <TouchableOpacity style={[st.pickerCloseBtn, {backgroundColor: c.surface}]} onPress={() => setPickerOpen(false)} activeOpacity={0.7}>
            <MaterialIcons name="close" size={ms(18)} color={c.textSecondary} />
          </TouchableOpacity>
        </View>
        <ScrollView showsVerticalScrollIndicator={false} bounces={false} contentContainerStyle={st.pickerList}>
          {defaults.map(v => {
            const isSelected = v === value;
            return (
              <TouchableOpacity key={v} style={[st.pickerItem, {borderBottomColor: c.borderLight}, isSelected && {backgroundColor: c.primarySurface}]} activeOpacity={0.6} onPress={() => { onChangeValue?.(v); setPickerOpen(false); }}>
                <Text style={[st.pickerItemText, {color: isSelected ? c.primary : c.textPrimary}, isSelected && {fontWeight: '800'}]}>{v}{unit ? ` ${unit}` : ''}</Text>
                {isSelected && <MaterialIcons name="check-circle" size={ms(16)} color={c.primary} />}
              </TouchableOpacity>
            );
          })}
        </ScrollView>
      </ResponsiveModal>
    </View>
  );
}

const MandatoryCtx = createContext(false);
const useMandatory = () => useContext(MandatoryCtx);

function Field({label, children, wide, compact, last, mandatory}: {label: string; children: React.ReactNode; wide?: boolean; compact?: boolean; last?: boolean; mandatory?: boolean}) {
  const {c} = useTheme();
  const content = mandatory ? <MandatoryCtx.Provider value={true}>{children}</MandatoryCtx.Provider> : children;
  if (compact) {
    return (
      <View style={[st.fieldCompact, {borderBottomColor: c.borderLight}]}>
        <Text style={[st.fieldCompactLabel, {color: c.textMuted}]}>{label}</Text>
        <View style={st.fieldCompactBody}>{content}</View>
      </View>
    );
  }
  return (
    <View style={[st.field, {borderBottomColor: c.borderLight}, wide && st.fieldWide, last && {borderBottomWidth: 0}]}>
      <Text style={[st.fieldLabel, {color: c.textPrimary}, wide && st.fieldLabelWide]} numberOfLines={1}>{label}</Text>
      <View style={st.fieldBody}>{content}</View>
    </View>
  );
}

function FieldRow({children}: {children: React.ReactNode}) {
  return <View style={st.fieldRow}>{children}</View>;
}

function CardsGrid({children}: {children: React.ReactNode}) {
  const {width: sw, height: sh} = useWindowDimensions();
  const isWide = sw > 600 && sw > sh;
  return (
    <View style={isWide ? st.cardsGridWide : st.cardsGridNarrow}>
      {children}
    </View>
  );
}

function FieldCard({children, title, icon, fullWidth}: {children: React.ReactNode; title?: string; icon?: string; fullWidth?: boolean}) {
  const {c} = useTheme();
  const {width: sw, height: sh} = useWindowDimensions();
  const isWide = sw > 600 && sw > sh;
  return (
    <View style={[
      st.fieldCard,
      {backgroundColor: c.white},
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
      <MaterialIcons name="more-horiz" size={ms(12)} color={c.primary} />
    </TouchableOpacity>
  );
}

function Check({checked, label, onPress}: {checked: boolean; label?: string; onPress?: () => void}) {
  const {c} = useTheme();
  const isMandatory = useMandatory();
  const {width: _cw, height: _ch} = useWindowDimensions();
  const _land = _cw > _ch;
  const scale = useRef(new Animated.Value(1)).current;
  const tap = () => {
    Animated.sequence([
      Animated.timing(scale, {toValue: 0.8, duration: 60, useNativeDriver: true}),
      Animated.spring(scale, {toValue: 1, friction: 4, tension: 120, useNativeDriver: true}),
    ]).start();
    onPress?.();
  };
  return (
    <TouchableOpacity style={[st.checkTap, _land && {gap: wp(5), paddingRight: wp(2)}, isMandatory && !checked && {backgroundColor: '#FFFF00', borderRadius: 6, paddingHorizontal: 4}]} activeOpacity={0.7} onPress={tap}>
      <Animated.View style={[
        st.checkBox,
        _land && {width: wp(12), height: wp(12), borderRadius: wp(3), borderWidth: 1},
        {borderColor: checked ? c.primary : isMandatory ? '#CCCC00' : c.border, backgroundColor: checked ? c.primary : isMandatory ? '#FFFF00' : c.white},
        {transform: [{scale}]},
      ]}>
        {checked && <MaterialIcons name="check" size={_land ? ms(8) : ms(11)} color={c.textOnPrimary} />}
      </Animated.View>
      {label && <Text style={[st.checkLabel, {color: c.textPrimary}, _land && {fontSize: ms(11)}]}>{label}</Text>}
    </TouchableOpacity>
  );
}

function Radio({selected, label, onPress}: {selected: boolean; label: string; onPress?: () => void}) {
  const {c} = useTheme();
  const {width: _rw, height: _rh} = useWindowDimensions();
  const _land = _rw > _rh;
  return (
    <TouchableOpacity style={[st.radioTap, _land && {gap: wp(3), paddingVertical: 0, paddingHorizontal: wp(2)}]} activeOpacity={0.7} onPress={onPress}>
      <View style={[st.radioCircle, _land && {width: wp(12), height: wp(12), borderRadius: wp(6), borderWidth: 1.5}, {borderColor: selected ? c.primary : c.border}]}>
        {selected && <View style={[st.radioDot, _land && {width: wp(6), height: wp(6), borderRadius: wp(3)}, {backgroundColor: c.primary}]} />}
      </View>
      <Text style={[st.radioLabel, {color: selected ? c.primary : c.textPrimary}, _land && {fontSize: ms(11)}]}>{label}</Text>
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
  const isMandatory = useMandatory();
  const sizeStyle = w ? {width: wp(w)} : {flex: 1};
  const hlStyle = isMandatory ? {backgroundColor: '#FFFF00', borderRadius: wp(4)} : undefined;
  // Read-only dropdown trigger: use Text so selected value is always visible
  if (onPress && !onChangeText) {
    return (
      <TouchableOpacity activeOpacity={0.7} onPress={onPress} style={[st.lineInput, {borderBottomColor: c.border, justifyContent: 'center'}, sizeStyle, hlStyle]}>
        <Text style={[st.lineInputText, {color: value ? c.textPrimary : c.textMuted}]} numberOfLines={1}>
          {value || placeholder || ''}
        </Text>
      </TouchableOpacity>
    );
  }
  return (
    <TextInput
      style={[st.lineInput, {borderBottomColor: c.border, color: c.textPrimary}, sizeStyle, hlStyle]}
      placeholderTextColor={c.textMuted}
      placeholder={placeholder || ''}
      value={value}
      editable={editable !== false}
      keyboardType={keyboardType}
      onChangeText={onChangeText}
    />
  );
}

function SaveResultModal({visible, success, message, onClose}: {visible: boolean; success: boolean; message: string; onClose: () => void}) {
  const {c} = useTheme();
  const scaleAnim = useRef(new Animated.Value(0.8)).current;
  const opacityAnim = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    if (visible) {
      scaleAnim.setValue(0.8);
      opacityAnim.setValue(0);
      Animated.parallel([
        Animated.spring(scaleAnim, {toValue: 1, friction: 6, tension: 80, useNativeDriver: true}),
        Animated.timing(opacityAnim, {toValue: 1, duration: 200, useNativeDriver: true}),
      ]).start();
    }
  }, [visible, scaleAnim, opacityAnim]);

  return (
    <ResponsiveModal visible={visible} onClose={onClose} maxWidth={340} maxHeightPercent={50}>
      <View style={{alignItems: 'center', paddingVertical: wp(24), paddingHorizontal: wp(20)}}>
        <Animated.View style={{transform: [{scale: scaleAnim}], opacity: opacityAnim}}>
          <View style={{
            width: wp(52), height: wp(52), borderRadius: wp(26),
            backgroundColor: success ? c.successSurface || (c.success + '20') : (c.error + '20'),
            justifyContent: 'center', alignItems: 'center', marginBottom: wp(14),
          }}>
            <MaterialIcons
              name={success ? 'check-circle' : 'error'}
              size={ms(28)}
              color={success ? c.success : c.error}
            />
          </View>
        </Animated.View>
        <Text style={{fontSize: ms(16), fontWeight: '800', color: c.textPrimary, marginBottom: wp(6), textAlign: 'center'}}>
          {success ? 'Saved Successfully' : 'Save Failed'}
        </Text>
        <Text style={{fontSize: ms(12), fontWeight: '500', color: c.textSecondary, textAlign: 'center', lineHeight: ms(18)}}>
          {message}
        </Text>
        <TouchableOpacity
          style={{
            marginTop: wp(18),
            backgroundColor: success ? c.primary : c.error,
            paddingVertical: wp(10),
            paddingHorizontal: wp(30),
            borderRadius: wp(10),
            flexDirection: 'row',
            alignItems: 'center',
            gap: wp(6),
          }}
          activeOpacity={0.8}
          onPress={onClose}>
          <MaterialIcons name={success ? 'done' : 'close'} size={ms(16)} color={c.textOnPrimary} />
          <Text style={{fontSize: ms(13), fontWeight: '700', color: c.textOnPrimary}}>
            {success ? 'Done' : 'Dismiss'}
          </Text>
        </TouchableOpacity>
      </View>
    </ResponsiveModal>
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
  const isMandatory = useMandatory();
  const hasValue = !!value;
  const displayText = hasValue ? formatPickerTime(value) : (label || 'Select Time');
  return (
    <TouchableOpacity
      style={[
        st.timePick,
        {
          backgroundColor: isMandatory && !hasValue ? '#FFFF00' : hasValue ? c.primarySurface : c.white,
          borderColor: isMandatory && !hasValue ? '#CCCC00' : hasValue ? c.primary : c.border,
        },
      ]}
      activeOpacity={0.6}
      onPress={onPress}>
      <View style={[st.timePickIcon, {backgroundColor: hasValue ? c.primary : c.primarySurface}]}>
        <MaterialIcons name="schedule" size={ms(12)} color={hasValue ? c.textOnPrimary : c.primary} />
      </View>
      <Text style={[st.timePickText, {color: hasValue ? c.primary : c.textMuted}]}>{displayText}</Text>
      <MaterialIcons name="keyboard-arrow-down" size={ms(14)} color={hasValue ? c.primary : c.textMuted} />
    </TouchableOpacity>
  );
}

function NoteInput({placeholder, borderColor, bgColor, textColor, value, onChangeText}: any) {
  const {c} = useTheme();
  const isMandatory = useMandatory();
  const [focused, setFocused] = useState(false);
  return (
    <TextInput
      style={[
        st.textArea,
        {
          borderColor: focused ? c.primary : isMandatory ? '#CCCC00' : (borderColor || c.border),
          color: textColor || c.textPrimary,
          backgroundColor: isMandatory ? '#FFFF00' : (bgColor || c.white),
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

// ─── STYLE REFRESH (font scale) ───
let ls = _createLs();
let slumpSt = _createSlumpSt();
let sm = _createSm();
let tt = _createTt();
let cod = _createCod();
let st = _createSt();
let _cachedFontScale = getFontScale();
function refreshStylesIfNeeded() {
  const current = getFontScale();
  if (current === _cachedFontScale) return;
  _cachedFontScale = current;
  ls = _createLs();
  slumpSt = _createSlumpSt();
  sm = _createSm();
  tt = _createTt();
  cod = _createCod();
  st = _createSt();
}

// ─── LANDSCAPE LAYOUT COMPONENTS ───
function _createLs() { return StyleSheet.create({
  root: {flex: 1, paddingHorizontal: wp(10), paddingTop: wp(4), paddingBottom: wp(4)},
  topBar: {flexDirection: 'row', justifyContent: 'flex-end', marginBottom: wp(4)},
  columns: {flex: 1, flexDirection: 'row', gap: wp(10), alignItems: 'flex-start'},
  card: {flexGrow: 1, flexShrink: 1, flexBasis: 0, alignSelf: 'stretch', borderRadius: wp(10), paddingHorizontal: wp(14), paddingTop: wp(8), paddingBottom: wp(14), borderWidth: StyleSheet.hairlineWidth},
  cardHeader: {flexDirection: 'row', alignItems: 'center', gap: wp(6), paddingBottom: wp(7), marginBottom: wp(5), borderBottomWidth: StyleSheet.hairlineWidth},
  cardHeaderIcon: {width: wp(22), height: wp(22), borderRadius: wp(7), justifyContent: 'center', alignItems: 'center'},
  cardTitle: {fontSize: ms(10), fontWeight: '900', letterSpacing: 0.5, textTransform: 'uppercase', flex: 1},
  field: {flexDirection: 'row', alignItems: 'center', paddingVertical: wp(5), gap: wp(5), borderBottomWidth: StyleSheet.hairlineWidth},
  fieldLabel: {fontSize: ms(10), fontWeight: '700', minWidth: wp(40), maxWidth: wp(120), letterSpacing: 0.3},
  fieldBody: {flexDirection: 'row', alignItems: 'center', gap: wp(5), flex: 1, flexShrink: 1},
  fieldWide: {flexDirection: 'column' as const, alignItems: 'flex-start' as const},
  fieldLabelWide: {width: '100%' as const, marginBottom: wp(10)},
  fieldCompact: {paddingVertical: 0, gap: 0, flex: 1, borderBottomWidth: 0},
  fieldCompactLabel: {fontSize: ms(9), fontWeight: '700', letterSpacing: 0.3, marginBottom: 0},
  fieldCompactBody: {flexDirection: 'row', alignItems: 'center', gap: wp(5), paddingVertical: wp(4)},
  fieldRow: {flexDirection: 'row', gap: wp(10), borderBottomWidth: StyleSheet.hairlineWidth},
  notesInput: {flex: 1, borderRadius: wp(8), padding: wp(10), fontSize: ms(12), textAlignVertical: 'top', width: '100%', lineHeight: ms(18), borderWidth: 1},
  notesSection: {borderTopWidth: StyleSheet.hairlineWidth, marginTop: wp(4), paddingTop: wp(6), flex: 1, gap: wp(4)},
  notesSectionLabel: {fontSize: ms(9), fontWeight: '700', textTransform: 'uppercase', letterSpacing: 0.4},
  sectionDivider: {borderTopWidth: StyleSheet.hairlineWidth, marginTop: wp(5), paddingTop: wp(7)},
  sectionLabel: {fontSize: ms(9), fontWeight: '700', textTransform: 'uppercase', letterSpacing: 0.4, marginBottom: wp(4)},
  saveBtn: {flexDirection: 'row', alignItems: 'center', gap: wp(6), paddingHorizontal: wp(16), paddingVertical: wp(7), borderRadius: wp(10), elevation: 6, shadowOffset: {width: 0, height: 3}, shadowOpacity: 0.25, shadowRadius: 10},
  saveBtnText: {fontSize: ms(12), fontWeight: '800', letterSpacing: 0.3},
  lhRow: {flexDirection: 'row', alignItems: 'center', paddingBottom: wp(4)},
  lhTitle: {fontSize: ms(13), fontWeight: '800', letterSpacing: 0.3},
  lhTabGroup: {flexDirection: 'row', borderRadius: wp(10), padding: wp(2), gap: wp(2)},
  lhTab: {flexDirection: 'row', alignItems: 'center', gap: wp(4), paddingVertical: wp(5), paddingHorizontal: wp(12), borderRadius: wp(8)},
  lhTabLabel: {fontSize: ms(10), fontWeight: '700', letterSpacing: 0.2},
}); }

function LField({label, children, wide, compact, noBorder, mandatory}: {label: string; children: React.ReactNode; wide?: boolean; compact?: boolean; noBorder?: boolean; mandatory?: boolean}) {
  const {c} = useTheme();
  const content = mandatory ? <MandatoryCtx.Provider value={true}>{children}</MandatoryCtx.Provider> : children;
  if (compact) {
    return (
      <View style={[ls.fieldCompact, {borderBottomColor: c.borderLight}]}>
        <Text style={[ls.fieldCompactLabel, {color: c.textSecondary}]}>{label}</Text>
        <View style={ls.fieldCompactBody}>{content}</View>
      </View>
    );
  }
  return (
    <View style={[ls.field, {borderBottomColor: c.borderLight}, wide && ls.fieldWide, noBorder && {borderBottomWidth: 0}]}>
      <Text style={[ls.fieldLabel, {color: c.textSecondary}, wide && [ls.fieldLabelWide, {maxWidth: undefined}]]} numberOfLines={wide ? undefined : 1}>{label}</Text>
      <View style={ls.fieldBody}>{content}</View>
    </View>
  );
}

function LFieldRow({children}: {children: React.ReactNode}) {
  const {c} = useTheme();
  return <View style={[ls.fieldRow, {borderBottomColor: c.borderLight}]}>{children}</View>;
}

function LCard({children, title, icon, style, headerRight}: {children: React.ReactNode; title?: string; icon?: string; style?: any; headerRight?: React.ReactNode}) {
  const {c} = useTheme();
  return (
    <View style={[ls.card, {backgroundColor: c.white, borderColor: c.borderLight}, style]}>
      {title ? (
        <View style={[ls.cardHeader, {borderBottomColor: c.borderLight}]}>
          {icon && (
            <View style={[ls.cardHeaderIcon, {backgroundColor: c.primarySurface}]}>
              <MaterialIcons name={icon as any} size={ms(12)} color={c.primary} />
            </View>
          )}
          <Text style={[ls.cardTitle, {color: c.textPrimary}]}>{title}</Text>
          {headerRight}
        </View>
      ) : null}
      {children}
    </View>
  );
}

function LSaveButton({disabled, onPress}: {disabled?: boolean; onPress?: () => void}) {
  const {c} = useTheme();
  return (
    <TouchableOpacity
      style={[ls.saveBtn, {backgroundColor: disabled ? c.border : c.primary, shadowColor: disabled ? c.shadowColor : c.primary}]}
      activeOpacity={disabled ? 1 : 0.8}
      disabled={disabled}
      onPress={onPress}>
      <MaterialIcons name="check-circle" size={ms(14)} color={disabled ? c.textMuted : c.textOnPrimary} />
      <Text style={[ls.saveBtnText, {color: disabled ? c.textMuted : c.textOnPrimary}]}>Save</Text>
    </TouchableOpacity>
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

function ProductsModal({visible, onClose, products}: {visible: boolean; onClose: () => void; products?: {item_code: string; description: string; quantity: number | null; unit: string | null}[]}) {
  const {c} = useTheme();
  const items = products && products.length > 0 ? products : PRODUCTS_DATA.map(p => ({item_code: p.code, description: p.description, quantity: parseFloat(p.qty), unit: p.unit}));
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
        <View style={st.tableHeader}>
          <Text style={[st.tableCellCode, {fontWeight: '900', color: c.textPrimary}]}>CODE</Text>
          <Text style={[st.tableCellDesc, {fontWeight: '900', color: c.textPrimary}]}>DESCRIPTION</Text>
          <Text style={[st.tableCellQty, {fontWeight: '900', color: c.textPrimary}]}>QTY</Text>
          <Text style={[st.tableCellUnit, {fontWeight: '900', color: c.textPrimary}]}>UNIT</Text>
        </View>
        {items.map((item, idx) => (
          <View key={`${item.item_code}-${idx}`} style={common.tableRow}>
            <Text style={[st.tableCellCode, {fontWeight: '500', color: c.textPrimary}]}>{item.item_code}</Text>
            <Text style={[st.tableCellDesc, {fontWeight: '500', color: c.textPrimary}]}>{item.description}</Text>
            <Text style={[st.tableCellQty, {fontWeight: '500', color: c.textPrimary}]}>{item.quantity ?? '0'}</Text>
            <Text style={[st.tableCellUnit, {fontWeight: '500', color: c.textPrimary}]}>{item.unit || '-'}</Text>
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

function _createSlumpSt() { return StyleSheet.create({
  gridWrap: {paddingHorizontal: wp(10), paddingTop: wp(8), paddingBottom: wp(4)},
  grid: {flexDirection: 'row', flexWrap: 'wrap', gap: wp(5)},
  gridItem: {width: '22%', flexGrow: 1, minWidth: wp(60), maxWidth: wp(95), paddingVertical: wp(7), borderRadius: wp(8), justifyContent: 'center', alignItems: 'center', position: 'relative', minHeight: wp(32)},
  gridItemText: {fontSize: ms(13), fontWeight: '700'},
  gridCheck: {position: 'absolute', top: wp(2), right: wp(2)},
  customSection: {marginTop: wp(7), gap: wp(5)},
  customToggle: {flexDirection: 'row', alignItems: 'center', paddingVertical: wp(6), paddingHorizontal: wp(10), borderRadius: wp(8), gap: wp(6), minHeight: wp(32)},
  customIcon: {width: wp(22), height: wp(22), borderRadius: wp(6), justifyContent: 'center', alignItems: 'center'},
  customLabel: {fontSize: ms(10), fontWeight: '700'},
  customInputWrap: {flexDirection: 'row', alignItems: 'center', borderRadius: wp(8), borderWidth: 1.5, paddingHorizontal: wp(10), height: wp(34)},
  customInput: {flex: 1, fontSize: ms(14), fontWeight: '700', padding: 0},
  customUnit: {fontSize: ms(10), fontWeight: '600', marginLeft: wp(5)},
}); }

function PlantTab({data, ticketId, onSaveResult, setSavingOverlay, refreshRecord}: {data: DeliveryRecord | null; ticketId?: number; onSaveResult?: (success: boolean, message: string) => void; setSavingOverlay?: (v: boolean) => void; refreshRecord?: () => Promise<void>}) {
  const {c} = useTheme();
  const {saveDeliveryTab} = useOfflineSync();
  // Dynamic field definitions from API
  const fd = data?.field_definitions?.plant || {};
  const fdKeys = Object.keys(fd);
  const hasField = (field: string) => field in fd;
  const ft = (field: string) => (fd as any)?.[field]?.title || field.replace(/_/g, ' ').replace(/\b\w/g, (ch: string) => ch.toUpperCase());
  const mf = (field: string) => (fd as any)?.[field]?.mandatory ?? false;
  const p = data?.plant;
  const allFieldsFilled = p != null && fdKeys.length > 0 && fdKeys.every(k => {
    // Skip fields whose dependency isn't met
    const dep = (fd as any)?.[k]?.depends_on;
    if (dep && (p as any)?.[dep.field] !== dep.value) return true;
    const val = (p as any)?.[k];
    return val != null && val !== '';
  });
  const hasApiData = p != null && fdKeys.some(k => (p as any)?.[k] != null);
  const slumpFromPlantLocked = p?.slump_from_plant != null;
  const slumpToJobLocked = p?.slump_to_job != null;
  const [saving, setSaving] = useState(false);
  const [isDirty, setIsDirty] = useState(false);
  const handleSavePlant = async () => {
    if (!ticketId) return;
    setSaving(true);
    setSavingOverlay?.(true);
    try {
      const result = await saveDeliveryTab(ticketId, 'plant', {
        slump_from_plant: slumpFromPlant !== '' ? Number(slumpFromPlant) : null,
        slump_to_job: slumpToJob !== '' ? Number(slumpToJob) : null,
        temp_at_plant: tempAtPlant !== '' ? Number(tempAtPlant) : null,
        water_added_full: waterLitres > 0 ? waterLitres : null,
        water_reason: waterReason || null,
        truck_start: truckStart ? truckStart.toISOString() : null,
        truck_end: truckEnd ? truckEnd.toISOString() : null,
        hand_added: handAdded != null ? handAdded : null,
        nitrogen_added: nitrogenAdded != null ? nitrogenAdded : null,
        fibers_added: fibersAdded != null ? fibersAdded : null,
        load_tested: loadTested === 'yes' ? true : loadTested === 'no' ? false : null,
        ...(loadTested === 'yes' ? {
          load_temp: loadTemp != null ? loadTemp : null,
          load_air: loadAir != null ? loadAir : null,
          load_slump: loadSlump !== '' ? Number(loadSlump) : null,
          load_cylinders: loadCylinders != null ? loadCylinders : null,
        } : {}),
        notes: plantNotes || null,
      });
      if (!result.offline) await refreshRecord?.();
      onSaveResult?.(result.success, result.message);
    } catch (err: any) {
      onSaveResult?.(false, err.message || 'Failed to save plant data.');
    } finally {
      setSaving(false);
      setSavingOverlay?.(false);
    }
  };
  const [slumpFromPlant, setSlumpFromPlant] = useState(p?.slump_from_plant != null ? String(p.slump_from_plant) : '');
  const [slumpPickerVisible, setSlumpPickerVisible] = useState(false);
  const [slumpToJob, setSlumpToJob] = useState(p?.slump_to_job != null ? String(p.slump_to_job) : '');
  const [slumpToJobPickerVisible, setSlumpToJobPickerVisible] = useState(false);
  const [waterLitres, setWaterLitres] = useState(p?.water_added_full ?? 0);
  const [waterReason, setWaterReason] = useState(p?.water_reason || '');
  const [reasonModalVisible, setReasonModalVisible] = useState(false);
  const [productsModalVisible, setProductsModalVisible] = useState(false);
  const [handAdded, setHandAdded] = useState<boolean | null>(p?.hand_added ?? null);
  const [nitrogenAdded, setNitrogenAdded] = useState<boolean | null>(p?.nitrogen_added ?? null);
  const [fibersAdded, setFibersAdded] = useState<boolean | null>(p?.fibers_added ?? null);
  const [loadTested, setLoadTested] = useState<'yes' | 'no' | null>(p?.load_tested === true ? 'yes' : p?.load_tested === false ? 'no' : null);
  const [loadTemp, setLoadTemp] = useState((p as any)?.load_temp ?? 0);
  const [loadAir, setLoadAir] = useState((p as any)?.load_air ?? 0);
  const [loadSlump, setLoadSlump] = useState((p as any)?.load_slump != null ? String((p as any).load_slump) : '');
  const [loadSlumpPickerVisible, setLoadSlumpPickerVisible] = useState(false);
  const [loadCylinders, setLoadCylinders] = useState((p as any)?.load_cylinders ?? 0);
  const [truckStart, setTruckStart] = useState<Date | undefined>(p?.truck_start ? new Date(p.truck_start) : undefined);
  const [truckEnd, setTruckEnd] = useState<Date | undefined>(p?.truck_end ? new Date(p.truck_end) : undefined);
  const [truckPickerField, setTruckPickerField] = useState<'start' | 'end' | null>(null);
  const [truckPickerVisible, setTruckPickerVisible] = useState(false);
  const [plantNotes, setPlantNotes] = useState(p?.notes || '');
  const [tempAtPlant, setTempAtPlant] = useState(p?.temp_at_plant != null ? String(p.temp_at_plant) : '');
  const [voiceWizardVisible, setVoiceWizardVisible] = useState(false);

  const plantFieldValues: Record<string, any> = {
    slump_from_plant: slumpFromPlant?.trim?.(), slump_to_job: slumpToJob?.trim?.(),
    temp_at_plant: tempAtPlant?.trim?.(), water_added_full: waterLitres,
    water_reason: waterReason, truck_start: truckStart, truck_end: truckEnd,
    hand_added: handAdded, nitrogen_added: nitrogenAdded, fibers_added: fibersAdded,
    load_tested: loadTested === 'yes' ? true : loadTested === 'no' ? false : null, notes: plantNotes,
    load_temp: loadTemp, load_air: loadAir, load_slump: loadSlump, load_cylinders: loadCylinders,
  };
  const shouldShow = (fieldKey: string): boolean => {
    const dep = (fd as any)?.[fieldKey]?.depends_on;
    if (!dep) return true;
    return plantFieldValues[dep.field] === dep.value;
  };
  const mandatoryPlantMissing = fdKeys.some(k => {
    if (!(fd as any)?.[k]?.mandatory) return false;
    // Skip if dependency not met
    const dep = (fd as any)?.[k]?.depends_on;
    if (dep && plantFieldValues[dep.field] !== dep.value) return false;
    const v = plantFieldValues[k];
    return v === '' || v === null || v === undefined;
  });

  const PLANT_VOICE_FIELDS: VoiceField[] = [
    {key: 'slumpFromPlant', label: ft('slump_from_plant'), prompt: `Say the ${ft('slump_from_plant').toLowerCase()} value.`, type: 'number', skip: slumpFromPlantLocked, required: mf('slump_from_plant'), min: 0, max: 300},
    {key: 'waterLitres', label: ft('water_added_full'), prompt: `How many litres of water were added?`, type: 'number', min: 0, max: 999},
    {key: 'waterReason', label: ft('water_reason'), prompt: 'Why was water added?', type: 'choice', choices: ['NOT ADDED', 'EXCEEDED', 'BRING UP TO']},
    {key: 'slumpToJob', label: ft('slump_to_job'), prompt: `Say the ${ft('slump_to_job').toLowerCase()} value.`, type: 'number', skip: slumpToJobLocked, required: mf('slump_to_job'), min: 0, max: 300},
    {key: 'tempAtPlant', label: ft('temp_at_plant'), prompt: 'What is the temperature at the plant in degrees?', type: 'number', min: -40, max: 60},
    {key: 'handAdded', label: ft('hand_added'), prompt: `${ft('hand_added')}? Say yes or no.`, type: 'boolean'},
    {key: 'nitrogenAdded', label: ft('nitrogen_added'), prompt: `${ft('nitrogen_added')}? Say yes or no.`, type: 'boolean'},
    {key: 'fibersAdded', label: ft('fibers_added'), prompt: `${ft('fibers_added')}? Say yes or no.`, type: 'boolean'},
    {key: 'loadTested', label: ft('load_tested'), prompt: `${ft('load_tested')}? Say yes or no.`, type: 'boolean'},
    {key: 'loadTemp', label: ft('load_temp'), prompt: `What is the ${ft('load_temp').toLowerCase()}?`, type: 'number', min: 0, max: 100, dependsOn: {key: 'loadTested', value: 'yes'}},
    {key: 'loadAir', label: ft('load_air'), prompt: `What is the ${ft('load_air').toLowerCase()}?`, type: 'number', min: 0, max: 100, dependsOn: {key: 'loadTested', value: 'yes'}},
    {key: 'loadSlump', label: ft('load_slump'), prompt: `What is the ${ft('load_slump').toLowerCase()}?`, type: 'number', min: 0, max: 300, dependsOn: {key: 'loadTested', value: 'yes'}},
    {key: 'loadCylinders', label: ft('load_cylinders'), prompt: `How many ${ft('load_cylinders').toLowerCase()}?`, type: 'number', min: 0, max: 50, dependsOn: {key: 'loadTested', value: 'yes'}},
    {key: 'plantNotes', label: ft('notes'), prompt: 'Dictate any plant notes.', type: 'text'},
  ];

  const PLANT_KEYWORDS = ['slump', 'nitrogen', 'fibers', 'bring up to', 'exceeded', 'not added', 'litres', 'cylinders'];

  const handleVoiceComplete = useCallback((voiceResults: VoiceResults) => {
    if (voiceResults.slumpFromPlant && !slumpFromPlantLocked) setSlumpFromPlant(voiceResults.slumpFromPlant);
    if (voiceResults.waterLitres) setWaterLitres(parseInt(voiceResults.waterLitres) || 0);
    if (voiceResults.waterReason) setWaterReason(voiceResults.waterReason);
    if (voiceResults.slumpToJob && !slumpToJobLocked) setSlumpToJob(voiceResults.slumpToJob);
    if (voiceResults.tempAtPlant) setTempAtPlant(voiceResults.tempAtPlant);
    if (voiceResults.handAdded) setHandAdded(voiceResults.handAdded.toLowerCase() === 'yes');
    if (voiceResults.nitrogenAdded) setNitrogenAdded(voiceResults.nitrogenAdded.toLowerCase() === 'yes');
    if (voiceResults.fibersAdded) setFibersAdded(voiceResults.fibersAdded.toLowerCase() === 'yes');
    if (voiceResults.loadTested) setLoadTested(voiceResults.loadTested.toLowerCase() === 'yes' ? 'yes' : 'no');
    if (voiceResults.loadTemp) setLoadTemp(parseInt(voiceResults.loadTemp) || 0);
    if (voiceResults.loadAir) setLoadAir(parseInt(voiceResults.loadAir) || 0);
    if (voiceResults.loadSlump) setLoadSlump(voiceResults.loadSlump);
    if (voiceResults.loadCylinders) setLoadCylinders(parseInt(voiceResults.loadCylinders) || 0);
    if (voiceResults.plantNotes) setPlantNotes(voiceResults.plantNotes);
  }, [slumpFromPlantLocked, slumpToJobLocked]);

  const dirtyMountRef = useRef(false);
  useEffect(() => {
    if (!dirtyMountRef.current) { dirtyMountRef.current = true; return; }
    if (hasApiData) setIsDirty(true);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [waterLitres, waterReason, handAdded, nitrogenAdded, fibersAdded, loadTested, truckStart, truckEnd, plantNotes, tempAtPlant, slumpFromPlant, slumpToJob, loadTemp, loadAir, loadSlump, loadCylinders]);

  const plantScrollRef = useRef<ScrollView>(null);
  const plantTestAnim = useRef(new Animated.Value(loadTested === 'yes' ? 1 : 0)).current;
  const {width: _pw, height: _ph} = useWindowDimensions();
  const _pLand = _pw > _ph;
  const handlePlantLoadTested = useCallback((val: 'yes' | 'no') => {
    if (val === 'yes') {
      if (!_pLand) {
        LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
      }
      plantTestAnim.setValue(0);
      Animated.timing(plantTestAnim, {toValue: 1, duration: 350, useNativeDriver: true}).start();
    }
    setLoadTested(val);
    if (val === 'yes') {
      setTimeout(() => plantScrollRef.current?.scrollToEnd({animated: true}), 250);
    }
  }, [plantTestAnim, _pLand]);
  if (_pw > _ph) {
    const _pIsPhone = Math.min(_pw, _ph) <= 600;

    const plantLandContent = (
      <>
        <View style={[ls.topBar, {flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between'}]}>
          {!allFieldsFilled ? (
            <TouchableOpacity style={[st.voiceBtn, {backgroundColor: c.primary}]} onPress={() => setVoiceWizardVisible(true)} activeOpacity={0.7}>
              <MaterialIcons name="mic" size={ms(14)} color="#FFF" />
            </TouchableOpacity>
          ) : <View />}
          <LSaveButton disabled={allFieldsFilled || mandatoryPlantMissing || (hasApiData && !isDirty) || saving} onPress={handleSavePlant} />
        </View>
        <View style={_pIsPhone ? {gap: wp(8)} : {flex: 1, gap: wp(8)}} pointerEvents={allFieldsFilled ? 'none' : 'auto'}>
          {/* Top: two columns */}
          <View style={[{flexDirection: 'row', gap: wp(10)}, !_pIsPhone && {flex: 3}]}>
            <LCard title="Mix Properties" icon="science">
              <LField label={ft('slump_from_plant')} mandatory={mf('slump_from_plant')}>
                <TouchableOpacity activeOpacity={0.7} onPress={() => !slumpFromPlantLocked && setSlumpPickerVisible(true)} disabled={slumpFromPlantLocked}>
                  <YellowInput value={slumpFromPlant} />
                </TouchableOpacity>
                {!slumpFromPlantLocked && <MoreBtn onPress={() => setSlumpPickerVisible(true)} />}
              </LField>
              <LField label={ft('water_added_full')} mandatory={mf('water_added_full')}>
                <View style={common.rowFlex1Gap12}>
                  <Stepper value={String(waterLitres)} unit="" onIncrement={() => setWaterLitres(v => v + 1)} onDecrement={() => setWaterLitres(v => Math.max(0, v - 1))} onChangeValue={v => setWaterLitres(parseInt(v) || 0)} />
                  <View style={[common.rowCenterGap8, {flex: 1}]}>
                    <LineInput placeholder="Reason" value={waterReason} onPress={() => setReasonModalVisible(true)} />
                    <MoreBtn onPress={() => setReasonModalVisible(true)} />
                  </View>
                </View>
              </LField>
              <LField label={ft('slump_to_job')} mandatory={mf('slump_to_job')}>
                <TouchableOpacity activeOpacity={0.7} onPress={() => !slumpToJobLocked && setSlumpToJobPickerVisible(true)} disabled={slumpToJobLocked}>
                  <YellowInput value={slumpToJob} />
                </TouchableOpacity>
              </LField>
              <LField label={ft('temp_at_plant')} noBorder mandatory={mf('temp_at_plant')}>
                <LineInput width={100} placeholder="Temperature" keyboardType="numeric" value={tempAtPlant} onChangeText={setTempAtPlant} />
              </LField>
            </LCard>
            <View style={{flex: 1}}>
            <LCard title="Truck & Additives" icon="local-shipping">
              <ScrollView style={{flex: 1}} showsVerticalScrollIndicator={true} bounces={false} nestedScrollEnabled contentContainerStyle={{gap: wp(8)}}>
                <View style={{paddingVertical: wp(4)}}>
                  <LFieldRow>
                    <LField label={ft('truck_start')} compact mandatory={mf('truck_start')}>
                      <TimePicker label="Select" value={truckStart} onPress={() => { setTruckPickerField('start'); setTruckPickerVisible(true); }} />
                    </LField>
                    <LField label={ft('truck_end')} compact mandatory={mf('truck_end')}>
                      <TimePicker label="Select" value={truckEnd} onPress={() => { setTruckPickerField('end'); setTruckPickerVisible(true); }} />
                    </LField>
                  </LFieldRow>
                </View>
                <LField label={ft('hand_added')} mandatory={mf('hand_added')}>
                  <Check checked={!!handAdded} onPress={() => setHandAdded(!handAdded)} />
                  <TouchableOpacity activeOpacity={0.6} onPress={() => setProductsModalVisible(true)}>
                    <Text style={[st.linkText, {color: c.linkBlue}]}>VIEW PRODUCTS</Text>
                  </TouchableOpacity>
                </LField>
                <View style={{paddingVertical: wp(4)}}>
                  <LFieldRow>
                    <LField label={ft('nitrogen_added')} compact mandatory={mf('nitrogen_added')}><Check checked={!!nitrogenAdded} label="Not on ticket" onPress={() => setNitrogenAdded(!nitrogenAdded)} /></LField>
                    <LField label={ft('fibers_added')} compact mandatory={mf('fibers_added')}><Check checked={!!fibersAdded} label="Not on ticket" onPress={() => setFibersAdded(!fibersAdded)} /></LField>
                  </LFieldRow>
                </View>
                <LField label={ft('load_tested')} mandatory={mf('load_tested')}>
                  <View style={[st.radioRow, {justifyContent: 'center'}]}>
                    <Radio selected={loadTested === 'yes'} label="Yes" onPress={() => handlePlantLoadTested('yes')} />
                    <Radio selected={loadTested === 'no'} label="No" onPress={() => handlePlantLoadTested('no')} />
                  </View>
                </LField>
                {shouldShow('load_temp') && (
                <Animated.View style={{opacity: plantTestAnim, transform: [{translateY: plantTestAnim.interpolate({inputRange: [0, 1], outputRange: [12, 0]})}]}}>
                  <View style={[ls.sectionDivider, {borderTopColor: c.primary}]}>
                    <View style={{flexDirection: 'row', alignItems: 'center', gap: wp(4)}}>
                      <MaterialIcons name="science" size={ms(10)} color={c.primary} />
                      <Text style={[ls.sectionLabel, {color: c.primary, marginBottom: 0}]}>TEST RESULTS</Text>
                    </View>
                  </View>
                  <LFieldRow>
                    <LField label={ft('load_temp')} compact>
                      <Stepper value={String(loadTemp)} unit="" onIncrement={() => setLoadTemp(v => v + 1)} onDecrement={() => setLoadTemp(v => Math.max(0, v - 1))} onChangeValue={v => setLoadTemp(parseInt(v) || 0)} />
                    </LField>
                    <LField label={ft('load_air')} compact>
                      <Stepper value={String(loadAir)} unit="" onIncrement={() => setLoadAir(v => v + 1)} onDecrement={() => setLoadAir(v => Math.max(0, v - 1))} onChangeValue={v => setLoadAir(parseInt(v) || 0)} />
                    </LField>
                  </LFieldRow>
                  <LFieldRow>
                    <LField label={ft('load_slump')} compact>
                      <Stepper value={loadSlump} unit="" onIncrement={() => setLoadSlump(v => String((parseInt(v) || 0) + 10))} onDecrement={() => setLoadSlump(v => String(Math.max(0, (parseInt(v) || 0) - 10)))} />
                    </LField>
                    <LField label={ft('load_cylinders')} compact>
                      <Stepper value={String(loadCylinders)} unit="" onIncrement={() => setLoadCylinders(v => v + 1)} onDecrement={() => setLoadCylinders(v => Math.max(0, v - 1))} onChangeValue={v => setLoadCylinders(parseInt(v) || 0)} />
                    </LField>
                  </LFieldRow>
                </Animated.View>
                )}
              </ScrollView>
            </LCard>
            </View>
          </View>
          {/* Bottom: Plant Notes */}
          <LCard title="Plant Notes" icon="edit-note" style={_pIsPhone ? {minHeight: wp(80)} : {flex: 1}}>
            <TextInput
              style={[{borderRadius: wp(8), paddingHorizontal: wp(10), paddingVertical: wp(6), fontSize: ms(12), backgroundColor: c.white, borderWidth: StyleSheet.hairlineWidth, borderColor: c.border, color: c.textPrimary, textAlignVertical: 'top', minHeight: wp(34)}, !_pIsPhone && {flex: 1}]}
              multiline
              placeholderTextColor={c.textMuted}
              placeholder="Enter plant notes..."
              value={plantNotes}
              onChangeText={setPlantNotes}
            />
          </LCard>
        </View>
      </>
    );

    return (
      <View style={[ls.root, {backgroundColor: c.surface}]}>
        {_pIsPhone ? (
          <ScrollView showsVerticalScrollIndicator nestedScrollEnabled keyboardShouldPersistTaps="handled">
            {plantLandContent}
          </ScrollView>
        ) : plantLandContent}
        <SlumpPickerModal visible={slumpPickerVisible} value={slumpFromPlant} title={ft('slump_from_plant')} onConfirm={(val) => { setSlumpFromPlant(val); setSlumpPickerVisible(false); }} onClose={() => setSlumpPickerVisible(false)} />
        <SlumpPickerModal visible={loadSlumpPickerVisible} value={loadSlump} title="Load Slump" onConfirm={(val) => { setLoadSlump(val); setLoadSlumpPickerVisible(false); }} onClose={() => setLoadSlumpPickerVisible(false)} />
        <SlumpPickerModal visible={slumpToJobPickerVisible} value={slumpToJob} title={ft('slump_to_job')} onConfirm={(val) => { setSlumpToJob(val); setSlumpToJobPickerVisible(false); }} onClose={() => setSlumpToJobPickerVisible(false)} />
        <ReasonListModal visible={reasonModalVisible} onSelect={setWaterReason} onClose={() => setReasonModalVisible(false)} />
        <ProductsModal visible={productsModalVisible} onClose={() => setProductsModalVisible(false)} products={p?.products} />
        <DateTimePicker mode="time" visible={truckPickerVisible} value={(truckPickerField === 'start' ? truckStart : truckEnd) || new Date()} onConfirm={(date) => { if (truckPickerField === 'start') {setTruckStart(date);} else if (truckPickerField === 'end') {setTruckEnd(date);} setTruckPickerVisible(false); }} onCancel={() => setTruckPickerVisible(false)} />
        <VoiceFormWizard visible={voiceWizardVisible} onClose={() => setVoiceWizardVisible(false)} fields={PLANT_VOICE_FIELDS} onComplete={handleVoiceComplete} keywords={PLANT_KEYWORDS} speakPrompts />
      </View>
    );
  }
  return (
    <View style={[st.tabBody, {backgroundColor: c.surface}]}>
      <View style={{flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between'}}>
        {!allFieldsFilled ? (
          <TouchableOpacity
            style={[st.voiceBtn, {backgroundColor: c.primary}]}
            onPress={() => setVoiceWizardVisible(true)}
            activeOpacity={0.7}>
            <MaterialIcons name="mic" size={ms(14)} color="#FFF" />
          </TouchableOpacity>
        ) : <View />}
        <SaveButton disabled={allFieldsFilled || mandatoryPlantMissing || (hasApiData && !isDirty) || saving} onPress={handleSavePlant} />
      </View>
      <View pointerEvents={allFieldsFilled ? 'none' : 'auto'}>
      <CardsGrid>
      <FieldCard title="Mix Properties" icon="science">
      <Field label={ft('slump_from_plant')} mandatory={mf('slump_from_plant')}>
        <TouchableOpacity activeOpacity={0.7} onPress={() => !slumpFromPlantLocked && setSlumpPickerVisible(true)} disabled={slumpFromPlantLocked}>
          <YellowInput value={slumpFromPlant} />
        </TouchableOpacity>
        {!slumpFromPlantLocked && <MoreBtn onPress={() => setSlumpPickerVisible(true)} />}
      </Field>
      <Field label={ft('water_added_full')} mandatory={mf('water_added_full')}>
        <View style={common.rowFlex1Gap12}>
          <Stepper value={String(waterLitres)} unit="" onIncrement={() => setWaterLitres(v => v + 1)} onDecrement={() => setWaterLitres(v => Math.max(0, v - 1))} onChangeValue={v => setWaterLitres(parseInt(v) || 0)} />
          <View style={[common.rowCenterGap8, {flex: 1}]}>
            <LineInput placeholder="Reason" value={waterReason} onPress={() => setReasonModalVisible(true)} />
            <MoreBtn onPress={() => setReasonModalVisible(true)} />
          </View>
        </View>
      </Field>
      <Field label={ft('slump_to_job')} mandatory={mf('slump_to_job')}>
        <TouchableOpacity activeOpacity={0.7} onPress={() => !slumpToJobLocked && setSlumpToJobPickerVisible(true)} disabled={slumpToJobLocked}>
          <YellowInput value={slumpToJob} />
        </TouchableOpacity>
      </Field>
      <Field label={ft('temp_at_plant')} last mandatory={mf('temp_at_plant')}>
        <LineInput width={100} placeholder="Temperature" keyboardType="numeric" value={tempAtPlant} onChangeText={setTempAtPlant} />
      </Field>
      </FieldCard>
      <FieldCard title="Truck & Additives" icon="local-shipping">
      <FieldRow>
        <Field label={ft('truck_start')} compact mandatory={mf('truck_start')}>
          <TimePicker
            label="Select"
            value={truckStart}
            onPress={() => { setTruckPickerField('start'); setTruckPickerVisible(true); }}
          />
        </Field>
        <Field label={ft('truck_end')} compact mandatory={mf('truck_end')}>
          <TimePicker
            label="Select"
            value={truckEnd}
            onPress={() => { setTruckPickerField('end'); setTruckPickerVisible(true); }}
          />
        </Field>
      </FieldRow>
      <Field label={ft('hand_added')} mandatory={mf('hand_added')}>
        <Check checked={!!handAdded} onPress={() => setHandAdded(!handAdded)} />
        <TouchableOpacity activeOpacity={0.6} onPress={() => setProductsModalVisible(true)}>
          <Text style={[st.linkText, {color: c.linkBlue}]}>VIEW PRODUCTS</Text>
        </TouchableOpacity>
      </Field>
      <FieldRow>
        <Field label={ft('nitrogen_added')} compact mandatory={mf('nitrogen_added')}><Check checked={!!nitrogenAdded} label="If not on ticket" onPress={() => setNitrogenAdded(!nitrogenAdded)} /></Field>
        <Field label={ft('fibers_added')} compact mandatory={mf('fibers_added')}><Check checked={!!fibersAdded} label="If not on ticket" onPress={() => setFibersAdded(!fibersAdded)} /></Field>
      </FieldRow>
      <Field label={ft('load_tested')} last={!shouldShow('load_temp')} mandatory={mf('load_tested')}>
        <View style={st.radioRow}>
          <Radio selected={loadTested === 'yes'} label="Yes" onPress={() => setLoadTested('yes')} />
          <Radio selected={loadTested === 'no'} label="No" onPress={() => setLoadTested('no')} />
        </View>
      </Field>
      {shouldShow('load_temp') && (
        <>
          <FieldRow>
            <Field label={ft('load_temp')} compact>
              <Stepper value={String(loadTemp)} unit="" onIncrement={() => setLoadTemp(v => v + 1)} onDecrement={() => setLoadTemp(v => Math.max(0, v - 1))} onChangeValue={v => setLoadTemp(parseInt(v) || 0)} />
            </Field>
            <Field label={ft('load_air')} compact>
              <Stepper value={String(loadAir)} unit="" onIncrement={() => setLoadAir(v => v + 1)} onDecrement={() => setLoadAir(v => Math.max(0, v - 1))} onChangeValue={v => setLoadAir(parseInt(v) || 0)} />
            </Field>
          </FieldRow>
          <FieldRow>
            <Field label={ft('load_slump')} compact>
              <Stepper value={loadSlump} unit="" onIncrement={() => setLoadSlump(v => String((parseInt(v) || 0) + 10))} onDecrement={() => setLoadSlump(v => String(Math.max(0, (parseInt(v) || 0) - 10)))} />
            </Field>
            <Field label={ft('load_cylinders')} compact>
              <Stepper value={String(loadCylinders)} unit="" onIncrement={() => setLoadCylinders(v => v + 1)} onDecrement={() => setLoadCylinders(v => Math.max(0, v - 1))} onChangeValue={v => setLoadCylinders(parseInt(v) || 0)} />
            </Field>
          </FieldRow>
        </>
      )}
      </FieldCard>
      <FieldCard title="Plant Notes" icon="edit-note" fullWidth>
      <Field label={ft('notes')} wide last mandatory={mf('notes')}>
        <NoteInput placeholder="Enter plant notes..." value={plantNotes} onChangeText={setPlantNotes} />
      </Field>
      </FieldCard>
      </CardsGrid>
      </View>
      <SlumpPickerModal
        visible={slumpPickerVisible}
        value={slumpFromPlant}
        title={ft('slump_from_plant')}
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
        title={ft('slump_to_job')}
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
        products={p?.products}
      />
      <DateTimePicker
        mode="time"
        visible={truckPickerVisible}
        value={(truckPickerField === 'start' ? truckStart : truckEnd) || new Date()}
        onConfirm={(date) => {
          if (truckPickerField === 'start') {setTruckStart(date);}
          else if (truckPickerField === 'end') {setTruckEnd(date);}
          setTruckPickerVisible(false);
        }}
        onCancel={() => setTruckPickerVisible(false)}
      />
      <VoiceFormWizard
        visible={voiceWizardVisible}
        onClose={() => setVoiceWizardVisible(false)}
        fields={PLANT_VOICE_FIELDS}
        onComplete={handleVoiceComplete}
        keywords={PLANT_KEYWORDS}
        speakPrompts
      />
    </View>
  );
}

// ─── JOBSITE TAB ───
function JobsiteTab({data, ticketId, onSaveResult, setSavingOverlay, refreshRecord}: {data: DeliveryRecord | null; ticketId?: number; onSaveResult?: (success: boolean, message: string) => void; setSavingOverlay?: (v: boolean) => void; refreshRecord?: () => Promise<void>}) {
  const {c} = useTheme();
  const {saveDeliveryTab} = useOfflineSync();
  const fd = data?.field_definitions?.jobsite || {};
  const fdKeys = Object.keys(fd);
  const hasField = (field: string) => field in fd;
  const ft = (field: string) => (fd as any)?.[field]?.title || field.replace(/_/g, ' ').replace(/\b\w/g, (ch: string) => ch.toUpperCase());
  const mf = (field: string) => (fd as any)?.[field]?.mandatory ?? false;
  const j = data?.jobsite;
  const jAllFieldsFilled = j != null && fdKeys.length > 0 && fdKeys.every(k => {
    const dep = (fd as any)?.[k]?.depends_on;
    if (dep && (j as any)?.[dep.field] !== dep.value) return true;
    const val = (j as any)?.[k];
    return val != null && val !== '';
  });
  const jHasApiData = j != null && fdKeys.some(k => (j as any)?.[k] != null);
  const fullLoadLocked = j?.full_load_litres != null;
  const [saving, setSaving] = useState(false);
  const [jIsDirty, setJIsDirty] = useState(false);
  const handleSaveJobsite = async () => {
    if (!ticketId) return;
    setSaving(true);
    setSavingOverlay?.(true);
    try {
      const result = await saveDeliveryTab(ticketId, 'jobsite', {
        full_load_litres: fullLoadLitres > 0 ? fullLoadLitres : null,
        full_load_reason: fullLoadReason || null,
        full_load_mm: fullLoadMm !== '' ? Number(fullLoadMm) : null,
        customer_water_litres: custWaterLitres > 0 ? custWaterLitres : null,
        customer_water_mm: custWaterMm !== '' ? Number(custWaterMm) : null,
        maintenance_water_litres: maintWaterLitres > 0 ? maintWaterLitres : null,
        maintenance_water_mm: maintWaterMm !== '' ? Number(maintWaterMm) : null,
        super_plasticizer: addedValues['SUPER PLASTICIZER'] || null,
        conveyor: addedValues['CONVEYOR (IF NOT ON TICKET)'] || null,
        color: addedValues['COLOR'] || null,
        fiber: addedValues['FIBER'] || null,
        other: addedValues['Other'] || null,
        conveyor_ordered_not_used: conveyorOrdered != null ? conveyorOrdered : null,
        unloaded_conveyor: unloadedConveyor != null ? unloadedConveyor : null,
        load_disputed: loadDisputed != null ? loadDisputed : null,
        washout_area: washoutArea || null,
        load_tested: jobLoadTested === 'yes' ? true : jobLoadTested === 'no' ? false : null,
        ...(jobLoadTested === 'yes' ? {
          load_temp: jobLoadTemp != null ? jobLoadTemp : null,
          load_air: jobLoadAir != null ? jobLoadAir : null,
          load_slump: jobLoadSlump !== '' ? Number(jobLoadSlump) : null,
          load_cylinders: jobLoadCylinders != null ? jobLoadCylinders : null,
        } : {}),
        notes: jobsiteNotes || null,
      });
      if (!result.offline) await refreshRecord?.();
      onSaveResult?.(result.success, result.message);
    } catch (err: any) {
      onSaveResult?.(false, err.message || 'Failed to save jobsite data.');
    } finally {
      setSaving(false);
      setSavingOverlay?.(false);
    }
  };
  const [fullLoadLitres, setFullLoadLitres] = useState(j?.full_load_litres ?? 0);
  const [fullLoadReason, setFullLoadReason] = useState(j?.full_load_reason || '');
  const [fullLoadReasonModal, setFullLoadReasonModal] = useState(false);
  const [fullLoadMm, setFullLoadMm] = useState(j?.full_load_mm != null ? String(j.full_load_mm) : '');
  const [custWaterLitres, setCustWaterLitres] = useState(j?.customer_water_litres ?? 0);
  const [custWaterMm, setCustWaterMm] = useState(j?.customer_water_mm != null ? String(j.customer_water_mm) : '');
  const [maintWaterLitres, setMaintWaterLitres] = useState(j?.maintenance_water_litres ?? 0);
  const [maintWaterMm, setMaintWaterMm] = useState(j?.maintenance_water_mm != null ? String(j.maintenance_water_mm) : '');
  const [mmModalField, setMmModalField] = useState<'fullLoad' | 'custWater' | 'maintWater' | null>(null);
  const [addedValues, setAddedValues] = useState<Record<string, string>>({
    'SUPER PLASTICIZER': j?.super_plasticizer || '',
    'CONVEYOR (IF NOT ON TICKET)': j?.conveyor || '',
    'COLOR': j?.color || '',
    'FIBER': j?.fiber || '',
    'Other': j?.other || '',
  });
  const [addedModalItem, setAddedModalItem] = useState<string | null>(null);
  const [washoutArea, setWashoutArea] = useState(j?.washout_area || '');
  const [washoutModalVisible, setWashoutModalVisible] = useState(false);
  const [jobsiteNotes, setJobsiteNotes] = useState(j?.notes || '');
  const [jobsiteNotesModal, setJobsiteNotesModal] = useState(false);
  const [conveyorOrdered, setConveyorOrdered] = useState<boolean | null>(j?.conveyor_ordered_not_used ?? null);
  const [unloadedConveyor, setUnloadedConveyor] = useState<boolean | null>(j?.unloaded_conveyor ?? null);
  const [loadDisputed, setLoadDisputed] = useState<boolean | null>(j?.load_disputed ?? null);
  const [jobLoadTested, setJobLoadTested] = useState<'yes' | 'no' | null>(j?.load_tested === true ? 'yes' : j?.load_tested === false ? 'no' : null);
  const [jobLoadTemp, setJobLoadTemp] = useState((j as any)?.load_temp ?? 0);
  const [jobLoadAir, setJobLoadAir] = useState((j as any)?.load_air ?? 0);
  const [jobLoadSlump, setJobLoadSlump] = useState((j as any)?.load_slump != null ? String((j as any).load_slump) : '');
  const [jobLoadSlumpPickerVisible, setJobLoadSlumpPickerVisible] = useState(false);
  const [jobLoadCylinders, setJobLoadCylinders] = useState((j as any)?.load_cylinders ?? 0);
  const [jVoiceWizardVisible, setJVoiceWizardVisible] = useState(false);

  const jobFieldValues: Record<string, any> = {
    full_load_litres: fullLoadLitres, full_load_reason: fullLoadReason,
    full_load_mm: fullLoadMm?.trim?.(), customer_water_litres: custWaterLitres,
    customer_water_mm: custWaterMm?.trim?.(), maintenance_water_litres: maintWaterLitres,
    maintenance_water_mm: maintWaterMm?.trim?.(), super_plasticizer: addedValues['SUPER PLASTICIZER'],
    conveyor: addedValues['CONVEYOR (IF NOT ON TICKET)'], color: addedValues['COLOR'],
    fiber: addedValues['FIBER'], other: addedValues['Other'],
    conveyor_ordered_not_used: conveyorOrdered, unloaded_conveyor: unloadedConveyor,
    load_disputed: loadDisputed, washout_area: washoutArea,
    load_tested: jobLoadTested === 'yes' ? true : jobLoadTested === 'no' ? false : null, notes: jobsiteNotes,
    load_temp: jobLoadTemp, load_air: jobLoadAir, load_slump: jobLoadSlump, load_cylinders: jobLoadCylinders,
  };
  const jobShouldShow = (fieldKey: string): boolean => {
    const dep = (fd as any)?.[fieldKey]?.depends_on;
    if (!dep) return true;
    return jobFieldValues[dep.field] === dep.value;
  };
  const mandatoryJobMissing = fdKeys.some(k => {
    if (!(fd as any)?.[k]?.mandatory) return false;
    const dep = (fd as any)?.[k]?.depends_on;
    if (dep && jobFieldValues[dep.field] !== dep.value) return false;
    const v = jobFieldValues[k];
    return v === '' || v === null || v === undefined;
  });

  const JOBSITE_VOICE_FIELDS: VoiceField[] = [
    {key: 'fullLoadLitres', label: ft('full_load_litres'), prompt: `How many litres for ${ft('full_load_litres').toLowerCase()}?`, type: 'number', min: 0, max: 999},
    {key: 'fullLoadReason', label: ft('full_load_reason'), prompt: `What is the ${ft('full_load_reason').toLowerCase()}?`, type: 'choice', choices: ['NOT ADDED', 'EXCEEDED', 'BRING UP TO']},
    {key: 'fullLoadMm', label: ft('full_load_mm'), prompt: `What is the ${ft('full_load_mm').toLowerCase()}?`, type: 'number', min: 0, max: 300},
    {key: 'custWaterLitres', label: ft('customer_water_litres'), prompt: `How many litres of ${ft('customer_water_litres').toLowerCase()}?`, type: 'number', min: 0, max: 999},
    {key: 'custWaterMm', label: ft('customer_water_mm'), prompt: `What is the ${ft('customer_water_mm').toLowerCase()}?`, type: 'number', min: 0, max: 300},
    {key: 'maintWaterLitres', label: ft('maintenance_water_litres'), prompt: `How many litres of ${ft('maintenance_water_litres').toLowerCase()}?`, type: 'number', min: 0, max: 999},
    {key: 'maintWaterMm', label: ft('maintenance_water_mm'), prompt: `What is the ${ft('maintenance_water_mm').toLowerCase()}?`, type: 'number', min: 0, max: 300},
    {key: 'superPlasticizer', label: ft('super_plasticizer'), prompt: `${ft('super_plasticizer')}? Say not added, customer, or driver.`, type: 'choice', choices: ['NOT ADDED', 'CUSTOMER', 'DRIVER']},
    {key: 'conveyor', label: ft('conveyor'), prompt: `${ft('conveyor')}? Say not added, customer, or driver.`, type: 'choice', choices: ['NOT ADDED', 'CUSTOMER', 'DRIVER']},
    {key: 'color', label: ft('color'), prompt: `${ft('color')}? Say not added, customer, or driver.`, type: 'choice', choices: ['NOT ADDED', 'CUSTOMER', 'DRIVER']},
    {key: 'fiber', label: ft('fiber'), prompt: `${ft('fiber')}? Say not added, customer, or driver.`, type: 'choice', choices: ['NOT ADDED', 'CUSTOMER', 'DRIVER']},
    {key: 'other', label: ft('other'), prompt: `Any ${ft('other').toLowerCase()} items to add?`, type: 'text'},
    {key: 'conveyorOrdered', label: ft('conveyor_ordered_not_used'), prompt: `${ft('conveyor_ordered_not_used')}? Say yes or no.`, type: 'boolean'},
    {key: 'unloadedConveyor', label: ft('unloaded_conveyor'), prompt: `${ft('unloaded_conveyor')}? Say yes or no.`, type: 'boolean'},
    {key: 'loadDisputed', label: ft('load_disputed'), prompt: `${ft('load_disputed')}? Say yes or no.`, type: 'boolean'},
    {key: 'washoutArea', label: ft('washout_area'), prompt: `What is the ${ft('washout_area').toLowerCase()}?`, type: 'choice', choices: ['WHEELBARROW', 'DUMPSTER', 'BEHIND CURB LINE', 'STONE PILE ON JOB SITE', 'TRUCK MOUNTED WASHOUT', 'PUMP', 'OTHER']},
    {key: 'jobLoadTested', label: ft('load_tested'), prompt: `${ft('load_tested')}? Say yes or no.`, type: 'boolean'},
    {key: 'jobLoadTemp', label: ft('load_temp'), prompt: `What is the ${ft('load_temp').toLowerCase()}?`, type: 'number', min: 0, max: 100, dependsOn: {key: 'jobLoadTested', value: 'yes'}},
    {key: 'jobLoadAir', label: ft('load_air'), prompt: `What is the ${ft('load_air').toLowerCase()}?`, type: 'number', min: 0, max: 100, dependsOn: {key: 'jobLoadTested', value: 'yes'}},
    {key: 'jobLoadSlump', label: ft('load_slump'), prompt: `What is the ${ft('load_slump').toLowerCase()}?`, type: 'number', min: 0, max: 300, dependsOn: {key: 'jobLoadTested', value: 'yes'}},
    {key: 'jobLoadCylinders', label: ft('load_cylinders'), prompt: `How many ${ft('load_cylinders').toLowerCase()}?`, type: 'number', min: 0, max: 50, dependsOn: {key: 'jobLoadTested', value: 'yes'}},
    {key: 'jobsiteNotes', label: ft('notes'), prompt: `Dictate any ${ft('notes').toLowerCase()}.`, type: 'text'},
  ];

  const JOBSITE_KEYWORDS = ['slump', 'litres', 'plasticizer', 'conveyor', 'fiber', 'wheelbarrow', 'dumpster', 'curb', 'cylinders', 'maintenance', 'customer', 'driver', 'not added'];

  const handleJobsiteVoiceComplete = useCallback((voiceResults: VoiceResults) => {
    if (voiceResults.fullLoadLitres && !fullLoadLocked) setFullLoadLitres(parseInt(voiceResults.fullLoadLitres) || 0);
    if (voiceResults.fullLoadReason) setFullLoadReason(voiceResults.fullLoadReason);
    if (voiceResults.fullLoadMm) setFullLoadMm(voiceResults.fullLoadMm);
    if (voiceResults.custWaterLitres) setCustWaterLitres(parseInt(voiceResults.custWaterLitres) || 0);
    if (voiceResults.custWaterMm) setCustWaterMm(voiceResults.custWaterMm);
    if (voiceResults.maintWaterLitres) setMaintWaterLitres(parseInt(voiceResults.maintWaterLitres) || 0);
    if (voiceResults.maintWaterMm) setMaintWaterMm(voiceResults.maintWaterMm);
    if (voiceResults.superPlasticizer) setAddedValues(prev => ({...prev, 'SUPER PLASTICIZER': voiceResults.superPlasticizer}));
    if (voiceResults.conveyor) setAddedValues(prev => ({...prev, 'CONVEYOR (IF NOT ON TICKET)': voiceResults.conveyor}));
    if (voiceResults.color) setAddedValues(prev => ({...prev, 'COLOR': voiceResults.color}));
    if (voiceResults.fiber) setAddedValues(prev => ({...prev, 'FIBER': voiceResults.fiber}));
    if (voiceResults.other) setAddedValues(prev => ({...prev, 'Other': voiceResults.other}));
    if (voiceResults.conveyorOrdered) setConveyorOrdered(voiceResults.conveyorOrdered.toLowerCase() === 'yes');
    if (voiceResults.unloadedConveyor) setUnloadedConveyor(voiceResults.unloadedConveyor.toLowerCase() === 'yes');
    if (voiceResults.loadDisputed) setLoadDisputed(voiceResults.loadDisputed.toLowerCase() === 'yes');
    if (voiceResults.washoutArea) setWashoutArea(voiceResults.washoutArea);
    if (voiceResults.jobLoadTested) setJobLoadTested(voiceResults.jobLoadTested.toLowerCase() === 'yes' ? 'yes' : 'no');
    if (voiceResults.jobLoadTemp) setJobLoadTemp(parseInt(voiceResults.jobLoadTemp) || 0);
    if (voiceResults.jobLoadAir) setJobLoadAir(parseInt(voiceResults.jobLoadAir) || 0);
    if (voiceResults.jobLoadSlump) setJobLoadSlump(voiceResults.jobLoadSlump);
    if (voiceResults.jobLoadCylinders) setJobLoadCylinders(parseInt(voiceResults.jobLoadCylinders) || 0);
    if (voiceResults.jobsiteNotes) setJobsiteNotes(voiceResults.jobsiteNotes);
  }, [fullLoadLocked]);

  const jDirtyMountRef = useRef(false);
  useEffect(() => {
    if (!jDirtyMountRef.current) { jDirtyMountRef.current = true; return; }
    if (jHasApiData) setJIsDirty(true);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fullLoadLitres, fullLoadReason, fullLoadMm, custWaterLitres, custWaterMm, maintWaterLitres, maintWaterMm, addedValues, conveyorOrdered, unloadedConveyor, loadDisputed, washoutArea, jobLoadTested, jobsiteNotes, jobLoadTemp, jobLoadAir, jobLoadSlump, jobLoadCylinders]);

  const jobScrollRef = useRef<ScrollView>(null);
  const jobTestAnim = useRef(new Animated.Value(jobLoadTested === 'yes' ? 1 : 0)).current;
  const {width: _jw, height: _jh} = useWindowDimensions();
  const _jLand = _jw > _jh;

  const handleJobLoadTested = useCallback((val: 'yes' | 'no') => {
    if (val === 'yes') {
      if (!_jLand) {
        LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
      }
      jobTestAnim.setValue(0);
      Animated.timing(jobTestAnim, {toValue: 1, duration: 350, useNativeDriver: true}).start();
    }
    setJobLoadTested(val);
    if (val === 'yes') {
      setTimeout(() => jobScrollRef.current?.scrollToEnd({animated: true}), 250);
    }
  }, [jobTestAnim, _jLand]);
  if (_jw > _jh) {
    return (
      <View style={[ls.root, {backgroundColor: c.surface}]}>
        <View style={[ls.topBar, {flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between'}]}>
          {!jAllFieldsFilled ? (
            <TouchableOpacity style={[st.voiceBtn, {backgroundColor: c.primary}]} onPress={() => setJVoiceWizardVisible(true)} activeOpacity={0.7}>
              <MaterialIcons name="mic" size={ms(14)} color="#FFF" />
            </TouchableOpacity>
          ) : <View />}
          <LSaveButton disabled={jAllFieldsFilled || mandatoryJobMissing || (jHasApiData && !jIsDirty) || saving} onPress={handleSaveJobsite} />
        </View>
        <View style={ls.columns} pointerEvents={jAllFieldsFilled ? 'none' : 'auto'}>
          {/* Column 1: Water */}
          <View style={{flex: 1}}>
          <LCard title="Water" icon="water-drop">
            <LField label={ft('full_load_litres')} mandatory={mf('full_load_litres')}>
              <Stepper value={String(fullLoadLitres)} unit="" highlight onIncrement={fullLoadLocked ? undefined : () => setFullLoadLitres(v => v + 1)} onDecrement={fullLoadLocked ? undefined : () => setFullLoadLitres(v => Math.max(0, v - 1))} onChangeValue={fullLoadLocked ? undefined : v => setFullLoadLitres(parseInt(v) || 0)} />
            </LField>
            <LField label={ft('full_load_reason')} mandatory={mf('full_load_reason')}>
              <LineInput placeholder="Select" value={fullLoadReason} onPress={() => setFullLoadReasonModal(true)} />
              <MoreBtn onPress={() => setFullLoadReasonModal(true)} />
            </LField>
            <LField label={ft('full_load_mm')} mandatory={mf('full_load_mm')}>
              <LineInput placeholder="mm" value={fullLoadMm} onPress={() => setMmModalField('fullLoad')} />
              <MoreBtn onPress={() => setMmModalField('fullLoad')} />
            </LField>
            <LField label={ft('customer_water_litres')} wide noBorder mandatory={mf('customer_water_litres')}>
              <View style={common.rowCenterGap8}>
                <Stepper value={String(custWaterLitres)} unit="" onIncrement={() => setCustWaterLitres(v => v + 1)} onDecrement={() => setCustWaterLitres(v => Math.max(0, v - 1))} onChangeValue={v => setCustWaterLitres(parseInt(v) || 0)} />
                <LineInput placeholder="mm" value={custWaterMm} onPress={() => setMmModalField('custWater')} />
                <MoreBtn onPress={() => setMmModalField('custWater')} />
              </View>
            </LField>
            <View style={{marginTop: wp(8)}} />
            <LField label={ft('maintenance_water_litres')} wide noBorder mandatory={mf('maintenance_water_litres')}>
              <View style={common.rowCenterGap8}>
                <Stepper value={String(maintWaterLitres)} unit="" onIncrement={() => setMaintWaterLitres(v => v + 1)} onDecrement={() => setMaintWaterLitres(v => Math.max(0, v - 1))} onChangeValue={v => setMaintWaterLitres(parseInt(v) || 0)} />
                <LineInput placeholder="mm" value={maintWaterMm} onPress={() => setMmModalField('maintWater')} />
                <MoreBtn onPress={() => setMmModalField('maintWater')} />
              </View>
            </LField>
          </LCard>
          </View>

          {/* Column 2: Added, Not Ordered (moved from Water & Additives) */}
          <View style={{flex: 1}}>
          <LCard title="Added, Not Ordered" icon="playlist-add" style={{flex: 0, alignSelf: 'flex-start', width: '100%'}}>
            <LField label={ft('super_plasticizer')} wide noBorder mandatory={mf('super_plasticizer')}>
              <View style={common.rowCenterGap8}>
                <LineInput placeholder="Select" value={addedValues['SUPER PLASTICIZER'] || ''} onPress={() => setAddedModalItem('SUPER PLASTICIZER')} />
                <MoreBtn onPress={() => setAddedModalItem('SUPER PLASTICIZER')} />
              </View>
            </LField>
            <View style={{marginTop: wp(12)}} />
            <LField label={ft('conveyor')} wide noBorder mandatory={mf('conveyor')}>
              <View style={common.rowCenterGap8}>
                <LineInput placeholder="Select" value={addedValues['CONVEYOR (IF NOT ON TICKET)'] || ''} onPress={() => setAddedModalItem('CONVEYOR (IF NOT ON TICKET)')} />
                <MoreBtn onPress={() => setAddedModalItem('CONVEYOR (IF NOT ON TICKET)')} />
              </View>
            </LField>
            <View style={{marginTop: wp(10)}} />
            {[
              {key: 'COLOR', apiKey: 'color'},
              {key: 'FIBER', apiKey: 'fiber'},
            ].map(item => (
              <LField key={item.key} label={ft(item.apiKey)} mandatory={mf(item.apiKey)}>
                <LineInput placeholder="Select" value={addedValues[item.key] || ''} onPress={() => setAddedModalItem(item.key)} />
                <MoreBtn onPress={() => setAddedModalItem(item.key)} />
              </LField>
            ))}
            <LField label={ft('other')} mandatory={mf('other')}>
              <LineInput placeholder="Enter value" value={addedValues['Other'] || ''} onChangeText={(text) => setAddedValues(prev => ({...prev, Other: text}))} />
            </LField>
          </LCard>
          </View>

          {/* Column 3: Options & Testing + Jobsite Notes (moved to last) */}
          <LCard title="Options & Testing" icon="checklist" style={{flex: 1}}>
            <ScrollView ref={jobScrollRef} style={{flex: 1}} showsVerticalScrollIndicator={true} bounces={false} nestedScrollEnabled>
              <LField label={ft('conveyor_ordered_not_used')} compact mandatory={mf('conveyor_ordered_not_used')}>
                <Check checked={!!conveyorOrdered} label="Not used" onPress={() => setConveyorOrdered(!conveyorOrdered)} />
              </LField>
              <LField label={ft('unloaded_conveyor')} compact mandatory={mf('unloaded_conveyor')}>
                <Check checked={!!unloadedConveyor} label="Not used" onPress={() => setUnloadedConveyor(!unloadedConveyor)} />
              </LField>
              <LField label={ft('load_disputed')} mandatory={mf('load_disputed')}>
                <Check checked={!!loadDisputed} onPress={() => setLoadDisputed(!loadDisputed)} />
              </LField>
              <LField label={ft('washout_area')} noBorder mandatory={mf('washout_area')}>
                <LineInput placeholder="Select area" value={washoutArea} onPress={() => setWashoutModalVisible(true)} />
                <MoreBtn onPress={() => setWashoutModalVisible(true)} />
              </LField>
              <>
              <View style={[ls.sectionDivider, {borderTopColor: c.borderLight}]}>
                <Text style={[ls.sectionLabel, {color: c.textMuted}]}>LOAD TESTING</Text>
              </View>
              <LField label={ft('load_tested')} noBorder mandatory={mf('load_tested')}>
                <View style={st.radioRow}>
                  <Radio selected={jobLoadTested === 'yes'} label="Yes" onPress={() => handleJobLoadTested('yes')} />
                  <Radio selected={jobLoadTested === 'no'} label="No" onPress={() => handleJobLoadTested('no')} />
                </View>
              </LField>
              {jobShouldShow('load_temp') && (
                <Animated.View style={{opacity: jobTestAnim, transform: [{translateY: jobTestAnim.interpolate({inputRange: [0, 1], outputRange: [12, 0]})}]}}>
                  <View style={[ls.sectionDivider, {borderTopColor: 'transparent'}]}>
                    <View style={{flexDirection: 'row', alignItems: 'center', gap: wp(4)}}>
                      <MaterialIcons name="science" size={ms(10)} color={c.primary} />
                      <Text style={[ls.sectionLabel, {color: c.primary, marginBottom: 0}]}>TEST RESULTS</Text>
                    </View>
                  </View>
                  <LFieldRow>
                    <LField label="TEMP(°c)" compact>
                      <Stepper value={String(jobLoadTemp)} unit="" onIncrement={() => setJobLoadTemp(v => v + 1)} onDecrement={() => setJobLoadTemp(v => Math.max(0, v - 1))} onChangeValue={v => setJobLoadTemp(parseInt(v) || 0)} />
                    </LField>
                    <LField label="AIR(%)" compact>
                      <Stepper value={String(jobLoadAir)} unit="" onIncrement={() => setJobLoadAir(v => v + 1)} onDecrement={() => setJobLoadAir(v => Math.max(0, v - 1))} onChangeValue={v => setJobLoadAir(parseInt(v) || 0)} />
                    </LField>
                  </LFieldRow>
                  <LFieldRow>
                    <LField label="SLUMP(mm)" compact>
                      <Stepper value={jobLoadSlump} unit="" onIncrement={() => setJobLoadSlump(v => String((parseInt(v) || 0) + 10))} onDecrement={() => setJobLoadSlump(v => String(Math.max(0, (parseInt(v) || 0) - 10)))} onChangeValue={setJobLoadSlump} />
                    </LField>
                    <LField label="CYLINDERS" compact>
                      <Stepper value={String(jobLoadCylinders)} unit="" onIncrement={() => setJobLoadCylinders(v => v + 1)} onDecrement={() => setJobLoadCylinders(v => Math.max(0, v - 1))} onChangeValue={v => setJobLoadCylinders(parseInt(v) || 0)} />
                    </LField>
                  </LFieldRow>
                </Animated.View>
              )}
              </>
              <View style={[ls.notesSection, {borderTopColor: c.borderLight}]}>
                <Text style={[ls.notesSectionLabel, {color: c.textMuted}]}>INTERNAL JOBSITE NOTES</Text>
                <TextInput
                  style={[ls.notesInput, {borderColor: c.border, color: c.textPrimary, backgroundColor: c.white, minHeight: wp(60)}]}
                  multiline
                  placeholderTextColor={c.textMuted}
                  placeholder="Enter jobsite notes..."
                  value={jobsiteNotes}
                  onChangeText={setJobsiteNotes}
                  textAlignVertical="top"
                />
              </View>
            </ScrollView>
          </LCard>
        </View>
        <ReasonListModal visible={fullLoadReasonModal} onSelect={setFullLoadReason} onClose={() => setFullLoadReasonModal(false)} />
        <SlumpPickerModal
          visible={mmModalField !== null}
          value={(mmModalField === 'fullLoad' ? fullLoadMm : mmModalField === 'custWater' ? custWaterMm : maintWaterMm) || ''}
          title={mmModalField === 'fullLoad' ? 'Full Load (mm)' : mmModalField === 'custWater' ? 'Customer Water (mm)' : 'Maintenance Water (mm)'}
          onConfirm={(val) => { if (mmModalField === 'fullLoad') setFullLoadMm(val); else if (mmModalField === 'custWater') setCustWaterMm(val); else if (mmModalField === 'maintWater') setMaintWaterMm(val); setMmModalField(null); }}
          onClose={() => setMmModalField(null)}
        />
        <ReasonListModal visible={addedModalItem !== null} options={['NOT ADDED', 'CUSTOMER', 'DRIVER']} onSelect={(val) => { if (addedModalItem) setAddedValues(prev => ({...prev, [addedModalItem]: val})); }} onClose={() => setAddedModalItem(null)} />
        <ReasonListModal visible={washoutModalVisible} options={['WHEELBARROW', 'DUMPSTER', 'BEHIND CURB LINE', 'STONE PILE ON JOB SITE', 'TRUCK MOUNTED WASHOUT', 'PUMP', 'OTHER']} onSelect={setWashoutArea} onClose={() => setWashoutModalVisible(false)} />
        <ReasonListModal
          visible={jobsiteNotesModal}
          options={['Uneven Subgrade', 'Wet/Hot/Frozen Subgrade', 'Old Concrete > 2 Hours', 'Blessed Surface', 'Surface Rained-on', 'No Curing of Concrete', 'Incorrect Amount of Cust. Added Product', 'Not Sampling Between 10 & 90% of Load', 'Minimum Sample Size Not 1ft/3 Buckets', 'Slump Test Incorrect', 'Air Test Incorrect', 'Cylinder Making Incorrect', 'Cylinder Storage Incorrect', 'No Comment']}
          onSelect={(val) => setJobsiteNotes(prev => prev ? prev + '\n' + val : val)}
          onClose={() => setJobsiteNotesModal(false)}
        />
        {jobShouldShow('load_temp') && (
          <SlumpPickerModal visible={jobLoadSlumpPickerVisible} title="Load Slump" value={jobLoadSlump} onConfirm={(val) => { setJobLoadSlump(val); setJobLoadSlumpPickerVisible(false); }} onClose={() => setJobLoadSlumpPickerVisible(false)} />
        )}
        <VoiceFormWizard visible={jVoiceWizardVisible} onClose={() => setJVoiceWizardVisible(false)} fields={JOBSITE_VOICE_FIELDS} onComplete={handleJobsiteVoiceComplete} keywords={JOBSITE_KEYWORDS} speakPrompts />
      </View>
    );
  }
  return (
    <View style={[st.tabBody, {backgroundColor: c.surface}]}>
      <View style={{flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between'}}>
        {!jAllFieldsFilled ? (
          <TouchableOpacity style={[st.voiceBtn, {backgroundColor: c.primary}]} onPress={() => setJVoiceWizardVisible(true)} activeOpacity={0.7}>
            <MaterialIcons name="mic" size={ms(14)} color="#FFF" />
          </TouchableOpacity>
        ) : <View />}
        <SaveButton disabled={jAllFieldsFilled || mandatoryJobMissing || (jHasApiData && !jIsDirty) || saving} onPress={handleSaveJobsite} />
      </View>
      <View pointerEvents={jAllFieldsFilled ? 'none' : 'auto'}>
      <CardsGrid>
      <FieldCard title="Water" icon="water-drop">
      <Field label={ft('full_load_litres')} mandatory={mf('full_load_litres')}>
        <Stepper value={String(fullLoadLitres)} unit="" highlight onIncrement={fullLoadLocked ? undefined : () => setFullLoadLitres(v => v + 1)} onDecrement={fullLoadLocked ? undefined : () => setFullLoadLitres(v => Math.max(0, v - 1))} onChangeValue={fullLoadLocked ? undefined : v => setFullLoadLitres(parseInt(v) || 0)} />
      </Field>
      <Field label={ft('full_load_reason')} mandatory={mf('full_load_reason')}>
        <LineInput placeholder="Reason" value={fullLoadReason} onPress={() => setFullLoadReasonModal(true)} />
        <MoreBtn onPress={() => setFullLoadReasonModal(true)} />
      </Field>
      <Field label={ft('full_load_mm')} mandatory={mf('full_load_mm')}>
        <LineInput width={80} placeholder="mm" value={fullLoadMm} onPress={() => setMmModalField('fullLoad')} />
        <MoreBtn onPress={() => setMmModalField('fullLoad')} />
      </Field>
      <Field label={ft('customer_water_litres')} mandatory={mf('customer_water_litres')}>
        <Stepper value={String(custWaterLitres)} unit="" onIncrement={() => setCustWaterLitres(v => v + 1)} onDecrement={() => setCustWaterLitres(v => Math.max(0, v - 1))} onChangeValue={v => setCustWaterLitres(parseInt(v) || 0)} />
        <LineInput width={80} placeholder="mm" value={custWaterMm} onPress={() => setMmModalField('custWater')} />
        <MoreBtn onPress={() => setMmModalField('custWater')} />
      </Field>
      <Field label={ft('maintenance_water_litres')} last mandatory={mf('maintenance_water_litres')}>
        <Stepper value={String(maintWaterLitres)} unit="" onIncrement={() => setMaintWaterLitres(v => v + 1)} onDecrement={() => setMaintWaterLitres(v => Math.max(0, v - 1))} onChangeValue={v => setMaintWaterLitres(parseInt(v) || 0)} />
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
      <Field label={ft('super_plasticizer')} mandatory={mf('super_plasticizer')}>
        <LineInput placeholder="Value" value={addedValues['SUPER PLASTICIZER'] || ''} onPress={() => setAddedModalItem('SUPER PLASTICIZER')} />
        <MoreBtn onPress={() => setAddedModalItem('SUPER PLASTICIZER')} />
      </Field>
      <Field label={ft('conveyor')} mandatory={mf('conveyor')}>
        <LineInput placeholder="Value" value={addedValues['CONVEYOR (IF NOT ON TICKET)'] || ''} onPress={() => setAddedModalItem('CONVEYOR (IF NOT ON TICKET)')} />
        <MoreBtn onPress={() => setAddedModalItem('CONVEYOR (IF NOT ON TICKET)')} />
      </Field>
      {[
        {key: 'COLOR', apiKey: 'color'},
        {key: 'FIBER', apiKey: 'fiber'},
        {key: 'Other', apiKey: 'other'},
      ].map(item => (
        <Field key={item.key} label={ft(item.apiKey)} last={item.key === 'Other'} mandatory={mf(item.apiKey)}>
          <LineInput placeholder="Value" value={addedValues[item.key] || ''} onPress={item.key !== 'Other' ? () => setAddedModalItem(item.key) : undefined} onChangeText={item.key === 'Other' ? (text) => setAddedValues(prev => ({...prev, [item.key]: text})) : undefined} />
          {item.key !== 'Other' && <MoreBtn onPress={() => setAddedModalItem(item.key)} />}
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
        <Field label={ft('conveyor_ordered_not_used')} compact mandatory={mf('conveyor_ordered_not_used')}><Check checked={!!conveyorOrdered} label="Not used" onPress={() => setConveyorOrdered(!conveyorOrdered)} /></Field>
        <Field label={ft('washout_area')} compact mandatory={mf('washout_area')}>
          <LineInput placeholder="Area" value={washoutArea} onPress={() => setWashoutModalVisible(true)} />
          <MoreBtn onPress={() => setWashoutModalVisible(true)} />
        </Field>
      </FieldRow>
      <View style={{flexDirection: 'row', gap: wp(8), paddingVertical: wp(5), borderBottomWidth: 0.5, borderBottomColor: c.borderLight}}>
        <View style={{flex: 1, flexDirection: 'row', alignItems: 'center', gap: wp(4)}}>
          <Text style={[st.fieldCompactLabel, {color: c.textMuted, marginBottom: 0}]}>{ft('load_disputed')}</Text>
          <Check checked={!!loadDisputed} onPress={() => setLoadDisputed(!loadDisputed)} />
        </View>
        <View style={{flex: 1, flexDirection: 'row', alignItems: 'center', gap: wp(4)}}>
          <Text style={[st.fieldCompactLabel, {color: c.textMuted, marginBottom: 0}]}>{ft('unloaded_conveyor')}</Text>
          <Check checked={!!unloadedConveyor} onPress={() => setUnloadedConveyor(!unloadedConveyor)} />
        </View>
      </View>
      <Field label={ft('load_tested')} last={!jobShouldShow('load_temp')} mandatory={mf('load_tested')}>
        <View style={st.radioRow}>
          <Radio selected={jobLoadTested === 'yes'} label="Yes" onPress={() => setJobLoadTested('yes')} />
          <Radio selected={jobLoadTested === 'no'} label="No" onPress={() => setJobLoadTested('no')} />
        </View>
      </Field>
      {jobShouldShow('load_temp') && (
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
      <FieldCard title="Internal Jobsite Notes" icon="edit-note" fullWidth>
      <Field label={ft('notes')} wide last mandatory={mf('notes')}>
        <NoteInput placeholder="Enter jobsite notes..." value={jobsiteNotes} onChangeText={setJobsiteNotes} />
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
      <VoiceFormWizard
        visible={jVoiceWizardVisible}
        onClose={() => setJVoiceWizardVisible(false)}
        fields={JOBSITE_VOICE_FIELDS}
        onComplete={handleJobsiteVoiceComplete}
        keywords={JOBSITE_KEYWORDS}
        speakPrompts
      />
    </View>
  );
}

// ─── DISPOSAL METHOD OPTIONS ───
const DISPOSAL_METHODS = [
  {key: 'RESHIPPED_IN_YARD', label: 'Reshipped in Yard', icon: 'local-shipping'},
  {key: 'DUMPED_IN_YARD', label: 'Dumped in Yard', icon: 'terrain'},
  {key: 'DUMPED_AT_THIRD_PARTY_YARD', label: 'Dumped at Third Party Yard', icon: 'warehouse'},
  {key: 'MADE_BLOCKS', label: 'Made Blocks', icon: 'view-module'},
  {key: 'USED_FOR_PLANT_SHOP', label: 'Used for Plant/Shop', icon: 'factory'},
  {key: 'RE_ROUTED_TO_DIFFERENT_SITE', label: 'Re-routed to Different Site', icon: 'alt-route'},
  {key: 'GRANULIZE', label: 'Granulize', icon: 'grain'},
];

const RETURN_REASONS = [
  {key: 'REJECTED_AIR_OUT_OF_SPEC', label: 'Rejected - Air Out of Spec', icon: 'air'},
  {key: 'REJECTED_SLUMP_OUT_OF_SPEC', label: 'Rejected - Slump Out of Spec', icon: 'trending-down'},
  {key: 'REJECTED_TEMPERATURE', label: 'Rejected - Temperature', icon: 'thermostat'},
  {key: 'REJECTED_BALLING', label: 'Rejected - Balling', icon: 'circle'},
  {key: 'REJECTED_TIME_LIMIT_EXCEEDED', label: 'Rejected - Time Limit Exceeded', icon: 'timer-off'},
  {key: 'POUR_COMPLETE_NOT_NEEDED', label: 'Pour Complete - Not Needed', icon: 'check-circle-outline'},
  {key: 'OTHER_DRIVER_ADD_NOTES', label: 'Other - Driver Add Notes', icon: 'edit-note'},
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
  options: {key: string; label?: string; icon: string}[];
  selected: string;
  onSave: (val: string) => void;
  onClose: () => void;
}) {
  const {c} = useTheme();
  const {width: _smW, height: _smH} = useWindowDimensions();
  const _smLand = _smW > _smH;
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

  const handleItemPress = (key: string) => {
    if (_smLand) {
      // Landscape: select + save + close immediately
      animateClose(() => {
        onSave(key);
        onClose();
      });
    } else {
      setTempSelected(key);
    }
  };

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
              onPress={() => handleItemPress(opt.key)}>
              <View style={[sm.itemIcon, {backgroundColor: isSelected ? c.primary : c.surface}]}>
                <MaterialIcons name={opt.icon as any} size={ms(20)} color={isSelected ? c.textOnPrimary : c.textSecondary} />
              </View>
              <Text style={[
                sm.itemText,
                {color: c.textPrimary},
                isSelected && {color: c.primary, fontWeight: '800'},
              ]}>
                {opt.label || opt.key}
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

      {/* Footer — portrait only */}
      {!_smLand && (
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
      )}
    </ResponsiveModal>
  );
}

function _createSm() { return StyleSheet.create({
  header: {flexDirection: 'row', alignItems: 'center', gap: wp(6), paddingHorizontal: wp(12), paddingVertical: wp(6), borderBottomWidth: 1},
  headerIcon: {width: wp(26), height: wp(26), borderRadius: wp(8), justifyContent: 'center', alignItems: 'center'},
  headerTitle: {fontSize: ms(14), fontWeight: '900', letterSpacing: 0.3},
  headerSub: {fontSize: ms(9), fontWeight: '500', marginTop: 0},
  closeBtn: {width: wp(28), height: wp(28), borderRadius: wp(14), justifyContent: 'center', alignItems: 'center', elevation: 3, shadowColor: '#000', shadowOffset: {width: 0, height: 2}, shadowOpacity: 0.12, shadowRadius: 6},
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
  confirmBtn: {elevation: 4, shadowColor: '#000', shadowOffset: {width: 0, height: 2}, shadowOpacity: 0.18, shadowRadius: 8},
}); }

// ─── RETURNED TAB ───
function ReturnedTab({data, ticketId, onSaveResult, setSavingOverlay, refreshRecord}: {data: DeliveryRecord | null; ticketId?: number; onSaveResult?: (success: boolean, message: string) => void; setSavingOverlay?: (v: boolean) => void; refreshRecord?: () => Promise<void>}) {
  const {c} = useTheme();
  const {saveDeliveryTab} = useOfflineSync();
  const fd = data?.field_definitions?.returned || {};
  const fdKeys = Object.keys(fd);
  const hasField = (field: string) => field in fd;
  const ft = (field: string) => (fd as any)?.[field]?.title || field.replace(/_/g, ' ').replace(/\b\w/g, (ch: string) => ch.toUpperCase());
  const mf = (field: string) => (fd as any)?.[field]?.mandatory ?? false;
  const {width: _rtW, height: _rtH} = useWindowDimensions();
  const _rtLand = _rtW > _rtH;
  const r = data?.returned;
  const rAllFieldsFilled = r != null && fdKeys.length > 0 && fdKeys.every(k => {
    const val = (r as any)?.[k];
    return val != null && val !== '';
  });
  const rHasApiData = r != null && fdKeys.some(k => (r as any)?.[k] != null);
  const concreteLocked = r?.returned_concrete_m3 != null;

  const [concreteVal, setConcreteVal] = useState(r?.returned_concrete_m3 != null ? String(r.returned_concrete_m3) : '');
  const [disposalMethod, setDisposalMethod] = useState(r?.disposal_method || '');
  const [returnReason, setReturnReason] = useState(r?.reason_for_return || '');
  const [saving, setSaving] = useState(false);
  const [rIsDirty, setRIsDirty] = useState(false);
  const [disposalModal, setDisposalModal] = useState(false);
  const [reasonModal, setReasonModal] = useState(false);
  const [rVoiceWizardVisible, setRVoiceWizardVisible] = useState(false);

  const retFieldValues: Record<string, any> = {
    returned_concrete_m3: concreteVal?.trim?.(), disposal_method: disposalMethod, reason_for_return: returnReason,
  };
  const mandatoryRetMissing = fdKeys.some(k => {
    if (!(fd as any)?.[k]?.mandatory) return false;
    const f = k;
    const v = retFieldValues[f];
    return v === '' || v === null || v === undefined;
  });

  const RETURNED_VOICE_FIELDS: VoiceField[] = [
    {key: 'concreteVal', label: ft('returned_concrete_m3'), prompt: `How much ${ft('returned_concrete_m3').toLowerCase()}?`, type: 'number', skip: concreteLocked, required: mf('returned_concrete_m3'), min: 0, max: 999},
    {key: 'disposalMethod', label: ft('disposal_method'), prompt: `What was the ${ft('disposal_method').toLowerCase()}?`, type: 'choice', choices: DISPOSAL_METHODS.map(m => m.label)},
    {key: 'returnReason', label: ft('reason_for_return'), prompt: `What was the ${ft('reason_for_return').toLowerCase()}?`, type: 'choice', choices: RETURN_REASONS.map(r => r.label)},
  ];

  const RETURNED_KEYWORDS = ['concrete', 'reshipped', 'dumped', 'blocks', 'granulize', 'rejected', 'slump', 'temperature', 'balling', 'pour complete'];

  const handleReturnedVoiceComplete = useCallback((voiceResults: VoiceResults) => {
    if (voiceResults.concreteVal && !concreteLocked) setConcreteVal(voiceResults.concreteVal);
    if (voiceResults.disposalMethod) {
      const match = DISPOSAL_METHODS.find(m => m.label.toLowerCase() === voiceResults.disposalMethod.toLowerCase());
      setDisposalMethod(match ? match.key : voiceResults.disposalMethod);
    }
    if (voiceResults.returnReason) {
      const match = RETURN_REASONS.find(r => r.label.toLowerCase() === voiceResults.returnReason.toLowerCase());
      setReturnReason(match ? match.key : voiceResults.returnReason);
    }
  }, [concreteLocked]);

  const rDirtyMountRef = useRef(false);
  useEffect(() => {
    if (!rDirtyMountRef.current) { rDirtyMountRef.current = true; return; }
    if (rHasApiData) setRIsDirty(true);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [concreteVal, disposalMethod, returnReason]);

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

  const handleSave = async () => {
    if (mandatoryRetMissing || !isConcreteValid || !ticketId) return;
    setSaving(true);
    setSavingOverlay?.(true);
    try {
      const result = await saveDeliveryTab(ticketId, 'returned', {
        returned_concrete_m3: Number(concreteVal),
        disposal_method: disposalMethod || null,
        reason_for_return: returnReason || null,
      });
      if (!result.offline) await refreshRecord?.();
      onSaveResult?.(result.success, result.message);
    } catch (err: any) {
      onSaveResult?.(false, err.message || 'Failed to save returned data.');
    } finally {
      setSaving(false);
      setSavingOverlay?.(false);
    }
  };

  if (_rtLand) {
    return (
      <View style={[ls.root, {backgroundColor: c.surface}]}>
        <View style={[ls.topBar, {flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between'}]}>
          {!rAllFieldsFilled ? (
            <TouchableOpacity style={[st.voiceBtn, {backgroundColor: c.primary}]} onPress={() => setRVoiceWizardVisible(true)} activeOpacity={0.7}>
              <MaterialIcons name="mic" size={ms(14)} color="#FFF" />
            </TouchableOpacity>
          ) : <View />}
          <LSaveButton disabled={rAllFieldsFilled || mandatoryRetMissing || !isConcreteValid || (rHasApiData && !rIsDirty) || saving} onPress={handleSave} />
        </View>
        <View style={ls.columns} pointerEvents={rAllFieldsFilled ? 'none' : 'auto'}>
          <LCard title="Return Details" icon="assignment-return">
            <LField label={ft('returned_concrete_m3')} mandatory={mf('returned_concrete_m3')}>
              <View style={[st.numericInput, {backgroundColor: '#FFFF00', borderColor: c.primaryBorder}]}>
                <TextInput
                  style={[st.numericInputText, {color: c.textPrimary}]}
                  value={concreteVal}
                  onChangeText={concreteLocked ? undefined : handleConcreteChange}
                  editable={!concreteLocked}
                  keyboardType="decimal-pad"
                  maxLength={8}
                  selectTextOnFocus
                  placeholder="0.00"
                  placeholderTextColor={c.textMuted}
                />
              </View>
              <Text style={[st.unitInline, {color: c.textSecondary}]}>M3</Text>
            </LField>
            <LField label={ft('disposal_method')} mandatory={mf('disposal_method')}>
              <LineInput placeholder="Select method" value={DISPOSAL_METHODS.find(m => m.key === disposalMethod)?.label || disposalMethod || ''} onPress={() => setDisposalModal(true)} />
              <MoreBtn onPress={() => setDisposalModal(true)} />
            </LField>
            <LField label={ft('reason_for_return')} noBorder mandatory={mf('reason_for_return')}>
              <LineInput placeholder="Select reason" value={RETURN_REASONS.find(r => r.key === returnReason)?.label || returnReason || ''} onPress={() => setReasonModal(true)} />
              <MoreBtn onPress={() => setReasonModal(true)} />
            </LField>
          </LCard>
        </View>

        <SelectionModal visible={disposalModal} title="Disposal Method" subtitle="Select a disposal method" headerIcon="delete-sweep" options={DISPOSAL_METHODS} selected={disposalMethod} onSave={setDisposalMethod} onClose={() => setDisposalModal(false)} />
        <SelectionModal visible={reasonModal} title="Reason for Return" subtitle="Select a return reason" headerIcon="assignment-return" options={RETURN_REASONS} selected={returnReason} onSave={setReturnReason} onClose={() => setReasonModal(false)} />
        <VoiceFormWizard visible={rVoiceWizardVisible} onClose={() => setRVoiceWizardVisible(false)} fields={RETURNED_VOICE_FIELDS} onComplete={handleReturnedVoiceComplete} keywords={RETURNED_KEYWORDS} speakPrompts />
      </View>
    );
  }

  return (
    <View style={[st.tabBody, {backgroundColor: c.surface}]}>
      <View style={{flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between'}}>
        {!rAllFieldsFilled ? (
          <TouchableOpacity style={[st.voiceBtn, {backgroundColor: c.primary}]} onPress={() => setRVoiceWizardVisible(true)} activeOpacity={0.7}>
            <MaterialIcons name="mic" size={ms(14)} color="#FFF" />
          </TouchableOpacity>
        ) : <View />}
        <SaveButton disabled={rAllFieldsFilled || mandatoryRetMissing || !isConcreteValid || (rHasApiData && !rIsDirty) || saving} onPress={handleSave} />
      </View>

      <View pointerEvents={rAllFieldsFilled ? 'none' : 'auto'}>
      <CardsGrid>
      <FieldCard title="Return Details" icon="assignment-return">
      {/* Returned Concrete */}
      <Field label={ft('returned_concrete_m3')} mandatory={mf('returned_concrete_m3')}>
        <View style={[st.numericInput, {backgroundColor: '#FFFF00', borderColor: c.primaryBorder}]}>
          <TextInput
            style={[st.numericInputText, {color: c.textPrimary}]}
            value={concreteVal}
            onChangeText={concreteLocked ? undefined : handleConcreteChange}
            editable={!concreteLocked}
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
      <Field label={ft('disposal_method')} mandatory={mf('disposal_method')}>
        <TouchableOpacity
          style={[st.selectorBtn, common.selectorCompact, {backgroundColor: isDisposalValid ? c.primarySurface : c.surface, borderColor: isDisposalValid ? c.primary : c.border}]}
          activeOpacity={0.6}
          onPress={() => setDisposalModal(true)}>
          {isDisposalValid && (
            <View style={[{width: wp(22), height: wp(22), borderRadius: wp(6), justifyContent: 'center', alignItems: 'center', backgroundColor: c.primary}]}>
              <MaterialIcons name={DISPOSAL_METHODS.find(m => m.key === disposalMethod)?.icon as any} size={ms(16)} color={c.textOnPrimary} />
            </View>
          )}
          <Text style={[st.selectorText, {color: isDisposalValid ? c.primary : c.textMuted}]} numberOfLines={1} ellipsizeMode="tail">
            {DISPOSAL_METHODS.find(m => m.key === disposalMethod)?.label || disposalMethod || 'Select method'}
          </Text>
          <MaterialIcons name="keyboard-arrow-down" size={ms(20)} color={isDisposalValid ? c.primary : c.textMuted} />
        </TouchableOpacity>
      </Field>

      {/* Reason for Return */}
      <Field label={ft('reason_for_return')} last mandatory={mf('reason_for_return')}>
        <TouchableOpacity
          style={[st.selectorBtn, common.selectorCompact, {backgroundColor: isReasonValid ? c.primarySurface : c.surface, borderColor: isReasonValid ? c.primary : c.border}]}
          activeOpacity={0.6}
          onPress={() => setReasonModal(true)}>
          {isReasonValid && (
            <View style={[{width: wp(22), height: wp(22), borderRadius: wp(6), justifyContent: 'center', alignItems: 'center', backgroundColor: c.primary}]}>
              <MaterialIcons name={RETURN_REASONS.find(r => r.key === returnReason)?.icon as any} size={ms(16)} color={c.textOnPrimary} />
            </View>
          )}
          <Text style={[st.selectorText, {color: isReasonValid ? c.primary : c.textMuted}]} numberOfLines={1} ellipsizeMode="tail">
            {RETURN_REASONS.find(r => r.key === returnReason)?.label || returnReason || 'Select reason'}
          </Text>
          <MaterialIcons name="keyboard-arrow-down" size={ms(20)} color={isReasonValid ? c.primary : c.textMuted} />
        </TouchableOpacity>
      </Field>
      </FieldCard>
      </CardsGrid>
      </View>

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
      <VoiceFormWizard
        visible={rVoiceWizardVisible}
        onClose={() => setRVoiceWizardVisible(false)}
        fields={RETURNED_VOICE_FIELDS}
        onComplete={handleReturnedVoiceComplete}
        keywords={RETURNED_KEYWORDS}
        speakPrompts
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

function TimeAdjustTab({data, ticketId, onSaveResult, setSavingOverlay, refreshRecord}: {data: DeliveryRecord | null; ticketId?: number; onSaveResult?: (success: boolean, message: string) => void; setSavingOverlay?: (v: boolean) => void; refreshRecord?: () => Promise<void>}) {
  const {c} = useTheme();
  const {saveDeliveryTab} = useOfflineSync();
  const fd = data?.field_definitions?.time || {};
  const fdKeys = Object.keys(fd);
  const hasField = (field: string) => field in fd;
  const ft = (field: string) => (fd as any)?.[field]?.title || field.replace(/_/g, ' ').replace(/\b\w/g, (ch: string) => ch.toUpperCase());
  const {width: _tw, height: _th} = useWindowDimensions();
  const _tLand = _tw > _th;
  const timeSteps = data?.time?.steps;
  const tAllFieldsFilled = timeSteps != null && timeSteps.every(step => step.time != null);
  const [saving, setSaving] = useState(false);
  const handleSaveTime = async () => {
    if (!ticketId) return;
    const uiToApi: Record<string, string> = {
      'LEAVE PLANT': 'leave_plant',
      'ARRIVE JOB': 'arrive_job',
      'START POUR': 'start_pour',
      'WASHING': 'washing',
      'LEAVE JOB': 'leave_job',
      'AT PLANT': 'at_plant',
    };
    const body: Record<string, string | null> = {};
    TIME_EVENTS.forEach(e => {
      const apiKey = uiToApi[e.key];
      if (apiKey) {
        body[apiKey] = selectedTimes[e.key] ? selectedTimes[e.key].toISOString() : null;
      }
    });
    setSaving(true);
    setSavingOverlay?.(true);
    try {
      const result = await saveDeliveryTab(ticketId, 'time', body);
      if (!result.offline) await refreshRecord?.();
      onSaveResult?.(result.success, result.message);
    } catch (err: any) {
      onSaveResult?.(false, err.message || 'Failed to save time data.');
    } finally {
      setSaving(false);
      setSavingOverlay?.(false);
    }
  };
  const [selectedTimes, setSelectedTimes] = useState<{[key: string]: Date}>(() => {
    if (!timeSteps) return {};
    const times: {[key: string]: Date} = {};
    const keyMap: Record<string, string> = {
      leave_plant: 'LEAVE PLANT',
      arrive_job: 'ARRIVE JOB',
      start_pour: 'START POUR',
      washing: 'WASHING',
      leave_job: 'LEAVE JOB',
      at_plant: 'AT PLANT',
    };
    timeSteps.forEach(step => {
      const uiKey = keyMap[step.key];
      if (uiKey && step.time) {
        times[uiKey] = new Date(step.time);
      }
    });
    return times;
  });
  const [pickerVisible, setPickerVisible] = useState(false);
  const [pickerField, setPickerField] = useState<string | null>(null);

  const filledCount = TIME_EVENTS.filter(e => !!selectedTimes[e.key]).length;
  const allFilled = filledCount === TIME_EVENTS.length;

  const timeContent = (
    <>
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
      <View style={[tt.listCard, {backgroundColor: c.white, shadowColor: c.shadowColor}]} pointerEvents={tAllFieldsFilled ? 'none' : 'auto'}>
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
                <Text style={[tt.label, {color: c.textPrimary}]}>{ft(({'LEAVE PLANT':'leave_plant','ARRIVE JOB':'arrive_job','START POUR':'start_pour','WASHING':'washing','LEAVE JOB':'leave_job','AT PLANT':'at_plant'} as Record<string,string>)[event.key] || event.key)}</Text>
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
      <SaveButton disabled={tAllFieldsFilled || saving} onPress={handleSaveTime} />
    </>
  );

  return (
    <View style={[st.tabBody, {backgroundColor: c.surface}]}>
      {_tLand ? (
        <ScrollView showsVerticalScrollIndicator nestedScrollEnabled>
          {timeContent}
        </ScrollView>
      ) : timeContent}

      <DateTimePicker
        mode="time"
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

function _createTt() { return StyleSheet.create({
  headerCard: {borderRadius: wp(10), padding: wp(10), marginBottom: wp(8)},
  headerTop: {flexDirection: 'row', alignItems: 'center', gap: wp(8), marginBottom: wp(6)},
  headerIconWrap: {width: wp(28), height: wp(28), borderRadius: wp(8), justifyContent: 'center', alignItems: 'center'},
  headerTitle: {fontSize: ms(12), fontWeight: '800', letterSpacing: 0.2},
  headerSub: {fontSize: ms(9), fontWeight: '500', marginTop: 1},
  countPill: {paddingHorizontal: wp(7), paddingVertical: wp(2), borderRadius: wp(8), borderWidth: 1.5},
  countText: {fontSize: ms(9), fontWeight: '800'},
  track: {height: wp(3), borderRadius: wp(2), overflow: 'hidden'},
  fill: {position: 'absolute', left: 0, top: 0, bottom: 0, borderRadius: wp(2)},
  listCard: {borderRadius: wp(10), overflow: 'hidden', marginBottom: wp(8)},
  row: {flexDirection: 'row', alignItems: 'center', paddingVertical: wp(6), paddingHorizontal: wp(10), gap: wp(8)},
  stepCol: {alignItems: 'center', width: wp(20)},
  dot: {width: wp(18), height: wp(18), borderRadius: wp(9), borderWidth: 2, justifyContent: 'center', alignItems: 'center', zIndex: 1},
  dotNum: {fontSize: ms(8), fontWeight: '800'},
  line: {width: 2, flex: 1, marginTop: -1, marginBottom: wp(-6)},
  iconWrap: {width: wp(26), height: wp(26), borderRadius: wp(7), justifyContent: 'center', alignItems: 'center'},
  label: {fontSize: ms(10), fontWeight: '700', letterSpacing: 0.2},
  value: {fontSize: ms(9), fontWeight: '600', marginTop: 1},
  editBtn: {width: wp(24), height: wp(24), borderRadius: wp(7), justifyContent: 'center', alignItems: 'center'},
}); }

// ─── COD PAYMENT TYPES ───
const PAYMENT_TYPES = [
  {key: 'prepaid_cc', label: 'PREPAID CREDIT CARD', icon: 'credit-card'},
  {key: 'cash', label: 'CASH', icon: 'payments'},
  {key: 'check', label: 'CHECK', icon: 'receipt-long'},
  {key: 'other', label: 'OTHER', icon: 'more-horiz'},
];

// ─── COD TAB ───
function CodTab({data, ticketId, onSaveResult, setSavingOverlay, refreshRecord}: {data: DeliveryRecord | null; ticketId?: number; onSaveResult?: (success: boolean, message: string) => void; setSavingOverlay?: (v: boolean) => void; refreshRecord?: () => Promise<void>}) {
  const {c} = useTheme();
  const {saveDeliveryTab} = useOfflineSync();
  const fd = data?.field_definitions?.cod || {};
  const fdKeys = Object.keys(fd);
  const hasField = (field: string) => field in fd;
  const ft = (field: string) => (fd as any)?.[field]?.title || field.replace(/_/g, ' ').replace(/\b\w/g, (ch: string) => ch.toUpperCase());
  const mf = (field: string) => (fd as any)?.[field]?.mandatory ?? false;
  const {width: _codW, height: _codH} = useWindowDimensions();
  const _codLand = _codW > _codH;
  const codData = data?.cod;
  const codAllFieldsFilled = codData != null && fdKeys.length > 0 && fdKeys.every(k => {
    const val = (codData as any)?.[k];
    return val != null && val !== '';
  });

  const [saving, setSaving] = useState(false);
  const keyToApiCode: Record<string, string> = {
    prepaid_cc: 'PREPAID_CREDIT_CARD',
    cash: 'CASH',
    check: 'CHECK',
    other: 'OTHER',
  };
  const handleSaveCod = async () => {
    if (!ticketId) return;
    setSaving(true);
    setSavingOverlay?.(true);
    try {
      const result = await saveDeliveryTab(ticketId, 'cod', {
        payment_type: paymentType ? (keyToApiCode[paymentType] || null) : null,
        amount: codAmount !== '' ? Number(codAmount) : null,
        wait_time_minutes: waitTime,
        notes: codNotes || null,
      });
      if (!result.offline) await refreshRecord?.();
      onSaveResult?.(result.success, result.message);
    } catch (err: any) {
      onSaveResult?.(false, err.message || 'Failed to save COD data.');
    } finally {
      setSaving(false);
      setSavingOverlay?.(false);
    }
  };
  // Map API payment_type codes to local UI keys
  const paymentCodeToKey: Record<string, string> = {
    PREPAID_CREDIT_CARD: 'prepaid_cc',
    CASH: 'cash',
    CHECK: 'check',
    OTHER: 'other',
  };
  const [paymentType, setPaymentType] = useState(codData?.payment_type ? (paymentCodeToKey[codData.payment_type] || '') : '');
  const [paymentModal, setPaymentModal] = useState(false);
  const [waitTime, setWaitTime] = useState(codData?.wait_time_minutes ?? 0);
  const [waitPickerOpen, setWaitPickerOpen] = useState(false);
  const [codNotes, setCodNotes] = useState(codData?.notes || '');
  const [codAmount, setCodAmount] = useState(codData?.amount != null ? String(codData.amount) : '');
  const [notesFocused, setNotesFocused] = useState(false);
  const [codVoiceWizardVisible, setCodVoiceWizardVisible] = useState(false);

  const codFieldValues: Record<string, any> = {
    payment_type: paymentType, amount: codAmount?.trim?.(),
    wait_time_minutes: waitTime, notes: codNotes,
  };
  const mandatoryCodMissing = fdKeys.some(k => {
    if (!(fd as any)?.[k]?.mandatory) return false;
    const v = codFieldValues[k];
    return v === '' || v === null || v === undefined;
  });

  const COD_VOICE_FIELDS: VoiceField[] = [
    {key: 'paymentType', label: ft('payment_type'), prompt: `What is the ${ft('payment_type').toLowerCase()}? Say prepaid credit card, cash, check, or other.`, type: 'choice', choices: PAYMENT_TYPES.map(p => p.label)},
    {key: 'codAmount', label: ft('amount'), prompt: `What is the ${ft('amount').toLowerCase()} in dollars?`, type: 'number', min: 0, max: 99999},
    {key: 'waitTime', label: ft('wait_time_minutes'), prompt: `How many ${ft('wait_time_minutes').toLowerCase()}?`, type: 'number', min: 0, max: 999},
    {key: 'codNotes', label: ft('notes'), prompt: `Dictate any ${ft('notes').toLowerCase()}.`, type: 'text'},
  ];

  const COD_KEYWORDS = ['prepaid', 'credit card', 'cash', 'check', 'minutes', 'wait'];

  const handleCodVoiceComplete = useCallback((voiceResults: VoiceResults) => {
    if (voiceResults.paymentType) {
      const match = PAYMENT_TYPES.find(p => p.label.toLowerCase() === voiceResults.paymentType.toLowerCase());
      if (match) setPaymentType(match.key);
    }
    if (voiceResults.codAmount) setCodAmount(voiceResults.codAmount);
    if (voiceResults.waitTime) setWaitTime(parseInt(voiceResults.waitTime) || 0);
    if (voiceResults.codNotes) setCodNotes(voiceResults.codNotes);
  }, []);

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

  const codContent = (
    <>
      <View style={{flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: wp(6)}}>
        {!codAllFieldsFilled ? (
          <TouchableOpacity style={[st.voiceBtn, {backgroundColor: c.primary}]} onPress={() => setCodVoiceWizardVisible(true)} activeOpacity={0.7}>
            <MaterialIcons name="mic" size={ms(14)} color="#FFF" />
          </TouchableOpacity>
        ) : <View />}
        <SaveButton disabled={codAllFieldsFilled || mandatoryCodMissing || saving} onPress={handleSaveCod} />
      </View>

      <View pointerEvents={codAllFieldsFilled ? 'none' : 'auto'}>
      <CardsGrid>
      <FieldCard title="Payment Details" icon="payments">
      {/* Payment Type Selector */}
      <Field label={ft('payment_type')} mandatory={mf('payment_type')}>
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
      {/* Wait Time */}
      <Field label={ft('wait_time_minutes')} mandatory={mf('wait_time_minutes')}>
        <View style={st.stepperWrap}>
          <View style={[st.numInput, {backgroundColor: waitTime > 0 ? c.primarySurface : c.surface, borderColor: waitTime > 0 ? c.primaryBorder : 'transparent'}]}>
            <TextInput
              style={[st.numInputText, {color: waitTime > 0 ? c.primary : c.textPrimary}]}
              value={waitTime === 0 ? '' : String(waitTime)}
              placeholder="0"
              placeholderTextColor={c.textMuted}
              keyboardType="number-pad"
              onChangeText={text => setWaitTime(parseInt(text.replace(/[^0-9]/g, '')) || 0)}
            />
          </View>
          <TouchableOpacity style={[st.pickerToggle, {backgroundColor: c.surface, borderColor: c.border}]} activeOpacity={0.7} onPress={() => setWaitPickerOpen(true)}>
            <MaterialIcons name="unfold-more" size={ms(11)} color={c.textSecondary} />
          </TouchableOpacity>
          <View style={[st.unitBadge, {backgroundColor: c.surface, borderColor: c.border}]}>
            <Text style={[st.unitBadgeText, {color: c.textSecondary}]}>Min</Text>
          </View>
        </View>
        <ResponsiveModal visible={waitPickerOpen} onClose={() => setWaitPickerOpen(false)} maxWidth={320} maxHeightPercent={50}>
          <View style={[st.pickerHeader, {borderBottomColor: c.border}]}>
            <Text style={[st.pickerTitle, {color: c.textPrimary}]}>Select Wait Time</Text>
            <TouchableOpacity style={[st.pickerCloseBtn, {backgroundColor: c.surface}]} onPress={() => setWaitPickerOpen(false)} activeOpacity={0.7}>
              <MaterialIcons name="close" size={ms(18)} color={c.textSecondary} />
            </TouchableOpacity>
          </View>
          <ScrollView showsVerticalScrollIndicator={false} bounces={false} contentContainerStyle={st.pickerList}>
            {['0','5','10','15','20','25','30','45','60','90','120'].map(v => {
              const isSelected = v === String(waitTime);
              return (
                <TouchableOpacity key={v} style={[st.pickerItem, {borderBottomColor: c.borderLight}, isSelected && {backgroundColor: c.primarySurface}]} activeOpacity={0.6} onPress={() => { setWaitTime(parseInt(v)); setWaitPickerOpen(false); }}>
                  <Text style={[st.pickerItemText, {color: isSelected ? c.primary : c.textPrimary}, isSelected && {fontWeight: '800'}]}>{v} Min</Text>
                  {isSelected && <MaterialIcons name="check-circle" size={ms(16)} color={c.primary} />}
                </TouchableOpacity>
              );
            })}
          </ScrollView>
        </ResponsiveModal>
      </Field>
      </FieldCard>

      <FieldCard fullWidth>
      {/* COD Notes */}
      <Field label={ft('notes')} wide last mandatory={mf('notes')}>
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
      </View>
    </>
  );

  return (
    <View style={[st.tabBody, {backgroundColor: c.surface}]}>
      {_codLand ? (
        <ScrollView showsVerticalScrollIndicator nestedScrollEnabled keyboardShouldPersistTaps="handled">
          {codContent}
        </ScrollView>
      ) : codContent}

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
      <VoiceFormWizard
        visible={codVoiceWizardVisible}
        onClose={() => setCodVoiceWizardVisible(false)}
        fields={COD_VOICE_FIELDS}
        onComplete={handleCodVoiceComplete}
        keywords={COD_KEYWORDS}
        speakPrompts
      />
    </View>
  );
}

function _createCod() { return StyleSheet.create({
  selectorBtn: {flexDirection: 'row', alignItems: 'center', flex: 1, height: wp(30), paddingHorizontal: wp(8), borderRadius: wp(7), borderWidth: 1.5, gap: wp(4), elevation: 2, shadowColor: '#000', shadowOffset: {width: 0, height: 1}, shadowOpacity: 0.06, shadowRadius: 4},
  selectorIcon: {width: wp(20), height: wp(20), borderRadius: wp(6), justifyContent: 'center', alignItems: 'center'},
  selectorText: {fontSize: ms(10), fontWeight: '700', flex: 1},
  amountWrap: {flexDirection: 'row', alignItems: 'center', minWidth: wp(80), maxWidth: wp(130), height: wp(30), borderRadius: wp(7), borderWidth: 1.5, paddingHorizontal: wp(8)},
  amountCurrency: {fontSize: ms(13), fontWeight: '800', marginRight: wp(2)},
  amountInput: {flex: 1, fontSize: ms(13), fontWeight: '800', padding: 0, textAlign: 'left'},
  modalHeader: {flexDirection: 'row', alignItems: 'center', gap: wp(8), paddingHorizontal: wp(12), paddingVertical: wp(8), borderBottomWidth: 1},
  modalHeaderIcon: {width: wp(28), height: wp(28), borderRadius: wp(8), justifyContent: 'center', alignItems: 'center'},
  modalTitle: {fontSize: ms(14), fontWeight: '900', letterSpacing: 0.3},
  modalSubtitle: {fontSize: ms(9), fontWeight: '500', marginTop: 1},
  modalCloseBtn: {width: wp(30), height: wp(30), borderRadius: wp(15), justifyContent: 'center', alignItems: 'center', elevation: 3, shadowColor: '#000', shadowOffset: {width: 0, height: 2}, shadowOpacity: 0.12, shadowRadius: 6},
  modalBody: {paddingHorizontal: wp(10), paddingTop: wp(6), paddingBottom: wp(8)},
  modalItem: {flexDirection: 'row', alignItems: 'center', paddingVertical: wp(7), paddingHorizontal: wp(8), borderRadius: wp(8), marginVertical: 2, gap: wp(8), minHeight: wp(36)},
  modalItemIcon: {width: wp(28), height: wp(28), borderRadius: wp(8), justifyContent: 'center', alignItems: 'center'},
  modalItemText: {fontSize: ms(12), fontWeight: '700', flex: 1, letterSpacing: 0.2},
  modalItemCircle: {width: wp(18), height: wp(18), borderRadius: wp(9), borderWidth: 2},
}); }

// ─── DEV DEBUG BANNER ───
function OfflineDebugBanner() {
  const [forced, setForced] = useState(false);

  const handleToggle = useCallback(() => {
    console.log('[DebugBanner] Toggle tapped, forced was:', forced);
    const next = !forced;
    setForced(next);
    // Defer setForceOffline to avoid batching conflicts with context
    setTimeout(() => setForceOffline(next), 0);
  }, [forced]);

  const bg = forced ? '#b71c1c' : '#1b5e20';
  const label = forced ? 'OFFLINE' : 'ONLINE';
  const btnLabel = forced ? 'GO ONLINE' : 'FORCE OFFLINE';

  return (
    <View style={{flexDirection: 'row', alignItems: 'center', backgroundColor: bg, paddingHorizontal: 12, paddingVertical: 8, gap: 10}}>
      <Text style={{color: '#fff', fontSize: 12, fontWeight: '700', flex: 1}}>
        {label}
      </Text>
      <TouchableOpacity
        style={{backgroundColor: 'rgba(255,255,255,0.3)', paddingHorizontal: 10, paddingVertical: 5, borderRadius: 4}}
        onPress={handleToggle}
        activeOpacity={0.6}>
        <Text style={{color: '#fff', fontSize: 11, fontWeight: '800'}}>
          {btnLabel}
        </Text>
      </TouchableOpacity>
    </View>
  );
}

// ─── MAIN SCREEN ───
export default function NotesScreen({navigation, route}: Props) {
  useFontScaleRefresh();
  refreshStylesIfNeeded();
  const ticketId = (route.params as any)?.ticketId as number | undefined;
  const initialTab = (route.params as any)?.initialTab as string | undefined;
  const [activeTab, setActiveTab] = useState(() => {
    if (initialTab) {
      const idx = TABS.findIndex(t => t.key === initialTab);
      return idx >= 0 ? idx : 0;
    }
    return 0;
  });
  const [deliveryRecord, setDeliveryRecord] = useState<DeliveryRecord | null>(null);
  const [recordLoading, setRecordLoading] = useState(false);
  const [saveModal, setSaveModal] = useState<{visible: boolean; success: boolean; message: string}>({visible: false, success: false, message: ''});
  const showSaveResult = useCallback((success: boolean, message: string) => {
    setSaveModal({visible: true, success, message});
  }, []);
  const [savingOverlay, setSavingOverlay] = useState(false);
  const refreshRecord = useCallback(async () => {
    if (!ticketId) return;
    const res = await ticketsApi.getDeliveryRecord(ticketId);
    setDeliveryRecord(res.data);
    offlineStorage.cacheDeliveryRecord(ticketId, res.data);
  }, [ticketId]);
  const {c} = useTheme();
  const insets = useSafeAreaInsets();
  const {width, height: winHeight} = useWindowDimensions();
  const isTablet = Math.min(width, winHeight) > 600;
  const isLandscape = width > winHeight;
  const landscapeNoScroll = isLandscape;
  const slideAnim = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    if (!ticketId) return;
    setRecordLoading(true);
    ticketsApi.getDeliveryRecord(ticketId)
      .then(res => {
        console.log('[NotesScreen] delivery record field_definitions:', JSON.stringify(res.data?.field_definitions?.plant ? Object.keys(res.data.field_definitions.plant) : 'MISSING'));
        setDeliveryRecord(res.data);
        // Cache API data locally for offline fallback
        offlineStorage.cacheDeliveryRecord(ticketId, res.data);
      })
      .catch(() => {
        // API failed — try local cache + merge any pending offline saves
        const cached = offlineStorage.getCachedDeliveryRecord(ticketId);
        if (cached) {
          const pending = offlineStorage.getPendingForTicket(ticketId);
          let merged = {...cached};
          for (const item of pending) {
            merged[item.tab] = {...(merged[item.tab] || {}), ...item.body};
          }
          setDeliveryRecord(merged as DeliveryRecord);
        }
      })
      .finally(() => setRecordLoading(false));
  }, [ticketId]);


  useEffect(() => {
    slideAnim.setValue(20);
    Animated.spring(slideAnim, {toValue: 0, friction: 8, tension: 60, useNativeDriver: true}).start();
  }, [activeTab, slideAnim]);

  // Key forces tabs to remount when delivery record changes, so useState initializers pick up fresh data
  const dataVersion = useRef(0);
  const prevRecord = useRef(deliveryRecord);
  if (prevRecord.current !== deliveryRecord) {
    dataVersion.current += 1;
    prevRecord.current = deliveryRecord;
  }
  const dataKey = `data-${dataVersion.current}`;

  const renderTab = () => {
    switch (activeTab) {
      case 0: return <PlantTab key={dataKey} data={deliveryRecord} ticketId={ticketId} onSaveResult={showSaveResult} setSavingOverlay={setSavingOverlay} refreshRecord={refreshRecord} />;
      case 1: return <JobsiteTab key={dataKey} data={deliveryRecord} ticketId={ticketId} onSaveResult={showSaveResult} setSavingOverlay={setSavingOverlay} refreshRecord={refreshRecord} />;
      case 2: return <ReturnedTab key={dataKey} data={deliveryRecord} ticketId={ticketId} onSaveResult={showSaveResult} setSavingOverlay={setSavingOverlay} refreshRecord={refreshRecord} />;
      case 3: return <TimeAdjustTab key={dataKey} data={deliveryRecord} ticketId={ticketId} onSaveResult={showSaveResult} setSavingOverlay={setSavingOverlay} refreshRecord={refreshRecord} />;
      case 4: return <CodTab key={dataKey} data={deliveryRecord} ticketId={ticketId} onSaveResult={showSaveResult} setSavingOverlay={setSavingOverlay} refreshRecord={refreshRecord} />;
      default: return <PlantTab key={dataKey} data={deliveryRecord} ticketId={ticketId} onSaveResult={showSaveResult} setSavingOverlay={setSavingOverlay} refreshRecord={refreshRecord} />;
    }
  };

  return (
    <View style={[st.container, {backgroundColor: c.primaryDark}]}>
      <StatusBar translucent backgroundColor="transparent" barStyle="light-content" />
      {__DEV__ && <OfflineDebugBanner />}

      {isLandscape ? (
        <View style={[ls.lhRow, {paddingTop: insets.top + wp(1), paddingLeft: Math.max(wp(12), insets.left), paddingRight: Math.max(wp(12), insets.right)}]}>
          <View style={!isTablet ? {flexShrink: 1, minWidth: 0} : undefined}>
            <Text style={[ls.lhTitle, {color: c.textOnPrimary}]} numberOfLines={1}>ORDER {deliveryRecord?.ticket?.order_code || '-'} / TICKET {deliveryRecord?.ticket?.ticket_code || '-'}</Text>
            {isTablet && <Text style={{fontSize: ms(9), fontWeight: '500', color: c.textOnDark60}}>Delivery Notes & Records</Text>}
          </View>
          <View style={{flex: 1, minWidth: isTablet ? undefined : 4}} />
          <View style={[ls.lhTabGroup, {backgroundColor: c.overlay10}]}>
            {TABS.map((tab, i) => {
              const active = activeTab === i;
              return (
                <TouchableOpacity key={tab.key} style={[ls.lhTab, active && {backgroundColor: c.primary}, !isTablet && {paddingHorizontal: wp(8)}]} activeOpacity={0.7} onPress={() => setActiveTab(i)}>
                  <MaterialIcons name={tab.icon as any} size={ms(13)} color={active ? c.textOnPrimary : c.textOnDark60} />
                  <Text style={[ls.lhTabLabel, {color: active ? c.textOnPrimary : c.textOnDark60}]}>{tab.label}</Text>
                </TouchableOpacity>
              );
            })}
          </View>
          <View style={{flex: 1, minWidth: isTablet ? undefined : 4}} />
          <TouchableOpacity style={[st.closeBtn, {backgroundColor: c.overlay10}]} onPress={() => navigation.goBack()} activeOpacity={0.7}>
            <MaterialIcons name="close" size={ms(18)} color={c.textOnPrimary} />
          </TouchableOpacity>
        </View>
      ) : (
        <View style={[st.header, {paddingTop: insets.top + wp(1), paddingLeft: Math.max(wp(12), insets.left), paddingRight: Math.max(wp(12), insets.right)}]}>
          <View style={st.headerRow}>
            <View>
              <Text style={[st.headerTitle, {color: c.textOnPrimary}]}>ORDER {deliveryRecord?.ticket?.order_code || '-'} / TICKET {deliveryRecord?.ticket?.ticket_code || '-'}</Text>
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
      )}

      <KeyboardAvoidingView
        style={[st.flex1, {backgroundColor: c.background}]}
        behavior={isLandscape ? undefined : 'padding'}
        enabled={!isLandscape}
        keyboardVerticalOffset={Platform.OS === 'ios' ? 0 : 20}>
        <Animated.View style={[st.content, {backgroundColor: c.background, transform: [{translateY: slideAnim}]}]}>
          <ScrollView style={st.scroll} showsVerticalScrollIndicator={!landscapeNoScroll} scrollEnabled={!landscapeNoScroll} contentContainerStyle={[st.scrollInner, {paddingLeft: insets.left, paddingRight: insets.right, paddingBottom: Math.max(wp(20), insets.bottom)}, landscapeNoScroll && {flex: 1, paddingBottom: insets.bottom}]} keyboardShouldPersistTaps="handled">
            {renderTab()}
          </ScrollView>
        </Animated.View>
      </KeyboardAvoidingView>
      <SaveResultModal
        visible={saveModal.visible}
        success={saveModal.success}
        message={saveModal.message}
        onClose={() => { setSaveModal(s => ({...s, visible: false})); if (saveModal.success) navigation.goBack(); }}
      />
      {(savingOverlay || recordLoading) && (
        <View style={{position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: 'rgba(0,0,0,0.45)', justifyContent: 'center', alignItems: 'center', zIndex: 100}}>
          <View style={{backgroundColor: c.white, borderRadius: wp(14), padding: wp(24), alignItems: 'center', gap: wp(12), elevation: 10, shadowColor: '#000', shadowOffset: {width: 0, height: 4}, shadowOpacity: 0.2, shadowRadius: 12}}>
            <ActivityIndicator size="large" color={c.primary} />
            <Text style={{fontSize: ms(13), fontWeight: '700', color: c.textPrimary}}>{savingOverlay ? 'Saving...' : 'Loading...'}</Text>
            <Text style={{fontSize: ms(10), fontWeight: '500', color: c.textSecondary}}>Please wait</Text>
          </View>
        </View>
      )}
    </View>
  );
}

function _createSt() { return StyleSheet.create({
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
tabBody: {paddingHorizontal: wp(8), paddingTop: wp(8), paddingBottom: wp(10), flex: 1},    // Cards grid
  cardsGridNarrow: {gap: wp(10)},
  cardsGridWide: {flexDirection: 'row', flexWrap: 'wrap', gap: wp(10), alignItems: 'stretch', flex: 1, alignContent: 'flex-start'},

  // Field card
  fieldCard: {borderRadius: wp(10), paddingHorizontal: wp(10), paddingTop: wp(2), paddingBottom: wp(6), width: '100%'},
  fieldCardHalf: {flexGrow: 1, flexShrink: 1, flexBasis: '47%', width: undefined},
  fieldCardHeader: {flexDirection: 'row', alignItems: 'center', gap: wp(4), paddingVertical: wp(5)},
  fieldCardTitle: {fontSize: ms(10), fontWeight: '800', letterSpacing: 0.3},

  // Save
  saveBtn: {flexDirection: 'row', alignItems: 'center', gap: wp(4), paddingHorizontal: wp(8), paddingVertical: wp(2), borderRadius: wp(6), elevation: 3, shadowColor: '#000', shadowOffset: {width: 0, height: 1}, shadowOpacity: 0.15, shadowRadius: 4},
  saveBtnText: {fontSize: ms(10), fontWeight: '700'},

  // Field
  field: {flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', paddingVertical: wp(5), gap: wp(4), borderBottomWidth: 0.5},
  fieldLast: {borderBottomWidth: 0},
  fieldWide: {flexDirection: 'column', alignItems: 'flex-start'},
  fieldLabel: {fontSize: ms(10), fontWeight: '800', minWidth: wp(60), maxWidth: wp(140), letterSpacing: 0.2},
  fieldLabelWide: {width: '100%', marginBottom: wp(3)},
  fieldBody: {flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: wp(4), flex: 1},

  // Compact field (label-above for FieldRow)
  fieldCompact: {paddingVertical: wp(5), gap: wp(3), flex: 1, borderBottomWidth: 0},
  fieldCompactLabel: {fontSize: ms(9), fontWeight: '700', letterSpacing: 0.3},
  fieldCompactBody: {flexDirection: 'row', alignItems: 'center', gap: wp(4)},

  // Field row
  fieldRow: {flexDirection: 'row', gap: wp(8), borderBottomWidth: 0.5},

  // Number input (replaces stepper)
  stepperWrap: {flexDirection: 'row', alignItems: 'center', gap: wp(3)},
  numInput: {minWidth: wp(40), height: wp(26), borderRadius: wp(6), justifyContent: 'center', alignItems: 'center', paddingHorizontal: wp(6), borderWidth: 1, elevation: 2, shadowColor: '#000', shadowOffset: {width: 0, height: 1}, shadowOpacity: 0.06, shadowRadius: 4},
  numInputText: {fontSize: ms(10), fontWeight: '700', textAlign: 'center', padding: 0, minWidth: wp(22)},
  pickerToggle: {width: wp(22), height: wp(22), borderRadius: wp(6), justifyContent: 'center', alignItems: 'center', borderWidth: 1},
  // Picker modal
  pickerHeader: {flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: wp(14), paddingVertical: wp(10), borderBottomWidth: 1},
  pickerTitle: {fontSize: ms(14), fontWeight: '800'},
  pickerCloseBtn: {width: wp(30), height: wp(30), borderRadius: wp(15), justifyContent: 'center', alignItems: 'center'},
  pickerList: {paddingVertical: wp(4)},
  pickerItem: {flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingVertical: wp(10), paddingHorizontal: wp(16), borderBottomWidth: StyleSheet.hairlineWidth},
  pickerItemText: {fontSize: ms(14), fontWeight: '600'},
  unitInline: {fontSize: ms(8), fontWeight: '600', marginLeft: wp(2)},
  unitBadge: {marginLeft: wp(3), paddingHorizontal: wp(5), paddingVertical: wp(2), borderRadius: wp(5), borderWidth: 1},
  unitBadgeText: {fontSize: ms(8), fontWeight: '700'},

  // More
  moreBtn: {width: wp(22), height: wp(22), borderRadius: wp(11), justifyContent: 'center', alignItems: 'center'},

  // Highlighted input
  hlInput: {minWidth: wp(45), maxWidth: wp(85), height: wp(24), justifyContent: 'center', alignItems: 'center', borderRadius: wp(6), borderWidth: 1.5, elevation: 2, shadowColor: '#000', shadowOffset: {width: 0, height: 1}, shadowOpacity: 0.08, shadowRadius: 4},
  hlInputText: {fontSize: ms(12), fontWeight: '800'},

  // Gray input
  grayInput: {minWidth: wp(90), maxWidth: wp(150), height: wp(32), borderRadius: wp(8), borderWidth: 1, justifyContent: 'center', paddingHorizontal: wp(8)},
  grayPlaceholder: {fontSize: ms(12), fontWeight: '500'},

  // Line input
  lineInput: {borderBottomWidth: 1, minHeight: wp(24), fontSize: ms(9), paddingVertical: wp(2)},
  lineInputText: {fontSize: ms(9), fontWeight: '500'},

  // Checkbox
  checkTap: {flexDirection: 'row', alignItems: 'center', gap: wp(3), paddingVertical: wp(1), paddingRight: wp(3)},
  checkBox: {width: wp(15), height: wp(15), borderWidth: 1.5, borderRadius: wp(4), justifyContent: 'center', alignItems: 'center', elevation: 1, shadowColor: '#000', shadowOffset: {width: 0, height: 1}, shadowOpacity: 0.06, shadowRadius: 2},
  checkLabel: {fontSize: ms(9), fontWeight: '600'},

  // Radio
  radioRow: {flexDirection: 'row', alignItems: 'center', gap: wp(2)},
  radioTap: {flexDirection: 'row', alignItems: 'center', gap: wp(3), paddingVertical: wp(1), paddingHorizontal: wp(3), borderRadius: wp(5)},
  radioCircle: {width: wp(14), height: wp(14), borderRadius: wp(7), borderWidth: 1.5, justifyContent: 'center', alignItems: 'center'},
  radioDot: {width: wp(6), height: wp(6), borderRadius: wp(3)},
  radioLabel: {fontSize: ms(9), fontWeight: '600'},

  // Text area
  textArea: {borderRadius: wp(8), padding: wp(8), fontSize: ms(12), minHeight: wp(60), textAlignVertical: 'top', width: '100%', lineHeight: ms(18)},

  // Link
  linkText: {fontSize: ms(10), fontWeight: '700', textDecorationLine: 'underline'},

  // Inline
  inlineLabel: {fontSize: ms(9), fontWeight: '800'},

  // Time picker
  timePick: {flexDirection: 'row', alignItems: 'center', gap: wp(2), paddingHorizontal: wp(4), paddingVertical: wp(3), borderRadius: wp(6), borderWidth: 1, elevation: 2, shadowColor: '#000', shadowOffset: {width: 0, height: 1}, shadowOpacity: 0.06, shadowRadius: 4},
  timePickIcon: {width: wp(15), height: wp(15), borderRadius: wp(4), justifyContent: 'center', alignItems: 'center'},
  timePickText: {fontSize: ms(9), fontWeight: '600'},

  // Sub headers
  subHeaderRow: {flexDirection: 'row', gap: wp(6), marginBottom: wp(6)},
  subHeaderPill: {paddingHorizontal: wp(8), paddingVertical: wp(3), borderRadius: wp(6), borderWidth: 1},
  subHeaderText: {fontSize: ms(10), fontWeight: '600'},

  // Section title
  secTitle: {flexDirection: 'row', alignItems: 'center', gap: wp(6), borderBottomWidth: 1, paddingBottom: wp(6), marginBottom: wp(6), marginTop: wp(8)},
  secTitleText: {fontSize: ms(10), fontWeight: '800', letterSpacing: 0.3},

  // Popups
  popupOverlay: {flex: 1, backgroundColor: Colors.overlayModal, justifyContent: 'center', alignItems: 'center'},
  popupHeader: {flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: wp(10), paddingVertical: wp(5), borderBottomWidth: 1},
  popupTitle: {fontSize: ms(14), fontWeight: '900', letterSpacing: 0.3},
  popupCloseBtn: {width: wp(28), height: wp(28), borderRadius: wp(14), justifyContent: 'center', alignItems: 'center'},
  popupScroll: {paddingHorizontal: wp(8)},
  popupItem: {flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingVertical: wp(16), paddingHorizontal: wp(14), borderBottomWidth: 0.5, borderRadius: wp(8), marginVertical: 2, minHeight: wp(52)},
  popupItemText: {fontSize: ms(14), fontWeight: '600', flex: 1},

  // Selector
  selectorBtn: {flexDirection: 'row', alignItems: 'center', flex: 1, height: wp(30), paddingHorizontal: wp(8), borderRadius: wp(7), borderWidth: 1.5, gap: wp(4), elevation: 2, shadowColor: '#000', shadowOffset: {width: 0, height: 1}, shadowOpacity: 0.06, shadowRadius: 4},
  selectorText: {fontSize: ms(10), fontWeight: '600', flex: 1},

  // Numeric input
  numericInput: {minWidth: wp(65), maxWidth: wp(110), height: wp(30), borderRadius: wp(7), borderWidth: 1.5, justifyContent: 'center', paddingHorizontal: wp(8), elevation: 2, shadowColor: '#000', shadowOffset: {width: 0, height: 1}, shadowOpacity: 0.06, shadowRadius: 4},
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

  // Voice button
  voiceBtn: {width: wp(28), height: wp(28), borderRadius: wp(14), justifyContent: 'center', alignItems: 'center', elevation: 4, shadowColor: '#000', shadowOffset: {width: 0, height: 2}, shadowOpacity: 0.15, shadowRadius: 4},
}); }
