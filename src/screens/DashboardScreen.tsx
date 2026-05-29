import React, {useState, useEffect, useRef, useCallback} from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  StatusBar,
  useWindowDimensions,
  RefreshControl,
  Animated,
  Pressable,
  Linking,
  Platform,
} from 'react-native';
import {useSafeAreaInsets} from 'react-native-safe-area-context';
import MaterialIcons from 'react-native-vector-icons/MaterialIcons';
import type {NativeStackNavigationProp} from '@react-navigation/native-stack';
import {useTranslation} from 'react-i18next';
import QRCode from 'react-native-qrcode-svg';
import {useTheme} from '../contexts/ThemeContext';
import {Colors} from '../constants/colors';
import {common} from '../constants/commonStyles';
import ResponsiveModal from '../components/ResponsiveModal';
import {wp, ms} from '../utils/responsive';

const TICKETS = ['26209538', '31369591', '31369583'];

const TIMELINE = [
  {labelKey: 'timeline.ticketed', time: '07:46', icon: 'receipt-long', done: true},
  {labelKey: 'timeline.loading', time: '07:49', icon: 'hourglass-bottom', done: true},
  {labelKey: 'timeline.toJob', time: '08:05', icon: 'local-shipping', done: true},
  {labelKey: 'timeline.onJob', time: '08:23', icon: 'location-on', done: true},
  {labelKey: 'timeline.pouring', time: '08:46', icon: 'water-drop', done: true},
  {labelKey: 'timeline.washing', time: '09:08', icon: 'clean-hands', done: true},
  {labelKey: 'timeline.toPlant', time: '09:10', icon: 'route', done: true},
  {labelKey: 'timeline.atPlant', time: '--', icon: 'factory', done: false},
];

const JOB_INFO = [
  {labelKey: 'jobInfo.customer', value: 'GILLAM CONSTRUCTION GROUP', icon: 'people'},
  {labelKey: 'jobInfo.project', value: 'BLDG A - SEWELLS ROAD RESIDENTIAL BUILDI', icon: 'apartment'},
  {labelKey: 'jobInfo.job', value: 'BLDG A - SEWELLS ROAD RESIDENTIAL BUILDI', icon: 'work'},
  {labelKey: 'orderInfo.timeDue', value: '08:00 AM', icon: 'schedule'},
  {labelKey: 'orderInfo.deliveredTo', value: '123 MAIN ST, SCARBOROUGH ON', icon: 'place', isLink: true, isMap: true},
  {labelKey: 'orderInfo.lotBlock', value: 'LOT 5 / BLOCK A', icon: 'grid-view'},
  {labelKey: 'orderInfo.instructions', value: 'POUR AT REAR ENTRANCE - USE CHUTE', icon: 'info-outline'},
];

const openAddressInMaps = (address: string) => {
  const encoded = encodeURIComponent(address);
  const url = Platform.select({
    ios: `maps:0,0?q=${encoded}`,
    default: `https://www.google.com/maps/search/?api=1&query=${encoded}`,
  });
  Linking.openURL(url!);
};

const MIX_INFO: {labelKey: string; value: string; icon?: string; isLink?: boolean; isHighlight?: boolean}[] = [
  {labelKey: 'mixInfo.mixId', value: '6138438', icon: 'tag'},
  {labelKey: 'mixInfo.description', value: '30MPA MR', icon: 'science', isLink: true},
  {labelKey: 'mixInfo.usage', value: 'SUSPENDED SLAB', icon: 'category'},
  {labelKey: 'mixInfo.slump', value: '120+-30 mm', isHighlight: true},
  {labelKey: 'orderInfo.quantity', value: '3.40 m3', icon: 'straighten'},
  {labelKey: 'orderInfo.loads', value: '1 of 3', icon: 'layers'},
  {labelKey: 'orderInfo.trucks', value: '108693', icon: 'local-shipping'},
];

const MIX_PRODUCTS = [
  {code: '6138576', desc: '35MPA AIR C1 .40', qty: '3.40', unit: 'm3'},
  {code: '12581', desc: 'TOARC FEE', qty: '1.00', unit: '/l'},
  {code: '14301', desc: 'FLEX FUEL SURCHARGE', qty: '1.00', unit: '/l'},
  {code: '15902', desc: 'INDUSTRIAL EMISSIONS CHARGE', qty: '1.00', unit: '/l'},
  {code: '2571', desc: 'ENVIRONMENTAL CHARGE - M3', qty: '1.00', unit: '/l'},
  {code: '5843', desc: 'FUEL SURCHARGE - CBM /M3', qty: '1.00', unit: '/l'},
  {code: '2386', desc: 'DELIVERY CHARGE', qty: '1.00', unit: '/l'},
];

const BOTTOM_ACTIONS = [
  {icon: 'note-alt', labelKey: 'actions.notes'},
  {icon: 'label', labelKey: 'actions.tag'},
  {icon: 'edit', labelKey: 'actions.edit'},
  {icon: 'local-shipping', labelKey: 'actions.truck'},
  {icon: 'qr-code-scanner', labelKey: 'actions.qr'},
];

const MENU_ITEMS = [
  {icon: 'local-shipping', label: 'Vehicle', color: ''},
  {icon: 'person-off', label: 'Logout Driver', color: ''},
  {icon: 'domain-disabled', label: 'Logout Tenant', color: 'warn'},
  {icon: 'translate', label: 'Language', color: ''},
  {icon: 'info-outline', label: 'About', color: ''},
];

const doneCount = TIMELINE.filter(s => s.done).length;
const progressPct = (doneCount / TIMELINE.length) * 100;

// Skeleton shimmer
function Skeleton({width: w, height: h, radius = 8, style}: any) {
  const {c} = useTheme();
  const shimmer = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    Animated.loop(
      Animated.sequence([
        Animated.timing(shimmer, {toValue: 1, duration: 800, useNativeDriver: true}),
        Animated.timing(shimmer, {toValue: 0, duration: 800, useNativeDriver: true}),
      ]),
    ).start();
  }, [shimmer]);
  return (
    <Animated.View
      style={[
        {width: w, height: h, borderRadius: radius, backgroundColor: c.border},
        {opacity: shimmer.interpolate({inputRange: [0, 1], outputRange: [0.25, 0.6]})},
        style,
      ]}
    />
  );
}

// Animated card with spring entrance
function FadeCard({children, delay = 0, style}: any) {
  const anim = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    Animated.spring(anim, {
      toValue: 1,
      friction: 8,
      tension: 50,
      delay,
      useNativeDriver: true,
    }).start();
  }, [anim, delay]);
  return (
    <Animated.View
      style={[
        style,
        {
          opacity: anim,
          transform: [
            {translateY: anim.interpolate({inputRange: [0, 1], outputRange: [24, 0]})},
            {scale: anim.interpolate({inputRange: [0, 1], outputRange: [0.97, 1]})},
          ],
        },
      ]}>
      {children}
    </Animated.View>
  );
}

type Props = {
  navigation: NativeStackNavigationProp<any>;
};

