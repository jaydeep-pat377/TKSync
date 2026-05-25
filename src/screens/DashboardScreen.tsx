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
  Modal,
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
  const {width} = useWindowDimensions();
  const isTablet = width > 600;
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
      borderRadius: 18,
      padding: 18,
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
        <View style={[styles.header, {backgroundColor: c.primaryDark, paddingTop: insets.top + 12}]}>
          <View style={styles.headerRow}>
            <View style={styles.headerLeft}>
              <Skeleton width={40} height={40} radius={14} />
              <View style={{gap: 6, marginLeft: 10}}>
                <Skeleton width={72} height={16} radius={6} />
                <Skeleton width={100} height={11} radius={5} />
              </View>
            </View>
            <View style={common.rowGap8}>
              <Skeleton width={36} height={36} radius={10} />
              <Skeleton width={36} height={36} radius={10} />
              <Skeleton width={36} height={36} radius={10} />
            </View>
          </View>
          <View style={{flexDirection: 'row', gap: 8, marginTop: 4}}>
            <Skeleton width={105} height={36} radius={12} />
            <Skeleton width={105} height={36} radius={12} />
            <Skeleton width={105} height={36} radius={12} />
          </View>
        </View>
        <View style={{padding: 16, gap: 14}}>
          <Skeleton width="100%" height={86} radius={18} />
          <View style={common.rowGap8}>
            <Skeleton width={85} height={30} radius={15} />
            <Skeleton width={115} height={30} radius={15} />
            <Skeleton width={55} height={30} radius={15} />
          </View>
          <Skeleton width="100%" height={130} radius={18} />
          <Skeleton width="100%" height={170} radius={18} />
          <Skeleton width="100%" height={170} radius={18} />
          <Skeleton width="100%" height={46} radius={12} />
        </View>
      </View>
    );
  }

  return (
    <View style={[styles.container, {backgroundColor: c.background}]}>
      <StatusBar translucent backgroundColor="transparent" barStyle="light-content" />

      {/* ─── HEADER ─── */}
      <View style={[styles.header, {backgroundColor: c.primaryDark, paddingTop: insets.top + 12}]}>
        <View style={styles.headerRow}>
          <View style={styles.headerLeft}>
            <View style={[styles.logo, {backgroundColor: c.primary}]}>
              <MaterialIcons name="local-shipping" size={isTablet ? 24 : 20} color={c.textOnPrimary} />
            </View>
            <View style={{marginLeft: 10}}>
              <Text style={[styles.logoTitle, {color: c.textOnPrimary}, isTablet && {fontSize: 22}]}>{t('app.name')}</Text>
              <Text style={[styles.logoSub, {color: c.textOnDark60}]}>{t('dashboard.ticketTracking')}</Text>
            </View>
          </View>
          <View style={styles.headerActions}>
            <TouchableOpacity style={[styles.hdrBtn, {backgroundColor: c.overlay10}]} onPress={toggle} activeOpacity={0.7}>
              <MaterialIcons name={isDark ? 'light-mode' : 'dark-mode'} size={19} color={c.textOnPrimary} />
            </TouchableOpacity>
            <TouchableOpacity style={[styles.hdrBtn, {backgroundColor: c.overlay10}]} onPress={openMenu} activeOpacity={0.7}>
              <MaterialIcons name="menu" size={19} color={c.textOnPrimary} />
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
        contentContainerStyle={[styles.scrollInner, isTablet && {padding: 24, gap: 16}]}
        showsVerticalScrollIndicator={false}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={c.primary} colors={[c.primary]} />}>

        {/* KPI Cards */}
        <FadeCard delay={0} style={styles.kpiRow}>
          {[
            {icon: 'receipt-long', val: '26209538', label: t('dashboard.ticket'), color: c.primary},
            {icon: 'tag', val: '2605', label: t('dashboard.order'), color: c.primaryDark},
            {icon: 'local-shipping', val: '108693', label: 'TRUCK', color: c.primary},
          ].map((kpi, i) => (
            <View key={kpi.label} style={[styles.kpiCard, cs.card, i === 1 && {marginHorizontal: 8}]}>
              <View style={[styles.kpiIconWrap, {backgroundColor: c.primarySurface}]}>
                <MaterialIcons name={kpi.icon as any} size={20} color={kpi.color} />
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
            <MaterialIcons name="warning" size={12} color={c.warningDark} />
            <Text style={[styles.chipLabel, {color: c.warningDark}]}>{t('dashboard.onAccount')}</Text>
          </View>
          <View style={[styles.infoChip, {backgroundColor: c.white, borderColor: c.border}]}>
            <MaterialIcons name="wb-sunny" size={13} color={c.warning} />
            <Text style={[styles.chipLabel, {color: c.textSecondary}]}>10°C</Text>
          </View>
          <View style={[styles.infoChip, {backgroundColor: c.white, borderColor: c.border, flex: 1}]}>
            <MaterialIcons name="factory" size={12} color={c.textTertiary} />
            <Text style={[{fontSize: 11, fontWeight: '600', color: c.textTertiary}]} numberOfLines={1}>26-SCARBOROUGH R/M</Text>
          </View>
        </FadeCard>

        {/* Delivery Progress */}
        <FadeCard delay={120} style={cs.card}>
          <View style={[styles.secHeader, {borderBottomColor: c.borderLight}]}>
            <View style={[styles.secIcon, {backgroundColor: c.primary}]}>
              <MaterialIcons name="timeline" size={15} color={c.textOnPrimary} />
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
                    {item.done && <MaterialIcons name="check" size={isActive ? 10 : 8} color={c.textOnPrimary} />}
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
                <MaterialIcons name="work" size={14} color={c.textOnPrimary} />
              </View>
              <Text style={[styles.secTitle, {color: c.accent}]}>{t('dashboard.jobDetails')}</Text>
            </View>
            {JOB_INFO.map((item, i) => (
              <View key={item.labelKey} style={[styles.row, i < JOB_INFO.length - 1 && {borderBottomWidth: 1, borderBottomColor: c.borderLight}]}>
                <View style={[styles.rowIcon, {backgroundColor: c.surface}]}>
                  <MaterialIcons name={item.icon as any} size={16} color={c.textTertiary} />
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
                <MaterialIcons name="science" size={14} color={c.textOnPrimary} />
              </View>
              <Text style={[styles.secTitle, {color: c.primary}]}>{t('dashboard.mixDetails')}</Text>
            </View>
            {MIX_INFO.map((item, i) => (
              <View key={item.labelKey} style={[styles.row, i < MIX_INFO.length - 1 && {borderBottomWidth: 1, borderBottomColor: c.primaryMuted}]}>
                <View style={common.flex1}>
                  <Text style={[styles.rowLabel, {color: c.primary}]}>{t(item.labelKey)}</Text>
                  {item.isHighlight ? (
                    <View style={[styles.slumpPill, {backgroundColor: c.warningSurface, borderColor: c.warningBorder}]}>
                      <Text style={{fontSize: 14, fontWeight: '800', color: c.warningDark}}>{item.value}</Text>
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
        <FadeCard delay={360} style={[cs.card, {flexDirection: 'row', alignItems: 'center', paddingVertical: 12, paddingHorizontal: 16}]}>
          <View style={[styles.syncPulse, {backgroundColor: c.success}]} />
          <Text style={[styles.syncText, {color: c.textTertiary}]}>{t('dashboard.lastSyncedAt', {time: '18:44'})}</Text>
          <TouchableOpacity style={[styles.syncBtn, {backgroundColor: c.primarySurface, borderColor: c.primaryBorder}]} activeOpacity={0.7}>
            <MaterialIcons name="sync" size={14} color={c.primary} />
            <Text style={{fontSize: 12, fontWeight: '700', color: c.primary}}>{t('dashboard.syncNow')}</Text>
          </TouchableOpacity>
        </FadeCard>

        <View style={{height: 14}} />
      </ScrollView>

      {/* ─── BOTTOM BAR ─── */}
      <View style={[styles.bottomBar, {backgroundColor: c.white, borderTopColor: c.border, paddingBottom: insets.bottom || 10}]}>
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
                <MaterialIcons name={item.icon as any} size={isTablet ? 26 : 24} color={isActive ? c.primary : c.textMuted} />
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
                top: insets.top + 58,
                right: 16,
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
                <MaterialIcons name="person" size={18} color={c.primary} />
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
                    <MaterialIcons name={item.icon as any} size={18} color={iconColor} />
                  </View>
                  <Text style={[styles.ddLabel, {color: labelColor}]}>{item.label}</Text>
                  <MaterialIcons name="chevron-right" size={18} color={c.textMuted} />
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
      <Modal visible={qrVisible} transparent animationType="fade" onRequestClose={() => setQrVisible(false)}>
        <Pressable style={[styles.modalOverlay, {backgroundColor: c.overlayModal}]} onPress={() => setQrVisible(false)}>
          <View style={[styles.qrModal, {backgroundColor: c.qrBg, shadowColor: c.shadowColor}]} onStartShouldSetResponder={() => true}>
            <TouchableOpacity style={[styles.mCloseBtn, styles.mCloseBtnAbsolute, {backgroundColor: c.surface}]} onPress={() => setQrVisible(false)} activeOpacity={0.7}>
              <MaterialIcons name="close" size={20} color={c.textSecondary} />
            </TouchableOpacity>
            <Text style={[styles.qrTitle, {color: c.qrFg, marginTop: 28}]}>
              ORDER: <Text style={styles.qrBold}>2605</Text>, TICKET: <Text style={styles.qrBold}>26209538</Text>
            </Text>
            <View style={styles.qrCodeWrap}>
              <QRCode
                value="ORDER:2605|TICKET:26209538|TRUCK:108693|DRIVER:109003|PLANT:26-SCARBOROUGH"
                size={Math.min(width * 0.8, 450)}
                backgroundColor={c.qrBg}
                color={c.qrFg}
              />
            </View>
          </View>
        </Pressable>
      </Modal>

      {/* ─── PLANTS LIST MODAL ─── */}
      <Modal visible={plantsVisible} transparent animationType="fade" onRequestClose={() => setPlantsVisible(false)}>
        <Pressable style={[styles.modalOverlay, {backgroundColor: c.overlayModal}]} onPress={() => setPlantsVisible(false)}>
          <View style={[styles.plantsModal, {backgroundColor: c.white, shadowColor: c.shadowColor}]} onStartShouldSetResponder={() => true}>
            <View style={[styles.mHeader, {borderBottomColor: c.border}]}>
              <Text style={[styles.mHeaderTitle, {color: c.textPrimary}]}>PLANTS</Text>
              <TouchableOpacity style={[styles.mCloseBtn, {backgroundColor: c.surface}]} onPress={() => setPlantsVisible(false)} activeOpacity={0.7}>
                <MaterialIcons name="close" size={20} color={c.textSecondary} />
              </TouchableOpacity>
            </View>
            <ScrollView style={styles.plantsList} showsVerticalScrollIndicator={true}>
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
          </View>
        </Pressable>
      </Modal>

      {/* ─── EDIT TICKET MODAL ─── */}
      <Modal visible={editVisible} transparent animationType="fade" onRequestClose={() => setEditVisible(false)}>
        <Pressable style={[styles.modalOverlay, {backgroundColor: c.overlayModal}]} onPress={() => setEditVisible(false)}>
          <View style={[styles.editModal, {backgroundColor: c.white, shadowColor: c.shadowColor}]} onStartShouldSetResponder={() => true}>

            {/* Header */}
            <View style={[styles.etHeader, {borderBottomColor: c.border}]}>
              <View style={[styles.etHeaderIcon, {backgroundColor: c.primarySurface}]}>
                <MaterialIcons name="edit" size={18} color={c.primary} />
              </View>
              <Text style={[styles.etHeaderTitle, {color: c.textPrimary}]}>EDIT TICKET</Text>
              <TouchableOpacity style={[styles.mCloseBtn, {backgroundColor: c.surface}]} onPress={() => setEditVisible(false)} activeOpacity={0.7}>
                <MaterialIcons name="close" size={20} color={c.textSecondary} />
              </TouchableOpacity>
            </View>

            <ScrollView showsVerticalScrollIndicator={false} bounces={false}>
              {/* Time Section */}
              <View style={styles.etSectionHdr}>
                <MaterialIcons name="schedule" size={16} color={c.primary} />
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
                      <MaterialIcons name={item.icon as any} size={16} color={item.done ? c.primary : c.textMuted} />
                    </View>
                    <Text style={[styles.etTimeLabel, {color: c.textPrimary}]}>{t(item.labelKey)}</Text>
                    <Text style={[styles.etTimeValue, {color: time ? c.accent : c.textMuted}]}>
                      {formatEditTime(time)}
                    </Text>
                    <MaterialIcons name="chevron-right" size={18} color={c.textMuted} />
                  </TouchableOpacity>
                );
              })}

              {/* Divider */}
              <View style={[styles.etDivider, {backgroundColor: c.border}]} />

              {/* Actions Section */}
              <View style={styles.etSectionHdr}>
                <MaterialIcons name="touch-app" size={16} color={c.accent} />
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
                    <MaterialIcons name={item.icon as any} size={18} color={item.iconColor} />
                  </View>
                  <Text style={[styles.etActionLabel, {color: c.textPrimary}]}>{item.label}</Text>
                  <MaterialIcons name="chevron-right" size={18} color={c.textMuted} />
                </TouchableOpacity>
              ))}

              <View style={{height: 16}} />
            </ScrollView>
          </View>
        </Pressable>
      </Modal>

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
  header: {paddingHorizontal: 16, paddingBottom: 16},
  headerRow: {flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 14},
  headerLeft: {flexDirection: 'row', alignItems: 'center'},
  logo: {width: 40, height: 40, borderRadius: 14, justifyContent: 'center', alignItems: 'center'},
  logoTitle: {fontSize: 19, fontWeight: '800', letterSpacing: 0.5},
  logoSub: {fontSize: 12, fontWeight: '500', marginTop: 1},
  headerActions: {flexDirection: 'row', alignItems: 'center', gap: 8},
  hdrBtn: {width: 38, height: 38, borderRadius: 12, justifyContent: 'center', alignItems: 'center'},

  // Tabs
  tabsRow: {flexDirection: 'row', gap: 8},
  tab: {flexDirection: 'row', alignItems: 'center', gap: 6, paddingVertical: 9, paddingHorizontal: 18, borderRadius: 12, borderWidth: 1},
  tabDot: {width: 6, height: 6, borderRadius: 3},
  tabText: {fontWeight: '700', fontSize: 13, letterSpacing: 0.2},

  // Scroll
  scroll: {flex: 1},
  scrollInner: {padding: 16, gap: 14},

  // KPI
  kpiRow: {flexDirection: 'row'},
  kpiCard: {flex: 1, alignItems: 'center', paddingVertical: 14, paddingHorizontal: 8},
  kpiIconWrap: {width: 38, height: 38, borderRadius: 12, justifyContent: 'center', alignItems: 'center', marginBottom: 8},
  kpiVal: {fontSize: 15, fontWeight: '800', letterSpacing: 0.2},
  kpiLabel: {fontSize: 10, fontWeight: '600', letterSpacing: 0.4, marginTop: 2},

  // Chips
  chipRow: {flexDirection: 'row', flexWrap: 'wrap', gap: 8, alignItems: 'center'},
  statusChip: {flexDirection: 'row', alignItems: 'center', paddingHorizontal: 12, paddingVertical: 6, borderRadius: 20, gap: 6},
  chipDot: {width: 7, height: 7, borderRadius: 4},
  chipLabel: {fontWeight: '700', fontSize: 12},
  infoChip: {flexDirection: 'row', alignItems: 'center', gap: 5, paddingHorizontal: 10, paddingVertical: 6, borderRadius: 20, borderWidth: 1},

  // Section header
  secHeader: {flexDirection: 'row', alignItems: 'center', marginBottom: 14, paddingBottom: 12, borderBottomWidth: 1, gap: 8},
  secIcon: {width: 28, height: 28, borderRadius: 9, justifyContent: 'center', alignItems: 'center'},
  secTitle: {fontSize: 14, fontWeight: '700', letterSpacing: 0.2, flex: 1},
  countBadge: {paddingHorizontal: 10, paddingVertical: 3, borderRadius: 10, borderWidth: 1},
  countText: {fontSize: 12, fontWeight: '800'},

  // Progress bar
  bar: {height: 7, borderRadius: 4, position: 'relative', marginHorizontal: 6},
  barFill: {position: 'absolute', left: 0, top: 0, bottom: 0, borderRadius: 4},
  dotPos: {position: 'absolute', top: -7, marginLeft: -10, width: 20, height: 20, justifyContent: 'center', alignItems: 'center'},
  dot: {width: 18, height: 18, borderRadius: 9, justifyContent: 'center', alignItems: 'center', borderWidth: 2.5},
  dotActive: {width: 24, height: 24, borderRadius: 12, borderWidth: 3, elevation: 4, shadowColor: Colors.primary, shadowOffset: {width: 0, height: 2}, shadowOpacity: 0.35, shadowRadius: 5},
  barLabels: {flexDirection: 'row', justifyContent: 'space-between', marginTop: 12},
  barLabelItem: {alignItems: 'center'},
  barLabelName: {fontSize: 9, fontWeight: '700', letterSpacing: 0.3, textAlign: 'center'},
  barLabelTime: {fontSize: 11, fontWeight: '800', marginTop: 2},

  // Detail cards
  twoCol: {gap: 14},
  row: {flexDirection: 'row', alignItems: 'flex-start', paddingVertical: 11},
  rowIcon: {width: 32, height: 32, borderRadius: 9, justifyContent: 'center', alignItems: 'center', marginRight: 12, marginTop: 1},
  rowLabel: {fontSize: 10, fontWeight: '700', letterSpacing: 0.5, marginBottom: 3},
  rowValue: {fontSize: 14, fontWeight: '600', lineHeight: 20},
  slumpPill: {alignSelf: 'flex-start', paddingHorizontal: 14, paddingVertical: 5, borderRadius: 10, borderWidth: 1, marginTop: 2},

  // Sync
  syncPulse: {width: 8, height: 8, borderRadius: 4, marginRight: 10},
  syncText: {flex: 1, fontSize: 13, fontWeight: '600'},
  syncBtn: {flexDirection: 'row', alignItems: 'center', gap: 5, paddingHorizontal: 14, paddingVertical: 7, borderRadius: 10, borderWidth: 1},

  // Bottom bar
  bottomBar: {flexDirection: 'row', paddingTop: 6, justifyContent: 'space-around', alignItems: 'center', elevation: 12, shadowColor: Colors.shadowColor, shadowOffset: {width: 0, height: -6}, shadowOpacity: 0.1, shadowRadius: 12},
  bottomItem: {alignItems: 'center', justifyContent: 'center', paddingVertical: 8, paddingHorizontal: 16, position: 'relative'},
  bottomActiveBar: {position: 'absolute', top: -6, width: 32, height: 4, borderRadius: 2},
  bottomIconBg: {width: 48, height: 40, justifyContent: 'center', alignItems: 'center', borderRadius: 14},

  // Dropdown
  dropdownOverlay: {position: 'absolute', top: 0, left: 0, right: 0, bottom: 0},
  dropdown: {position: 'absolute', minWidth: 200, maxWidth: 260, borderRadius: 16, borderWidth: 1, elevation: 12, shadowColor: Colors.shadowColor, shadowOffset: {width: 0, height: 8}, shadowOpacity: 0.15, shadowRadius: 20, overflow: 'hidden'},
  ddHeader: {flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 16, paddingVertical: 14, borderBottomWidth: 1},
  ddAvatar: {width: 36, height: 36, borderRadius: 12, justifyContent: 'center', alignItems: 'center'},
  ddName: {fontSize: 14, fontWeight: '700'},
  ddSub: {fontSize: 11, fontWeight: '500', marginTop: 1},
  ddItem: {flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 16, paddingVertical: 13},
  ddIcon: {width: 34, height: 34, borderRadius: 10, justifyContent: 'center', alignItems: 'center'},
  ddLabel: {flex: 1, fontSize: 14, fontWeight: '600'},
  ddFooter: {alignItems: 'center', paddingVertical: 10, borderTopWidth: 1},
  ddVersion: {fontSize: 11, fontWeight: '500'},

  // Shared modal overlay
  modalOverlay: {flex: 1, justifyContent: 'center', alignItems: 'center'},

  // QR Modal
  qrModal: {width: '92%', maxWidth: 540, borderRadius: 14, paddingTop: 16, paddingBottom: 28, alignItems: 'center', elevation: 12, shadowOffset: {width: 0, height: 6}, shadowOpacity: 0.25, shadowRadius: 16, position: 'relative'},
  qrTitle: {fontSize: 18, fontWeight: '400', textAlign: 'center', marginBottom: 16, paddingHorizontal: 20},
  qrBold: {fontWeight: '900'},
  qrCodeWrap: {alignItems: 'center', justifyContent: 'center'},

  // Plants Modal
  plantsModal: {width: '92%', maxWidth: 540, maxHeight: '85%', borderRadius: 14, elevation: 12, shadowOffset: {width: 0, height: 6}, shadowOpacity: 0.25, shadowRadius: 16},
  plantsTitle: {fontSize: 22, fontWeight: '900', textAlign: 'center', paddingVertical: 20, letterSpacing: 0.5},
  plantsList: {paddingHorizontal: 20},
  plantItem: {paddingVertical: 16, borderBottomWidth: 0.5, alignItems: 'center'},
  plantText: {fontSize: 17, fontWeight: '600', textAlign: 'center'},
  // Edit ticket modal
  editModal: {width: '92%', maxWidth: 500, maxHeight: '85%', borderRadius: 20, elevation: 16, shadowOffset: {width: 0, height: 8}, shadowOpacity: 0.2, shadowRadius: 20, overflow: 'hidden'},
  etHeader: {flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 18, paddingVertical: 14, borderBottomWidth: 1},
  etHeaderIcon: {width: 36, height: 36, borderRadius: 12, justifyContent: 'center', alignItems: 'center'},
  etHeaderTitle: {flex: 1, fontSize: 17, fontWeight: '800', letterSpacing: 0.5},
  etSectionHdr: {flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 18, paddingTop: 16, paddingBottom: 8},
  etSectionTitle: {fontSize: 12, fontWeight: '800', letterSpacing: 1},
  etTimeRow: {flexDirection: 'row', alignItems: 'center', paddingVertical: 12, paddingHorizontal: 18, gap: 12},
  etTimeIcon: {width: 34, height: 34, borderRadius: 10, justifyContent: 'center', alignItems: 'center'},
  etTimeLabel: {flex: 1, fontSize: 13, fontWeight: '700'},
  etTimeValue: {fontSize: 13, fontWeight: '600'},
  etDivider: {height: 1, marginHorizontal: 18, marginVertical: 8},
  etActionRow: {flexDirection: 'row', alignItems: 'center', paddingVertical: 14, paddingHorizontal: 18, gap: 12},
  etActionIcon: {width: 34, height: 34, borderRadius: 10, justifyContent: 'center', alignItems: 'center'},
  etActionLabel: {flex: 1, fontSize: 14, fontWeight: '700'},

  // Unified modal close button
  mCloseBtn: {width: 44, height: 44, borderRadius: 22, justifyContent: 'center', alignItems: 'center'},
  mCloseBtnAbsolute: {position: 'absolute', top: 12, right: 12, zIndex: 10},
  mHeader: {flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 20, paddingVertical: 16, borderBottomWidth: 1},
  mHeaderTitle: {fontSize: 20, fontWeight: '900', letterSpacing: 0.5},
});
