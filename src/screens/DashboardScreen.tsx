import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';
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
  ActivityIndicator,
  Image,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import MaterialIcons from 'react-native-vector-icons/MaterialIcons';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { useTranslation } from 'react-i18next';
import i18n from '../i18n';
import QRCode from 'react-native-qrcode-svg';
import { useTheme } from '../contexts/ThemeContext';
import { useAuth } from '../contexts/AuthContext';
import { useNetworkStatus } from '../hooks/useNetworkStatus';
import { ticketsApi, plantsApi, type Ticket, type TicketDetail, type DeliveryRecord, type Plant, type TicketQr } from '../services/api';
import { Colors } from '../constants/colors';
import { common } from '../constants/commonStyles';
import ResponsiveModal from '../components/ResponsiveModal';
import { wp, ms } from '../utils/responsive';
import {useFontScaleRefresh} from '../contexts/FontSizeContext';

const WEATHER_ICONS: Record<string, string> = {
  '01d': 'wb-sunny', '01n': 'nightlight-round',
  '02d': 'partly-cloudy-day', '02n': 'nights-stay',
  '03d': 'cloud', '03n': 'cloud',
  '04d': 'cloud', '04n': 'cloud',
  '09d': 'grain', '09n': 'grain',
  '10d': 'water-drop', '10n': 'water-drop',
  '11d': 'thunderstorm', '11n': 'thunderstorm',
  '13d': 'ac-unit', '13n': 'ac-unit',
  '50d': 'foggy', '50n': 'foggy',
};
function getWeatherIcon(icon?: string): string {
  if (!icon) return 'wb-sunny';
  return WEATHER_ICONS[icon] || (icon.endsWith('n') ? 'nightlight-round' : 'wb-sunny');
}

const TIMELINE_ICONS: Record<string, string> = {
  ticketed: 'receipt-long',
  loading: 'hourglass-bottom',
  to_job: 'local-shipping',
  on_job: 'location-on',
  pouring: 'water-drop',
  washing: 'clean-hands',
  to_plant: 'route',
  at_plant: 'factory',
};

const TIMELINE_LABEL_KEYS: Record<string, string> = {
  ticketed: 'timeline.ticketed',
  loading: 'timeline.loading',
  to_job: 'timeline.toJob',
  on_job: 'timeline.onJob',
  pouring: 'timeline.pouring',
  washing: 'timeline.washing',
  to_plant: 'timeline.toPlant',
  at_plant: 'timeline.atPlant',
};

function formatTime(dateStr: string | null): string {
  if (!dateStr) return '--';
  const d = new Date(dateStr);
  const h = d.getHours();
  const m = d.getMinutes().toString().padStart(2, '0');
  const ampm = h >= 12 ? 'PM' : 'AM';
  const h12 = h % 12 || 12;
  return `${h12}:${m} ${ampm}`;
}

function formatLocalTime(timeStr: string | null | undefined): string {
  if (!timeStr) return '--';
  return timeStr;
}

function buildTimeline(detail: TicketDetail) {
  return detail.progress.steps.map(step => ({
    labelKey: TIMELINE_LABEL_KEYS[step.key] || step.key,
    icon: TIMELINE_ICONS[step.key] || 'circle',
    time: step.time_local ? formatLocalTime(step.time_local) : formatTime(step.time),
    done: step.done,
  }));
}

function buildJobInfo(detail: TicketDetail) {
  const { job } = detail;
  return [
    { labelKey: 'jobInfo.customer', value: job.customer_name || '-', icon: 'people' },
    { labelKey: 'jobInfo.project', value: job.project_name || '-', icon: 'apartment' },
    { labelKey: 'jobInfo.job', value: job.job || '-', icon: 'work' },
    { labelKey: 'orderInfo.timeDue', value: job.time_due_local ? formatLocalTime(job.time_due_local) : (job.time_due ? formatTime(job.time_due) : '-'), icon: 'schedule' },
    { labelKey: 'orderInfo.deliveredTo', value: job.delivered_to || '-', icon: 'place', isLink: true, isMap: true },
    { labelKey: 'orderInfo.lotBlock', value: job.lot_block || '', icon: 'grid-view' },
    { labelKey: 'orderInfo.instructions', value: job.instructions || '', icon: 'info-outline', isHighlight: !!job.instructions },
  ];
}

// Removed — map navigation now handled via in-app MapScreen

const STATUS_MAP: Record<number, string> = {
  0: 'Printed',
  1: 'Loading',
  2: 'To Job',
  3: 'On Job',
  4: 'Completed',
};

const PAYMENT_MAP: Record<string, string> = {
  '1': 'CASH',
  '2': 'CHECK',
  '3': 'CREDIT CARD',
  '4': 'ON ACCOUNT',
};

// Temporary frontend UOM normalization — should be fixed in API
const UOM_MAP: Record<string, string> = {
  MQ: 'CY',
};
function normalizeUOM(unit: string | null | undefined): string {
  if (!unit) return '';
  return UOM_MAP[unit.toUpperCase()] || unit;
}

function getTicketStatus(ticket: Ticket, detail?: TicketDetail | null) {
  // Prefer detail endpoint fields (delivery_state / in_process) when available
  if (detail?.ticket?.delivery_state) {
    const state = detail.ticket.delivery_state;
    if (state === 'completed') return { key: 'dashboard.completed' as const, type: 'completed' as const };
    if (state === 'voided') return { key: 'dashboard.voided' as const, type: 'voided' as const };
    if (state === 'active') return { key: 'dashboard.active' as const, type: 'active' as const };
  }
  if (detail?.ticket && detail.ticket.in_process != null) {
    if (detail.ticket.in_process) return { key: 'dashboard.active' as const, type: 'active' as const };
    return { key: 'dashboard.completed' as const, type: 'completed' as const };
  }
  // Fallback to list-level fields
  if (ticket.current_status === 4) return { key: 'dashboard.completed' as const, type: 'completed' as const };
  if (ticket.active) return { key: 'dashboard.active' as const, type: 'active' as const };
  return { key: 'dashboard.pending' as const, type: 'warning' as const };
}

function buildMixInfo(detail: TicketDetail, mixDescription?: string | null) {
  const { mix } = detail;
  const currentTruck = detail.mix.trucks?.find(t => t.is_current);
  const items: { labelKey: string; value: string; icon?: string; isLink?: boolean; isHighlight?: boolean; valueColor?: string; isTruckBehind?: boolean }[] = [
    { labelKey: 'mixInfo.mixId', value: mix.mix_code || '-', icon: 'science' },
    { labelKey: 'mixInfo.description', value: mixDescription || '-', icon: 'description', isLink: true },
    { labelKey: 'mixInfo.usage', value: mix.usage || '-', icon: 'category' },
    { labelKey: 'mixInfo.slump', value: mix.slump || '-', isHighlight: true },
    { labelKey: 'orderInfo.quantity', value: mix.quantity || '-', icon: 'straighten' },
  ];
  const truckParts: string[] = [];
  if (mix.truck_ahead) truckParts.push(`${mix.truck_ahead.truck_code} ${mix.truck_ahead.status}`);
  if (mix.truck_behind) truckParts.push(`${mix.truck_behind.truck_code} ${mix.truck_behind.status}`);
  if (truckParts.length > 0) {
    items.push({ labelKey: 'orderInfo.trucks', value: truckParts.join(' | '), icon: 'local-shipping', valueColor: 'accent', isLink: true, isTruckBehind: true });
  }
  return items;
}

function buildMixInfoFromTicket(ticket: Ticket) {
  const mix = ticket.mix;
  return [
    { labelKey: 'mixInfo.mixId', value: mix?.mix_code || '-', icon: 'science' },
    { labelKey: 'mixInfo.description', value: mix?.description || '-', icon: 'description', isLink: true },
    { labelKey: 'mixInfo.usage', value: '-', icon: 'category' },
    { labelKey: 'mixInfo.slump', value: mix?.slump || '-', isHighlight: true },
    { labelKey: 'orderInfo.quantity', value: mix?.quantity || '-', icon: 'straighten' },
  ] as { labelKey: string; value: string; icon?: string; isLink?: boolean; isHighlight?: boolean }[];
}

const BOTTOM_ACTIONS = [
  { icon: 'note-alt', labelKey: 'actions.notes' },
  { icon: 'label', labelKey: 'actions.tag' },
  { icon: 'edit', labelKey: 'actions.edit' },
  { icon: 'local-shipping', labelKey: 'actions.truck' },
  { icon: 'qr-code-scanner', labelKey: 'actions.qr' },
];

const MENU_ITEMS_BASE = [
  { icon: 'local-shipping', labelKey: 'menu.vehicle', actionKey: 'Vehicle', color: '' },
  { icon: 'dark-mode', labelKey: 'menu.darkMode', actionKey: 'DarkMode', color: '' },
  { icon: 'person-off', labelKey: 'menu.logoutDriver', actionKey: 'Logout Driver', color: '' },
  { icon: 'domain-disabled', labelKey: 'menu.logoutTenant', actionKey: 'Logout Tenant', color: 'warn' },
  { icon: 'translate', labelKey: 'menu.language', actionKey: 'Language', color: '' },
  { icon: 'info-outline', labelKey: 'menu.about', actionKey: 'About', color: '' },
];


// Skeleton shimmer
function Skeleton({ width: w, height: h, radius = 8, style }: any) {
  const { c } = useTheme();
  const shimmer = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    Animated.loop(
      Animated.sequence([
        Animated.timing(shimmer, { toValue: 1, duration: 800, useNativeDriver: true }),
        Animated.timing(shimmer, { toValue: 0, duration: 800, useNativeDriver: true }),
      ]),
    ).start();
  }, [shimmer]);
  return (
    <Animated.View
      style={[
        { width: w, height: h, borderRadius: radius, backgroundColor: c.border },
        { opacity: shimmer.interpolate({ inputRange: [0, 1], outputRange: [0.25, 0.6] }) },
        style,
      ]}
    />
  );
}

