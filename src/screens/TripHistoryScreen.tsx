import React, {useState, useEffect, useRef, useMemo, useCallback} from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ActivityIndicator,
  Platform,
  useWindowDimensions,
  PanResponder,
  type GestureResponderEvent,
  type LayoutChangeEvent,
} from 'react-native';
import {useSafeAreaInsets} from 'react-native-safe-area-context';
import MapboxGL from '@rnmapbox/maps';
import Config from 'react-native-config';
import Icon from '../components/Icon';
import Svg, {Rect, Circle, Ellipse, Path, Line, Defs, LinearGradient, Stop} from 'react-native-svg';
import type {NativeStackNavigationProp} from '@react-navigation/native-stack';
import type {RouteProp} from '@react-navigation/native';
import {useTheme} from '../contexts/ThemeContext';
import {ms, wp} from '../utils/responsive';
import {ticketsApi, trackingApi} from '../services/api';
import {useFontScaleRefresh} from '../contexts/FontSizeContext';
const MONO = Platform.OS === 'ios' ? 'Menlo' : 'monospace';

MapboxGL.setAccessToken(Config.MAPBOX_ACCESS_TOKEN || '');

type GpsRecord = {
  id?: number;
  latitude: number;
  longitude: number;
  speed: number | null;
  heading: number | null;
  altitude: number | null;
  accuracy: number | null;
  recorded_at: string;
};

type Props = {
  navigation: NativeStackNavigationProp<any>;
  route: RouteProp<any>;
};

function haversine(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 6371000;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLon = ((lon2 - lon1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((lat1 * Math.PI) / 180) *
      Math.cos((lat2 * Math.PI) / 180) *
      Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function formatDuration(seconds: number): string {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);
  if (h > 0) return `${h}h ${m}m ${s}s`;
  if (m > 0) return `${m}m ${s}s`;
  return `${s}s`;
}

function formatDistance(meters: number): string {
  if (meters >= 1000) {
    return `${(meters / 1000).toFixed(2)} km`;
  }
  return `${Math.round(meters)} m`;
}

function formatTime(dateStr: string): string {
  const d = new Date(dateStr);
  let h = d.getHours();
  const m = d.getMinutes();
  const ampm = h >= 12 ? 'pm' : 'am';
  h = h % 12 || 12;
  return `${h}:${m.toString().padStart(2, '0')} ${ampm}`;
}

function computeBearing(from: {lat: number; lng: number}, to: {lat: number; lng: number}): number {
  const dLng = ((to.lng - from.lng) * Math.PI) / 180;
  const lat1 = (from.lat * Math.PI) / 180;
  const lat2 = (to.lat * Math.PI) / 180;
  const y = Math.sin(dLng) * Math.cos(lat2);
  const x = Math.cos(lat1) * Math.sin(lat2) - Math.sin(lat1) * Math.cos(lat2) * Math.cos(dLng);
  return ((Math.atan2(y, x) * 180) / Math.PI + 360) % 360;
}

// Pure-JS slider — no native module needed
function TimelineSlider({fraction, onSeek}: {fraction: number; onSeek: (f: number) => void}) {
  const trackRef = useRef<View>(null);
  const trackLayout = useRef({x: 0, width: 0});
  const clamp = (v: number) => Math.max(0, Math.min(1, v));

  const measureAndSeek = (pageX: number) => {
    const {x, width} = trackLayout.current;
    if (width <= 0) return;
    onSeek(clamp((pageX - x) / width));
  };

  const panResponder = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onMoveShouldSetPanResponder: () => true,
      onPanResponderGrant: (e) => {
        // Measure fresh on each touch start to handle layout shifts
        trackRef.current?.measureInWindow((x, _y, width) => {
          trackLayout.current = {x, width};
          measureAndSeek(e.nativeEvent.pageX);
        });
      },
      onPanResponderMove: (e) => {
        measureAndSeek(e.nativeEvent.pageX);
      },
    }),
  ).current;

  const pct = `${clamp(fraction) * 100}%`;
  return (
    <View ref={trackRef} style={sliderStyles.container} {...panResponder.panHandlers}>
      <View style={sliderStyles.track}>
        <View style={[sliderStyles.filled, {width: pct}]} />
      </View>
      <View style={[sliderStyles.thumb, {left: pct}]} />
    </View>
  );
}
const sliderStyles = StyleSheet.create({
  container: {flex: 1, height: 20, justifyContent: 'center'},
  track: {height: 2, borderRadius: 1, backgroundColor: '#E2E8F0', overflow: 'hidden'},
  filled: {height: 2, backgroundColor: '#2563EB', borderRadius: 1},
  thumb: {
    position: 'absolute',
    width: 10,
    height: 10,
    borderRadius: 5,
    backgroundColor: '#2563EB',
    marginLeft: -5,
    top: 5,
    elevation: 3,
    shadowColor: '#000',
    shadowOffset: {width: 0, height: 1},
    shadowOpacity: 0.25,
    shadowRadius: 2,
  },
});

const truckMarkerStyles = StyleSheet.create({
  container: {alignItems: 'center'},
  label: {
    backgroundColor: '#1D4ED8',
    paddingHorizontal: 5,
    paddingVertical: 2,
    borderRadius: 4,
    marginBottom: 2,
    elevation: 4,
    shadowColor: '#000',
    shadowOffset: {width: 0, height: 1},
    shadowOpacity: 0.3,
    shadowRadius: 2,
  },
  labelText: {
    color: '#fff',
    fontSize: 8,
    fontWeight: '700',
    fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace',
  },
});

