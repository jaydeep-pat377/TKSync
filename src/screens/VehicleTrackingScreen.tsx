import React, {useState, useEffect, useRef, useCallback} from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  StatusBar,
  Platform,
  PermissionsAndroid,
  AppState,
  Animated,
  useWindowDimensions,
} from 'react-native';
import {useSafeAreaInsets} from 'react-native-safe-area-context';
import MaterialIcons from 'react-native-vector-icons/MaterialIcons';
import type {NativeStackNavigationProp} from '@react-navigation/native-stack';
import Geolocation from 'react-native-geolocation-service';
import {accelerometer, SensorTypes, setUpdateIntervalForType} from 'react-native-sensors';
import {useTheme} from '../contexts/ThemeContext';
import {useAuth} from '../contexts/AuthContext';
import {wp, ms} from '../utils/responsive';

type Props = {
  navigation: NativeStackNavigationProp<any>;
};

const HARD_BRAKE_THRESHOLD = 6;
const HARD_CORNER_THRESHOLD = 5;
const IDLE_SPEED_THRESHOLD = 1;

const toKmh = (v: number) => Math.round(v * 3.6);
const toCompass = (deg: number): string => {
  const dirs = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'];
  return dirs[Math.round(deg / 45) % 8];
};
const formatDuration = (seconds: number): string => {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);
  if (h > 0) return `${h}h ${m}m`;
  if (m > 0) return `${m}m ${s}s`;
  return `${s}s`;
};