export default function DashboardScreen({navigation}: Props) {
  const [activeTicket, setActiveTicket] = useState(0);
  const [refreshing, setRefreshing] = useState(false);
  const [loading, setLoading] = useState(true);
  const [menuVisible, setMenuVisible] = useState(false);
  const [qrVisible, setQrVisible] = useState(false);
  const [plantsVisible, setPlantsVisible] = useState(false);
  const [editVisible, setEditVisible] = useState(false);
  const [productsVisible, setProductsVisible] = useState(false);
  const [activeBottom, setActiveBottom] = useState(-1);
  const [lastSyncTime, setLastSyncTime] = useState<Date>(() => new Date());
  const [syncAgo, setSyncAgo] = useState('just now');
  const {t} = useTranslation();
  const {isDark, toggle, c} = useTheme();
  const insets = useSafeAreaInsets();
  const {width, height: winHeight} = useWindowDimensions();
  const isTablet = Math.min(width, winHeight) > 600;
  const isLandscape = width > winHeight;
  const menuScale = useRef(new Animated.Value(0)).current;
  const menuOpacity = useRef(new Animated.Value(0)).current;
  const syncSpin = useRef(new Animated.Value(0)).current;

  // Relative time updater
  useEffect(() => {
    const update = () => {
      const diff = Math.floor((Date.now() - lastSyncTime.getTime()) / 1000);
      if (diff < 10) setSyncAgo('just now');
      else if (diff < 60) setSyncAgo(`${diff}s ago`);
      else if (diff < 3600) setSyncAgo(`${Math.floor(diff / 60)}m ago`);
      else setSyncAgo(`${Math.floor(diff / 3600)}h ago`);
    };
    update();
    const iv = setInterval(update, 30000);
    return () => clearInterval(iv);
  }, [lastSyncTime]);

  useEffect(() => {
    const timer = setTimeout(() => setLoading(false), 1400);
    return () => clearTimeout(timer);
  }, []);

  const handleSync = useCallback(() => {
    // Animate the sync icon spin
    syncSpin.setValue(0);
    Animated.timing(syncSpin, {toValue: 1, duration: 600, useNativeDriver: true}).start();
    setRefreshing(true);
    setLoading(true);
    setTimeout(() => {
      setRefreshing(false);
      setLoading(false);
      setLastSyncTime(new Date());
    }, 1000);
  }, [syncSpin]);

  const onRefresh = useCallback(() => {
    setRefreshing(true);
    setLoading(true);
    setTimeout(() => {
      setRefreshing(false);
      setLoading(false);
      setLastSyncTime(new Date());
    }, 1000);
  }, []);

  const syncRotate = syncSpin.interpolate({inputRange: [0, 1], outputRange: ['0deg', '360deg']});

  const openMenu = () => {
    setMenuVisible(true);
    Animated.parallel([
      Animated.spring(menuScale, {toValue: 1, friction: 7, tension: 70, useNativeDriver: true}),
      Animated.timing(menuOpacity, {toValue: 1, duration: 200, useNativeDriver: true}),
    ]).start();
  };

  const closeMenu = () => {
    Animated.parallel([
      Animated.timing(menuScale, {toValue: 0, duration: 150, useNativeDriver: true}),
      Animated.timing(menuOpacity, {toValue: 0, duration: 150, useNativeDriver: true}),
    ]).start(() => setMenuVisible(false));
  };

  const handleNavPress = useCallback((item: typeof BOTTOM_ACTIONS[0], i: number) => {
    setActiveBottom(i);
    if (item.icon === 'label') {navigation.navigate('MobileTicket');}
    if (item.icon === 'note-alt') {navigation.navigate('Notes');}
    if (item.icon === 'edit') {setEditVisible(true);}
    if (item.icon === 'qr-code-scanner') {setQrVisible(true);}
    if (item.icon === 'local-shipping') {setPlantsVisible(true);}
  }, [navigation]);

  // Shorthand flags
  const L = isLandscape;
  const lp = isLandscape && !isTablet; // landscape phone — most space-constrained
  const lt = isLandscape && isTablet;  // landscape tablet — more room, larger fonts
  const cs = {
    card: {
      backgroundColor: c.white,
      borderRadius: lt ? 16 : L ? 14 : wp(16),
      padding: lt ? 16 : L ? 12 : wp(14),
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: c.border,
      elevation: isDark ? 0 : 2,
      shadowColor: Colors.shadowColor,
      shadowOffset: {width: 0, height: 1},
      shadowOpacity: isDark ? 0 : 0.06,
      shadowRadius: 6,
    },
  };

  // Skeleton state
  if (loading && !refreshing) {
    return (
      <View style={[styles.container, {backgroundColor: c.background}]}>
        <StatusBar translucent backgroundColor="transparent" barStyle="light-content" />
        <View style={[styles.header, {backgroundColor: c.primaryDark, paddingTop: insets.top + (isLandscape ? 2 : wp(3)), paddingLeft: Math.max(isLandscape ? 10 : wp(12), insets.left), paddingRight: Math.max(isLandscape ? 10 : wp(12), insets.right)}, isLandscape && {paddingBottom: 3}]}>
          <View style={styles.headerRow}>
            <View style={styles.headerLeft}>
              <Skeleton width={wp(40)} height={wp(40)} radius={wp(14)} />
              <View style={{gap: wp(6), marginLeft: wp(10)}}>
                <Skeleton width={wp(72)} height={wp(16)} radius={wp(6)} />
                <Skeleton width={wp(100)} height={wp(11)} radius={wp(5)} />
              </View>
            </View>
            <View style={common.rowGap8}>
              <Skeleton width={wp(36)} height={wp(36)} radius={wp(10)} />
              <Skeleton width={wp(36)} height={wp(36)} radius={wp(10)} />
              <Skeleton width={wp(36)} height={wp(36)} radius={wp(10)} />
            </View>
          </View>
          <View style={{flexDirection: 'row', gap: wp(8), marginTop: wp(4)}}>
            <Skeleton width={wp(105)} height={wp(36)} radius={wp(12)} />
            <Skeleton width={wp(105)} height={wp(36)} radius={wp(12)} />
            <Skeleton width={wp(105)} height={wp(36)} radius={wp(12)} />
          </View>
        </View>
        <View style={[{padding: wp(16), gap: wp(14), paddingLeft: Math.max(wp(16), insets.left + wp(4)), paddingRight: Math.max(wp(16), insets.right + wp(4))}, isTablet && {padding: 20, maxWidth: 900, alignSelf: 'center', width: '100%'}]}>
          <Skeleton width="100%" height={wp(86)} radius={wp(18)} />
          <View style={common.rowGap8}>
            <Skeleton width={wp(85)} height={wp(30)} radius={wp(15)} />
            <Skeleton width={wp(115)} height={wp(30)} radius={wp(15)} />
            <Skeleton width={wp(55)} height={wp(30)} radius={wp(15)} />
          </View>
          <Skeleton width="100%" height={wp(130)} radius={wp(18)} />
          <Skeleton width="100%" height={wp(170)} radius={wp(18)} />
          <Skeleton width="100%" height={wp(170)} radius={wp(18)} />
          <Skeleton width="100%" height={wp(46)} radius={wp(12)} />
        </View>
      </View>
    );
  }

  // ─── NAVIGATION BAR ───
  const renderNavBtn = (item: typeof BOTTOM_ACTIONS[0], i: number) => {
    const active = activeBottom === i;
    if (L) {
      return (
        <TouchableOpacity
          key={item.labelKey}
          activeOpacity={0.6}
          onPress={() => handleNavPress(item, i)}
          style={{alignItems: 'center', justifyContent: 'center', paddingVertical: 8}}>
          <View style={{
            width: 38, height: 38, justifyContent: 'center', alignItems: 'center',
            borderRadius: 12, backgroundColor: active ? c.primarySurface : 'transparent',
          }}>
            <MaterialIcons name={item.icon as any} size={20} color={active ? c.primary : c.textMuted} />
          </View>
        </TouchableOpacity>
      );
    }
    return (
      <TouchableOpacity
        key={item.labelKey}
        activeOpacity={0.6}
        onPress={() => handleNavPress(item, i)}
        style={{alignItems: 'center', justifyContent: 'center', paddingVertical: 4, minWidth: 56}}>
        <View style={{
          width: 40, height: 32, justifyContent: 'center', alignItems: 'center',
          borderRadius: 12, backgroundColor: active ? c.primarySurface : 'transparent',
        }}>
          <MaterialIcons name={item.icon as any} size={isTablet ? 21 : 20} color={active ? c.primary : c.textMuted} />
        </View>
        <Text style={{fontSize: ms(9), fontWeight: active ? '700' : '500', color: active ? c.primary : c.textMuted, marginTop: 2}}>{t(item.labelKey)}</Text>
      </TouchableOpacity>
    );
  };

  return (
    <View style={[styles.container, {backgroundColor: c.background}, L && {flexDirection: 'row'}]}>
      <StatusBar translucent backgroundColor="transparent" barStyle="light-content" />

      {/* Main content column */}
      <View style={{flex: 1}}>
      {/* ─── HEADER ─── */}
      <View style={[styles.header, {backgroundColor: c.primaryDark, paddingTop: insets.top + (L ? 2 : wp(3)), paddingLeft: Math.max(L ? 8 : wp(12), insets.left), paddingRight: Math.max(L ? 8 : wp(12), insets.right)}, L && {paddingBottom: 2}]}>
        {lp ? (
          /* Phone landscape: single compact row — tickets moved to KPI card */
          <View style={{flexDirection: 'row', alignItems: 'center', gap: 8}}>
            <View style={{flexDirection: 'row', alignItems: 'center', gap: 6, flex: 1}}>
              <View style={{width: 26, height: 26, borderRadius: 8, justifyContent: 'center', alignItems: 'center', backgroundColor: c.primary}}>
                <MaterialIcons name="local-shipping" size={16} color={c.textOnPrimary} />
              </View>
              <Text style={{fontSize: 13, fontWeight: '800', letterSpacing: 0.5, color: c.textOnPrimary}}>{t('app.name')}</Text>
            </View>
            {/* Sync pill */}
            <TouchableOpacity onPress={handleSync} activeOpacity={0.7} style={{flexDirection: 'row', alignItems: 'center', gap: 4, backgroundColor: c.overlay10, paddingVertical: 4, paddingHorizontal: 8, borderRadius: 12}}>
              <Animated.View style={{transform: [{rotate: syncRotate}]}}><MaterialIcons name="sync" size={13} color={c.textOnPrimary} /></Animated.View>
              <View style={{width: 4, height: 4, borderRadius: 2, backgroundColor: refreshing ? c.warning : c.success}} />
              <Text style={{fontSize: 9, fontWeight: '600', color: c.textOnDark60}}>{syncAgo}</Text>
            </TouchableOpacity>
            <View style={{flexDirection: 'row', alignItems: 'center', gap: 4}}>
              <TouchableOpacity style={{width: 28, height: 28, borderRadius: 8, justifyContent: 'center', alignItems: 'center', backgroundColor: c.overlay10}} onPress={toggle} activeOpacity={0.7}>
                <MaterialIcons name={isDark ? 'light-mode' : 'dark-mode'} size={15} color={c.textOnPrimary} />
              </TouchableOpacity>
              <TouchableOpacity style={{width: 28, height: 28, borderRadius: 8, justifyContent: 'center', alignItems: 'center', backgroundColor: c.overlay10}} onPress={openMenu} activeOpacity={0.7}>
                <MaterialIcons name="menu" size={15} color={c.textOnPrimary} />
              </TouchableOpacity>
            </View>
          </View>
        ) : (
          /* Portrait + tablet landscape: two-row header */
          <>
            <View style={[styles.headerRow, L && {marginBottom: 3}]}>
              <View style={styles.headerLeft}>
                <View style={[styles.logo, {backgroundColor: c.primary}, L && {width: 30, height: 30, borderRadius: 9}]}>
                  <MaterialIcons name="local-shipping" size={L ? 18 : ms(isTablet ? 24 : 20)} color={c.textOnPrimary} />
                </View>
                <View style={{marginLeft: L ? 8 : wp(10)}}>
                  <Text style={[styles.logoTitle, {color: c.textOnPrimary}, L && {fontSize: 15}]}>{t('app.name')}</Text>
                  <Text style={[styles.logoSub, {color: c.textOnDark60, marginTop: 1}, L && {fontSize: 9}]}>{t('dashboard.ticketTracking')}</Text>
                </View>
              </View>
              <View style={[styles.headerActions, L && {gap: 5}]}>
                {/* Sync pill */}
                <TouchableOpacity
                  onPress={handleSync}
                  activeOpacity={0.7}
                  style={[{flexDirection: 'row', alignItems: 'center', gap: wp(5), backgroundColor: c.overlay10, paddingHorizontal: wp(10), borderRadius: wp(14)}, L ? {paddingVertical: 5, paddingHorizontal: 8, borderRadius: 12, gap: 4} : {paddingVertical: wp(5)}]}>
                  <Animated.View style={{transform: [{rotate: syncRotate}]}}>
                    <MaterialIcons name="sync" size={L ? 15 : ms(16)} color={c.textOnPrimary} />
                  </Animated.View>
                  <View style={{width: 5, height: 5, borderRadius: 3, backgroundColor: refreshing ? c.warning : c.success}} />
                  <Text style={{fontSize: L ? 9 : ms(10), fontWeight: '600', color: c.textOnDark60}}>{syncAgo}</Text>
                </TouchableOpacity>
                <TouchableOpacity style={[styles.hdrBtn, {backgroundColor: c.overlay10}, L && {width: 30, height: 30, borderRadius: 9}]} onPress={toggle} activeOpacity={0.7}>
                  <MaterialIcons name={isDark ? 'light-mode' : 'dark-mode'} size={L ? 17 : ms(19)} color={c.textOnPrimary} />
                </TouchableOpacity>
                <TouchableOpacity style={[styles.hdrBtn, {backgroundColor: c.overlay10}, L && {width: 30, height: 30, borderRadius: 9}]} onPress={openMenu} activeOpacity={0.7}>
                  <MaterialIcons name="menu" size={L ? 17 : ms(19)} color={c.textOnPrimary} />
                </TouchableOpacity>
              </View>
            </View>
            {!L && (
              <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.tabsRow}>
                {TICKETS.map((ticket, i) => {
                  const active = activeTicket === i;
                  return (
                    <View key={ticket} style={[styles.tab, {borderColor: c.overlay15, backgroundColor: i === 0 ? c.accent : c.primaryLight}]}>
                      {active && <View style={[styles.tabDot, {backgroundColor: c.textOnPrimary}]} />}
                      <Text style={[styles.tabText, {color: active ? c.textOnPrimary : c.textOnDark70}]}>{ticket}</Text>
                    </View>
                  );
                })}
              </ScrollView>
            )}
          </>
        )}
      </View>

      {/* ─── CONTENT ─── */}
      <ScrollView
        style={styles.scroll}
        contentContainerStyle={[
          styles.scrollInner,
          {gap: 0},
          lt ? {padding: 14, paddingLeft: Math.max(16, insets.left + 8)} : L ? {padding: 10, paddingLeft: Math.max(10, insets.left + 6)} : isTablet ? {padding: 18, paddingLeft: Math.max(22, insets.left + 10), paddingRight: Math.max(22, insets.right + 10)} : {},
        ]}
        showsVerticalScrollIndicator={false}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={c.primary} colors={[c.primary]} />}>

        <View style={isTablet && !L ? {maxWidth: 900, alignSelf: 'center', width: '100%'} : undefined}>

        {/* ── Landscape: KPI + Chips in one row ── */}
        {isLandscape ? (
          <FadeCard delay={0} style={[cs.card, {flexDirection: 'row', alignItems: 'center', gap: lt ? 11 : 8, flexWrap: 'wrap', marginBottom: lt ? 15 : 11, padding: lt ? 15 : 11}]}>
            {/* Ticket numbers */}
            <View style={{flexDirection: 'row', alignItems: 'center', gap: lt ? 7 : 5}}>
              {TICKETS.map((ticket, i) => (
                <View key={ticket} style={{paddingVertical: lt ? 5 : 4, paddingHorizontal: lt ? 10 : 8, borderRadius: lt ? 8 : 6, backgroundColor: i === 0 ? c.accent : c.primaryLight}}>
                  <Text style={{fontSize: lt ? 13 : 11, fontWeight: '700', color: c.textOnPrimary}}>{ticket}</Text>
                </View>
              ))}
            </View>
            <View style={{width: StyleSheet.hairlineWidth, height: lt ? 26 : 22, backgroundColor: c.border, marginHorizontal: lt ? 5 : 3}} />
            {/* KPI items */}
            {[
              {icon: 'receipt-long', val: '26209538', label: t('dashboard.ticket'), color: c.primary},
              {icon: 'tag', val: '2605', label: t('dashboard.order'), color: c.primaryDark},
              {icon: 'local-shipping', val: '108693', label: 'TRUCK', color: c.primary},
            ].map((kpi, i, arr) => (
              <React.Fragment key={kpi.label}>
                <View style={{flexDirection: 'row', alignItems: 'center', gap: lt ? 8 : 6, paddingVertical: lt ? 6 : 5, paddingHorizontal: lt ? 7 : 5}}>
                  <MaterialIcons name={kpi.icon as any} size={lt ? 17 : 15} color={kpi.color} />
                  <View>
                    <Text style={{fontSize: lt ? 15 : 13, fontWeight: '800', color: c.textPrimary}}>{kpi.val}</Text>
                    <Text style={{fontSize: lt ? 11 : 10, fontWeight: '600', color: c.textMuted, letterSpacing: 0.3, marginTop: 2}}>{kpi.label}</Text>
                  </View>
                </View>
                {i < arr.length - 1 && <View style={{width: StyleSheet.hairlineWidth, height: lt ? 26 : 22, backgroundColor: c.border}} />}
              </React.Fragment>
            ))}
            <View style={{flex: 1}} />
            <View style={{flexDirection: 'row', alignItems: 'center', backgroundColor: c.successSurface, paddingVertical: lt ? 6 : 5, paddingHorizontal: lt ? 10 : 8, borderRadius: lt ? 10 : 8, gap: lt ? 5 : 4}}>
              <View style={{width: lt ? 7 : 6, height: lt ? 7 : 6, borderRadius: 4, backgroundColor: c.success}} />
              <Text style={{fontWeight: '600', fontSize: lt ? 13 : 11, color: c.successDark}}>{t('dashboard.active')}</Text>
            </View>
            <View style={{flexDirection: 'row', alignItems: 'center', borderColor: c.border, borderWidth: StyleSheet.hairlineWidth, paddingVertical: lt ? 6 : 5, paddingHorizontal: lt ? 10 : 8, borderRadius: lt ? 10 : 8, gap: lt ? 5 : 4}}>
              <MaterialIcons name="wb-sunny" size={lt ? 14 : 12} color={c.warning} />
              <Text style={{fontWeight: '600', fontSize: lt ? 13 : 11, color: c.textSecondary}}>10°C</Text>
            </View>
          </FadeCard>
        ) : (
          <>
            {/* Portrait: KPI + Status bar */}
            <FadeCard delay={0} style={[cs.card, {padding: wp(10), marginBottom: wp(8)}]}>
              <View style={styles.kpiRow}>
                {[
                  {icon: 'receipt-long', val: '26209538', label: t('dashboard.ticket'), color: c.primary},
                  {icon: 'tag', val: '2605', label: t('dashboard.order'), color: c.primaryDark},
                  {icon: 'local-shipping', val: '108693', label: 'TRUCK', color: c.primary},
                ].map((kpi, i, arr) => (
                  <React.Fragment key={kpi.label}>
                    <View style={styles.kpiItem}>
                      <View style={[styles.kpiIconWrap, {backgroundColor: c.primarySurface}]}>
                        <MaterialIcons name={kpi.icon as any} size={ms(14)} color={kpi.color} />
                      </View>
                      <View>
                        <Text style={[styles.kpiVal, {color: c.textPrimary}]}>{kpi.val}</Text>
                        <Text style={[styles.kpiLabel, {color: c.textMuted}]}>{kpi.label}</Text>
                      </View>
                    </View>
                    {i < arr.length - 1 && <View style={[styles.kpiDivider, {backgroundColor: c.border}]} />}
                  </React.Fragment>
                ))}
              </View>
              <View style={[styles.chipRow, {borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: c.borderLight, marginTop: wp(8), paddingTop: wp(8)}]}>
                <View style={[styles.statusChip, {backgroundColor: c.successSurface}]}>
                  <View style={[styles.chipDot, {backgroundColor: c.success}]} />
                  <Text style={[styles.chipLabel, {color: c.successDark}]}>{t('dashboard.active')}</Text>
                </View>
                <View style={[styles.statusChip, {backgroundColor: c.warningSurface}]}>
                  <MaterialIcons name="warning" size={ms(11)} color={c.warningDark} />
                  <Text style={[styles.chipLabel, {color: c.warningDark}]}>{t('dashboard.onAccount')}</Text>
                </View>
                <View style={{flex: 1}} />
                <View style={[styles.infoChip, {borderColor: c.border}]}>
                  <MaterialIcons name="wb-sunny" size={ms(12)} color={c.warning} />
                  <Text style={[styles.chipLabel, {color: c.textSecondary}]}>10°C</Text>
                </View>
              </View>
            </FadeCard>
          </>
        )}

        {/* Delivery Progress */}
        <FadeCard delay={120} style={[cs.card, L && {padding: lt ? 15 : 11}, {marginBottom: lt ? 15 : L ? 13 : wp(8)}]}>
          <View style={[styles.secHeader, {borderBottomColor: c.borderLight, marginBottom: wp(4), paddingBottom: wp(4)}, L && {marginBottom: lt ? 7 : 5, paddingBottom: lt ? 6 : 5, gap: lt ? 8 : 7}]}>
            <View style={[styles.secIcon, {backgroundColor: c.primary}, L && {width: lt ? 25 : 21, height: lt ? 25 : 21, borderRadius: lt ? 8 : 7}]}>
              <MaterialIcons name="timeline" size={lt ? 15 : L ? 13 : ms(13)} color={c.textOnPrimary} />
            </View>
            <Text style={[styles.secTitle, {color: c.textPrimary, fontSize: ms(12)}, L && {fontSize: lt ? 15 : 13}]}>{t('dashboard.deliveryProgress')}</Text>
            <View style={[styles.countBadge, {backgroundColor: c.primarySurface, borderColor: c.primaryBorder}, L && {paddingHorizontal: lt ? 9 : 7, paddingVertical: lt ? 3 : 2, borderRadius: lt ? 8 : 7}]}>
              <Text style={[styles.countText, {color: c.primary, fontSize: ms(10)}, L && {fontSize: lt ? 12 : 10}]}>{doneCount}/{TIMELINE.length}</Text>
            </View>
          </View>

          {/* Steps */}
          {L ? (
            <View style={{flexDirection: 'row', alignItems: 'flex-start', paddingTop: 4, paddingBottom: 2, marginHorizontal: 4}}>
              {TIMELINE.map((item, i) => {
                const isActive = item.done && (i === TIMELINE.length - 1 || !TIMELINE[i + 1].done);
                const isFirst = i === 0;
                const isLast = i === TIMELINE.length - 1;
                const dotSz = lt ? (isActive ? 20 : 16) : (isActive ? 16 : 12);
                const lineDone = item.done && !isLast && TIMELINE[i + 1]?.done;
                return (
                  <View key={item.labelKey} style={{alignItems: 'center', flex: 1, overflow: 'visible'}}>
                    <View style={{flexDirection: 'row', alignItems: 'center', height: lt ? 22 : 16, width: '100%'}}>
                      {!isFirst && <View style={{flex: 1, height: 2, backgroundColor: item.done ? c.primary : c.border, borderRadius: 1}} />}
                      <View style={{
                        width: dotSz, height: dotSz, borderRadius: dotSz / 2,
                        justifyContent: 'center', alignItems: 'center',
                        backgroundColor: item.done ? c.primary : c.surface,
                        borderWidth: isActive ? 2.5 : 1.5,
                        borderColor: isActive ? c.primaryMuted : item.done ? c.primary : c.border,
                      }}>
                        {item.done && <MaterialIcons name="check" size={lt ? (isActive ? 11 : 9) : (isActive ? 9 : 7)} color={c.textOnPrimary} />}
                      </View>
                      {!isLast && <View style={{flex: 1, height: 2, backgroundColor: lineDone ? c.primary : c.border, borderRadius: 1}} />}
                    </View>
                    <Text style={{fontSize: lt ? 10 : 9, fontWeight: isActive ? '800' : '600', color: isActive ? c.primary : item.done ? c.textSecondary : c.textMuted, textAlign: 'center', marginTop: 4}} numberOfLines={1}>
                      {t(item.labelKey)}
                    </Text>
                    <Text style={{fontSize: lt ? 12 : 11, fontWeight: '800', color: isActive ? c.primaryDark : item.done ? c.primary : c.border, marginTop: 2}}>
                      {item.time}
                    </Text>
                  </View>
                );
              })}
            </View>
          ) : (
            <View style={{flexDirection: 'row', alignItems: 'flex-start', paddingHorizontal: wp(2), paddingTop: wp(2), paddingBottom: wp(1)}}>
              {TIMELINE.map((item, i) => {
                const isActive = item.done && (i === TIMELINE.length - 1 || !TIMELINE[i + 1].done);
                const isFirst = i === 0;
                const isLast = i === TIMELINE.length - 1;
                const dotSz = isActive ? 14 : 10;
                const lineDone = item.done && !isLast && TIMELINE[i + 1]?.done;
                return (
                  <View key={item.labelKey} style={{alignItems: 'center', flex: 1}}>
                    <View style={{flexDirection: 'row', alignItems: 'center', height: 16, width: '100%'}}>
                      {!isFirst && <View style={{flex: 1, height: 2, backgroundColor: item.done ? c.primary : c.border, borderRadius: 1}} />}
                      <View style={{
                        width: dotSz, height: dotSz, borderRadius: dotSz / 2,
                        justifyContent: 'center', alignItems: 'center',
                        backgroundColor: item.done ? c.primary : c.surface,
                        borderWidth: isActive ? 2 : 1.5,
                        borderColor: isActive ? c.primaryMuted : item.done ? c.primary : c.border,
                      }}>
                        {item.done && <MaterialIcons name="check" size={isActive ? 8 : 6} color={c.textOnPrimary} />}
                      </View>
                      {!isLast && <View style={{flex: 1, height: 2, backgroundColor: lineDone ? c.primary : c.border, borderRadius: 1}} />}
                    </View>
                    <Text style={{fontSize: 7, fontWeight: isActive ? '800' : '600', color: isActive ? c.primary : item.done ? c.textSecondary : c.textMuted, textAlign: 'center', marginTop: 2}} numberOfLines={1}>
                      {t(item.labelKey)}
                    </Text>
                    <Text style={{fontSize: 9, fontWeight: '800', color: isActive ? c.primaryDark : item.done ? c.primary : c.border}}>
                      {item.time}
                    </Text>
                  </View>
                );
              })}
            </View>
          )}
        </FadeCard>

        {/* Job + Mix Cards */}
        <View style={[styles.twoCol, (isTablet || L) && {flexDirection: 'row'}, L && {gap: lt ? 13 : 11}]}>
          {/* Job Details */}
          <FadeCard delay={200} style={[cs.card, (isTablet || L) && {flex: 1}, L && {padding: lt ? 17 : 13}]}>
            <View style={[styles.secHeader, L && {marginBottom: lt ? 9 : 7, paddingBottom: lt ? 8 : 6, gap: lt ? 8 : 7}]}>
              <MaterialIcons name="work" size={lt ? 18 : L ? 16 : ms(16)} color={c.accent} />
              <Text style={[styles.secTitle, {color: c.textPrimary}, L && {fontSize: lt ? 16 : 14}]}>{t('dashboard.jobDetails')}</Text>
            </View>
            {JOB_INFO.map((item, i) => (
              <View key={item.labelKey} style={[styles.detailRow, L && {paddingVertical: lt ? 8 : 6}, i < JOB_INFO.length - 1 && {borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: c.borderLight}]}>
                <Text style={[styles.detailLabel, {color: c.textMuted}, L && {fontSize: lt ? 13 : 12}]} numberOfLines={1}>{t(item.labelKey)}</Text>
                {item.isMap ? (
                  <TouchableOpacity activeOpacity={0.6} onPress={() => openAddressInMaps(item.value)} style={common.flex1}>
                    <Text style={[styles.detailValue, {color: c.accent}, L && {fontSize: lt ? 14 : 13}]} numberOfLines={2}>{item.value}</Text>
                  </TouchableOpacity>
                ) : (
                  <Text style={[styles.detailValue, common.flex1, {color: item.isLink ? c.accent : c.textPrimary}, L && {fontSize: lt ? 14 : 13}]} numberOfLines={2}>{item.value}</Text>
                )}
              </View>
            ))}
          </FadeCard>

          {/* Mix Details */}
          <FadeCard delay={280} style={[cs.card, {backgroundColor: c.primarySurface}, (isTablet || L) && {flex: 1}, L && {padding: lt ? 17 : 13}]}>
            <View style={[styles.secHeader, L && {marginBottom: lt ? 9 : 7, paddingBottom: lt ? 8 : 6, gap: lt ? 8 : 7}]}>
              <MaterialIcons name="science" size={lt ? 18 : L ? 16 : ms(16)} color={c.primary} />
              <Text style={[styles.secTitle, {color: c.textPrimary}, L && {fontSize: lt ? 16 : 14}]}>{t('dashboard.mixDetails')}</Text>
            </View>
            {MIX_INFO.map((item, i) => (
              <View key={item.labelKey} style={[styles.detailRow, L && {paddingVertical: lt ? 7 : 5}, i < MIX_INFO.length - 1 && {borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: c.primaryMuted}]}>
                <Text style={[styles.detailLabel, {color: c.textMuted}, L && {fontSize: lt ? 13 : 12}]} numberOfLines={1}>{t(item.labelKey)}</Text>
                {item.isHighlight ? (
                  <View style={[styles.slumpPillInline, {backgroundColor: c.warningSurface, borderColor: c.warningBorder}]}>
                    <Text style={{fontSize: lt ? 14 : L ? 13 : ms(12), fontWeight: '800', color: c.warningDark}}>{item.value}</Text>
                  </View>
                ) : item.isLink ? (
                  <TouchableOpacity activeOpacity={0.6} onPress={() => setProductsVisible(true)} style={common.flex1}>
                    <Text style={[styles.detailValue, {color: c.accent}, L && {fontSize: lt ? 14 : 13}]}>
                      {item.value}
                    </Text>
                  </TouchableOpacity>
                ) : (
                  <Text style={[styles.detailValue, common.flex1, {color: c.textPrimary}, L && {fontSize: lt ? 14 : 13}]}>
                    {item.value}
                  </Text>
                )}
              </View>
            ))}
          </FadeCard>
        </View>

        <View style={{height: L ? wp(16) : wp(14)}} />
        </View>
      </ScrollView>

      </View>{/* end main content column */}

      {/* ─── NAV BAR ─── */}
      {L ? (
        <View style={{
          width: 54 + insets.right,
          paddingRight: insets.right,
          paddingTop: insets.top + 10,
          paddingBottom: Math.max(insets.bottom, 10),
          borderLeftWidth: StyleSheet.hairlineWidth,
          borderLeftColor: c.border,
          backgroundColor: c.white,
          justifyContent: 'center',
          alignItems: 'center',
        }}>
          {BOTTOM_ACTIONS.map(renderNavBtn)}
        </View>
      ) : (
        <View style={{
          flexDirection: 'row',
          justifyContent: 'space-evenly',
          alignItems: 'center',
          borderTopWidth: StyleSheet.hairlineWidth,
          borderTopColor: c.border,
          backgroundColor: c.white,
          paddingTop: 4,
          paddingBottom: insets.bottom || 6,
          paddingLeft: insets.left,
          paddingRight: insets.right,
          elevation: 8,
          shadowColor: Colors.shadowColor,
          shadowOffset: {width: 0, height: -2},
          shadowOpacity: 0.04,
          shadowRadius: 4,
        }}>
          {BOTTOM_ACTIONS.map(renderNavBtn)}
        </View>
      )}

      {/* ─── DROPDOWN MENU ─── */}
      {menuVisible && (
        <View style={StyleSheet.absoluteFill} pointerEvents="box-none">
          <Pressable style={[styles.dropdownOverlay, {backgroundColor: c.overlayDropdown}]} onPress={closeMenu} />
          <Animated.View
            style={[
              styles.dropdown,
              {
                backgroundColor: c.white,
                top: insets.top + wp(58),
                right: Math.max(wp(16), insets.right + wp(4)),
                borderColor: c.border,
                opacity: menuOpacity,
                transform: [
                  {scale: menuScale.interpolate({inputRange: [0, 1], outputRange: [0.85, 1]})},
                  {translateY: menuScale.interpolate({inputRange: [0, 1], outputRange: [-10, 0]})},
                ],
              },
            ]}>
            {/* Header */}
            <View style={[styles.ddHeader, {borderBottomColor: c.borderLight}]}>
              <View style={[styles.ddAvatar, {backgroundColor: c.primarySurface}]}>
                <MaterialIcons name="person" size={ms(18)} color={c.primary} />
              </View>
              <View style={common.flex1}>
                <Text style={[styles.ddName, {color: c.textPrimary}]}>Driver 772</Text>
                <Text style={[styles.ddSub, {color: c.textMuted}]}>ACME Ready-Mix</Text>
              </View>
            </View>

            {/* Menu Items */}
            {MENU_ITEMS.map((item, i) => {
              const isWarn = item.color === 'warn';
              const iconColor = isWarn ? c.error : c.textSecondary;
              const labelColor = isWarn ? c.error : c.textPrimary;
              const bgColor = isWarn ? c.errorSurface : c.surface;
              return (
                <TouchableOpacity
                  key={item.label}
                  style={[
                    styles.ddItem,
                    i < MENU_ITEMS.length - 1 && {borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: c.borderLight},
                  ]}
                  activeOpacity={0.6}
                  onPress={closeMenu}>
                  <View style={[styles.ddIcon, {backgroundColor: bgColor}]}>
                    <MaterialIcons name={item.icon as any} size={ms(18)} color={iconColor} />
                  </View>
                  <Text style={[styles.ddLabel, {color: labelColor}]}>{item.label}</Text>
                  <MaterialIcons name="chevron-right" size={ms(18)} color={c.textMuted} />
                </TouchableOpacity>
              );
            })}

            {/* Version footer */}
            <View style={[styles.ddFooter, {borderTopColor: c.borderLight}]}>
              <Text style={[styles.ddVersion, {color: c.textMuted}]}>v1.20.0</Text>
            </View>
          </Animated.View>
        </View>
      )}

      {/* ─── QR CODE MODAL ─── */}
      <ResponsiveModal
        visible={qrVisible}
        onClose={() => setQrVisible(false)}
        maxWidth={lp ? 580 : isTablet ? 440 : 380}
        widthPercent={lp ? 88 : isTablet ? 55 : isLandscape ? 50 : 85}
        maxHeightPercent={lp ? 92 : isLandscape ? 88 : 80}>
        <View style={{backgroundColor: c.qrBg}}>
          {/* Header */}
          <View style={[styles.qrHeader, {borderBottomColor: c.qrFg + '15'}]}>
            <View style={[styles.qrHeaderIcon, {backgroundColor: c.qrFg + '18'}]}>
              <MaterialIcons name="qr-code-2" size={ms(18)} color={c.qrFg} />
            </View>
            <View style={{flex: 1}}>
              <Text style={[styles.qrHeaderTitle, {color: c.qrFg}]}>QR Code</Text>
              {!lp && <Text style={[styles.qrHeaderSub, {color: c.qrFg + '90'}]}>Scan to verify delivery</Text>}
            </View>
            <TouchableOpacity style={[styles.mCloseBtn, {backgroundColor: c.qrFg + '12'}]} onPress={() => setQrVisible(false)} activeOpacity={0.7} hitSlop={{top: 8, bottom: 8, left: 8, right: 8}}>
              <MaterialIcons name="close" size={ms(18)} color={c.qrFg} />
            </TouchableOpacity>
          </View>

          {lp ? (
            /* Landscape phone: side-by-side layout */
            <View style={{flexDirection: 'row', padding: wp(8), gap: wp(10), alignItems: 'center'}}>
              <View style={{flex: 1, gap: wp(6)}}>
                <View style={{flexDirection: 'row', gap: wp(6)}}>
                  <View style={{flex: 1, alignItems: 'center', paddingVertical: wp(5), borderRadius: wp(8), backgroundColor: c.qrFg + '12'}}>
                    <Text style={{fontSize: ms(8), fontWeight: '700', letterSpacing: 0.6, color: c.qrFg + '80'}}>ORDER</Text>
                    <Text style={{fontSize: ms(14), fontWeight: '900', color: c.qrFg, marginTop: 1}}>2605</Text>
                  </View>
                  <View style={{flex: 1, alignItems: 'center', paddingVertical: wp(5), borderRadius: wp(8), backgroundColor: c.qrFg + '12'}}>
                    <Text style={{fontSize: ms(8), fontWeight: '700', letterSpacing: 0.6, color: c.qrFg + '80'}}>TICKET</Text>
                    <Text style={{fontSize: ms(14), fontWeight: '900', color: c.qrFg, marginTop: 1}}>26209538</Text>
                  </View>
                </View>
                <View style={{gap: wp(3)}}>
                  <View style={{flexDirection: 'row', alignItems: 'center', gap: wp(4)}}>
                    <MaterialIcons name="local-shipping" size={ms(11)} color={c.qrFg + '60'} />
                    <Text style={{fontSize: ms(10), fontWeight: '600', color: c.qrFg + '60'}}>TRUCK 108693 · DRIVER 109003</Text>
                  </View>
                  <View style={{flexDirection: 'row', alignItems: 'center', gap: wp(4)}}>
                    <MaterialIcons name="factory" size={ms(11)} color={c.qrFg + '60'} />
                    <Text style={{fontSize: ms(10), fontWeight: '600', color: c.qrFg + '60'}}>26-SCARBOROUGH R/M</Text>
                  </View>
                </View>
              </View>
              <View style={[styles.qrCodeCard, {backgroundColor: c.white, shadowColor: c.shadowColor}]}>
                <QRCode
                  value="ORDER:2605|TICKET:26209538|TRUCK:108693|DRIVER:109003|PLANT:26-SCARBOROUGH"
                  size={Math.round(Math.min(Math.max(winHeight - insets.top - insets.bottom - 100, 110), 180))}
                  backgroundColor={c.white}
                  color={c.qrFg}
                />
              </View>
            </View>
          ) : (
            /* Portrait + tablet: vertical layout */
            <ScrollView
              bounces={false}
              showsVerticalScrollIndicator={false}
              contentContainerStyle={{alignItems: 'center', paddingVertical: wp(6)}}>
              <View style={styles.qrChipRow}>
                <View style={[styles.qrChip, {backgroundColor: c.qrFg + '12'}]}>
                  <Text style={[styles.qrChipLabel, {color: c.qrFg + '80'}]}>ORDER</Text>
                  <Text style={[styles.qrChipValue, {color: c.qrFg}]}>2605</Text>
                </View>
                <View style={[styles.qrChip, {backgroundColor: c.qrFg + '12'}]}>
                  <Text style={[styles.qrChipLabel, {color: c.qrFg + '80'}]}>TICKET</Text>
                  <Text style={[styles.qrChipValue, {color: c.qrFg}]}>26209538</Text>
                </View>
              </View>
              <View style={styles.qrCodeSection}>
                <View style={[styles.qrCodeCard, {backgroundColor: c.white, shadowColor: c.shadowColor}]}>
                  <QRCode
                    value="ORDER:2605|TICKET:26209538|TRUCK:108693|DRIVER:109003|PLANT:26-SCARBOROUGH"
                    size={Math.round(Math.min(Math.max((width - insets.left - insets.right) * 0.45, 150), isTablet ? 260 : 200))}
                    backgroundColor={c.white}
                    color={c.qrFg}
                  />
                </View>
              </View>
              <View style={styles.qrFooter}>
                <View style={[styles.qrFooterRow, {borderTopColor: c.qrFg + '12'}]}>
                  <MaterialIcons name="local-shipping" size={ms(12)} color={c.qrFg + '70'} />
                  <Text style={[styles.qrFooterText, {color: c.qrFg + '70'}]}>TRUCK 108693 · DRIVER 109003</Text>
                </View>
                <View style={styles.qrFooterRow}>
                  <MaterialIcons name="factory" size={ms(12)} color={c.qrFg + '70'} />
                  <Text style={[styles.qrFooterText, {color: c.qrFg + '70'}]}>26-SCARBOROUGH R/M</Text>
                </View>
              </View>
            </ScrollView>
          )}
        </View>
      </ResponsiveModal>

      {/* ─── PLANTS LIST MODAL ─── */}
      <ResponsiveModal
        visible={plantsVisible}
        onClose={() => setPlantsVisible(false)}
        maxWidth={540}
        maxHeightPercent={70}>
        <View style={[styles.mHeader, {borderBottomColor: c.border}]}>
          <Text style={[styles.mHeaderTitle, {color: c.textPrimary}]}>{t('modals.plants')}</Text>
          <TouchableOpacity style={[styles.mCloseBtn, {backgroundColor: c.surface}]} onPress={() => setPlantsVisible(false)} activeOpacity={0.7} hitSlop={{top: 8, bottom: 8, left: 8, right: 8}}>
            <MaterialIcons name="close" size={ms(20)} color={c.textSecondary} />
          </TouchableOpacity>
        </View>
        <ScrollView style={styles.plantsList} showsVerticalScrollIndicator={true} bounces={false}>
          {[
            '10-BELLEVILLE', '00-BURLINGTON', '01-BRANTFORD R/M', '02-CAMBRIDGE',
            '05-GUELPH', '07-CAPITAL', '8-NEW HAMBURG R/M', '09-THOROLD',
            '11-COBOURG', '12-HULL', '13-KANATA', '14-KINGSTON',
            '31-PORTLANDS', '36-LONDON', '37-SARNIA', '38-ST. THOMAS',
            '40-WEST LORNE', '41-WINDSOR', '42-WOODSTOCK', '43-NEWMARKET',
            '44-HAGAN II', '45-WESTON', '54-GP03 BOWMANVILLE PORTABLE',
            '152-WINDSOR PORTABLE',
          ].map(plant => (
            <TouchableOpacity
              key={plant}
              style={[styles.plantItem, {borderBottomColor: c.borderLight}]}
              activeOpacity={0.6}
              onPress={() => setPlantsVisible(false)}>
              <Text style={[styles.plantText, {color: c.textPrimary}]}>{plant}</Text>
            </TouchableOpacity>
          ))}
        </ScrollView>
      </ResponsiveModal>

      {/* ─── EDIT TICKET MODAL ─── */}
      <ResponsiveModal
        visible={editVisible}
        onClose={() => setEditVisible(false)}
        maxWidth={isTablet ? 500 : 420}
        widthPercent={isTablet ? 70 : 85}
        maxHeightPercent={80}>

        {/* Header */}
        <View style={[styles.etHeader, {borderBottomColor: c.border}]}>
          <View style={[styles.etHeaderIcon, {backgroundColor: c.primarySurface}]}>
            <MaterialIcons name="edit" size={ms(18)} color={c.primary} />
          </View>
          <Text style={[styles.etHeaderTitle, {color: c.textPrimary}]}>{t('modals.editTicket')}</Text>
          <TouchableOpacity style={[styles.mCloseBtn, {backgroundColor: c.surface}]} onPress={() => setEditVisible(false)} activeOpacity={0.7} hitSlop={{top: 8, bottom: 8, left: 8, right: 8}}>
            <MaterialIcons name="close" size={ms(20)} color={c.textSecondary} />
          </TouchableOpacity>
        </View>

        <ScrollView showsVerticalScrollIndicator={false} bounces={false}>
          {/* Actions Section */}
          <View style={styles.etSectionHdr}>
            <MaterialIcons name="touch-app" size={ms(16)} color={c.accent} />
            <Text style={[styles.etSectionTitle, {color: c.accent}]}>{t('modals.actions')}</Text>
          </View>

          {([
            {label: t('modals.signAccept'), icon: 'check-circle', screen: 'AcceptTicket', iconColor: c.success, bg: c.successSurface},
            {label: t('modals.disputeLoad'), icon: 'report-problem', screen: 'DisputeTicket', iconColor: c.error, bg: c.errorSurface},
            {label: t('modals.signCurbline'), icon: 'assignment-turned-in', screen: 'CurblineRelease', iconColor: c.warning, bg: c.warningSurface},
          ] as const).map((item, i) => (
            <TouchableOpacity
              key={item.label}
              style={[styles.etActionRow, i < 2 && {borderBottomWidth: 1, borderBottomColor: c.borderLight}]}
              activeOpacity={0.6}
              onPress={() => {
                setEditVisible(false);
                navigation.navigate(item.screen);
              }}>
              <View style={[styles.etActionIcon, {backgroundColor: item.bg}]}>
                <MaterialIcons name={item.icon as any} size={ms(18)} color={item.iconColor} />
              </View>
              <Text style={[styles.etActionLabel, {color: c.textPrimary}]}>{item.label}</Text>
              <MaterialIcons name="chevron-right" size={ms(18)} color={c.textMuted} />
            </TouchableOpacity>
          ))}

          <View style={{height: wp(16)}} />
        </ScrollView>
      </ResponsiveModal>

      {/* ─── PRODUCTS MODAL ─── */}
      <ResponsiveModal
        visible={productsVisible}
        onClose={() => setProductsVisible(false)}
        maxWidth={560}
        maxHeightPercent={75}>
        <View style={[styles.pmHeader, {backgroundColor: c.primarySurface, borderBottomColor: c.primaryBorder}]}>
          <View style={[styles.pmHeaderIcon, {backgroundColor: c.primary}]}>
            <MaterialIcons name="inventory-2" size={ms(16)} color={c.textOnPrimary} />
          </View>
          <View style={common.flex1}>
            <Text style={[styles.pmTitle, {color: c.textPrimary}]}>{t('productsModal.title')}</Text>
            <Text style={[styles.pmSubtitle, {color: c.textMuted}]}>30MPA MR - {t('productsModal.subtitle')}</Text>
          </View>
          <TouchableOpacity style={[styles.mCloseBtn, {backgroundColor: c.white}]} onPress={() => setProductsVisible(false)} activeOpacity={0.7} hitSlop={{top: 8, bottom: 8, left: 8, right: 8}}>
            <MaterialIcons name="close" size={ms(20)} color={c.textSecondary} />
          </TouchableOpacity>
        </View>
        <ScrollView showsVerticalScrollIndicator={false} bounces={false} contentContainerStyle={styles.pmBody}>
          {/* Table Header */}
          <View style={[styles.pmRow, styles.pmRowHeader, {borderBottomColor: c.textPrimary}]}>
            <Text style={[styles.pmColCode, styles.pmTh, {color: c.textPrimary}]}>{t('productsModal.code')}</Text>
            <Text style={[styles.pmColDesc, styles.pmTh, {color: c.textPrimary}]}>{t('productsModal.description')}</Text>
            <Text style={[styles.pmColQty, styles.pmTh, {color: c.textPrimary}]}>{t('productsModal.qty')}</Text>
            <Text style={[styles.pmColUnit, styles.pmTh, {color: c.textPrimary}]}>{t('productsModal.unit')}</Text>
          </View>
          {/* Table Rows */}
          {MIX_PRODUCTS.map((row, i) => (
            <View key={`${row.code}-${i}`} style={[styles.pmRow, {backgroundColor: i % 2 === 0 ? 'transparent' : c.surface, borderBottomColor: c.borderLight}]}>
              <Text style={[styles.pmColCode, styles.pmTd, {color: c.textMuted}]}>{row.code}</Text>
              <Text style={[styles.pmColDesc, styles.pmTd, {color: c.textPrimary}]}>{row.desc}</Text>
              <Text style={[styles.pmColQty, styles.pmTd, {color: c.textPrimary}]}>{row.qty}</Text>
              <Text style={[styles.pmColUnit, styles.pmTd, {color: c.textMuted}]}>{row.unit}</Text>
            </View>
          ))}
        </ScrollView>
      </ResponsiveModal>

    </View>
  );
}

