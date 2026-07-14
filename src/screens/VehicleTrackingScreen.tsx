import React, {useState, useEffect, useRef, useCallback} from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  StatusBar,
  Platform,
  Animated,
  useWindowDimensions,
} from 'react-native';
import {useSafeAreaInsets} from 'react-native-safe-area-context';
import Icon from '../components/Icon';
import type {NativeStackNavigationProp} from '@react-navigation/native-stack';
import {accelerometer, SensorTypes, setUpdateIntervalForType} from 'react-native-sensors';
import {useTheme} from '../contexts/ThemeContext';
import {useAuth} from '../contexts/AuthContext';
import {wp, ms} from '../utils/responsive';

const MONO = Platform.OS === 'ios' ? 'Menlo' : 'monospace';
import {showToast} from '../utils/toast';
import {ticketsApi, trackingApi} from '../services/api';
import {backgroundGpsTracker} from '../services/backgroundGpsTracker';
import {useFontScaleRefresh} from '../contexts/FontSizeContext';

type Props = {
  navigation: NativeStackNavigationProp<any>;
  route: {params?: {ticketId?: number}};
};

const HARD_BRAKE_THRESHOLD = 6;
const HARD_CORNER_THRESHOLD = 5;
const IDLE_SPEED_THRESHOLD = 1;
const SPEED_LIMIT_KMH = 80;

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

