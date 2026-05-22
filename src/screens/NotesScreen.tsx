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
  Modal,
  Pressable,
} from 'react-native';
import {useSafeAreaInsets} from 'react-native-safe-area-context';
import MaterialIcons from 'react-native-vector-icons/MaterialIcons';
import type {NativeStackNavigationProp} from '@react-navigation/native-stack';
import {useTheme} from '../contexts/ThemeContext';

type Props = {navigation: NativeStackNavigationProp<any>};

const TABS = [
  {key: 'plant', label: 'Plant', icon: 'factory'},
  {key: 'jobsite', label: 'Jobsite', icon: 'location-on'},
  {key: 'returned', label: 'Returned', icon: 'undo'},
  {key: 'time', label: 'Time', icon: 'schedule'},
  {key: 'cod', label: 'COD', icon: 'payments'},
];

// ─── SHARED COMPONENTS ───

function Stepper({value, unit, highlight}: {value: string; unit: string; highlight?: boolean}) {
  const {c} = useTheme();
  const scaleM = useRef(new Animated.Value(1)).current;
  const scaleP = useRef(new Animated.Value(1)).current;
  const pulse = useCallback((anim: Animated.Value) => {
    Animated.sequence([
      Animated.timing(anim, {toValue: 0.85, duration: 80, useNativeDriver: true}),
      Animated.spring(anim, {toValue: 1, friction: 4, tension: 100, useNativeDriver: true}),
    ]).start();
  }, []);
  return (
    <View style={st.stepperWrap}>
      <Animated.View style={{transform: [{scale: scaleM}]}}>
        <TouchableOpacity
          style={[st.stepBtn, st.stepBtnMinus, {backgroundColor: c.surface, borderColor: c.border}]}
          activeOpacity={0.7}
          onPress={() => pulse(scaleM)}>
          <MaterialIcons name="remove" size={18} color={c.textSecondary} />
        </TouchableOpacity>
      </Animated.View>
      <View style={[st.stepVal, {backgroundColor: highlight ? c.highlight : c.white, borderColor: c.border}]}>
        <Text style={[st.stepValText, {color: c.textPrimary}]}>{value || '—'}</Text>
      </View>
      <Animated.View style={{transform: [{scale: scaleP}]}}>
        <TouchableOpacity
          style={[st.stepBtn, st.stepBtnPlus, {backgroundColor: c.primary}]}
          activeOpacity={0.7}
          onPress={() => pulse(scaleP)}>
          <MaterialIcons name="add" size={18} color={c.textOnPrimary} />
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

function Field({label, children, wide}: {label: string; children: React.ReactNode; wide?: boolean}) {
  const {c} = useTheme();
  return (
    <View style={[st.field, {borderBottomColor: c.borderLight}, wide && st.fieldWide]}>
      <Text style={[st.fieldLabel, {color: c.textPrimary}, wide && st.fieldLabelWide]}>{label}</Text>
      <View style={st.fieldBody}>{children}</View>
    </View>
  );
}

function MoreBtn() {
  const {c} = useTheme();
  return (
    <TouchableOpacity style={[st.moreBtn, {backgroundColor: c.surface, borderColor: c.border}]} activeOpacity={0.5}>
      <MaterialIcons name="more-horiz" size={16} color={c.primary} />
    </TouchableOpacity>
  );
}

function Check({checked, label}: {checked: boolean; label?: string}) {
  const {c} = useTheme();
  const scale = useRef(new Animated.Value(1)).current;
  const tap = () => {
    Animated.sequence([
      Animated.timing(scale, {toValue: 0.8, duration: 60, useNativeDriver: true}),
      Animated.spring(scale, {toValue: 1, friction: 4, tension: 120, useNativeDriver: true}),
    ]).start();
  };
  return (
    <TouchableOpacity style={st.checkTap} activeOpacity={0.7} onPress={tap}>
      <Animated.View style={[
        st.checkBox,
        {borderColor: checked ? c.primary : c.border, backgroundColor: checked ? c.primary : c.white},
        {transform: [{scale}]},
      ]}>
        {checked && <MaterialIcons name="check" size={14} color={c.textOnPrimary} />}
      </Animated.View>
      {label && <Text style={[st.checkLabel, {color: c.textPrimary}]}>{label}</Text>}
    </TouchableOpacity>
  );
}

function Radio({selected, label}: {selected: boolean; label: string}) {
  const {c} = useTheme();
  return (
    <TouchableOpacity style={st.radioTap} activeOpacity={0.7}>
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

function LineInput({width: w, placeholder}: {width?: number; placeholder?: string}) {
  const {c} = useTheme();
  return (
    <TextInput
      style={[st.lineInput, {borderBottomColor: c.border, color: c.textPrimary, width: w || 120}]}
      placeholderTextColor={c.textMuted}
      placeholder={placeholder || ''}
    />
  );
}

function SaveButton({disabled, onPress}: {disabled?: boolean; onPress?: () => void}) {
  const {c} = useTheme();
  const scale = useRef(new Animated.Value(1)).current;
  return (
    <Animated.View style={{transform: [{scale}], alignSelf: 'flex-end', marginBottom: 16}}>
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
        <MaterialIcons name="check-circle" size={16} color={disabled ? c.textMuted : c.textOnPrimary} />
        <Text style={[st.saveBtnText, {color: disabled ? c.textMuted : c.textOnPrimary}]}>Save Changes</Text>
      </TouchableOpacity>
    </Animated.View>
  );
}

function SectionTitle({title, icon}: {title: string; icon?: string}) {
  const {c} = useTheme();
  return (
    <View style={[st.secTitle, {borderBottomColor: c.border}]}>
      {icon && <MaterialIcons name={icon as any} size={16} color={c.primary} />}
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

function TimePicker({label}: {label?: string}) {
  const {c} = useTheme();
  return (
    <TouchableOpacity style={[st.timePick, {backgroundColor: c.white, borderColor: c.border}]} activeOpacity={0.6}>
      <View style={[st.timePickIcon, {backgroundColor: c.primarySurface}]}>
        <MaterialIcons name="schedule" size={16} color={c.primary} />
      </View>
      <Text style={[st.timePickText, {color: c.textMuted}]}>{label || 'Select Time'}</Text>
      <MaterialIcons name="keyboard-arrow-down" size={18} color={c.textMuted} />
    </TouchableOpacity>
  );
}

function NoteInput({placeholder, borderColor, bgColor, textColor}: any) {
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
      onFocus={() => setFocused(true)}
      onBlur={() => setFocused(false)}
    />
  );
}

// ─── PLANT TAB ───
function PlantTab() {
  const {c} = useTheme();
  return (
    <View style={[st.tabBody, {backgroundColor: c.primarySurface}]}>
      <SaveButton />
      <Field label="SLUMP FROM PLANT">
        <YellowInput value="20" />
        <Text style={[st.unitInline, {color: c.textSecondary}]}>mm</Text>
        <MoreBtn />
      </Field>
      <Field label="WATER ADDED (FULL)" wide>
        <SubHeader labels={['Litres', 'Reason']} />
        <View style={st.fieldBody}>
          <Stepper value="" unit="" />
          <LineInput placeholder="Reason" />
          <MoreBtn />
        </View>
      </Field>
      <Field label="SLUMP TO JOB">
        <YellowInput value="140" />
        <Text style={[st.unitInline, {color: c.textSecondary}]}>mm</Text>
        <MoreBtn />
      </Field>
      <Field label="TEMP AT PLANT">
        <LineInput width={140} placeholder="Temperature" />
        <Text style={[st.unitInline, {color: c.textSecondary}]}>°C</Text>
      </Field>
      <Field label="ADD HAND-ADDED ITEMS?">
        <Check checked={false} />
        <TouchableOpacity activeOpacity={0.6}>
          <Text style={[st.linkText, {color: c.linkBlue}]}>VIEW PRODUCTS</Text>
        </TouchableOpacity>
      </Field>
      <Field label={'NITROGEN ADDED\n(IF NOT ON TICKET)'}><Check checked={false} /></Field>
      <Field label={'FIBERS ADDED\n(IF NOT ON TICKET)'}><Check checked={false} /></Field>
      <Field label="TRUCK RENTAL" wide>
        <View style={st.fieldBody}>
          <Text style={[st.inlineLabel, {color: c.textPrimary}]}>START</Text>
          <TimePicker label="Select" />
          <Text style={[st.inlineLabel, {color: c.textPrimary}]}>END</Text>
          <TimePicker label="Select" />
        </View>
      </Field>
      <Field label="PLANT NOTES" wide>
        <NoteInput placeholder="Enter plant notes..." />
      </Field>
      <Field label="LOAD TESTED">
        <View style={st.radioRow}>
          <Radio selected={false} label="Yes" />
          <Radio selected={false} label="No" />
        </View>
      </Field>
    </View>
  );
}

// ─── JOBSITE TAB ───
function JobsiteTab() {
  const {c} = useTheme();
  return (
    <View style={[st.tabBody, {backgroundColor: c.surface}]}>
      <SaveButton />
      <Field label="FULL LOAD" wide>
        <SubHeader labels={['Litres', 'Reason', 'mm']} />
        <View style={st.fieldBody}>
          <Stepper value="" unit="" highlight />
          <LineInput placeholder="Reason" />
          <MoreBtn />
          <LineInput width={60} placeholder="mm" />
          <MoreBtn />
        </View>
      </Field>
      <Field label="Customer Requested Water" wide>
        <SubHeader labels={['Litres', 'mm']} />
        <View style={st.fieldBody}>
          <Stepper value="" unit="" />
          <LineInput width={60} placeholder="mm" />
          <MoreBtn />
        </View>
      </Field>
      <Field label="Maintenance Water">
        <Stepper value="" unit="" />
        <LineInput width={60} placeholder="mm" />
        <MoreBtn />
      </Field>

      <SectionTitle title="ADDED, NOT ORDERED" icon="playlist-add" />

      {['SUPER PLASTICIZER', 'CONVEYOR (IF NOT ON TICKET)', 'COLOR', 'FIBER', 'Other'].map(item => (
        <Field key={item} label={item}>
          <LineInput width={160} placeholder="Value" />
          {item !== 'Other' && <MoreBtn />}
        </Field>
      ))}

      <Field label="CONVEYOR ORDERED NOT USED"><Check checked={false} /></Field>
      <Field label="UNLOADED OVER CONVEYOR"><Check checked={false} /></Field>
      <Field label="LOAD DISPUTED"><Check checked={false} /></Field>

      <Field label="WASHOUT AREA">
        <LineInput width={160} placeholder="Area" />
        <MoreBtn />
      </Field>

      <Field label="INTERNAL JOBSITE NOTES" wide>
        <View style={{flexDirection: 'row', gap: 8, alignItems: 'flex-start', width: '100%'}}>
          <NoteInput placeholder="Enter jobsite notes..." />
          <MoreBtn />
        </View>
      </Field>

      <Field label="LOAD TESTED">
        <View style={st.radioRow}>
          <Radio selected={true} label="Yes" />
          <Radio selected={false} label="No" />
        </View>
      </Field>

      <Field label="TEMP"><Stepper value="20" unit="°C" /></Field>
      <Field label="AIR"><Stepper value="6.8" unit="%" /></Field>
      <Field label="SLUMP"><Stepper value="140" unit="mm" /><MoreBtn /></Field>
      <Field label="CYLINDERS"><Stepper value="4" unit="" /></Field>
    </View>
  );
}

// ─── DISPOSAL METHOD OPTIONS ───
const DISPOSAL_METHODS = [
  'RESHIPPED IN YARD',
  'DUMPED IN YARD',
  'DUMPED AT THIRD PARTY YARD',
  'MADE BLOCKS',
  'USED FOR PLANT/SHOP',
  'RE-ROUTED TO DIFFERENT SITE',
  'GRANULIZE',
];

const RETURN_REASONS = [
  'CUSTOMER CANCELLED',
  'OVER ORDERED',
  'REJECTED - QUALITY',
  'REJECTED - LATE',
  'WEATHER',
  'EQUIPMENT FAILURE',
  'OTHER',
];

// ─── SELECTION MODAL ───
function SelectionModal({
  visible,
  title,
  options,
  selected,
  onSelect,
  onClose,
}: {
  visible: boolean;
  title: string;
  options: string[];
  selected: string;
  onSelect: (val: string) => void;
  onClose: () => void;
}) {
  const {c} = useTheme();
  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <Pressable style={st.popupOverlay} onPress={onClose}>
        <View style={[st.popupCard, {backgroundColor: c.white, shadowColor: c.shadowColor}]} onStartShouldSetResponder={() => true}>
          {/* Header */}
          <View style={[st.popupHeader, {borderBottomColor: c.border}]}>
            <Text style={[st.popupTitle, {color: c.textPrimary}]}>{title}</Text>
            <TouchableOpacity style={[st.popupCloseBtn, {backgroundColor: c.surface}]} onPress={onClose} activeOpacity={0.7}>
              <MaterialIcons name="close" size={20} color={c.textSecondary} />
            </TouchableOpacity>
          </View>

          {/* Options */}
          <ScrollView style={st.popupScroll} showsVerticalScrollIndicator={false}>
            {options.map((opt, i) => {
              const isSelected = opt === selected;
              return (
                <TouchableOpacity
                  key={opt}
                  style={[
                    st.popupItem,
                    {borderBottomColor: c.borderLight},
                    i === options.length - 1 && {borderBottomWidth: 0},
                    isSelected && {backgroundColor: c.primarySurface},
                  ]}
                  activeOpacity={0.6}
                  onPress={() => {
                    onSelect(opt);
                    onClose();
                  }}>
                  <Text style={[
                    st.popupItemText,
                    {color: c.textPrimary},
                    isSelected && {color: c.primary, fontWeight: '800'},
                  ]}>
                    {opt}
                  </Text>
                  {isSelected && <MaterialIcons name="check-circle" size={20} color={c.primary} />}
                </TouchableOpacity>
              );
            })}
          </ScrollView>
        </View>
      </Pressable>
    </Modal>
  );
}

// ─── SELECTOR FIELD ───
function SelectorField({value, placeholder, onPress}: {value: string; placeholder: string; onPress: () => void}) {
  const {c} = useTheme();
  return (
    <TouchableOpacity
      style={[st.selectorBtn, {backgroundColor: value ? c.primarySurface : c.surface, borderColor: value ? c.primary : c.border}]}
      activeOpacity={0.6}
      onPress={onPress}>
      <Text style={[st.selectorText, {color: value ? c.primary : c.textMuted}]} numberOfLines={1}>
        {value || placeholder}
      </Text>
      <MaterialIcons name="keyboard-arrow-down" size={20} color={c.textMuted} />
    </TouchableOpacity>
  );
}

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
  const isDisposalValid = DISPOSAL_METHODS.includes(disposalMethod);
  const isReasonValid = RETURN_REASONS.includes(returnReason);
  const isFormValid = isConcreteValid && isDisposalValid && isReasonValid;

  const handleSave = () => {
    if (!isFormValid) {return;}
    // All valid — safe to proceed with save
  };

  return (
    <View style={[st.tabBody, {backgroundColor: c.surface}]}>
      <SaveButton disabled={!isFormValid} onPress={handleSave} />

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
          style={[st.selectorBtn, {backgroundColor: isDisposalValid ? c.primarySurface : c.surface, borderColor: isDisposalValid ? c.primary : c.border}]}
          activeOpacity={0.6}
          onPress={() => setDisposalModal(true)}>
          <Text style={[st.selectorText, {color: isDisposalValid ? c.primary : c.textMuted}]} numberOfLines={1}>
            {disposalMethod || 'Select method'}
          </Text>
          <MaterialIcons name="keyboard-arrow-down" size={20} color={isDisposalValid ? c.primary : c.textMuted} />
        </TouchableOpacity>
        <TouchableOpacity
          style={[st.moreBtn, {backgroundColor: c.surface, borderColor: c.border}]}
          activeOpacity={0.5}
          onPress={() => setDisposalModal(true)}>
          <MaterialIcons name="more-horiz" size={16} color={c.primary} />
        </TouchableOpacity>
      </Field>

      {/* Reason for Return */}
      <Field label="REASON FOR RETURN">
        <TouchableOpacity
          style={[st.selectorBtn, {backgroundColor: isReasonValid ? c.primarySurface : c.surface, borderColor: isReasonValid ? c.primary : c.border}]}
          activeOpacity={0.6}
          onPress={() => setReasonModal(true)}>
          <Text style={[st.selectorText, {color: isReasonValid ? c.primary : c.textMuted}]} numberOfLines={1}>
            {returnReason || 'Select reason'}
          </Text>
          <MaterialIcons name="keyboard-arrow-down" size={20} color={isReasonValid ? c.primary : c.textMuted} />
        </TouchableOpacity>
        <TouchableOpacity
          style={[st.moreBtn, {backgroundColor: c.surface, borderColor: c.border}]}
          activeOpacity={0.5}
          onPress={() => setReasonModal(true)}>
          <MaterialIcons name="more-horiz" size={16} color={c.primary} />
        </TouchableOpacity>
      </Field>

      {/* Modals */}
      <SelectionModal
        visible={disposalModal}
        title="DISPOSAL METHOD"
        options={DISPOSAL_METHODS}
        selected={disposalMethod}
        onSelect={setDisposalMethod}
        onClose={() => setDisposalModal(false)}
      />
      <SelectionModal
        visible={reasonModal}
        title="REASON FOR RETURN"
        options={RETURN_REASONS}
        selected={returnReason}
        onSelect={setReturnReason}
        onClose={() => setReasonModal(false)}
      />
    </View>
  );
}

// ─── TIME ADJUST TAB ───
function TimeAdjustTab() {
  const {c} = useTheme();
  const times = [
    ['LEAVE PLANT', 'WASHING'],
    ['ARRIVE JOB', 'LEAVE JOB'],
    ['START POUR', 'AT PLANT'],
  ];
  return (
    <View style={[st.tabBody, {backgroundColor: c.surface}]}>
      <SaveButton />
      {times.map((row, i) => (
        <View key={i} style={st.timeRow}>
          {row.map(label => (
            <View key={label} style={[st.timeCard, {backgroundColor: c.white, borderColor: c.border}]}>
              <Text style={[st.timeCardLabel, {color: c.textPrimary}]}>{label}</Text>
              <TimePicker />
            </View>
          ))}
        </View>
      ))}
    </View>
  );
}

// ─── COD TAB ───
function CodTab() {
  const {c} = useTheme();
  return (
    <View style={[st.tabBody, {backgroundColor: c.surface}]}>
      <SaveButton />
      <Field label="PAYMENT"><LineInput width={160} placeholder="Amount" /><MoreBtn /></Field>
      <Field label="WAIT TIME"><Stepper value="" unit="Min" /></Field>
      <Field label="COD NOTES" wide>
        <NoteInput placeholder="Enter COD notes..." />
      </Field>
    </View>
  );
}

// ─── MAIN SCREEN ───
export default function NotesScreen({navigation}: Props) {
  const [activeTab, setActiveTab] = useState(0);
  const {c} = useTheme();
  const insets = useSafeAreaInsets();
  const {width} = useWindowDimensions();
  const isTablet = width > 600;
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

      <View style={[st.header, {paddingTop: insets.top + 12}]}>
        <View style={st.headerRow}>
          <View>
            <Text style={st.headerTitle}>ORDER 2605 / TICKET 26209538</Text>
            <Text style={[st.headerSub, {color: c.textOnDark60}]}>Delivery Notes & Records</Text>
          </View>
          <TouchableOpacity
            style={[st.closeBtn, {backgroundColor: c.overlay10}]}
            onPress={() => navigation.goBack()}
            activeOpacity={0.7}>
            <MaterialIcons name="close" size={20} color={c.textOnPrimary} />
          </TouchableOpacity>
        </View>

        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={st.tabsRow}>
          {TABS.map((tab, i) => {
            const active = activeTab === i;
            return (
              <TouchableOpacity
                key={tab.key}
                style={[st.tab, active && {backgroundColor: c.primary}]}
                activeOpacity={0.7}
                onPress={() => setActiveTab(i)}>
                <MaterialIcons name={tab.icon as any} size={16} color={active ? c.textOnPrimary : c.textOnDark60} />
                <Text style={[st.tabLabel, {color: active ? c.textOnPrimary : c.textOnDark60}]}>
                  {isTablet ? tab.label : tab.label.substring(0, 5)}
                </Text>
              </TouchableOpacity>
            );
          })}
        </ScrollView>
      </View>

      <Animated.View style={[st.content, {backgroundColor: c.background, transform: [{translateY: slideAnim}]}]}>
        <ScrollView style={st.scroll} showsVerticalScrollIndicator={false} contentContainerStyle={st.scrollInner}>
          {renderTab()}
        </ScrollView>
      </Animated.View>
    </View>
  );
}

const st = StyleSheet.create({
  container: {flex: 1},

  // Header
  header: {paddingHorizontal: 18, paddingBottom: 14},
  headerRow: {flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: 14},
  headerTitle: {color: '#FFF', fontSize: 16, fontWeight: '800', letterSpacing: 0.3},
  headerSub: {fontSize: 12, fontWeight: '500', marginTop: 2},
  closeBtn: {width: 36, height: 36, borderRadius: 18, justifyContent: 'center', alignItems: 'center'},

  // Tabs
  tabsRow: {flexDirection: 'row', gap: 6},
  tab: {flexDirection: 'row', alignItems: 'center', gap: 6, paddingVertical: 9, paddingHorizontal: 14, borderRadius: 12, backgroundColor: 'rgba(255,255,255,0.08)'},
  tabLabel: {fontSize: 12, fontWeight: '700', letterSpacing: 0.2},

  // Content
  content: {flex: 1, borderTopLeftRadius: 20, borderTopRightRadius: 20, overflow: 'hidden'},
  scroll: {flex: 1},
  scrollInner: {paddingBottom: 40},

  // Tab body
  tabBody: {padding: 20, minHeight: 400},

  // Save
  saveBtn: {flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 20, paddingVertical: 11, borderRadius: 12, elevation: 3, shadowColor: '#000', shadowOffset: {width: 0, height: 2}, shadowOpacity: 0.15, shadowRadius: 6},
  saveBtnText: {fontSize: 14, fontWeight: '700'},

  // Field
  field: {flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', paddingVertical: 14, gap: 10, borderBottomWidth: 0.5},
  fieldWide: {flexDirection: 'column', alignItems: 'flex-start'},
  fieldLabel: {fontSize: 12, fontWeight: '800', width: 165, letterSpacing: 0.2},
  fieldLabelWide: {width: '100%', marginBottom: 10},
  fieldBody: {flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: 8, flex: 1},

  // Stepper
  stepperWrap: {flexDirection: 'row', alignItems: 'center', gap: 2},
  stepBtn: {width: 38, height: 38, borderRadius: 10, justifyContent: 'center', alignItems: 'center'},
  stepBtnMinus: {borderWidth: 1},
  stepBtnPlus: {},
  stepVal: {width: 64, height: 38, justifyContent: 'center', alignItems: 'center', borderWidth: 1, borderRadius: 8, marginHorizontal: 3},
  stepValText: {fontSize: 15, fontWeight: '700'},
  unitInline: {fontSize: 13, fontWeight: '600', marginLeft: 6},
  unitBadge: {marginLeft: 8, paddingHorizontal: 10, paddingVertical: 5, borderRadius: 8, borderWidth: 1},
  unitBadgeText: {fontSize: 12, fontWeight: '700'},

  // More
  moreBtn: {width: 32, height: 32, borderRadius: 16, borderWidth: 1, justifyContent: 'center', alignItems: 'center'},

  // Highlighted input
  hlInput: {width: 120, height: 40, justifyContent: 'center', alignItems: 'center', borderRadius: 10, borderWidth: 1.5},
  hlInputText: {fontSize: 18, fontWeight: '800'},

  // Gray input
  grayInput: {width: 160, height: 40, borderRadius: 10, borderWidth: 1, justifyContent: 'center', paddingHorizontal: 12},
  grayPlaceholder: {fontSize: 13, fontWeight: '500'},

  // Line input
  lineInput: {borderBottomWidth: 1.5, height: 36, fontSize: 14, paddingVertical: 4},

  // Checkbox
  checkTap: {flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 4, paddingRight: 8},
  checkBox: {width: 24, height: 24, borderWidth: 2, borderRadius: 7, justifyContent: 'center', alignItems: 'center'},
  checkLabel: {fontSize: 13, fontWeight: '600'},

  // Radio
  radioRow: {flexDirection: 'row', alignItems: 'center', gap: 4},
  radioTap: {flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 6, paddingHorizontal: 8, borderRadius: 8},
  radioCircle: {width: 22, height: 22, borderRadius: 11, borderWidth: 2.5, justifyContent: 'center', alignItems: 'center'},
  radioDot: {width: 10, height: 10, borderRadius: 5},
  radioLabel: {fontSize: 14, fontWeight: '600'},

  // Text area
  textArea: {borderRadius: 14, padding: 14, fontSize: 14, minHeight: 100, textAlignVertical: 'top', width: '100%', lineHeight: 20},

  // Link
  linkText: {fontSize: 13, fontWeight: '700', textDecorationLine: 'underline'},

  // Inline
  inlineLabel: {fontSize: 12, fontWeight: '800'},

  // Time picker
  timePick: {flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 12, paddingVertical: 10, borderRadius: 10, borderWidth: 1},
  timePickIcon: {width: 28, height: 28, borderRadius: 8, justifyContent: 'center', alignItems: 'center'},
  timePickText: {fontSize: 13, fontWeight: '600', flex: 1},

  // Sub headers
  subHeaderRow: {flexDirection: 'row', gap: 8, marginBottom: 8},
  subHeaderPill: {paddingHorizontal: 10, paddingVertical: 4, borderRadius: 6, borderWidth: 1},
  subHeaderText: {fontSize: 11, fontWeight: '600'},

  // Section title
  secTitle: {flexDirection: 'row', alignItems: 'center', gap: 8, borderBottomWidth: 1, paddingBottom: 10, marginBottom: 8, marginTop: 12},
  secTitleText: {fontSize: 13, fontWeight: '800', letterSpacing: 0.3},

  // Time adjust
  timeRow: {flexDirection: 'row', gap: 12, marginBottom: 12},
  timeCard: {flex: 1, padding: 14, borderRadius: 12, borderWidth: 1, gap: 8},
  timeCardLabel: {fontSize: 12, fontWeight: '800', letterSpacing: 0.2},

  // Selection popup
  popupOverlay: {flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'center', alignItems: 'center'},
  popupCard: {width: '88%', maxWidth: 480, maxHeight: '75%', borderRadius: 16, elevation: 12, shadowOffset: {width: 0, height: 6}, shadowOpacity: 0.2, shadowRadius: 16, overflow: 'hidden'},
  popupHeader: {flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 20, paddingVertical: 16, borderBottomWidth: 1},
  popupTitle: {fontSize: 18, fontWeight: '900', letterSpacing: 0.3},
  popupCloseBtn: {width: 36, height: 36, borderRadius: 18, justifyContent: 'center', alignItems: 'center'},
  popupScroll: {paddingHorizontal: 8},
  popupItem: {flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingVertical: 16, paddingHorizontal: 14, borderBottomWidth: 0.5, borderRadius: 8, marginVertical: 2},
  popupItemText: {fontSize: 15, fontWeight: '600', flex: 1},

  // Selector field
  selectorBtn: {flexDirection: 'row', alignItems: 'center', flex: 1, height: 42, paddingHorizontal: 14, borderRadius: 10, borderWidth: 1.5, gap: 6},
  selectorText: {fontSize: 14, fontWeight: '600', flex: 1},

  // Numeric input
  numericInput: {width: 120, height: 42, borderRadius: 10, borderWidth: 1.5, justifyContent: 'center', paddingHorizontal: 12},
  numericInputText: {fontSize: 18, fontWeight: '800', textAlign: 'center', padding: 0},

});
