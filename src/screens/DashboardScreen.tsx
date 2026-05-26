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
} from 'react-native';
import {useSafeAreaInsets} from 'react-native-safe-area-context';
import MaterialIcons from 'react-native-vector-icons/MaterialIcons';
import type {NativeStackNavigationProp} from '@react-navigation/native-stack';
import {useTranslation} from 'react-i18next';
import QRCode from 'react-native-qrcode-svg';
import {useTheme} from '../contexts/ThemeContext';
import {Colors} from '../constants/colors';
import {common} from '../constants/commonStyles';
import DateTimePicker from '../components/DateTimePicker';
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
];

const MIX_INFO = [
  {labelKey: 'mixInfo.mixId', value: '6138438'},
  {labelKey: 'mixInfo.description', value: '30MPA MR', isLink: true},
  {labelKey: 'mixInfo.usage', value: 'SUSPENDED SLAB'},
  {labelKey: 'mixInfo.slump', value: '120+-30 mm', isHighlight: true},
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
  const [activeBottom, setActiveBottom] = useState(-1);
  const [editTimes, setEditTimes] = useState<{[key: string]: Date}>(() => {
    const now = new Date();
    const y = now.getFullYear(), m = now.getMonth(), d = now.getDate();
    const result: {[key: string]: Date} = {};
    TIMELINE.forEach(item => {
      if (item.time !== '--') {
        const [h, min] = item.time.split(':').map(Number);
        result[item.labelKey] = new Date(y, m, d, h, min);
      }
    });
    return result;
  });
  const [pickerVisible, setPickerVisible] = useState(false);
  const [pickerField, setPickerField] = useState<string | null>(null);
  const {t} = useTranslation();
  const {isDark, toggle, c} = useTheme();
  const insets = useSafeAreaInsets();
  const {width, height: winHeight} = useWindowDimensions();
  const isTablet = Math.min(width, winHeight) > 600;
  const menuScale = useRef(new Animated.Value(0)).current;
  const menuOpacity = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    const timer = setTimeout(() => setLoading(false), 1400);
    return () => clearTimeout(timer);
  }, []);

  const onRefresh = useCallback(() => {
    setRefreshing(true);
    setLoading(true);
    setTimeout(() => {
      setRefreshing(false);
      setLoading(false);
    }, 1000);
  }, []);

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

  const formatEditTime = (date: Date | undefined): string => {
    if (!date) return '--';
    const mons = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
    const h = date.getHours();
    const m = date.getMinutes();
    return `${mons[date.getMonth()]} ${date.getDate()}, ${h < 10 ? '0' : ''}${h}:${m < 10 ? '0' : ''}${m}`;
  };

  const cs = {
    card: {
      backgroundColor: c.white,
      borderRadius: wp(14),
      padding: wp(12),
      elevation: 3,
      shadowColor: Colors.shadowColor,
      shadowOffset: {width: 0, height: 2},
      shadowOpacity: isDark ? 0.2 : 0.08,
      shadowRadius: 8,
    },
  };

  // Skeleton state
  if (loading && !refreshing) {
    return (
      <View style={[styles.container, {backgroundColor: c.background}]}>
        <StatusBar translucent backgroundColor="transparent" barStyle="light-content" />
        <View style={[styles.header, {backgroundColor: c.primaryDark, paddingTop: insets.top + wp(3)}]}>
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
        <View style={{padding: wp(16), gap: wp(14)}}>
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

  return (
    <View style={[styles.container, {backgroundColor: c.background}]}>
      <StatusBar translucent backgroundColor="transparent" barStyle="light-content" />

      {/* ─── HEADER ─── */}
      <View style={[styles.header, {backgroundColor: c.primaryDark, paddingTop: insets.top + wp(3)}]}>
        <View style={styles.headerRow}>
          <View style={styles.headerLeft}>
            <View style={[styles.logo, {backgroundColor: c.primary}]}>
              <MaterialIcons name="local-shipping" size={ms(isTablet ? 24 : 20)} color={c.textOnPrimary} />
            </View>
            <View style={{marginLeft: wp(10)}}>
              <Text style={[styles.logoTitle, {color: c.textOnPrimary}, isTablet && {fontSize: ms(22)}]}>{t('app.name')}</Text>
              <Text style={[styles.logoSub, {color: c.textOnDark60}]}>{t('dashboard.ticketTracking')}</Text>
            </View>
          </View>
          <View style={styles.headerActions}>
            <TouchableOpacity style={[styles.hdrBtn, {backgroundColor: c.overlay10}]} onPress={toggle} activeOpacity={0.7}>
              <MaterialIcons name={isDark ? 'light-mode' : 'dark-mode'} size={ms(19)} color={c.textOnPrimary} />
            </TouchableOpacity>
            <TouchableOpacity style={[styles.hdrBtn, {backgroundColor: c.overlay10}]} onPress={openMenu} activeOpacity={0.7}>
              <MaterialIcons name="menu" size={ms(19)} color={c.textOnPrimary} />
            </TouchableOpacity>
          </View>
        </View>

        {/* Ticket Tabs */}
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.tabsRow}>
          {TICKETS.map((ticket, i) => {
            const active = activeTicket === i;
            return (
              <View
                key={ticket}
                style={[styles.tab, {borderColor: c.overlay15, backgroundColor: i === 0 ? c.accent : c.primaryLight}]}>
                {active && <View style={[styles.tabDot, {backgroundColor: c.textOnPrimary}]} />}
                <Text style={[styles.tabText, {color: active ? c.textOnPrimary : c.textOnDark70}]}>{ticket}</Text>
              </View>
            );
          })}
        </ScrollView>
      </View>

      {/* ─── CONTENT ─── */}
      <ScrollView
        style={styles.scroll}
        contentContainerStyle={[styles.scrollInner, isTablet && {padding: wp(20), gap: wp(6)}]}
        showsVerticalScrollIndicator={false}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={c.primary} colors={[c.primary]} />}>

        {/* KPI Cards */}
        <FadeCard delay={0} style={styles.kpiRow}>
          {[
            {icon: 'receipt-long', val: '26209538', label: t('dashboard.ticket'), color: c.primary},
            {icon: 'tag', val: '2605', label: t('dashboard.order'), color: c.primaryDark},
            {icon: 'local-shipping', val: '108693', label: 'TRUCK', color: c.primary},
          ].map((kpi, i) => (
            <View key={kpi.label} style={[styles.kpiCard, cs.card, i === 1 && {marginHorizontal: wp(8)}]}>
              <View style={[styles.kpiIconWrap, {backgroundColor: c.primarySurface}]}>
                <MaterialIcons name={kpi.icon as any} size={ms(20)} color={kpi.color} />
              </View>
              <Text style={[styles.kpiVal, {color: c.textPrimary}]}>{kpi.val}</Text>
              <Text style={[styles.kpiLabel, {color: c.textMuted}]}>{kpi.label}</Text>
            </View>
          ))}
        </FadeCard>

        {/* Status + Weather */}
        <FadeCard delay={60} style={styles.chipRow}>
          <View style={[styles.statusChip, {backgroundColor: c.successSurface}]}>
            <View style={[styles.chipDot, {backgroundColor: c.success}]} />
            <Text style={[styles.chipLabel, {color: c.successDark}]}>{t('dashboard.active')}</Text>
          </View>
          <View style={[styles.statusChip, {backgroundColor: c.warningSurface}]}>
            <MaterialIcons name="warning" size={ms(12)} color={c.warningDark} />
            <Text style={[styles.chipLabel, {color: c.warningDark}]}>{t('dashboard.onAccount')}</Text>
          </View>
          <View style={[styles.infoChip, {backgroundColor: c.white, borderColor: c.border}]}>
            <MaterialIcons name="wb-sunny" size={ms(13)} color={c.warning} />
            <Text style={[styles.chipLabel, {color: c.textSecondary}]}>10°C</Text>
          </View>
          <View style={[styles.infoChip, {backgroundColor: c.white, borderColor: c.border, flex: 1}]}>
            <MaterialIcons name="factory" size={ms(12)} color={c.textTertiary} />
            <Text style={[{fontSize: ms(11), fontWeight: '600', color: c.textTertiary}]} numberOfLines={1}>26-SCARBOROUGH R/M</Text>
          </View>
        </FadeCard>

        {/* Delivery Progress */}
        <FadeCard delay={120} style={cs.card}>
          <View style={[styles.secHeader, {borderBottomColor: c.borderLight}]}>
            <View style={[styles.secIcon, {backgroundColor: c.primary}]}>
              <MaterialIcons name="timeline" size={ms(15)} color={c.textOnPrimary} />
            </View>
            <Text style={[styles.secTitle, {color: c.textPrimary}]}>{t('dashboard.deliveryProgress')}</Text>
            <View style={[styles.countBadge, {backgroundColor: c.primarySurface, borderColor: c.primaryBorder}]}>
              <Text style={[styles.countText, {color: c.primary}]}>{doneCount}/{TIMELINE.length}</Text>
            </View>
          </View>
          {/* Bar */}
          <View style={[styles.bar, {backgroundColor: c.border}]}>
            <View style={[styles.barFill, {backgroundColor: c.primary, width: `${progressPct}%`}]} />
            {TIMELINE.map((item, i) => {
              const pct = (i / (TIMELINE.length - 1)) * 100;
              const isActive = item.done && (i === TIMELINE.length - 1 || !TIMELINE[i + 1].done);
              return (
                <View key={item.labelKey} style={[styles.dotPos, {left: `${pct}%`}]}>
                  <View style={[
                    styles.dot,
                    {borderColor: c.white, backgroundColor: item.done ? c.primary : c.border},
                    isActive && styles.dotActive,
                    isActive && {borderColor: c.primaryMuted, backgroundColor: c.primary},
                  ]}>
                    {item.done && <MaterialIcons name="check" size={ms(isActive ? 10 : 8)} color={c.textOnPrimary} />}
                  </View>
                </View>
              );
            })}
          </View>
          {/* Labels */}
          <View style={styles.barLabels}>
            {TIMELINE.map((item, i) => {
              const isActive = item.done && (i === TIMELINE.length - 1 || !TIMELINE[i + 1].done);
              return (
                <View key={item.labelKey} style={[
                  styles.barLabelItem,
                  {flex: i === 0 || i === TIMELINE.length - 1 ? 0 : 1},
                  i === 0 && {alignItems: 'flex-start' as const},
                  i === TIMELINE.length - 1 && {alignItems: 'flex-end' as const},
                ]}>
                  <Text style={[styles.barLabelName, {color: isActive ? c.primary : item.done ? c.textSecondary : c.textMuted}]} numberOfLines={1}>
                    {t(item.labelKey)}
                  </Text>
                  <Text style={[styles.barLabelTime, {color: isActive ? c.primaryDark : item.done ? c.primary : c.border}]}>
                    {item.time}
                  </Text>
                </View>
              );
            })}
          </View>
        </FadeCard>

        {/* Job + Mix Cards */}
        <View style={[styles.twoCol, isTablet && {flexDirection: 'row'}]}>
          {/* Job Details */}
          <FadeCard delay={200} style={[cs.card, isTablet && {flex: 1}]}>
            <View style={[styles.secHeader, {borderBottomColor: c.borderLight}]}>
              <View style={[styles.secIcon, {backgroundColor: c.accent}]}>
                <MaterialIcons name="work" size={ms(14)} color={c.textOnPrimary} />
              </View>
              <Text style={[styles.secTitle, {color: c.accent}]}>{t('dashboard.jobDetails')}</Text>
            </View>
            {JOB_INFO.map((item, i) => (
              <View key={item.labelKey} style={[styles.row, i < JOB_INFO.length - 1 && {borderBottomWidth: 1, borderBottomColor: c.borderLight}]}>
                <View style={[styles.rowIcon, {backgroundColor: c.surface}]}>
                  <MaterialIcons name={item.icon as any} size={ms(16)} color={c.textTertiary} />
                </View>
                <View style={common.flex1}>
                  <Text style={[styles.rowLabel, {color: c.textMuted}]}>{t(item.labelKey)}</Text>
                  <Text style={[styles.rowValue, {color: c.textPrimary}]} numberOfLines={2}>{item.value}</Text>
                </View>
              </View>
            ))}
          </FadeCard>

          {/* Mix Details */}
          <FadeCard delay={280} style={[cs.card, {backgroundColor: c.primarySurface, borderWidth: 1, borderColor: c.primaryBorder}, isTablet && {flex: 1}]}>
            <View style={[styles.secHeader, {borderBottomColor: c.primaryMuted}]}>
              <View style={[styles.secIcon, {backgroundColor: c.primary}]}>
                <MaterialIcons name="science" size={ms(14)} color={c.textOnPrimary} />
              </View>
              <Text style={[styles.secTitle, {color: c.primary}]}>{t('dashboard.mixDetails')}</Text>
            </View>
            {MIX_INFO.map((item, i) => (
              <View key={item.labelKey} style={[styles.row, i < MIX_INFO.length - 1 && {borderBottomWidth: 1, borderBottomColor: c.primaryMuted}]}>
                <View style={common.flex1}>
                  <Text style={[styles.rowLabel, {color: c.primary}]}>{t(item.labelKey)}</Text>
                  {item.isHighlight ? (
                    <View style={[styles.slumpPill, {backgroundColor: c.warningSurface, borderColor: c.warningBorder}]}>
                      <Text style={{fontSize: ms(14), fontWeight: '800', color: c.warningDark}}>{item.value}</Text>
                    </View>
                  ) : (
                    <Text style={[styles.rowValue, {color: c.textPrimary}, item.isLink && {color: c.accent, textDecorationLine: 'underline' as const}]}>
                      {item.value}
                    </Text>
                  )}
                </View>
              </View>
            ))}
          </FadeCard>
        </View>

        {/* Sync */}
        <FadeCard delay={360} style={[cs.card, {flexDirection: 'row', alignItems: 'center', paddingVertical: wp(7), paddingHorizontal: wp(12)}]}>
          <View style={[styles.syncPulse, {backgroundColor: c.success}]} />
          <Text style={[styles.syncText, {color: c.textTertiary}]}>{t('dashboard.lastSyncedAt', {time: '18:44'})}</Text>
          <TouchableOpacity style={[styles.syncBtn, {backgroundColor: c.primarySurface, borderColor: c.primaryBorder}]} activeOpacity={0.7}>
            <MaterialIcons name="sync" size={ms(12)} color={c.primary} />
            <Text style={{fontSize: ms(11), fontWeight: '700', color: c.primary}}>{t('dashboard.syncNow')}</Text>
          </TouchableOpacity>
        </FadeCard>

        <View style={{height: wp(14)}} />
      </ScrollView>

      {/* ─── BOTTOM BAR ─── */}
      <View style={[styles.bottomBar, {backgroundColor: c.white, borderTopColor: c.border, paddingBottom: insets.bottom || wp(6)}]}>
        {BOTTOM_ACTIONS.map((item, i) => {
          const isActive = activeBottom === i;
          return (
            <TouchableOpacity
              key={item.labelKey}
              style={styles.bottomItem}
              activeOpacity={0.7}
              onPress={() => {
                setActiveBottom(i);
                if (item.icon === 'label') {navigation.navigate('MobileTicket');}
                if (item.icon === 'note-alt') {navigation.navigate('Notes');}
                if (item.icon === 'edit') {setEditVisible(true);}
                if (item.icon === 'qr-code-scanner') {setQrVisible(true);}
                if (item.icon === 'local-shipping') {setPlantsVisible(true);}
              }}>
              {isActive && <View style={[styles.bottomActiveBar, {backgroundColor: c.primary}]} />}
              <View style={[
                styles.bottomIconBg,
                {backgroundColor: isActive ? c.primarySurface : 'transparent'},
                isActive && {elevation: 2, shadowColor: c.primary, shadowOffset: {width: 0, height: 1}, shadowOpacity: 0.2, shadowRadius: 3},
              ]}>
                <MaterialIcons name={item.icon as any} size={ms(isTablet ? 26 : 24)} color={isActive ? c.primary : c.textMuted} />
              </View>
            </TouchableOpacity>
          );
        })}
      </View>

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
                right: wp(16),
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
                    i < MENU_ITEMS.length - 1 && {borderBottomWidth: 1, borderBottomColor: c.borderLight},
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
        maxWidth={isTablet ? 480 : 320}
        widthPercent={isTablet ? 80 : 78}
        maxHeightPercent={isTablet ? 95 : 70}>
        <View style={{backgroundColor: c.qrBg}}>
          <TouchableOpacity style={[styles.mCloseBtn, styles.mCloseBtnAbsolute, {backgroundColor: c.surface}]} onPress={() => setQrVisible(false)} activeOpacity={0.7} hitSlop={{top: 8, bottom: 8, left: 8, right: 8}}>
            <MaterialIcons name="close" size={ms(20)} color={c.textSecondary} />
          </TouchableOpacity>
          <ScrollView bounces={false} showsVerticalScrollIndicator={false} contentContainerStyle={styles.qrScrollContent}>
            <Text style={[styles.qrTitle, {color: c.qrFg, marginTop: isTablet ? wp(20) : wp(14)}]}>
              ORDER: <Text style={styles.qrBold}>2605</Text>, TICKET: <Text style={styles.qrBold}>26209538</Text>
            </Text>
            <View style={styles.qrCodeWrap}>
              <QRCode
                value="ORDER:2605|TICKET:26209538|TRUCK:108693|DRIVER:109003|PLANT:26-SCARBOROUGH"
                size={Math.min(width * 0.65, isTablet ? 320 : 200)}
                backgroundColor={c.qrBg}
                color={c.qrFg}
              />
            </View>
            <View style={{height: isTablet ? wp(20) : wp(24)}} />
          </ScrollView>
        </View>
      </ResponsiveModal>

      {/* ─── PLANTS LIST MODAL ─── */}
      <ResponsiveModal
        visible={plantsVisible}
        onClose={() => setPlantsVisible(false)}
        maxWidth={540}
        maxHeightPercent={85}>
        <View style={[styles.mHeader, {borderBottomColor: c.border}]}>
          <Text style={[styles.mHeaderTitle, {color: c.textPrimary}]}>PLANTS</Text>
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
        maxWidth={500}
        maxHeightPercent={85}>

        {/* Header */}
        <View style={[styles.etHeader, {borderBottomColor: c.border}]}>
          <View style={[styles.etHeaderIcon, {backgroundColor: c.primarySurface}]}>
            <MaterialIcons name="edit" size={ms(18)} color={c.primary} />
          </View>
          <Text style={[styles.etHeaderTitle, {color: c.textPrimary}]}>EDIT TICKET</Text>
          <TouchableOpacity style={[styles.mCloseBtn, {backgroundColor: c.surface}]} onPress={() => setEditVisible(false)} activeOpacity={0.7} hitSlop={{top: 8, bottom: 8, left: 8, right: 8}}>
            <MaterialIcons name="close" size={ms(20)} color={c.textSecondary} />
          </TouchableOpacity>
        </View>

        <ScrollView showsVerticalScrollIndicator={false} bounces={false}>
          {/* Time Section */}
          <View style={styles.etSectionHdr}>
            <MaterialIcons name="schedule" size={ms(16)} color={c.primary} />
            <Text style={[styles.etSectionTitle, {color: c.primary}]}>TIME</Text>
          </View>

          {TIMELINE.map((item, i) => {
            const time = editTimes[item.labelKey];
            return (
              <TouchableOpacity
                key={item.labelKey}
                style={[
                  styles.etTimeRow,
                  i < TIMELINE.length - 1 && {borderBottomWidth: 1, borderBottomColor: c.borderLight},
                ]}
                activeOpacity={0.6}
                onPress={() => {
                  setPickerField(item.labelKey);
                  setPickerVisible(true);
                }}>
                <View style={[styles.etTimeIcon, {backgroundColor: item.done ? c.primarySurface : c.surface}]}>
                  <MaterialIcons name={item.icon as any} size={ms(16)} color={item.done ? c.primary : c.textMuted} />
                </View>
                <Text style={[styles.etTimeLabel, {color: c.textPrimary}]}>{t(item.labelKey)}</Text>
                <Text style={[styles.etTimeValue, {color: time ? c.accent : c.textMuted}]}>
                  {formatEditTime(time)}
                </Text>
                <MaterialIcons name="chevron-right" size={ms(18)} color={c.textMuted} />
              </TouchableOpacity>
            );
          })}

          {/* Divider */}
          <View style={[styles.etDivider, {backgroundColor: c.border}]} />

          {/* Actions Section */}
          <View style={styles.etSectionHdr}>
            <MaterialIcons name="touch-app" size={ms(16)} color={c.accent} />
            <Text style={[styles.etSectionTitle, {color: c.accent}]}>ACTIONS</Text>
          </View>

          {([
            {label: 'SIGN & ACCEPT TICKET', icon: 'check-circle', screen: 'AcceptTicket', iconColor: c.success, bg: c.successSurface},
            {label: 'DISPUTE LOAD', icon: 'report-problem', screen: 'DisputeTicket', iconColor: c.error, bg: c.errorSurface},
            {label: 'SIGN CURBLINE RELEASE', icon: 'assignment-turned-in', screen: 'CurblineRelease', iconColor: c.warning, bg: c.warningSurface},
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

      {/* ─── DATE TIME PICKER ─── */}
      <DateTimePicker
        visible={pickerVisible}
        value={pickerField && editTimes[pickerField] ? editTimes[pickerField] : new Date()}
        onConfirm={(date) => {
          if (pickerField) {
            setEditTimes(prev => ({...prev, [pickerField]: date}));
          }
          setPickerVisible(false);
        }}
        onCancel={() => setPickerVisible(false)}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {flex: 1},

  // Header
  header: {paddingHorizontal: wp(12), paddingBottom: wp(5)},
  headerRow: {flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: wp(5)},
  headerLeft: {flexDirection: 'row', alignItems: 'center'},
  logo: {width: wp(32), height: wp(32), borderRadius: wp(10), justifyContent: 'center', alignItems: 'center'},
  logoTitle: {fontSize: ms(16), fontWeight: '800', letterSpacing: 0.5},
  logoSub: {fontSize: ms(10), fontWeight: '500', marginTop: 1},
  headerActions: {flexDirection: 'row', alignItems: 'center', gap: wp(6)},
  hdrBtn: {width: wp(32), height: wp(32), borderRadius: wp(10), justifyContent: 'center', alignItems: 'center'},

  // Tabs
  tabsRow: {flexDirection: 'row', gap: wp(6)},
  tab: {flexDirection: 'row', alignItems: 'center', gap: wp(5), paddingVertical: wp(4), paddingHorizontal: wp(12), borderRadius: wp(10), borderWidth: 1},
  tabDot: {width: wp(5), height: wp(5), borderRadius: wp(3)},
  tabText: {fontWeight: '700', fontSize: ms(12), letterSpacing: 0.2},

  // Scroll
  scroll: {flex: 1},
  scrollInner: {padding: wp(16), gap: wp(5)},

  // KPI
  kpiRow: {flexDirection: 'row'},
  kpiCard: {flex: 1, alignItems: 'center', paddingVertical: wp(8), paddingHorizontal: wp(8)},
  kpiIconWrap: {width: wp(32), height: wp(32), borderRadius: wp(10), justifyContent: 'center', alignItems: 'center', marginBottom: wp(5)},
  kpiVal: {fontSize: ms(15), fontWeight: '800', letterSpacing: 0.2},
  kpiLabel: {fontSize: ms(10), fontWeight: '600', letterSpacing: 0.4, marginTop: 2},

  // Chips
  chipRow: {flexDirection: 'row', flexWrap: 'wrap', gap: wp(8), alignItems: 'center'},
  statusChip: {flexDirection: 'row', alignItems: 'center', paddingHorizontal: wp(12), paddingVertical: wp(6), borderRadius: wp(20), gap: wp(6)},
  chipDot: {width: wp(7), height: wp(7), borderRadius: wp(4)},
  chipLabel: {fontWeight: '700', fontSize: ms(12)},
  infoChip: {flexDirection: 'row', alignItems: 'center', gap: wp(5), paddingHorizontal: wp(10), paddingVertical: wp(6), borderRadius: wp(20), borderWidth: 1},

  // Section header
  secHeader: {flexDirection: 'row', alignItems: 'center', marginBottom: wp(6), paddingBottom: wp(6), borderBottomWidth: 1, gap: wp(6)},
  secIcon: {width: wp(24), height: wp(24), borderRadius: wp(8), justifyContent: 'center', alignItems: 'center'},
  secTitle: {fontSize: ms(13), fontWeight: '700', letterSpacing: 0.2, flex: 1},
  countBadge: {paddingHorizontal: wp(8), paddingVertical: wp(2), borderRadius: wp(8), borderWidth: 1},
  countText: {fontSize: ms(11), fontWeight: '800'},

  // Progress bar
  bar: {height: wp(4), borderRadius: wp(2), position: 'relative', marginHorizontal: wp(6)},
  barFill: {position: 'absolute', left: 0, top: 0, bottom: 0, borderRadius: wp(3)},
  dotPos: {position: 'absolute', top: wp(-5), marginLeft: wp(-7), width: wp(14), height: wp(14), justifyContent: 'center', alignItems: 'center'},
  dot: {width: wp(12), height: wp(12), borderRadius: wp(6), justifyContent: 'center', alignItems: 'center', borderWidth: 2},
  dotActive: {width: wp(16), height: wp(16), borderRadius: wp(8), borderWidth: 2, elevation: 4, shadowColor: Colors.primary, shadowOffset: {width: 0, height: 2}, shadowOpacity: 0.35, shadowRadius: 5},
  barLabels: {flexDirection: 'row', justifyContent: 'space-between', marginTop: wp(6)},
  barLabelItem: {alignItems: 'center'},
  barLabelName: {fontSize: ms(9), fontWeight: '700', letterSpacing: 0.3, textAlign: 'center'},
  barLabelTime: {fontSize: ms(11), fontWeight: '800', marginTop: 2},

  // Detail cards
  twoCol: {gap: wp(10)},
  row: {flexDirection: 'row', alignItems: 'flex-start', paddingVertical: wp(7)},
  rowIcon: {width: wp(26), height: wp(26), borderRadius: wp(7), justifyContent: 'center', alignItems: 'center', marginRight: wp(10), marginTop: 1},
  rowLabel: {fontSize: ms(10), fontWeight: '700', letterSpacing: 0.5, marginBottom: wp(2)},
  rowValue: {fontSize: ms(13), fontWeight: '600', lineHeight: ms(18)},
  slumpPill: {alignSelf: 'flex-start', paddingHorizontal: wp(10), paddingVertical: wp(3), borderRadius: wp(8), borderWidth: 1, marginTop: 2},

  // Sync
  syncPulse: {width: wp(6), height: wp(6), borderRadius: wp(3), marginRight: wp(8)},
  syncText: {flex: 1, fontSize: ms(12), fontWeight: '600'},
  syncBtn: {flexDirection: 'row', alignItems: 'center', gap: wp(4), paddingHorizontal: wp(10), paddingVertical: wp(5), borderRadius: wp(8), borderWidth: 1},

  // Bottom bar
  bottomBar: {flexDirection: 'row', paddingTop: wp(3), justifyContent: 'space-around', alignItems: 'center', elevation: 12, shadowColor: Colors.shadowColor, shadowOffset: {width: 0, height: -6}, shadowOpacity: 0.1, shadowRadius: 12},
  bottomItem: {alignItems: 'center', justifyContent: 'center', paddingVertical: wp(4), paddingHorizontal: wp(16), position: 'relative'},
  bottomActiveBar: {position: 'absolute', top: wp(-4), width: wp(32), height: wp(3), borderRadius: wp(2)},
  bottomIconBg: {width: wp(44), height: wp(34), justifyContent: 'center', alignItems: 'center', borderRadius: wp(12)},

  // Dropdown
  dropdownOverlay: {position: 'absolute', top: 0, left: 0, right: 0, bottom: 0},
  dropdown: {position: 'absolute', minWidth: wp(220), maxWidth: wp(280), borderRadius: wp(16), borderWidth: 1, elevation: 12, shadowColor: Colors.shadowColor, shadowOffset: {width: 0, height: 8}, shadowOpacity: 0.15, shadowRadius: 20, overflow: 'hidden'},
  ddHeader: {flexDirection: 'row', alignItems: 'center', gap: wp(8), paddingHorizontal: wp(14), paddingVertical: wp(10), borderBottomWidth: 1},
  ddAvatar: {width: wp(30), height: wp(30), borderRadius: wp(10), justifyContent: 'center', alignItems: 'center'},
  ddName: {fontSize: ms(14), fontWeight: '700'},
  ddSub: {fontSize: ms(11), fontWeight: '500', marginTop: 1},
  ddItem: {flexDirection: 'row', alignItems: 'center', gap: wp(10), paddingHorizontal: wp(14), paddingVertical: wp(9), minHeight: wp(40)},
  ddIcon: {width: wp(28), height: wp(28), borderRadius: wp(8), justifyContent: 'center', alignItems: 'center'},
  ddLabel: {flex: 1, fontSize: ms(14), fontWeight: '600'},
  ddFooter: {alignItems: 'center', paddingVertical: wp(7), borderTopWidth: 1},
  ddVersion: {fontSize: ms(11), fontWeight: '500'},

  // QR Modal
  qrScrollContent: {alignItems: 'center', paddingTop: wp(16)},
  qrTitle: {fontSize: ms(18), fontWeight: '400', textAlign: 'center', marginBottom: wp(16), paddingHorizontal: wp(20)},
  qrBold: {fontWeight: '900'},
  qrCodeWrap: {alignItems: 'center', justifyContent: 'center'},

  // Plants Modal
  plantsList: {paddingHorizontal: wp(20)},
  plantItem: {paddingVertical: wp(16), borderBottomWidth: 0.5, alignItems: 'center', minHeight: wp(52)},
  plantText: {fontSize: ms(17), fontWeight: '600', textAlign: 'center'},
  etHeader: {flexDirection: 'row', alignItems: 'center', gap: wp(10), paddingHorizontal: wp(18), paddingVertical: wp(14), borderBottomWidth: 1},
  etHeaderIcon: {width: wp(36), height: wp(36), borderRadius: wp(12), justifyContent: 'center', alignItems: 'center'},
  etHeaderTitle: {flex: 1, fontSize: ms(17), fontWeight: '800', letterSpacing: 0.5},
  etSectionHdr: {flexDirection: 'row', alignItems: 'center', gap: wp(8), paddingHorizontal: wp(18), paddingTop: wp(16), paddingBottom: wp(8)},
  etSectionTitle: {fontSize: ms(12), fontWeight: '800', letterSpacing: 1},
  etTimeRow: {flexDirection: 'row', alignItems: 'center', paddingVertical: wp(14), paddingHorizontal: wp(18), gap: wp(12), minHeight: wp(52)},
  etTimeIcon: {width: wp(34), height: wp(34), borderRadius: wp(10), justifyContent: 'center', alignItems: 'center'},
  etTimeLabel: {flex: 1, fontSize: ms(13), fontWeight: '700'},
  etTimeValue: {fontSize: ms(13), fontWeight: '600'},
  etDivider: {height: 1, marginHorizontal: wp(18), marginVertical: wp(8)},
  etActionRow: {flexDirection: 'row', alignItems: 'center', paddingVertical: wp(14), paddingHorizontal: wp(18), gap: wp(12), minHeight: wp(56)},
  etActionIcon: {width: wp(34), height: wp(34), borderRadius: wp(10), justifyContent: 'center', alignItems: 'center'},
  etActionLabel: {flex: 1, fontSize: ms(14), fontWeight: '700'},

  // Unified modal close button
  mCloseBtn: {width: wp(32), height: wp(32), borderRadius: wp(16), justifyContent: 'center', alignItems: 'center'},
  mCloseBtnAbsolute: {position: 'absolute', top: wp(8), right: wp(8), zIndex: 10},
  mHeader: {flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: wp(14), paddingVertical: wp(10), borderBottomWidth: 1},
  mHeaderTitle: {fontSize: ms(17), fontWeight: '900', letterSpacing: 0.5},
});