export default function VehicleTrackingScreen({navigation, route}: Props) {
  const passedTicketId = route.params?.ticketId ?? null;
  useFontScaleRefresh();
  const {c} = useTheme();
  const {driver} = useAuth();
  const insets = useSafeAreaInsets();
  const {width, height} = useWindowDimensions();
  const L = width > height; // landscape
  const isTablet = Math.min(width, height) > 600;

  // Landscape scaling — proportional to device
  const lh = height - insets.top - insets.bottom;
  const LREF = 810;
  const ls = (size: number) => Math.round(size * Math.min(width, height) / LREF);
  const fsScale = Math.max(0.8, Math.min(1.2, lh / 500));
  const fs = (base: number) => Math.round(base * fsScale);

  const st = createSt(c, L, isTablet, ls, fs);

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

  // Speeding
  const [isSpeeding, setIsSpeeding] = useState(false);
  const isSpeedingRef = useRef(false);

  // Geofence
  const [geofenceZones, setGeofenceZones] = useState<{name: string; lat: number; lng: number; radius: number}[]>([]);
  const [currentZone, setCurrentZone] = useState<string | null>(null);
  const lastZone = useRef<string | null>(null);
  const geofenceZonesRef = useRef(geofenceZones);
  geofenceZonesRef.current = geofenceZones;

  // ETA
  const [eta, setEta] = useState<{distance_miles: number | null; duration: number | null} | null>(null);
  const etaTimer = useRef<ReturnType<typeof setInterval> | null>(null);

  // Broadcasting
  const [isBroadcasting, setIsBroadcasting] = useState(false);


  // Tracking
  const [isTracking, setIsTracking] = useState(backgroundGpsTracker.isRunning());
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

  const startTracking = useCallback(async () => {
    const started = await backgroundGpsTracker.start(passedTicketId);
    if (!started) return;

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

    // Fetch geofence zones from ticket
    if (passedTicketId) {
      ticketsApi.getById(passedTicketId).then(res => {
        const zones: {name: string; lat: number; lng: number; radius: number}[] = [];
        if (res.data?.location?.plant) zones.push({name: 'Plant', lat: res.data.location.plant.lat, lng: res.data.location.plant.lng, radius: 200});
        if (res.data?.location?.delivery) zones.push({name: 'Jobsite', lat: res.data.location.delivery.lat, lng: res.data.location.delivery.lng, radius: res.data.location.delivery.radius_m || 200});
        setGeofenceZones(zones);
      }).catch(() => {});
    }

    // Fetch ETA
    trackingApi.getMe().then(res => {
      if (res.data?.eta) setEta(res.data.eta);
    }).catch(() => {});

    etaTimer.current = setInterval(() => {
      trackingApi.getMe().then(res => { if (res.data?.eta) setEta(res.data.eta); }).catch(() => {});
    }, 60000);

    setUpdateIntervalForType(SensorTypes.accelerometer, 200);
    accelSub.current = accelerometer.subscribe(({x, y}) => {
      setAccelX(x);
      setAccelY(y);
      if (Math.abs(y) > HARD_BRAKE_THRESHOLD) setHardBrakes(prev => prev + 1);
      if (Math.abs(x) > HARD_CORNER_THRESHOLD) setHardCorners(prev => prev + 1);
    });
  }, [haversine]);

  const stopTracking = useCallback(() => {
    // Save trip summary before stopping
    if (tripStartTime.current > 0) {
      backgroundGpsTracker.saveTripSummary({
        ticket_id: passedTicketId,
        started_at: new Date(tripStartTime.current).toISOString(),
        ended_at: new Date().toISOString(),
        total_distance_m: tripDistance,
        total_duration_s: tripDuration,
        max_speed_ms: maxSpeed,
        avg_speed_ms: avgSpeed,
        hard_brakes: hardBrakes,
        hard_corners: hardCorners,
        total_idle_time_s: idleTime,
      });
    }

    backgroundGpsTracker.stop();
    if (tripTimer.current) { clearInterval(tripTimer.current); tripTimer.current = null; }
    if (etaTimer.current) { clearInterval(etaTimer.current); etaTimer.current = null; }
    if (accelSub.current) { accelSub.current.unsubscribe(); accelSub.current = null; }
    setIsTracking(false);
    setGpsActive(false);
  }, [passedTicketId, tripDistance, tripDuration, maxSpeed, avgSpeed, hardBrakes, hardCorners, idleTime]);

  // Subscribe to background GPS position updates (for UI display)
  useEffect(() => {
    const unsub = backgroundGpsTracker.addListener((pos) => {
      setLatitude(pos.latitude);
      setLongitude(pos.longitude);
      setSpeed(pos.speed);
      setHeading(pos.heading);
      setAltitude(pos.altitude);
      setAccuracy(pos.accuracy);

      const kmh = Math.round(pos.speed * 3.6);
      if (kmh > SPEED_LIMIT_KMH && !isSpeedingRef.current) {
        isSpeedingRef.current = true;
        setIsSpeeding(true);
        showToast('error', 'Speeding Alert', `Speed ${kmh} km/h exceeds limit of ${SPEED_LIMIT_KMH} km/h`);
      } else if (kmh <= SPEED_LIMIT_KMH) {
        isSpeedingRef.current = false;
        setIsSpeeding(false);
      }

      setMaxSpeed(prev => Math.max(prev, pos.speed));
      speedSamples.current.push(pos.speed);
      setAvgSpeed(speedSamples.current.reduce((a, b) => a + b, 0) / speedSamples.current.length);

      if (lastPos.current) {
        const dist = haversine(lastPos.current.lat, lastPos.current.lng, pos.latitude, pos.longitude);
        if (dist > 3) {
          setTripDistance(prev => prev + dist);
          lastPos.current = {lat: pos.latitude, lng: pos.longitude};
        }
      } else {
        lastPos.current = {lat: pos.latitude, lng: pos.longitude};
      }

      // Geofence check
      for (const zone of geofenceZonesRef.current) {
        const dist = haversine(pos.latitude, pos.longitude, zone.lat, zone.lng);
        if (dist <= zone.radius) {
          if (lastZone.current !== zone.name) {
            lastZone.current = zone.name;
            setCurrentZone(zone.name);
            showToast('success', 'Arrived', `Entered ${zone.name} zone`);
          }
          break;
        } else if (lastZone.current === zone.name) {
          lastZone.current = null;
          setCurrentZone(null);
          showToast('info', 'Left Zone', `Exited ${zone.name} zone`);
        }
      }

      const idle = pos.speed < IDLE_SPEED_THRESHOLD;
      if (idle) {
        if (!idleStart.current) idleStart.current = Date.now();
        setIsIdle(true);
        setIdleTime(Math.floor((Date.now() - idleStart.current) / 1000));
      } else {
        idleStart.current = null;
        setIsIdle(false);
        setIdleTime(0);
      }

      // Send behavior data to tracker so it's saved with each GPS record
      backgroundGpsTracker.setBehavior({
        is_speeding: isSpeedingRef.current,
        is_idle: idle,
        accel_x: accelX,
        accel_y: accelY,
        zone: lastZone.current,
      });
    });

    // Sync initial state — tracker might already be running
    if (backgroundGpsTracker.isRunning()) {
      setIsTracking(true);
      setGpsActive(true);
      const pos = backgroundGpsTracker.getLastPosition();
      if (pos) {
        setLatitude(pos.latitude);
        setLongitude(pos.longitude);
        setSpeed(pos.speed);
        setHeading(pos.heading);
        setAltitude(pos.altitude);
        setAccuracy(pos.accuracy);
      }
    }

    return unsub;
  }, [haversine]);

  // Cleanup screen-specific timers on unmount (GPS keeps running globally)
  useEffect(() => {
    return () => {
      if (tripTimer.current) { clearInterval(tripTimer.current); tripTimer.current = null; }
      if (etaTimer.current) { clearInterval(etaTimer.current); etaTimer.current = null; }
      if (accelSub.current) { accelSub.current.unsubscribe(); accelSub.current = null; }
    };
  }, []);


  const speedKmh = toKmh(speed);
  const maxSpeedKmh = toKmh(maxSpeed);
  const avgSpeedKmh = toKmh(avgSpeed);
  const distanceKm = (tripDistance / 1000).toFixed(2);
  const compassDir = toCompass(heading);

  // ── Shared UI blocks ──
  const heroBlock = (
    <View style={[st.heroSection, L && st.heroSectionLandscape]}>
      <View style={[st.speedRing, L && st.speedRingLandscape, isSpeeding && {borderColor: '#EF4444'}]}>
        <View style={[st.speedRingInner, L && st.speedRingInnerLandscape, isSpeeding && {borderColor: '#EF4444'}]}>
          <Text style={[st.speedValue, L && st.speedValueLandscape]}>{speedKmh}</Text>
          <Text style={[st.speedUnit, L && st.speedUnitLandscape]}>km/h</Text>
        </View>
      </View>
      <View style={[st.heroStatsRow, L && st.heroStatsRowLandscape]}>
        <View style={st.heroStat}>
          <Icon name="explore" size={ms(L ? 11 : 14)} color="rgba(255,255,255,0.5)" />
          <Text style={[st.heroStatValue, L && st.heroStatValueLandscape]}>{Math.round(heading)}° {compassDir}</Text>
          <Text style={[st.heroStatLabel, L && st.heroStatLabelLandscape]}>Heading</Text>
        </View>
        <View style={st.heroStatDivider} />
        <View style={st.heroStat}>
          <Icon name="terrain" size={ms(L ? 11 : 14)} color="rgba(255,255,255,0.5)" />
          <Text style={[st.heroStatValue, L && st.heroStatValueLandscape]}>{Math.round(altitude)}m</Text>
          <Text style={[st.heroStatLabel, L && st.heroStatLabelLandscape]}>Altitude</Text>
        </View>
        <View style={st.heroStatDivider} />
        <View style={st.heroStat}>
          <Icon name="gps-fixed" size={ms(L ? 11 : 14)} color="rgba(255,255,255,0.5)" />
          <Text style={[st.heroStatValue, L && st.heroStatValueLandscape]}>{Math.round(accuracy)}m</Text>
          <Text style={[st.heroStatLabel, L && st.heroStatLabelLandscape]}>Accuracy</Text>
        </View>
      </View>
      {isIdle && isTracking && (
        <View style={[st.idleBadge, L && st.idleBadgeLandscape]}>
          <Icon name="pause-circle-filled" size={ms(11)} color="#EF4444" />
          <Text style={st.idleBadgeText}>IDLE {formatDuration(idleTime)}</Text>
        </View>
      )}
      {isSpeeding && isTracking && (
        <View style={[st.idleBadge, L && st.idleBadgeLandscape, {backgroundColor: 'rgba(239,68,68,0.25)'}]}>
          <Icon name="speed" size={ms(11)} color="#EF4444" />
          <Text style={st.idleBadgeText}>SPEEDING {toKmh(speed)} km/h</Text>
        </View>
      )}
      <TouchableOpacity
        style={[st.trackBtn, isTracking ? st.trackBtnStop : st.trackBtnStart, L && st.trackBtnLandscape]}
        activeOpacity={0.8}
        onPress={isTracking ? stopTracking : startTracking}>
        <Icon name={isTracking ? 'stop' : 'play-arrow'} size={ms(L ? 14 : 16)} color="#fff" />
        <Text style={[st.trackBtnText, L && st.trackBtnTextLandscape]}>{isTracking ? 'Stop Tracking' : 'Start Tracking'}</Text>
      </TouchableOpacity>
    </View>
  );

  const cardsInner = (
    <>
      {/* ── TRIP STATS ── */}
      <View style={[st.card, L && st.cardLandscape]}>
        <View style={[st.cardHeader, L && st.cardHeaderLandscape]}>
          <View style={[st.cardIconBg, st.cardIconBgPrimary, L && st.cardIconBgLandscape]}>
            <Icon name="route" size={L ? fs(13) : ms(14)} color={c.primary} />
          </View>
          <Text style={[st.cardTitle, L && st.cardTitleLandscape]}>Trip Statistics</Text>
          {isTracking && <View style={st.liveDotGreen} />}
        </View>
        <View style={[st.statsGrid, L && st.statsGridLandscape]}>
          {[
            {icon: 'straighten', label: 'Distance', value: distanceKm, unit: 'km', color: c.primary},
            {icon: 'timer', label: 'Duration', value: formatDuration(tripDuration), unit: '', color: c.accent},
            {icon: 'speed', label: 'Max Speed', value: `${maxSpeedKmh}`, unit: 'km/h', color: '#EF4444'},
            {icon: 'analytics', label: 'Avg Speed', value: `${avgSpeedKmh}`, unit: 'km/h', color: '#F59E0B'},
          ].map((item, i) => (
            <View key={i} style={[st.statItem, L && st.statItemLandscape]}>
              <Icon name={item.icon as any} size={L ? fs(16) : ms(15)} color={item.color} />
              <Text style={[st.statValue, L && st.statValueLandscape]}>{item.value}<Text style={st.statUnit}> {item.unit}</Text></Text>
              <Text style={[st.statLabel, L && st.statLabelLandscape]}>{item.label}</Text>
            </View>
          ))}
        </View>
      </View>

      {/* ── DRIVING BEHAVIOUR ── */}
      <View style={[st.card, L && st.cardLandscape]}>
        <View style={[st.cardHeader, L && st.cardHeaderLandscape]}>
          <View style={[st.cardIconBg, st.cardIconBgPurple, L && st.cardIconBgLandscape]}>
            <Icon name="shield" size={L ? fs(13) : ms(14)} color="#8B5CF6" />
          </View>
          <Text style={[st.cardTitle, L && st.cardTitleLandscape]}>Driving Behaviour</Text>
        </View>
        <View style={[st.behaviourRow, L && st.behaviourRowLandscape]}>
          <View style={[st.behaviourItem, st.behaviourItemRed, L && st.behaviourItemLandscape]}>
            <Icon name="warning" size={L ? fs(18) : ms(18)} color="#EF4444" />
            <Text style={[st.behaviourValue, st.behaviourValueRed, L && st.behaviourValueLandscape]}>{hardBrakes}</Text>
            <Text style={[st.behaviourLabel, L && st.behaviourLabelLandscape]}>Hard Brakes</Text>
          </View>
          <View style={[st.behaviourItem, st.behaviourItemAmber, L && st.behaviourItemLandscape]}>
            <Icon name="turn-sharp-right" size={L ? fs(18) : ms(18)} color="#F59E0B" />
            <Text style={[st.behaviourValue, st.behaviourValueAmber, L && st.behaviourValueLandscape]}>{hardCorners}</Text>
            <Text style={[st.behaviourLabel, L && st.behaviourLabelLandscape]}>Hard Corners</Text>
          </View>
          <View style={[st.behaviourItem, isIdle ? st.behaviourItemRed : st.behaviourItemGreen, L && st.behaviourItemLandscape]}>
            <Icon name={isIdle ? 'pause-circle-filled' : 'directions-car'} size={L ? fs(18) : ms(18)} color={isIdle ? '#EF4444' : '#22C55E'} />
            <Text style={[st.behaviourValue, isIdle ? st.behaviourValueRed : st.behaviourValueGreen, L && st.behaviourValueLandscape]}>{isIdle ? formatDuration(idleTime) : 'Moving'}</Text>
            <Text style={[st.behaviourLabel, L && st.behaviourLabelLandscape]}>Status</Text>
          </View>
        </View>
      </View>

      {/* ── ACCELEROMETER ── */}
      {isTracking && (
        <View style={[st.card, L && st.cardLandscape]}>
          <View style={[st.cardHeader, L && st.cardHeaderLandscape]}>
            <View style={[st.cardIconBg, st.cardIconBgAmber, L && st.cardIconBgLandscape]}>
              <Icon name="vibration" size={L ? fs(13) : ms(14)} color="#F59E0B" />
            </View>
            <Text style={[st.cardTitle, L && st.cardTitleLandscape]}>Accelerometer</Text>
            <View style={st.liveDotAmber} />
          </View>
          <View style={L ? st.accelRowsLandscape : st.accelRows}>
            {[
              {label: 'Lateral (X)', value: accelX, threshold: HARD_CORNER_THRESHOLD, color: c.primary, warnColor: '#EF4444'},
              {label: 'Longitudinal (Y)', value: accelY, threshold: HARD_BRAKE_THRESHOLD, color: c.accent, warnColor: '#EF4444'},
            ].map((axis, i) => {
              const pct = Math.min(100, (Math.abs(axis.value) / 10) * 100);
              const isWarn = Math.abs(axis.value) > axis.threshold;
              return (
                <View key={i}>
                  <View style={L ? st.accelRowHeaderLandscape : st.accelRowHeader}>
                    <Text style={[st.accelLabel, L && st.accelLabelLandscape]}>{axis.label}</Text>
                    <Text style={[st.accelVal, isWarn ? st.accelValWarn : st.accelValNormal, L && st.accelValLandscape]}>{axis.value.toFixed(1)} m/s²</Text>
                  </View>
                  <View style={st.progressTrack}>
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
        <View style={[st.card, st.coordCard, L && st.coordCardLandscape]}>
          <View style={[st.cardIconBg, st.cardIconBgPrimary, L && st.cardIconBgLandscape]}>
            <Icon name="my-location" size={L ? fs(13) : ms(14)} color={c.primary} />
          </View>
          <View style={st.coordContent}>
            <Text style={[st.coordLabel, L && st.coordLabelLandscape]}>Current Position</Text>
            <Text style={[st.coordValue, L && st.coordValueLandscape]}>{latitude.toFixed(6)}, {longitude.toFixed(6)}</Text>
          </View>
        </View>
      )}

      {/* ── ALERTS (Speeding + Geofence) ── */}
      {isTracking && (isSpeeding || currentZone) && (
        <View style={[st.card, L && st.cardLandscape]}>
          <View style={[st.cardHeader, L && st.cardHeaderLandscape]}>
            <View style={[st.cardIconBg, {backgroundColor: isSpeeding ? '#EF4444' + '15' : '#22C55E' + '15'}, L && st.cardIconBgLandscape]}>
              <Icon name={isSpeeding ? 'speed' : 'location-on'} size={L ? fs(13) : ms(14)} color={isSpeeding ? '#EF4444' : '#22C55E'} />
            </View>
            <Text style={[st.cardTitle, L && st.cardTitleLandscape]}>Alerts</Text>
          </View>
          <View style={{gap: wp(6)}}>
            {isSpeeding && (
              <View style={{flexDirection: 'row', alignItems: 'center', gap: wp(6), backgroundColor: '#FEF2F2', padding: wp(8), borderRadius: wp(8)}}>
                <Icon name="warning" size={ms(14)} color="#EF4444" />
                <Text style={{fontSize: ms(10), fontWeight: '700', color: '#EF4444', flex: 1, fontFamily: MONO}}>SPEEDING: {toKmh(speed)} km/h (limit: {SPEED_LIMIT_KMH} km/h)</Text>
              </View>
            )}
            {currentZone && (
              <View style={{flexDirection: 'row', alignItems: 'center', gap: wp(6), backgroundColor: '#F0FDF4', padding: wp(8), borderRadius: wp(8)}}>
                <Icon name="location-on" size={ms(14)} color="#22C55E" />
                <Text style={{fontSize: ms(10), fontWeight: '700', color: '#22C55E', flex: 1, fontFamily: MONO}}>IN ZONE: {currentZone}</Text>
              </View>
            )}
          </View>
        </View>
      )}

      {/* ── ETA ── */}
      {isTracking && eta && (eta.distance_miles != null || eta.duration != null) && (
        <View style={[st.card, st.coordCard, L && st.coordCardLandscape]}>
          <View style={[st.cardIconBg, {backgroundColor: '#3B82F6' + '15'}, L && st.cardIconBgLandscape]}>
            <Icon name="schedule" size={L ? fs(13) : ms(14)} color="#3B82F6" />
          </View>
          <View style={{flex: 1}}>
            <Text style={[st.coordLabel, L && st.coordLabelLandscape]}>ETA to Jobsite</Text>
            <Text style={[st.coordValue, L && st.coordValueLandscape]}>
              {eta.duration != null ? (eta.duration >= 3600 ? `${Math.floor(eta.duration / 3600)}h ${Math.round((eta.duration % 3600) / 60)}m` : `${Math.round(eta.duration / 60)} min`) : '--'}
              {eta.distance_miles != null ? ` · ${eta.distance_miles.toFixed(1)} mi` : ''}
            </Text>
          </View>
        </View>
      )}

      {/* ── BROADCASTING ── */}
      <View style={[st.card, L && st.broadcastCardLandscape]}>
        <View style={st.broadcastRow}>
          <View style={[st.cardIconBg, isBroadcasting ? st.cardIconBgBroadcastOn : st.cardIconBgBroadcastOff, L && st.cardIconBgLandscape]}>
            <Icon name="cell-tower" size={L ? fs(13) : ms(14)} color={isBroadcasting ? '#22C55E' : c.textMuted} />
          </View>
          <View style={L ? st.broadcastTextLandscape : st.broadcastText}>
            <Text style={[st.broadcastTitle, L && st.broadcastTitleLandscape]}>Broadcasting</Text>
            <Text style={[st.broadcastSub, isBroadcasting ? st.broadcastSubOn : st.broadcastSubOff, L && st.broadcastSubLandscape]}>
              {isBroadcasting ? 'Sharing live location' : 'Location sharing off'}
            </Text>
          </View>
          <TouchableOpacity
            style={[st.broadcastToggle, isBroadcasting ? st.broadcastToggleStop : st.broadcastToggleStart, L && st.broadcastToggleLandscape]}
            activeOpacity={0.8}
            onPress={() => setIsBroadcasting(b => !b)}>
            <Icon name={isBroadcasting ? 'stop' : 'play-arrow'} size={L ? fs(14) : ms(14)} color="#fff" />
            <Text style={[st.broadcastToggleText, L && st.broadcastToggleTextLandscape]}>{isBroadcasting ? 'STOP' : 'START'}</Text>
          </TouchableOpacity>
        </View>
      </View>

      {/* ── TRIP HISTORY ── */}
      {passedTicketId && (
        <TouchableOpacity
          style={[st.card, L && st.cardLandscape, {flexDirection: 'row', alignItems: 'center', gap: L ? ls(8) : wp(10)}]}
          activeOpacity={0.7}
          onPress={() => navigation.navigate('TripHistory', {ticketId: passedTicketId, ticketCode: ''})}>
          <View style={[st.cardIconBg, {backgroundColor: '#3B82F6' + '15'}, L && st.cardIconBgLandscape]}>
            <Icon name="history" size={L ? fs(13) : ms(14)} color="#3B82F6" />
          </View>
          <View style={{flex: 1}}>
            <Text style={[st.coordLabel, L && st.coordLabelLandscape]}>Trip History</Text>
            <Text style={[st.coordValue, L && st.coordValueLandscape]}>View GPS route on map</Text>
          </View>
          <Icon name="chevron-right" size={ms(18)} color={c.textMuted} />
        </TouchableOpacity>
      )}
    </>
  );

  const cardsContent = L ? (
    isTracking ? (
      <ScrollView
        style={st.flex1}
        contentContainerStyle={[st.cardsContentLandscape, {paddingBottom: insets.bottom + ls(4)}]}
        showsVerticalScrollIndicator={false}>
        {cardsInner}
      </ScrollView>
    ) : (
      <View style={[st.cardsContentLandscapeStatic, {paddingBottom: insets.bottom + ls(4)}]}>
        {cardsInner}
      </View>
    )
  ) : (
    <ScrollView
      style={st.flex1}
      contentContainerStyle={[st.scrollContent, {paddingBottom: insets.bottom + wp(24)}]}
      showsVerticalScrollIndicator={false}>
      {cardsInner}
    </ScrollView>
  );

  return (
    <View style={st.container}>
      <StatusBar barStyle="light-content" backgroundColor={c.primaryDark} />

      {L ? (
        /* ── LANDSCAPE: header embedded in left column, right panel extends from top ── */
        <View style={st.landscapeRoot}>
          {/* Left column: header + speedometer */}
          <View style={[st.landscapeLeft, isTablet ? st.landscapeLeftTablet : st.landscapeLeftPhone]}>
            <View style={[st.header, {paddingTop: insets.top + wp(6), paddingLeft: Math.max(wp(14), insets.left), paddingRight: wp(8)}]}>
              <TouchableOpacity onPress={() => navigation.goBack()} activeOpacity={0.7} style={st.headerBtn} hitSlop={{top: 8, bottom: 8, left: 8, right: 8}}>
                <Icon name="arrow-back" size={ms(18)} color={c.textOnPrimary} />
              </TouchableOpacity>
              <View style={st.headerTextBlock}>
                <Text style={st.headerTitle}>Vehicle Tracking</Text>
                <Text style={st.headerSub}>{driver?.truck_code || '-'} · {driver?.driver_code || '-'}</Text>
              </View>
            </View>
            <View style={st.landscapeSpeedoWrapper}>
              {heroBlock}
            </View>
          </View>
          {/* Right column: GPS badge + cards — extends from very top */}
          <View style={st.landscapeRight}>
            <View style={[st.landscapeGpsBadgeRow, {paddingTop: insets.top + wp(6), paddingRight: Math.max(wp(14), insets.right)}]}>
              <Animated.View style={[st.gpsBadge, gpsActive ? st.gpsBadgeActive : st.gpsBadgeInactive, {transform: [{scale: gpsActive ? pulseAnim : 1}]}]}>
                <Icon name="gps-fixed" size={ms(10)} color="#fff" />
              </Animated.View>
              <Text style={[st.gpsLabel, gpsActive ? st.gpsLabelActive : st.gpsLabelInactive]}>{gpsActive ? 'LIVE' : 'OFF'}</Text>
            </View>
            {cardsContent}
          </View>
        </View>
      ) : (
        /* ── PORTRAIT: standard stacked layout ── */
        <>
          <View style={[st.header, st.headerPortrait, {paddingTop: insets.top + wp(6), paddingLeft: Math.max(wp(14), insets.left), paddingRight: Math.max(wp(14), insets.right)}]}>
            <TouchableOpacity onPress={() => navigation.goBack()} activeOpacity={0.7} style={st.headerBtn} hitSlop={{top: 8, bottom: 8, left: 8, right: 8}}>
              <Icon name="arrow-back" size={ms(18)} color={c.textOnPrimary} />
            </TouchableOpacity>
            <View style={st.headerTextBlock}>
              <Text style={st.headerTitle}>Vehicle Tracking</Text>
              <Text style={st.headerSub}>{driver?.truck_code || '-'} · {driver?.driver_code || '-'}</Text>
            </View>
            <Animated.View style={[st.gpsBadge, gpsActive ? st.gpsBadgeActive : st.gpsBadgeInactive, {transform: [{scale: gpsActive ? pulseAnim : 1}]}]}>
              <Icon name="gps-fixed" size={ms(10)} color="#fff" />
            </Animated.View>
            <Text style={[st.gpsLabel, gpsActive ? st.gpsLabelActive : st.gpsLabelInactive]}>{gpsActive ? 'LIVE' : 'OFF'}</Text>
          </View>
          {/* Hero section — row layout: circle left, stats right */}
          <View style={[st.portraitHeroRow, {paddingHorizontal: Math.max(wp(14), insets.left)}]}>
            {/* Left: speedometer circle */}
            <View style={st.portraitSpeedoWrapper}>
              <View style={[st.speedRing, isSpeeding && {borderColor: '#EF4444'}]}>
                <View style={[st.speedRingInner, isSpeeding && {borderColor: '#EF4444'}]}>
                  <Text style={st.speedValue}>{speedKmh}</Text>
                  <Text style={st.speedUnit}>km/h</Text>
                </View>
              </View>
            </View>
            {/* Right: stats + button */}
            <View style={st.portraitStatsWrapper}>
              <View style={st.heroStatsRow}>
                <View style={st.heroStat}>
                  <Icon name="explore" size={ms(14)} color="rgba(255,255,255,0.5)" />
                  <Text style={st.heroStatValue}>{Math.round(heading)}° {compassDir}</Text>
                  <Text style={st.heroStatLabel}>Heading</Text>
                </View>
                <View style={st.heroStatDivider} />
                <View style={st.heroStat}>
                  <Icon name="terrain" size={ms(14)} color="rgba(255,255,255,0.5)" />
                  <Text style={st.heroStatValue}>{Math.round(altitude)}m</Text>
                  <Text style={st.heroStatLabel}>Altitude</Text>
                </View>
                <View style={st.heroStatDivider} />
                <View style={st.heroStat}>
                  <Icon name="gps-fixed" size={ms(14)} color="rgba(255,255,255,0.5)" />
                  <Text style={st.heroStatValue}>{Math.round(accuracy)}m</Text>
                  <Text style={st.heroStatLabel}>Accuracy</Text>
                </View>
              </View>
              {isIdle && isTracking && (
                <View style={st.idleBadge}>
                  <Icon name="pause-circle-filled" size={ms(11)} color="#EF4444" />
                  <Text style={st.idleBadgeText}>IDLE {formatDuration(idleTime)}</Text>
                </View>
              )}
              {isSpeeding && isTracking && (
                <View style={[st.idleBadge, {backgroundColor: 'rgba(239,68,68,0.25)'}]}>
                  <Icon name="speed" size={ms(11)} color="#EF4444" />
                  <Text style={st.idleBadgeText}>SPEEDING {toKmh(speed)} km/h</Text>
                </View>
              )}
              <TouchableOpacity
                style={[st.trackBtn, isTracking ? st.trackBtnStop : st.trackBtnStart, st.trackBtnPortrait]}
                activeOpacity={0.8}
                onPress={isTracking ? stopTracking : startTracking}>
                <Icon name={isTracking ? 'stop' : 'play-arrow'} size={ms(14)} color="#fff" />
                <Text style={st.trackBtnTextPortrait}>{isTracking ? 'Stop Tracking' : 'Start Tracking'}</Text>
              </TouchableOpacity>
            </View>
          </View>
          {cardsContent}
        </>
      )}
    </View>
  );
}

const createSt = (c: any, L: boolean, isTablet: boolean, ls: (n: number) => number, fs: (n: number) => number) => StyleSheet.create({
  flex1: {flex: 1},
  container: {flex: 1, backgroundColor: c.background},

  // ── Header ──
  header: {flexDirection: 'row', alignItems: 'center', paddingBottom: wp(8), gap: wp(6)},
  headerPortrait: {backgroundColor: c.primaryDark},
  headerBtn: {width: wp(34), height: wp(34), borderRadius: wp(10), justifyContent: 'center', alignItems: 'center', backgroundColor: 'rgba(255,255,255,0.1)'},
  headerTextBlock: {flex: 1, marginLeft: wp(10)},
  headerTitle: {fontSize: ms(16), fontWeight: '800', letterSpacing: 0.3, color: c.textOnPrimary, fontFamily: MONO},
  headerSub: {fontSize: ms(12), fontWeight: '500', marginTop: 1, color: c.textOnDark60, fontFamily: MONO},

  // ── GPS badge ──
  gpsBadge: {width: wp(22), height: wp(22), borderRadius: wp(11), justifyContent: 'center', alignItems: 'center'},
  gpsBadgeActive: {backgroundColor: '#22C55E'},
  gpsBadgeInactive: {backgroundColor: c.textMuted},
  gpsLabel: {fontSize: ms(10), fontWeight: '900', letterSpacing: 0.8, marginLeft: wp(2), fontFamily: MONO},
  gpsLabelActive: {color: '#22C55E'},
  gpsLabelInactive: {color: c.textOnDark60},

  // ── Landscape layout ──
  landscapeRoot: {flex: 1, flexDirection: 'row'},
  landscapeLeft: {backgroundColor: c.primaryDark},
  landscapeLeftTablet: {width: '35%'},
  landscapeLeftPhone: {width: '32%'},
  landscapeSpeedoWrapper: {flex: 1, borderRightWidth: StyleSheet.hairlineWidth, borderRightColor: 'rgba(255,255,255,0.08)'},
  landscapeRight: {flex: 1, backgroundColor: c.surface},
  landscapeGpsBadgeRow: {flexDirection: 'row', justifyContent: 'flex-end', alignItems: 'center', paddingBottom: wp(4), gap: wp(4)},

  // ── Hero ──
  heroSection: {alignItems: 'center', paddingTop: wp(8), paddingBottom: wp(16), backgroundColor: c.primaryDark},
  heroSectionLandscape: {flex: 1, paddingVertical: wp(8), justifyContent: 'center'},
  speedRing: {width: wp(140), height: wp(140), borderRadius: wp(70), borderWidth: wp(4), borderColor: 'rgba(255,255,255,0.08)', justifyContent: 'center', alignItems: 'center'},
  speedRingLandscape: {width: wp(100), height: wp(100), borderRadius: wp(50), borderWidth: wp(3)},
  speedRingInner: {width: wp(120), height: wp(120), borderRadius: wp(60), borderWidth: wp(2), borderColor: 'rgba(255,255,255,0.08)', justifyContent: 'center', alignItems: 'center'},
  speedRingInnerLandscape: {width: wp(84), height: wp(84), borderRadius: wp(42)},
  speedValue: {fontSize: ms(44), fontWeight: '900', color: '#fff', letterSpacing: -1},
  speedValueLandscape: {fontSize: ms(32), fontFamily: MONO},
  speedUnit: {fontSize: ms(13), fontWeight: '700', color: 'rgba(255,255,255,0.5)', marginTop: -2},
  speedUnitLandscape: {fontSize: ms(9), fontFamily: MONO},
  heroStatsRow: {flexDirection: 'row', alignItems: 'center', marginTop: wp(14), gap: wp(6)},
  heroStatsRowLandscape: {marginTop: wp(10)},
  heroStat: {alignItems: 'center', paddingHorizontal: wp(14)},
  heroStatValue: {fontSize: ms(13), fontWeight: '800', color: '#fff', marginTop: wp(3)},
  heroStatValueLandscape: {fontSize: ms(9), fontFamily: MONO},
  heroStatLabel: {fontSize: ms(10), fontWeight: '600', color: 'rgba(255,255,255,0.4)', marginTop: 1},
  heroStatLabelLandscape: {fontSize: ms(7), fontFamily: MONO},
  heroStatDivider: {width: 1, height: wp(24), backgroundColor: 'rgba(255,255,255,0.1)'},
  idleBadge: {flexDirection: 'row', alignItems: 'center', gap: wp(4), backgroundColor: 'rgba(239,68,68,0.15)', paddingHorizontal: wp(12), paddingVertical: wp(5), borderRadius: wp(14), marginTop: wp(10)},
  idleBadgeLandscape: {marginTop: wp(6)},
  idleBadgeText: {fontSize: ms(11), fontWeight: '800', letterSpacing: 0.5, color: '#EF4444', fontFamily: MONO},
  trackBtn: {flexDirection: 'row', alignItems: 'center', gap: wp(8), paddingVertical: wp(10), paddingHorizontal: wp(28), borderRadius: wp(14), marginTop: wp(12), elevation: 4, shadowColor: '#000', shadowOffset: {width: 0, height: 2}, shadowOpacity: 0.15, shadowRadius: 6},
  trackBtnStart: {backgroundColor: '#22C55E'},
  trackBtnStop: {backgroundColor: '#EF4444'},
  trackBtnLandscape: {marginTop: wp(8), paddingVertical: wp(7), paddingHorizontal: wp(18)},
  trackBtnPortrait: {alignSelf: 'center', paddingVertical: wp(8), paddingHorizontal: wp(20)},
  trackBtnText: {fontSize: ms(14), fontWeight: '800', color: '#fff', letterSpacing: 0.3},
  trackBtnTextLandscape: {fontSize: ms(10), fontFamily: MONO},
  trackBtnTextPortrait: {fontSize: ms(11), fontWeight: '800', color: '#fff', letterSpacing: 0.3},
  liveDotGreen: {width: wp(8), height: wp(8), borderRadius: wp(4), backgroundColor: '#22C55E'},
  liveDotAmber: {width: wp(8), height: wp(8), borderRadius: wp(4), backgroundColor: '#F59E0B'},

  // ── Portrait hero row ──
  portraitHeroRow: {backgroundColor: c.primaryDark, flexDirection: 'row', alignItems: 'center', paddingVertical: wp(10), gap: wp(10)},
  portraitSpeedoWrapper: {alignItems: 'center'},
  portraitStatsWrapper: {flex: 1, alignItems: 'center', gap: wp(8)},

  // ── Scroll / cards container ──
  scrollContent: {paddingTop: wp(14), gap: wp(10), paddingHorizontal: wp(14)},
  cardsContentLandscape: {paddingHorizontal: ls(10), paddingTop: ls(4), gap: ls(6)},
  cardsContentLandscapeStatic: {flex: 1, paddingHorizontal: ls(10), paddingTop: ls(4), gap: ls(6)},

  // ── Cards ──
  card: {borderRadius: wp(14), borderWidth: 1, padding: wp(14), backgroundColor: c.white, borderColor: c.borderLight},
  cardLandscape: {padding: ls(10), borderRadius: ls(10)},
  cardHeader: {flexDirection: 'row', alignItems: 'center', gap: wp(8), marginBottom: wp(12)},
  cardHeaderLandscape: {marginBottom: ls(6), gap: ls(6)},
  cardIconBg: {width: wp(28), height: wp(28), borderRadius: wp(9), justifyContent: 'center', alignItems: 'center'},
  cardIconBgLandscape: {width: ls(26), height: ls(26), borderRadius: ls(7)},
  cardIconBgPrimary: {backgroundColor: c.primary + '15'},
  cardIconBgPurple: {backgroundColor: '#8B5CF6' + '15'},
  cardIconBgAmber: {backgroundColor: '#F59E0B' + '15'},
  cardIconBgBroadcastOn: {backgroundColor: '#22C55E' + '15'},
  cardIconBgBroadcastOff: {backgroundColor: c.textMuted + '15'},
  cardTitle: {fontSize: ms(13), fontWeight: '800', letterSpacing: 0.2, flex: 1, color: c.textPrimary},
  cardTitleLandscape: {fontSize: fs(13), marginBottom: ls(4), fontFamily: MONO},

  // ── Stats grid ──
  statsGrid: {flexDirection: 'row', flexWrap: 'wrap', gap: wp(8)},
  statsGridLandscape: {gap: ls(6)},
  statItem: {flexGrow: 1, flexBasis: '45%', alignItems: 'center', paddingVertical: wp(10), borderRadius: wp(10), borderWidth: 1, borderColor: c.borderLight},
  statItemLandscape: {paddingVertical: ls(12), borderRadius: ls(7)},
  statValue: {fontSize: ms(18), fontWeight: '900', marginTop: wp(4), color: c.textPrimary},
  statValueLandscape: {fontSize: fs(16)},
  statUnit: {fontSize: ms(11), fontWeight: '600', color: c.textMuted, fontFamily: MONO},
  statLabel: {fontSize: ms(10), fontWeight: '700', letterSpacing: 0.3, marginTop: wp(2), color: c.textMuted},
  statLabelLandscape: {fontSize: fs(11), fontFamily: MONO},

  // ── Behaviour ──
  behaviourRow: {flexDirection: 'row', gap: wp(8)},
  behaviourRowLandscape: {gap: ls(6)},
  behaviourItem: {flex: 1, alignItems: 'center', paddingVertical: wp(12), borderRadius: wp(10), borderWidth: 1},
  behaviourItemLandscape: {paddingVertical: ls(20), borderRadius: ls(7)},
  behaviourItemRed: {backgroundColor: '#FEF2F2', borderColor: '#FECACA'},
  behaviourItemAmber: {backgroundColor: '#FFFBEB', borderColor: '#FDE68A'},
  behaviourItemGreen: {backgroundColor: '#F0FDF4', borderColor: '#BBF7D0'},
  behaviourValue: {fontSize: ms(16), fontWeight: '900', marginTop: wp(4)},
  behaviourValueLandscape: {fontSize: fs(16), fontFamily: MONO},
  behaviourValueRed: {color: '#EF4444'},
  behaviourValueAmber: {color: '#F59E0B'},
  behaviourValueGreen: {color: '#22C55E'},
  behaviourLabel: {fontSize: ms(9), fontWeight: '700', color: '#6B7280', letterSpacing: 0.3, marginTop: wp(2)},
  behaviourLabelLandscape: {fontSize: fs(10), fontFamily: MONO},

  // ── Accelerometer ──
  accelRows: {gap: wp(10)},
  accelRowsLandscape: {gap: ls(8)},
  accelRowHeader: {flexDirection: 'row', justifyContent: 'space-between', marginBottom: wp(3)},
  accelRowHeaderLandscape: {flexDirection: 'row', justifyContent: 'space-between', marginBottom: ls(3)},
  accelLabel: {fontSize: ms(11), fontWeight: '700', color: c.textMuted},
  accelLabelLandscape: {fontSize: fs(12), fontFamily: MONO},
  accelVal: {fontSize: ms(11), fontWeight: '800'},
  accelValNormal: {color: c.textPrimary},
  accelValWarn: {color: '#EF4444'},
  accelValLandscape: {fontSize: fs(12), fontFamily: MONO},
  progressTrack: {height: wp(6), borderRadius: wp(3), overflow: 'hidden', backgroundColor: c.borderLight},
  progressFill: {height: '100%', borderRadius: wp(3)},

  // ── Coordinates ──
  coordCard: {flexDirection: 'row', alignItems: 'center', gap: wp(10)},
  coordCardLandscape: {padding: ls(10), borderRadius: ls(10), gap: ls(8)},
  coordContent: {flex: 1},
  coordLabel: {fontSize: ms(10), fontWeight: '700', letterSpacing: 0.3, color: c.textMuted},
  coordLabelLandscape: {fontSize: fs(12), fontFamily: MONO},
  coordValue: {fontSize: ms(13), fontWeight: '700', marginTop: 1, color: c.textPrimary},
  coordValueLandscape: {fontSize: fs(13), fontFamily: MONO},

  // ── Broadcasting ──
  broadcastCardLandscape: {padding: ls(22), borderRadius: ls(10)},
  broadcastRow: {flexDirection: 'row', alignItems: 'center'},
  broadcastText: {flex: 1, marginLeft: wp(10)},
  broadcastTextLandscape: {flex: 1, marginLeft: ls(8)},
  broadcastTitle: {fontSize: ms(13), fontWeight: '800', color: c.textPrimary},
  broadcastTitleLandscape: {fontSize: fs(13), fontFamily: MONO},
  broadcastSub: {fontSize: ms(11), fontWeight: '600', marginTop: 1},
  broadcastSubOn: {color: '#22C55E'},
  broadcastSubOff: {color: c.textMuted},
  broadcastSubLandscape: {fontSize: fs(11), fontFamily: MONO},
  broadcastToggle: {flexDirection: 'row', alignItems: 'center', gap: wp(4), paddingVertical: wp(8), paddingHorizontal: wp(14), borderRadius: wp(10)},
  broadcastToggleLandscape: {paddingVertical: ls(7), paddingHorizontal: ls(12), borderRadius: ls(8)},
  broadcastToggleStart: {backgroundColor: '#22C55E'},
  broadcastToggleStop: {backgroundColor: '#EF4444'},
  broadcastToggleText: {fontSize: ms(12), fontWeight: '800', color: '#fff', letterSpacing: 0.5},
  broadcastToggleTextLandscape: {fontSize: fs(11), fontFamily: MONO},
});