export default function TripHistoryScreen({navigation, route}: Props) {
  useFontScaleRefresh();
  const {c} = useTheme();
  const styles = createStyles(c);
  const insets = useSafeAreaInsets();
  const {width, height} = useWindowDimensions();
  const isTablet = Math.min(width, height) > 600;

  const params = (route.params || {}) as {ticketId?: number; ticketCode?: string};
  const ticketId = params.ticketId;
  const ticketCode = params.ticketCode || '';

  const [records, setRecords] = useState<GpsRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [isSatellite, setIsSatellite] = useState(false);
  const [zoomLevel, setZoomLevel] = useState(14);
  const cameraRef = useRef<MapboxGL.Camera>(null);
  const [matchedSegments, setMatchedSegments] = useState<[number, number][][]>([]);
  const mapboxToken = Config.MAPBOX_ACCESS_TOKEN || '';

  // ─── Playback state ───
  const [isPlaying, setIsPlaying] = useState(false);
  const [playbackIndex, setPlaybackIndex] = useState(0);
  const [animatedPos, setAnimatedPos] = useState<{lat: number; lng: number; bearing: number} | null>(null);
  const playbackRef = useRef<number | null>(null);
  const playbackStateRef = useRef({index: 0, segmentStart: 0});

  const fetchData = async () => {
    setLoading(true);
    setError(null);

    const today = new Date().toISOString().split('T')[0];

    try {
      const res = await trackingApi.getGpsHistory(today);
      console.log('[TripHistory] GPS history — date:', today, 'truck points:', res.data?.count);
      const points = res.data?.points || [];
      if (points.length > 0) {
        points.sort((a: GpsRecord, b: GpsRecord) =>
          new Date(a.recorded_at).getTime() - new Date(b.recorded_at).getTime(),
        );
        setRecords(points);
        setLoading(false);
        return;
      }
      console.log('[TripHistory] GPS history returned 0 points for today');
    } catch (err: any) {
      console.warn('[TripHistory] GPS history endpoint failed:', err.message);
    }

    if (ticketId) {
      try {
        console.log('[TripHistory] Falling back to ticket-specific GPS — ticketId:', ticketId);
        const fallback = await ticketsApi.getGpsRecords(ticketId);
        const points = fallback.data?.points || [];
        console.log('[TripHistory] Ticket GPS — points:', points.length);
        if (points.length > 0) {
          points.sort((a: GpsRecord, b: GpsRecord) =>
            new Date(a.recorded_at).getTime() - new Date(b.recorded_at).getTime(),
          );
          setRecords(points);
          setLoading(false);
          return;
        }
      } catch (err: any) {
        console.warn('[TripHistory] Ticket GPS fallback failed:', err.message);
      }
    }

    setError('No GPS data available for today. Check that the GPS history API is deployed.');
    setLoading(false);
  };

  useEffect(() => {
    fetchData();
  }, [ticketId]);

  // Auto-refresh every 30s
  const lastPointCount = useRef(0);
  useEffect(() => {
    const iv = setInterval(async () => {
      try {
        const today = new Date().toISOString().split('T')[0];
        const res = await trackingApi.getGpsHistory(today);
        const points = res.data?.points || [];
        if (points.length > lastPointCount.current) {
          console.log(`[TrackHistory] Auto-refresh — ${lastPointCount.current} → ${points.length} points`);
          points.sort((a: GpsRecord, b: GpsRecord) =>
            new Date(a.recorded_at).getTime() - new Date(b.recorded_at).getTime(),
          );
          setRecords(points);
          lastPointCount.current = points.length;
        }
      } catch {}
    }, 30000);
    return () => clearInterval(iv);
  }, []);

  useEffect(() => {
    lastPointCount.current = records.length;
  }, [records.length]);

  // Snap GPS trail to roads via Mapbox Map Matching + Directions API fallback
  useEffect(() => {
    if (records.length < 2 || !mapboxToken) {
      setMatchedSegments([]);
      return;
    }

    let cancelled = false;

    const getDirectionsRoute = async (
      from: {lng: number; lat: number},
      to: {lng: number; lat: number},
    ): Promise<[number, number][]> => {
      try {
        const res = await fetch(
          `https://api.mapbox.com/directions/v5/mapbox/driving/${from.lng},${from.lat};${to.lng},${to.lat}?access_token=${mapboxToken}&geometries=geojson&overview=full`,
        );
        const json = await res.json();
        if (json.routes?.[0]?.geometry?.coordinates?.length > 0) {
          return json.routes[0].geometry.coordinates;
        }
      } catch {}
      return [[from.lng, from.lat], [to.lng, to.lat]];
    };

    const matchSegment = async (trail: {lng: number; lat: number}[]): Promise<[number, number][]> => {
      const allCoords: [number, number][] = [];
      const BATCH = 100;

      for (let i = 0; i < trail.length; i += BATCH - 1) {
        const batch = trail.slice(i, i + BATCH);
        const coords = batch.map(p => `${p.lng},${p.lat}`).join(';');
        const radiuses = batch.map(() => '100').join(';');

        try {
          const res = await fetch(
            `https://api.mapbox.com/matching/v5/mapbox/driving/${coords}?access_token=${mapboxToken}&geometries=geojson&radiuses=${radiuses}&overview=full`,
          );
          const json = await res.json();

          const batchCoords: [number, number][] = [];
          if (json.matchings?.length > 0) {
            for (const matching of json.matchings) {
              if (matching.geometry?.coordinates) {
                const sliceFrom = batchCoords.length > 0 ? 1 : 0;
                batchCoords.push(...matching.geometry.coordinates.slice(sliceFrom));
              }
            }
          }

          if (batchCoords.length > 0) {
            const sliceFrom = i > 0 ? 1 : 0;
            allCoords.push(...batchCoords.slice(sliceFrom));
          } else {
            for (let j = (i > 0 ? 1 : 0); j < batch.length - 1; j++) {
              const segment = await getDirectionsRoute(batch[j], batch[j + 1]);
              const sliceFrom = allCoords.length > 0 ? 1 : 0;
              allCoords.push(...segment.slice(sliceFrom));
            }
          }
        } catch {
          for (let j = (i > 0 ? 1 : 0); j < batch.length - 1; j++) {
            try {
              const segment = await getDirectionsRoute(batch[j], batch[j + 1]);
              const sliceFrom = allCoords.length > 0 ? 1 : 0;
              allCoords.push(...segment.slice(sliceFrom));
            } catch {
              allCoords.push([batch[j].lng, batch[j].lat]);
            }
          }
        }
      }
      return allCoords;
    };

    const processTrail = async () => {
      const GAP_MS = 5 * 60 * 1000;
      const trail = records.map(r => ({lng: r.longitude, lat: r.latitude, recorded_at: r.recorded_at}));
      const segments: {lng: number; lat: number}[][] = [];
      let current: {lng: number; lat: number}[] = [trail[0]];

      for (let j = 1; j < trail.length; j++) {
        const gap = new Date(trail[j].recorded_at).getTime() - new Date(trail[j - 1].recorded_at).getTime();
        if (gap > GAP_MS) {
          if (current.length >= 2) segments.push(current);
          current = [trail[j]];
        } else {
          current.push(trail[j]);
        }
      }
      if (current.length >= 2) segments.push(current);

      const result: [number, number][][] = [];
      for (const seg of segments) {
        if (cancelled) return;
        const matched = await matchSegment(seg);
        if (matched.length >= 2) result.push(matched);
      }

      if (!cancelled) {
        setMatchedSegments(result);
      }
    };

    processTrail();
    return () => { cancelled = true; };
  }, [records, mapboxToken]);

  // ─── Playback: reset when records change ───
  useEffect(() => {
    if (records.length > 0) {
      if (playbackRef.current) {
        cancelAnimationFrame(playbackRef.current);
        playbackRef.current = null;
      }
      setIsPlaying(false);
      setPlaybackIndex(records.length - 1);
      setAnimatedPos(null);
    }
  }, [records.length]);

  // Cleanup animation on unmount
  useEffect(() => {
    return () => {
      if (playbackRef.current) cancelAnimationFrame(playbackRef.current);
    };
  }, []);

  // ─── Playback animation — interpolates between GPS points at 60fps ───
  useEffect(() => {
    if (!isPlaying || records.length < 2) return;

    const state = playbackStateRef.current;
    state.index = playbackIndex;
    state.segmentStart = Date.now();

    function tick() {
      const elapsed = Date.now() - state.segmentStart;
      const t = Math.min(elapsed / 500, 1); // 500ms per segment

      const from = records[state.index];
      const to = records[state.index + 1];
      if (!from || !to) {
        setIsPlaying(false);
        return;
      }

      setAnimatedPos({
        lat: from.latitude + (to.latitude - from.latitude) * t,
        lng: from.longitude + (to.longitude - from.longitude) * t,
        bearing: computeBearing(
          {lat: from.latitude, lng: from.longitude},
          {lat: to.latitude, lng: to.longitude},
        ),
      });

      if (t >= 1) {
        state.index += 1;
        state.segmentStart = Date.now();
        setPlaybackIndex(state.index);
        if (state.index >= records.length - 1) {
          setIsPlaying(false);
          setPlaybackIndex(records.length - 1);
          setAnimatedPos(null);
          return;
        }
      }

      playbackRef.current = requestAnimationFrame(tick);
    }

    playbackRef.current = requestAnimationFrame(tick);
    return () => {
      if (playbackRef.current) cancelAnimationFrame(playbackRef.current);
    };
  }, [isPlaying]); // eslint-disable-line react-hooks/exhaustive-deps

  // Snap animated position to a trail index
  const snapToIndex = useCallback((idx: number) => {
    const cur = records[idx];
    if (!cur) return;
    const next = idx < records.length - 1 ? records[idx + 1] : null;
    const prev = idx > 0 ? records[idx - 1] : null;
    const ref = next || prev;
    if (ref) {
      const bearing = computeBearing(
        {lat: next ? cur.latitude : prev!.latitude, lng: next ? cur.longitude : prev!.longitude},
        {lat: next ? ref.latitude : cur.latitude, lng: next ? ref.longitude : cur.longitude},
      );
      setAnimatedPos({lat: cur.latitude, lng: cur.longitude, bearing});
    }
  }, [records]);

  const stopAnimation = useCallback(() => {
    if (playbackRef.current) {
      cancelAnimationFrame(playbackRef.current);
      playbackRef.current = null;
    }
    setIsPlaying(false);
  }, []);

  const togglePlayback = useCallback(() => {
    if (isPlaying) {
      stopAnimation();
    } else {
      let startIdx = playbackIndex;
      if (startIdx >= records.length - 1) {
        startIdx = 0;
        setPlaybackIndex(0);
      }
      snapToIndex(startIdx);
      setIsPlaying(true);
    }
  }, [isPlaying, playbackIndex, records.length, stopAnimation, snapToIndex]);

  const resetPlayback = useCallback(() => {
    stopAnimation();
    setPlaybackIndex(0);
    snapToIndex(0);
  }, [stopAnimation, snapToIndex]);

  // ─── Computed values ───

  const isAtEnd = playbackIndex >= records.length - 1;
  const toKmh = (mps: number) => Math.round(mps * 3.6);

  const summary = useMemo(() => {
    if (records.length === 0) {
      return {distance: 0, duration: 0, avgSpeed: 0, maxSpeed: 0, points: 0};
    }

    let totalDistance = 0;
    let maxSpd = 0;
    const speeds: number[] = [];

    for (let i = 0; i < records.length; i++) {
      const r = records[i];
      if (r.speed !== null && r.speed >= 0) {
        speeds.push(r.speed);
        if (r.speed > maxSpd) maxSpd = r.speed;
      }
      if (i > 0) {
        const prev = records[i - 1];
        totalDistance += haversine(prev.latitude, prev.longitude, r.latitude, r.longitude);
      }
    }

    const firstTime = new Date(records[0].recorded_at).getTime();
    const lastTime = new Date(records[records.length - 1].recorded_at).getTime();
    const durationSec = Math.max(0, (lastTime - firstTime) / 1000);

    const avgSpd = speeds.length > 0 ? speeds.reduce((a, b) => a + b, 0) / speeds.length : 0;

    return {
      distance: totalDistance,
      duration: durationSec,
      avgSpeed: avgSpd,
      maxSpeed: maxSpd,
      points: records.length,
    };
  }, [records]);

  // Full route GeoJSON (for faded future line)
  const routeGeoJSON = useMemo(() => {
    const segments = matchedSegments.length > 0
      ? matchedSegments
      : records.length >= 2
        ? [records.map(r => [r.longitude, r.latitude] as [number, number])]
        : null;
    if (!segments || segments.length === 0) return null;
    return {
      type: 'FeatureCollection' as const,
      features: [
        {
          type: 'Feature' as const,
          properties: {},
          geometry: {
            type: 'MultiLineString' as const,
            coordinates: segments,
          },
        },
      ],
    };
  }, [records, matchedSegments]);

  // Active route GeoJSON (partial during playback, full when at end)
  const activeRouteGeoJSON = useMemo(() => {
    if (records.length < 2) return null;
    if (isAtEnd) return routeGeoJSON;

    const segments = matchedSegments.length > 0
      ? matchedSegments
      : [records.map(r => [r.longitude, r.latitude] as [number, number])];

    const fraction = records.length > 1
      ? Math.min(playbackIndex / (records.length - 1), 1)
      : 1;
    const totalCoords = segments.reduce((sum, seg) => sum + seg.length, 0);
    const cutoffTotal = Math.max(2, Math.round(fraction * totalCoords));

    const activeSegs: [number, number][][] = [];
    let remaining = cutoffTotal;
    for (const seg of segments) {
      if (remaining <= 0) break;
      if (remaining >= seg.length) {
        activeSegs.push(seg);
        remaining -= seg.length;
      } else {
        activeSegs.push(seg.slice(0, remaining));
        remaining = 0;
      }
    }

    if (activeSegs.length === 0) return null;
    return {
      type: 'FeatureCollection' as const,
      features: [{
        type: 'Feature' as const,
        properties: {},
        geometry: {
          type: 'MultiLineString' as const,
          coordinates: activeSegs,
        },
      }],
    };
  }, [playbackIndex, records, matchedSegments, routeGeoJSON, isAtEnd]);

  // Playback time info
  const playbackTime = useMemo(() => {
    if (records.length < 2) return {current: '', start: '', end: '', speed: 0};
    const curIdx = Math.min(playbackIndex, records.length - 1);
    return {
      current: formatTime(records[curIdx].recorded_at),
      start: formatTime(records[0].recorded_at),
      end: formatTime(records[records.length - 1].recorded_at),
      speed: records[curIdx].speed || 0,
    };
  }, [records, playbackIndex]);

  const sliderFraction = records.length > 1
    ? Math.min(playbackIndex / (records.length - 1), 1)
    : 1;

  const bounds = useMemo(() => {
    if (records.length === 0) return null;
    let minLat = records[0].latitude;
    let maxLat = records[0].latitude;
    let minLng = records[0].longitude;
    let maxLng = records[0].longitude;
    for (const r of records) {
      if (r.latitude < minLat) minLat = r.latitude;
      if (r.latitude > maxLat) maxLat = r.latitude;
      if (r.longitude < minLng) minLng = r.longitude;
      if (r.longitude > maxLng) maxLng = r.longitude;
    }
    return {
      ne: [maxLng, maxLat] as [number, number],
      sw: [minLng, minLat] as [number, number],
      paddingTop: 60,
      paddingBottom: 60,
      paddingLeft: 40,
      paddingRight: 40,
    };
  }, [records]);

  const startPoint = useMemo(() => {
    if (matchedSegments.length > 0) {
      const first = matchedSegments[0][0];
      return first ? {latitude: first[1], longitude: first[0], recorded_at: records[0]?.recorded_at} : null;
    }
    return records.length > 0 ? records[0] : null;
  }, [records, matchedSegments]);

  const endPoint = useMemo(() => {
    if (matchedSegments.length > 0) {
      const lastSeg = matchedSegments[matchedSegments.length - 1];
      const last = lastSeg[lastSeg.length - 1];
      return last ? {latitude: last[1], longitude: last[0], recorded_at: records[records.length - 1]?.recorded_at} : null;
    }
    return records.length > 0 ? records[records.length - 1] : null;
  }, [records, matchedSegments]);

  const headerPadding = {
    paddingTop: insets.top + wp(6),
    paddingLeft: Math.max(wp(12), insets.left + wp(6)),
    paddingRight: Math.max(wp(12), insets.right + wp(6)),
  };

  const recenter = () => {
    if (!bounds) return;
    cameraRef.current?.fitBounds(bounds.ne, bounds.sw, [60, 40, 60, 40], 800);
  };

  // Loading state
  if (loading) {
    return (
      <View style={styles.container}>
        <View style={[styles.header, headerPadding]}>
          <TouchableOpacity onPress={() => navigation.goBack()} style={styles.backBtn} activeOpacity={0.7}>
            <Icon name="arrow-back" size={22} color={c.textOnPrimary} />
          </TouchableOpacity>
          <View style={styles.headerTitleWrapper}>
            <Text style={styles.headerTitle} numberOfLines={1}>
              Track History{ticketCode ? ` - ${ticketCode}` : ''}
            </Text>
          </View>
        </View>
        <View style={styles.centerContent}>
          <ActivityIndicator size="large" color={c.primary} />
          <Text style={styles.loadingText}>Loading GPS records...</Text>
        </View>
      </View>
    );
  }

  // Error state
  if (error) {
    return (
      <View style={styles.container}>
        <View style={[styles.header, headerPadding]}>
          <TouchableOpacity onPress={() => navigation.goBack()} style={styles.backBtn} activeOpacity={0.7}>
            <Icon name="arrow-back" size={22} color={c.textOnPrimary} />
          </TouchableOpacity>
          <View style={styles.headerTitleWrapper}>
            <Text style={styles.headerTitle} numberOfLines={1}>
              Track History{ticketCode ? ` - ${ticketCode}` : ''}
            </Text>
          </View>
        </View>
        <View style={styles.centerContent}>
          <Icon name="error-outline" size={ms(48)} color={c.textMuted} />
          <Text style={styles.errorText}>{error}</Text>
          <TouchableOpacity style={styles.retryBtn} onPress={fetchData} activeOpacity={0.8}>
            <Icon name="refresh" size={20} color="#fff" />
            <Text style={styles.retryBtnText}>Retry</Text>
          </TouchableOpacity>
        </View>
      </View>
    );
  }

  // Empty state
  if (records.length === 0) {
    return (
      <View style={styles.container}>
        <View style={[styles.header, headerPadding]}>
          <TouchableOpacity onPress={() => navigation.goBack()} style={styles.backBtn} activeOpacity={0.7}>
            <Icon name="arrow-back" size={22} color={c.textOnPrimary} />
          </TouchableOpacity>
          <View style={styles.headerTitleWrapper}>
            <Text style={styles.headerTitle} numberOfLines={1}>
              Track History{ticketCode ? ` - ${ticketCode}` : ''}
            </Text>
          </View>
        </View>
        <View style={styles.centerContent}>
          <Icon name="location-off" size={ms(48)} color={c.textMuted} />
          <Text style={styles.emptyTitle}>No GPS Records</Text>
          <Text style={styles.emptySubtext}>No GPS tracking data is available for this ticket.</Text>
          <TouchableOpacity style={styles.goBackBtn} onPress={() => navigation.goBack()} activeOpacity={0.7}>
            <Text style={styles.goBackText}>Go Back</Text>
          </TouchableOpacity>
        </View>
      </View>
    );
  }

  // Map + summary
  return (
    <View style={styles.container}>
      {/* Header */}
      <View style={[styles.header, headerPadding]}>
        <TouchableOpacity onPress={() => navigation.goBack()} style={styles.backBtn} activeOpacity={0.7}>
          <Icon name="arrow-back" size={22} color={c.textOnPrimary} />
        </TouchableOpacity>
        <View style={styles.headerTitleWrapper}>
          <Text style={styles.headerTitle} numberOfLines={1}>
            Track History{ticketCode ? ` - ${ticketCode}` : ''}
          </Text>
        </View>
        <TouchableOpacity onPress={() => fetchData()} style={styles.headerBtn} activeOpacity={0.7}>
          <Icon name="refresh" size={20} color={c.textOnPrimary} />
        </TouchableOpacity>
        <TouchableOpacity onPress={() => setIsSatellite(s => !s)} style={styles.headerBtn} activeOpacity={0.7}>
          <Icon name={isSatellite ? 'map' : 'satellite'} size={20} color={c.textOnPrimary} />
        </TouchableOpacity>
      </View>

      {/* Map */}
      <View style={styles.mapWrapper}>
        <MapboxGL.MapView
          style={styles.map}
          styleURL={isSatellite ? MapboxGL.StyleURL.SatelliteStreet : 'mapbox://styles/mapbox/traffic-day-v2'}
          logoEnabled={false}
          attributionEnabled={false}
          scaleBarEnabled={false}>
          <MapboxGL.Camera
            ref={cameraRef}
            bounds={bounds ? {ne: bounds.ne, sw: bounds.sw, paddingTop: 60, paddingBottom: 60, paddingLeft: 40, paddingRight: 40} : undefined}
            animationMode="flyTo"
            animationDuration={1000}
          />

          {/* Future route — faded dashed (only when not at end) */}
          {routeGeoJSON && !isAtEnd && (
            <MapboxGL.ShapeSource id="futureRouteSource" shape={routeGeoJSON}>
              <MapboxGL.LineLayer
                id="futureRouteLine"
                style={{
                  lineColor: '#2563EB',
                  lineWidth: 2,
                  lineOpacity: 0.15,
                  lineDasharray: [2, 4],
                  lineCap: 'round' as const,
                  lineJoin: 'round' as const,
                }}
              />
            </MapboxGL.ShapeSource>
          )}

          {/* Active route — solid (partial or full based on playback) */}
          {activeRouteGeoJSON && (
            <MapboxGL.ShapeSource id="routeSource" shape={activeRouteGeoJSON}>
              <MapboxGL.LineLayer
                id="routeLineOutline"
                style={{
                  lineColor: '#1E40AF',
                  lineWidth: 7,
                  lineOpacity: 0.2,
                  lineCap: 'round' as const,
                  lineJoin: 'round' as const,
                }}
              />
              <MapboxGL.LineLayer
                id="routeLine"
                style={{
                  lineColor: '#2563EB',
                  lineWidth: 4,
                  lineOpacity: 0.85,
                  lineCap: 'round' as const,
                  lineJoin: 'round' as const,
                }}
              />
            </MapboxGL.ShapeSource>
          )}

          {/* Route direction arrows */}
          {activeRouteGeoJSON && (
            <MapboxGL.Images images={{routeArrow: require('../../assets/route-arrow.png')}} />
          )}
          {activeRouteGeoJSON && (
            <MapboxGL.ShapeSource id="arrowSource" shape={activeRouteGeoJSON}>
              <MapboxGL.SymbolLayer
                id="routeArrows"
                style={{
                  iconImage: 'routeArrow',
                  symbolPlacement: 'line' as const,
                  symbolSpacing: 80,
                  iconSize: 0.5,
                  iconRotate: 90,
                  iconAllowOverlap: true,
                  iconRotationAlignment: 'map' as const,
                }}
              />
            </MapboxGL.ShapeSource>
          )}

          {/* Start marker — always visible */}
          {startPoint && (
            <MapboxGL.ShapeSource
              id="startMarker"
              shape={{type: 'Feature', properties: {label: 'START'}, geometry: {type: 'Point', coordinates: [startPoint.longitude, startPoint.latitude]}}}>
              <MapboxGL.CircleLayer
                id="startDot"
                style={{circleRadius: 6, circleColor: '#22C55E', circleStrokeColor: '#fff', circleStrokeWidth: 2}}
              />
              <MapboxGL.SymbolLayer
                id="startLabel"
                style={{
                  textField: 'START',
                  textSize: 9,
                  textFont: ['DIN Pro Bold', 'Arial Unicode MS Bold'],
                  textColor: '#fff',
                  textHaloColor: '#16A34A',
                  textHaloWidth: 4,
                  textOffset: [0, -1.8],
                  textAllowOverlap: true,
                }}
              />
            </MapboxGL.ShapeSource>
          )}

          {/* End marker — only visible when slider is at end */}
          {endPoint && records.length > 1 && isAtEnd && (
            <MapboxGL.ShapeSource
              id="endMarker"
              shape={{type: 'Feature', properties: {label: 'END'}, geometry: {type: 'Point', coordinates: [endPoint.longitude, endPoint.latitude]}}}>
              <MapboxGL.CircleLayer
                id="endDot"
                style={{circleRadius: 6, circleColor: '#EF4444', circleStrokeColor: '#fff', circleStrokeWidth: 2}}
              />
              <MapboxGL.SymbolLayer
                id="endLabel"
                style={{
                  textField: 'END',
                  textSize: 9,
                  textFont: ['DIN Pro Bold', 'Arial Unicode MS Bold'],
                  textColor: '#fff',
                  textHaloColor: '#DC2626',
                  textHaloWidth: 4,
                  textOffset: [0, -1.8],
                  textAllowOverlap: true,
                }}
              />
            </MapboxGL.ShapeSource>
          )}

          {/* Animated truck marker during playback */}
          {animatedPos && !isAtEnd && (
            <MapboxGL.MarkerView
              coordinate={[animatedPos.lng, animatedPos.lat]}
              anchor={{x: 0.5, y: 0.5}}>
              <View style={truckMarkerStyles.container}>
                <View style={truckMarkerStyles.label}>
                  <Text style={truckMarkerStyles.labelText}>
                    {toKmh(records[Math.min(playbackIndex, records.length - 1)]?.speed || 0)} km/h
                  </Text>
                </View>
                <View style={{transform: [{rotate: `${animatedPos.bearing}deg`}]}}>
                  <Svg width={24} height={40} viewBox="0 0 34 58">
                    <Defs>
                      <LinearGradient id="cg" x1="0" y1="0" x2="0" y2="1">
                        <Stop offset="0%" stopColor="#2563EB" />
                        <Stop offset="100%" stopColor="#1D4ED8" />
                      </LinearGradient>
                      <LinearGradient id="bg" x1="0" y1="0" x2="0" y2="1">
                        <Stop offset="0%" stopColor="#1E40AF" />
                        <Stop offset="100%" stopColor="#1E3A8A" />
                      </LinearGradient>
                      <LinearGradient id="dg" x1="0" y1="0" x2="1" y2="1">
                        <Stop offset="0%" stopColor="#60A5FA" />
                        <Stop offset="50%" stopColor="#3B82F6" />
                        <Stop offset="100%" stopColor="#2563EB" />
                      </LinearGradient>
                      <LinearGradient id="wg" x1="0" y1="0" x2="1" y2="1">
                        <Stop offset="0%" stopColor="#DBEAFE" />
                        <Stop offset="100%" stopColor="#93C5FD" />
                      </LinearGradient>
                    </Defs>
                    <Ellipse cx={17} cy={54} rx={12} ry={3} fill="#000" opacity={0.12} />
                    <Rect x={7} y={1} width={20} height={3} rx={1.5} fill="#334155" />
                    <Rect x={7} y={1} width={3} height={3} rx={1} fill="#FEF9C3" />
                    <Rect x={24} y={1} width={3} height={3} rx={1} fill="#FEF9C3" />
                    <Rect x={6} y={4} width={22} height={14} rx={3} fill="url(#cg)" />
                    <Rect x={8} y={5} width={18} height={7} rx={2} fill="url(#wg)" />
                    <Rect x={9} y={6} width={6} height={3} rx={1} fill="#fff" opacity={0.25} />
                    <Path d="M3 9 Q2 9 2 10 L2 13 Q2 14 3 14 L5 14 L5 9 Z" fill="#475569" />
                    <Path d="M31 9 Q32 9 32 10 L32 13 Q32 14 31 14 L29 14 L29 9 Z" fill="#475569" />
                    <Rect x={1} y={6} width={5} height={8} rx={2} fill="#1E293B" />
                    <Rect x={28} y={6} width={5} height={8} rx={2} fill="#1E293B" />
                    <Circle cx={3.5} cy={10} r={1.5} fill="#475569" />
                    <Circle cx={30.5} cy={10} r={1.5} fill="#475569" />
                    <Rect x={6} y={18} width={22} height={30} rx={2} fill="url(#bg)" />
                    <Rect x={7} y={17} width={20} height={1.5} rx={0.5} fill="#0F172A" opacity={0.2} />
                    <Ellipse cx={17} cy={33} rx={9} ry={12} fill="url(#dg)" />
                    <Ellipse cx={14} cy={30} rx={5} ry={7} fill="#60A5FA" opacity={0.25} />
                    <Path d="M10 24 Q17 30 10 38" stroke="#2563EB" strokeWidth={0.8} fill="none" opacity={0.5} />
                    <Path d="M14 22 Q20 30 14 40" stroke="#2563EB" strokeWidth={0.8} fill="none" opacity={0.5} />
                    <Path d="M19 22 Q25 30 19 40" stroke="#2563EB" strokeWidth={0.8} fill="none" opacity={0.5} />
                    <Path d="M23 24 Q29 30 23 38" stroke="#2563EB" strokeWidth={0.8} fill="none" opacity={0.3} />
                    <Path d="M13 45 L13 49 Q13 50 14 50 L20 50 Q21 50 21 49 L21 45" fill="#64748B" />
                    <Rect x={0} y={38} width={6} height={8} rx={2} fill="#1E293B" />
                    <Rect x={28} y={38} width={6} height={8} rx={2} fill="#1E293B" />
                    <Circle cx={3} cy={42} r={1.5} fill="#475569" />
                    <Circle cx={31} cy={42} r={1.5} fill="#475569" />
                    <Rect x={7} y={49} width={20} height={2.5} rx={1} fill="#334155" />
                    <Rect x={7} y={49} width={4} height={2.5} rx={1} fill="#EF4444" />
                    <Rect x={23} y={49} width={4} height={2.5} rx={1} fill="#EF4444" />
                  </Svg>
                </View>
              </View>
            </MapboxGL.MarkerView>
          )}
        </MapboxGL.MapView>

        {/* Route Timeline */}
        {records.length >= 2 && (
          <View style={styles.timelinePanel}>
            {/* Header row */}
            <View style={styles.timelineHeader}>
              <View style={styles.timelineHeaderLeft}>
                {ticketCode ? (
                  <>
                    <Text style={styles.timelineTruckCode}>{ticketCode}</Text>
                    <View style={styles.timelineHeaderDivider} />
                  </>
                ) : null}
                <Icon name="schedule" size={12} color="#94A3B8" />
                <Text style={styles.timelineHeaderLabel}>Route Timeline</Text>
              </View>
              <View style={styles.timelineHeaderRight}>
                <Text style={styles.timelineSpeed}>{toKmh(playbackTime.speed)} km/h</Text>
                <View style={styles.timelineBadge}>
                  <Text style={styles.timelineBadgeText}>{playbackTime.current}</Text>
                </View>
              </View>
            </View>

            {/* Slider + controls */}
            <View style={styles.timelineControls}>
              <TouchableOpacity style={styles.playBtn} onPress={togglePlayback} activeOpacity={0.7}>
                <Icon name={isPlaying ? 'pause' : 'play-arrow'} size={14} color="#2563EB" />
              </TouchableOpacity>

              <TimelineSlider
                fraction={sliderFraction}
                onSeek={(fraction: number) => {
                  const idx = Math.round(fraction * (records.length - 1));
                  stopAnimation();
                  setPlaybackIndex(idx);
                  if (idx >= records.length - 1) {
                    setAnimatedPos(null);
                  } else {
                    snapToIndex(idx);
                  }
                }}
              />

              <TouchableOpacity style={styles.resetBtn2} onPress={resetPlayback} activeOpacity={0.7}>
                <Icon name="replay" size={13} color="#94A3B8" />
              </TouchableOpacity>
            </View>

            {/* Time range labels */}
            <View style={styles.timeRange}>
              <Text style={styles.timeRangeText}>{playbackTime.start}</Text>
              <Text style={styles.timeRangeText}>{playbackTime.end}</Text>
            </View>
          </View>
        )}

        {/* Zoom controls */}
        <View style={styles.zoomControls}>
          <TouchableOpacity
            style={styles.zoomBtnTop}
            onPress={() => {
              const z = Math.min(20, zoomLevel + 1);
              setZoomLevel(z);
              cameraRef.current?.setCamera({zoomLevel: z, animationDuration: 300});
            }}
            activeOpacity={0.7}>
            <Icon name="add" size={22} color="#333" />
          </TouchableOpacity>
          <TouchableOpacity
            style={styles.zoomBtn}
            onPress={() => {
              const z = Math.max(1, zoomLevel - 1);
              setZoomLevel(z);
              cameraRef.current?.setCamera({zoomLevel: z, animationDuration: 300});
            }}
            activeOpacity={0.7}>
            <Icon name="remove" size={22} color="#333" />
          </TouchableOpacity>
        </View>

        {/* Recenter button */}
        <TouchableOpacity style={styles.recenterBtn} onPress={recenter} activeOpacity={0.8}>
          <Icon name="my-location" size={20} color="#333" />
        </TouchableOpacity>
      </View>

      {/* Trip Summary */}
      <View style={[styles.summaryBar, {paddingBottom: Math.max(insets.bottom, wp(12))}]}>
        <View style={styles.summaryRow}>
          <View style={styles.summaryItem}>
            <Icon name="straighten" size={ms(16)} color={c.primary} />
            <Text style={styles.summaryValue}>{formatDistance(summary.distance)}</Text>
            <Text style={styles.summaryLabel}>Distance</Text>
          </View>
          <View style={styles.summaryDivider} />
          <View style={styles.summaryItem}>
            <Icon name="timer" size={ms(16)} color={c.accent} />
            <Text style={styles.summaryValue}>{formatDuration(summary.duration)}</Text>
            <Text style={styles.summaryLabel}>Duration</Text>
          </View>
          <View style={styles.summaryDivider} />
          <View style={styles.summaryItem}>
            <Icon name="speed" size={ms(16)} color="#F59E0B" />
            <Text style={styles.summaryValue}>{toKmh(summary.avgSpeed)} km/h</Text>
            <Text style={styles.summaryLabel}>Avg Speed</Text>
          </View>
          <View style={styles.summaryDivider} />
          <View style={styles.summaryItem}>
            <Icon name="speed" size={ms(16)} color="#EF4444" />
            <Text style={styles.summaryValue}>{toKmh(summary.maxSpeed)} km/h</Text>
            <Text style={styles.summaryLabel}>Max Speed</Text>
          </View>
        </View>
      </View>
    </View>
  );
}

