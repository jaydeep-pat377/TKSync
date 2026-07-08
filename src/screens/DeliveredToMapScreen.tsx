import React, {useState, useRef} from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  Platform,
  Linking,
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

const MONO = Platform.OS === 'ios' ? 'Menlo' : 'monospace';
import {useFontScaleRefresh} from '../contexts/FontSizeContext';

MapboxGL.setAccessToken(Config.MAPBOX_ACCESS_TOKEN || '');

type Props = {
  navigation: NativeStackNavigationProp<any>;
  route: RouteProp<any>;
};

export default function DeliveredToMapScreen({navigation, route}: Props) {
  useFontScaleRefresh();
  const {c} = useTheme();
  const styles = createStyles(c);
  const params = (route.params || {}) as {
    delivery?: {lat: number; lng: number};
    address?: string;
  };
  const {delivery, address} = params;
  const insets = useSafeAreaInsets();
  const {width, height} = useWindowDimensions();
  const isTablet = Math.min(width, height) > 600;
  const [isSatellite, setIsSatellite] = useState(false);
  const [zoomLevel, setZoomLevel] = useState(15);
  const cameraRef = useRef<MapboxGL.Camera>(null);

  const hasCoords = !!delivery;

  const openGoogleMaps = () => {
    if (hasCoords) {
      const url = Platform.select({
        ios: `maps:0,0?daddr=${delivery!.lat},${delivery!.lng}`,
        default: `https://www.google.com/maps/dir/?api=1&destination=${delivery!.lat},${delivery!.lng}`,
      });
      Linking.openURL(url!);
    } else if (address) {
      const encoded = encodeURIComponent(address);
      const url = Platform.select({
        ios: `maps:0,0?q=${encoded}`,
        default: `https://www.google.com/maps/search/?api=1&query=${encoded}`,
      });
      Linking.openURL(url!);
    }
  };

  const recenter = () => {
    if (!delivery) return;
    cameraRef.current?.setCamera({
      centerCoordinate: [delivery.lng, delivery.lat],
      zoomLevel: 15,
      animationDuration: 800,
    });
  };

  const headerPadding = {
    paddingTop: insets.top + wp(6),
    paddingLeft: Math.max(wp(12), insets.left + wp(6)),
    paddingRight: Math.max(wp(12), insets.right + wp(6)),
  };

  // No coordinates — show address only with Google Maps button
  if (!hasCoords) {
    return (
      <View style={styles.container}>
        <View style={[styles.header, headerPadding]}>
          <TouchableOpacity onPress={() => navigation.goBack()} style={styles.backBtn} activeOpacity={0.7}>
            <Icon name="arrow-back" size={22} color={c.textOnPrimary} />
          </TouchableOpacity>
          <View style={styles.headerTitleWrapper}>
            <Text style={styles.headerTitle}>Delivered To</Text>
          </View>
        </View>
        <View style={styles.noCoordsCenter}>
          <Icon name="location-off" size={ms(48)} color={c.textMuted} />
          <Text style={styles.noCoordsAddress}>{address || 'No address'}</Text>
          <Text style={styles.noCoordsSubtext}>No coordinates available for this delivery</Text>
          {address && (
            <TouchableOpacity style={styles.googleMapsBtn} onPress={openGoogleMaps} activeOpacity={0.8}>
              <Icon name="directions" size={20} color="#fff" />
              <Text style={styles.googleMapsBtnText}>Open in Google Maps</Text>
            </TouchableOpacity>
          )}
          <TouchableOpacity style={styles.goBackBtn} onPress={() => navigation.goBack()} activeOpacity={0.7}>
            <Text style={styles.goBackText}>Go Back</Text>
          </TouchableOpacity>
        </View>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      {/* Header */}
      <View style={[styles.header, headerPadding]}>
        <TouchableOpacity onPress={() => navigation.goBack()} style={styles.backBtn} activeOpacity={0.7}>
          <Icon name="arrow-back" size={22} color={c.textOnPrimary} />
        </TouchableOpacity>
        <View style={styles.headerTitleWrapper}>
          <Text style={styles.headerTitle} numberOfLines={1}>
            {address || 'Delivery Location'}
          </Text>
          <Text style={styles.headerSub}>
            {delivery.lat.toFixed(6)}, {delivery.lng.toFixed(6)}
          </Text>
        </View>
        <TouchableOpacity onPress={() => setIsSatellite(s => !s)} style={styles.headerBtn} activeOpacity={0.7}>
          <Icon name={isSatellite ? 'map' : 'satellite'} size={20} color={c.textOnPrimary} />
        </TouchableOpacity>
        <TouchableOpacity onPress={openGoogleMaps} style={styles.headerBtn} activeOpacity={0.7}>
          <Icon name="directions" size={20} color={c.textOnPrimary} />
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
            zoomLevel={15}
            centerCoordinate={[delivery.lng, delivery.lat]}
            animationMode="flyTo"
            animationDuration={1000}
          />
          <MapboxGL.PointAnnotation id="delivery" coordinate={[delivery.lng, delivery.lat]} title={address || 'Delivery'}>
            <View style={styles.marker}>
              <Icon name="place" size={20} color="#fff" />
            </View>
          </MapboxGL.PointAnnotation>
        </MapboxGL.MapView>

        {/* Traffic legend */}
        {!isSatellite && (
          <View style={styles.trafficLegend}>
            <Text style={styles.legendTitle}>Traffic</Text>
            <View style={styles.legendRow}><View style={[styles.legendLine, styles.legendGreen]} /><Text style={styles.legendLabel}>Low</Text></View>
            <View style={styles.legendRow}><View style={[styles.legendLine, styles.legendYellow]} /><Text style={styles.legendLabel}>Moderate</Text></View>
            <View style={styles.legendRow}><View style={[styles.legendLine, styles.legendOrange]} /><Text style={styles.legendLabel}>Heavy</Text></View>
            <View style={styles.legendRow}><View style={[styles.legendLine, styles.legendRed]} /><Text style={styles.legendLabel}>Severe</Text></View>
          </View>
        )}

        {/* Zoom controls */}
        <View style={styles.zoomControls}>
          <TouchableOpacity
            style={styles.zoomBtnTop}
            onPress={() => { const z = Math.min(20, zoomLevel + 1); setZoomLevel(z); cameraRef.current?.setCamera({zoomLevel: z, animationDuration: 300}); }}
            activeOpacity={0.7}>
            <Icon name="add" size={22} color="#333" />
          </TouchableOpacity>
          <TouchableOpacity
            style={styles.zoomBtn}
            onPress={() => { const z = Math.max(1, zoomLevel - 1); setZoomLevel(z); cameraRef.current?.setCamera({zoomLevel: z, animationDuration: 300}); }}
            activeOpacity={0.7}>
            <Icon name="remove" size={22} color="#333" />
          </TouchableOpacity>
        </View>

        {/* Bottom bar: Directions + Recenter */}
        <View style={[styles.bottomBar, {paddingBottom: Math.max(insets.bottom, 12)}]}>
          <TouchableOpacity style={styles.directionsBtn} onPress={openGoogleMaps} activeOpacity={0.8}>
            <Icon name="directions" size={20} color="#fff" />
            <Text style={styles.directionsBtnText}>DIRECTIONS</Text>
          </TouchableOpacity>
          <TouchableOpacity style={styles.recenterBtn} onPress={recenter} activeOpacity={0.8}>
            <Icon name="my-location" size={20} color="#333" />
          </TouchableOpacity>
        </View>
      </View>
    </View>
  );
}

const createStyles = (c: any) => StyleSheet.create({
  container: {flex: 1, backgroundColor: c.background},
  header: {paddingBottom: wp(10), flexDirection: 'row', alignItems: 'center', gap: wp(10), backgroundColor: c.primary, elevation: 4, shadowColor: '#000', shadowOffset: {width: 0, height: 2}, shadowOpacity: 0.15, shadowRadius: 4, zIndex: 10},
  backBtn: {width: wp(36), height: wp(36), borderRadius: wp(10), justifyContent: 'center', alignItems: 'center'},
  headerTitleWrapper: {flex: 1},
  headerTitle: {fontSize: ms(14), fontWeight: '700', color: c.textOnPrimary, fontFamily: MONO},
  headerSub: {fontSize: ms(10), marginTop: 1, color: c.textOnDark70, fontFamily: MONO},
  headerBtn: {width: wp(36), height: wp(36), borderRadius: wp(10), justifyContent: 'center', alignItems: 'center', backgroundColor: c.overlay15},
  // No-coords branch
  noCoordsCenter: {flex: 1, justifyContent: 'center', alignItems: 'center', paddingHorizontal: 30},
  noCoordsAddress: {fontSize: ms(16), fontWeight: '700', color: c.textPrimary, marginTop: 16, textAlign: 'center', fontFamily: MONO},
  noCoordsSubtext: {fontSize: ms(12), color: c.textSecondary, marginTop: 8, textAlign: 'center', fontFamily: MONO},
  googleMapsBtn: {flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, backgroundColor: c.primary, marginTop: 24, paddingVertical: 14, paddingHorizontal: 28, borderRadius: 8},
  googleMapsBtnText: {fontSize: 15, fontWeight: '800', color: '#fff', fontFamily: MONO},
  goBackBtn: {marginTop: 16},
  goBackText: {fontSize: ms(14), fontWeight: '600', color: c.accent, fontFamily: MONO},
  // Map branch
  mapWrapper: {flex: 1},
  map: {flex: 1},
  marker: {width: 36, height: 36, borderRadius: 18, justifyContent: 'center', alignItems: 'center', backgroundColor: '#EF4444', elevation: 4, shadowColor: '#000', shadowOffset: {width: 0, height: 2}, shadowOpacity: 0.25, shadowRadius: 4},
  zoomControls: {position: 'absolute', right: 12, bottom: 120, backgroundColor: '#fff', borderRadius: 6, elevation: 4, shadowColor: '#000', shadowOffset: {width: 0, height: 2}, shadowOpacity: 0.2, shadowRadius: 4, borderWidth: 1, borderColor: '#ccc', overflow: 'hidden'},
  zoomBtnTop: {width: 40, height: 40, justifyContent: 'center', alignItems: 'center', borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: '#ccc'},
  zoomBtn: {width: 40, height: 40, justifyContent: 'center', alignItems: 'center'},
  bottomBar: {position: 'absolute', bottom: 0, left: 0, right: 0, flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 16, paddingTop: 12, backgroundColor: 'rgba(255,255,255,0.95)'},
  directionsBtn: {flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, paddingVertical: 14, borderRadius: 8, backgroundColor: '#2E7D32', elevation: 3, shadowColor: '#000', shadowOffset: {width: 0, height: 2}, shadowOpacity: 0.2, shadowRadius: 4},
  directionsBtnText: {fontSize: 15, fontWeight: '800', color: '#fff', letterSpacing: 0.5},
  recenterBtn: {width: 48, height: 48, borderRadius: 8, backgroundColor: '#fff', justifyContent: 'center', alignItems: 'center', elevation: 3, shadowColor: '#000', shadowOffset: {width: 0, height: 2}, shadowOpacity: 0.15, shadowRadius: 4, borderWidth: 1, borderColor: '#ddd'},
  trafficLegend: {position: 'absolute', top: 12, left: 12, backgroundColor: 'rgba(255,255,255,0.92)', borderRadius: 8, padding: 10, paddingHorizontal: 12, elevation: 4, shadowColor: '#000', shadowOffset: {width: 0, height: 2}, shadowOpacity: 0.15, shadowRadius: 4, gap: 5},
  legendTitle: {fontSize: 14, fontWeight: '800', color: '#333', marginBottom: 2},
  legendRow: {flexDirection: 'row', alignItems: 'center', gap: 6},
  legendLine: {width: 20, height: 5, borderRadius: 2},
  legendGreen: {backgroundColor: '#4CAF50'},
  legendYellow: {backgroundColor: '#FFEB3B'},
  legendOrange: {backgroundColor: '#FF9800'},
  legendRed: {backgroundColor: '#F44336'},
  legendLabel: {fontSize: 13, fontWeight: '600', color: '#555'},
});