// Animated card with spring entrance
function FadeCard({ children, delay = 0, style }: any) {
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
            { translateY: anim.interpolate({ inputRange: [0, 1], outputRange: [24, 0] }) },
            { scale: anim.interpolate({ inputRange: [0, 1], outputRange: [0.97, 1] }) },
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

export default function DashboardScreen({ navigation }: Props) {
  useFontScaleRefresh();
  const styles = createStyles();
  const [tickets, setTickets] = useState<Ticket[]>([]);
  const [activeTicket, setActiveTicket] = useState(0);
  const [detail, setDetail] = useState<TicketDetail | null>(null);
  const [deliveryRecord, setDeliveryRecord] = useState<DeliveryRecord | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [loading, setLoading] = useState(true);
  const [initialLoaded, setInitialLoaded] = useState(false);
  const [menuVisible, setMenuVisible] = useState(false);
  const [logoutType, setLogoutType] = useState<'driver' | 'tenant' | null>(null);
  const [loggingOut, setLoggingOut] = useState(false);
  const [qrVisible, setQrVisible] = useState(false);
  const [qrData, setQrData] = useState<TicketQr | null>(null);
  const [qrLoading, setQrLoading] = useState(false);
  const [qrError, setQrError] = useState(false);
  const [plantsVisible, setPlantsVisible] = useState(false);
  const [plantsList, setPlantsList] = useState<Plant[]>([]);
  const [plantsLoading, setPlantsLoading] = useState(false);
  const [plantsError, setPlantsError] = useState(false);
  const [plantsPage, setPlantsPage] = useState(1);
  const [plantsHasNext, setPlantsHasNext] = useState(false);
  const [plantsLoadingMore, setPlantsLoadingMore] = useState(false);
  const plantsPageRef = useRef(1);
  const plantsHasNextRef = useRef(false);
  const plantsLoadingMoreRef = useRef(false);

  const plantsLayoutH = useRef(0);
  const plantsContentH = useRef(0);

  const loadMorePlants = useCallback(() => {
    if (!plantsHasNextRef.current || plantsLoadingMoreRef.current) return;
    plantsLoadingMoreRef.current = true;
    setPlantsLoadingMore(true);
    const nextPage = plantsPageRef.current + 1;
    plantsApi.getAll(nextPage)
      .then(res => {
        if (res.data?.plants) {
          setPlantsList(prev => [...prev, ...res.data.plants]);
          plantsPageRef.current = nextPage;
          setPlantsPage(nextPage);
          plantsHasNextRef.current = res.data.has_next;
          setPlantsHasNext(res.data.has_next);
        }
      })
      .catch(() => {})
      .finally(() => {
        plantsLoadingMoreRef.current = false;
        setPlantsLoadingMore(false);
        // After load finishes, check again if content still doesn't fill the view
        setTimeout(() => {
          if (plantsLayoutH.current > 0 && plantsContentH.current > 0 &&
              plantsContentH.current <= plantsLayoutH.current + 20 &&
              plantsHasNextRef.current && !plantsLoadingMoreRef.current) {
            loadMorePlants();
          }
        }, 100);
      });
  }, []);

  const checkPlantsAutoLoad = useCallback(() => {
    setTimeout(() => {
      if (plantsLayoutH.current > 0 && plantsContentH.current > 0 &&
          plantsContentH.current <= plantsLayoutH.current + 20 &&
          plantsHasNextRef.current && !plantsLoadingMoreRef.current) {
        loadMorePlants();
      }
    }, 50);
  }, [loadMorePlants]);

  const handlePlantsScrollEnd = useCallback(({nativeEvent}: any) => {
    const {layoutMeasurement, contentOffset, contentSize} = nativeEvent;
    if (contentSize.height > 0 && layoutMeasurement.height + contentOffset.y >= contentSize.height - 60) {
      loadMorePlants();
    }
  }, [loadMorePlants]);
  const [editVisible, setEditVisible] = useState(false);
  const [detailsVisible, setDetailsVisible] = useState(false);
  const [pendingDetails, setPendingDetails] = useState(false);
  const [productsVisible, setProductsVisible] = useState(false);
  const [vehicleVisible, setVehicleVisible] = useState(false);
  const [isBroadcasting, setIsBroadcasting] = useState(false);
  const [directionsAlert, setDirectionsAlert] = useState(false);
  const [languageVisible, setLanguageVisible] = useState(false);
  const [activeBottom, setActiveBottom] = useState(-1);
  const [lastSyncTime, setLastSyncTime] = useState<Date>(() => new Date());
  const [syncAgo, setSyncAgo] = useState('just now');
  const [dateFrom, setDateFrom] = useState<string | null>(null);
  const { t } = useTranslation();
  const { isDark, toggle, c } = useTheme();
  const { driverLogout, companyLogout, driver, company, isCompanyLoggedIn } = useAuth();
  const { isOnline } = useNetworkStatus();
  const insets = useSafeAreaInsets();
  const { width, height: winHeight } = useWindowDimensions();
  const isTablet = Math.min(width, winHeight) > 600;
  const isLandscape = width > winHeight;
  // Landscape-proportional scale: identical on 810dp ref device, proportional elsewhere
  const LREF = 810;
  const ls = (size: number) => Math.round(size * Math.min(width, winHeight) / LREF);
  const menuScale = useRef(new Animated.Value(0)).current;
  const menuOpacity = useRef(new Animated.Value(0)).current;
  const syncSpin = useRef(new Animated.Value(0)).current;

  // Redirect to login when session expires
  useEffect(() => {
    if (!isCompanyLoggedIn) {
      navigation.reset({index: 0, routes: [{name: 'Login'}]});
    }
  }, [isCompanyLoggedIn, navigation]);

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

  const fetchTickets = useCallback(async (showLoading = true) => {
    try {
      if (showLoading) setLoading(true);
      setRefreshing(true);
      const { data } = await ticketsApi.getLatest({ page: 1, limit: 20 });
      console.log('[Tickets] fetched:', data.total, 'tickets, data length:', data.data.length);
      setTickets(data.data);
      setActiveTicket(0);
      setDateFrom(data.filters?.date_from || null);
      setLastSyncTime(new Date());
    } catch (err) {
      console.log('[Tickets] fetch error:', err);
    } finally {
      setLoading(false);
      setRefreshing(false);
      setInitialLoaded(true);
    }
  }, []);

  const fetchDetail = useCallback(async (ticketId: number) => {
    setDetailLoading(true);
    try {
      const { data } = await ticketsApi.getById(ticketId);
      setDetail(data);
    } catch (err) {
      console.log('[TicketDetail] fetch error:', err);
    } finally {
      setDetailLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchTickets();
  }, [fetchTickets]);

  // Auto-refresh every 2 minutes
  useEffect(() => {
    const iv = setInterval(() => {
      fetchTickets(false);
    }, 120000);
    return () => clearInterval(iv);
  }, [fetchTickets]);

  // Fetch detail + delivery record when active ticket changes
  useEffect(() => {
    const ticket = tickets[activeTicket];
    if (ticket) {
      fetchDetail(ticket.id);
      ticketsApi.getDeliveryRecord(ticket.id)
        .then(res => {
          setDeliveryRecord(res.data);
          setPendingDetails(prev => { if (prev) { setDetailsVisible(true); } return false; });
        })
        .catch(() => { setDeliveryRecord(null); setPendingDetails(false); });
    } else {
      setDetail(null);
      setDeliveryRecord(null);
    }
  }, [activeTicket, tickets, fetchDetail]);

  const handleSync = useCallback(() => {
    syncSpin.setValue(0);
    Animated.timing(syncSpin, { toValue: 1, duration: 600, useNativeDriver: true }).start();
    fetchTickets(false);
  }, [syncSpin, fetchTickets]);

  const onRefresh = useCallback(() => {
    fetchTickets(false);
  }, [fetchTickets]);

  const syncRotate = syncSpin.interpolate({ inputRange: [0, 1], outputRange: ['0deg', '360deg'] });

  // Derived data from active ticket
  const currentTicket = tickets[activeTicket] || null;
  const timeline = useMemo(() => detail ? buildTimeline(detail) : [], [detail]);
  const jobInfo = useMemo(() => detail ? buildJobInfo(detail) : [], [detail]);
  const temperature = deliveryRecord?.plant?.temp_at_plant ?? deliveryRecord?.plant?.measured?.temp_at_plant;
  const mixInfo = useMemo(() => detail
    ? buildMixInfo(detail, currentTicket?.mix?.description || null)
    : currentTicket ? buildMixInfoFromTicket(currentTicket) : [], [detail, currentTicket]);
  const doneCount = detail ? detail.progress.completed : 0;
  const progressPct = detail ? (detail.progress.completed / detail.progress.total) * 100 : 0;

  // Only show Vehicle Tracking menu when there's an in-process ticket
  const hasActiveTicket = detail?.ticket?.in_process === true;
  const menuItems = useMemo(
    () => hasActiveTicket ? MENU_ITEMS_BASE : MENU_ITEMS_BASE.filter(i => i.actionKey !== 'Vehicle'),
    [hasActiveTicket],
  );

  // Paired row count for the Job + Mix table layout
  const pairedRows = Math.max(jobInfo.length, mixInfo.length);

  const openMenu = () => {
    setMenuVisible(true);
    Animated.parallel([
      Animated.spring(menuScale, { toValue: 1, friction: 7, tension: 70, useNativeDriver: true }),
      Animated.timing(menuOpacity, { toValue: 1, duration: 200, useNativeDriver: true }),
    ]).start();
  };

  const closeMenu = () => {
    Animated.parallel([
      Animated.timing(menuScale, { toValue: 0, duration: 150, useNativeDriver: true }),
      Animated.timing(menuOpacity, { toValue: 0, duration: 150, useNativeDriver: true }),
    ]).start(() => setMenuVisible(false));
  };

  const handleLogoutConfirm = async () => {
    const type = logoutType;
    setLoggingOut(true);
    try {
      if (type === 'driver') {
        await driverLogout();
        setLogoutType(null);
        navigation.replace('DriverLogin');
      } else if (type === 'tenant') {
        await companyLogout();
        setLogoutType(null);
        navigation.replace('Login');
      }
    } finally {
      setLoggingOut(false);
    }
  };

  const handleMenuItemPress = (label: string) => {
    closeMenu();
    if (label === 'Vehicle') {
      navigation.navigate('VehicleTracking');
    } else if (label === 'DarkMode') {
      toggle();
    } else if (label === 'Logout Driver') {
      setLogoutType('driver');
    } else if (label === 'Logout Tenant') {
      setLogoutType('tenant');
    } else if (label === 'Language') {
      setLanguageVisible(true);
    }
  };

  const handleNavPress = useCallback((item: typeof BOTTOM_ACTIONS[0], i: number) => {
    setActiveBottom(i);
    if (item.icon === 'label') { navigation.navigate('MobileTicket', { ticketId: currentTicket?.id }); }
    if (item.icon === 'note-alt') { navigation.navigate('Notes', { ticketId: currentTicket?.id }); }
    if (item.icon === 'edit') { setEditVisible(true); }
    if (item.icon === 'qr-code-scanner' && currentTicket) {
      setQrLoading(true);
      setQrError(false);
      setQrData(null);
      setQrVisible(true);
      ticketsApi.getQr(currentTicket.id)
        .then(res => { if (res.data) setQrData(res.data); })
        .catch(() => { setQrError(true); })
        .finally(() => setQrLoading(false));
    }
    if (item.icon === 'local-shipping') {
      setPlantsLoading(true);
      setPlantsError(false);
      setPlantsList([]);
      setPlantsPage(1);
      setPlantsHasNext(false);
      plantsPageRef.current = 1;
      plantsHasNextRef.current = false;
      plantsLoadingMoreRef.current = false;
      plantsLayoutH.current = 0;
      plantsContentH.current = 0;
      setPlantsVisible(true);
      plantsApi.getAll(1)
        .then(res => { if (res.data?.plants) { setPlantsList(res.data.plants); setPlantsHasNext(res.data.has_next); plantsHasNextRef.current = res.data.has_next; setPlantsPage(1); plantsPageRef.current = 1; } })
        .catch(() => { setPlantsError(true); })
        .finally(() => setPlantsLoading(false));
    }
  }, [navigation, currentTicket]);

  // Shorthand flags
  const L = isLandscape;
  const lp = isLandscape && !isTablet; // landscape phone — most space-constrained
  const lt = isLandscape && isTablet;  // landscape tablet — more room, larger fonts
  const cs = {
    card: {
      backgroundColor: c.white,
      borderRadius: lt ? ls(14) : L ? 12 : wp(12),
      padding: lt ? ls(12) : L ? 10 : wp(8),
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: c.border,
      elevation: isDark ? 0 : 2,
      shadowColor: Colors.shadowColor,
      shadowOffset: { width: 0, height: 1 },
      shadowOpacity: isDark ? 0 : 0.06,
      shadowRadius: 6,
    },
  };

  // Skeleton state — only during initial API call
  if (!initialLoaded) {
    const skPad = { paddingLeft: Math.max(wp(10), insets.left + wp(4)), paddingRight: Math.max(wp(10), insets.right + wp(4)) };
    return (
      <View style={[styles.container, { backgroundColor: c.background }]}>
        <StatusBar translucent backgroundColor="transparent" barStyle="light-content" />
        {/* Header */}
        <View style={[styles.header, { backgroundColor: c.primaryDark, paddingTop: insets.top + wp(3), paddingLeft: Math.max(wp(12), insets.left), paddingRight: Math.max(wp(12), insets.right) }]}>
          <View style={styles.headerRow}>
            <View style={styles.headerLeft}>
              <Skeleton width={wp(36)} height={wp(36)} radius={wp(18)} />
              <Skeleton width={wp(120)} height={wp(14)} radius={wp(4)} style={{ marginLeft: wp(10) }} />
            </View>
            <View style={common.rowGap8}>
              <Skeleton width={wp(70)} height={wp(28)} radius={wp(14)} />
              <Skeleton width={wp(32)} height={wp(32)} radius={wp(10)} />
              <Skeleton width={wp(32)} height={wp(32)} radius={wp(10)} />
            </View>
          </View>
          {/* Ticket tabs */}
          <View style={{ flexDirection: 'row', gap: wp(5), marginTop: wp(4), paddingBottom: wp(2) }}>
            <Skeleton width={wp(80)} height={wp(26)} radius={wp(7)} />
            <Skeleton width={wp(80)} height={wp(26)} radius={wp(7)} />
            <Skeleton width={wp(80)} height={wp(26)} radius={wp(7)} />
          </View>
        </View>

        {/* Weather strip */}
        <View style={[{ backgroundColor: c.primary, flexDirection: 'row', alignItems: 'center', paddingVertical: wp(5), gap: wp(10) }, skPad]}>
          <Skeleton width={wp(24)} height={wp(24)} radius={wp(12)} />
          <View style={{ flex: 1, gap: wp(4) }}>
            <Skeleton width={wp(100)} height={wp(10)} radius={wp(3)} />
            <Skeleton width={wp(140)} height={wp(8)} radius={wp(3)} />
          </View>
          <Skeleton width={wp(60)} height={wp(30)} radius={wp(8)} />
        </View>

        {/* Content */}
        <ScrollView style={{ flex: 1 }} contentContainerStyle={[{ paddingTop: wp(4), paddingBottom: Math.max(wp(4), insets.bottom), gap: wp(3) }, skPad]}>
          {/* KPI card */}
          <View style={[cs.card, { padding: wp(6) }]}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: wp(12) }}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: wp(6), flex: 1 }}>
                <Skeleton width={wp(28)} height={wp(28)} radius={wp(8)} />
                <View style={{ gap: wp(4) }}>
                  <Skeleton width={wp(70)} height={wp(12)} radius={wp(3)} />
                  <Skeleton width={wp(40)} height={wp(9)} radius={wp(3)} />
                </View>
              </View>
              <View style={{ width: StyleSheet.hairlineWidth, height: wp(24), backgroundColor: c.border }} />
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: wp(6), flex: 1 }}>
                <Skeleton width={wp(28)} height={wp(28)} radius={wp(8)} />
                <View style={{ gap: wp(4) }}>
                  <Skeleton width={wp(50)} height={wp(12)} radius={wp(3)} />
                  <Skeleton width={wp(35)} height={wp(9)} radius={wp(3)} />
                </View>
              </View>
            </View>
            <View style={{ flexDirection: 'row', gap: wp(6), marginTop: wp(6), borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: c.borderLight, paddingTop: wp(6) }}>
              <Skeleton width={wp(90)} height={wp(22)} radius={wp(8)} />
              <Skeleton width={wp(80)} height={wp(22)} radius={wp(8)} />
            </View>
          </View>

          {/* Delivery Progress card */}
          <View style={[cs.card]}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: wp(4), marginBottom: wp(4), borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: c.borderLight, paddingBottom: wp(4) }}>
              <Skeleton width={wp(22)} height={wp(22)} radius={wp(7)} />
              <Skeleton width={wp(110)} height={wp(10)} radius={wp(3)} />
              <View style={{ flex: 1 }} />
              <Skeleton width={wp(30)} height={wp(16)} radius={wp(6)} />
            </View>
            <View style={{ flexDirection: 'row', alignItems: 'center', paddingHorizontal: wp(2) }}>
              {[0, 1, 2, 3, 4, 5, 6, 7].map(i => (
                <React.Fragment key={i}>
                  {i > 0 && <View style={{ flex: 1, height: 2, backgroundColor: c.border, borderRadius: 1 }} />}
                  <Skeleton width={wp(10)} height={wp(10)} radius={wp(5)} />
                </React.Fragment>
              ))}
            </View>
            <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginTop: wp(4), paddingHorizontal: wp(2) }}>
              {[0, 1, 2, 3, 4, 5, 6, 7].map(i => (
                <View key={i} style={{ alignItems: 'center', gap: wp(2) }}>
                  <Skeleton width={wp(28)} height={wp(7)} radius={wp(2)} />
                  <Skeleton width={wp(22)} height={wp(8)} radius={wp(2)} />
                </View>
              ))}
            </View>
          </View>

          {/* Job Details + Mix Details cards */}
          <View style={{ flexDirection: 'row', gap: wp(3) }}>
            {/* Job Details */}
            <View style={[cs.card, { flex: 1 }]}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: wp(4), marginBottom: wp(4), borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: c.borderLight, paddingBottom: wp(4) }}>
                <Skeleton width={wp(16)} height={wp(16)} radius={wp(4)} />
                <Skeleton width={wp(65)} height={wp(10)} radius={wp(3)} />
              </View>
              {[0, 1, 2, 3, 4, 5].map(i => (
                <View key={i} style={{ flexDirection: 'row', alignItems: 'center', paddingVertical: wp(5), borderBottomWidth: i < 5 ? StyleSheet.hairlineWidth : 0, borderBottomColor: c.borderLight }}>
                  <Skeleton width={wp(40)} height={wp(8)} radius={wp(2)} />
                  <View style={{ flex: 1 }} />
                  <Skeleton width={wp(60)} height={wp(8)} radius={wp(2)} />
                </View>
              ))}
            </View>
            {/* Mix Details */}
            <View style={[cs.card, { flex: 1, backgroundColor: c.primarySurface }]}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: wp(4), marginBottom: wp(4), borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: c.borderLight, paddingBottom: wp(4) }}>
                <Skeleton width={wp(16)} height={wp(16)} radius={wp(4)} />
                <Skeleton width={wp(60)} height={wp(10)} radius={wp(3)} />
              </View>
              {[0, 1, 2, 3, 4, 5].map(i => (
                <View key={i} style={{ flexDirection: 'row', alignItems: 'center', paddingVertical: wp(5), borderBottomWidth: i < 5 ? StyleSheet.hairlineWidth : 0, borderBottomColor: c.borderLight }}>
                  <Skeleton width={wp(40)} height={wp(8)} radius={wp(2)} />
                  <View style={{ flex: 1 }} />
                  <Skeleton width={wp(55)} height={wp(8)} radius={wp(2)} />
                </View>
              ))}
            </View>
          </View>
        </ScrollView>

        {/* Bottom nav */}
        <View style={{
          flexDirection: 'row', justifyContent: 'space-evenly', alignItems: 'center',
          borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: c.border, backgroundColor: c.white,
          paddingTop: 4, paddingBottom: insets.bottom || 6, paddingLeft: insets.left, paddingRight: insets.right,
        }}>
          {[0, 1, 2, 3, 4].map(i => (
            <View key={i} style={{ alignItems: 'center', paddingVertical: 4, minWidth: wp(48) }}>
              <Skeleton width={wp(24)} height={wp(24)} radius={wp(6)} />
            </View>
          ))}
        </View>
      </View>
    );
  }

  // ─── EMPTY STATE: no tickets assigned ───
  if (tickets.length === 0 && initialLoaded) {
    const handleTruckPress = () => {
      setPlantsLoading(true);
      setPlantsError(false);
      setPlantsList([]);
      setPlantsPage(1);
      setPlantsHasNext(false);
      plantsPageRef.current = 1;
      plantsHasNextRef.current = false;
      plantsLoadingMoreRef.current = false;
      plantsLayoutH.current = 0;
      plantsContentH.current = 0;
      setPlantsVisible(true);
      plantsApi.getAll(1)
        .then(res => { if (res.data?.plants) { setPlantsList(res.data.plants); setPlantsHasNext(res.data.has_next); plantsHasNextRef.current = res.data.has_next; setPlantsPage(1); plantsPageRef.current = 1; } })
        .catch(() => {})
        .finally(() => setPlantsLoading(false));
    };
    return (
      <View style={[styles.container, {backgroundColor: '#c8c8c8'}]}>
        <StatusBar translucent backgroundColor="transparent" barStyle="light-content" />
        <View style={{backgroundColor: c.primary, paddingTop: insets.top + (isLandscape ? 2 : wp(4)), paddingBottom: isLandscape ? 4 : wp(6), paddingHorizontal: Math.max(wp(12), insets.right + wp(4)), flexDirection: 'row', justifyContent: 'flex-end', alignItems: 'center'}}>
          <TouchableOpacity style={{width: isLandscape ? 30 : Math.max(wp(34), 34), height: isLandscape ? 30 : Math.max(wp(34), 34), borderRadius: wp(8), justifyContent: 'center', alignItems: 'center'}} onPress={openMenu} activeOpacity={0.7}>
            <MaterialIcons name="menu" size={ms(isLandscape ? 18 : 22)} color="#fff" />
          </TouchableOpacity>
        </View>
        <View style={{flex: 1, justifyContent: 'center', alignItems: 'center', paddingHorizontal: wp(20)}}>
          <Text style={{fontSize: ms(isLandscape ? 12 : 16), fontWeight: '400', color: '#222', textAlign: 'center'}}>
            COMPANY: {company?.company_name || '-'}
          </Text>
          <Text style={{fontSize: ms(isLandscape ? 11 : 15), fontWeight: '400', color: '#222', textAlign: 'center', marginTop: isLandscape ? 1 : wp(6)}}>
            VEHICLE: {driver?.truck_code || '-'}
          </Text>
          <Text style={{fontSize: ms(isLandscape ? 13 : 18), fontWeight: '800', color: '#111', textAlign: 'center', marginTop: isLandscape ? 6 : wp(24)}}>
            TICKET NOT ASSIGNED
          </Text>
          {loading ? (
            <ActivityIndicator size="large" color="#2e7d32" style={{marginTop: isLandscape ? 6 : wp(16)}} />
          ) : (
            <>
              <TouchableOpacity onPress={() => fetchTickets(true)} activeOpacity={0.7} style={{marginTop: isLandscape ? 2 : wp(8)}}>
                <Text style={{fontSize: ms(isLandscape ? 11 : 15), fontWeight: '600', color: '#2e7d32', textDecorationLine: 'underline', textAlign: 'center'}}>
                  REFRESH
                </Text>
              </TouchableOpacity>
              <TouchableOpacity onPress={handleTruckPress} activeOpacity={0.7} style={{marginTop: isLandscape ? 8 : wp(16), alignItems: 'center'}}>
                <MaterialIcons name="local-shipping" size={ms(isLandscape ? 60 : 80)} color="#555" />
              </TouchableOpacity>
            </>
          )}
        </View>

        {/* Dropdown menu */}
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
              <ScrollView bounces={false} showsVerticalScrollIndicator={false}>
                {menuItems.map((item, i) => {
                  const isWarn = item.color === 'warn';
                  const iconColor = isWarn ? c.error : c.textSecondary;
                  const labelColor = isWarn ? c.error : c.textPrimary;
                  const bgColor = isWarn ? c.errorSurface : c.surface;
                  const isDarkMode = item.actionKey === 'DarkMode';
                  const itemIcon = isDarkMode ? (isDark ? 'light-mode' : 'dark-mode') : item.icon;
                  const label = isDarkMode ? (isDark ? t('menu.lightMode', 'Light Mode') : t('menu.darkMode', 'Dark Mode')) : t(item.labelKey);
                  const suffix = item.actionKey === 'Language' ? ` (${i18n.language.toUpperCase()})` : '';
                  return (
                    <TouchableOpacity
                      key={item.actionKey}
                      style={[styles.ddItem, i < menuItems.length - 1 && {borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: c.borderLight}]}
                      activeOpacity={0.6}
                      onPress={() => handleMenuItemPress(item.actionKey)}>
                      <View style={[styles.ddIcon, {backgroundColor: bgColor}]}>
                        <MaterialIcons name={itemIcon as any} size={ms(18)} color={iconColor} />
                      </View>
                      <Text style={[styles.ddLabel, {color: labelColor}]}>{label}{suffix}</Text>
                      <MaterialIcons name="chevron-right" size={ms(18)} color={c.textMuted} />
                    </TouchableOpacity>
                  );
                })}
              </ScrollView>
              <View style={[styles.ddFooter, {borderTopColor: c.borderLight}]}>
                <Text style={[styles.ddVersion, {color: c.textMuted}]}>v1.20.0</Text>
              </View>
            </Animated.View>
          </View>
        )}

        {/* Plants modal also accessible from empty state */}
        <ResponsiveModal
          visible={plantsVisible}
          onClose={() => setPlantsVisible(false)}
          maxWidth={450}
          maxHeightPercent={70}>
          <View style={[styles.mHeader, {borderBottomColor: c.border}]}>
            <Text style={[styles.mHeaderTitle, {color: c.textPrimary}]}>{t('modals.plants')}</Text>
            <TouchableOpacity style={[styles.mCloseBtn, {backgroundColor: c.surface}]} onPress={() => setPlantsVisible(false)} activeOpacity={0.7} hitSlop={{top: 8, bottom: 8, left: 8, right: 8}}>
              <MaterialIcons name="close" size={ms(20)} color={c.textSecondary} />
            </TouchableOpacity>
          </View>
          {plantsLoading ? (
            <View style={{paddingVertical: wp(40), alignItems: 'center'}}>
              <ActivityIndicator size="large" color={c.primary} />
            </View>
          ) : (
            <ScrollView
              style={styles.plantsList}
              showsVerticalScrollIndicator={true}
              bounces={false}
              onMomentumScrollEnd={handlePlantsScrollEnd}
              onScrollEndDrag={handlePlantsScrollEnd}
              onLayout={({nativeEvent}) => { plantsLayoutH.current = nativeEvent.layout.height; checkPlantsAutoLoad(); }}
              onContentSizeChange={(_w, h) => { plantsContentH.current = h; checkPlantsAutoLoad(); }}>
              {plantsList.map(plant => (
                <TouchableOpacity
                  key={plant.id}
                  style={[styles.plantItem, {borderBottomColor: c.borderLight}]}
                  activeOpacity={0.6}
                  onPress={() => setPlantsVisible(false)}>
                  <Text style={[styles.plantText, {color: c.textPrimary}]}>{plant.code}-{plant.name}</Text>
                </TouchableOpacity>
              ))}
              {plantsLoadingMore && (
                <View style={{paddingVertical: wp(12), alignItems: 'center'}}>
                  <ActivityIndicator size="small" color={c.primary} />
                </View>
              )}
            </ScrollView>
          )}
        </ResponsiveModal>
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
          style={{ alignItems: 'center', justifyContent: 'center', paddingVertical: lp ? 14 : ls(18) }}>
          <View style={{
            width: lp ? 52 : ls(56), height: lp ? 52 : ls(56), justifyContent: 'center', alignItems: 'center',
            borderRadius: lp ? 14 : ls(16), backgroundColor: active ? c.primarySurface : 'transparent',
          }}>
            <MaterialIcons name={item.icon as any} size={lp ? 30 : ls(38)} color={active ? c.primary : c.textMuted} />
          </View>
        </TouchableOpacity>
      );
    }
    return (
      <TouchableOpacity
        key={item.labelKey}
        activeOpacity={0.6}
        onPress={() => handleNavPress(item, i)}
        style={{ alignItems: 'center', justifyContent: 'center', paddingVertical: 4, minWidth: wp(48) }}>
        <View style={{
          width: wp(40), height: wp(32), justifyContent: 'center', alignItems: 'center',
          borderRadius: wp(12), backgroundColor: active ? c.primarySurface : 'transparent',
        }}>
          <MaterialIcons name={item.icon as any} size={isTablet ? 29 : ms(24)} color={active ? c.primary : c.textMuted} />
        </View>
      </TouchableOpacity>
    );
  };

  return (
    <View style={[styles.container, { backgroundColor: c.background }, L && { flexDirection: 'row' }]}>
      <StatusBar translucent backgroundColor="transparent" barStyle="light-content" />

      {/* Main content column */}
      <View style={{ flex: 1 }}>
        {/* ─── HEADER ─── */}
        <View style={[styles.header, { backgroundColor: c.primaryDark, paddingTop: insets.top + (L ? ls(2) : wp(3)), paddingLeft: Math.max(L ? ls(8) : wp(12), insets.left), paddingRight: Math.max(L ? ls(8) : wp(12), insets.right) }, L && { paddingBottom: ls(2) }]}>
          {lp ? (
            /* Phone landscape: single compact row — tickets moved to KPI card */
            <>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, flex: 1 }}>
                  <Image source={require('../assets/images/logo.png')} style={{ width: 26, height: 26, borderRadius: 13 }} />
                  <Text style={{ fontSize: 13, fontWeight: '800', letterSpacing: 0.5, color: c.textOnPrimary }}>{company?.company_name || t('app.name')}</Text>
                </View>
                {/* Weather inline */}
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: c.overlay10, paddingVertical: 3, paddingHorizontal: 8, borderRadius: 10 }}>
                  <MaterialIcons name={getWeatherIcon(detail?.weather?.icon)} size={14} color={c.textOnPrimary} />
                  <View>
                    <Text style={{ fontSize: 9, fontWeight: '700', color: c.textOnPrimary }} numberOfLines={1}>{currentTicket?.location_code ? `${currentTicket.location_code} - ` : ''}{currentTicket?.plant_name || company?.company_name || '-'}</Text>
                    <Text style={{ fontSize: 8, fontWeight: '700', color: c.textOnPrimary }} numberOfLines={1}>{detail?.weather ? `${Math.round(detail.weather.temperature_c)}°C ${detail.weather.description.toUpperCase()}` : currentTicket?.location_name || ''}</Text>
                  </View>
                </View>
                {/* Vehicle & Employee stacked */}
                <View style={{ backgroundColor: c.overlay10, paddingVertical: 3, paddingHorizontal: 8, borderRadius: 10, gap: 2 }}>
                  <Text style={{ fontSize: 9, fontWeight: '700', color: c.textOnPrimary }}>{driver?.truck_code || '-'}</Text>
                  <Text style={{ fontSize: 8, fontWeight: '500', color: c.textOnDark60 }}>{driver?.driver_code || '-'}</Text>
                </View>
                {/* Sync pill */}
                <TouchableOpacity onPress={handleSync} activeOpacity={0.7} style={{ flexDirection: 'row', alignItems: 'center', gap: 4, backgroundColor: c.overlay10, paddingVertical: 4, paddingHorizontal: 8, borderRadius: 12 }}>
                  <Animated.View style={{ transform: [{ rotate: syncRotate }] }}><MaterialIcons name="sync" size={13} color={c.textOnPrimary} /></Animated.View>
                  <View style={{ width: 4, height: 4, borderRadius: 2, backgroundColor: refreshing ? c.warning : c.success }} />
                  <Text style={{ fontSize: 9, fontWeight: '600', color: c.textOnDark60 }}>{syncAgo}</Text>
                </TouchableOpacity>
                <View style={{ backgroundColor: isOnline ? '#2E7D32' : '#D32F2F', borderRadius: 8, paddingVertical: 4, paddingHorizontal: 8, justifyContent: 'center', alignItems: 'center' }}>
                  <Text style={{ fontSize: 8, fontWeight: '700', color: '#fff' }}>{isOnline ? 'ONLINE' : 'OFFLINE'}</Text>
                </View>
                <TouchableOpacity style={{ width: 28, height: 28, borderRadius: 8, justifyContent: 'center', alignItems: 'center', backgroundColor: c.overlay10 }} onPress={openMenu} activeOpacity={0.7}>
                  <MaterialIcons name="menu" size={15} color={c.textOnPrimary} />
                </TouchableOpacity>
              </View>
              <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={[styles.tabsRow, { marginTop: 4 }]}>
                {tickets.map((ticket, i) => {
                  const isSelected = activeTicket === i;
                  const isCompleted = ticket.at_plant_time != null;
                  return (
                    <TouchableOpacity key={ticket.id} onPress={() => { if (isCompleted) { setPendingDetails(true); } setActiveTicket(i); }} activeOpacity={0.7} style={[styles.tab, { borderColor: c.overlay15, backgroundColor: isCompleted ? c.primary : c.accent, borderBottomWidth: isSelected ? 4 : 0, borderBottomColor: c.textPrimary }]}>
                      <Text style={[styles.tabText, { color: c.textOnPrimary }]}>{ticket.ticket_code}</Text>
                    </TouchableOpacity>
                  );
                })}
              </ScrollView>
            </>
          ) : (
            /* Portrait + tablet landscape: two-row header */
            <>
              <View style={[styles.headerRow, L && { marginBottom: ls(3) }]}>
                <View style={styles.headerLeft}>
                  <Image source={require('../assets/images/logo.png')} style={[styles.logo, L && { width: ls(30), height: ls(30), borderRadius: ls(15) }]} />
                  <Text numberOfLines={1} style={[styles.logoTitle,
                  { color: c.textOnPrimary, marginLeft: L ? ls(8) : wp(10), flexShrink: 1 }, L && { fontSize: ls(20) }]}>{company?.company_name || t('app.name')}</Text>
                </View>
                <View style={[styles.headerActions, L && { gap: ls(5) }]}>
                  {/* Weather + Vehicle + Employee — landscape only, before sync */}
                  {L && (
                    <>
                      <View style={{ flexDirection: 'row', alignItems: 'center', gap: ls(6), backgroundColor: c.overlay10, paddingVertical: ls(4), paddingHorizontal: ls(10), borderRadius: ls(12) }}>
                        <MaterialIcons name={getWeatherIcon(detail?.weather?.icon)} size={ls(16)} color={c.textOnPrimary} />
                        <View>
                          <Text style={{ fontSize: ms(10), fontWeight: '700', color: c.textOnPrimary }} numberOfLines={1}>{currentTicket?.location_code ? `${currentTicket.location_code} - ` : ''}{currentTicket?.plant_name || company?.company_name || '-'}</Text>
                          <Text style={{ fontSize: ms(8), fontWeight: '700', color: c.textOnPrimary }} numberOfLines={1}>{detail?.weather ? `${Math.round(detail.weather.temperature_c)}°C ${detail.weather.description.toUpperCase()}` : currentTicket?.location_name || ''}</Text>
                        </View>
                      </View>
                      <View style={{ backgroundColor: c.overlay10, paddingVertical: ls(4), paddingHorizontal: ls(10), borderRadius: ls(12), gap: ls(2) }}>
                        <Text style={{ fontSize: ms(10), fontWeight: '700', color: c.textOnPrimary }}>{driver?.truck_code || '-'}</Text>
                        <Text style={{ fontSize: ms(8), fontWeight: '500', color: c.textOnDark60 }}>{driver?.driver_code || '-'}</Text>
                      </View>
                    </>
                  )}
                  {/* Sync pill */}
                  <TouchableOpacity
                    onPress={handleSync}
                    activeOpacity={0.7}
                    style={[{ flexDirection: 'row', alignItems: 'center', gap: wp(5), backgroundColor: c.overlay10, paddingHorizontal: wp(10), borderRadius: wp(14) }, L ? { paddingVertical: ls(5), paddingHorizontal: ls(8), borderRadius: ls(12), gap: ls(4) } : { paddingVertical: wp(5) }]}>
                    <Animated.View style={{ transform: [{ rotate: syncRotate }] }}>
                      <MaterialIcons name="sync" size={L ? ls(15) : ms(16)} color={c.textOnPrimary} />
                    </Animated.View>
                    <View style={{ width: ls(5), height: ls(5), borderRadius: 3, backgroundColor: refreshing ? c.warning : c.success }} />
                    <Text style={{ fontSize: ms(8), fontWeight: '600', color: c.textOnDark60 }}>{syncAgo}</Text>
                  </TouchableOpacity>
                  <View style={{ backgroundColor: isOnline ? '#2E7D32' : '#D32F2F', borderRadius: L ? ls(10) : wp(10), paddingVertical: L ? ls(4) : wp(4), paddingHorizontal: L ? ls(8) : wp(8), justifyContent: 'center', alignItems: 'center' }}>
                    <Text style={{ fontSize: L ? ms(8) : ms(9), fontWeight: '700', color: '#fff' }}>{isOnline ? 'ONLINE' : 'OFFLINE'}</Text>
                  </View>
                  <TouchableOpacity style={[styles.hdrBtn, { backgroundColor: c.overlay10 }, L && { width: ls(34), height: ls(34), borderRadius: ls(10) }]} onPress={openMenu} activeOpacity={0.7}>
                    <MaterialIcons name="menu" size={L ? ls(21) : ms(19)} color={c.textOnPrimary} />
                  </TouchableOpacity>
                </View>
              </View>
              <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.tabsRow}>
                {tickets.map((ticket, i) => {
                  const isSelected = activeTicket === i;
                  const isCompleted = ticket.at_plant_time != null;
                  return (
                    <TouchableOpacity key={ticket.id} onPress={() => { if (isCompleted) { setPendingDetails(true); } setActiveTicket(i); }} activeOpacity={0.7} style={[styles.tab, { borderColor: c.overlay15, backgroundColor: isCompleted ? c.primary : c.accent, borderBottomWidth: isSelected ? 4 : 0, borderBottomColor: c.textPrimary }]}>
                      <Text style={[styles.tabText, { color: c.textOnPrimary }]}>{ticket.ticket_code}</Text>
                    </TouchableOpacity>
                  );
                })}
              </ScrollView>
            </>
          )}
        </View>

        {/* ─── WEATHER STRIP (portrait only) ─── */}
        {!L && (
          <View style={{ backgroundColor: c.primary, flexDirection: 'row', alignItems: 'center', paddingVertical: wp(5), paddingLeft: Math.max(wp(14), insets.left + wp(4)), paddingRight: Math.max(wp(14), insets.right + wp(4)), gap: wp(10) }}>
            <MaterialIcons name={getWeatherIcon(detail?.weather?.icon)} size={ms(isTablet ? 28 : 24)} color={c.textOnPrimary} />
            <View style={{ flex: 1, flexShrink: 1 }}>
              <Text style={{ fontSize: ms(10), fontWeight: '800', color: c.textOnPrimary, letterSpacing: 0.3 }}>{currentTicket?.location_code ? `${currentTicket.location_code} - ` : ''}{currentTicket?.plant_name || company?.company_name || '-'}</Text>
              <Text style={{ fontSize: ms(8), fontWeight: '700', color: c.textOnPrimary, marginTop: 1 }}>{detail?.weather ? `${Math.round(detail.weather.temperature_c)}°C ${detail.weather.description.toUpperCase()}` : currentTicket?.location_name || ''}</Text>
            </View>
            <View style={{ backgroundColor: 'rgba(255,255,255,0.15)', paddingVertical: wp(5), paddingHorizontal: wp(10), borderRadius: wp(8), gap: wp(2) }}>
              <Text style={{ fontSize: ms(10), fontWeight: '700', color: c.textOnPrimary }}>{driver?.truck_code || '-'}</Text>
              <Text style={{ fontSize: ms(8), fontWeight: '500', color: c.textOnPrimary, opacity: 0.85 }}>{driver?.driver_code || '-'}</Text>
            </View>
          </View>
        )}

        {/* ─── CONTENT ─── */}
        <ScrollView
          style={styles.scroll}
          contentContainerStyle={[
            styles.scrollInner,
            { gap: 0, flexGrow: 1 },
            lt ? { padding: ls(12), paddingLeft: Math.max(ls(14), insets.left + ls(6)), paddingRight: Math.max(ls(14), insets.right + ls(6)), paddingBottom: Math.max(ls(12), insets.bottom) } : L ? { padding: 8, paddingLeft: Math.max(8, insets.left + 4), paddingRight: 8, paddingBottom: Math.max(8, insets.bottom) } : isTablet ? { padding: 16, paddingLeft: Math.max(18, insets.left + 8), paddingRight: Math.max(18, insets.right + 8), paddingBottom: Math.max(16, insets.bottom) } : { paddingTop: wp(4), paddingBottom: Math.max(wp(4), insets.bottom), paddingLeft: Math.max(wp(10), insets.left + wp(4)), paddingRight: Math.max(wp(10), insets.right + wp(4)) },
          ]}
          showsVerticalScrollIndicator={false}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={c.primary} colors={[c.primary]} />}>

          <View style={[{ flex: 1 }, isTablet && !L && { maxWidth: 960, alignSelf: 'center', width: '100%' }]}>

            {/* ── Landscape: KPI row + ticket chips row ── */}
            {isLandscape ? (
              <FadeCard delay={0} style={[cs.card, { marginBottom: lt ? ls(8) : 4, padding: lt ? ls(8) : 6 }]}>
                {/* KPI items + status badges */}
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: lt ? ls(8) : 5 }}>
                  {[
                    { icon: 'receipt-long', val: currentTicket?.ticket_code || '-', label: t('dashboard.ticket'), color: c.primary },
                    { icon: 'tag', val: currentTicket?.order_code || '-', label: t('dashboard.order'), color: c.primaryDark },
                  ].map((kpi, i, arr) => (
                    <React.Fragment key={kpi.label}>
                      <View style={{ flexDirection: 'row', alignItems: 'center', gap: lt ? ls(6) : 5, paddingVertical: lt ? ls(5) : 4, paddingHorizontal: lt ? ls(6) : 4 }}>
                        <MaterialIcons name={kpi.icon as any} size={lt ? ls(17) : 15} color={kpi.color} />
                        <View style={{ flexShrink: 1 }}>
                          <Text style={{ fontSize: ms(13), fontWeight: '800', color: c.textPrimary }} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.7}>{kpi.val}</Text>
                          <Text style={{ fontSize: ms(11), fontWeight: '600', color: c.textMuted, letterSpacing: 0.3, marginTop: ls(2) }}>{kpi.label}</Text>
                        </View>
                      </View>
                      {i < arr.length - 1 && <View style={{ width: StyleSheet.hairlineWidth, height: lt ? ls(26) : 22, backgroundColor: c.border }} />}
                    </React.Fragment>
                  ))}
                  <View style={{ flex: 1 }} />
                  <View style={{ alignItems: 'flex-end', gap: lt ? ls(4) : 3 }}>
                    <View style={{ flexDirection: 'row', alignItems: 'center', gap: lt ? ls(5) : 4 }}>
                      {currentTicket != null && (() => {
                        const status = getTicketStatus(currentTicket, detail);
                        const isCompleted = status.type === 'completed';
                        const isActive = status.type === 'active';
                        const isVoided = status.type === 'voided';
                        return (
                          <View style={{ flexDirection: 'row', alignItems: 'center', backgroundColor: isVoided ? c.error : isCompleted ? c.primarySurface : isActive ? '#FFFF00' : c.warningSurface, paddingVertical: lt ? ls(6) : 5, paddingHorizontal: lt ? ls(10) : 8, borderRadius: lt ? ls(10) : 8, gap: lt ? ls(5) : 4 }}>
                            {isActive && <View style={{ width: lt ? ls(7) : 6, height: lt ? ls(7) : 6, borderRadius: 4, backgroundColor: '#000' }} />}
                            <Text style={{ fontWeight: '600', fontSize: ms(13), color: isVoided ? '#fff' : isCompleted ? c.primary : isActive ? '#000' : c.warningDark }}>{t(status.key)}</Text>
                          </View>
                        );
                      })()}
                      {currentTicket != null && (
                        <View style={{ flexDirection: 'row', alignItems: 'center', backgroundColor: c.error, paddingVertical: lt ? ls(6) : 5, paddingHorizontal: lt ? ls(10) : 8, borderRadius: lt ? ls(10) : 8, gap: lt ? ls(5) : 4 }}>
                          <Text style={{ fontWeight: '600', fontSize: ms(13), color: '#fff' }}>{PAYMENT_MAP[currentTicket.payment_form] || t('dashboard.onAccount')}</Text>
                        </View>
                      )}
                    </View>
                    {dateFrom ? (
                      <Text style={{ fontSize: ms(11), fontWeight: '600', color: c.textSecondary }}>{dateFrom}</Text>
                    ) : null}
                  </View>
                </View>

              </FadeCard>
            ) : (
              <>
                {/* Portrait: KPI + Status bar */}
                <FadeCard delay={0} style={[cs.card, { padding: wp(6), marginBottom: wp(3) }]}>
                  <View style={styles.kpiRow}>
                    {[
                      { icon: 'receipt-long', val: currentTicket?.ticket_code || '-', label: t('dashboard.ticket'), color: c.primary },
                      { icon: 'tag', val: currentTicket?.order_code || '-', label: t('dashboard.order'), color: c.primaryDark },
                    ].map((kpi, i, arr) => (
                      <React.Fragment key={kpi.label}>
                        <View style={styles.kpiItem}>
                          <View style={[styles.kpiIconWrap, { backgroundColor: c.primarySurface }]}>
                            <MaterialIcons name={kpi.icon as any} size={ms(14)} color={kpi.color} />
                          </View>
                          <View>
                            <Text style={[styles.kpiVal, { color: c.textPrimary }]}>{kpi.val}</Text>
                            <Text style={[styles.kpiLabel, { color: c.textMuted }]}>{kpi.label}</Text>
                          </View>
                        </View>
                        {i < arr.length - 1 && <View style={[styles.kpiDivider, { backgroundColor: c.border }]} />}
                      </React.Fragment>
                    ))}
                  </View>
                  <View style={[styles.chipRow, { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: c.borderLight, marginTop: wp(4), paddingTop: wp(4) }]}>
                    {currentTicket != null && (() => {
                      const status = getTicketStatus(currentTicket, detail);
                      const isCompleted = status.type === 'completed';
                      const isActive = status.type === 'active';
                      const isVoided = status.type === 'voided';
                      return (
                        <View style={[styles.statusChip, { backgroundColor: isVoided ? c.error : isCompleted ? c.primarySurface : isActive ? '#FFFF00' : c.warningSurface }]}>
                          {isActive && <View style={[styles.chipDot, { backgroundColor: '#000' }]} />}
                          <Text style={[styles.chipLabel, { color: isVoided ? '#fff' : isCompleted ? c.primary : isActive ? '#000' : c.warningDark }]}>{t(status.key)}</Text>
                        </View>
                      );
                    })()}
                    {currentTicket != null && (
                      <View style={[styles.statusChip, { backgroundColor: c.error }]}>
                        <Text style={[styles.chipLabel, { color: '#fff' }]}>{PAYMENT_MAP[currentTicket.payment_form] || t('dashboard.onAccount')}</Text>
                      </View>
                    )}
                    {dateFrom ? (
                      <>
                        <View style={{ flex: 1 }} />
                        <Text style={{ fontSize: ms(11), fontWeight: '600', color: c.textSecondary }}>{dateFrom}</Text>
                      </>
                    ) : null}
                  </View>
                </FadeCard>
              </>
            )}

            {/* Detail loading indicator */}
            {detailLoading && (
              <View style={{ paddingVertical: wp(12), alignItems: 'center' }}>
                <ActivityIndicator size="small" color={c.primary} />
              </View>
            )}

            {/* Delivery Progress */}
            {!detailLoading && <FadeCard delay={120} style={[cs.card, L && { padding: lt ? ls(8) : 6 }, { marginBottom: lt ? ls(8) : L ? 4 : wp(3) }]}>
              <View style={[styles.secHeader, { borderBottomColor: c.borderLight, marginBottom: wp(2), paddingBottom: wp(2) }, L && { marginBottom: lt ? ls(3) : 2, paddingBottom: lt ? ls(3) : 2, gap: lt ? ls(5) : 4 }]}>
                <View style={[styles.secIcon, { backgroundColor: c.primary }, L && { width: lt ? ls(22) : 18, height: lt ? ls(22) : 18, borderRadius: lt ? ls(7) : 6 }]}>
                  <MaterialIcons name="timeline" size={lt ? ls(13) : L ? 11 : ms(13)} color={c.textOnPrimary} />
                </View>
                <Text style={[styles.secTitle, { color: c.textPrimary, fontSize: ms(10) }]}>{t('dashboard.deliveryProgress')}</Text>
                <View style={[styles.countBadge, { backgroundColor: c.primarySurface, borderColor: c.primaryBorder }, L && { paddingHorizontal: lt ? ls(7) : 5, paddingVertical: lt ? ls(2) : 1, borderRadius: lt ? ls(6) : 5 }]}>
                  <Text style={[styles.countText, { color: c.primary, fontSize: ms(9) }]}>{doneCount}/{timeline.length}</Text>
                </View>
              </View>

              {/* Steps */}
              {L ? (
                <View style={{ flexDirection: 'row', alignItems: 'flex-start', paddingTop: ls(1), paddingBottom: ls(1), marginHorizontal: ls(4) }}>
                  {timeline.map((item, i) => {
                    const isActive = item.done && (i === timeline.length - 1 || !timeline[i + 1].done);
                    const isFirst = i === 0;
                    const isLast = i === timeline.length - 1;
                    const dotSz = lt ? (isActive ? ls(14) : ls(10)) : (isActive ? 12 : 9);
                    const lineDone = item.done && !isLast && timeline[i + 1]?.done;
                    const rowH = lt ? ls(16) : 12;
                    return (
                      <View key={item.labelKey} style={{ alignItems: 'center', flex: 1 }}>
                        <View style={{ flexDirection: 'row', alignItems: 'center', height: rowH, width: '100%' }}>
                          {isFirst
                            ? <View style={{ flex: 1 }} />
                            : <View style={{ flex: 1, height: ls(1.5), backgroundColor: item.done ? c.primary : c.border, borderRadius: 1 }} />}
                          <View style={{
                            width: dotSz, height: dotSz, borderRadius: dotSz / 2,
                            justifyContent: 'center', alignItems: 'center',
                            backgroundColor: item.done ? c.primary : c.surface,
                            borderWidth: isActive ? 2 : 1,
                            borderColor: isActive ? c.primaryMuted : item.done ? c.primary : c.border,
                          }}>
                            {item.done && <MaterialIcons name="check" size={lt ? (isActive ? ls(8) : ls(6)) : (isActive ? 7 : 5)} color={c.textOnPrimary} />}
                          </View>
                          {isLast
                            ? <View style={{ flex: 1 }} />
                            : <View style={{ flex: 1, height: ls(1.5), backgroundColor: lineDone ? c.primary : c.border, borderRadius: 1 }} />}
                        </View>
                        <Text style={{ fontSize: ms(9), fontWeight: isActive ? '800' : '600', color: isActive ? c.primary : item.done ? c.textSecondary : c.textMuted, textAlign: 'center', marginTop: ls(1) }} numberOfLines={1}>
                          {t(item.labelKey)}
                        </Text>
                        <Text style={{ fontSize: ms(10), fontWeight: '800', color: isActive ? c.primaryDark : item.done ? c.primary : c.border, textAlign: 'center', marginTop: ls(1) }}>
                          {item.time}
                        </Text>
                      </View>
                    );
                  })}
                </View>
              ) : (
                <View style={{ flexDirection: 'row', alignItems: 'flex-start', paddingHorizontal: wp(2), paddingTop: wp(1), paddingBottom: wp(1) }}>
                  {timeline.map((item, i) => {
                    const isActive = item.done && (i === timeline.length - 1 || !timeline[i + 1].done);
                    const isFirst = i === 0;
                    const isLast = i === timeline.length - 1;
                    const dotSz = isActive ? wp(10) : wp(7);
                    const lineDone = item.done && !isLast && timeline[i + 1]?.done;
                    return (
                      <View key={item.labelKey} style={{ alignItems: 'center', flex: 1 }}>
                        <View style={{ flexDirection: 'row', alignItems: 'center', height: wp(12), width: '100%' }}>
                          {isFirst
                            ? <View style={{ flex: 1 }} />
                            : <View style={{ flex: 1, height: 1.5, backgroundColor: item.done ? c.primary : c.border, borderRadius: 1 }} />}
                          <View style={{
                            width: dotSz, height: dotSz, borderRadius: dotSz / 2,
                            justifyContent: 'center', alignItems: 'center',
                            backgroundColor: item.done ? c.primary : c.surface,
                            borderWidth: isActive ? 1.5 : 1,
                            borderColor: isActive ? c.primaryMuted : item.done ? c.primary : c.border,
                          }}>
                            {item.done && <MaterialIcons name="check" size={isActive ? ms(6) : ms(4)} color={c.textOnPrimary} />}
                          </View>
                          {isLast
                            ? <View style={{ flex: 1 }} />
                            : <View style={{ flex: 1, height: 1.5, backgroundColor: lineDone ? c.primary : c.border, borderRadius: 1 }} />}
                        </View>
                        <Text style={{ fontSize: ms(9), fontWeight: isActive ? '800' : '600', color: isActive ? c.primary : item.done ? c.textSecondary : c.textMuted, textAlign: 'center', marginTop: 1 }} numberOfLines={1}>
                          {t(item.labelKey)}
                        </Text>
                        <Text style={{ fontSize: ms(10), fontWeight: '800', color: isActive ? c.primaryDark : item.done ? c.primary : c.border, textAlign: 'center' }}>
                          {item.time}
                        </Text>
                      </View>
                    );
                  })}
                </View>
              )}
            </FadeCard>}

            {/* Job + Mix Cards — table layout: each row is a shared flex parent so heights auto-sync */}
            {!detailLoading && (() => {
              const gap = lt ? ls(8) : L ? 5 : wp(3);
              const pad = lt ? ls(10) : L ? 6 : wp(6);
              const radius = cs.card.borderRadius;
              const bw = StyleSheet.hairlineWidth;
              const bc = c.border;
              const cellBase = { flex: 1, paddingHorizontal: pad, borderLeftWidth: bw, borderRightWidth: bw, borderColor: bc };
              return (
                <FadeCard delay={200}>
                  {/* Card headers */}
                  <View style={{ flexDirection: 'row', gap }}>
                    <View style={[cs.card, { flex: 1, borderBottomLeftRadius: 0, borderBottomRightRadius: 0, borderBottomWidth: 0 }]}>
                      <View style={[styles.secHeader, { marginBottom: 0, borderBottomWidth: 0, paddingBottom: lt ? ls(3) : L ? 2 : wp(2), gap: lt ? ls(5) : L ? 4 : wp(4) }]}>
                        <MaterialIcons name="work" size={lt ? ls(16) : L ? 14 : ms(14)} color={c.accent} />
                        <Text style={[styles.secTitle, { color: c.textPrimary }]}>{t('dashboard.jobDetails')}</Text>
                      </View>
                    </View>
                    <View style={[cs.card, { flex: 1, backgroundColor: c.primarySurface, borderBottomLeftRadius: 0, borderBottomRightRadius: 0, borderBottomWidth: 0 }]}>
                      <View style={[styles.secHeader, { marginBottom: 0, borderBottomWidth: 0, paddingBottom: lt ? ls(3) : L ? 2 : wp(2), gap: lt ? ls(5) : L ? 4 : wp(4) }]}>
                        <MaterialIcons name="science" size={lt ? ls(16) : L ? 14 : ms(14)} color={c.primary} />
                        <Text style={[styles.secTitle, { color: c.textPrimary }]}>{t('dashboard.mixDetails')}</Text>
                      </View>
                    </View>
                  </View>
                  {/* Synchronized data rows */}
                  {Array.from({ length: pairedRows }).map((_, i) => {
                    const jobItem = jobInfo[i];
                    const mixItem = mixInfo[i];
                    const isLast = i === pairedRows - 1;
                    return (
                      <View key={i} style={{ flexDirection: 'row', gap }}>
                        {/* Job cell */}
                        <View style={[cellBase, { backgroundColor: c.white }, isLast && { borderBottomWidth: bw, borderBottomLeftRadius: radius, borderBottomRightRadius: radius, overflow: 'hidden' }]}>
                          {jobItem ? (
                            <View style={[styles.detailRow, { paddingVertical: lt ? ls(6) : L ? 4 : wp(4) }, !isLast && { borderBottomWidth: bw, borderBottomColor: c.borderLight }]}>
                              <Text style={[styles.detailLabel, { color: c.textMuted, width: '28%' }]} numberOfLines={1}>{t(jobItem.labelKey)}</Text>
                              {jobItem.isMap ? (
                                <TouchableOpacity activeOpacity={0.6} onPress={() => {
                                  if (currentTicket?.at_plant_time != null) {
                                    setDirectionsAlert(true);
                                  } else {
                                    navigation.navigate('DeliveredToMap', { delivery: detail?.location?.delivery || detail?.location?.plant || detail?.location?.truck, address: jobItem.value });
                                  }
                                }} style={common.flex1}>
                                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: ls(4) }}>
                                    <Text style={[styles.detailValue, { color: c.accent, flex: 1 }]} numberOfLines={2}>{jobItem.value}</Text>
                                    <MaterialIcons name="map" size={L ? ls(14) : 16} color={c.accent} />
                                  </View>
                                </TouchableOpacity>
                              ) : jobItem.isHighlight ? (
                                <View style={[styles.slumpPillInline, { backgroundColor: '#FFFF00', borderColor: '#FFFF00', flex: 1, flexShrink: 1 }]}>
                                  <Text style={{ fontSize: ms(9), fontWeight: '800', color: '#000' }}>{jobItem.value}</Text>
                                </View>
                              ) : (
                                <Text style={[styles.detailValue, common.flex1, { color: jobItem.isLink ? c.accent : c.textPrimary }]} numberOfLines={2}>{jobItem.value}</Text>
                              )}
                            </View>
                          ) : <View style={[styles.detailRow, { paddingVertical: lt ? ls(6) : L ? 4 : wp(4) }]} />}
                        </View>
                        {/* Mix cell */}
                        <View style={[cellBase, { backgroundColor: c.primarySurface }, isLast && { borderBottomWidth: bw, borderBottomLeftRadius: radius, borderBottomRightRadius: radius, overflow: 'hidden' }]}>
                          {mixItem ? (
                            <View style={[styles.detailRow, { paddingVertical: lt ? ls(6) : L ? 4 : wp(4) }, !isLast && { borderBottomWidth: bw, borderBottomColor: c.primaryMuted }]}>
                              <Text style={[styles.detailLabel, { color: c.textMuted, width: '28%' }]} numberOfLines={1}>{t(mixItem.labelKey)}</Text>
                              {mixItem.isHighlight ? (
                                <View style={[styles.slumpPillInline, { backgroundColor: '#FFFF00', borderColor: '#FFFF00', flexShrink: 1 }]}>
                                  <Text style={{ fontSize: ms(9), fontWeight: '800', color: '#000' }}>{mixItem.value}</Text>
                                </View>
                              ) : mixItem.isTruckBehind ? (
                                <TouchableOpacity activeOpacity={0.6} onPress={() => navigation.navigate('Map', { mapItems: [...(detail?.location?.truck ? [{ type: 'My Truck', value: `${detail.ticket.truck_code} ${detail.ticket.status_label}`, latitude: detail.location.truck.lat, longitude: detail.location.truck.lng, status: detail.ticket.status_label, is_current: true, directions: true }] : []), ...(detail?.map || [])].sort((a, b) => { const order: Record<string, number> = { 'Plant': 0, 'My Truck': 1, 'Truck Ahead': 2, 'Truck Behind': 3, 'Job Site': 4 }; return (order[a.type] ?? 5) - (order[b.type] ?? 5); }), delivery: detail?.location?.delivery, plant: detail?.location?.plant, truck: detail?.location?.truck, address: detail?.job?.delivered_to || '', plantName: currentTicket?.plant_name || '' })} style={common.flex1}>
                                  <Text style={[styles.detailValue, { color: c.accent }]} numberOfLines={2}>{mixItem.value}</Text>
                                </TouchableOpacity>
                              ) : mixItem.isLink ? (
                                <TouchableOpacity activeOpacity={0.6} onPress={() => setProductsVisible(true)} style={common.flex1}>
                                  <Text style={[styles.detailValue, { color: c.accent }]} numberOfLines={2}>{mixItem.value}</Text>
                                </TouchableOpacity>
                              ) : (
                                <Text style={[styles.detailValue, common.flex1, { color: mixItem.valueColor === 'accent' ? c.accent : c.textPrimary }]} numberOfLines={2}>{mixItem.value}</Text>
                              )}
                            </View>
                          ) : <View style={[styles.detailRow, { paddingVertical: lt ? ls(6) : L ? 4 : wp(4) }]} />}
                        </View>
                      </View>
                    );
                  })}
                </FadeCard>
              );
            })()}
          </View>
        </ScrollView>

      </View>{/* end main content column */}

      {/* ─── NAV BAR ─── */}
      {L ? (
        <View style={{
          width: (lp ? 72 : ls(76)) + insets.right,
          paddingRight: insets.right,
          paddingTop: insets.top + (lp ? 8 : ls(10)),
          paddingBottom: Math.max(insets.bottom, lp ? 8 : ls(16)),
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
          shadowOffset: { width: 0, height: -2 },
          shadowOpacity: 0.04,
          shadowRadius: 4,
        }}>
          {BOTTOM_ACTIONS.map(renderNavBtn)}
        </View>
      )}

      {/* ─── DROPDOWN MENU ─── */}
      {menuVisible && (
        <View style={StyleSheet.absoluteFill} pointerEvents="box-none">
          <Pressable style={[styles.dropdownOverlay, { backgroundColor: c.overlayDropdown }]} onPress={closeMenu} />
          <Animated.View
            style={[
              styles.dropdown,
              {
                backgroundColor: c.white,
                top: insets.top + (isLandscape ? wp(40) : wp(58)),
                right: Math.max(wp(16), insets.right + wp(4)),
                maxHeight: isLandscape ? winHeight - insets.top - insets.bottom - wp(50) : undefined,
                borderColor: c.border,
                opacity: menuOpacity,
                transform: [
                  { scale: menuScale.interpolate({ inputRange: [0, 1], outputRange: [0.85, 1] }) },
                  { translateY: menuScale.interpolate({ inputRange: [0, 1], outputRange: [-10, 0] }) },
                ],
              },
            ]}>
            {/* Menu Items */}
            <ScrollView bounces={false} showsVerticalScrollIndicator={false}>
              {menuItems.map((item, i) => {
                const isWarn = item.color === 'warn';
                const iconColor = isWarn ? c.error : c.textSecondary;
                const labelColor = isWarn ? c.error : c.textPrimary;
                const bgColor = isWarn ? c.errorSurface : c.surface;
                const isDarkMode = item.actionKey === 'DarkMode';
                const itemIcon = isDarkMode ? (isDark ? 'light-mode' : 'dark-mode') : item.icon;
                const label = isDarkMode ? (isDark ? t('menu.lightMode', 'Light Mode') : t('menu.darkMode', 'Dark Mode')) : t(item.labelKey);
                const suffix = item.actionKey === 'Language' ? ` (${i18n.language.toUpperCase()})` : '';
                return (
                  <TouchableOpacity
                    key={item.actionKey}
                    style={[
                      styles.ddItem,
                      isLandscape && { paddingVertical: lp ? 10 : ls(16), paddingHorizontal: lp ? 12 : ls(12), minHeight: lp ? 44 : ls(50), gap: lp ? 8 : ls(8) },
                      i < menuItems.length - 1 && { borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: c.borderLight },
                    ]}
                    activeOpacity={0.6}
                    onPress={() => handleMenuItemPress(item.actionKey)}>
                    <View style={[styles.ddIcon, isLandscape && { width: lp ? 28 : ls(24), height: lp ? 28 : ls(24), borderRadius: lp ? 8 : ls(7) }, { backgroundColor: bgColor }]}>
                      <MaterialIcons name={itemIcon as any} size={isLandscape ? (lp ? 18 : ls(14)) : ms(18)} color={iconColor} />
                    </View>
                    <Text style={[styles.ddLabel, isLandscape && { fontSize: ms(13) }, { color: labelColor }]}>{label}{suffix}</Text>
                    <MaterialIcons name="chevron-right" size={isLandscape ? (lp ? 18 : ls(16)) : ms(18)} color={c.textMuted} />
                  </TouchableOpacity>
                );
              })}
            </ScrollView>

            {/* Version footer */}
            <View style={[styles.ddFooter, isLandscape && { paddingVertical: lp ? 6 : ls(4) }, { borderTopColor: c.borderLight }]}>
              <Text style={[styles.ddVersion, { color: c.textMuted }]}>v1.20.0</Text>
            </View>
          </Animated.View>
        </View>
      )}

      {/* ─── QR CODE MODAL ─── */}
      <ResponsiveModal
        visible={qrVisible}
        onClose={() => setQrVisible(false)}
        maxWidth={L ? (lt ? 440 : 380) : isTablet ? 440 : 380}
        widthPercent={L ? (lt ? 50 : 70) : isTablet ? 55 : 85}
        maxHeightPercent={L ? 95 : 80}>
        <View style={{ backgroundColor: c.qrBg }}>
          {/* Header */}
          <View style={[styles.qrHeader, { borderBottomColor: c.qrFg + '15' }, L && { paddingVertical: lt ? ls(6) : 6, paddingHorizontal: lt ? ls(10) : 10, gap: lt ? ls(6) : 6 }]}>
            <View style={[styles.qrHeaderIcon, { backgroundColor: c.qrFg + '18' }, L && { width: lt ? ls(26) : 24, height: lt ? ls(26) : 24, borderRadius: lt ? ls(7) : 7 }]}>
              <MaterialIcons name="qr-code-2" size={L ? (lt ? ls(16) : 15) : ms(18)} color={c.qrFg} />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={[styles.qrHeaderTitle, { color: c.qrFg }]}>QR Code</Text>
              <Text style={[styles.qrHeaderSub, { color: c.qrFg + '90' }, L && { fontSize: lp ? ms(8) : ms(9) }]}>Scan to verify delivery</Text>
            </View>
            <TouchableOpacity style={[styles.mCloseBtn, { backgroundColor: c.qrFg + '12' }]} onPress={() => setQrVisible(false)} activeOpacity={0.7} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
              <MaterialIcons name="close" size={ms(18)} color={c.qrFg} />
            </TouchableOpacity>
          </View>

          {qrLoading ? (
            <View style={{ paddingVertical: wp(40), alignItems: 'center' }}>
              <ActivityIndicator size="large" color={c.qrFg} />
            </View>
          ) : qrError ? (
            <View style={{ paddingVertical: wp(30), alignItems: 'center', paddingHorizontal: wp(20) }}>
              <MaterialIcons name="error-outline" size={ms(36)} color={c.qrFg + '60'} />
              <Text style={{ fontSize: ms(13), fontWeight: '700', color: c.qrFg, marginTop: wp(10), textAlign: 'center' }}>Server Error</Text>
              <Text style={{ fontSize: ms(11), color: c.qrFg + '80', marginTop: wp(4), textAlign: 'center' }}>Unable to load QR code. Please try again later.</Text>
              <TouchableOpacity
                onPress={() => {
                  if (!currentTicket) return;
                  setQrLoading(true);
                  setQrError(false);
                  ticketsApi.getQr(currentTicket.id)
                    .then(res => { if (res.data) setQrData(res.data); })
                    .catch(() => { setQrError(true); })
                    .finally(() => setQrLoading(false));
                }}
                activeOpacity={0.7}
                style={{ flexDirection: 'row', alignItems: 'center', gap: wp(5), marginTop: wp(16), backgroundColor: c.qrFg + '18', paddingVertical: wp(8), paddingHorizontal: wp(20), borderRadius: wp(8) }}>
                <MaterialIcons name="refresh" size={ms(14)} color={c.qrFg} />
                <Text style={{ fontSize: ms(11), fontWeight: '700', color: c.qrFg }}>Retry</Text>
              </TouchableOpacity>
            </View>
          ) : qrData ? (
            <ScrollView
              bounces={false}
              showsVerticalScrollIndicator={false}
              contentContainerStyle={{ alignItems: 'center', paddingVertical: wp(6) }}>
              <View style={styles.qrChipRow}>
                <View style={[styles.qrChip, { backgroundColor: c.qrFg + '12' }]}>
                  <Text style={[styles.qrChipLabel, { color: c.qrFg + '80' }]}>ORDER</Text>
                  <Text style={[styles.qrChipValue, { color: c.qrFg }]}>{qrData.order_code || '-'}</Text>
                </View>
                <View style={[styles.qrChip, { backgroundColor: c.qrFg + '12' }]}>
                  <Text style={[styles.qrChipLabel, { color: c.qrFg + '80' }]}>TICKET</Text>
                  <Text style={[styles.qrChipValue, { color: c.qrFg }]}>{qrData.ticket_code || '-'}</Text>
                </View>
              </View>
              <View style={styles.qrCodeSection}>
                <View style={[styles.qrCodeCard, { backgroundColor: c.white, shadowColor: c.shadowColor }]}>
                  <QRCode
                    value={qrData.qr_token}
                    size={Math.round(Math.min(Math.max((width - insets.left - insets.right) * 0.45, 150), isTablet ? 260 : 200))}
                    backgroundColor={c.white}
                    color={c.qrFg}
                  />
                </View>
              </View>
              <View style={styles.qrFooter}>
                <View style={[styles.qrFooterRow, { borderTopColor: c.qrFg + '12' }]}>
                  <MaterialIcons name="local-shipping" size={ms(12)} color={c.qrFg + '70'} />
                  <Text style={[styles.qrFooterText, { color: c.qrFg + '70' }]}>{`TRUCK ${qrData.truck_code || '-'} · DRIVER ${qrData.driver_code || '-'}`}</Text>
                </View>
                <View style={styles.qrFooterRow}>
                  <MaterialIcons name="factory" size={ms(12)} color={c.qrFg + '70'} />
                  <Text style={[styles.qrFooterText, { color: c.qrFg + '70' }]}>{qrData.plant_name || '-'}</Text>
                </View>
              </View>
            </ScrollView>
          ) : null}
        </View>
      </ResponsiveModal>

      {/* ─── PLANTS LIST MODAL ─── */}
      <ResponsiveModal
        visible={plantsVisible}
        onClose={() => setPlantsVisible(false)}
        maxWidth={450}
        maxHeightPercent={70}>
        <View style={[styles.mHeader, { borderBottomColor: c.border }]}>
          <Text style={[styles.mHeaderTitle, { color: c.textPrimary }]}>{t('modals.plants')}</Text>
          <TouchableOpacity style={[styles.mCloseBtn, { backgroundColor: c.surface }]} onPress={() => setPlantsVisible(false)} activeOpacity={0.7} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
            <MaterialIcons name="close" size={ms(20)} color={c.textSecondary} />
          </TouchableOpacity>
        </View>
        {plantsLoading ? (
          <View style={{paddingVertical: wp(40), alignItems: 'center'}}>
            <ActivityIndicator size="large" color={c.primary} />
          </View>
        ) : plantsError ? (
          <View style={{ paddingVertical: wp(30), alignItems: 'center', paddingHorizontal: wp(20) }}>
            <MaterialIcons name="error-outline" size={ms(36)} color={c.textSecondary} />
            <Text style={{ fontSize: ms(13), fontWeight: '700', color: c.textPrimary, marginTop: wp(10), textAlign: 'center' }}>Server Error</Text>
            <Text style={{ fontSize: ms(11), color: c.textSecondary, marginTop: wp(4), textAlign: 'center' }}>Unable to load plants. Please try again later.</Text>
            <TouchableOpacity
              onPress={() => {
                setPlantsLoading(true);
                setPlantsError(false);
                setPlantsList([]);
                setPlantsPage(1);
                setPlantsHasNext(false);
                plantsApi.getAll(1)
                  .then(res => { if (res.data?.plants) { setPlantsList(res.data.plants); setPlantsHasNext(res.data.has_next); plantsHasNextRef.current = res.data.has_next; setPlantsPage(1); plantsPageRef.current = 1; } })
                  .catch(() => { setPlantsError(true); })
                  .finally(() => setPlantsLoading(false));
              }}
              activeOpacity={0.7}
              style={{ flexDirection: 'row', alignItems: 'center', gap: wp(5), marginTop: wp(16), backgroundColor: c.primary, paddingVertical: wp(8), paddingHorizontal: wp(20), borderRadius: wp(8) }}>
              <MaterialIcons name="refresh" size={ms(14)} color="#fff" />
              <Text style={{ fontSize: ms(11), fontWeight: '700', color: '#fff' }}>Retry</Text>
            </TouchableOpacity>
          </View>
        ) : (
          <ScrollView
            style={styles.plantsList}
            showsVerticalScrollIndicator={true}
            bounces={false}
            onMomentumScrollEnd={handlePlantsScrollEnd}
            onScrollEndDrag={handlePlantsScrollEnd}
            scrollEventThrottle={400}
            onLayout={({nativeEvent}) => { plantsLayoutH.current = nativeEvent.layout.height; checkPlantsAutoLoad(); }}
            onContentSizeChange={(_w, h) => { plantsContentH.current = h; checkPlantsAutoLoad(); }}>
            {plantsList.map(plant => (
              <TouchableOpacity
                key={plant.id}
                style={[styles.plantItem, { borderBottomColor: c.borderLight }]}
                activeOpacity={0.6}
                onPress={() => setPlantsVisible(false)}>
                <Text style={[styles.plantText, { color: c.textPrimary }]}>{plant.code}-{plant.name}</Text>
              </TouchableOpacity>
            ))}
            {plantsLoadingMore && (
              <View style={{paddingVertical: wp(12), alignItems: 'center'}}>
                <ActivityIndicator size="small" color={c.primary} />
              </View>
            )}
          </ScrollView>
        )}
      </ResponsiveModal>

      {/* ─── VEHICLE MODAL ─── */}
      <ResponsiveModal
        visible={vehicleVisible}
        onClose={() => setVehicleVisible(false)}
        maxWidth={isTablet ? 500 : 420}
        widthPercent={isTablet ? 60 : 85}
        maxHeightPercent={60}>
        <View style={[styles.mHeader, { borderBottomColor: c.border }]}>
          <Text style={[styles.mHeaderTitle, { color: c.textPrimary }]}>{t('modals.vehicle', 'Vehicle')}</Text>
          <TouchableOpacity style={[styles.mCloseBtn, { backgroundColor: c.surface }]} onPress={() => setVehicleVisible(false)} activeOpacity={0.7} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
            <MaterialIcons name="close" size={ms(20)} color={c.textSecondary} />
          </TouchableOpacity>
        </View>
        <View style={{ alignItems: 'center', paddingVertical: wp(30), paddingHorizontal: wp(20) }}>
          <Text style={{ fontSize: ms(10), fontWeight: '800', color: c.textPrimary, letterSpacing: 1, textTransform: 'uppercase' }}>CURRENT VEHICLE ID</Text>
          <Text style={{ fontSize: ms(13), fontWeight: '700', color: c.textPrimary, marginTop: 8 }}>{driver?.truck_code || '-'}</Text>

          <View style={{ marginTop: wp(30), alignItems: 'center' }}>
            <Text style={{ fontSize: ms(10), fontWeight: '800', color: c.textPrimary, letterSpacing: 1, textTransform: 'uppercase' }}>BROADCASTING STATUS</Text>
            <Text style={{ fontSize: ms(10), fontWeight: '500', color: c.textSecondary, marginTop: 8 }}>
              {isBroadcasting ? 'BROADCASTING' : 'NOT BROADCASTING'}
            </Text>
            <TouchableOpacity
              style={{
                backgroundColor: isBroadcasting ? '#EF4444' : '#15803d',
                paddingVertical: 14,
                paddingHorizontal: 40,
                borderRadius: 8,
                marginTop: 16,
                minWidth: 200,
                alignItems: 'center',
              }}
              activeOpacity={0.8}
              onPress={() => setIsBroadcasting(b => !b)}>
              <Text style={{ fontSize: ms(10), fontWeight: '700', color: '#fff', letterSpacing: 0.5 }}>
                {isBroadcasting ? 'TURN OFF' : 'TURN ON'}
              </Text>
            </TouchableOpacity>
          </View>
        </View>
      </ResponsiveModal>

      {/* ─── EDIT TICKET MODAL ─── */}
      <ResponsiveModal
        visible={editVisible}
        onClose={() => setEditVisible(false)}
        maxWidth={isTablet ? 500 : 420}
        widthPercent={isTablet ? 70 : 85}
        maxHeightPercent={80}>

        {/* Header */}
        <View style={[styles.etHeader, { borderBottomColor: c.border }]}>
          <View style={[styles.etHeaderIcon, { backgroundColor: c.primarySurface }]}>
            <MaterialIcons name="edit" size={ms(18)} color={c.primary} />
          </View>
          <Text style={[styles.etHeaderTitle, { color: c.textPrimary }]}>{t('modals.editTicket')}</Text>
          <TouchableOpacity style={[styles.mCloseBtn, { backgroundColor: c.surface }]} onPress={() => setEditVisible(false)} activeOpacity={0.7} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
            <MaterialIcons name="close" size={ms(20)} color={c.textSecondary} />
          </TouchableOpacity>
        </View>

        <ScrollView showsVerticalScrollIndicator={false} bounces={false}>
          {/* Actions Section */}
          <View style={styles.etSectionHdr}>
            <MaterialIcons name="touch-app" size={ms(16)} color={c.accent} />
            <Text style={[styles.etSectionTitle, { color: c.accent }]}>{t('modals.actions')}</Text>
          </View>

          {([
            { label: t('modals.signAccept'), icon: 'check-circle', screen: 'AcceptTicket', iconColor: c.success, bg: c.successSurface },
            { label: t('modals.disputeLoad'), icon: 'report-problem', screen: 'DisputeTicket', iconColor: c.error, bg: c.errorSurface },
            { label: t('modals.signCurbline'), icon: 'assignment-turned-in', screen: 'CurblineRelease', iconColor: c.warning, bg: c.warningSurface },
          ] as const).map((item, i) => (
            <TouchableOpacity
              key={item.label}
              style={[styles.etActionRow, i < 2 && { borderBottomWidth: 1, borderBottomColor: c.borderLight }]}
              activeOpacity={0.6}
              onPress={() => {
                setEditVisible(false);
                const params: Record<string, any> = { ticketId: currentTicket?.id, editable: true };
                if (currentTicket) {
                  params.ticketInfo = {
                    customer_name: detail?.job?.customer_name || currentTicket.customer_name || '',
                    customer_code: detail?.job?.customer_code || currentTicket.customer_code || '',
                    project_name: detail?.job?.project_name || currentTicket.project_name || '',
                    project_code: detail?.job?.project_code || currentTicket.project_code || '',
                    order_code: currentTicket.order_code || '',
                    ticket_code: currentTicket.ticket_code || '',
                  };
                }
                navigation.navigate(item.screen, params);
              }}>
              <View style={[styles.etActionIcon, { backgroundColor: item.bg }]}>
                <MaterialIcons name={item.icon as any} size={ms(18)} color={item.iconColor} />
              </View>
              <Text style={[styles.etActionLabel, { color: c.textPrimary }]}>{item.label}</Text>
              <MaterialIcons name="chevron-right" size={ms(18)} color={c.textMuted} />
            </TouchableOpacity>
          ))}

          <View style={{ height: wp(16) }} />
        </ScrollView>
      </ResponsiveModal>

      {/* ─── PRODUCTS MODAL ─── */}
      <ResponsiveModal
        visible={productsVisible}
        onClose={() => setProductsVisible(false)}
        maxWidth={560}
        maxHeightPercent={75}>
        <View style={[styles.pmHeader, { backgroundColor: c.primarySurface, borderBottomColor: c.primaryBorder }]}>
          <View style={[styles.pmHeaderIcon, { backgroundColor: c.primary }]}>
            <MaterialIcons name="inventory-2" size={ms(16)} color={c.textOnPrimary} />
          </View>
          <View style={common.flex1}>
            <Text style={[styles.pmTitle, { color: c.textPrimary }]}>{t('productsModal.title')}</Text>
            <Text style={[styles.pmSubtitle, { color: c.textMuted }]} numberOfLines={1}>{detail?.mix?.products?.find(p => p.is_mix)?.description || t('productsModal.subtitle')}</Text>
          </View>
          <TouchableOpacity style={[styles.mCloseBtn, { backgroundColor: c.white }]} onPress={() => setProductsVisible(false)} activeOpacity={0.7} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
            <MaterialIcons name="close" size={ms(20)} color={c.textSecondary} />
          </TouchableOpacity>
        </View>
        <ScrollView showsVerticalScrollIndicator={false} bounces={false} contentContainerStyle={styles.pmBody}>
          {/* Table Header */}
          <View style={[styles.pmRow, styles.pmRowHeader, { borderBottomColor: c.textPrimary }]}>
            <Text style={[styles.pmColCode, styles.pmTh, { color: c.textPrimary }]}>{t('productsModal.code')}</Text>
            <Text style={[styles.pmColDesc, styles.pmTh, { color: c.textPrimary }]}>{t('productsModal.description')}</Text>
            <Text style={[styles.pmColQty, styles.pmTh, { color: c.textPrimary }]}>{t('productsModal.qty')}</Text>
            <Text style={[styles.pmColUnit, styles.pmTh, { color: c.textPrimary }]}>{t('productsModal.unit')}</Text>
          </View>
          {/* Table Rows */}
          {detail?.mix?.products && detail.mix.products.length > 0 ? detail.mix.products.map((product, i) => (
            <View key={`${product.code}-${i}`} style={[styles.pmRow, { borderBottomColor: c.borderLight }]}>
              <Text style={[styles.pmColCode, styles.pmTd, { color: c.textPrimary }]} numberOfLines={1}>{product.code}</Text>
              <Text style={[styles.pmColDesc, styles.pmTd, { color: c.textPrimary }]} numberOfLines={2}>{product.description}</Text>
              <Text style={[styles.pmColQty, styles.pmTd, { color: c.textPrimary }]}>{product.delivered_qty != null ? String(product.delivered_qty) : '-'}</Text>
              <Text style={[styles.pmColUnit, styles.pmTd, { color: c.textPrimary }]}>{product.delivered_unit || '-'}</Text>
            </View>
          )) : (
            <View style={{ padding: wp(16), alignItems: 'center' }}>
              <Text style={{ color: c.textMuted, fontSize: ms(10) }}>{t('productsModal.noData', 'No product data available')}</Text>
            </View>
          )}
        </ScrollView>
      </ResponsiveModal>

      {/* ─── LOGOUT CONFIRMATION MODAL ─── */}
      <ResponsiveModal
        visible={logoutType !== null}
        onClose={() => setLogoutType(null)}
        maxWidth={360}
        widthPercent={isLandscape ? 40 : 80}>
        <View style={{ padding: wp(16), alignItems: 'center' }}>
          <View style={[styles.logoutIconWrap, { backgroundColor: logoutType === 'tenant' ? c.errorSurface : c.warningSurface }]}>
            <MaterialIcons
              name={logoutType === 'tenant' ? 'domain-disabled' : 'person-off'}
              size={ms(28)}
              color={logoutType === 'tenant' ? c.error : c.warningDark}
            />
          </View>
          <Text style={[styles.logoutTitle, { color: c.textPrimary }]}>
            {logoutType === 'tenant' ? t('logout.tenantTitle') : t('logout.driverTitle')}
          </Text>
          <Text style={[styles.logoutMessage, { color: c.textSecondary }]}>
            {logoutType === 'tenant' ? t('logout.tenantMessage') : t('logout.driverMessage')}
          </Text>
          <View style={styles.logoutButtons}>
            <TouchableOpacity
              style={[styles.logoutBtn, { backgroundColor: c.surface, borderWidth: 1, borderColor: c.border }]}
              onPress={() => setLogoutType(null)}
              activeOpacity={0.7}
              disabled={loggingOut}>
              <Text style={[styles.logoutBtnText, { color: c.textPrimary }]}>{t('logout.cancel')}</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.logoutBtn, { backgroundColor: logoutType === 'tenant' ? c.error : c.warningDark }, loggingOut && { opacity: 0.7 }]}
              onPress={handleLogoutConfirm}
              activeOpacity={0.7}
              disabled={loggingOut}>
              {loggingOut ? (
                <ActivityIndicator size="small" color={c.textOnPrimary} />
              ) : (
                <Text style={[styles.logoutBtnText, { color: c.textOnPrimary }]}>{t('logout.confirm')}</Text>
              )}
            </TouchableOpacity>
          </View>
        </View>
      </ResponsiveModal>

      {/* ─── LANGUAGE SELECTION MODAL ─── */}
      <ResponsiveModal
        visible={languageVisible}
        onClose={() => setLanguageVisible(false)}
        maxWidth={360}
        widthPercent={isLandscape ? 40 : 80}>
        <View style={{ padding: wp(16), alignItems: 'center' }}>
          <TouchableOpacity style={[styles.mCloseBtn, { backgroundColor: c.surface, position: 'absolute', top: wp(10), right: wp(10), zIndex: 10 }]} onPress={() => setLanguageVisible(false)} activeOpacity={0.7} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
            <MaterialIcons name="close" size={ms(18)} color={c.textSecondary} />
          </TouchableOpacity>
          <View style={[styles.logoutIconWrap, { backgroundColor: c.primarySurface }]}>
            <MaterialIcons name="translate" size={ms(28)} color={c.primary} />
          </View>
          <Text style={[styles.logoutTitle, { color: c.textPrimary }]}>{t('menu.language')}</Text>
          <View style={{ width: '100%', gap: wp(8), marginTop: wp(4) }}>
            {[
              { code: 'en', label: 'English', flag: '🇬🇧' },
              { code: 'fr', label: 'Français', flag: '🇫🇷' },
            ].map(lang => {
              const isSelected = i18n.language === lang.code;
              return (
                <TouchableOpacity
                  key={lang.code}
                  style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: wp(8), paddingVertical: wp(10), borderRadius: wp(10), backgroundColor: isSelected ? c.primary : c.surface, borderWidth: 1, borderColor: isSelected ? c.primary : c.border }}
                  activeOpacity={0.7}
                  onPress={() => { i18n.changeLanguage(lang.code); setLanguageVisible(false); }}>
                  <Text style={{ fontSize: ms(16) }}>{lang.flag}</Text>
                  <Text style={{ fontSize: ms(12), fontWeight: '700', color: isSelected ? c.textOnPrimary : c.textPrimary }}>{lang.label}</Text>
                  {isSelected && <MaterialIcons name="check-circle" size={ms(18)} color={c.textOnPrimary} />}
                </TouchableOpacity>
              );
            })}
          </View>
        </View>
      </ResponsiveModal>

      {/* ─── MISSING FIELDS MODAL ─── */}
      <ResponsiveModal
        visible={detailsVisible}
        onClose={() => setDetailsVisible(false)}
        maxWidth={L ? (lt ? 540 : 440) : isTablet ? 540 : 420}
        widthPercent={L ? (lt ? 50 : 70) : isTablet ? 60 : 90}
        maxHeightPercent={L ? 95 : 85}>
        <View style={{ backgroundColor: c.surface }}>
          {/* Header */}
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: wp(8), padding: wp(12), borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: c.borderLight }}>
            <View style={{ width: wp(28), height: wp(28), borderRadius: wp(8), backgroundColor: c.warningSurface, justifyContent: 'center', alignItems: 'center' }}>
              <MaterialIcons name="warning" size={ms(16)} color={c.warningDark} />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={{ fontSize: ms(13), fontWeight: '800', color: c.textPrimary }}>Missing Fields</Text>
              <Text style={{ fontSize: ms(10), fontWeight: '600', color: c.textMuted }}>TICKET {deliveryRecord?.ticket?.ticket_code || '-'} / ORDER {deliveryRecord?.ticket?.order_code || '-'}</Text>
            </View>
            <TouchableOpacity style={[styles.mCloseBtn, { backgroundColor: c.surfaceAlt }]} onPress={() => setDetailsVisible(false)} activeOpacity={0.7} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
              <MaterialIcons name="close" size={ms(18)} color={c.textSecondary} />
            </TouchableOpacity>
          </View>

          <ScrollView bounces={false} showsVerticalScrollIndicator={false} contentContainerStyle={{ padding: wp(12), gap: wp(12) }}>
            {(() => {
              if (!deliveryRecord) return null;
              const missing: { section: string; icon: string; fields: string[] }[] = [];

              // Plant
              if (deliveryRecord.plant) {
                const p = deliveryRecord.plant;
                const fields: string[] = [];
                if (p.slump_from_plant == null) fields.push('Slump From Plant');
                if (p.slump_to_job == null) fields.push('Slump To Job');
                if (p.temp_at_plant == null) fields.push('Temp At Plant');
                if (p.water_added_full == null) fields.push('Water Added');
                if (!p.water_reason) fields.push('Water Reason');
                if (!p.truck_start) fields.push('Truck Start');
                if (!p.truck_end) fields.push('Truck End');
                if (p.hand_added == null) fields.push('Hand Added');
                if (p.nitrogen_added == null) fields.push('Nitrogen Added');
                if (p.fibers_added == null) fields.push('Fibers Added');
                if (p.load_tested == null) fields.push('Load Tested');
                if (!p.notes) fields.push('Notes');
                if (fields.length > 0) missing.push({ section: 'Plant', icon: 'factory', fields });
              }

              // Jobsite
              if (deliveryRecord.jobsite) {
                const j = deliveryRecord.jobsite;
                const fields: string[] = [];
                if (j.full_load_litres == null) fields.push('Full Load Litres');
                if (!j.full_load_reason) fields.push('Full Load Reason');
                if (j.full_load_mm == null) fields.push('Full Load MM');
                if (j.customer_water_litres == null) fields.push('Customer Water Litres');
                if (j.customer_water_mm == null) fields.push('Customer Water MM');
                if (j.maintenance_water_litres == null) fields.push('Maintenance Water Litres');
                if (j.maintenance_water_mm == null) fields.push('Maintenance Water MM');
                if (!j.super_plasticizer) fields.push('Super Plasticizer');
                if (!j.conveyor) fields.push('Conveyor');
                if (!j.color) fields.push('Color');
                if (!j.fiber) fields.push('Fiber');
                if (!j.other) fields.push('Other');
                if (j.conveyor_ordered_not_used == null) fields.push('Conveyor Ordered Not Used');
                if (j.unloaded_conveyor == null) fields.push('Unloaded Conveyor');
                if (j.load_disputed == null) fields.push('Load Disputed');
                if (!j.washout_area) fields.push('Washout Area');
                if (j.load_tested == null) fields.push('Load Tested');
                if (!j.notes) fields.push('Notes');
                if (fields.length > 0) missing.push({ section: 'Jobsite', icon: 'location-on', fields });
              }

              // Returned
              if (deliveryRecord.returned) {
                const r = deliveryRecord.returned;
                const fields: string[] = [];
                if (r.returned_concrete_m3 == null) fields.push('Returned Concrete');
                if (!r.disposal_method) fields.push('Disposal Method');
                if (!r.reason_for_return) fields.push('Reason For Return');
                if (fields.length > 0) missing.push({ section: 'Returned', icon: 'undo', fields });
              }

              // Time
              if (deliveryRecord.time?.steps) {
                const fields = deliveryRecord.time.steps.filter(s => !s.done).map(s => s.label);
                if (fields.length > 0) missing.push({ section: 'Time', icon: 'schedule', fields });
              }

              // COD
              if (deliveryRecord.cod) {
                const cd = deliveryRecord.cod;
                const fields: string[] = [];
                if (!cd.payment_type) fields.push('Payment Type');
                if (cd.amount == null) fields.push('Amount');
                if (cd.wait_time_minutes == null) fields.push('Wait Time');
                if (!cd.notes) fields.push('Notes');
                if (fields.length > 0) missing.push({ section: 'COD', icon: 'payments', fields });
              }

              if (missing.length === 0) {
                return (
                  <View style={{ alignItems: 'center', paddingVertical: wp(20) }}>
                    <MaterialIcons name="check-circle" size={ms(40)} color={c.primary} />
                    <Text style={{ fontSize: ms(13), fontWeight: '700', color: c.textPrimary, marginTop: wp(8) }}>All fields are filled</Text>
                  </View>
                );
              }

              return missing.map((group) => (
                <View key={group.section}>
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: wp(6), marginBottom: wp(6) }}>
                    <MaterialIcons name={group.icon as any} size={ms(14)} color={c.warningDark} />
                    <Text style={{ fontSize: ms(11), fontWeight: '800', color: c.textPrimary }}>{group.section}</Text>
                    <View style={{ backgroundColor: c.warningSurface, paddingHorizontal: wp(6), paddingVertical: wp(1), borderRadius: wp(8) }}>
                      <Text style={{ fontSize: ms(9), fontWeight: '700', color: c.warningDark }}>{group.fields.length}</Text>
                    </View>
                  </View>
                  {group.fields.map((field, idx) => (
                    <View key={idx} style={{ flexDirection: 'row', alignItems: 'center', gap: wp(6), paddingVertical: wp(4), borderBottomWidth: idx < group.fields.length - 1 ? StyleSheet.hairlineWidth : 0, borderBottomColor: c.borderLight }}>
                      <MaterialIcons name="radio-button-unchecked" size={ms(10)} color={c.error} />
                      <Text style={{ fontSize: ms(10), fontWeight: '600', color: c.textSecondary }}>{field}</Text>
                    </View>
                  ))}
                </View>
              ));
            })()}
          </ScrollView>
        </View>
      </ResponsiveModal>

      {/* ─── DIRECTIONS UNAVAILABLE MODAL ─── */}
      <ResponsiveModal
        visible={directionsAlert}
        onClose={() => setDirectionsAlert(false)}
        maxWidth={360}
        widthPercent={isLandscape ? 40 : 80}>
        <View style={{ padding: wp(16), alignItems: 'center' }}>
          <View style={[styles.logoutIconWrap, { backgroundColor: c.warningSurface }]}>
            <MaterialIcons name="directions-off" size={ms(28)} color={c.warningDark} />
          </View>
          <Text style={[styles.logoutTitle, { color: c.textPrimary }]}>Directions Unavailable</Text>
          <Text style={[styles.logoutMessage, { color: c.textSecondary }]}>Directions are not available because this ticket has been completed.</Text>
          <TouchableOpacity
            style={{ alignItems: 'center', justifyContent: 'center', paddingVertical: wp(10), borderRadius: wp(10), backgroundColor: c.primary, width: '100%' }}
            onPress={() => setDirectionsAlert(false)}
            activeOpacity={0.7}>
            <Text style={{ fontSize: ms(12), fontWeight: '700', color: c.textOnPrimary }}>OK</Text>
          </TouchableOpacity>
        </View>
      </ResponsiveModal>

    </View>
  );
}

