import React, {useState, useEffect, useRef, useMemo} from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ActivityIndicator,
  Platform,
  useWindowDimensions,
} from 'react-native';
import {useSafeAreaInsets} from 'react-native-safe-area-context';
import MapboxGL from '@rnmapbox/maps';
import Config from 'react-native-config';
import Icon from '../components/Icon';
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

  const fetchData = async () => {
    setLoading(true);
    setError(null);

    // Use UTC date — same as web dispatch monitoring (new Date().toISOString().split("T")[0])
    const today = new Date().toISOString().split('T')[0];

    // Primary: full day GPS by truck_code (same data source as web dispatch monitoring)
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

    // Fallback: ticket-specific GPS (fewer records — only those tagged with this ticket)
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

  // Auto-refresh every 30s — only re-fetch if DB has new records
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

  // Keep lastPointCount in sync when records change from manual fetch/refresh
  useEffect(() => {
    lastPointCount.current = records.length;
  }, [records.length]);

  // Snap GPS trail to roads via Mapbox Map Matching + Directions API fallback.
  // Splits trail into segments at 5-minute gaps (same as web dispatch monitoring)
  // so disconnected trips don't get joined by a straight line.
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
      // Split trail into segments at 5-minute gaps (same as web)
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

      // Snap each segment to roads separately
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

  // Compute trip summary
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

  // Build GeoJSON — MultiLineString with gap-split segments (same as web)
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

  // Compute bounds for camera
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

  // Use matched route endpoints for markers (same as web) — falls back to raw GPS
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

  const toKmh = (mps: number) => Math.round(mps * 3.6);

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

          {/* Route line — outline + fill (same as web dispatch monitoring) */}
          {routeGeoJSON && (
            <MapboxGL.ShapeSource id="routeSource" shape={routeGeoJSON}>
              <MapboxGL.LineLayer
                id="routeLineOutline"
                style={{
                  lineColor: '#1E40AF',
                  lineWidth: 7,
                  lineOpacity: 0.2,
                  lineCap: 'round',
                  lineJoin: 'round',
                }}
              />
              <MapboxGL.LineLayer
                id="routeLine"
                style={{
                  lineColor: '#2563EB',
                  lineWidth: 4,
                  lineOpacity: 0.85,
                  lineCap: 'round',
                  lineJoin: 'round',
                }}
              />
            </MapboxGL.ShapeSource>
          )}

          {/* Route direction arrows — custom chevron icon same as web dispatch monitoring */}
          {routeGeoJSON && (
            <MapboxGL.Images images={{routeArrow: require('../../assets/route-arrow.png')}} />
          )}
          {routeGeoJSON && (
            <MapboxGL.ShapeSource id="arrowSource" shape={routeGeoJSON}>
              <MapboxGL.SymbolLayer
                id="routeArrows"
                style={{
                  iconImage: 'routeArrow',
                  symbolPlacement: 'line',
                  symbolSpacing: 80,
                  iconSize: 0.5,
                  iconRotate: 90,
                  iconAllowOverlap: true,
                  iconRotationAlignment: 'map',
                }}
              />
            </MapboxGL.ShapeSource>
          )}

          {/* Start marker — green badge + dot (same as web) */}
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

          {/* End marker — red badge + dot (same as web) */}
          {endPoint && records.length > 1 && (
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
        </MapboxGL.MapView>

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

    // Markers — matches web START/END badges
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
