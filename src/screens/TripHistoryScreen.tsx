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
import {ticketsApi} from '../services/api';
import {useFontScaleRefresh} from '../contexts/FontSizeContext';

const MONO = Platform.OS === 'ios' ? 'Menlo' : 'monospace';

MapboxGL.setAccessToken(Config.MAPBOX_ACCESS_TOKEN || '');

type GpsRecord = {
  id: number;
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
  const [matchedCoords, setMatchedCoords] = useState<[number, number][]>([]);
  const mapboxToken = Config.MAPBOX_ACCESS_TOKEN || '';

  const fetchData = async () => {
    if (!ticketId) {
      setError('No ticket ID provided');
      setLoading(false);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const res = await ticketsApi.getGpsRecords(ticketId);
      console.log('[TripHistory] ticketId:', ticketId, 'response:', JSON.stringify(res.data));
      setRecords(res.data.points || res.data.records || []);
    } catch (err: any) {
      setError(err?.message || 'Failed to load GPS records');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchData();
  }, [ticketId]);

  // Snap GPS trail to roads via Mapbox Map Matching + Directions API fallback
  useEffect(() => {
    if (records.length < 2 || !mapboxToken) {
      setMatchedCoords([]);
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

    const matchToRoads = async () => {
      const trail = records.map(r => ({lng: r.longitude, lat: r.latitude}));
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
            // Map Matching failed — use Directions API
            for (let j = (i > 0 ? 1 : 0); j < batch.length - 1; j++) {
              const segment = await getDirectionsRoute(batch[j], batch[j + 1]);
              const sliceFrom = allCoords.length > 0 ? 1 : 0;
              allCoords.push(...segment.slice(sliceFrom));
            }
          }
        } catch {
          // Network error — use Directions API
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

      if (!cancelled && allCoords.length >= 2) {
        setMatchedCoords(allCoords);
      }
    };

    matchToRoads();
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

  // Build GeoJSON line — use road-snapped coords if available, raw GPS as fallback
  const routeGeoJSON = useMemo(() => {
    const coords = matchedCoords.length >= 2
      ? matchedCoords
      : records.length >= 2
        ? records.map(r => [r.longitude, r.latitude] as [number, number])
        : null;
    if (!coords || coords.length < 2) return null;
    return {
      type: 'FeatureCollection' as const,
      features: [
        {
          type: 'Feature' as const,
          properties: {},
          geometry: {
            type: 'LineString' as const,
            coordinates: coords,
          },
        },
      ],
    };
  }, [records, matchedCoords]);

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

  const startPoint = records.length > 0 ? records[0] : null;
  const endPoint = records.length > 0 ? records[records.length - 1] : null;

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
              Trip History{ticketCode ? ` - ${ticketCode}` : ''}
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
              Trip History{ticketCode ? ` - ${ticketCode}` : ''}
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
              Trip History{ticketCode ? ` - ${ticketCode}` : ''}
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
            Trip History{ticketCode ? ` - ${ticketCode}` : ''}
          </Text>
          <Text style={styles.headerSub}>
            {summary.points} GPS points
          </Text>
        </View>
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

          {/* Route line */}
          {routeGeoJSON && (
            <MapboxGL.ShapeSource id="routeSource" shape={routeGeoJSON}>
              <MapboxGL.LineLayer
                id="routeLine"
                style={{
                  lineColor: '#22C55E',
                  lineWidth: 4,
                  lineCap: 'round',
                  lineJoin: 'round',
                }}
              />
            </MapboxGL.ShapeSource>
          )}

          {/* Start marker */}
          {startPoint && (
            <MapboxGL.PointAnnotation
              id="start"
              coordinate={[startPoint.longitude, startPoint.latitude]}
              title="Start">
              <View style={styles.markerStart}>
                <Icon name="play-arrow" size={16} color="#fff" />
              </View>
            </MapboxGL.PointAnnotation>
          )}

          {/* End marker */}
          {endPoint && records.length > 1 && (
            <MapboxGL.PointAnnotation
              id="end"
              coordinate={[endPoint.longitude, endPoint.latitude]}
              title="End">
              <View style={styles.markerEnd}>
                <Icon name="stop" size={16} color="#fff" />
              </View>
            </MapboxGL.PointAnnotation>
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

    // Markers
    markerStart: {
      width: 32,
      height: 32,
      borderRadius: 16,
      justifyContent: 'center',
      alignItems: 'center',
      backgroundColor: '#22C55E',
      elevation: 4,
      shadowColor: '#000',
      shadowOffset: {width: 0, height: 2},
      shadowOpacity: 0.25,
      shadowRadius: 4,
    },
    markerEnd: {
      width: 32,
      height: 32,
      borderRadius: 16,
      justifyContent: 'center',
      alignItems: 'center',
      backgroundColor: '#EF4444',
      elevation: 4,
      shadowColor: '#000',
      shadowOffset: {width: 0, height: 2},
      shadowOpacity: 0.25,
      shadowRadius: 4,
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
