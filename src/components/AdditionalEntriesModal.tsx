import React, {useState, useEffect, useCallback, useRef} from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  ScrollView,
  StyleSheet,
  ActivityIndicator,
  Animated,
  Keyboard,
  Platform,
} from 'react-native';
import Icon from './Icon';
import ResponsiveModal from './ResponsiveModal';
import {useSafeAreaInsets} from 'react-native-safe-area-context';
import {useTheme} from '../contexts/ThemeContext';
import {wp, ms} from '../utils/responsive';

const MONO = Platform.OS === 'ios' ? 'Menlo' : 'monospace';

type Props = {
  visible: boolean;
  onClose: () => void;
  ticketCode: string;
  orderCode: string;
  deliveryRecord: any;
  initialTab?: Tab;
  onSave: (tab: string, body: Record<string, any>) => Promise<void>;
  isLandscape: boolean;
};

type Tab = 'plant' | 'jobsite' | 'cod';

const WATER_REASONS = ['NOT ADDED', 'EXCEEDED', 'BRING UP TO'];
const ADDITIVE_OPTIONS = ['NOT ADDED', 'ADDED — ON TICKET', 'ADDED — NOT ON TICKET'];
const JOBSITE_SELECT_OPTIONS = ['NOT ADDED', 'CUSTOMER', 'DRIVER'];
const WASHOUT_OPTIONS = ['WHEELBARROW', 'DUMPSTER', 'BEHIND CURB LINE', 'STONE PILE ON JOB SITE', 'TRUCK MOUNTED WASHOUT', 'PUMP', 'OTHER'];
const JOBSITE_NOTES_OPTIONS = [
  'Uneven Subgrade',
  'Wet/Hot/Frozen Subgrade',
  'Old Concrete > 2 Hours',
  'Bleeding Surface',
  'Surface Rained-on',
  'No Curing of Concrete',
  'Incorrect Amount of Cust. Added Product',
  'Not Sampling Between 10 & 90% of Load',
  'Minimum Sample Size Not 1ft/3 Buckets',
  'Slump Test Incorrect',
  'Air Test Incorrect',
  'Cylinder Making Incorrect',
  'Cylinder Storage Incorrect',
  'No Comment',
];
const PAYMENT_TYPES = ['CASH', 'CHEQUE', 'CREDIT CARD', 'DEBIT', 'MONEY ORDER', 'ON ACCOUNT'];
const TABS: {key: Tab; label: string}[] = [
  {key: 'plant', label: 'PLANT'},
  {key: 'jobsite', label: 'JOBSITE'},
  {key: 'cod', label: 'COD'},
];