export default function VehicleTrackingScreen({navigation}: Props) {
  const {c} = useTheme();
  const {driver} = useAuth();
  const insets = useSafeAreaInsets();
  const {width, height} = useWindowDimensions();
  const L = width > height; // landscape
  const isTablet = Math.min(width, height) > 600;

  // GPS state
  const [speed, setSpeed] = useState(0);
  const [heading, setHeading] = useState(0);
  const [altitude, setAltitude] = useState(0);
  const [latitude, setLatitude] = useState(0);
  const [longitude, setLongitude] = useState(0);
  const [accuracy, setAccuracy] = useState(0);
  const [gpsActive, setGpsActive] = useState(false);

  // Trip state
  const [tripDistance, setTripDistance] = useState(0);
  const [tripDuration, setTripDuration] = useState(0);
  const [maxSpeed, setMaxSpeed] = useState(0);
  const [avgSpeed, setAvgSpeed] = useState(0);
  const speedSamples = useRef<number[]>([]);

  // Idle
  const [isIdle, setIsIdle] = useState(false);
  const [idleTime, setIdleTime] = useState(0);
  const idleStart = useRef<number | null>(null);

  // Behaviour
  const [hardBrakes, setHardBrakes] = useState(0);
  const [hardCorners, setHardCorners] = useState(0);
  const [accelX, setAccelX] = useState(0);
  const [accelY, setAccelY] = useState(0);

  // Broadcasting
  const [isBroadcasting, setIsBroadcasting] = useState(false);

  // Tracking
  const [isTracking, setIsTracking] = useState(false);
  const watchId = useRef<number | null>(null);
  const lastPos = useRef<{lat: number; lng: number} | null>(null);
  const tripStartTime = useRef<number>(0);
  const tripTimer = useRef<ReturnType<typeof setInterval> | null>(null);
  const accelSub = useRef<any>(null);

  // Pulse animation for GPS indicator
  const pulseAnim = useRef(new Animated.Value(1)).current;
  useEffect(() => {
    if (gpsActive) {
      const loop = Animated.loop(
        Animated.sequence([
          Animated.timing(pulseAnim, {toValue: 1.3, duration: 800, useNativeDriver: true}),
          Animated.timing(pulseAnim, {toValue: 1, duration: 800, useNativeDriver: true}),
        ]),
      );
      loop.start();
      return () => loop.stop();
    }
    pulseAnim.setValue(1);
  }, [gpsActive, pulseAnim]);

  const haversine = useCallback((lat1: number, lon1: number, lat2: number, lon2: number): number => {
    const R = 6371000;
    const dLat = ((lat2 - lat1) * Math.PI) / 180;
    const dLon = ((lon2 - lon1) * Math.PI) / 180;
    const a = Math.sin(dLat / 2) ** 2 + Math.cos((lat1 * Math.PI) / 180) * Math.cos((lat2 * Math.PI) / 180) * Math.sin(dLon / 2) ** 2;
    return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  }, []);

  const requestPermission = useCallback(async (): Promise<boolean> => {
    if (Platform.OS === 'ios') return true;
    const granted = await PermissionsAndroid.request(
      PermissionsAndroid.PERMISSIONS.ACCESS_FINE_LOCATION,
      {title: 'Location Permission', message: 'Vehicle tracking needs access to your location.', buttonPositive: 'OK'},
    );
    return granted === PermissionsAndroid.RESULTS.GRANTED;
  }, []);

  const startTracking = useCallback(async () => {
    const hasPermission = await requestPermission();
    if (!hasPermission) return;
    setIsTracking(true);
    setGpsActive(true);
    tripStartTime.current = Date.now();
    lastPos.current = null;
    setTripDistance(0);
    setTripDuration(0);
    setMaxSpeed(0);
    setAvgSpeed(0);
    setHardBrakes(0);
    setHardCorners(0);
    setIdleTime(0);
    speedSamples.current = [];

    tripTimer.current = setInterval(() => {
      setTripDuration(Math.floor((Date.now() - tripStartTime.current) / 1000));
    }, 1000);

    watchId.current = Geolocation.watchPosition(
      (position) => {
        const {latitude: lat, longitude: lng, speed: spd, heading: hdg, altitude: alt, accuracy: acc} = position.coords;
        const currentSpeed = Math.max(0, spd || 0);
        setLatitude(lat);
        setLongitude(lng);
        setSpeed(currentSpeed);
        setHeading(hdg || 0);
        setAltitude(alt || 0);
        setAccuracy(acc || 0);
        setMaxSpeed(prev => Math.max(prev, currentSpeed));
        speedSamples.current.push(currentSpeed);
        setAvgSpeed(speedSamples.current.reduce((a, b) => a + b, 0) / speedSamples.current.length);
        if (lastPos.current) {
          const dist = haversine(lastPos.current.lat, lastPos.current.lng, lat, lng);
          if (dist > 3) {
            setTripDistance(prev => prev + dist);
            lastPos.current = {lat, lng};
          }
        } else {
          lastPos.current = {lat, lng};
        }
        if (currentSpeed < IDLE_SPEED_THRESHOLD) {
          if (!idleStart.current) idleStart.current = Date.now();
          setIsIdle(true);
          setIdleTime(Math.floor((Date.now() - idleStart.current) / 1000));
        } else {
          idleStart.current = null;
          setIsIdle(false);
          setIdleTime(0);
        }
      },
      (error) => { console.warn('GPS Error:', error.message); setGpsActive(false); },
      {enableHighAccuracy: true, distanceFilter: 5, interval: 2000, fastestInterval: 1000, showLocationDialog: true, forceRequestLocation: true},
    );

    setUpdateIntervalForType(SensorTypes.accelerometer, 200);
    accelSub.current = accelerometer.subscribe(({x, y}) => {
      setAccelX(x);
      setAccelY(y);
      if (Math.abs(y) > HARD_BRAKE_THRESHOLD) setHardBrakes(prev => prev + 1);
      if (Math.abs(x) > HARD_CORNER_THRESHOLD) setHardCorners(prev => prev + 1);
    });
  }, [requestPermission, haversine]);

  const stopTracking = useCallback(() => {
    if (watchId.current !== null) { Geolocation.clearWatch(watchId.current); watchId.current = null; }
    if (tripTimer.current) { clearInterval(tripTimer.current); tripTimer.current = null; }
    if (accelSub.current) { accelSub.current.unsubscribe(); accelSub.current = null; }
    setIsTracking(false);
    setGpsActive(false);
  }, []);

  useEffect(() => { return () => { stopTracking(); }; }, [stopTracking]);

  useEffect(() => {
    const sub = AppState.addEventListener('change', () => {});
    return () => sub.remove();
  }, []);

  const speedKmh = toKmh(speed);
  const maxSpeedKmh = toKmh(maxSpeed);
  const avgSpeedKmh = toKmh(avgSpeed);
  const distanceKm = (tripDistance / 1000).toFixed(2);
  const compassDir = toCompass(heading);

  // ── Shared UI blocks ──
  const heroBlock = (
    <View style={[st.heroSection, {backgroundColor: c.primaryDark}, L && {flex: 1, paddingVertical: wp(8), justifyContent: 'center'}]}>
      <View style={[st.speedRing, L && {width: wp(100), height: wp(100), borderRadius: wp(50), borderWidth: wp(3)}]}>
        <View style={[st.speedRingInner, {borderColor: 'rgba(255,255,255,0.08)'}, L && {width: wp(84), height: wp(84), borderRadius: wp(42)}]}>
          <Text style={[st.speedValue, L && {fontSize: ms(32)}]}>{speedKmh}</Text>
          <Text style={[st.speedUnit, L && {fontSize: ms(9)}]}>km/h</Text>
        </View>
      </View>
      <View style={[st.heroStatsRow, L && {marginTop: wp(10)}]}>
        <View style={st.heroStat}>
          <MaterialIcons name="explore" size={ms(L ? 11 : 14)} color="rgba(255,255,255,0.5)" />
          <Text style={[st.heroStatValue, L && {fontSize: ms(9)}]}>{Math.round(heading)}° {compassDir}</Text>
          <Text style={[st.heroStatLabel, L && {fontSize: ms(7)}]}>Heading</Text>
        </View>
        <View style={[st.heroStatDivider, {backgroundColor: 'rgba(255,255,255,0.1)'}]} />
        <View style={st.heroStat}>
          <MaterialIcons name="terrain" size={ms(L ? 11 : 14)} color="rgba(255,255,255,0.5)" />
          <Text style={[st.heroStatValue, L && {fontSize: ms(9)}]}>{Math.round(altitude)}m</Text>
          <Text style={[st.heroStatLabel, L && {fontSize: ms(7)}]}>Altitude</Text>
        </View>
        <View style={[st.heroStatDivider, {backgroundColor: 'rgba(255,255,255,0.1)'}]} />
        <View style={st.heroStat}>
          <MaterialIcons name="gps-fixed" size={ms(L ? 11 : 14)} color="rgba(255,255,255,0.5)" />
          <Text style={[st.heroStatValue, L && {fontSize: ms(9)}]}>{Math.round(accuracy)}m</Text>
          <Text style={[st.heroStatLabel, L && {fontSize: ms(7)}]}>Accuracy</Text>
        </View>
      </View>
      {isIdle && isTracking && (
        <View style={[st.idleBadge, L && {marginTop: wp(6)}]}>
          <MaterialIcons name="pause-circle-filled" size={ms(11)} color="#EF4444" />
          <Text style={[st.idleBadgeText, {color: '#EF4444'}]}>IDLE {formatDuration(idleTime)}</Text>
        </View>
      )}
      <TouchableOpacity
        style={[st.trackBtn, {backgroundColor: isTracking ? '#EF4444' : '#22C55E'}, L && {marginTop: wp(8), paddingVertical: wp(7), paddingHorizontal: wp(18)}]}
        activeOpacity={0.8}
        onPress={isTracking ? stopTracking : startTracking}>
        <MaterialIcons name={isTracking ? 'stop' : 'play-arrow'} size={ms(L ? 14 : 16)} color="#fff" />
        <Text style={[st.trackBtnText, L && {fontSize: ms(10)}]}>{isTracking ? 'Stop Tracking' : 'Start Tracking'}</Text>
      </TouchableOpacity>
    </View>
  );

  const cardsContent = (
    <ScrollView
      style={{flex: 1}}
      contentContainerStyle={[st.scrollContent, {paddingBottom: insets.bottom + wp(24), paddingHorizontal: L ? wp(10) : wp(14)}]}
      showsVerticalScrollIndicator={false}>

      {/* ── TRIP STATS ── */}
      <View style={[st.card, {backgroundColor: c.white, borderColor: c.borderLight}]}>
        <View style={st.cardHeader}>
          <View style={[st.cardIconBg, {backgroundColor: c.primary + '15'}]}>
            <MaterialIcons name="route" size={ms(14)} color={c.primary} />
          </View>
          <Text style={[st.cardTitle, {color: c.textPrimary}]}>Trip Statistics</Text>
          {isTracking && <View style={[st.liveDot, {backgroundColor: '#22C55E'}]} />}
        </View>
        <View style={st.statsGrid}>
          {[
            {icon: 'straighten', label: 'Distance', value: distanceKm, unit: 'km', color: c.primary},
            {icon: 'timer', label: 'Duration', value: formatDuration(tripDuration), unit: '', color: c.accent},
            {icon: 'speed', label: 'Max Speed', value: `${maxSpeedKmh}`, unit: 'km/h', color: '#EF4444'},
            {icon: 'analytics', label: 'Avg Speed', value: `${avgSpeedKmh}`, unit: 'km/h', color: '#F59E0B'},
          ].map((item, i) => (
            <View key={i} style={[st.statItem, {borderColor: c.borderLight}]}>
              <MaterialIcons name={item.icon as any} size={ms(15)} color={item.color} />
              <Text style={[st.statValue, {color: c.textPrimary}]}>{item.value}<Text style={[st.statUnit, {color: c.textMuted}]}> {item.unit}</Text></Text>
              <Text style={[st.statLabel, {color: c.textMuted}]}>{item.label}</Text>
            </View>
          ))}
        </View>
      </View>

      {/* ── DRIVING BEHAVIOUR ── */}
      <View style={[st.card, {backgroundColor: c.white, borderColor: c.borderLight}]}>
        <View style={st.cardHeader}>
          <View style={[st.cardIconBg, {backgroundColor: '#8B5CF6' + '15'}]}>
            <MaterialIcons name="shield" size={ms(14)} color="#8B5CF6" />
          </View>
          <Text style={[st.cardTitle, {color: c.textPrimary}]}>Driving Behaviour</Text>
        </View>
        <View style={st.behaviourRow}>
          <View style={[st.behaviourItem, {backgroundColor: '#FEF2F2', borderColor: '#FECACA'}]}>
            <MaterialIcons name="warning" size={ms(18)} color="#EF4444" />
            <Text style={[st.behaviourValue, {color: '#EF4444'}]}>{hardBrakes}</Text>
            <Text style={st.behaviourLabel}>Hard Brakes</Text>
          </View>
          <View style={[st.behaviourItem, {backgroundColor: '#FFFBEB', borderColor: '#FDE68A'}]}>
            <MaterialIcons name="turn-sharp-right" size={ms(18)} color="#F59E0B" />
            <Text style={[st.behaviourValue, {color: '#F59E0B'}]}>{hardCorners}</Text>
            <Text style={st.behaviourLabel}>Hard Corners</Text>
          </View>
          <View style={[st.behaviourItem, {backgroundColor: isIdle ? '#FEF2F2' : '#F0FDF4', borderColor: isIdle ? '#FECACA' : '#BBF7D0'}]}>
            <MaterialIcons name={isIdle ? 'pause-circle-filled' : 'directions-car'} size={ms(18)} color={isIdle ? '#EF4444' : '#22C55E'} />
            <Text style={[st.behaviourValue, {color: isIdle ? '#EF4444' : '#22C55E'}]}>{isIdle ? formatDuration(idleTime) : 'Moving'}</Text>
            <Text style={st.behaviourLabel}>Status</Text>
          </View>
        </View>
      </View>

      {/* ── ACCELEROMETER ── */}
      {isTracking && (
        <View style={[st.card, {backgroundColor: c.white, borderColor: c.borderLight}]}>
          <View style={st.cardHeader}>
            <View style={[st.cardIconBg, {backgroundColor: '#F59E0B' + '15'}]}>
              <MaterialIcons name="vibration" size={ms(14)} color="#F59E0B" />
            </View>
            <Text style={[st.cardTitle, {color: c.textPrimary}]}>Accelerometer</Text>
            <View style={[st.liveDot, {backgroundColor: '#F59E0B'}]} />
          </View>
          <View style={{gap: wp(10)}}>
            {[
              {label: 'Lateral (X)', value: accelX, threshold: HARD_CORNER_THRESHOLD, color: c.primary, warnColor: '#EF4444'},
              {label: 'Longitudinal (Y)', value: accelY, threshold: HARD_BRAKE_THRESHOLD, color: c.accent, warnColor: '#EF4444'},
            ].map((axis, i) => {
              const pct = Math.min(100, (Math.abs(axis.value) / 10) * 100);
              const isWarn = Math.abs(axis.value) > axis.threshold;
              return (
                <View key={i}>
                  <View style={{flexDirection: 'row', justifyContent: 'space-between', marginBottom: wp(3)}}>
                    <Text style={[st.accelLabel, {color: c.textMuted}]}>{axis.label}</Text>
                    <Text style={[st.accelVal, {color: isWarn ? axis.warnColor : c.textPrimary}]}>{axis.value.toFixed(1)} m/s²</Text>
                  </View>
                  <View style={[st.progressTrack, {backgroundColor: c.borderLight}]}>
                    <View style={[st.progressFill, {backgroundColor: isWarn ? axis.warnColor : axis.color, width: `${pct}%`}]} />
                  </View>
                </View>
              );
            })}
          </View>
        </View>
      )}

      {/* ── COORDINATES ── */}
      {isTracking && (
        <View style={[st.card, {backgroundColor: c.white, borderColor: c.borderLight, flexDirection: 'row', alignItems: 'center', gap: wp(10)}]}>
          <View style={[st.cardIconBg, {backgroundColor: c.primary + '15'}]}>
            <MaterialIcons name="my-location" size={ms(14)} color={c.primary} />
          </View>
          <View style={{flex: 1}}>
            <Text style={[st.coordLabel, {color: c.textMuted}]}>Current Position</Text>
            <Text style={[st.coordValue, {color: c.textPrimary}]}>{latitude.toFixed(6)}, {longitude.toFixed(6)}</Text>
          </View>
        </View>
      )}

      {/* ── BROADCASTING ── */}
      <View style={[st.card, {backgroundColor: c.white, borderColor: c.borderLight}]}>
        <View style={{flexDirection: 'row', alignItems: 'center'}}>
          <View style={[st.cardIconBg, {backgroundColor: (isBroadcasting ? '#22C55E' : c.textMuted) + '15'}]}>
            <MaterialIcons name="cell-tower" size={ms(14)} color={isBroadcasting ? '#22C55E' : c.textMuted} />
          </View>
          <View style={{flex: 1, marginLeft: wp(10)}}>
            <Text style={[st.broadcastTitle, {color: c.textPrimary}]}>Broadcasting</Text>
            <Text style={[st.broadcastSub, {color: isBroadcasting ? '#22C55E' : c.textMuted}]}>
              {isBroadcasting ? 'Sharing live location' : 'Location sharing off'}
            </Text>
          </View>
          <TouchableOpacity
            style={[st.broadcastToggle, {backgroundColor: isBroadcasting ? '#EF4444' : '#22C55E'}]}
            activeOpacity={0.8}
            onPress={() => setIsBroadcasting(b => !b)}>
            <MaterialIcons name={isBroadcasting ? 'stop' : 'play-arrow'} size={ms(14)} color="#fff" />
            <Text style={st.broadcastToggleText}>{isBroadcasting ? 'STOP' : 'START'}</Text>
          </TouchableOpacity>
        </View>
      </View>
    </ScrollView>
  );

  return (
    <View style={[st.container, {backgroundColor: c.background}]}>
      <StatusBar barStyle="light-content" backgroundColor={c.primaryDark} />

      {/* ── HEADER ── */}
      <View style={[st.header, {backgroundColor: c.primaryDark, paddingTop: insets.top + wp(6), paddingLeft: Math.max(wp(14), insets.left), paddingRight: Math.max(wp(14), insets.right)}]}>
        <TouchableOpacity onPress={() => navigation.goBack()} activeOpacity={0.7} style={[st.headerBtn, {backgroundColor: 'rgba(255,255,255,0.1)'}]} hitSlop={{top: 8, bottom: 8, left: 8, right: 8}}>
          <MaterialIcons name="arrow-back" size={ms(18)} color={c.textOnPrimary} />
        </TouchableOpacity>
        <View style={{flex: 1, marginLeft: wp(10)}}>
          <Text style={[st.headerTitle, {color: c.textOnPrimary}]}>Vehicle Tracking</Text>
          <Text style={[st.headerSub, {color: c.textOnDark60}]}>{driver?.truck_code || '-'} · {driver?.driver_code || '-'}</Text>
        </View>
        <Animated.View style={[st.gpsBadge, {backgroundColor: gpsActive ? '#22C55E' : c.textMuted, transform: [{scale: gpsActive ? pulseAnim : 1}]}]}>
          <MaterialIcons name="gps-fixed" size={ms(10)} color="#fff" />
        </Animated.View>
        <Text style={[st.gpsLabel, {color: gpsActive ? '#22C55E' : c.textOnDark60}]}>{gpsActive ? 'LIVE' : 'OFF'}</Text>
      </View>

      {/* ── BODY: portrait = stacked, landscape = side-by-side ── */}
      {L ? (
        <View style={{flex: 1, flexDirection: 'row'}}>
          {/* Left panel: speedometer */}
          <View style={{width: isTablet ? '35%' : '32%', borderRightWidth: StyleSheet.hairlineWidth, borderRightColor: 'rgba(255,255,255,0.08)'}}>
            {heroBlock}
          </View>
          {/* Right panel: scrollable cards */}
          <View style={{flex: 1, backgroundColor: c.background}}>
            {cardsContent}
          </View>
        </View>
      ) : (
        <>
          {heroBlock}
          {cardsContent}
        </>
      )}
    </View>
  );
}