const styles = StyleSheet.create({
  container: {flex: 1},

  // Header
  header: {paddingBottom: wp(6)},
  headerRow: {flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: wp(6)},
  headerLeft: {flexDirection: 'row', alignItems: 'center'},
  logo: {width: wp(34), height: wp(34), borderRadius: wp(11), justifyContent: 'center', alignItems: 'center'},
  logoTitle: {fontSize: ms(16), fontWeight: '800', letterSpacing: 0.3},
  logoSub: {fontSize: ms(10), fontWeight: '500', marginTop: 1},
  headerActions: {flexDirection: 'row', alignItems: 'center', gap: wp(6)},
  hdrBtn: {width: wp(34), height: wp(34), borderRadius: wp(11), justifyContent: 'center', alignItems: 'center'},

  // Tabs
  tabsRow: {flexDirection: 'row', gap: wp(6)},
  tab: {flexDirection: 'row', alignItems: 'center', gap: wp(5), paddingVertical: wp(4), paddingHorizontal: wp(12), borderRadius: wp(10), borderWidth: 1},
  tabDot: {width: wp(5), height: wp(5), borderRadius: wp(3)},
  tabText: {fontWeight: '700', fontSize: ms(12), letterSpacing: 0.2},

  // Scroll
  scroll: {flex: 1},
  scrollInner: {paddingHorizontal: wp(12), paddingTop: wp(8), paddingBottom: wp(20)},

  // KPI
  kpiRow: {flexDirection: 'row', alignItems: 'center'},
  kpiItem: {flex: 1, flexDirection: 'row', alignItems: 'center', gap: wp(8), paddingVertical: wp(4), paddingHorizontal: wp(6)},
  kpiIconWrap: {width: wp(28), height: wp(28), borderRadius: wp(8), justifyContent: 'center', alignItems: 'center'},
  kpiVal: {fontSize: ms(13), fontWeight: '800', letterSpacing: 0.1},
  kpiLabel: {fontSize: ms(9), fontWeight: '600', letterSpacing: 0.3, color: '#9E9E9E', marginTop: 1},
  kpiDivider: {width: StyleSheet.hairlineWidth, height: wp(28), marginHorizontal: wp(2)},

  // Chips
  chipRow: {flexDirection: 'row', flexWrap: 'wrap', gap: wp(6), alignItems: 'center'},
  statusChip: {flexDirection: 'row', alignItems: 'center', paddingHorizontal: wp(10), paddingVertical: wp(4), borderRadius: wp(16), gap: wp(5)},
  chipDot: {width: wp(6), height: wp(6), borderRadius: wp(3)},
  chipLabel: {fontWeight: '600', fontSize: ms(11)},
  infoChip: {flexDirection: 'row', alignItems: 'center', gap: wp(4), paddingHorizontal: wp(8), paddingVertical: wp(4), borderRadius: wp(16), borderWidth: 1},

  // Section header
  secHeader: {flexDirection: 'row', alignItems: 'center', marginBottom: wp(8), paddingBottom: wp(6), borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: '#E0E0E0', gap: wp(6)},
  secIcon: {width: wp(24), height: wp(24), borderRadius: wp(8), justifyContent: 'center', alignItems: 'center'},
  secTitle: {fontSize: ms(14), fontWeight: '700', letterSpacing: 0.1, flex: 1},
  countBadge: {paddingHorizontal: wp(8), paddingVertical: wp(2), borderRadius: wp(8), borderWidth: 1},
  countText: {fontSize: ms(11), fontWeight: '800'},

  // Detail cards
  twoCol: {gap: wp(8)},
  detailRow: {flexDirection: 'row', alignItems: 'flex-start', paddingVertical: wp(7), gap: wp(8)},
  detailLabel: {fontSize: ms(11), fontWeight: '600', letterSpacing: 0.1, width: '34%'},
  detailValue: {fontSize: ms(12), fontWeight: '700'},
  slumpPillInline: {paddingHorizontal: wp(8), paddingVertical: wp(2), borderRadius: wp(6), borderWidth: 1},


  // Dropdown
  dropdownOverlay: {position: 'absolute', top: 0, left: 0, right: 0, bottom: 0},
  dropdown: {position: 'absolute', minWidth: wp(220), maxWidth: wp(280), borderRadius: wp(16), borderWidth: StyleSheet.hairlineWidth, elevation: 8, shadowColor: Colors.shadowColor, shadowOffset: {width: 0, height: 4}, shadowOpacity: 0.12, shadowRadius: 16, overflow: 'hidden'},
  ddHeader: {flexDirection: 'row', alignItems: 'center', gap: wp(10), paddingHorizontal: wp(16), paddingVertical: wp(12), borderBottomWidth: StyleSheet.hairlineWidth},
  ddAvatar: {width: wp(32), height: wp(32), borderRadius: wp(10), justifyContent: 'center', alignItems: 'center'},
  ddName: {fontSize: ms(14), fontWeight: '700'},
  ddSub: {fontSize: ms(11), fontWeight: '500', marginTop: 1},
  ddItem: {flexDirection: 'row', alignItems: 'center', gap: wp(10), paddingHorizontal: wp(16), paddingVertical: wp(10), minHeight: wp(42)},
  ddIcon: {width: wp(30), height: wp(30), borderRadius: wp(9), justifyContent: 'center', alignItems: 'center'},
  ddLabel: {flex: 1, fontSize: ms(14), fontWeight: '600'},
  ddFooter: {alignItems: 'center', paddingVertical: wp(8), borderTopWidth: StyleSheet.hairlineWidth},
  ddVersion: {fontSize: ms(10), fontWeight: '500'},

  // QR Modal
  qrHeader: {flexDirection: 'row', alignItems: 'center', gap: wp(8), paddingHorizontal: wp(12), paddingVertical: wp(8), borderBottomWidth: 1},
  qrHeaderIcon: {width: wp(28), height: wp(28), borderRadius: wp(8), justifyContent: 'center', alignItems: 'center'},
  qrHeaderTitle: {fontSize: ms(13), fontWeight: '800', letterSpacing: 0.3},
  qrHeaderSub: {fontSize: ms(9), fontWeight: '500', marginTop: 1},
  qrChipRow: {flexDirection: 'row', gap: wp(6), paddingHorizontal: wp(12), alignSelf: 'stretch'},
  qrChip: {flex: 1, alignItems: 'center', paddingVertical: wp(6), borderRadius: wp(8)},
  qrChipLabel: {fontSize: ms(8), fontWeight: '700', letterSpacing: 0.8},
  qrChipValue: {fontSize: ms(15), fontWeight: '900', marginTop: 1},
  qrCodeSection: {alignItems: 'center', paddingVertical: wp(10), paddingHorizontal: wp(10)},
  qrCodeCard: {padding: wp(12), borderRadius: wp(12), alignItems: 'center', justifyContent: 'center', elevation: 4, shadowOffset: {width: 0, height: 2}, shadowOpacity: 0.08, shadowRadius: 8},
  qrFooter: {paddingHorizontal: wp(12), gap: wp(4), alignSelf: 'stretch'},
  qrFooterRow: {flexDirection: 'row', alignItems: 'center', gap: wp(5), justifyContent: 'center', paddingTop: wp(2)},
  qrFooterText: {fontSize: ms(10), fontWeight: '600'},

  // Plants Modal
  plantsList: {paddingHorizontal: wp(16)},
  plantItem: {paddingVertical: wp(12), borderBottomWidth: 0.5, alignItems: 'center', minHeight: wp(42)},
  plantText: {fontSize: ms(15), fontWeight: '600', textAlign: 'center'},
  etHeader: {flexDirection: 'row', alignItems: 'center', gap: wp(10), paddingHorizontal: wp(18), paddingVertical: wp(14), borderBottomWidth: 1},
  etHeaderIcon: {width: wp(36), height: wp(36), borderRadius: wp(12), justifyContent: 'center', alignItems: 'center'},
  etHeaderTitle: {flex: 1, fontSize: ms(17), fontWeight: '800', letterSpacing: 0.5},
  etSectionHdr: {flexDirection: 'row', alignItems: 'center', gap: wp(8), paddingHorizontal: wp(18), paddingTop: wp(16), paddingBottom: wp(8)},
  etSectionTitle: {fontSize: ms(12), fontWeight: '800', letterSpacing: 1},
  etActionRow: {flexDirection: 'row', alignItems: 'center', paddingVertical: wp(14), paddingHorizontal: wp(18), gap: wp(12), minHeight: wp(56)},
  etActionIcon: {width: wp(34), height: wp(34), borderRadius: wp(10), justifyContent: 'center', alignItems: 'center'},
  etActionLabel: {flex: 1, fontSize: ms(14), fontWeight: '700'},

  // Unified modal close button
  mCloseBtn: {width: wp(32), height: wp(32), borderRadius: wp(16), justifyContent: 'center', alignItems: 'center'},
  mCloseBtnAbsolute: {position: 'absolute', top: wp(8), right: wp(8), zIndex: 10},
  mHeader: {flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: wp(14), paddingVertical: wp(10), borderBottomWidth: 1},
  mHeaderTitle: {fontSize: ms(17), fontWeight: '900', letterSpacing: 0.5},

  // Products Modal
  pmHeader: {flexDirection: 'row', alignItems: 'center', gap: wp(8), paddingHorizontal: wp(14), paddingVertical: wp(10), borderBottomWidth: 1},
  pmHeaderIcon: {width: wp(30), height: wp(30), borderRadius: wp(9), justifyContent: 'center', alignItems: 'center'},
  pmTitle: {fontSize: ms(14), fontWeight: '800', letterSpacing: 0.3},
  pmSubtitle: {fontSize: ms(10), fontWeight: '500', marginTop: 1},
  pmBody: {paddingHorizontal: wp(14), paddingTop: wp(4), paddingBottom: wp(14)},
  pmRow: {flexDirection: 'row', alignItems: 'center', paddingVertical: wp(8), paddingHorizontal: wp(4), borderBottomWidth: 0.5, borderRadius: wp(4)},
  pmRowHeader: {borderBottomWidth: 1.5, paddingBottom: wp(6), marginBottom: wp(2)},
  pmColCode: {width: wp(60)},
  pmColDesc: {flex: 1, paddingRight: wp(8)},
  pmColQty: {width: wp(40), textAlign: 'right'},
  pmColUnit: {width: wp(35), textAlign: 'center'},
  pmTh: {fontSize: ms(11), fontWeight: '900', letterSpacing: 0.5},
  pmTd: {fontSize: ms(12), fontWeight: '500'},
});