export default function AdditionalEntriesModal({visible, onClose, ticketCode, orderCode, deliveryRecord, initialTab, onSave, isLandscape}: Props) {
  const {c} = useTheme();
  const [activeTab, setActiveTab] = useState<Tab>(initialTab || 'plant');
  const [saving, setSaving] = useState(false);
  const [contentHeight, setContentHeight] = useState(0);
  const [scrollViewHeight, setScrollViewHeight] = useState(0);
  const [keyboardHeight, setKeyboardHeight] = useState(0);
  const scrollY = useRef(new Animated.Value(0)).current;
  const scrollRef = useRef<ScrollView>(null);

  useEffect(() => {
    const showSub = Keyboard.addListener(Platform.OS === 'ios' ? 'keyboardWillShow' : 'keyboardDidShow', (e) => {
      setKeyboardHeight(e.endCoordinates.height);
      setTimeout(() => scrollRef.current?.scrollToEnd({animated: true}), 150);
    });
    const hideSub = Keyboard.addListener(Platform.OS === 'ios' ? 'keyboardWillHide' : 'keyboardDidHide', () => {
      setKeyboardHeight(0);
    });
    return () => { showSub.remove(); hideSub.remove(); };
  }, []);
  const [pickerType, setPickerType] = useState<'reason' | 'nitrogen' | 'fibers' | 'washout' | 'loadSlump' | 'jobLoadSlump' | 'payment' | 'superPlasticizer' | 'colorAdded' | 'fiberJob' | 'conveyor' | 'jobsiteNotes' | null>(null);
  const [truckTimePicker, setTruckTimePicker] = useState<'start' | 'end' | null>(null);
  const [truckTimeHour, setTruckTimeHour] = useState(0);
  const [truckTimeMinute, setTruckTimeMinute] = useState(0);

  // Plant state
  const [waterLitres, setWaterLitres] = useState(0);
  const [waterReason, setWaterReason] = useState('');
  const [nitrogenAdded, setNitrogenAdded] = useState('');
  const [fibersAdded, setFibersAdded] = useState('');
  const [truckStart, setTruckStart] = useState('');
  const [truckEnd, setTruckEnd] = useState('');
  const [plantNotes, setPlantNotes] = useState('');
  const [loadTested, setLoadTested] = useState<'yes' | 'no' | null>(null);
  const [loadTemp, setLoadTemp] = useState(0);
  const [loadAir, setLoadAir] = useState(0);
  const [loadSlump, setLoadSlump] = useState(0);
  const [loadCylinders, setLoadCylinders] = useState(0);

  // Jobsite state
  const [superPlasticizer, setSuperPlasticizer] = useState('');
  const [superPlasticizerQty, setSuperPlasticizerQty] = useState('');
  const [colorAdded, setColorAdded] = useState('');
  const [colorQty, setColorQty] = useState('');
  const [fiberJob, setFiberJob] = useState('');
  const [fiberQty, setFiberQty] = useState('');
  const [otherAdded, setOtherAdded] = useState('');
  const [conveyor, setConveyor] = useState('');
  const [conveyorQty, setConveyorQty] = useState('');
  const [conveyorOrdered, setConveyorOrdered] = useState(false);
  const [unloadedConveyor, setUnloadedConveyor] = useState(false);
  const [loadDisputed, setLoadDisputed] = useState(false);
  const [washoutArea, setWashoutArea] = useState('');
  const [washoutComments, setWashoutComments] = useState('');
  const [jobsiteNotes, setJobsiteNotes] = useState('');
  const [jobLoadTested, setJobLoadTested] = useState<'yes' | 'no' | null>(null);
  const [jobLoadTemp, setJobLoadTemp] = useState(0);
  const [jobLoadAir, setJobLoadAir] = useState(0);
  const [jobLoadSlump, setJobLoadSlump] = useState(0);
  const [jobLoadCylinders, setJobLoadCylinders] = useState(0);

  // COD state
  const [paymentType, setPaymentType] = useState('');
  const [codAmount, setCodAmount] = useState('');
  const [waitTime, setWaitTime] = useState(0);
  const [codNotes, setCodNotes] = useState('');

  useEffect(() => {
    if (!visible) return;
    const p = deliveryRecord?.plant;
    const j = deliveryRecord?.jobsite;
    const cod = deliveryRecord?.cod;
    setWaterLitres(p?.water_added_full ?? 0);
    setWaterReason(p?.water_reason || '');
    setNitrogenAdded(p?.nitrogen_added === true ? 'CUSTOMER' : p?.nitrogen_added === false ? 'NOT ADDED' : '');
    setFibersAdded(p?.fibers_added === true ? 'CUSTOMER' : p?.fibers_added === false ? 'NOT ADDED' : '');
    setTruckStart('');
    setTruckEnd('');
    setPlantNotes(p?.notes || '');
    setLoadTested(p?.load_tested === true ? 'yes' : p?.load_tested === false ? 'no' : null);
    setLoadTemp(p?.load_temp ?? 0);
    setLoadAir(p?.load_air ?? 0);
    setLoadSlump(p?.load_slump ?? 0);
    setLoadCylinders(p?.load_cylinders ?? 0);
    setSuperPlasticizer(j?.super_plasticizer || '');
    setSuperPlasticizerQty(j?.super_plasticizer_qty != null ? String(j.super_plasticizer_qty) : '');
    setColorAdded(j?.color || '');
    setColorQty(j?.color_qty != null ? String(j.color_qty) : '');
    setFiberJob(j?.fiber || '');
    setFiberQty(j?.fiber_qty != null ? String(j.fiber_qty) : '');
    setOtherAdded(j?.other || '');
    setConveyor(j?.conveyor || '');
    setConveyorQty(j?.conveyor_qty != null ? String(j.conveyor_qty) : '');
    setConveyorOrdered(j?.conveyor_ordered_not_used ?? false);
    setUnloadedConveyor(j?.unloaded_conveyor ?? false);
    setLoadDisputed(j?.load_disputed ?? false);
    setWashoutArea(j?.washout_area || '');
    setWashoutComments(j?.washout_comments || '');
    setJobsiteNotes(j?.notes || '');
    setJobLoadTested(j?.load_tested === true ? 'yes' : j?.load_tested === false ? 'no' : null);
    setJobLoadTemp(j?.load_temp ?? 0);
    setJobLoadAir(j?.load_air ?? 0);
    setJobLoadSlump(j?.load_slump ?? 0);
    setJobLoadCylinders(j?.load_cylinders ?? 0);
    setPaymentType(cod?.payment_type || '');
    setCodAmount(cod?.amount != null ? String(cod.amount) : '');
    setWaitTime(cod?.wait_time_minutes ?? 0);
    setCodNotes(cod?.notes || '');
    setPickerType(null);
    setActiveTab(initialTab || 'plant');
  }, [visible, deliveryRecord, initialTab]);

  const handleSave = useCallback(async () => {
    setSaving(true);
    try {
      let body: Record<string, any> = {};
      if (activeTab === 'plant') {
        body = {
          water_added_full: waterLitres > 0 ? waterLitres : null,
          water_reason: waterReason || null,
          nitrogen_added: nitrogenAdded && nitrogenAdded !== 'NOT ADDED' ? true : nitrogenAdded === 'NOT ADDED' ? false : null,
          fibers_added: fibersAdded && fibersAdded !== 'NOT ADDED' ? true : fibersAdded === 'NOT ADDED' ? false : null,
          load_tested: loadTested === 'yes' ? true : loadTested === 'no' ? false : null,
          ...(loadTested === 'yes' ? {
            load_temp: loadTemp || null,
            load_air: loadAir || null,
            load_slump: loadSlump || null,
            load_cylinders: loadCylinders || null,
          } : {}),
          truck_start: truckStart ? new Date(new Date().toDateString() + ' ' + truckStart).toISOString() : null,
          truck_end: truckEnd ? new Date(new Date().toDateString() + ' ' + truckEnd).toISOString() : null,
          notes: plantNotes || null,
        };
      } else if (activeTab === 'jobsite') {
        body = {
          super_plasticizer: superPlasticizer || null,
          super_plasticizer_qty: superPlasticizerQty ? Number(superPlasticizerQty) : null,
          color: colorAdded || null,
          color_qty: colorQty ? Number(colorQty) : null,
          fiber: fiberJob || null,
          fiber_qty: fiberQty ? Number(fiberQty) : null,
          other: otherAdded || null,
          conveyor: conveyor || null,
          conveyor_qty: conveyorQty ? Number(conveyorQty) : null,
          conveyor_ordered_not_used: conveyorOrdered || null,
          unloaded_conveyor: unloadedConveyor || null,
          load_disputed: loadDisputed || null,
          washout_area: washoutArea || null,
          washout_comments: washoutArea === 'OTHER' ? (washoutComments || null) : null,
          notes: jobsiteNotes || null,
          load_tested: jobLoadTested === 'yes' ? true : jobLoadTested === 'no' ? false : null,
          ...(jobLoadTested === 'yes' ? {
            load_temp: jobLoadTemp || null,
            load_air: jobLoadAir || null,
            load_slump: jobLoadSlump || null,
            load_cylinders: jobLoadCylinders || null,
          } : {}),
        };
      } else {
        body = {
          payment_type: paymentType || null,
          amount: codAmount ? Number(codAmount) : null,
          wait_time_minutes: waitTime,
          notes: codNotes || null,
        };
      }
      await onSave(activeTab, body);
    } finally {
      setSaving(false);
    }
  }, [activeTab, waterLitres, waterReason, nitrogenAdded, fibersAdded, loadTested, loadTemp, loadAir, loadSlump, loadCylinders, truckStart, truckEnd, plantNotes, superPlasticizer, colorAdded, fiberJob, otherAdded, conveyor, conveyorOrdered, unloadedConveyor, loadDisputed, washoutArea, jobsiteNotes, jobLoadTested, jobLoadTemp, jobLoadAir, jobLoadSlump, jobLoadCylinders, paymentType, codAmount, waitTime, codNotes, onSave]);

  const Sep = () => <View style={{height: StyleSheet.hairlineWidth, backgroundColor: c.border, marginVertical: wp(2)}} />;

  const pickerConfig = pickerType === 'reason'
    ? {title: 'REASON', options: WATER_REASONS, selected: waterReason, onSelect: setWaterReason}
    : pickerType === 'nitrogen'
    ? {title: 'SELECT', options: ADDITIVE_OPTIONS, selected: nitrogenAdded, onSelect: setNitrogenAdded}
    : pickerType === 'fibers'
    ? {title: 'SELECT', options: ADDITIVE_OPTIONS, selected: fibersAdded, onSelect: setFibersAdded}
    : pickerType === 'washout'
    ? {title: 'WASHOUT AREA', options: WASHOUT_OPTIONS, selected: washoutArea, onSelect: setWashoutArea}
    : pickerType === 'loadSlump'
    ? {title: 'SELECT SLUMP  mm', options: Array.from({length: 21}, (_, i) => String(80 + i * 10)), selected: String(loadSlump), onSelect: (v: string) => setLoadSlump(Number(v))}
    : pickerType === 'jobLoadSlump'
    ? {title: 'SELECT SLUMP  mm', options: Array.from({length: 21}, (_, i) => String(80 + i * 10)), selected: String(jobLoadSlump), onSelect: (v: string) => setJobLoadSlump(Number(v))}
    : pickerType === 'jobsiteNotes'
    ? {title: 'JOBSITE NOTES', options: JOBSITE_NOTES_OPTIONS, selected: '', onSelect: (v: string) => setJobsiteNotes(prev => prev ? prev + '\n' + v : v)}
    : pickerType === 'payment'
    ? {title: 'SELECT PAYMENT', options: PAYMENT_TYPES, selected: paymentType, onSelect: setPaymentType}
    : pickerType === 'superPlasticizer'
    ? {title: 'SELECT', options: JOBSITE_SELECT_OPTIONS, selected: superPlasticizer, onSelect: setSuperPlasticizer}
    : pickerType === 'colorAdded'
    ? {title: 'SELECT', options: JOBSITE_SELECT_OPTIONS, selected: colorAdded, onSelect: setColorAdded}
    : pickerType === 'fiberJob'
    ? {title: 'SELECT', options: JOBSITE_SELECT_OPTIONS, selected: fiberJob, onSelect: setFiberJob}
    : pickerType === 'conveyor'
    ? {title: 'SELECT', options: JOBSITE_SELECT_OPTIONS, selected: conveyor, onSelect: setConveyor}
    : null;

  const renderPlantTab = () => (
    <>
      {/* Water Added */}
      <View style={s.row}>
        <Text style={[s.rowLabel, {color: c.textPrimary, flex: 0, width: wp(50), fontFamily: MONO}]}>WATER{'\n'}ADDED{'\n'}(FULL)</Text>
        <View style={{flexDirection: 'row', borderWidth: 1.5, borderColor: c.primary, borderRadius: wp(5), overflow: 'hidden'}}>
          <TouchableOpacity onPress={() => setWaterLitres(Math.max(0, waterLitres - 1))} style={{width: wp(16), height: wp(15), alignItems: 'center', justifyContent: 'center', backgroundColor: c.primarySurface, borderRightWidth: 1, borderRightColor: c.primary}}>
            <Text style={{fontSize: ms(7), fontWeight: '700', color: c.primary, fontFamily: MONO}}>—</Text>
          </TouchableOpacity>
          <View style={{minWidth: wp(20), height: wp(15), alignItems: 'center', justifyContent: 'center'}}>
            <TextInput style={{fontSize: ms(7), fontWeight: '700', color: c.textPrimary, textAlign: 'center', padding: 0, minWidth: wp(20)}} value={String(waterLitres)} onChangeText={t => setWaterLitres(Number(t.replace(/[^0-9]/g, '')) || 0)} keyboardType="numeric" />
          </View>
          <TouchableOpacity onPress={() => setWaterLitres(waterLitres + 1)} style={{width: wp(16), height: wp(15), alignItems: 'center', justifyContent: 'center', backgroundColor: c.primarySurface, borderLeftWidth: 1, borderLeftColor: c.primary}}>
            <Text style={{fontSize: ms(7), fontWeight: '700', color: c.primary, fontFamily: MONO}}>+</Text>
          </TouchableOpacity>
        </View>
        <Text style={{fontSize: ms(7), fontWeight: '600', color: c.textMuted, marginHorizontal: wp(3), fontFamily: MONO}}>L</Text>
        <TouchableOpacity onPress={() => setPickerType('reason')} style={[s.selectBox, {borderColor: c.border, flex: 1}]}>
          <Text style={{fontSize: ms(6), fontWeight: '600', color: waterReason ? c.textPrimary : c.textMuted, fontFamily: MONO}} numberOfLines={1}>{waterReason || 'SELECT REASON'}</Text>
        </TouchableOpacity>
      </View>
      <Sep />

      {/* Nitrogen */}
      <View style={s.row}>
        <Text style={[s.rowLabel, {color: c.textPrimary, fontFamily: MONO}]}>NITROGEN ADDED</Text>
        <TouchableOpacity onPress={() => setPickerType('nitrogen')} style={[s.selectBox, {borderColor: c.border}]}>
          <Text style={{fontSize: ms(7), fontWeight: '600', color: nitrogenAdded ? c.textPrimary : c.textMuted, fontFamily: MONO}}>{nitrogenAdded || 'Select'}</Text>
        </TouchableOpacity>
      </View>
      <Sep />

      {/* Fibers */}
      <View style={s.row}>
        <Text style={[s.rowLabel, {color: c.textPrimary, fontFamily: MONO}]}>FIBERS ADDED</Text>
        <TouchableOpacity onPress={() => setPickerType('fibers')} style={[s.selectBox, {borderColor: c.border}]}>
          <Text style={{fontSize: ms(7), fontWeight: '600', color: fibersAdded ? c.textPrimary : c.textMuted, fontFamily: MONO}}>{fibersAdded || 'Select'}</Text>
        </TouchableOpacity>
      </View>
      <Sep />

      {/* Truck Rental */}
      <Text style={[s.sectionLabel, {color: c.textPrimary, fontFamily: MONO}]}>TRUCK RENTAL</Text>
      <View style={{flexDirection: 'row', alignItems: 'center', gap: wp(6), marginTop: wp(4), marginBottom: wp(4)}}>
        <Text style={{fontSize: ms(7), fontWeight: '600', color: c.textMuted, fontFamily: MONO}}>START</Text>
        <TouchableOpacity onPress={() => {
          const now = new Date();
          if (truckStart) { setTruckTimeHour(parseInt(truckStart.split(':')[0], 10)); setTruckTimeMinute(parseInt(truckStart.split(':')[1], 10)); }
          else { setTruckTimeHour(now.getHours()); setTruckTimeMinute(now.getMinutes()); }
          setTruckTimePicker('start');
        }} style={[s.selectBox, {borderColor: c.border}]}>
          <Text style={{fontSize: ms(7), fontWeight: '600', color: truckStart ? c.textPrimary : c.textMuted, fontFamily: MONO}}>{truckStart || 'Select Time'}</Text>
        </TouchableOpacity>
        <Text style={{fontSize: ms(7), fontWeight: '600', color: c.textMuted, fontFamily: MONO}}>END</Text>
        <TouchableOpacity onPress={() => {
          const now = new Date();
          if (truckEnd) { setTruckTimeHour(parseInt(truckEnd.split(':')[0], 10)); setTruckTimeMinute(parseInt(truckEnd.split(':')[1], 10)); }
          else { setTruckTimeHour(now.getHours()); setTruckTimeMinute(now.getMinutes()); }
          setTruckTimePicker('end');
        }} style={[s.selectBox, {borderColor: c.border}]}>
          <Text style={{fontSize: ms(7), fontWeight: '600', color: truckEnd ? c.textPrimary : c.textMuted, fontFamily: MONO}}>{truckEnd || 'Select Time'}</Text>
        </TouchableOpacity>
      </View>
      <Sep />

      {/* Plant Notes */}
      <Text style={[s.sectionLabel, {color: c.textPrimary, fontFamily: MONO}]}>PLANT NOTES</Text>
      <TextInput
        style={[s.notesInput, {borderColor: c.border, color: c.textPrimary, backgroundColor: c.white}]}
        value={plantNotes}
        onChangeText={setPlantNotes}
        placeholder="Enter notes..."
        placeholderTextColor={c.textMuted}
        multiline
        numberOfLines={3}
        textAlignVertical="top"
      />
      <Sep />

      {/* Load Tested */}
      <View style={s.row}>
        <Text style={[s.rowLabel, {color: c.textPrimary, fontFamily: MONO}]}>LOAD TESTED</Text>
        <View style={{flexDirection: 'row', gap: wp(4)}}>
          <TouchableOpacity onPress={() => setLoadTested('yes')} style={[s.toggleBtn, loadTested === 'yes' ? {backgroundColor: c.primary, borderColor: c.primary} : {borderColor: c.border}]}>
            <Text style={{fontSize: ms(7), fontWeight: '600', color: loadTested === 'yes' ? '#fff' : c.textPrimary, fontFamily: MONO}}>Yes</Text>
          </TouchableOpacity>
          <TouchableOpacity onPress={() => setLoadTested('no')} style={[s.toggleBtn, loadTested === 'no' ? {backgroundColor: c.primary, borderColor: c.primary} : {borderColor: c.border}]}>
            <Text style={{fontSize: ms(7), fontWeight: '600', color: loadTested === 'no' ? '#fff' : c.textPrimary, fontFamily: MONO}}>No</Text>
          </TouchableOpacity>
        </View>
      </View>

      {/* Load Test Fields — shown when Yes */}
      {loadTested === 'yes' && (
        <>
          <Sep />
          <View style={s.row}>
            <Text style={[s.rowLabel, {color: c.textPrimary, fontFamily: MONO}]}>TEMP</Text>
            <View style={{flexDirection: 'row', alignItems: 'center', gap: wp(3)}}>
              <View style={{flexDirection: 'row', borderWidth: 1.5, borderColor: c.primary, borderRadius: wp(5), overflow: 'hidden'}}>
                <TouchableOpacity onPress={() => setLoadTemp(Math.max(0, loadTemp - 1))} style={{width: wp(16), height: wp(15), alignItems: 'center', justifyContent: 'center', backgroundColor: c.primarySurface, borderRightWidth: 1, borderRightColor: c.primary}}>
                  <Text style={{fontSize: ms(7), fontWeight: '700', color: c.primary, fontFamily: MONO}}>—</Text>
                </TouchableOpacity>
                <View style={{minWidth: wp(20), height: wp(15), alignItems: 'center', justifyContent: 'center'}}>
                  <TextInput style={{fontSize: ms(7), fontWeight: '700', color: c.textPrimary, textAlign: 'center', padding: 0, minWidth: wp(20)}} value={String(loadTemp)} onChangeText={t => setLoadTemp(Number(t.replace(/[^0-9]/g, '')) || 0)} keyboardType="numeric" />
                </View>
                <TouchableOpacity onPress={() => setLoadTemp(loadTemp + 1)} style={{width: wp(16), height: wp(15), alignItems: 'center', justifyContent: 'center', backgroundColor: c.primarySurface, borderLeftWidth: 1, borderLeftColor: c.primary}}>
                  <Text style={{fontSize: ms(7), fontWeight: '700', color: c.primary, fontFamily: MONO}}>+</Text>
                </TouchableOpacity>
              </View>
              <Text style={{fontSize: ms(7), fontWeight: '600', color: c.textMuted, fontFamily: MONO}}>C</Text>
            </View>
          </View>
          <Sep />
          <View style={s.row}>
            <Text style={[s.rowLabel, {color: c.textPrimary, fontFamily: MONO}]}>AIR</Text>
            <View style={{flexDirection: 'row', alignItems: 'center', gap: wp(3)}}>
              <View style={{flexDirection: 'row', borderWidth: 1.5, borderColor: c.primary, borderRadius: wp(5), overflow: 'hidden'}}>
                <TouchableOpacity onPress={() => setLoadAir(Math.max(0, loadAir - 1))} style={{width: wp(16), height: wp(15), alignItems: 'center', justifyContent: 'center', backgroundColor: c.primarySurface, borderRightWidth: 1, borderRightColor: c.primary}}>
                  <Text style={{fontSize: ms(7), fontWeight: '700', color: c.primary, fontFamily: MONO}}>—</Text>
                </TouchableOpacity>
                <View style={{minWidth: wp(20), height: wp(15), alignItems: 'center', justifyContent: 'center'}}>
                  <TextInput style={{fontSize: ms(7), fontWeight: '700', color: c.textPrimary, textAlign: 'center', padding: 0, minWidth: wp(20)}} value={String(loadAir)} onChangeText={t => setLoadAir(Number(t.replace(/[^0-9.]/g, '')) || 0)} keyboardType="numeric" />
                </View>
                <TouchableOpacity onPress={() => setLoadAir(loadAir + 1)} style={{width: wp(16), height: wp(15), alignItems: 'center', justifyContent: 'center', backgroundColor: c.primarySurface, borderLeftWidth: 1, borderLeftColor: c.primary}}>
                  <Text style={{fontSize: ms(7), fontWeight: '700', color: c.primary, fontFamily: MONO}}>+</Text>
                </TouchableOpacity>
              </View>
              <Text style={{fontSize: ms(7), fontWeight: '600', color: c.textMuted, fontFamily: MONO}}>%</Text>
            </View>
          </View>
          <Sep />
          <View style={s.row}>
            <Text style={[s.rowLabel, {color: c.textPrimary, fontFamily: MONO}]}>SLUMP</Text>
            <View style={{flexDirection: 'row', alignItems: 'center', gap: wp(3)}}>
              <View style={{flexDirection: 'row', borderWidth: 1.5, borderColor: c.primary, borderRadius: wp(5), overflow: 'hidden'}}>
                <TouchableOpacity onPress={() => setLoadSlump(Math.max(0, loadSlump - 10))} style={{width: wp(16), height: wp(15), alignItems: 'center', justifyContent: 'center', backgroundColor: c.primarySurface, borderRightWidth: 1, borderRightColor: c.primary}}>
                  <Text style={{fontSize: ms(7), fontWeight: '700', color: c.primary, fontFamily: MONO}}>—</Text>
                </TouchableOpacity>
                <View style={{minWidth: wp(20), height: wp(15), alignItems: 'center', justifyContent: 'center'}}>
                  <TextInput style={{fontSize: ms(7), fontWeight: '700', color: c.textPrimary, textAlign: 'center', padding: 0, minWidth: wp(20)}} value={String(loadSlump)} onChangeText={t => setLoadSlump(Number(t.replace(/[^0-9]/g, '')) || 0)} keyboardType="numeric" />
                </View>
                <TouchableOpacity onPress={() => setLoadSlump(loadSlump + 10)} style={{width: wp(16), height: wp(15), alignItems: 'center', justifyContent: 'center', backgroundColor: c.primarySurface, borderLeftWidth: 1, borderLeftColor: c.primary}}>
                  <Text style={{fontSize: ms(7), fontWeight: '700', color: c.primary, fontFamily: MONO}}>+</Text>
                </TouchableOpacity>
              </View>
              <Text style={{fontSize: ms(7), fontWeight: '600', color: c.textMuted, fontFamily: MONO}}>mm</Text>
              <TouchableOpacity onPress={() => setPickerType('loadSlump')} style={{width: wp(12), height: wp(12), borderRadius: wp(6), borderWidth: 1, borderColor: c.primary, alignItems: 'center', justifyContent: 'center'}}>
                <Icon name="more-horiz" size={ms(7)} color={c.primary} />
              </TouchableOpacity>
            </View>
          </View>
          <Sep />
          <View style={s.row}>
            <Text style={[s.rowLabel, {color: c.textPrimary, fontFamily: MONO}]}>CYLINDERS</Text>
            <View style={{flexDirection: 'row', borderWidth: 1.5, borderColor: c.primary, borderRadius: wp(5), overflow: 'hidden'}}>
              <TouchableOpacity onPress={() => setLoadCylinders(Math.max(0, loadCylinders - 1))} style={{width: wp(16), height: wp(15), alignItems: 'center', justifyContent: 'center', backgroundColor: c.primarySurface, borderRightWidth: 1, borderRightColor: c.primary}}>
                <Text style={{fontSize: ms(7), fontWeight: '700', color: c.primary, fontFamily: MONO}}>—</Text>
              </TouchableOpacity>
              <View style={{minWidth: wp(20), height: wp(15), alignItems: 'center', justifyContent: 'center'}}>
                <TextInput style={{fontSize: ms(7), fontWeight: '700', color: c.textPrimary, textAlign: 'center', padding: 0, minWidth: wp(20)}} value={String(loadCylinders)} onChangeText={t => setLoadCylinders(Number(t.replace(/[^0-9]/g, '')) || 0)} keyboardType="numeric" />
              </View>
              <TouchableOpacity onPress={() => setLoadCylinders(loadCylinders + 1)} style={{width: wp(16), height: wp(15), alignItems: 'center', justifyContent: 'center', backgroundColor: c.primarySurface, borderLeftWidth: 1, borderLeftColor: c.primary}}>
                <Text style={{fontSize: ms(7), fontWeight: '700', color: c.primary, fontFamily: MONO}}>+</Text>
              </TouchableOpacity>
            </View>
          </View>
        </>
      )}
    </>
  );

  const Checkbox = ({value, onToggle}: {value: boolean; onToggle: () => void}) => (
    <TouchableOpacity onPress={onToggle} style={{width: wp(10), height: wp(10), borderRadius: wp(2), borderWidth: 1.5, borderColor: value ? c.primary : c.border, backgroundColor: value ? c.primary : 'transparent', alignItems: 'center', justifyContent: 'center'}}>
      {value && <Icon name="check" size={ms(6)} color="#fff" />}
    </TouchableOpacity>
  );

  const renderJobsiteTab = () => (
    <>
      <View style={s.row}>
        <Text style={[s.rowLabel, {color: c.textPrimary, fontFamily: MONO}]}>SUPER PLASTICIZER</Text>
        <TouchableOpacity onPress={() => setPickerType('superPlasticizer')} style={[s.selectBox, {borderColor: c.border}]}>
          <Text style={{fontSize: ms(7), fontWeight: '600', color: superPlasticizer ? c.textPrimary : c.textMuted, fontFamily: MONO}}>{superPlasticizer || 'Select'}</Text>
        </TouchableOpacity>
        {(superPlasticizer === 'CUSTOMER' || superPlasticizer === 'DRIVER') && (
          <TextInput style={{borderBottomWidth: 1, borderBottomColor: c.border, fontSize: ms(7), fontWeight: '600', color: c.textPrimary, paddingVertical: wp(1), marginLeft: wp(4), width: wp(30), textAlign: 'center'}} value={superPlasticizerQty} onChangeText={t => setSuperPlasticizerQty(t.replace(/[^0-9.]/g, ''))} placeholder="Qty" placeholderTextColor={c.textMuted} keyboardType="numeric" />
        )}
      </View>
      <Sep />
      <View style={s.row}>
        <Text style={[s.rowLabel, {color: c.textPrimary, fontFamily: MONO}]}>COLOR</Text>
        <TouchableOpacity onPress={() => setPickerType('colorAdded')} style={[s.selectBox, {borderColor: c.border}]}>
          <Text style={{fontSize: ms(7), fontWeight: '600', color: colorAdded ? c.textPrimary : c.textMuted, fontFamily: MONO}}>{colorAdded || 'Select'}</Text>
        </TouchableOpacity>
        {(colorAdded === 'CUSTOMER' || colorAdded === 'DRIVER') && (
          <TextInput style={{borderBottomWidth: 1, borderBottomColor: c.border, fontSize: ms(7), fontWeight: '600', color: c.textPrimary, paddingVertical: wp(1), marginLeft: wp(4), width: wp(30), textAlign: 'center'}} value={colorQty} onChangeText={t => setColorQty(t.replace(/[^0-9.]/g, ''))} placeholder="Qty" placeholderTextColor={c.textMuted} keyboardType="numeric" />
        )}
      </View>
      <Sep />
      <View style={s.row}>
        <Text style={[s.rowLabel, {color: c.textPrimary, fontFamily: MONO}]}>FIBER</Text>
        <TouchableOpacity onPress={() => setPickerType('fiberJob')} style={[s.selectBox, {borderColor: c.border}]}>
          <Text style={{fontSize: ms(7), fontWeight: '600', color: fiberJob ? c.textPrimary : c.textMuted, fontFamily: MONO}}>{fiberJob || 'Select'}</Text>
        </TouchableOpacity>
        {(fiberJob === 'CUSTOMER' || fiberJob === 'DRIVER') && (
          <TextInput style={{borderBottomWidth: 1, borderBottomColor: c.border, fontSize: ms(7), fontWeight: '600', color: c.textPrimary, paddingVertical: wp(1), marginLeft: wp(4), width: wp(30), textAlign: 'center'}} value={fiberQty} onChangeText={t => setFiberQty(t.replace(/[^0-9.]/g, ''))} placeholder="Qty" placeholderTextColor={c.textMuted} keyboardType="numeric" />
        )}
      </View>
      <Sep />
      <View style={s.row}>
        <Text style={[s.rowLabel, {color: c.textPrimary, fontFamily: MONO}]}>OTHER</Text>
        <TextInput
          style={{flex: 1, borderBottomWidth: 1, borderBottomColor: c.border, fontSize: ms(7), fontWeight: '600', color: c.textPrimary, paddingVertical: wp(2), marginLeft: wp(10)}}
          value={otherAdded}
          onChangeText={setOtherAdded}
          placeholderTextColor={c.textMuted}
        />
      </View>
      <Sep />
      <View style={s.row}>
        <Text style={[s.rowLabel, {color: c.textPrimary, fontFamily: MONO}]}>CONVEYOR</Text>
        <TouchableOpacity onPress={() => setPickerType('conveyor')} style={[s.selectBox, {borderColor: c.border, width: wp(60), alignItems: 'center'}]}>
          <Text style={{fontSize: ms(7), fontWeight: '600', color: conveyor ? c.textPrimary : c.textMuted, fontFamily: MONO}}>{conveyor || 'Select'}</Text>
        </TouchableOpacity>
      </View>
      <Sep />
      <View style={s.row}>
        <Text style={[s.rowLabel, {color: c.textPrimary, fontFamily: MONO}]}>CONVEYOR ORDERED NOT USED</Text>
        <Checkbox value={conveyorOrdered} onToggle={() => setConveyorOrdered(!conveyorOrdered)} />
      </View>
      <Sep />
      <View style={s.row}>
        <Text style={[s.rowLabel, {color: c.textPrimary, fontFamily: MONO}]}>UNLOADED OVER CONVEYOR, NOT USED</Text>
        <Checkbox value={unloadedConveyor} onToggle={() => setUnloadedConveyor(!unloadedConveyor)} />
      </View>
      <Sep />
      <View style={s.row}>
        <Text style={[s.rowLabel, {color: c.textPrimary, fontFamily: MONO}]}>LOAD DISPUTED</Text>
        <Checkbox value={loadDisputed} onToggle={() => setLoadDisputed(!loadDisputed)} />
      </View>
      <Sep />
      <View style={s.row}>
        <Text style={[s.rowLabel, {color: c.textPrimary, fontFamily: MONO}]}>WASHOUT AREA</Text>
        <TouchableOpacity onPress={() => setPickerType('washout')} style={[s.selectBox, {borderColor: c.border}]}>
          <Text style={{fontSize: ms(7), fontWeight: '600', color: washoutArea ? c.textPrimary : c.textMuted, fontFamily: MONO}} numberOfLines={1}>{washoutArea || 'Select'}</Text>
        </TouchableOpacity>
      </View>
      {washoutArea === 'OTHER' && (
        <>
          <Text style={[s.sectionLabel, {color: c.textPrimary, fontFamily: MONO}]}>WASHOUT — COMMENTS</Text>
          <TextInput
            style={[s.notesInput, {borderColor: c.border, color: c.textPrimary, backgroundColor: c.white, minHeight: wp(28)}]}
            value={washoutComments}
            onChangeText={setWashoutComments}
            placeholder="Describe the washout area"
            placeholderTextColor={c.textMuted}
            multiline
            textAlignVertical="top"
          />
        </>
      )}
      <Sep />
      <View style={{flexDirection: 'row', alignItems: 'center', marginTop: wp(2)}}>
        <Text style={[s.sectionLabel, {color: c.textPrimary, marginTop: 0, fontFamily: MONO}]}>INTERNAL JOBSITE NOTES</Text>
        <TouchableOpacity onPress={() => setPickerType('jobsiteNotes')} style={{width: wp(14), height: wp(14), borderRadius: wp(7), borderWidth: 1.5, borderColor: c.primary, alignItems: 'center', justifyContent: 'center', marginLeft: wp(4)}}>
          <Icon name="more-horiz" size={ms(8)} color={c.primary} />
        </TouchableOpacity>
      </View>
      <TextInput
        style={[s.notesInput, {borderColor: c.border, color: c.textPrimary, backgroundColor: c.white}]}
        value={jobsiteNotes}
        onChangeText={setJobsiteNotes}
        placeholder="Jobsite notes..."
        placeholderTextColor={c.textMuted}
        multiline
        numberOfLines={3}
        textAlignVertical="top"
      />
      <Sep />
      <View style={s.row}>
        <Text style={[s.rowLabel, {color: c.textPrimary, fontFamily: MONO}]}>LOAD TESTED</Text>
        <View style={{flexDirection: 'row', gap: wp(4)}}>
          <TouchableOpacity onPress={() => setJobLoadTested('yes')} style={[s.toggleBtn, jobLoadTested === 'yes' ? {backgroundColor: c.primary, borderColor: c.primary} : {borderColor: c.border}]}>
            <Text style={{fontSize: ms(7), fontWeight: '600', color: jobLoadTested === 'yes' ? '#fff' : c.textPrimary, fontFamily: MONO}}>Yes</Text>
          </TouchableOpacity>
          <TouchableOpacity onPress={() => setJobLoadTested('no')} style={[s.toggleBtn, jobLoadTested === 'no' ? {backgroundColor: c.primary, borderColor: c.primary} : {borderColor: c.border}]}>
            <Text style={{fontSize: ms(7), fontWeight: '600', color: jobLoadTested === 'no' ? '#fff' : c.textPrimary, fontFamily: MONO}}>No</Text>
          </TouchableOpacity>
        </View>
      </View>
      {jobLoadTested === 'yes' && (
        <>
          <Sep />
          <View style={s.row}>
            <Text style={[s.rowLabel, {color: c.textPrimary, fontFamily: MONO}]}>TEMP</Text>
            <View style={{flexDirection: 'row', alignItems: 'center', gap: wp(3)}}>
              <View style={{flexDirection: 'row', borderWidth: 1.5, borderColor: c.primary, borderRadius: wp(5), overflow: 'hidden'}}>
                <TouchableOpacity onPress={() => setJobLoadTemp(Math.max(0, jobLoadTemp - 1))} style={{width: wp(16), height: wp(15), alignItems: 'center', justifyContent: 'center', backgroundColor: c.primarySurface, borderRightWidth: 1, borderRightColor: c.primary}}>
                  <Text style={{fontSize: ms(7), fontWeight: '700', color: c.primary, fontFamily: MONO}}>—</Text>
                </TouchableOpacity>
                <View style={{minWidth: wp(20), height: wp(15), alignItems: 'center', justifyContent: 'center'}}>
                  <TextInput style={{fontSize: ms(7), fontWeight: '700', color: c.textPrimary, textAlign: 'center', padding: 0, minWidth: wp(20)}} value={String(jobLoadTemp)} onChangeText={t => setJobLoadTemp(Number(t.replace(/[^0-9]/g, '')) || 0)} keyboardType="numeric" />
                </View>
                <TouchableOpacity onPress={() => setJobLoadTemp(jobLoadTemp + 1)} style={{width: wp(16), height: wp(15), alignItems: 'center', justifyContent: 'center', backgroundColor: c.primarySurface, borderLeftWidth: 1, borderLeftColor: c.primary}}>
                  <Text style={{fontSize: ms(7), fontWeight: '700', color: c.primary, fontFamily: MONO}}>+</Text>
                </TouchableOpacity>
              </View>
              <Text style={{fontSize: ms(7), fontWeight: '600', color: c.textMuted, fontFamily: MONO}}>C</Text>
            </View>
          </View>
          <Sep />
          <View style={s.row}>
            <Text style={[s.rowLabel, {color: c.textPrimary, fontFamily: MONO}]}>AIR</Text>
            <View style={{flexDirection: 'row', alignItems: 'center', gap: wp(3)}}>
              <View style={{flexDirection: 'row', borderWidth: 1.5, borderColor: c.primary, borderRadius: wp(5), overflow: 'hidden'}}>
                <TouchableOpacity onPress={() => setJobLoadAir(Math.max(0, jobLoadAir - 1))} style={{width: wp(16), height: wp(15), alignItems: 'center', justifyContent: 'center', backgroundColor: c.primarySurface, borderRightWidth: 1, borderRightColor: c.primary}}>
                  <Text style={{fontSize: ms(7), fontWeight: '700', color: c.primary, fontFamily: MONO}}>—</Text>
                </TouchableOpacity>
                <View style={{minWidth: wp(20), height: wp(15), alignItems: 'center', justifyContent: 'center'}}>
                  <TextInput style={{fontSize: ms(7), fontWeight: '700', color: c.textPrimary, textAlign: 'center', padding: 0, minWidth: wp(20)}} value={String(jobLoadAir)} onChangeText={t => setJobLoadAir(Number(t.replace(/[^0-9.]/g, '')) || 0)} keyboardType="numeric" />
                </View>
                <TouchableOpacity onPress={() => setJobLoadAir(jobLoadAir + 1)} style={{width: wp(16), height: wp(15), alignItems: 'center', justifyContent: 'center', backgroundColor: c.primarySurface, borderLeftWidth: 1, borderLeftColor: c.primary}}>
                  <Text style={{fontSize: ms(7), fontWeight: '700', color: c.primary, fontFamily: MONO}}>+</Text>
                </TouchableOpacity>
              </View>
              <Text style={{fontSize: ms(7), fontWeight: '600', color: c.textMuted, fontFamily: MONO}}>%</Text>
            </View>
          </View>
          <Sep />
          <View style={s.row}>
            <Text style={[s.rowLabel, {color: c.textPrimary, fontFamily: MONO}]}>SLUMP</Text>
            <View style={{flexDirection: 'row', alignItems: 'center', gap: wp(3)}}>
              <View style={{flexDirection: 'row', borderWidth: 1.5, borderColor: c.primary, borderRadius: wp(5), overflow: 'hidden'}}>
                <TouchableOpacity onPress={() => setJobLoadSlump(Math.max(0, jobLoadSlump - 10))} style={{width: wp(16), height: wp(15), alignItems: 'center', justifyContent: 'center', backgroundColor: c.primarySurface, borderRightWidth: 1, borderRightColor: c.primary}}>
                  <Text style={{fontSize: ms(7), fontWeight: '700', color: c.primary, fontFamily: MONO}}>—</Text>
                </TouchableOpacity>
                <View style={{minWidth: wp(20), height: wp(15), alignItems: 'center', justifyContent: 'center'}}>
                  <TextInput style={{fontSize: ms(7), fontWeight: '700', color: c.textPrimary, textAlign: 'center', padding: 0, minWidth: wp(20)}} value={String(jobLoadSlump)} onChangeText={t => setJobLoadSlump(Number(t.replace(/[^0-9]/g, '')) || 0)} keyboardType="numeric" />
                </View>
                <TouchableOpacity onPress={() => setJobLoadSlump(jobLoadSlump + 10)} style={{width: wp(16), height: wp(15), alignItems: 'center', justifyContent: 'center', backgroundColor: c.primarySurface, borderLeftWidth: 1, borderLeftColor: c.primary}}>
                  <Text style={{fontSize: ms(7), fontWeight: '700', color: c.primary, fontFamily: MONO}}>+</Text>
                </TouchableOpacity>
              </View>
              <Text style={{fontSize: ms(7), fontWeight: '600', color: c.textMuted, fontFamily: MONO}}>mm</Text>
              <TouchableOpacity onPress={() => setPickerType('jobLoadSlump')} style={{width: wp(12), height: wp(12), borderRadius: wp(6), borderWidth: 1, borderColor: c.primary, alignItems: 'center', justifyContent: 'center'}}>
                <Icon name="more-horiz" size={ms(7)} color={c.primary} />
              </TouchableOpacity>
            </View>
          </View>
          <Sep />
          <View style={s.row}>
            <Text style={[s.rowLabel, {color: c.textPrimary, fontFamily: MONO}]}>CYLINDERS</Text>
            <View style={{flexDirection: 'row', borderWidth: 1.5, borderColor: c.primary, borderRadius: wp(5), overflow: 'hidden'}}>
              <TouchableOpacity onPress={() => setJobLoadCylinders(Math.max(0, jobLoadCylinders - 1))} style={{width: wp(16), height: wp(15), alignItems: 'center', justifyContent: 'center', backgroundColor: c.primarySurface, borderRightWidth: 1, borderRightColor: c.primary}}>
                <Text style={{fontSize: ms(7), fontWeight: '700', color: c.primary, fontFamily: MONO}}>—</Text>
              </TouchableOpacity>
              <View style={{minWidth: wp(20), height: wp(15), alignItems: 'center', justifyContent: 'center'}}>
                <TextInput style={{fontSize: ms(7), fontWeight: '700', color: c.textPrimary, textAlign: 'center', padding: 0, minWidth: wp(20)}} value={String(jobLoadCylinders)} onChangeText={t => setJobLoadCylinders(Number(t.replace(/[^0-9]/g, '')) || 0)} keyboardType="numeric" />
              </View>
              <TouchableOpacity onPress={() => setJobLoadCylinders(jobLoadCylinders + 1)} style={{width: wp(16), height: wp(15), alignItems: 'center', justifyContent: 'center', backgroundColor: c.primarySurface, borderLeftWidth: 1, borderLeftColor: c.primary}}>
                <Text style={{fontSize: ms(7), fontWeight: '700', color: c.primary, fontFamily: MONO}}>+</Text>
              </TouchableOpacity>
            </View>
          </View>
        </>
      )}
    </>
  );

  const renderCodTab = () => (
    <>
      {/* Payment */}
      <View style={s.row}>
        <Text style={[s.rowLabel, {color: c.textPrimary, fontFamily: MONO}]}>PAYMENT</Text>
        <TouchableOpacity onPress={() => setPickerType('payment')} style={[s.selectBox, {borderColor: c.border}]}>
          <Text style={{fontSize: ms(7), fontWeight: '600', color: paymentType ? c.textPrimary : c.textMuted, fontFamily: MONO}}>{paymentType || 'Select'}</Text>
        </TouchableOpacity>
      </View>
      <Sep />

      {/* Wait Time */}
      <View style={s.row}>
        <Text style={[s.rowLabel, {color: c.textPrimary, fontFamily: MONO}]}>WAIT TIME</Text>
        <View style={{flexDirection: 'row', alignItems: 'center', gap: wp(3)}}>
          <View style={{flexDirection: 'row', borderWidth: 1.5, borderColor: c.primary, borderRadius: wp(5), overflow: 'hidden'}}>
            <TouchableOpacity onPress={() => setWaitTime(Math.max(0, waitTime - 1))} style={{width: wp(16), height: wp(15), alignItems: 'center', justifyContent: 'center', backgroundColor: c.primarySurface, borderRightWidth: 1, borderRightColor: c.primary}}>
              <Text style={{fontSize: ms(7), fontWeight: '700', color: c.primary, fontFamily: MONO}}>—</Text>
            </TouchableOpacity>
            <View style={{minWidth: wp(20), height: wp(15), alignItems: 'center', justifyContent: 'center'}}>
              <TextInput style={{fontSize: ms(7), fontWeight: '700', color: c.textPrimary, textAlign: 'center', padding: 0, minWidth: wp(20)}} value={String(waitTime)} onChangeText={t => setWaitTime(Number(t.replace(/[^0-9]/g, '')) || 0)} keyboardType="numeric" />
            </View>
            <TouchableOpacity onPress={() => setWaitTime(waitTime + 1)} style={{width: wp(16), height: wp(15), alignItems: 'center', justifyContent: 'center', backgroundColor: c.primarySurface, borderLeftWidth: 1, borderLeftColor: c.primary}}>
              <Text style={{fontSize: ms(7), fontWeight: '700', color: c.primary, fontFamily: MONO}}>+</Text>
            </TouchableOpacity>
          </View>
          <Text style={{fontSize: ms(7), fontWeight: '600', color: c.textMuted, fontFamily: MONO}}>Minute(s)</Text>
        </View>
      </View>
      <Sep />

      {/* COD Notes */}
      <Text style={[s.sectionLabel, {color: c.textPrimary, fontFamily: MONO}]}>COD NOTES</Text>
      <TextInput
        style={[s.notesInput, {borderColor: c.border, color: c.textPrimary, backgroundColor: c.white}]}
        value={codNotes}
        onChangeText={setCodNotes}
        placeholder="COD notes..."
        placeholderTextColor={c.textMuted}
        multiline
        numberOfLines={3}
        textAlignVertical="top"
      />
    </>
  );

  return (
    <>
    <ResponsiveModal visible={visible} onClose={onClose} maxWidth={isLandscape ? 400 : 380} widthPercent={isLandscape ? 34 : 85} maxHeightPercent={isLandscape ? 85 : 80} avoidKeyboard>
      <View style={[s.container, {backgroundColor: c.white}]}>
        {/* Header */}
        <View style={s.header}>
          <Text style={[s.subtitle, {color: c.textMuted, fontFamily: MONO}]}>ADDITIONAL ENTRIES</Text>
          <Text style={[s.title, {color: c.textPrimary, fontFamily: MONO}]}>ORDER {orderCode} / TICKET {ticketCode}</Text>
        </View>

        {/* Tabs */}
        <View style={s.tabsRow}>
          {TABS.map(tab => {
            const active = activeTab === tab.key;
            return (
              <TouchableOpacity key={tab.key} activeOpacity={0.7} onPress={() => setActiveTab(tab.key)}
                style={[s.tabPill, active ? {backgroundColor: c.primary, borderColor: c.primary} : {borderColor: c.border}]}>
                <Text style={{fontSize: ms(6), fontWeight: '700', letterSpacing: 0.5, color: active ? '#fff' : c.textMuted, fontFamily: MONO}}>{tab.label}</Text>
              </TouchableOpacity>
            );
          })}
        </View>

        {/* Content */}
        <View style={{flexDirection: 'row', maxHeight: keyboardHeight > 0 ? (isLandscape ? 150 : 200) : (isLandscape ? 250 : 350)}}>
          <ScrollView
            ref={scrollRef}
            bounces={false}
            keyboardShouldPersistTaps="handled"
            showsVerticalScrollIndicator={false}
            style={{flex: 1}}
            contentContainerStyle={{paddingHorizontal: wp(8), paddingBottom: keyboardHeight > 0 ? keyboardHeight * 0.3 : wp(4)}}
            onScroll={Animated.event([{nativeEvent: {contentOffset: {y: scrollY}}}], {useNativeDriver: false})}
            scrollEventThrottle={16}
            onContentSizeChange={(_, h) => setContentHeight(h)}
            onLayout={e => setScrollViewHeight(e.nativeEvent.layout.height)}>
            {activeTab === 'plant' && renderPlantTab()}
            {activeTab === 'jobsite' && renderJobsiteTab()}
            {activeTab === 'cod' && renderCodTab()}
          </ScrollView>
          <View style={{width: wp(3), backgroundColor: c.border + '30', borderRadius: wp(2), marginVertical: wp(4), marginRight: wp(2)}}>
            {contentHeight > scrollViewHeight ? (
              <Animated.View style={{
                width: wp(3),
                borderRadius: wp(2),
                backgroundColor: c.textMuted,
                height: scrollViewHeight > 0 ? Math.max(20, (scrollViewHeight / contentHeight) * scrollViewHeight) : 20,
                transform: [{translateY: scrollY.interpolate({
                  inputRange: [0, Math.max(1, contentHeight - scrollViewHeight)],
                  outputRange: [0, scrollViewHeight - Math.max(20, (scrollViewHeight / contentHeight) * scrollViewHeight)],
                  extrapolate: 'clamp',
                })}],
              }} />
            ) : (
              <View style={{width: wp(3), borderRadius: wp(2), backgroundColor: c.textMuted + '40', flex: 1}} />
            )}
          </View>
        </View>

        {/* Footer */}
        <View style={[s.footer, {borderTopColor: c.border}]}>
          <TouchableOpacity activeOpacity={0.7} onPress={onClose} style={[s.cancelBtn, {borderColor: c.border}]}>
            <Text style={{fontSize: ms(7), fontWeight: '600', color: c.textPrimary, fontFamily: MONO}}>Cancel</Text>
          </TouchableOpacity>
          <TouchableOpacity activeOpacity={0.7} onPress={handleSave} disabled={saving} style={[s.saveBtn, {backgroundColor: c.primary}]}>
            {saving ? <ActivityIndicator size="small" color="#fff" /> : <Text style={{fontSize: ms(7), fontWeight: '700', color: '#fff', fontFamily: MONO}}>Save Changes</Text>}
          </TouchableOpacity>
        </View>
      </View>
    </ResponsiveModal>

    {/* ─── Picker Modal ─── */}
    <ResponsiveModal
      visible={pickerType != null}
      onClose={() => setPickerType(null)}
      maxWidth={isLandscape ? 280 : 260}
      widthPercent={isLandscape ? 22 : 55}
      maxHeightPercent={55}>
      {pickerConfig && (
        <>
          <View style={{paddingHorizontal: ms(10), paddingTop: ms(8), paddingBottom: ms(4), alignItems: 'center'}}>
            <Text style={{fontSize: ms(6), fontWeight: '600', color: c.textMuted, textTransform: 'uppercase', letterSpacing: 1, textAlign: 'center', fontFamily: MONO}}>ADDITIONAL ENTRIES</Text>
            <Text style={{fontSize: ms(6), fontWeight: '800', color: c.textPrimary, marginTop: 1, textAlign: 'center', fontFamily: MONO}}>{pickerConfig.title}</Text>
          </View>
          <View style={{marginHorizontal: ms(10), borderWidth: 1.5, borderColor: c.border, borderRadius: wp(6), overflow: 'hidden'}}>
            <ScrollView showsVerticalScrollIndicator persistentScrollbar bounces={false} style={{maxHeight: isLandscape ? 200 : 280}}>
              {pickerConfig.options.map((opt, i) => {
                const sel = pickerConfig.selected === opt;
                const isLast = i === pickerConfig.options.length - 1;
                return (
                  <TouchableOpacity key={opt} activeOpacity={0.6} onPress={() => { pickerConfig.onSelect(opt); setPickerType(null); }}
                    style={{paddingVertical: ms(8), paddingHorizontal: ms(12), borderBottomWidth: isLast ? 0 : 1, borderBottomColor: c.border, backgroundColor: sel ? c.primary : 'transparent', alignItems: 'center'}}>
                    <Text style={{fontSize: ms(7), fontWeight: '700', color: sel ? '#fff' : c.textPrimary, textAlign: 'center', letterSpacing: 0.5, fontFamily: MONO}}>{opt}</Text>
                  </TouchableOpacity>
                );
              })}
            </ScrollView>
          </View>
          <View style={{alignItems: 'flex-end', paddingHorizontal: ms(10), paddingTop: ms(6), paddingBottom: ms(4)}}>
            <TouchableOpacity onPress={() => setPickerType(null)} activeOpacity={0.7}
              style={{backgroundColor: c.primary, paddingVertical: ms(5), paddingHorizontal: ms(14), borderRadius: ms(5)}}>
              <Text style={{fontSize: ms(6), fontWeight: '700', color: '#fff', fontFamily: MONO}}>Close</Text>
            </TouchableOpacity>
          </View>
        </>
      )}
    </ResponsiveModal>

    {/* ─── Truck Time Picker Modal ─── */}
    <ResponsiveModal
      visible={truckTimePicker != null}
      onClose={() => setTruckTimePicker(null)}
      maxWidth={isLandscape ? 280 : 240}
      widthPercent={isLandscape ? 22 : 55}
      maxHeightPercent={55}>
      <View style={{backgroundColor: c.white, borderRadius: 12, overflow: 'hidden', padding: wp(10)}}>
        <Text style={{fontSize: ms(7), fontWeight: '600', color: c.textMuted, textTransform: 'uppercase', letterSpacing: 1, fontFamily: MONO}}>ADDITIONAL ENTRIES</Text>
        <Text style={{fontSize: ms(7), fontWeight: '800', color: c.textPrimary, marginTop: 1, marginBottom: wp(4), fontFamily: MONO}}>SELECT TIME</Text>
        <View style={{flexDirection: 'row', marginBottom: wp(2)}}>
          <Text style={{flex: 1, textAlign: 'center', fontSize: ms(7), fontWeight: '600', color: c.textMuted, fontFamily: MONO}}>Hours</Text>
          <Text style={{flex: 1, textAlign: 'center', fontSize: ms(7), fontWeight: '600', color: c.textMuted, fontFamily: MONO}}>Minutes</Text>
        </View>
        <View style={{flexDirection: 'row', height: 120, overflow: 'hidden'}}>
          <View style={{flex: 1, position: 'relative'}}>
            <View pointerEvents="none" style={{position: 'absolute', top: 40, left: 0, right: 0, height: 40, borderTopWidth: 1.5, borderBottomWidth: 1.5, borderColor: c.border, backgroundColor: c.primarySurface, zIndex: 0}} />
            <ScrollView style={{flex: 1}} showsVerticalScrollIndicator={false} snapToInterval={40} decelerationRate="fast"
              contentContainerStyle={{paddingVertical: 40}} contentOffset={{x: 0, y: truckTimeHour * 40}}
              onMomentumScrollEnd={(e) => { const idx = Math.round(e.nativeEvent.contentOffset.y / 40); setTruckTimeHour(Math.max(0, Math.min(23, idx))); }}>
              {Array.from({length: 24}, (_, i) => (
                <TouchableOpacity key={i} onPress={() => setTruckTimeHour(i)} style={{height: 40, justifyContent: 'center', alignItems: 'center'}}>
                  <Text style={{fontSize: ms(12), fontWeight: truckTimeHour === i ? '900' : '400', color: truckTimeHour === i ? c.textPrimary : c.textMuted, fontFamily: MONO}}>{String(i).padStart(2, '0')}</Text>
                </TouchableOpacity>
              ))}
            </ScrollView>
          </View>
          <View style={{flex: 1, position: 'relative'}}>
            <View pointerEvents="none" style={{position: 'absolute', top: 40, left: 0, right: 0, height: 40, borderTopWidth: 1.5, borderBottomWidth: 1.5, borderColor: c.border, backgroundColor: c.primarySurface, zIndex: 0}} />
            <ScrollView style={{flex: 1}} showsVerticalScrollIndicator={false} snapToInterval={40} decelerationRate="fast"
              contentContainerStyle={{paddingVertical: 40}} contentOffset={{x: 0, y: truckTimeMinute * 40}}
              onMomentumScrollEnd={(e) => { const idx = Math.round(e.nativeEvent.contentOffset.y / 40); setTruckTimeMinute(Math.max(0, Math.min(59, idx))); }}>
              {Array.from({length: 60}, (_, i) => (
                <TouchableOpacity key={i} onPress={() => setTruckTimeMinute(i)} style={{height: 40, justifyContent: 'center', alignItems: 'center'}}>
                  <Text style={{fontSize: ms(12), fontWeight: truckTimeMinute === i ? '900' : '400', color: truckTimeMinute === i ? c.textPrimary : c.textMuted, fontFamily: MONO}}>{String(i).padStart(2, '0')}</Text>
                </TouchableOpacity>
              ))}
            </ScrollView>
          </View>
        </View>
        <View style={{flexDirection: 'row', justifyContent: 'flex-end', gap: wp(8), marginTop: wp(8)}}>
          <TouchableOpacity onPress={() => setTruckTimePicker(null)} activeOpacity={0.7} style={{paddingVertical: wp(3), paddingHorizontal: wp(16), borderRadius: 8, borderWidth: 1, borderColor: c.border}}>
            <Text style={{fontSize: ms(7), fontWeight: '600', color: c.textPrimary, fontFamily: MONO}}>Cancel</Text>
          </TouchableOpacity>
          <TouchableOpacity activeOpacity={0.7} onPress={() => {
            const timeStr = `${String(truckTimeHour).padStart(2, '0')}:${String(truckTimeMinute).padStart(2, '0')}`;
            if (truckTimePicker === 'start') setTruckStart(timeStr);
            else setTruckEnd(timeStr);
            setTruckTimePicker(null);
          }} style={{paddingVertical: wp(3), paddingHorizontal: wp(16), borderRadius: 8, backgroundColor: c.primary}}>
            <Text style={{fontSize: ms(7), fontWeight: '700', color: '#fff', fontFamily: MONO}}>OK</Text>
          </TouchableOpacity>
        </View>
      </View>
    </ResponsiveModal>
    </>
  );
}