const st = StyleSheet.create({
  container: {flex: 1},

  // Header
  header: {flexDirection: 'row', alignItems: 'center', paddingBottom: wp(8), gap: wp(6)},
  headerBtn: {width: wp(34), height: wp(34), borderRadius: wp(10), justifyContent: 'center', alignItems: 'center'},
  headerTitle: {fontSize: ms(14), fontWeight: '800', letterSpacing: 0.3},
  headerSub: {fontSize: ms(10), fontWeight: '500', marginTop: 1},
  gpsBadge: {width: wp(22), height: wp(22), borderRadius: wp(11), justifyContent: 'center', alignItems: 'center'},
  gpsLabel: {fontSize: ms(8), fontWeight: '900', letterSpacing: 0.8, marginLeft: wp(2)},

  // Hero
  heroSection: {alignItems: 'center', paddingTop: wp(8), paddingBottom: wp(16)},
  speedRing: {width: wp(140), height: wp(140), borderRadius: wp(70), borderWidth: wp(4), borderColor: 'rgba(255,255,255,0.08)', justifyContent: 'center', alignItems: 'center'},
  speedRingInner: {width: wp(120), height: wp(120), borderRadius: wp(60), borderWidth: wp(2), justifyContent: 'center', alignItems: 'center'},
  speedValue: {fontSize: ms(42), fontWeight: '900', color: '#fff', letterSpacing: -1},
  speedUnit: {fontSize: ms(11), fontWeight: '700', color: 'rgba(255,255,255,0.5)', marginTop: -2},
  heroStatsRow: {flexDirection: 'row', alignItems: 'center', marginTop: wp(14), gap: wp(6)},
  heroStat: {alignItems: 'center', paddingHorizontal: wp(14)},
  heroStatValue: {fontSize: ms(11), fontWeight: '800', color: '#fff', marginTop: wp(3)},
  heroStatLabel: {fontSize: ms(8), fontWeight: '600', color: 'rgba(255,255,255,0.4)', marginTop: 1},
  heroStatDivider: {width: 1, height: wp(24)},
  idleBadge: {flexDirection: 'row', alignItems: 'center', gap: wp(4), backgroundColor: 'rgba(239,68,68,0.15)', paddingHorizontal: wp(12), paddingVertical: wp(5), borderRadius: wp(14), marginTop: wp(10)},
  idleBadgeText: {fontSize: ms(9), fontWeight: '800', letterSpacing: 0.5},
  trackBtn: {flexDirection: 'row', alignItems: 'center', gap: wp(8), paddingVertical: wp(10), paddingHorizontal: wp(28), borderRadius: wp(14), marginTop: wp(12), elevation: 4, shadowColor: '#000', shadowOffset: {width: 0, height: 2}, shadowOpacity: 0.15, shadowRadius: 6},
  trackBtnText: {fontSize: ms(12), fontWeight: '800', color: '#fff', letterSpacing: 0.3},
  liveDot: {width: wp(8), height: wp(8), borderRadius: wp(4)},

  // Scroll
  scrollContent: {paddingTop: wp(14), gap: wp(10)},

  // Cards
  card: {borderRadius: wp(14), borderWidth: 1, padding: wp(14)},
  cardHeader: {flexDirection: 'row', alignItems: 'center', gap: wp(8), marginBottom: wp(12)},
  cardIconBg: {width: wp(28), height: wp(28), borderRadius: wp(9), justifyContent: 'center', alignItems: 'center'},
  cardTitle: {fontSize: ms(11), fontWeight: '800', letterSpacing: 0.2, flex: 1},

  // Stats grid
  statsGrid: {flexDirection: 'row', flexWrap: 'wrap', gap: wp(8)},
  statItem: {flexGrow: 1, flexBasis: '45%', alignItems: 'center', paddingVertical: wp(10), borderRadius: wp(10), borderWidth: 1},
  statValue: {fontSize: ms(16), fontWeight: '900', marginTop: wp(4)},
  statUnit: {fontSize: ms(9), fontWeight: '600'},
  statLabel: {fontSize: ms(8), fontWeight: '700', letterSpacing: 0.3, marginTop: wp(2)},

  // Behaviour
  behaviourRow: {flexDirection: 'row', gap: wp(8)},
  behaviourItem: {flex: 1, alignItems: 'center', paddingVertical: wp(12), borderRadius: wp(10), borderWidth: 1},
  behaviourValue: {fontSize: ms(14), fontWeight: '900', marginTop: wp(4)},
  behaviourLabel: {fontSize: ms(7), fontWeight: '700', color: '#6B7280', letterSpacing: 0.3, marginTop: wp(2)},

  // Accelerometer
  accelLabel: {fontSize: ms(9), fontWeight: '700'},
  accelVal: {fontSize: ms(9), fontWeight: '800'},
  progressTrack: {height: wp(6), borderRadius: wp(3), overflow: 'hidden'},
  progressFill: {height: '100%', borderRadius: wp(3)},

  // Coordinates
  coordLabel: {fontSize: ms(8), fontWeight: '700', letterSpacing: 0.3},
  coordValue: {fontSize: ms(11), fontWeight: '700', marginTop: 1},

  // Broadcasting
  broadcastTitle: {fontSize: ms(11), fontWeight: '800'},
  broadcastSub: {fontSize: ms(9), fontWeight: '600', marginTop: 1},
  broadcastToggle: {flexDirection: 'row', alignItems: 'center', gap: wp(4), paddingVertical: wp(8), paddingHorizontal: wp(14), borderRadius: wp(10)},
  broadcastToggleText: {fontSize: ms(10), fontWeight: '800', color: '#fff', letterSpacing: 0.5},
});