const createStyles = (c: any) =>
  StyleSheet.create({
    container: {flex: 1, backgroundColor: c.background},

    // Header
    header: {
      paddingBottom: wp(10),
      flexDirection: 'row',
      alignItems: 'center',
      gap: wp(10),
      backgroundColor: c.primary,
      elevation: 4,
      shadowColor: '#000',
      shadowOffset: {width: 0, height: 2},
      shadowOpacity: 0.15,
      shadowRadius: 4,
      zIndex: 10,
    },
    backBtn: {
      width: wp(36),
      height: wp(36),
      borderRadius: wp(10),
      justifyContent: 'center',
      alignItems: 'center',
    },
    headerTitleWrapper: {flex: 1},
    headerTitle: {
      fontSize: ms(14),
      fontWeight: '700',
      color: c.textOnPrimary,
      fontFamily: MONO,
    },
    headerSub: {
      fontSize: ms(10),
      marginTop: 1,
      color: c.textOnDark70,
      fontFamily: MONO,
    },
    headerBtn: {
      width: wp(36),
      height: wp(36),
      borderRadius: wp(10),
      justifyContent: 'center',
      alignItems: 'center',
      backgroundColor: c.overlay15,
    },

    // Center content (loading / error / empty)
    centerContent: {
      flex: 1,
      justifyContent: 'center',
      alignItems: 'center',
      paddingHorizontal: 30,
    },
    loadingText: {
      fontSize: ms(14),
      color: c.textSecondary,
      marginTop: 16,
      fontFamily: MONO,
    },
    errorText: {
      fontSize: ms(14),
      color: c.textSecondary,
      marginTop: 16,
      textAlign: 'center',
      fontFamily: MONO,
    },
    retryBtn: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      gap: 8,
      backgroundColor: c.primary,
      marginTop: 24,
      paddingVertical: 14,
      paddingHorizontal: 28,
      borderRadius: 8,
    },
    retryBtnText: {
      fontSize: ms(15),
      fontWeight: '800',
      color: '#fff',
      fontFamily: MONO,
    },
    emptyTitle: {
      fontSize: ms(16),
      fontWeight: '700',
      color: c.textPrimary,
      marginTop: 16,
      textAlign: 'center',
      fontFamily: MONO,
    },
    emptySubtext: {
      fontSize: ms(12),
      color: c.textSecondary,
      marginTop: 8,
      textAlign: 'center',
      fontFamily: MONO,
    },
    goBackBtn: {marginTop: 16},
    goBackText: {
      fontSize: ms(14),
      fontWeight: '600',
      color: c.accent,
      fontFamily: MONO,
    },

    // Map
    mapWrapper: {flex: 1},
    map: {flex: 1},

    // Markers
    markerWrapper: {
      alignItems: 'center',
    },
    markerLabel: {
      paddingHorizontal: 6,
      paddingVertical: 2,
      borderRadius: 3,
      marginBottom: 2,
      elevation: 4,
      shadowColor: '#000',
      shadowOffset: {width: 0, height: 2},
      shadowOpacity: 0.3,
      shadowRadius: 3,
    },
    markerLabelStart: {
      backgroundColor: '#16A34A',
    },
    markerLabelEnd: {
      backgroundColor: '#DC2626',
    },
    markerLabelText: {
      fontSize: 8,
      fontWeight: '800',
      color: '#fff',
      letterSpacing: 0.5,
    },
    markerDot: {
      width: 12,
      height: 12,
      borderRadius: 6,
      borderWidth: 2,
      borderColor: '#fff',
      elevation: 4,
      shadowColor: '#000',
      shadowOffset: {width: 0, height: 1},
      shadowOpacity: 0.3,
      shadowRadius: 2,
    },
    markerDotStart: {
      backgroundColor: '#22C55E',
    },
    markerDotEnd: {
      backgroundColor: '#EF4444',
    },

    // Zoom controls
    zoomControls: {
      position: 'absolute',
      right: 12,
      bottom: 80,
      backgroundColor: '#fff',
      borderRadius: 6,
      elevation: 4,
      shadowColor: '#000',
      shadowOffset: {width: 0, height: 2},
      shadowOpacity: 0.2,
      shadowRadius: 4,
      borderWidth: 1,
      borderColor: '#ccc',
      overflow: 'hidden',
    },
    zoomBtnTop: {
      width: 40,
      height: 40,
      justifyContent: 'center',
      alignItems: 'center',
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderBottomColor: '#ccc',
    },
    zoomBtn: {
      width: 40,
      height: 40,
      justifyContent: 'center',
      alignItems: 'center',
    },
    recenterBtn: {
      position: 'absolute',
      right: 12,
      bottom: 24,
      width: 40,
      height: 40,
      borderRadius: 8,
      backgroundColor: '#fff',
      justifyContent: 'center',
      alignItems: 'center',
      elevation: 3,
      shadowColor: '#000',
      shadowOffset: {width: 0, height: 2},
      shadowOpacity: 0.15,
      shadowRadius: 4,
      borderWidth: 1,
      borderColor: '#ddd',
    },

    // Route Timeline
    timelinePanel: {
      position: 'absolute',
      top: wp(6),
      left: '15%',
      right: '15%',
      backgroundColor: 'rgba(255,255,255,0.97)',
      borderRadius: wp(8),
      paddingTop: wp(4),
      paddingHorizontal: wp(8),
      paddingBottom: wp(3),
      elevation: 8,
      shadowColor: '#000',
      shadowOffset: {width: 0, height: 4},
      shadowOpacity: 0.18,
      shadowRadius: 12,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: 'rgba(0,0,0,0.08)',
    },
    timelineHeader: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      marginBottom: wp(2),
    },
    timelineHeaderLeft: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: wp(3),
    },
    timelineTruckCode: {
      fontSize: ms(8),
      fontWeight: '700',
      color: '#1E293B',
      fontFamily: MONO,
    },
    timelineHeaderDivider: {
      width: 1,
      height: 10,
      backgroundColor: '#E2E8F0',
    },
    timelineHeaderLabel: {
      fontSize: ms(8),
      fontWeight: '500',
      color: '#64748B',
    },
    timelineHeaderRight: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: wp(4),
    },
    timelineSpeed: {
      fontSize: ms(8),
      color: '#94A3B8',
      fontFamily: MONO,
    },
    timelineBadge: {
      backgroundColor: 'rgba(37,99,235,0.1)',
      paddingHorizontal: wp(5),
      paddingVertical: wp(1),
      borderRadius: wp(3),
    },
    timelineBadgeText: {
      fontSize: ms(8),
      fontWeight: '700',
      color: '#2563EB',
      fontFamily: MONO,
    },
    timelineControls: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: wp(4),
    },
    playBtn: {
      width: wp(20),
      height: wp(20),
      borderRadius: wp(10),
      backgroundColor: 'rgba(37,99,235,0.1)',
      justifyContent: 'center',
      alignItems: 'center',
    },
    resetBtn2: {
      width: wp(18),
      height: wp(18),
      borderRadius: wp(9),
      justifyContent: 'center',
      alignItems: 'center',
    },
    timeRange: {
      flexDirection: 'row',
      justifyContent: 'space-between',
      paddingLeft: wp(26),
      paddingRight: wp(22),
    },
    timeRangeText: {
      fontSize: ms(7),
      color: '#94A3B8',
      fontFamily: MONO,
    },

    // Summary bar
    summaryBar: {
      backgroundColor: c.white,
      borderTopWidth: 1,
      borderTopColor: c.borderLight,
      paddingTop: wp(12),
      paddingHorizontal: wp(12),
    },
    summaryRow: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-around',
    },
    summaryItem: {
      alignItems: 'center',
      flex: 1,
    },
    summaryValue: {
      fontSize: ms(12),
      fontWeight: '800',
      color: c.textPrimary,
      marginTop: wp(3),
      fontFamily: MONO,
    },
    summaryLabel: {
      fontSize: ms(9),
      fontWeight: '600',
      color: c.textMuted,
      marginTop: 1,
      fontFamily: MONO,
    },
    summaryDivider: {
      width: 1,
      height: wp(30),
      backgroundColor: c.borderLight,
    },
  });
