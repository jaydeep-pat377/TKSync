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
  TextInput,
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
import { ticketsApi, plantsApi, checkApiHealth, type Ticket, type TicketDetail, type DeliveryRecord, type Plant, type TicketQr } from '../services/api';
import { Colors } from '../constants/colors';
import { common } from '../constants/commonStyles';
import ResponsiveModal from '../components/ResponsiveModal';
import { wp, ms } from '../utils/responsive';
import { offlineStorage } from '../services/offlineStorage';
import { useOfflineSync } from '../contexts/OfflineSyncContext';
import { useFontScaleRefresh, useFontSize } from '../contexts/FontSizeContext';

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
  const Y = d.getFullYear();
  const M = (d.getMonth() + 1).toString().padStart(2, '0');
  const D = d.getDate().toString().padStart(2, '0');
  const h = d.getHours().toString().padStart(2, '0');
  const m = d.getMinutes().toString().padStart(2, '0');
  const s = d.getSeconds().toString().padStart(2, '0');
  return `${Y}-${M}-${D} ${h}:${m}:${s}`;
}

function formatLocalTime(timeStr: string | null | undefined): string {
  if (!timeStr) return '--';
  return timeStr;
}

function buildTimeline(detail: TicketDetail) {
  return detail.progress.steps.map(step => ({
    labelKey: TIMELINE_LABEL_KEYS[step.key] || step.key,
    label: step.label || step.key,
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

function stripUnit(value: string | number | null | undefined): string {
  if (value == null) return '-';
  const s = String(value).trim();
  // Remove trailing unit text (e.g., "611.40 m3" → "611.40")
  return s.replace(/\s*[a-zA-Z³²]+\s*$/, '') || s;
}

function getTicketStatus(ticket: Ticket, detail?: TicketDetail | null) {
  // Use API status_label when available
  const apiLabel = detail?.ticket?.status_label || ticket.status_label;
  if (detail?.ticket?.delivery_state) {
    const state = detail.ticket.delivery_state;
    if (state === 'completed') return { label: apiLabel || 'COMPLETED', type: 'completed' as const };
    if (state === 'voided') return { label: apiLabel || 'VOIDED', type: 'voided' as const };
    if (state === 'active') return { label: apiLabel || 'ACTIVE', type: 'active' as const };
  }
  if (detail?.ticket && detail.ticket.in_process != null) {
    if (detail.ticket.in_process) return { label: apiLabel || 'ACTIVE', type: 'active' as const };
    return { label: apiLabel || 'COMPLETED', type: 'completed' as const };
  }
  // Fallback to list-level fields
  if (ticket.current_status === 4) return { label: apiLabel || 'COMPLETED', type: 'completed' as const };
  if (ticket.active) return { label: apiLabel || 'ACTIVE', type: 'active' as const };
  return { label: apiLabel || 'PENDING', type: 'warning' as const };
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
  { icon: 'label', labelKey: 'actions.tag' },
  { icon: 'factory', labelKey: 'actions.truck' },
  { icon: 'qr-code-scanner', labelKey: 'actions.qr' },
];

const MENU_ITEMS_BASE = [
  { icon: 'gps-fixed', labelKey: 'menu.vehicleTracking', actionKey: 'VehicleTracking', color: '' },
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
  const { saveDeliveryTab } = useOfflineSync();
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

  const ticketsRef = useRef<Ticket[]>([]);
  const activeTicketRef = useRef(0);
  const loadedTicketIdRef = useRef<number | null>(null);
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
      .catch(() => { })
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

  const handlePlantsScrollEnd = useCallback(({ nativeEvent }: any) => {
    const { layoutMeasurement, contentOffset, contentSize } = nativeEvent;
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
  const [leftColScrollable, setLeftColScrollable] = useState(false);
  const [leftColScrollPct, setLeftColScrollPct] = useState(0);
  const leftColLayoutH = useRef(0);
  const leftColContentH = useRef(0);
  const [rightColScrollable, setRightColScrollable] = useState(false);
  const [rightColScrollPct, setRightColScrollPct] = useState(0);
  const rightColLayoutH = useRef(0);
  const rightColContentH = useRef(0);
  const [fontSizeVisible, setFontSizeVisible] = useState(false);
  const [customerExpanded, setCustomerExpanded] = useState(true);
  const [deliveryExpanded, setDeliveryExpanded] = useState(true);
  const [instructionsExpanded, setInstructionsExpanded] = useState(false);
  const [instructionsModalVisible, setInstructionsModalVisible] = useState(false);
  const [slumpPickerField, setSlumpPickerField] = useState<'slump_from_plant' | 'slump_to_job' | null>(null);
  const [waterModalField, setWaterModalField] = useState<'customer_water' | 'maintenance_water' | null>(null);
  const [waterLitresInput, setWaterLitresInput] = useState('');
  const [waterMmInput, setWaterMmInput] = useState('');
  const [timePickerStep, setTimePickerStep] = useState<{ key: string; label: string } | null>(null);
  const [timePickerHour, setTimePickerHour] = useState(0);
  const [timePickerMinute, setTimePickerMinute] = useState(0);
  const [appVersion, setAppVersion] = useState('');

  useEffect(() => {
    checkApiHealth().then(r => { if (r.version) setAppVersion(r.version); }).catch(() => { });
  }, []);
  const { fontScale, increase: fontIncrease, decrease: fontDecrease, reset: fontReset } = useFontSize();
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
      navigation.reset({ index: 0, routes: [{ name: 'Login' }] });
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

  const fetchTickets = useCallback(async () => {
    try {
      setLoading(true);
      setRefreshing(true);
      const { data } = await ticketsApi.getLatest({ page: 1, limit: 20 });
      console.log('[Tickets] fetched:', data.total, 'tickets, data length:', data.data.length);
      setTickets(data.data);
      ticketsRef.current = data.data;
      loadedTicketIdRef.current = null;
      setActiveTicket(0);
      activeTicketRef.current = 0;
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

  const fetchDetail = useCallback(async (ticketId: number, showLoading = true) => {
    if (showLoading) setDetailLoading(true);
    try {
      const { data } = await ticketsApi.getById(ticketId);
      setDetail(data);
    } catch (err) {
      console.log('[TicketDetail] fetch error:', err);
    } finally {
      if (showLoading) setDetailLoading(false);
    }
  }, []);

  // Silent refresh helper — refreshes all data without any loader
  const silentRefreshAll = useCallback(async () => {
    const idx = activeTicketRef.current;
    // Refresh ticket list
    try {
      const { data } = await ticketsApi.getLatest({ page: 1, limit: 20 });
      // Pre-mark so the useEffect skips when setTickets triggers it
      const currentTicket = data.data[idx];
      if (currentTicket && activeTicketRef.current === idx) {
        loadedTicketIdRef.current = currentTicket.id;
      }
      setTickets(data.data);
      ticketsRef.current = data.data;
      setDateFrom(data.filters?.date_from || null);
      setLastSyncTime(new Date());
    } catch (_) { }
    // Refresh detail + delivery record for current ticket
    const ticket = ticketsRef.current[activeTicketRef.current];
    if (ticket) {
      fetchDetail(ticket.id, false);
      ticketsApi.getDeliveryRecord(ticket.id)
        .then(res => {
          setDeliveryRecord(res.data);
          offlineStorage.cacheDeliveryRecord(ticket.id, res.data);
        })
        .catch(() => { });
    }
  }, [fetchDetail]);

  // Initial load
  useEffect(() => {
    fetchTickets();
  }, [fetchTickets]);

  // Auto-refresh every 2 minutes (silent — no loader)
  useEffect(() => {
    const iv = setInterval(silentRefreshAll, 120000);
    return () => clearInterval(iv);
  }, [silentRefreshAll]);

  // Fetch detail + delivery record when ticket changes
  useEffect(() => {
    const ticket = tickets[activeTicket];
    if (ticket) {
      // Skip if already loaded by silentRefreshAll
      if (loadedTicketIdRef.current === ticket.id) return;
      loadedTicketIdRef.current = ticket.id;
      fetchDetail(ticket.id);
      ticketsApi.getDeliveryRecord(ticket.id)
        .then(res => {
          setDeliveryRecord(res.data);
          offlineStorage.cacheDeliveryRecord(ticket.id, res.data);
          setPendingDetails(prev => { if (prev) { setDetailsVisible(true); } return false; });
        })
        .catch(() => {
          // Fall back to locally cached delivery record
          const cached = offlineStorage.getCachedDeliveryRecord(ticket.id);
          if (cached) {
            const pending = offlineStorage.getPendingForTicket(ticket.id);
            let merged = { ...cached };
            for (const item of pending) {
              merged[item.tab] = { ...(merged[item.tab] || {}), ...item.body };
            }
            setDeliveryRecord(merged as DeliveryRecord);
          } else {
            setDeliveryRecord(null);
          }
          setPendingDetails(false);
        });
    } else {
      loadedTicketIdRef.current = null;
      setDetail(null);
      setDeliveryRecord(null);
    }
  }, [activeTicket, tickets, fetchDetail]);

  const handleSync = useCallback(() => {
    syncSpin.setValue(0);
    Animated.timing(syncSpin, { toValue: 1, duration: 600, useNativeDriver: true }).start();
    silentRefreshAll();
  }, [syncSpin, silentRefreshAll]);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await silentRefreshAll();
    setRefreshing(false);
  }, [silentRefreshAll]);

  const syncRotate = syncSpin.interpolate({ inputRange: [0, 1], outputRange: ['0deg', '360deg'] });

  const switchTicket = useCallback((i: number) => {
    activeTicketRef.current = i;
    setActiveTicket(i);
  }, []);

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

  // Only show Vehicle/VehicleTracking menu when ticket is in process
  const hasActiveTicket = detail?.ticket?.in_process === true;
  const menuItems = useMemo(
    () => hasActiveTicket ? MENU_ITEMS_BASE : MENU_ITEMS_BASE.filter(i => i.actionKey !== 'VehicleTracking'),
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
    if (label === 'VehicleTracking') {
      navigation.navigate('VehicleTracking', { ticketId: currentTicket?.id });
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
    if (item.icon === 'edit') { console.log('[DEBUG] Edit button pressed, setting editVisible=true'); setEditVisible(true); }
    if (item.icon === 'text-fields') { setFontSizeVisible(true); }
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
    if (item.icon === 'help-outline') { setFontSizeVisible(true); return; }
    if (item.icon === 'factory' || item.icon === 'local-shipping') {
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
        .catch(() => { })
        .finally(() => setPlantsLoading(false));
    };
    return (
      <View style={[styles.container, { backgroundColor: '#c8c8c8' }]}>
        <StatusBar translucent backgroundColor="transparent" barStyle="light-content" />
        <View style={{ backgroundColor: c.primary, paddingTop: insets.top + (isLandscape ? 2 : wp(4)), paddingBottom: isLandscape ? 4 : wp(6), paddingHorizontal: Math.max(wp(12), insets.right + wp(4)), flexDirection: 'row', justifyContent: 'flex-end', alignItems: 'center' }}>
          <TouchableOpacity style={{ width: isLandscape ? 30 : Math.max(wp(34), 34), height: isLandscape ? 30 : Math.max(wp(34), 34), borderRadius: wp(8), justifyContent: 'center', alignItems: 'center' }} onPress={openMenu} activeOpacity={0.7}>
            <MaterialIcons name="menu" size={ms(isLandscape ? 18 : 22)} color="#fff" />
          </TouchableOpacity>
        </View>
        <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center', paddingHorizontal: wp(20) }}>
          <Text style={{ fontSize: ms(isLandscape ? 12 : 16), fontWeight: '400', color: '#222', textAlign: 'center' }}>
            COMPANY: {company?.company_name || '-'}
          </Text>
          <Text style={{ fontSize: ms(isLandscape ? 11 : 15), fontWeight: '400', color: '#222', textAlign: 'center', marginTop: isLandscape ? 1 : wp(6) }}>
            VEHICLE: {driver?.truck_code || '-'}
          </Text>
          <Text style={{ fontSize: ms(isLandscape ? 13 : 18), fontWeight: '800', color: '#111', textAlign: 'center', marginTop: isLandscape ? 6 : wp(24) }}>
            TICKET NOT ASSIGNED
          </Text>
          {loading ? (
            <ActivityIndicator size="large" color="#2e7d32" style={{ marginTop: isLandscape ? 6 : wp(16) }} />
          ) : (
            <>
              <TouchableOpacity onPress={() => fetchTickets()} activeOpacity={0.7} style={{ marginTop: isLandscape ? 2 : wp(8) }}>
                <Text style={{ fontSize: ms(isLandscape ? 11 : 15), fontWeight: '600', color: '#2e7d32', textDecorationLine: 'underline', textAlign: 'center' }}>
                  REFRESH
                </Text>
              </TouchableOpacity>
              <TouchableOpacity onPress={handleTruckPress} activeOpacity={0.7} style={{ marginTop: isLandscape ? 8 : wp(16), alignItems: 'center' }}>
                <MaterialIcons name="local-shipping" size={ms(isLandscape ? 60 : 80)} color="#555" />
              </TouchableOpacity>
            </>
          )}
        </View>

        {/* Dropdown menu */}
        {menuVisible && (
          <View style={StyleSheet.absoluteFill} pointerEvents="box-none">
            <Pressable style={[styles.dropdownOverlay, { backgroundColor: c.overlayDropdown }]} onPress={closeMenu} />
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
                    { scale: menuScale.interpolate({ inputRange: [0, 1], outputRange: [0.85, 1] }) },
                    { translateY: menuScale.interpolate({ inputRange: [0, 1], outputRange: [-10, 0] }) },
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
                      style={[styles.ddItem, i < menuItems.length - 1 && { borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: c.borderLight }]}
                      activeOpacity={0.6}
                      onPress={() => handleMenuItemPress(item.actionKey)}>
                      <View style={[styles.ddIcon, { backgroundColor: bgColor }]}>
                        <MaterialIcons name={itemIcon as any} size={ms(18)} color={iconColor} />
                      </View>
                      <Text style={[styles.ddLabel, { color: labelColor }]}>{label}{suffix}</Text>
                      <MaterialIcons name="chevron-right" size={ms(18)} color={c.textMuted} />
                    </TouchableOpacity>
                  );
                })}
              </ScrollView>
              <View style={[styles.ddFooter, { borderTopColor: c.borderLight }]}>
                <Text style={[styles.ddVersion, { color: c.textMuted }]}>{appVersion ? `v${appVersion}` : '...'}</Text>
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
          <View style={[styles.mHeader, { borderBottomColor: c.border }]}>
            <Text style={[styles.mHeaderTitle, { color: c.textPrimary }]}>{t('modals.plants')}</Text>
            <TouchableOpacity style={[styles.mCloseBtn, { backgroundColor: c.surface }]} onPress={() => setPlantsVisible(false)} activeOpacity={0.7} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
              <MaterialIcons name="close" size={ms(20)} color={c.textSecondary} />
            </TouchableOpacity>
          </View>
          {plantsLoading ? (
            <View style={{ paddingVertical: wp(40), alignItems: 'center' }}>
              <ActivityIndicator size="large" color={c.primary} />
            </View>
          ) : (
            <ScrollView
              style={styles.plantsList}
              showsVerticalScrollIndicator={true}
              bounces={false}
              onMomentumScrollEnd={handlePlantsScrollEnd}
              onScrollEndDrag={handlePlantsScrollEnd}
              onLayout={({ nativeEvent }) => { plantsLayoutH.current = nativeEvent.layout.height; checkPlantsAutoLoad(); }}
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
                <View style={{ paddingVertical: wp(12), alignItems: 'center' }}>
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
    const isFontBtn = item.icon === 'text-fields';
    const sz = L ? 20 : isTablet ? 24 : ms(20);
    const iconEl = isFontBtn
      ? <Text style={{ fontSize: sz * 0.85, fontWeight: '900', color: active ? c.primary : isDark ? '#B0BEC5' : c.textMuted }}>A</Text>
      : <MaterialIcons name={item.icon as any} size={sz} color={active ? c.primary : isDark ? '#B0BEC5' : c.textMuted} />;
    return (
      <TouchableOpacity
        key={item.labelKey}
        activeOpacity={0.6}
        onPress={() => handleNavPress(item, i)}
        style={{ width: L ? 40 : wp(40), height: L ? 40 : wp(36), justifyContent: 'center', alignItems: 'center', borderRadius: 10, backgroundColor: active ? c.primarySurface : 'transparent' }}>
        {iconEl}
      </TouchableOpacity>
    );
  };

  // Mandatory fields completion data for right panel
  const mandatoryFields = detail?.mandatory_fields || deliveryRecord?.mandatory_fields;
  const getMandatoryStatus = (tab: string, fields: string[]) => {
    if (!deliveryRecord || !fields.length) return { filled: 0, total: 0, items: [] as { name: string; filled: boolean; value?: string }[] };
    const tabData = (deliveryRecord as any)[tab];
    const items = fields.map(f => {
      const val = tabData?.[f];
      const filled = val !== null && val !== undefined && val !== '';
      return { name: f.replace(/_/g, ' ').replace(/\b\w/g, (c: string) => c.toUpperCase()), filled, value: filled ? String(val) : undefined };
    });
    return { filled: items.filter(i => i.filled).length, total: items.length, items };
  };
  const plantMandatory = (() => {
    const p = deliveryRecord?.plant;
    const mFields = mandatoryFields?.plant || [];
    const items = mFields.map(f => {
      const val = (p as any)?.[f];
      const filled = val !== null && val !== undefined && val !== '';
      let display = filled ? String(val) : undefined;
      if (filled && (f === 'slump_from_plant' || f === 'slump_to_job')) display = `${val} mm`;
      return { key: f, name: f.replace(/_/g, ' ').replace(/\b\w/g, (ch: string) => ch.toUpperCase()), filled, value: display };
    });
    return { filled: items.filter(i => i.filled).length, total: items.length, items };
  })();
  const jobsiteMandatory = (() => {
    const j = deliveryRecord?.jobsite;
    const mFields = mandatoryFields?.jobsite || [];
    const items: { key?: string; name: string; filled: boolean; value?: string }[] = [];
    // Group water fields: show "Customer Requested Water" with combined L / mm
    if (mFields.includes('full_load_litres') || mFields.includes('customer_water_litres')) {
      const cwL = j?.customer_water_litres;
      const cwMm = j?.customer_water_mm;
      items.push({ key: 'customer_water', name: 'Customer Requested Water', filled: cwL != null, value: cwL != null ? `${cwL} L${cwMm != null ? ` / ${cwMm} mm` : ''}` : undefined });
    }
    // Always show Maintenance Water
    const mwL = j?.maintenance_water_litres;
    const mwMm = j?.maintenance_water_mm;
    items.push({ key: 'maintenance_water', name: 'Maintenance Water', filled: mwL != null, value: mwL != null ? `${mwL} L${mwMm != null ? ` / ${mwMm} mm` : ''}` : undefined });
    // Remaining jobsite mandatory fields
    mFields.filter(f => f !== 'full_load_litres' && f !== 'customer_water_litres' && f !== 'maintenance_water_litres' && f !== 'maintenance_water_mm').forEach(f => {
      const val = (j as any)?.[f];
      const filled = val !== null && val !== undefined && val !== '';
      items.push({ name: f.replace(/_/g, ' ').replace(/\b\w/g, (ch: string) => ch.toUpperCase()), filled, value: filled ? String(val) : undefined });
    });
    return { filled: items.filter(i => i.filled).length, total: items.length, items };
  })();
  const returnedMandatory = (() => {
    const r = deliveryRecord?.returned;
    const items = [
      { name: 'Qty · Reason · Disposal', filled: r?.returned_concrete_m3 != null && !!r?.disposal_method && !!r?.reason_for_return, value: r ? [r.returned_concrete_m3 != null ? String(r.returned_concrete_m3) : '-', r.disposal_method || '-', r.reason_for_return || '-'].join(' · ') : undefined },
    ];
    // Add washout from jobsite if available
    const ws = deliveryRecord?.jobsite?.washout_area;
    if (ws) items[0].value = (items[0].value || '') + ' · ' + ws;
    return { filled: items.filter(i => i.filled).length, total: items.length, items };
  })();
  const timeMandatory = (() => {
    const steps = deliveryRecord?.time?.steps || [];
    const mFields = mandatoryFields?.time || [];
    // If mandatory_fields.time has entries, show only those steps; otherwise show all steps
    const filtered = mFields.length > 0 ? steps.filter(s => mFields.includes(s.key)) : steps;
    const items = filtered.map(s => ({ key: s.key, name: s.label, filled: s.done, value: s.done && s.time ? s.time.substring(11, 16) : undefined }));
    return { filled: items.filter(i => i.filled).length, total: items.length, items };
  })();
  const totalMandatoryFilled = plantMandatory.filled + jobsiteMandatory.filled + returnedMandatory.filled + timeMandatory.filled;
  const totalMandatoryCount = plantMandatory.total + jobsiteMandatory.total + returnedMandatory.total + timeMandatory.total;

  return (
    <View style={[styles.container, { backgroundColor: c.background }]}>
      <StatusBar translucent backgroundColor="transparent" barStyle="light-content" />

      {/* Main content */}
      <View style={{ flex: 1 }}>
        {/* ─── TOP BAR: TODAY + Tickets + Right Icons ─── */}
        <View style={{ backgroundColor: c.background, paddingTop: insets.top + (L ? 2 : 4), paddingBottom: L ? 3 : 6, paddingLeft: Math.max(L ? ls(12) : wp(12), insets.left + 4), paddingRight: Math.max(L ? ls(12) : wp(12), insets.right + 4), alignItems: 'center' }}>
          <View style={{ flexDirection: 'row', alignItems: 'center' }}>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 6, alignItems: 'center', paddingHorizontal: 4 }} style={{ flex: 1 }}>
              {tickets.map((ticket, i) => {
                const isSelected = activeTicket === i;
                const isCompleted = ticket.at_plant_time != null;
                return (
                  <TouchableOpacity key={ticket.id} onPress={() => { if (isCompleted) setPendingDetails(true); switchTicket(i); }} activeOpacity={0.7}
                    style={[styles.tab, { borderColor: isSelected ? 'transparent' : isDark ? '#fff' : '#000', backgroundColor: isSelected ? (isCompleted ? c.primary : c.accent) : isDark ? c.surface : '#e8ecf0' }]}>
                    <View style={{ width: isSelected ? ms(7) : ms(5), height: isSelected ? ms(7) : ms(5), borderRadius: ms(4), backgroundColor: isSelected ? '#fff' : (isCompleted ? c.primary : c.accent) }} />
                    <Text style={[styles.tabText, { color: isSelected ? '#fff' : c.textSecondary, fontWeight: isSelected ? '900' : '700' }]}>{ticket.ticket_code}</Text>
                  </TouchableOpacity>
                );
              })}
            </ScrollView>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: ms(5), marginLeft: ms(6) }}>
              <View style={{ backgroundColor: isOnline ? '#2E7D32' : '#D32F2F', borderRadius: ms(12), paddingVertical: ms(3), paddingHorizontal: ms(8), flexDirection: 'row', alignItems: 'center', gap: ms(3) }}>
                <MaterialIcons name="wifi" size={ms(10)} color="#fff" />
                <Text style={{ fontSize: ms(8), fontWeight: '800', color: '#fff' }}>{isOnline ? 'ONLINE' : 'OFFLINE'}</Text>
              </View>
              <TouchableOpacity activeOpacity={0.7} style={{ width: ms(28), height: ms(28), borderRadius: ms(14), backgroundColor: c.surface, justifyContent: 'center', alignItems: 'center' }}>
                <MaterialIcons name="notifications" size={ms(14)} color={c.textSecondary} />
              </TouchableOpacity>
              <TouchableOpacity onPress={() => setFontSizeVisible(true)} activeOpacity={0.7} style={{ width: ms(28), height: ms(28), borderRadius: ms(14), backgroundColor: c.surface, justifyContent: 'center', alignItems: 'center' }}>
                <Text style={{ fontSize: ms(14), fontWeight: '900', color: c.textSecondary }}>A</Text>
              </TouchableOpacity>
              <TouchableOpacity onPress={() => toggle()} activeOpacity={0.7} style={{ width: ms(28), height: ms(28), borderRadius: ms(14), backgroundColor: c.surface, justifyContent: 'center', alignItems: 'center' }}>
                <MaterialIcons name={isDark ? 'light-mode' : 'dark-mode'} size={ms(14)} color={c.textSecondary} />
              </TouchableOpacity>
              <TouchableOpacity onPress={openMenu} activeOpacity={0.7} style={{ width: ms(28), height: ms(28), borderRadius: ms(14), backgroundColor: c.surface, justifyContent: 'center', alignItems: 'center' }}>
                <MaterialIcons name="settings" size={ms(14)} color={c.textSecondary} />
              </TouchableOpacity>
            </View>
          </View>
        </View>

        {/* ─── OLD HEADER (hidden, kept for phone landscape compat) ─── */}
        <View style={[styles.header, { backgroundColor: c.primaryDark, paddingTop: 0, paddingLeft: Math.max(L ? ls(8) : wp(12), insets.left), paddingRight: Math.max(L ? ls(8) : wp(12), insets.right), display: 'none' }, L && { paddingBottom: ls(2) }]}>
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
                    <TouchableOpacity key={ticket.id} onPress={() => { if (isCompleted) { setPendingDetails(true); } switchTicket(i); }} activeOpacity={0.7} style={[styles.tab, { borderColor: isSelected ? 'transparent' : isDark ? '#fff' : '#000', backgroundColor: isSelected ? (isCompleted ? c.primary : c.accent) : isDark ? c.surface : '#e8ecf0' }]}>
                      <View style={{ width: ms(5), height: ms(5), borderRadius: ms(3), backgroundColor: isSelected ? '#fff' : (isCompleted ? c.primary : c.accent) }} />
                      <Text style={[styles.tabText, { color: isSelected ? '#fff' : c.textSecondary, fontWeight: isSelected ? '900' : '700' }]}>{ticket.ticket_code}</Text>
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
                    <TouchableOpacity key={ticket.id} onPress={() => { if (isCompleted) { setPendingDetails(true); } switchTicket(i); }} activeOpacity={0.7} style={[styles.tab, { borderColor: isSelected ? 'transparent' : isDark ? '#fff' : '#000', backgroundColor: isSelected ? (isCompleted ? c.primary : c.accent) : isDark ? c.surface : '#e8ecf0' }]}>
                      <View style={{ width: ms(5), height: ms(5), borderRadius: ms(3), backgroundColor: isSelected ? '#fff' : (isCompleted ? c.primary : c.accent) }} />
                      <Text style={[styles.tabText, { color: isSelected ? '#fff' : c.textSecondary, fontWeight: isSelected ? '900' : '700' }]}>{ticket.ticket_code}</Text>
                    </TouchableOpacity>
                  );
                })}
              </ScrollView>
            </>
          )}
        </View>


        {/* ─── CONTENT ─── */}
        {L ? (() => {
          /* ═══ LANDSCAPE: Adaptive viewport, no scroll ═══ */
          // Responsive scale factor based on screen height (phone ~320pt, tablet ~700pt+)
          const lh = winHeight - insets.top - insets.bottom;
          const isSmallLandscape = lh < 400;
          const shortDim = Math.min(width, winHeight);
          const ct = shortDim < 820;
          const s = isSmallLandscape
            ? Math.max(0.65, lh / 660)
            : Math.max(0.65, Math.min(1.35, shortDim / 810));
          const fs = (base: number) => Math.round(base * s);
          const fst = (base: number) => Math.round((base - 1) * s);
          return (
            <View style={{ flex: 1, paddingHorizontal: Math.max(fs(10), insets.left + 6), paddingTop: fs(1), paddingBottom: 0 }}>
              {/* Info Bar */}
              <View style={{ backgroundColor: '#367000', borderRadius: fs(6), paddingVertical: isSmallLandscape ? fs(4) : fs(6), paddingHorizontal: fs(12), marginBottom: fs(3), flexDirection: 'row', alignItems: 'center' }}>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: fs(8), flex: 1 }}>
                  <MaterialIcons name="local-shipping" size={fs(16)} color={c.primary} />
                  <View>
                    <Text style={{ fontSize: fst(14), fontWeight: '700', color: c.textOnDark60 }}>{driver?.truck_code || '-'}</Text>
                    <Text style={{ fontSize: fst(11), fontWeight: '500', color: c.textOnDark35 }}>{driver?.driver_code || '-'}</Text>
                  </View>
                </View>
                <View style={{ alignItems: 'center', flex: 2 }}>
                  <Text style={{ fontSize: fst(16), fontWeight: '900', color: c.textOnPrimary, letterSpacing: 1 }}>TICKET {currentTicket?.ticket_code || '-'}</Text>
                  <Text style={{ fontSize: fst(12), fontWeight: '600', color: c.textOnDark60 }}>ORDER {currentTicket?.order_code || '-'}</Text>
                </View>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: fs(10), flex: 1.5, justifyContent: 'flex-end' }}>
                  <View style={{ backgroundColor: c.overlay15, paddingVertical: fs(5), paddingHorizontal: fs(10), borderRadius: fs(8), flexDirection: 'row', alignItems: 'center', gap: fs(6) }}>
                    <MaterialIcons name={getWeatherIcon(detail?.weather?.icon)} size={fs(14)} color={c.textOnPrimary} />
                    <View>
                      <Text style={{ fontSize: fst(10), fontWeight: '700', color: c.textOnPrimary }} numberOfLines={1}>{currentTicket?.location_code ? `${currentTicket.location_code} - ` : ''}{currentTicket?.plant_name || '-'}</Text>
                      <Text style={{ fontSize: fst(9), fontWeight: '600', color: c.textOnDark60 }} numberOfLines={1}>{detail?.weather ? `${Math.round(detail.weather.temperature_c)}°C ${detail.weather.description.toUpperCase()}` : '-'}</Text>
                    </View>
                  </View>
                  {currentTicket != null && (
                    <View style={{ alignItems: 'flex-end', gap: fs(3) }}>
                      {(() => {
                        const status = getTicketStatus(currentTicket, detail); const isActive = status.type === 'active'; const isCompleted = status.type === 'completed'; return (
                          <View style={{ backgroundColor: isActive ? c.accent : isCompleted ? '#2E7D32' : '#F59E0B', paddingVertical: fs(3), paddingHorizontal: fs(12), borderRadius: 4, flexDirection: 'row', alignItems: 'center', gap: fs(5) }}>
                            <View style={{ width: fs(6), height: fs(6), borderRadius: fs(3), backgroundColor: '#fff' }} />
                            <Text style={{ fontSize: fst(10), fontWeight: '900', color: '#fff', letterSpacing: 0.5 }}>{isActive ? 'IN TRANSIT' : status.label}</Text>
                          </View>);
                      })()}
                      <View style={{ backgroundColor: '#E53935', paddingVertical: fs(3), paddingHorizontal: fs(12), borderRadius: 4 }}>
                        <Text style={{ fontSize: fst(10), fontWeight: '900', color: '#fff', letterSpacing: 0.5 }}>{detail?.ticket?.payment_terms || PAYMENT_MAP[currentTicket.payment_form] || 'ON ACCOUNT'}</Text>
                      </View>
                    </View>
                  )}
                </View>
              </View>
              {/* Timeline */}
              {!detailLoading && (
                <View style={{ flexDirection: 'row', alignItems: 'flex-start', marginBottom: fs(4), paddingHorizontal: fs(8) }}>
                  {timeline.map((item, i) => {
                    const isActive = item.done && (i === timeline.length - 1 || !timeline[i + 1].done);
                    const isFirst = i === 0; const isLast = i === timeline.length - 1;
                    const nextDone = !isLast && timeline[i + 1]?.done;
                    const lineDone = item.done && nextDone;
                    const dotSz = isActive ? fs(isSmallLandscape ? 20 : 24) : item.done ? fs(isSmallLandscape ? 14 : 18) : fs(isSmallLandscape ? 10 : 14);
                    return (
                      <View key={item.labelKey} style={{ alignItems: 'center', flex: 1 }}>
                        <Text style={{ fontSize: fst(isSmallLandscape ? 10 : 12), fontWeight: isActive ? '900' : '700', color: isActive ? c.textPrimary : item.done ? c.primary : c.textMuted, textAlign: 'center', textTransform: 'uppercase', letterSpacing: 0.3, marginBottom: fs(isSmallLandscape ? 2 : 4) }} numberOfLines={1}>{item.label}</Text>
                        <View style={{ flexDirection: 'row', alignItems: 'center', height: fs(isSmallLandscape ? 22 : 26), width: '100%' }}>
                          {isFirst ? <View style={{ flex: 1 }} /> : (
                            <View style={{ flex: 1, height: 2, backgroundColor: item.done ? c.primary : 'transparent', borderBottomWidth: item.done ? 0 : 1.5, borderBottomColor: '#888', borderStyle: item.done ? 'solid' : 'dashed' }} />
                          )}
                          <View style={{
                            width: dotSz, height: dotSz, borderRadius: dotSz / 2,
                            justifyContent: 'center', alignItems: 'center',
                            backgroundColor: isActive ? '#1E88E5' : item.done ? c.primary : c.border,
                            borderWidth: isActive ? fs(3) : 0,
                            borderColor: isActive ? '#90CAF9' : 'transparent',
                          }}>
                            {item.done && !isActive && <MaterialIcons name="check" size={fs(13)} color="#fff" />}
                            {isActive && <View style={{ width: fs(10), height: fs(10), borderRadius: fs(5), backgroundColor: '#fff' }} />}
                          </View>
                          {isLast ? <View style={{ flex: 1 }} /> : (
                            <View style={{ flex: 1, height: 2, backgroundColor: lineDone ? c.primary : 'transparent', borderBottomWidth: lineDone ? 0 : 1.5, borderBottomColor: '#888', borderStyle: lineDone ? 'solid' : 'dashed' }} />
                          )}
                        </View>
                        <Text style={{ fontSize: fst(isSmallLandscape ? 11 : 13), fontWeight: '800', color: isActive ? c.textPrimary : item.done ? c.primary : c.textMuted, textAlign: 'center', marginTop: fs(isSmallLandscape ? 1 : 3) }}>{item.time || '—'}</Text>
                      </View>);
                  })}
                </View>
              )}
              {detailLoading && <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center' }}><ActivityIndicator size="small" color={c.primary} /></View>}
              {/* Two-column body */}
              {!detailLoading && (
                <View style={{ flexDirection: 'row', gap: fs(6), minHeight: 0, marginTop: fs(6) }}>
                  {/* LEFT — Customer + Product + Delivery Location + Quick Links */}
                  <View style={{ flex: 1, gap: ct ? fs(6) : fs(8) }}>
                    <View style={{ backgroundColor: c.white, borderRadius: fs(6), borderWidth: StyleSheet.hairlineWidth, borderColor: c.border, padding: ct ? fs(6) : fs(8) }}>
                      <View style={{ borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: c.border, paddingBottom: ct ? fs(4) : fs(5), marginBottom: fs(4) }}>
                        <Text style={{ fontSize: fst(11), fontWeight: '800', color: c.textMuted, letterSpacing: 0.8, textTransform: 'uppercase' }}>Customer</Text>
                      </View>
                      {[{ label: 'CUSTOMER', value: detail?.job?.customer_name || '-' }, { label: 'PROJECT', value: detail?.job?.project_name || '-' }].map((row, i) => (
                        <View key={i} style={{ flexDirection: 'row', paddingVertical: ct ? fs(7) : fs(8), borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: c.borderLight }}>
                          <Text style={{ fontSize: fst(10), fontWeight: '600', color: c.textMuted, width: '20%', letterSpacing: 0.5 }}>{row.label}</Text>
                          <Text style={{ fontSize: fst(12), fontWeight: '800', color: c.textPrimary, flex: 1 }} numberOfLines={1}>{row.value}</Text>
                        </View>
                      ))}
                    </View>
                    {/* Product */}
                    <View style={{ backgroundColor: c.white, borderRadius: fs(6), borderWidth: StyleSheet.hairlineWidth, borderColor: c.border, padding: ct ? fs(6) : fs(8) }}>
                      <View style={{ flexDirection: 'row', alignItems: 'center', borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: c.border, paddingBottom: ct ? fs(4) : fs(5), marginBottom: fs(4) }}>
                        <Text style={{ fontSize: fst(11), fontWeight: '800', color: c.textMuted, letterSpacing: 0.8, textTransform: 'uppercase', flex: 1 }}>PRODUCTS</Text>
                        <TouchableOpacity activeOpacity={0.6} onPress={() => setProductsVisible(true)} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
                          <MaterialIcons name="visibility" size={fs(16)} color={c.accent} />
                        </TouchableOpacity>
                      </View>
                      {/* Data row with titles */}
                      <View style={{ flexDirection: 'row', alignItems: 'flex-end' }}>
                        <View style={{ flex: 0.7, paddingRight: fs(3) }}>
                          <Text style={{ fontSize: fst(10), fontWeight: '600', color: c.textMuted, letterSpacing: 0.5, marginBottom: fs(2) }}>CODE</Text>
                          <Text style={{ fontSize: fst(11), fontWeight: '700', color: c.textPrimary }} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.7}>{detail?.mix?.mix_code || '-'}</Text>
                        </View>
                        <Text style={{ fontSize: fst(9), color: c.border, marginBottom: fs(1) }}>|</Text>
                        <TouchableOpacity activeOpacity={0.6} onPress={() => setProductsVisible(true)} style={{ flex: 2.5, paddingHorizontal: fs(3) }}>
                          <Text style={{ fontSize: fst(10), fontWeight: '600', color: c.textMuted, letterSpacing: 0.5, marginBottom: fs(2) }}>DESCRIPTION</Text>
                          <Text style={{ fontSize: fst(11), fontWeight: '700', color: c.textPrimary }} numberOfLines={1}>{currentTicket?.mix?.description || '-'}</Text>
                        </TouchableOpacity>
                        <Text style={{ fontSize: fst(9), color: c.border, marginBottom: fs(1) }}>|</Text>
                        <View style={{ flex: 1.2, paddingHorizontal: fs(3) }}>
                          <Text style={{ fontSize: fst(10), fontWeight: '600', color: c.textMuted, letterSpacing: 0.5, marginBottom: fs(2) }}>SLUMP</Text>
                          <Text style={{ fontSize: fst(11), fontWeight: '800', color: c.textPrimary }} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.7}>{detail?.mix?.slump || '-'}</Text>
                        </View>
                        <Text style={{ fontSize: fst(9), color: c.border, marginBottom: fs(1) }}>|</Text>
                        <View style={{ flex: 1.6, paddingHorizontal: fs(3) }}>
                          <Text style={{ fontSize: fst(10), fontWeight: '600', color: c.textMuted, letterSpacing: 0.5, marginBottom: fs(2) }}>QTY/UOM</Text>
                          <Text style={{ fontSize: fst(11), fontWeight: '900', color: c.textPrimary }} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.7}>{stripUnit(detail?.mix?.quantity) || '-'} {normalizeUOM(detail?.mix?.products?.find(p => p.is_mix)?.delivered_unit) || 'm3'}</Text>
                        </View>
                        <Text style={{ fontSize: fst(9), color: c.border, marginBottom: fs(1) }}>|</Text>
                        <View style={{ flex: 1.2, paddingLeft: fs(3) }}>
                          <Text style={{ fontSize: fst(10), fontWeight: '600', color: c.textMuted, letterSpacing: 0.5, marginBottom: fs(2) }}>USAGE</Text>
                          <Text style={{ fontSize: fst(11), fontWeight: '700', color: c.textPrimary, textTransform: 'uppercase' }} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.7}>{detail?.mix?.usage || '-'}</Text>
                        </View>
                      </View>
                    </View>
                    {/* Delivery Location */}
                    <View style={{ backgroundColor: c.white, borderRadius: fs(6), borderWidth: StyleSheet.hairlineWidth, borderColor: c.border, padding: ct ? fs(6) : fs(8) }}>
                      <View style={{ borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: c.border, paddingBottom: ct ? fs(4) : fs(5), marginBottom: fs(4) }}>
                        <Text style={{ fontSize: fst(11), fontWeight: '800', color: c.textMuted, letterSpacing: 0.8, textTransform: 'uppercase' }}>Delivery Location</Text>
                      </View>
                      {[
                        { label: 'TIME DUE', value: detail?.job?.time_due_local ? formatLocalTime(detail.job.time_due_local) : '-' },
                        ...(detail?.mix?.loads?.current != null ? [{ label: 'LOAD', value: `${detail.mix.loads.current} · ${stripUnit(detail?.mix?.quantity) || '-'} of ${stripUnit(detail?.mix?.loads?.total) || '-'} ${normalizeUOM(detail?.mix?.products?.find(p => p.is_mix)?.delivered_unit) || 'M\u00B3'}` }] : []),
                        { label: 'DELIVERED TO', value: detail?.job?.delivered_to || '-', isLink: true },
                        { label: 'LOT BLOCK', value: detail?.job?.lot_block || '—' },
                      ].map((row, i, arr) => (
                        <View key={i} style={{ flexDirection: 'row', alignItems: 'center', paddingVertical: ct ? fs(7) : fs(8), borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: c.borderLight }}>
                          <Text style={{ fontSize: fst(10), fontWeight: '600', color: c.textMuted, width: '20%' }}>{row.label}</Text>
                          {row.isLink ? (
                            <TouchableOpacity activeOpacity={0.6} onPress={() => { if (currentTicket?.at_plant_time != null) setDirectionsAlert(true); else navigation.navigate('DeliveredToMap', { delivery: detail?.location?.delivery || detail?.location?.plant || detail?.location?.truck, address: row.value }); }} style={{ flex: 1 }}>
                              <Text style={{ fontSize: fst(12), fontWeight: '700', color: c.accent, textDecorationLine: 'underline' }} numberOfLines={1}>{row.value}</Text>
                            </TouchableOpacity>
                          ) : (
                            <Text style={{ fontSize: fst(12), fontWeight: '800', color: c.textPrimary, flex: 1 }} numberOfLines={1}>{row.value}</Text>
                          )}
                        </View>
                      ))}
                      {/* Trucks row */}
                      <View style={{ flexDirection: 'row', alignItems: 'center', paddingVertical: ct ? fs(7) : fs(8), borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: c.borderLight }}>
                        <Text style={{ fontSize: fst(10), fontWeight: '600', color: c.textMuted, width: '20%' }}>TRUCKS</Text>
                        <TouchableOpacity activeOpacity={0.6} onPress={() => navigation.navigate('Map', { mapItems: detail?.map || [] })} style={{ flex: 1, flexDirection: 'row', alignItems: 'center' }}>
                          <Text style={{ fontSize: fst(12), fontWeight: '800', color: c.textPrimary, flex: 1 }}>
                            {detail?.mix?.truck_ahead ? <><Text>AHEAD · {detail.mix.truck_ahead.truck_code} </Text><Text style={{ fontSize: fst(10), fontWeight: '500', color: c.textSecondary }}>{detail.mix.truck_ahead.status}</Text></> : null}
                            {detail?.mix?.truck_ahead && detail?.mix?.truck_behind ? '  |  ' : ''}
                            {detail?.mix?.truck_behind ? <><Text>BEHIND · {detail.mix.truck_behind.truck_code} </Text><Text style={{ fontSize: fst(10), fontWeight: '500', color: c.textSecondary }}>{detail.mix.truck_behind.status}</Text></> : null}
                            {!detail?.mix?.truck_ahead && !detail?.mix?.truck_behind ? '—' : null}
                          </Text>
                          {(detail?.mix?.truck_ahead || detail?.mix?.truck_behind) && <MaterialIcons name="map" size={fst(14)} color={c.accent} style={{ marginLeft: fs(4) }} />}
                        </TouchableOpacity>
                      </View>
                      {/* Instructions row */}
                      <View style={{ flexDirection: 'row', alignItems: 'flex-start', paddingVertical: ct ? fs(7) : fs(8) }}>
                        <Text style={{ fontSize: fst(10), fontWeight: '600', color: c.textMuted, width: '20%' }}>INSTRUCTIONS</Text>
                        {detail?.job?.instructions ? (
                          <View style={{ flex: 1, flexDirection: 'row', alignItems: 'flex-start' }}>
                            <View style={{ flex: 1, backgroundColor: '#FFFF00', borderRadius: 4, paddingVertical: fs(3), paddingHorizontal: fs(5) }}>
                              <Text style={{ fontSize: fst(12), fontWeight: '800', color: '#000', lineHeight: fs(18) }} numberOfLines={1}>{detail.job.instructions}</Text>
                            </View>
                            <TouchableOpacity activeOpacity={0.6} onPress={() => setInstructionsModalVisible(true)} style={{ marginLeft: fs(6), paddingVertical: fs(2), paddingHorizontal: fs(6) }}>
                              <Text style={{ fontSize: fst(10), fontWeight: '800', color: c.accent }}>VIEW ALL</Text>
                            </TouchableOpacity>
                          </View>
                        ) : (
                          <Text style={{ fontSize: fst(14), fontWeight: '800', color: c.textMuted, flex: 1 }}>—</Text>
                        )}
                      </View>
                    </View>
                  </View>
                  {/* RIGHT: Mandatory Fields */}
                  <View style={{ flex: 1 }}>
                    <View style={{ backgroundColor: c.white, borderRadius: fs(6), borderWidth: StyleSheet.hairlineWidth, borderColor: c.border, paddingTop: ct ? fs(3) : fs(5), paddingHorizontal: ct ? fs(4) : fs(6), paddingBottom: ct ? fs(6) : fs(2) }}>
                      <View style={{ flexDirection: 'row', alignItems: 'center', borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: c.border, paddingBottom: ct ? fs(1) : fs(3), marginBottom: fs(1) }}>
                        <Text style={{ fontSize: fst(11), fontWeight: '800', color: '#9C27B0', letterSpacing: 0.8, textTransform: 'uppercase', flex: 1 }}>REQUIRED ENTRIES</Text>
                        <View style={{ flexDirection: 'row', alignItems: 'center', gap: fs(4), backgroundColor: totalMandatoryFilled === totalMandatoryCount && totalMandatoryCount > 0 ? c.primarySurface : isDark ? '#2A1015' : '#FFF0F0', paddingVertical: fs(2), paddingHorizontal: fs(6), borderRadius: 10, borderWidth: 1, borderColor: totalMandatoryFilled === totalMandatoryCount && totalMandatoryCount > 0 ? c.primary + '40' : c.error + '40' }}>
                          <Text style={{ fontSize: fst(10), fontWeight: '900', color: totalMandatoryFilled === totalMandatoryCount && totalMandatoryCount > 0 ? c.primary : c.error }}>{totalMandatoryFilled}/{totalMandatoryCount}</Text>
                        </View>
                      </View>
                      {[
                        { label: 'PLANT', data: plantMandatory, icon: 'factory' as const },
                        { label: 'JOBSITE', data: jobsiteMandatory, icon: 'location-on' as const },
                        { label: 'RETURNED', data: returnedMandatory, icon: 'undo' as const },
                        { label: 'STATUS TIMES', data: timeMandatory, icon: 'schedule' as const },
                      ].map((section, si, arr) => (
                        <View key={si} style={{ marginBottom: si < arr.length - 1 ? fs(4) : 0, paddingBottom: si < arr.length - 1 ? fs(6) : 0, borderBottomWidth: si < arr.length - 1 ? StyleSheet.hairlineWidth : 0, borderBottomColor: c.borderLight }}>
                          <View style={{ flexDirection: 'row', alignItems: 'center', marginBottom: fs(3) }}>
                            <Text style={{ fontSize: fst(11), fontWeight: '800', color: c.primary, letterSpacing: 0.5, flex: 1 }}>{section.label}</Text>
                            <Text style={{ fontSize: fst(11), fontWeight: '700', color: section.data.filled === section.data.total ? c.primary : c.error }}>{section.data.filled}/{section.data.total}</Text>
                          </View>
                          {section.data.items.map((item, ii) => {
                            const itemKey = (item as any).key;
                            const isSlump = itemKey === 'slump_from_plant' || itemKey === 'slump_to_job';
                            const isWater = itemKey === 'customer_water' || itemKey === 'maintenance_water';
                            const isTappable = isSlump || isWater;
                            const Row = (
                              <View key={ii} style={{ flexDirection: 'row', alignItems: 'center', paddingVertical: fs(4), gap: fs(6) }}>
                                <View style={{ width: fs(16), height: fs(16), borderRadius: fs(8), backgroundColor: item.filled ? c.success : isDark ? '#2A1015' : '#FFF0F0', justifyContent: 'center', alignItems: 'center', overflow: 'hidden', borderWidth: item.filled ? 0 : 1.5, borderColor: c.error }}>
                                  <MaterialIcons name={item.filled ? 'check' : 'close'} size={fs(12)} color={item.filled ? '#fff' : c.error} style={{ textAlign: 'center', textAlignVertical: 'center' }} />
                                </View>
                                <Text style={{ fontSize: fst(12), fontWeight: item.filled ? '500' : '600', color: c.textPrimary, flex: 1 }} numberOfLines={1}>{item.name}</Text>
                                {item.value ? <Text style={{ fontSize: fst(12), fontWeight: '700', color: c.primary }} numberOfLines={1}>{item.value}</Text> : <Text style={{ fontSize: fst(10), color: c.textMuted }}>--</Text>}
                              </View>
                            );
                            if (isSlump) return <TouchableOpacity key={ii} activeOpacity={0.6} onPress={() => setSlumpPickerField(itemKey)}>{Row}</TouchableOpacity>;
                            if (isWater) return <TouchableOpacity key={ii} activeOpacity={0.6} onPress={() => {
                              const j = deliveryRecord?.jobsite;
                              const litresKey = itemKey === 'customer_water' ? 'customer_water_litres' : 'maintenance_water_litres';
                              const mmKey = itemKey === 'customer_water' ? 'customer_water_mm' : 'maintenance_water_mm';
                              setWaterLitresInput((j as any)?.[litresKey] != null ? String((j as any)[litresKey]) : '');
                              setWaterMmInput((j as any)?.[mmKey] != null ? String((j as any)[mmKey]) : '');
                              setWaterModalField(itemKey);
                            }}>{Row}</TouchableOpacity>;
                            if (section.label === 'STATUS TIMES') return <TouchableOpacity key={ii} activeOpacity={0.6} onPress={() => {
                              const now = new Date();
                              const existing = item.value;
                              setTimePickerHour(existing ? parseInt(existing.split(':')[0], 10) : now.getHours());
                              setTimePickerMinute(existing ? parseInt(existing.split(':')[1], 10) : now.getMinutes());
                              setTimePickerStep({ key: itemKey, label: item.name });
                            }}>{Row}</TouchableOpacity>;
                            return Row;
                          })}
                        </View>
                      ))}
                    </View>
                  </View>
                </View>
              )}
              {/* Quick Links + Additional Entries — same height row */}
              {!detailLoading && (
                <View style={{ flexDirection: 'row', gap: fs(6), marginTop: fs(1), marginBottom: '5%' }}>
                  <View style={{ flex: 1, backgroundColor: c.white, borderRadius: fs(6), borderWidth: StyleSheet.hairlineWidth, borderColor: c.border, padding: ct ? fs(6) : fs(8) }}>
                    <View style={{ borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: c.border, paddingBottom: ct ? fs(4) : fs(5), marginBottom: fs(4) }}>
                      <Text style={{ fontSize: fst(11), fontWeight: '800', color: c.textMuted, letterSpacing: 0.8, textTransform: 'uppercase' }}>QUICK LINKS</Text>
                    </View>
                    <View style={{ flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: fs(4) }}>
                      {([
                        { label: t('modals.signAccept'), screen: 'AcceptTicket' as const },
                        { label: t('modals.disputeLoad'), screen: 'DisputeTicket' as const },
                        { label: t('modals.signCurbline'), screen: 'CurblineRelease' as const },
                      ] as const).map((link, i, arr) => (
                        <View key={link.screen} style={{ flexDirection: 'row', alignItems: 'center' }}>
                          <TouchableOpacity activeOpacity={0.6} onPress={() => {
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
                            navigation.navigate(link.screen, params);
                          }}>
                            <Text style={{ fontSize: fst(10), fontWeight: '800', color: c.primary }}>{link.label}</Text>
                          </TouchableOpacity>
                          {i < arr.length - 1 && <Text style={{ fontSize: fst(10), color: c.textMuted, marginHorizontal: fs(6) }}>|</Text>}
                        </View>
                      ))}
                    </View>
                  </View>
                  <View style={{ flex: 1, backgroundColor: c.white, borderRadius: fs(6), borderWidth: StyleSheet.hairlineWidth, borderColor: c.border, padding: ct ? fs(6) : fs(8) }}>
                    <View style={{ borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: c.border, paddingBottom: ct ? fs(4) : fs(5), marginBottom: fs(4) }}>
                      <Text style={{ fontSize: fst(11), fontWeight: '800', color: '#9C27B0', letterSpacing: 0.8, textTransform: 'uppercase' }}>ADDITIONAL ENTRIES</Text>
                    </View>
                    <View style={{ flexDirection: 'row', alignItems: 'center', gap: fs(8) }}>
                      <TouchableOpacity activeOpacity={0.6} onPress={() => navigation.navigate('Notes', { ticketId: currentTicket?.id, initialTab: 'plant' })}>
                        <Text style={{ fontSize: fst(11), fontWeight: '800', color: c.primary }}>PLANT</Text>
                      </TouchableOpacity>
                      <Text style={{ fontSize: fst(11), color: c.textMuted }}>|</Text>
                      <TouchableOpacity activeOpacity={0.6} onPress={() => navigation.navigate('Notes', { ticketId: currentTicket?.id, initialTab: 'jobsite' })}>
                        <Text style={{ fontSize: fst(11), fontWeight: '800', color: c.primary }}>JOB SITE</Text>
                      </TouchableOpacity>
                      <Text style={{ fontSize: fst(11), color: c.textMuted }}>|</Text>
                      <TouchableOpacity activeOpacity={0.6} onPress={() => navigation.navigate('Notes', { ticketId: currentTicket?.id, initialTab: 'cod' })}>
                        <Text style={{ fontSize: fst(11), fontWeight: '800', color: c.primary }}>COD</Text>
                      </TouchableOpacity>
                    </View>
                  </View>
                </View>
              )}
            </View>
          );
        })() : (
          /* ═══ PORTRAIT: Scrollable ═══ */
          <ScrollView
            style={styles.scroll}
            contentContainerStyle={[styles.scrollInner, { gap: 0, flexGrow: 1, padding: wp(8), paddingLeft: Math.max(wp(10), insets.left + wp(4)), paddingRight: Math.max(wp(10), insets.right + wp(4)) }]}
            showsVerticalScrollIndicator={false}
            refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={c.primary} colors={[c.primary]} />}>
            <View style={[{ flex: 1 }, isTablet && { maxWidth: 960, alignSelf: 'center', width: '100%' }]}>
              {/* Info Bar */}
              <View style={{ backgroundColor: '#367000', borderRadius: 8, padding: wp(8), marginBottom: wp(6), flexDirection: 'row', alignItems: 'center' }}>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, flex: 1 }}>
                  <MaterialIcons name="local-shipping" size={ms(18)} color={c.primary} />
                  <View>
                    <Text style={{ fontSize: ms(11), fontWeight: '600', color: c.textOnDark60 }}>{driver?.truck_code || '-'}</Text>
                    <Text style={{ fontSize: ms(9), fontWeight: '500', color: c.textOnDark35 }}>{driver?.driver_code || '-'}</Text>
                  </View>
                </View>
                <View style={{ alignItems: 'center', flex: 2 }}>
                  <Text style={{ fontSize: ms(13), fontWeight: '900', color: c.textOnPrimary, letterSpacing: 1 }}>TICKET {currentTicket?.ticket_code || '-'}</Text>
                  <Text style={{ fontSize: ms(10), fontWeight: '600', color: c.textOnDark60 }}>ORDER {currentTicket?.order_code || '-'}</Text>
                </View>
                <View style={{ alignItems: 'flex-end', flex: 1, gap: 3 }}>
                  {currentTicket != null && (<>
                    {(() => {
                      const status = getTicketStatus(currentTicket, detail); const isActive = status.type === 'active'; const isCompleted = status.type === 'completed'; return (
                        <View style={{ backgroundColor: isActive ? c.accent : isCompleted ? '#2E7D32' : '#F59E0B', paddingVertical: 3, paddingHorizontal: 10, borderRadius: 4, flexDirection: 'row', alignItems: 'center', gap: 4 }}>
                          <View style={{ width: 5, height: 5, borderRadius: 3, backgroundColor: '#fff' }} />
                          <Text style={{ fontSize: ms(7), fontWeight: '900', color: '#fff' }}>{isActive ? 'IN TRANSIT' : status.label}</Text>
                        </View>);
                    })()}
                    <View style={{ backgroundColor: '#E53935', paddingVertical: 3, paddingHorizontal: 10, borderRadius: 4 }}>
                      <Text style={{ fontSize: ms(7), fontWeight: '900', color: '#fff' }}>{detail?.ticket?.payment_terms || PAYMENT_MAP[currentTicket.payment_form] || 'ON ACCOUNT'}</Text>
                    </View>
                  </>)}
                </View>
              </View>
              {/* Timeline */}
              {!detailLoading && (
                <View style={{ marginBottom: wp(6) }}>
                  <View style={{ flexDirection: 'row', alignItems: 'flex-start', paddingHorizontal: wp(4) }}>
                    {timeline.map((item, i) => {
                      const isActive = item.done && (i === timeline.length - 1 || !timeline[i + 1].done);
                      const isFirst = i === 0; const isLast = i === timeline.length - 1;
                      const dotSz = isActive ? wp(12) : wp(8);
                      const lineDone = item.done && !isLast && timeline[i + 1]?.done;
                      return (
                        <View key={item.labelKey} style={{ alignItems: 'center', flex: 1 }}>
                          <Text style={{ fontSize: ms(8), fontWeight: isActive ? '900' : '700', color: isActive ? c.textPrimary : item.done ? c.primary : c.textMuted, textAlign: 'center', marginBottom: 4, textTransform: 'uppercase', letterSpacing: 0.5 }} numberOfLines={1}>{item.label}</Text>
                          <View style={{ flexDirection: 'row', alignItems: 'center', height: wp(14), width: '100%' }}>
                            {isFirst ? <View style={{ flex: 1 }} /> : <View style={{ flex: 1, height: 2, backgroundColor: item.done ? c.primary : c.border }} />}
                            <View style={{ width: dotSz, height: dotSz, borderRadius: dotSz / 2, justifyContent: 'center', alignItems: 'center', backgroundColor: isActive ? '#1E88E5' : item.done ? c.primary : c.surface, borderWidth: isActive ? 3 : item.done ? 0 : 1.5, borderColor: isActive ? '#90CAF9' : c.border }}>
                              {item.done && !isActive && <MaterialIcons name="check" size={ms(5)} color={c.textOnPrimary} />}
                              {isActive && <View style={{ width: dotSz * 0.4, height: dotSz * 0.4, borderRadius: dotSz * 0.2, backgroundColor: '#fff' }} />}
                            </View>
                            {isLast ? <View style={{ flex: 1 }} /> : <View style={{ flex: 1, height: 2, backgroundColor: lineDone ? c.primary : c.border }} />}
                          </View>
                          <Text style={{ fontSize: ms(9), fontWeight: '900', color: isActive ? c.textPrimary : item.done ? c.primary : c.textMuted, textAlign: 'center', marginTop: 4 }}>{item.time}</Text>
                        </View>);
                    })}
                  </View>
                </View>
              )}
              {detailLoading && <View style={{ paddingVertical: wp(12), alignItems: 'center' }}><ActivityIndicator size="small" color={c.primary} /></View>}
              {/* Cards */}
              {!detailLoading && (
                <View style={{ gap: wp(6) }}>
                  <View style={{ backgroundColor: c.white, borderRadius: 8, borderWidth: StyleSheet.hairlineWidth, borderColor: c.border, paddingTop: wp(8), paddingHorizontal: wp(8), paddingBottom: wp(4) }}>
                    <View style={{ borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: c.border, paddingBottom: 8, marginBottom: 8 }}>
                      <Text style={{ fontSize: ms(8), fontWeight: '800', color: isDark ? '#B0BEC5' : c.textMuted, letterSpacing: 1, textTransform: 'uppercase' }}>Customer</Text>
                    </View>
                    {[{ label: 'CUSTOMER', value: detail?.job?.customer_name || '-' }, { label: 'PROJECT', value: detail?.job?.project_name || '-' }].map((row, i) => (
                      <View key={i} style={{ flexDirection: 'row', paddingVertical: 7, borderBottomWidth: i === 0 ? StyleSheet.hairlineWidth : 0, borderBottomColor: c.borderLight }}>
                        <Text style={{ fontSize: ms(8), fontWeight: '600', color: c.textMuted, width: '30%', letterSpacing: 0.5 }}>{row.label}</Text>
                        <Text style={{ fontSize: ms(8), fontWeight: '800', color: c.textPrimary, flex: 1 }}>{row.value}</Text>
                      </View>))}
                  </View>
                  {/* Product */}
                  <View style={{ backgroundColor: c.white, borderRadius: 8, borderWidth: StyleSheet.hairlineWidth, borderColor: c.border, padding: wp(8) }}>
                    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: c.border, paddingBottom: 8, marginBottom: 8 }}>
                      <Text style={{ fontSize: ms(8), fontWeight: '800', color: isDark ? '#B0BEC5' : c.textMuted, letterSpacing: 1, textTransform: 'uppercase', flex: 1 }}>PRODUCTS</Text>
                      <TouchableOpacity activeOpacity={0.6} onPress={() => setProductsVisible(true)} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
                        <MaterialIcons name="visibility" size={ms(16)} color={c.accent} />
                      </TouchableOpacity>
                    </View>
                    {/* Data row with titles */}
                    <View style={{ flexDirection: 'row', alignItems: 'flex-end' }}>
                      <View style={{ flex: 0.7, paddingRight: wp(2) }}>
                        <Text style={{ fontSize: ms(8), fontWeight: '600', color: c.textMuted, letterSpacing: 0.5, marginBottom: 2 }}>CODE</Text>
                        <Text style={{ fontSize: ms(8), fontWeight: '700', color: c.textPrimary }} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.7}>{detail?.mix?.mix_code || '-'}</Text>
                      </View>
                      <Text style={{ fontSize: ms(7), color: c.border, marginBottom: 1 }}>|</Text>
                      <TouchableOpacity activeOpacity={0.6} onPress={() => setProductsVisible(true)} style={{ flex: 2.5, paddingHorizontal: wp(2) }}>
                        <Text style={{ fontSize: ms(8), fontWeight: '600', color: c.textMuted, letterSpacing: 0.5, marginBottom: 2 }}>DESCRIPTION</Text>
                        <Text style={{ fontSize: ms(8), fontWeight: '700', color: c.textPrimary }} numberOfLines={1}>{currentTicket?.mix?.description || '-'}</Text>
                      </TouchableOpacity>
                      <Text style={{ fontSize: ms(7), color: c.border, marginBottom: 1 }}>|</Text>
                      <View style={{ flex: 1.2, paddingHorizontal: wp(2) }}>
                        <Text style={{ fontSize: ms(8), fontWeight: '600', color: c.textMuted, letterSpacing: 0.5, marginBottom: 2 }}>SLUMP</Text>
                        <Text style={{ fontSize: ms(8), fontWeight: '800', color: c.textPrimary }} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.7}>{detail?.mix?.slump || '-'}</Text>
                      </View>
                      <Text style={{ fontSize: ms(7), color: c.border, marginBottom: 1 }}>|</Text>
                      <View style={{ flex: 1.6, paddingHorizontal: wp(2) }}>
                        <Text style={{ fontSize: ms(8), fontWeight: '600', color: c.textMuted, letterSpacing: 0.5, marginBottom: 2 }}>QTY/UOM</Text>
                        <Text style={{ fontSize: ms(8), fontWeight: '900', color: c.textPrimary }} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.7}>{stripUnit(detail?.mix?.quantity) || '-'} {normalizeUOM(detail?.mix?.products?.find(p => p.is_mix)?.delivered_unit) || 'm3'}</Text>
                      </View>
                      <Text style={{ fontSize: ms(7), color: c.border, marginBottom: 1 }}>|</Text>
                      <View style={{ flex: 1.2, paddingLeft: wp(2) }}>
                        <Text style={{ fontSize: ms(8), fontWeight: '600', color: c.textMuted, letterSpacing: 0.5, marginBottom: 2 }}>USAGE</Text>
                        <Text style={{ fontSize: ms(8), fontWeight: '700', color: c.textPrimary, textTransform: 'uppercase' }} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.7}>{detail?.mix?.usage || '-'}</Text>
                      </View>
                    </View>
                  </View>
                  {/* Delivery Location */}
                  <View style={{ backgroundColor: c.white, borderRadius: 8, borderWidth: StyleSheet.hairlineWidth, borderColor: c.border, padding: wp(8) }}>
                    <View style={{ borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: c.border, paddingBottom: 8, marginBottom: 8 }}>
                      <Text style={{ fontSize: ms(8), fontWeight: '800', color: isDark ? '#B0BEC5' : c.textMuted, letterSpacing: 1, textTransform: 'uppercase' }}>Delivery Location</Text>
                    </View>
                    {[{ label: 'TIME DUE', value: detail?.job?.time_due_local ? formatLocalTime(detail.job.time_due_local) : '-' }, ...(detail?.mix?.loads?.current != null ? [{ label: 'LOAD', value: `${detail.mix.loads.current} · ${stripUnit(detail?.mix?.quantity) || '-'} of ${stripUnit(detail?.mix?.loads?.total) || '-'} ${normalizeUOM(detail?.mix?.products?.find((p: any) => p.is_mix)?.delivered_unit) || 'M\u00B3'}` }] : []), { label: 'DELIVERED TO', value: detail?.job?.delivered_to || '-', isLink: true }, { label: 'LOT BLOCK', value: detail?.job?.lot_block || '—' }].map((row, i) => (
                      <View key={i} style={{ flexDirection: 'row', alignItems: 'center', paddingVertical: 7, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: c.borderLight }}>
                        <Text style={{ fontSize: ms(8), fontWeight: '600', color: c.textMuted, width: '30%', letterSpacing: 0.5 }}>{row.label}</Text>
                        {row.isLink ? (<TouchableOpacity activeOpacity={0.6} onPress={() => { if (currentTicket?.at_plant_time != null) setDirectionsAlert(true); else navigation.navigate('DeliveredToMap', { delivery: detail?.location?.delivery || detail?.location?.plant || detail?.location?.truck, address: row.value }); }} style={{ flex: 1 }}><Text style={{ fontSize: ms(8), fontWeight: '700', color: c.accent, textDecorationLine: 'underline' }}>{row.value}</Text></TouchableOpacity>
                        ) : (<Text style={{ fontSize: ms(8), fontWeight: '800', color: c.textPrimary, flex: 1 }}>{row.value}</Text>)}
                      </View>))}
                    {/* Trucks row */}
                    <View style={{ flexDirection: 'row', alignItems: 'center', paddingVertical: 7, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: c.borderLight }}>
                      <Text style={{ fontSize: ms(8), fontWeight: '600', color: c.textMuted, width: '30%', letterSpacing: 0.5 }}>TRUCKS</Text>
                      <TouchableOpacity activeOpacity={0.6} onPress={() => navigation.navigate('Map', { mapItems: detail?.map || [] })} style={{ flex: 1, flexDirection: 'row', alignItems: 'center' }}>
                        <Text style={{ fontSize: ms(8), fontWeight: '800', color: c.textPrimary, flex: 1 }}>
                          {detail?.mix?.truck_ahead ? <><Text>AHEAD · {detail.mix.truck_ahead.truck_code} </Text><Text style={{ fontSize: ms(7), fontWeight: '500', color: c.textSecondary }}>{detail.mix.truck_ahead.status}</Text></> : null}
                          {detail?.mix?.truck_ahead && detail?.mix?.truck_behind ? '  |  ' : ''}
                          {detail?.mix?.truck_behind ? <><Text>BEHIND · {detail.mix.truck_behind.truck_code} </Text><Text style={{ fontSize: ms(7), fontWeight: '500', color: c.textSecondary }}>{detail.mix.truck_behind.status}</Text></> : null}
                          {!detail?.mix?.truck_ahead && !detail?.mix?.truck_behind ? '—' : null}
                        </Text>
                        {(detail?.mix?.truck_ahead || detail?.mix?.truck_behind) && <MaterialIcons name="map" size={ms(12)} color={c.accent} style={{ marginLeft: wp(3) }} />}
                      </TouchableOpacity>
                    </View>
                    {/* Instructions row */}
                    <View style={{ flexDirection: 'row', alignItems: 'flex-start', paddingVertical: 7 }}>
                      <Text style={{ fontSize: ms(8), fontWeight: '600', color: c.textMuted, width: '30%', letterSpacing: 0.5 }}>INSTRUCTIONS</Text>
                      {detail?.job?.instructions ? (
                        <View style={{ flex: 1, flexDirection: 'row', alignItems: 'flex-start' }}>
                          <View style={{ flex: 1, backgroundColor: '#FFFF00', borderRadius: 4, paddingVertical: 4, paddingHorizontal: 6 }}>
                            <Text style={{ fontSize: ms(8), fontWeight: '800', color: '#000', lineHeight: ms(16) }} numberOfLines={instructionsExpanded ? undefined : 1}>{detail.job.instructions}</Text>
                          </View>
                          <TouchableOpacity activeOpacity={0.6} onPress={() => setInstructionsModalVisible(true)} style={{ marginLeft: 6, paddingVertical: 3, paddingHorizontal: 6 }}>
                            <Text style={{ fontSize: ms(8), fontWeight: '800', color: c.accent }}>VIEW ALL</Text>
                          </TouchableOpacity>
                        </View>
                      ) : (
                        <Text style={{ fontSize: ms(8), fontWeight: '800', color: c.textMuted, flex: 1 }}>—</Text>
                      )}
                    </View>
                  </View>
                  <View style={{ backgroundColor: c.white, borderRadius: 8, borderWidth: StyleSheet.hairlineWidth, borderColor: c.border, paddingTop: wp(8), paddingHorizontal: wp(8), paddingBottom: wp(4) }}>
                    <View style={{ flexDirection: 'row', alignItems: 'center', borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: c.border, paddingBottom: 8, marginBottom: 8 }}>
                      <Text style={{ fontSize: ms(8), fontWeight: '900', color: '#9C27B0', letterSpacing: 0.5, textTransform: 'uppercase', flex: 1 }}>REQUIRED ENTRIES</Text>
                      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: totalMandatoryFilled === totalMandatoryCount && totalMandatoryCount > 0 ? c.primarySurface : isDark ? '#2A1015' : '#FFF0F0', paddingVertical: 4, paddingHorizontal: 12, borderRadius: 14, borderWidth: 1, borderColor: totalMandatoryFilled === totalMandatoryCount && totalMandatoryCount > 0 ? c.primary + '40' : c.error + '40' }}>
                        <Text style={{ fontSize: ms(8), fontWeight: '900', color: totalMandatoryFilled === totalMandatoryCount && totalMandatoryCount > 0 ? c.primary : c.error }}>{totalMandatoryFilled}/{totalMandatoryCount}</Text>
                      </View>
                    </View>
                    {[{ label: 'PLANT', data: plantMandatory, icon: 'factory' as const }, { label: 'JOBSITE', data: jobsiteMandatory, icon: 'location-on' as const }, { label: 'RETURNED', data: returnedMandatory, icon: 'undo' as const }, { label: 'STATUS TIMES', data: timeMandatory, icon: 'schedule' as const }].map((section, si, arr) => (
                      <View key={si} style={{ marginBottom: si < arr.length - 1 ? 4 : 0, paddingBottom: si < arr.length - 1 ? 8 : 0, borderBottomWidth: si < arr.length - 1 ? StyleSheet.hairlineWidth : 0, borderBottomColor: c.borderLight }}>
                        <View style={{ flexDirection: 'row', alignItems: 'center', marginBottom: 5 }}>
                          <Text style={{ fontSize: ms(8), fontWeight: '800', color: c.primary, letterSpacing: 0.5, flex: 1 }}>{section.label}</Text>
                          <Text style={{ fontSize: ms(8), fontWeight: '700', color: section.data.filled === section.data.total ? c.primary : c.error }}>{section.data.filled}/{section.data.total}</Text>
                        </View>
                        {section.data.items.map((item, ii) => {
                          const itemKey = (item as any).key;
                          const isSlump = itemKey === 'slump_from_plant' || itemKey === 'slump_to_job';
                          const isWater = itemKey === 'customer_water' || itemKey === 'maintenance_water';
                          const Row = (
                            <View key={ii} style={{ flexDirection: 'row', alignItems: 'center', paddingVertical: 6, gap: 7 }}>
                              <View style={{ width: 18, height: 18, borderRadius: 9, backgroundColor: item.filled ? c.success : isDark ? '#2A1015' : '#FFF0F0', justifyContent: 'center', alignItems: 'center', borderWidth: item.filled ? 0 : 1.5, borderColor: c.error }}><MaterialIcons name={item.filled ? 'check' : 'close'} size={11} color={item.filled ? '#fff' : c.error} /></View>
                              <Text style={{ fontSize: ms(8), fontWeight: item.filled ? '500' : '600', color: c.textPrimary, flex: 1 }}>{item.name}</Text>
                              {item.value ? <Text style={{ fontSize: ms(8), fontWeight: '700', color: c.primary }}>{item.value}</Text> : <Text style={{ fontSize: ms(8), color: c.textMuted }}>--</Text>}
                            </View>
                          );
                          if (isSlump) return <TouchableOpacity key={ii} activeOpacity={0.6} onPress={() => setSlumpPickerField(itemKey)}>{Row}</TouchableOpacity>;
                          if (isWater) return <TouchableOpacity key={ii} activeOpacity={0.6} onPress={() => {
                            const j = deliveryRecord?.jobsite;
                            const litresKey = itemKey === 'customer_water' ? 'customer_water_litres' : 'maintenance_water_litres';
                            const mmKey = itemKey === 'customer_water' ? 'customer_water_mm' : 'maintenance_water_mm';
                            setWaterLitresInput((j as any)?.[litresKey] != null ? String((j as any)[litresKey]) : '');
                            setWaterMmInput((j as any)?.[mmKey] != null ? String((j as any)[mmKey]) : '');
                            setWaterModalField(itemKey);
                          }}>{Row}</TouchableOpacity>;
                          if (section.label === 'STATUS TIMES') return <TouchableOpacity key={ii} activeOpacity={0.6} onPress={() => {
                            const now = new Date();
                            const existing = item.value;
                            setTimePickerHour(existing ? parseInt(existing.split(':')[0], 10) : now.getHours());
                            setTimePickerMinute(existing ? parseInt(existing.split(':')[1], 10) : now.getMinutes());
                            setTimePickerStep({ key: itemKey, label: item.name });
                          }}>{Row}</TouchableOpacity>;
                          return Row;
                        })}
                      </View>))}
                  </View>
                  {/* Additional Entries */}
                  <View style={{ backgroundColor: c.white, borderRadius: 8, borderWidth: StyleSheet.hairlineWidth, borderColor: c.border, padding: wp(8) }}>
                    <View style={{ borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: c.border, paddingBottom: 8, marginBottom: 8 }}>
                      <Text style={{ fontSize: ms(8), fontWeight: '800', color: '#9C27B0', letterSpacing: 1, textTransform: 'uppercase' }}>ADDITIONAL ENTRIES</Text>
                    </View>
                    <View style={{ flexDirection: 'row', alignItems: 'center', gap: wp(8) }}>
                      <TouchableOpacity activeOpacity={0.6} onPress={() => navigation.navigate('Notes', { ticketId: currentTicket?.id, initialTab: 'plant' })}>
                        <Text style={{ fontSize: ms(8), fontWeight: '800', color: c.primary }}>PLANT</Text>
                      </TouchableOpacity>
                      <Text style={{ fontSize: ms(8), color: c.textMuted }}>|</Text>
                      <TouchableOpacity activeOpacity={0.6} onPress={() => navigation.navigate('Notes', { ticketId: currentTicket?.id, initialTab: 'jobsite' })}>
                        <Text style={{ fontSize: ms(8), fontWeight: '800', color: c.primary }}>JOB SITE</Text>
                      </TouchableOpacity>
                      <Text style={{ fontSize: ms(8), color: c.textMuted }}>|</Text>
                      <TouchableOpacity activeOpacity={0.6} onPress={() => navigation.navigate('Notes', { ticketId: currentTicket?.id, initialTab: 'cod' })}>
                        <Text style={{ fontSize: ms(8), fontWeight: '800', color: c.primary }}>COD</Text>
                      </TouchableOpacity>
                    </View>
                  </View>
                </View>
              )}
            </View>
          </ScrollView>
        )}

      </View>{/* end main content */}

      {/* ─── BOTTOM NAV BAR (both orientations) ─── */}
      <View style={{
        flexDirection: 'row',
        alignItems: 'center',
        borderTopWidth: StyleSheet.hairlineWidth,
        borderTopColor: c.border,
        backgroundColor: c.white,
        paddingTop: L ? 2 : 4,
        paddingBottom: L ? (insets.bottom || 2) : (insets.bottom || 6),
        paddingLeft: Math.max(insets.left, L ? ls(12) : wp(8)),
        paddingRight: Math.max(insets.right, L ? ls(12) : wp(8)),
      }}>
        {/* Left: Refresh timestamp */}
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
          <TouchableOpacity onPress={handleSync} activeOpacity={0.7} style={{ flexDirection: 'row', alignItems: 'center', gap: 4, backgroundColor: c.primarySurface, paddingVertical: 4, paddingHorizontal: 8, borderRadius: 8 }}>
            <Animated.View style={{ transform: [{ rotate: syncRotate }] }}><MaterialIcons name="sync" size={12} color={c.primary} /></Animated.View>
            <Text style={{ fontSize: 10, fontWeight: '600', color: c.primary }}>REFRESHED at {lastSyncTime.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</Text>
          </TouchableOpacity>
          <View style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: isOnline ? c.success : c.error }} />
        </View>
        <View style={{ flex: 1 }} />
        {/* Right: Nav icons */}
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: L ? ls(4) : wp(2) }}>
          {BOTTOM_ACTIONS.map(renderNavBtn)}
        </View>
      </View>

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
              <Text style={[styles.ddVersion, { color: c.textMuted }]}>{appVersion ? `v${appVersion}` : '...'}</Text>
            </View>
          </Animated.View>
        </View>
      )}

      {/* ─── SLUMP PICKER MODAL ─── */}
      <ResponsiveModal
        visible={slumpPickerField != null}
        onClose={() => setSlumpPickerField(null)}
        maxWidth={L ? 250 : isTablet ? 250 : 220}
        widthPercent={L ? 20 : 50}
        maxHeightPercent={50}>
        <View style={{ paddingHorizontal: ms(10), paddingTop: ms(8), paddingBottom: ms(4), alignItems: 'center' }}>
          <Text style={{ fontSize: ms(8), fontWeight: '600', color: c.textMuted, textTransform: 'uppercase', letterSpacing: 1, textAlign: 'center' }}>REQUIRED ENTRIES</Text>
          <Text style={{ fontSize: ms(9), fontWeight: '800', color: c.textPrimary, marginTop: 1, textAlign: 'center' }}>SELECT SLUMP <Text style={{ fontSize: ms(8), fontWeight: '600', color: c.textMuted }}>mm</Text></Text>
        </View>
        <ScrollView showsVerticalScrollIndicator={true} persistentScrollbar={true} indicatorStyle={isDark ? 'white' : 'black'} bounces={false} style={{ maxHeight: L ? winHeight * 0.35 : winHeight * 0.4 }}>
            {Array.from({ length: 21 }, (_, i) => String(80 + i * 10)).map(val => {
              const currentVal = slumpPickerField === 'slump_from_plant' ? deliveryRecord?.plant?.slump_from_plant : deliveryRecord?.plant?.slump_to_job;
              const isSelected = currentVal != null && String(currentVal) === val;
              return (
                <TouchableOpacity
                  key={val}
                  activeOpacity={0.6}
                  onPress={async () => {
                    if (!currentTicket?.id || !slumpPickerField) return;
                    const body = { [slumpPickerField]: Number(val) };
                    setSlumpPickerField(null);
                    try {
                      const result = await saveDeliveryTab(currentTicket.id, 'plant', body);
                      if (!result.offline) await fetchDetail(currentTicket.id, false);
                      else {
                        setDeliveryRecord(prev => prev ? { ...prev, plant: { ...prev.plant, [slumpPickerField]: Number(val) } as any } : prev);
                      }
                    } catch { }
                  }}
                  style={{ paddingVertical: ms(5), paddingHorizontal: ms(10), borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: c.borderLight, backgroundColor: isSelected ? c.primarySurface : 'transparent', alignItems: 'center' }}>
                  <Text style={{ fontSize: ms(8), fontWeight: isSelected ? '900' : '600', color: isSelected ? c.primary : c.textPrimary, textAlign: 'center' }}>{val}</Text>
                </TouchableOpacity>
              );
            })}
        </ScrollView>
        <View style={{ alignItems: 'flex-end', paddingHorizontal: ms(10), paddingTop: ms(6), paddingBottom: ms(4) }}>
          <TouchableOpacity
            onPress={() => setSlumpPickerField(null)}
            activeOpacity={0.7}
            style={{ backgroundColor: c.primary, paddingVertical: ms(5), paddingHorizontal: ms(14), borderRadius: ms(5) }}>
            <Text style={{ fontSize: ms(8), fontWeight: '700', color: '#fff' }}>Close</Text>
          </TouchableOpacity>
        </View>
      </ResponsiveModal>

      {/* ─── TIME PICKER MODAL ─── */}
      <ResponsiveModal
        visible={timePickerStep != null}
        onClose={() => setTimePickerStep(null)}
        maxWidth={L ? 360 : isTablet ? 360 : 300}
        widthPercent={L ? 30 : 70}>
        <View style={{ backgroundColor: c.white, borderRadius: 12, overflow: 'hidden', padding: wp(16) }}>
          <Text style={{ fontSize: ms(7), fontWeight: '600', color: c.textMuted, textTransform: 'uppercase', letterSpacing: 1 }}>REQUIRED ENTRIES</Text>
          <Text style={{ fontSize: ms(11), fontWeight: '800', color: c.textPrimary, marginTop: 2, marginBottom: wp(12) }}>SELECT TIME</Text>
          <View style={{ flexDirection: 'row', marginBottom: wp(4) }}>
            <Text style={{ flex: 1, textAlign: 'center', fontSize: ms(8), fontWeight: '600', color: c.textMuted }}>Hours</Text>
            <Text style={{ flex: 1, textAlign: 'center', fontSize: ms(8), fontWeight: '600', color: c.textMuted }}>Minutes</Text>
          </View>
          <View style={{ flexDirection: 'row', height: 160, borderTopWidth: 2, borderTopColor: c.primary }}>
            <ScrollView style={{ flex: 1 }} showsVerticalScrollIndicator={true} snapToInterval={40} decelerationRate="fast"
              contentContainerStyle={{ paddingVertical: 0 }}
              onMomentumScrollEnd={(e) => { const idx = Math.round(e.nativeEvent.contentOffset.y / 40); setTimePickerHour(Math.max(0, Math.min(23, idx))); }}>
              {Array.from({ length: 24 }, (_, i) => (
                <TouchableOpacity key={i} onPress={() => setTimePickerHour(i)} style={{ height: 40, justifyContent: 'center', alignItems: 'center', backgroundColor: timePickerHour === i ? c.primarySurface : 'transparent' }}>
                  <Text style={{ fontSize: ms(12), fontWeight: timePickerHour === i ? '900' : '400', color: timePickerHour === i ? c.primary : c.textPrimary }}>{String(i).padStart(2, '0')}</Text>
                </TouchableOpacity>
              ))}
            </ScrollView>
            <View style={{ width: StyleSheet.hairlineWidth, backgroundColor: c.border }} />
            <ScrollView style={{ flex: 1 }} showsVerticalScrollIndicator={true} snapToInterval={40} decelerationRate="fast"
              contentContainerStyle={{ paddingVertical: 0 }}
              onMomentumScrollEnd={(e) => { const idx = Math.round(e.nativeEvent.contentOffset.y / 40); setTimePickerMinute(Math.max(0, Math.min(59, idx))); }}>
              {Array.from({ length: 60 }, (_, i) => (
                <TouchableOpacity key={i} onPress={() => setTimePickerMinute(i)} style={{ height: 40, justifyContent: 'center', alignItems: 'center', backgroundColor: timePickerMinute === i ? c.primarySurface : 'transparent' }}>
                  <Text style={{ fontSize: ms(12), fontWeight: timePickerMinute === i ? '900' : '400', color: timePickerMinute === i ? c.primary : c.textPrimary }}>{String(i).padStart(2, '0')}</Text>
                </TouchableOpacity>
              ))}
            </ScrollView>
          </View>
          <View style={{ flexDirection: 'row', justifyContent: 'flex-end', gap: wp(8), marginTop: wp(12) }}>
            <TouchableOpacity onPress={() => setTimePickerStep(null)} activeOpacity={0.7} style={{ paddingVertical: wp(8), paddingHorizontal: wp(16), borderRadius: 8, borderWidth: 1, borderColor: c.border }}>
              <Text style={{ fontSize: ms(9), fontWeight: '600', color: c.textPrimary }}>Cancel</Text>
            </TouchableOpacity>
            <TouchableOpacity
              activeOpacity={0.7}
              onPress={async () => {
                if (!currentTicket?.id || !timePickerStep) return;
                const uiToApi: Record<string, string> = { 'LEAVE PLANT': 'leave_plant', 'ARRIVE JOB': 'arrive_job', 'START POUR': 'start_pour', 'WASHING': 'washing', 'LEAVE JOB': 'leave_job', 'AT PLANT': 'at_plant' };
                const apiKey = uiToApi[timePickerStep.key];
                if (!apiKey) return;
                const now = new Date();
                const timeDate = new Date(now.getFullYear(), now.getMonth(), now.getDate(), timePickerHour, timePickerMinute, 0);
                const body = { [apiKey]: timeDate.toISOString() };
                setTimePickerStep(null);
                try {
                  const result = await saveDeliveryTab(currentTicket.id, 'time', body);
                  if (!result.offline) await fetchDetail(currentTicket.id, false);
                  else {
                    setDeliveryRecord(prev => {
                      if (!prev) return prev;
                      const steps = (prev.time?.steps || []).map(s => s.key === timePickerStep.key ? { ...s, done: true, time: timeDate.toISOString() } : s);
                      return { ...prev, time: { ...prev.time, steps } as any };
                    });
                  }
                } catch { }
              }}
              style={{ paddingVertical: wp(8), paddingHorizontal: wp(16), borderRadius: 8, backgroundColor: c.primary }}>
              <Text style={{ fontSize: ms(9), fontWeight: '700', color: '#fff' }}>OK</Text>
            </TouchableOpacity>
          </View>
        </View>
      </ResponsiveModal>

      {/* ─── WATER MODAL ─── */}
      <ResponsiveModal
        visible={waterModalField != null}
        onClose={() => setWaterModalField(null)}
        maxWidth={L ? 420 : isTablet ? 420 : 360}
        widthPercent={L ? 35 : 80}
        avoidKeyboard>
        <ScrollView bounces={false} keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
          <View style={{ backgroundColor: c.white, borderRadius: 12, overflow: 'hidden', padding: wp(16) }}>
            <Text style={{ fontSize: ms(9), fontWeight: '600', color: c.textMuted, textTransform: 'uppercase', letterSpacing: 1 }}>REQUIRED ENTRIES</Text>
            <Text style={{ fontSize: ms(13), fontWeight: '800', color: c.textPrimary, marginTop: 2, marginBottom: wp(14) }}>{waterModalField === 'customer_water' ? 'Customer Requested Water' : 'Maintenance Water'}</Text>
            <Text style={{ fontSize: ms(9), fontWeight: '600', color: c.textMuted, marginBottom: 4 }}>Liters</Text>
            <TextInput
              style={{ borderWidth: 1, borderColor: c.accent, borderRadius: 6, paddingVertical: wp(8), paddingHorizontal: wp(10), fontSize: ms(11), fontWeight: '600', color: c.textPrimary, marginBottom: wp(12) }}
              value={waterLitresInput}
              onChangeText={t => setWaterLitresInput(t.replace(/[^0-9.]/g, ''))}
              placeholder="Liters"
              placeholderTextColor={c.textMuted}
              keyboardType="numeric"
            />
            <Text style={{ fontSize: ms(9), fontWeight: '600', color: c.textMuted, marginBottom: 4 }}>Slump (mm)</Text>
            <TextInput
              style={{ borderWidth: 1, borderColor: c.border, borderRadius: 6, paddingVertical: wp(8), paddingHorizontal: wp(10), fontSize: ms(11), fontWeight: '600', color: c.textPrimary, marginBottom: wp(16) }}
              value={waterMmInput}
              onChangeText={t => setWaterMmInput(t.replace(/[^0-9.]/g, ''))}
              placeholder="Select slump"
              placeholderTextColor={c.textMuted}
              keyboardType="numeric"
            />
            <View style={{ flexDirection: 'row', justifyContent: 'flex-end', gap: wp(8) }}>
              <TouchableOpacity onPress={() => setWaterModalField(null)} activeOpacity={0.7} style={{ paddingVertical: wp(8), paddingHorizontal: wp(16), borderRadius: 8, borderWidth: 1, borderColor: c.border }}>
                <Text style={{ fontSize: ms(11), fontWeight: '600', color: c.textPrimary }}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity
                activeOpacity={0.7}
                onPress={async () => {
                  if (!currentTicket?.id || !waterModalField) return;
                  const litresKey = waterModalField === 'customer_water' ? 'customer_water_litres' : 'maintenance_water_litres';
                  const mmKey = waterModalField === 'customer_water' ? 'customer_water_mm' : 'maintenance_water_mm';
                  const body: Record<string, any> = {
                    [litresKey]: waterLitresInput ? Number(waterLitresInput) : null,
                    [mmKey]: waterMmInput ? Number(waterMmInput) : null,
                  };
                  setWaterModalField(null);
                  try {
                    const result = await saveDeliveryTab(currentTicket.id, 'jobsite', body);
                    if (!result.offline) await fetchDetail(currentTicket.id, false);
                    else {
                      setDeliveryRecord(prev => prev ? { ...prev, jobsite: { ...prev.jobsite, ...body } as any } : prev);
                    }
                  } catch { }
                }}
                style={{ paddingVertical: wp(8), paddingHorizontal: wp(16), borderRadius: 8, backgroundColor: c.primary }}>
                <Text style={{ fontSize: ms(11), fontWeight: '700', color: '#fff' }}>Save</Text>
              </TouchableOpacity>
            </View>
          </View>
        </ScrollView>
      </ResponsiveModal>

      {/* ─── DELIVERY INSTRUCTIONS MODAL ─── */}
      <ResponsiveModal
        visible={instructionsModalVisible}
        onClose={() => setInstructionsModalVisible(false)}
        maxWidth={L ? 500 : isTablet ? 500 : 400}
        widthPercent={L ? 40 : 80}>
        <View style={{ backgroundColor: c.white, borderRadius: 12, overflow: 'hidden' }}>
          <View style={{ paddingHorizontal: wp(16), paddingTop: wp(16), paddingBottom: wp(10) }}>
            <Text style={{ fontSize: ms(12), fontWeight: '800', color: c.textPrimary, letterSpacing: 1, textTransform: 'uppercase' }}>DELIVERY INSTRUCTIONS</Text>
          </View>
          <View style={{ paddingHorizontal: wp(16), paddingBottom: wp(16) }}>
            {(detail?.job?.instructions || '').split(/[*•\n]+/).filter((s: string) => s.trim()).map((line: string, i: number) => (
              <View key={i} style={{ flexDirection: 'row', alignItems: 'flex-start', marginBottom: wp(8) }}>
                <Text style={{ fontSize: ms(11), color: c.textPrimary, marginRight: wp(8) }}>•</Text>
                <Text style={{ fontSize: ms(11), fontWeight: '600', color: c.textPrimary, flex: 1, lineHeight: ms(18) }}>{line.trim()}</Text>
              </View>
            ))}
          </View>
          <TouchableOpacity
            onPress={() => setInstructionsModalVisible(false)}
            activeOpacity={0.7}
            style={{ alignSelf: 'flex-end', backgroundColor: c.primary, paddingVertical: wp(8), paddingHorizontal: wp(20), borderRadius: 8, margin: wp(16), marginTop: 0 }}>
            <Text style={{ fontSize: ms(11), fontWeight: '700', color: '#fff' }}>Close</Text>
          </TouchableOpacity>
        </View>
      </ResponsiveModal>

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
              <Text style={[styles.qrHeaderTitle, { color: c.qrFg }, L && { fontSize: ls(12) }]}>QR Code</Text>
              <Text style={[styles.qrHeaderSub, { color: c.qrFg + '90' }, L && { fontSize: ls(9) }]}>Scan to verify delivery</Text>
            </View>
            <TouchableOpacity style={[styles.mCloseBtn, { backgroundColor: c.qrFg + '12' }, L && { width: ls(28), height: ls(28), borderRadius: ls(14) }]} onPress={() => setQrVisible(false)} activeOpacity={0.7} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
              <MaterialIcons name="close" size={L ? ls(14) : ms(18)} color={c.qrFg} />
            </TouchableOpacity>
          </View>

          {qrLoading ? (
            <View style={{ paddingVertical: L ? ls(30) : wp(40), alignItems: 'center' }}>
              <ActivityIndicator size={L ? 'small' : 'large'} color={c.qrFg} />
            </View>
          ) : qrError ? (
            <View style={{ paddingVertical: L ? ls(20) : wp(30), alignItems: 'center', paddingHorizontal: L ? ls(16) : wp(20) }}>
              <MaterialIcons name="error-outline" size={L ? ls(28) : ms(36)} color={c.qrFg + '60'} />
              <Text style={{ fontSize: L ? ls(12) : ms(13), fontWeight: '700', color: c.qrFg, marginTop: L ? ls(8) : wp(10), textAlign: 'center' }}>Server Error</Text>
              <Text style={{ fontSize: L ? ls(10) : ms(11), color: c.qrFg + '80', marginTop: L ? ls(3) : wp(4), textAlign: 'center' }}>Unable to load QR code. Please try again later.</Text>
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
                style={{ flexDirection: 'row', alignItems: 'center', gap: L ? ls(4) : wp(5), marginTop: L ? ls(12) : wp(16), backgroundColor: c.qrFg + '18', paddingVertical: L ? ls(6) : wp(8), paddingHorizontal: L ? ls(16) : wp(20), borderRadius: L ? ls(6) : wp(8) }}>
                <MaterialIcons name="refresh" size={L ? ls(12) : ms(14)} color={c.qrFg} />
                <Text style={{ fontSize: L ? ls(10) : ms(11), fontWeight: '700', color: c.qrFg }}>Retry</Text>
              </TouchableOpacity>
            </View>
          ) : qrData ? (
            <ScrollView
              bounces={false}
              showsVerticalScrollIndicator={false}
              contentContainerStyle={{ alignItems: 'center', paddingVertical: L ? ls(4) : wp(6) }}>
              <View style={[styles.qrChipRow, L && { gap: ls(5), paddingHorizontal: ls(10) }]}>
                <View style={[styles.qrChip, { backgroundColor: c.qrFg + '12' }, L && { paddingVertical: ls(5), borderRadius: ls(6) }]}>
                  <Text style={[styles.qrChipLabel, { color: c.qrFg + '80' }, L && { fontSize: ls(9) }]}>ORDER</Text>
                  <Text style={[styles.qrChipValue, { color: c.qrFg }, L && { fontSize: ls(11) }]}>{qrData.order_code || '-'}</Text>
                </View>
                <View style={[styles.qrChip, { backgroundColor: c.qrFg + '12' }, L && { paddingVertical: ls(5), borderRadius: ls(6) }]}>
                  <Text style={[styles.qrChipLabel, { color: c.qrFg + '80' }, L && { fontSize: ls(9) }]}>TICKET</Text>
                  <Text style={[styles.qrChipValue, { color: c.qrFg }, L && { fontSize: ls(11) }]}>{qrData.ticket_code || '-'}</Text>
                </View>
              </View>
              <View style={[styles.qrCodeSection, L && { paddingVertical: ls(8), paddingHorizontal: ls(8) }]}>
                <View style={[styles.qrCodeCard, { backgroundColor: c.white, shadowColor: c.shadowColor }, L && { padding: ls(10), borderRadius: ls(10) }]}>
                  <QRCode
                    value={qrData.qr_token}
                    size={L ? Math.round(Math.min(Math.max((winHeight - insets.top - insets.bottom) * 0.35, 120), lt ? 220 : 160)) : Math.round(Math.min(Math.max((width - insets.left - insets.right) * 0.45, 150), isTablet ? 260 : 200))}
                    backgroundColor={c.white}
                    color={c.qrFg}
                  />
                </View>
              </View>
              <View style={[styles.qrFooter, L && { paddingHorizontal: ls(10), gap: ls(3) }]}>
                <View style={[styles.qrFooterRow, { borderTopColor: c.qrFg + '12' }, L && { gap: ls(4), paddingTop: ls(2) }]}>
                  <MaterialIcons name="local-shipping" size={L ? ls(10) : ms(12)} color={c.qrFg + '70'} />
                  <Text style={[styles.qrFooterText, { color: c.qrFg + '70' }, L && { fontSize: ls(10) }]}>{`TRUCK ${qrData.truck_code || '-'} · DRIVER ${qrData.driver_code || '-'}`}</Text>
                </View>
                <View style={[styles.qrFooterRow, L && { gap: ls(4) }]}>
                  <MaterialIcons name="factory" size={L ? ls(10) : ms(12)} color={c.qrFg + '70'} />
                  <Text style={[styles.qrFooterText, { color: c.qrFg + '70' }, L && { fontSize: ls(10) }]}>{qrData.plant_name || '-'}</Text>
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
          <View style={{ paddingVertical: wp(40), alignItems: 'center' }}>
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
            onLayout={({ nativeEvent }) => { plantsLayoutH.current = nativeEvent.layout.height; checkPlantsAutoLoad(); }}
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
              <View style={{ paddingVertical: wp(12), alignItems: 'center' }}>
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
        widthPercent={L ? 40 : 50}
        maxWidth={560}
        maxHeightPercent={55}>
        <View style={[styles.pmHeader, { backgroundColor: c.primarySurface, borderBottomColor: c.primaryBorder }]}>
          <View style={[styles.pmHeaderIcon, { backgroundColor: c.primary }]}>
            <MaterialIcons name="inventory-2" size={ms(16)} color={c.textOnPrimary} />
          </View>
          <View style={common.flex1}>
            <Text style={[styles.pmTitle, { color: c.textPrimary }]}>PRODUCTS, CHARGES & FEES</Text>
            <Text style={[styles.pmSubtitle, { color: c.textMuted }]} numberOfLines={1}>Ticket {currentTicket?.ticket_code || '-'}</Text>
          </View>
        </View>
        <ScrollView showsVerticalScrollIndicator={false} bounces={false} contentContainerStyle={styles.pmBody}>
          {/* Table Header */}
          <View style={[styles.pmRow, styles.pmRowHeader, { borderBottomColor: c.textPrimary }]}>
            <Text style={[styles.pmColCode, styles.pmTh, { color: c.textPrimary }]}>CODE</Text>
            <Text style={[styles.pmColDesc, styles.pmTh, { color: c.textPrimary }]}>DESCRIPTION</Text>
            <Text style={[{ flex: 1, textAlign: 'right' }, styles.pmTh, { color: c.textPrimary }]}>SLUMP</Text>
            <Text style={[styles.pmColQty, styles.pmTh, { color: c.textPrimary }]}>QTY</Text>
            <Text style={[styles.pmColUnit, styles.pmTh, { color: c.textPrimary }]}>UNIT</Text>
          </View>
          {/* Table Rows */}
          {(() => {
            const mixProducts = detail?.mix?.products || [];
            let rows = mixProducts.length > 0 ? mixProducts : (currentTicket?.mix ? [{
              code: detail?.mix?.mix_code || currentTicket.mix.mix_code || '-',
              description: currentTicket.mix.description || '-',
              is_mix: true,
              delivered_qty: detail?.mix?.quantity ? parseFloat(stripUnit(detail.mix.quantity) || '0') : null,
              delivered_unit: 'm3',
              slump_text: detail?.mix?.slump || currentTicket.mix.slump || null,
            } as any] : []);
            return rows.length > 0 ? rows.map((product: any, i: number) => (
              <View key={`${product.code}-${i}`} style={[styles.pmRow, { borderBottomColor: c.borderLight }]}>
                <Text style={[styles.pmColCode, styles.pmTd, { color: c.textPrimary }]} numberOfLines={1}>{product.code || '-'}</Text>
                <Text style={[styles.pmColDesc, styles.pmTd, { color: c.textPrimary }]} numberOfLines={2}>{product.description || '-'}</Text>
                <Text style={[{ flex: 1, textAlign: 'right' }, styles.pmTd, { color: c.textPrimary }]}>{product.is_mix ? (product.slump_text || detail?.mix?.slump || '-') : '-'}</Text>
                <Text style={[styles.pmColQty, styles.pmTd, { color: c.textPrimary }]}>{product.delivered_qty != null ? String(product.delivered_qty) : '-'}</Text>
                <Text style={[styles.pmColUnit, styles.pmTd, { color: c.textPrimary }]}>{product.delivered_unit || '-'}</Text>
              </View>
            )) : (
              <View style={{ padding: wp(16), alignItems: 'center' }}>
                <Text style={{ color: c.textMuted, fontSize: ms(10) }}>No product data available</Text>
              </View>
            );
          })()}
        </ScrollView>
        <View style={{ alignItems: 'flex-end', paddingHorizontal: ms(10), paddingTop: ms(8), paddingBottom: ms(4), borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: c.border }}>
          <TouchableOpacity
            onPress={() => setProductsVisible(false)}
            activeOpacity={0.7}
            style={{ backgroundColor: c.primary, paddingVertical: ms(5), paddingHorizontal: ms(14), borderRadius: ms(5) }}>
            <Text style={{ fontSize: ms(8), fontWeight: '700', color: '#fff' }}>Close</Text>
          </TouchableOpacity>
        </View>
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
              { code: 'en', label: 'English', flag: '🇺🇸' },
              { code: 'fr-CA', label: 'Français (CA)', flag: '🇨🇦' },
              { code: 'es', label: 'Español', flag: '🇲🇽' },
              { code: 'pt-BR', label: 'Português (BR)', flag: '🇧🇷' },
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
            <TouchableOpacity style={[styles.mCloseBtn, { backgroundColor: c.surface }]} onPress={() => setDetailsVisible(false)} activeOpacity={0.7} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
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

      {/* ─── FONT SIZE MODAL ─── */}
      <ResponsiveModal
        visible={fontSizeVisible}
        onClose={() => setFontSizeVisible(false)}
        maxWidth={320}
        widthPercent={isLandscape ? 35 : 75}>
        <View style={{ padding: wp(16), alignItems: 'center' }}>
          <TouchableOpacity style={[styles.mCloseBtn, { backgroundColor: c.surface, position: 'absolute', top: wp(10), right: wp(10), zIndex: 10 }]} onPress={() => setFontSizeVisible(false)} activeOpacity={0.7} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
            <MaterialIcons name="close" size={ms(18)} color={c.textSecondary} />
          </TouchableOpacity>
          <View style={{ width: wp(44), height: wp(44), borderRadius: wp(22), backgroundColor: c.primarySurface, justifyContent: 'center', alignItems: 'center', marginBottom: wp(8) }}>
            <Text style={{ fontSize: ms(24), fontWeight: '900', color: c.primary }}>A</Text>
          </View>
          <Text style={{ fontSize: ms(14), fontWeight: '800', color: c.textPrimary, marginBottom: wp(4) }}>Font Size</Text>
          <Text style={{ fontSize: ms(24), fontWeight: '900', color: c.primary, marginBottom: wp(12) }}>{Math.round(fontScale * 100)}%</Text>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: wp(12), marginBottom: wp(12) }}>
            <TouchableOpacity
              onPress={fontDecrease}
              disabled={fontScale <= 0.85}
              activeOpacity={0.7}
              style={{ width: wp(44), height: wp(44), borderRadius: wp(12), backgroundColor: fontScale <= 0.85 ? c.surface : c.surface, justifyContent: 'center', alignItems: 'center', borderWidth: 1, borderColor: c.border }}>
              <Text style={{ fontSize: ms(14), fontWeight: '800', color: fontScale <= 0.85 ? c.textMuted : c.textPrimary }}>A-</Text>
            </TouchableOpacity>
            <View style={{ flex: 1, height: 6, borderRadius: 3, backgroundColor: c.surface, overflow: 'hidden' }}>
              <View style={{ width: `${((fontScale - 0.85) / (1.30 - 0.85)) * 100}%`, height: '100%', borderRadius: 3, backgroundColor: c.primary }} />
            </View>
            <TouchableOpacity
              onPress={fontIncrease}
              disabled={fontScale >= 1.30}
              activeOpacity={0.7}
              style={{ width: wp(44), height: wp(44), borderRadius: wp(12), backgroundColor: fontScale >= 1.30 ? c.surface : c.surface, justifyContent: 'center', alignItems: 'center', borderWidth: 1, borderColor: c.border }}>
              <Text style={{ fontSize: ms(18), fontWeight: '800', color: fontScale >= 1.30 ? c.textMuted : c.textPrimary }}>A+</Text>
            </TouchableOpacity>
          </View>
          <TouchableOpacity
            onPress={() => { fontReset(); }}
            disabled={Math.round(fontScale * 100) === 100}
            activeOpacity={0.7}
            style={{ paddingVertical: wp(8), paddingHorizontal: wp(20), borderRadius: wp(8), backgroundColor: Math.round(fontScale * 100) === 100 ? c.surface : c.primary }}>
            <Text style={{ fontSize: ms(12), fontWeight: '700', color: Math.round(fontScale * 100) === 100 ? c.textMuted : c.textOnPrimary }}>Reset to 100%</Text>
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
  tabsRow: { flexDirection: 'row', gap: ms(4), paddingBottom: ms(2) },
  tab: { flexDirection: 'row', alignItems: 'center', gap: ms(5), paddingVertical: ms(3), paddingHorizontal: ms(6), borderRadius: ms(20), borderWidth: 0.5 },
  tabDot: { width: ms(5), height: ms(5), borderRadius: ms(3) },
  tabText: { fontWeight: '800', fontSize: ms(8), letterSpacing: 0.2 },

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
  pmHeader: { flexDirection: 'row', alignItems: 'center', gap: ms(6), paddingHorizontal: ms(10), paddingVertical: ms(8), borderBottomWidth: 1 },
  pmHeaderIcon: { width: ms(24), height: ms(24), borderRadius: ms(7), justifyContent: 'center', alignItems: 'center' },
  pmTitle: { fontSize: ms(9), fontWeight: '800', letterSpacing: 0.3 },
  pmSubtitle: { fontSize: ms(8), fontWeight: '500', marginTop: 1 },
  pmBody: { paddingHorizontal: ms(10), paddingTop: ms(3), paddingBottom: ms(10) },
  pmRow: { flexDirection: 'row', alignItems: 'center', paddingVertical: ms(5), paddingHorizontal: ms(3), borderBottomWidth: 0.5, borderRadius: ms(3) },
  pmRowHeader: { borderBottomWidth: 1.5, paddingBottom: ms(4), marginBottom: ms(2) },
  pmColCode: { width: ms(45) },
  pmColDesc: { flex: 2, paddingRight: ms(6) },
  pmColQty: { width: ms(30), textAlign: 'right' },
  pmColUnit: { width: ms(25), textAlign: 'center' },
  pmTh: { fontSize: ms(8), fontWeight: '900', letterSpacing: 0.5 },
  pmTd: { fontSize: ms(8), fontWeight: '500' },

  // Logout confirmation modal
  logoutIconWrap: { width: wp(48), height: wp(48), borderRadius: wp(24), justifyContent: 'center', alignItems: 'center', marginBottom: wp(10) },
  logoutTitle: { fontSize: ms(13), fontWeight: '700', marginBottom: wp(4) },
  logoutMessage: { fontSize: ms(10), fontWeight: '400', textAlign: 'center', lineHeight: ms(15), marginBottom: wp(14) },
  logoutButtons: { flexDirection: 'row', gap: wp(8), width: '100%' },
  logoutBtn: { flex: 1, paddingVertical: wp(10), borderRadius: wp(10), alignItems: 'center', justifyContent: 'center' },
  logoutBtnText: { fontSize: ms(10), fontWeight: '600' },
});