const s = StyleSheet.create({
  container: {borderRadius: 10, overflow: 'hidden'},
  header: {paddingTop: wp(6), paddingHorizontal: wp(8), paddingBottom: wp(2), alignItems: 'center'},
  subtitle: {fontSize: ms(5), fontWeight: '600', textTransform: 'uppercase', letterSpacing: 1},
  title: {fontSize: ms(7), fontWeight: '800', marginTop: 1},
  tabsRow: {flexDirection: 'row', justifyContent: 'center', gap: wp(3), paddingHorizontal: wp(8), paddingVertical: wp(4)},
  tabPill: {paddingVertical: wp(2), paddingHorizontal: wp(8), borderRadius: wp(10), borderWidth: 1.5},
  row: {flexDirection: 'row', alignItems: 'center', gap: wp(6), paddingVertical: wp(1)},
  rowLabel: {fontSize: ms(7), fontWeight: '700', letterSpacing: 0.3, flex: 1},
  sectionLabel: {fontSize: ms(7), fontWeight: '700', letterSpacing: 0.3, marginTop: wp(2)},
  stepBtn: {width: wp(22), height: wp(22), borderRadius: wp(5), borderWidth: 1.5, alignItems: 'center', justifyContent: 'center'},
  selectBox: {borderWidth: 1.5, borderRadius: wp(6), paddingVertical: wp(3), paddingHorizontal: wp(6)},
  toggleBtn: {paddingVertical: wp(2), paddingHorizontal: wp(10), borderRadius: wp(10), borderWidth: 1.5},
  notesInput: {borderWidth: 1.5, borderRadius: wp(6), paddingVertical: wp(3), paddingHorizontal: wp(6), fontSize: ms(7), fontWeight: '500', minHeight: wp(36), marginTop: wp(2)},
  footer: {flexDirection: 'row', justifyContent: 'flex-end', gap: wp(4), paddingHorizontal: wp(8), paddingVertical: wp(5), borderTopWidth: StyleSheet.hairlineWidth},
  cancelBtn: {paddingVertical: wp(2), paddingHorizontal: wp(10), borderRadius: wp(5), borderWidth: 1.5},
  saveBtn: {paddingVertical: wp(2), paddingHorizontal: wp(10), borderRadius: wp(5), minWidth: wp(70), alignItems: 'center', justifyContent: 'center'},
});