const createStyles = () => StyleSheet.create({
  container: { flex: 1 },

  // Header
  header: { paddingBottom: wp(4) },
  headerRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: wp(3) },
  headerLeft: { flexDirection: 'row', alignItems: 'center', flex: 1, flexShrink: 1, minWidth: 0 },
  logo: { width: wp(34), height: wp(34), borderRadius: wp(17) },
  logoTitle: { fontSize: ms(14), fontWeight: '800', letterSpacing: 0.3 },
  logoSub: { fontSize: ms(9), fontWeight: '500', marginTop: 1 },
  headerActions: { flexDirection: 'row', alignItems: 'center', gap: wp(6), flexShrink: 0 },
  hdrBtn: { width: wp(34), height: wp(34), borderRadius: wp(11), justifyContent: 'center', alignItems: 'center' },

  // Tabs
  tabsRow: { flexDirection: 'row', gap: wp(5), paddingBottom: wp(2) },
  tab: { flexDirection: 'row', alignItems: 'center', gap: wp(3), paddingVertical: wp(2), paddingHorizontal: wp(8), borderRadius: wp(7), borderWidth: 1 },
  tabDot: { width: wp(5), height: wp(5), borderRadius: wp(3) },
  tabText: { fontWeight: '700', fontSize: ms(11), letterSpacing: 0.2 },

  // Scroll
  scroll: { flex: 1 },
  scrollInner: { paddingHorizontal: wp(10), paddingTop: wp(4), paddingBottom: wp(4) },

  // KPI
  kpiRow: { flexDirection: 'row', alignItems: 'center' },
  kpiItem: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: wp(8), paddingVertical: wp(4), paddingHorizontal: wp(6) },
  kpiIconWrap: { width: wp(28), height: wp(28), borderRadius: wp(8), justifyContent: 'center', alignItems: 'center' },
  kpiVal: { fontSize: ms(11), fontWeight: '800', letterSpacing: 0.1 },
  kpiLabel: { fontSize: ms(9), fontWeight: '600', letterSpacing: 0.3, color: '#9E9E9E', marginTop: 1 },
  kpiDivider: { width: StyleSheet.hairlineWidth, height: wp(26), marginHorizontal: wp(2) },

  // Chips
  chipRow: { flexDirection: 'row', flexWrap: 'wrap', gap: wp(6), alignItems: 'center' },
  statusChip: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: wp(10), paddingVertical: wp(4), borderRadius: wp(16), gap: wp(5) },
  chipDot: { width: wp(6), height: wp(6), borderRadius: wp(3) },
  chipLabel: { fontWeight: '600', fontSize: ms(10) },
  infoChip: { flexDirection: 'row', alignItems: 'center', gap: wp(4), paddingHorizontal: wp(8), paddingVertical: wp(4), borderRadius: wp(16), borderWidth: 1 },

  // Section header
  secHeader: { flexDirection: 'row', alignItems: 'center', marginBottom: wp(4), paddingBottom: wp(3), borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: '#E0E0E0', gap: wp(6) },
  secIcon: { width: wp(24), height: wp(24), borderRadius: wp(8), justifyContent: 'center', alignItems: 'center' },
  secTitle: { fontSize: ms(10), fontWeight: '700', letterSpacing: 0.1, flex: 1 },
  countBadge: { paddingHorizontal: wp(8), paddingVertical: wp(2), borderRadius: wp(8), borderWidth: 1 },
  countText: { fontSize: ms(9), fontWeight: '800' },

  // Detail cards
  detailRow: { flexDirection: 'row', alignItems: 'flex-start', paddingVertical: wp(5), gap: wp(4) },
  detailLabel: { fontSize: ms(9), fontWeight: '800', letterSpacing: 0.1, width: '28%', flexShrink: 0 },
  detailValue: { fontSize: ms(10), fontWeight: '700', flexShrink: 1 },
  slumpPillInline: { paddingHorizontal: wp(8), paddingVertical: wp(2), borderRadius: wp(6), borderWidth: 1 },


  // Dropdown
  dropdownOverlay: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0 },
  dropdown: { position: 'absolute', minWidth: wp(200), maxWidth: wp(260), borderRadius: wp(14), borderWidth: StyleSheet.hairlineWidth, elevation: 8, shadowColor: Colors.shadowColor, shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.12, shadowRadius: 16, overflow: 'hidden' },
  ddHeader: { flexDirection: 'row', alignItems: 'center', gap: wp(10), paddingHorizontal: wp(16), paddingVertical: wp(12), borderBottomWidth: StyleSheet.hairlineWidth },
  ddAvatar: { width: wp(32), height: wp(32), borderRadius: wp(10), justifyContent: 'center', alignItems: 'center' },
  ddName: { fontSize: ms(13), fontWeight: '700' },
  ddSub: { fontSize: ms(11), fontWeight: '500', marginTop: 1 },
  ddItem: { flexDirection: 'row', alignItems: 'center', gap: wp(10), paddingHorizontal: wp(16), paddingVertical: wp(8), minHeight: wp(35) },
  ddIcon: { width: wp(30), height: wp(30), borderRadius: wp(9), justifyContent: 'center', alignItems: 'center' },
  ddLabel: { flex: 1, fontSize: ms(13), fontWeight: '600' },
  ddFooter: { alignItems: 'center', paddingVertical: wp(8), borderTopWidth: StyleSheet.hairlineWidth },
  ddVersion: { fontSize: ms(10), fontWeight: '500' },

  // QR Modal
  qrHeader: { flexDirection: 'row', alignItems: 'center', gap: wp(8), paddingHorizontal: wp(12), paddingVertical: wp(8), borderBottomWidth: 1 },
  qrHeaderIcon: { width: wp(28), height: wp(28), borderRadius: wp(8), justifyContent: 'center', alignItems: 'center' },
  qrHeaderTitle: { fontSize: ms(13), fontWeight: '800', letterSpacing: 0.3 },
  qrHeaderSub: { fontSize: ms(10), fontWeight: '500', marginTop: 1 },
  qrChipRow: { flexDirection: 'row', gap: wp(6), paddingHorizontal: wp(12), alignSelf: 'stretch' },
  qrChip: { flex: 1, alignItems: 'center', paddingVertical: wp(6), borderRadius: wp(8) },
  qrChipLabel: { fontSize: ms(10), fontWeight: '700', letterSpacing: 0.8 },
  qrChipValue: { fontSize: ms(13), fontWeight: '900', marginTop: 1 },
  qrCodeSection: { alignItems: 'center', paddingVertical: wp(10), paddingHorizontal: wp(10) },
  qrCodeCard: { padding: wp(12), borderRadius: wp(12), alignItems: 'center', justifyContent: 'center', elevation: 4, shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.08, shadowRadius: 8 },
  qrFooter: { paddingHorizontal: wp(12), gap: wp(4), alignSelf: 'stretch' },
  qrFooterRow: { flexDirection: 'row', alignItems: 'center', gap: wp(5), justifyContent: 'center', paddingTop: wp(2) },
  qrFooterText: { fontSize: ms(12), fontWeight: '600' },

  // Plants Modal
  plantsList: { paddingHorizontal: wp(16) },
  plantItem: { paddingVertical: wp(12), borderBottomWidth: 0.5, alignItems: 'center', minHeight: wp(42) },
  plantText: { fontSize: ms(13), fontWeight: '600', textAlign: 'center' },
  etHeader: { flexDirection: 'row', alignItems: 'center', gap: wp(10), paddingHorizontal: wp(16), paddingVertical: wp(10), borderBottomWidth: 1 },
  etHeaderIcon: { width: wp(32), height: wp(32), borderRadius: wp(10), justifyContent: 'center', alignItems: 'center' },
  etHeaderTitle: { flex: 1, fontSize: ms(13), fontWeight: '800', letterSpacing: 0.5 },
  etSectionHdr: { flexDirection: 'row', alignItems: 'center', gap: wp(6), paddingHorizontal: wp(16), paddingTop: wp(10), paddingBottom: wp(6) },
  etSectionTitle: { fontSize: ms(9), fontWeight: '800', letterSpacing: 1 },
  etActionRow: { flexDirection: 'row', alignItems: 'center', paddingVertical: wp(10), paddingHorizontal: wp(16), gap: wp(10), minHeight: wp(44) },
  etActionIcon: { width: wp(30), height: wp(30), borderRadius: wp(9), justifyContent: 'center', alignItems: 'center' },
  etActionLabel: { flex: 1, fontSize: ms(10), fontWeight: '700' },

  // Unified modal close button
  mCloseBtn: { width: wp(32), height: wp(32), borderRadius: wp(16), justifyContent: 'center', alignItems: 'center' },
  mCloseBtnAbsolute: { position: 'absolute', top: wp(8), right: wp(8), zIndex: 10 },
  mHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: wp(14), paddingVertical: wp(10), borderBottomWidth: 1 },
  mHeaderTitle: { fontSize: ms(13), fontWeight: '900', letterSpacing: 0.5 },

  // Products Modal
  pmHeader: { flexDirection: 'row', alignItems: 'center', gap: wp(8), paddingHorizontal: wp(14), paddingVertical: wp(10), borderBottomWidth: 1 },
  pmHeaderIcon: { width: wp(30), height: wp(30), borderRadius: wp(9), justifyContent: 'center', alignItems: 'center' },
  pmTitle: { fontSize: ms(10), fontWeight: '800', letterSpacing: 0.3 },
  pmSubtitle: { fontSize: ms(9), fontWeight: '500', marginTop: 1 },
  pmBody: { paddingHorizontal: wp(14), paddingTop: wp(4), paddingBottom: wp(14) },
  pmRow: { flexDirection: 'row', alignItems: 'center', paddingVertical: wp(8), paddingHorizontal: wp(4), borderBottomWidth: 0.5, borderRadius: wp(4) },
  pmRowHeader: { borderBottomWidth: 1.5, paddingBottom: wp(6), marginBottom: wp(2) },
  pmColCode: { width: wp(60) },
  pmColDesc: { flex: 1, paddingRight: wp(8) },
  pmColQty: { width: wp(40), textAlign: 'right' },
  pmColUnit: { width: wp(35), textAlign: 'center' },
  pmTh: { fontSize: ms(9), fontWeight: '900', letterSpacing: 0.5 },
  pmTd: { fontSize: ms(10), fontWeight: '500' },

  // Logout confirmation modal
  logoutIconWrap: { width: wp(48), height: wp(48), borderRadius: wp(24), justifyContent: 'center', alignItems: 'center', marginBottom: wp(10) },
  logoutTitle: { fontSize: ms(13), fontWeight: '700', marginBottom: wp(4) },
  logoutMessage: { fontSize: ms(10), fontWeight: '400', textAlign: 'center', lineHeight: ms(15), marginBottom: wp(14) },
  logoutButtons: { flexDirection: 'row', gap: wp(8), width: '100%' },
  logoutBtn: { flex: 1, paddingVertical: wp(10), borderRadius: wp(10), alignItems: 'center', justifyContent: 'center' },
  logoutBtnText: { fontSize: ms(10), fontWeight: '600' },
});
