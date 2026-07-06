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
  const styles = createStyles();
  const params = (route.params || {}) as {
    delivery?: {lat: number; lng: number};
    address?: string;
  };
  const {delivery, address} = params;
  const {c} = useTheme();
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

  // No coordinates — show address only with Google Maps button
  if (!hasCoords) {
    return (
      <View style={[styles.container, {backgroundColor: c.background}]}>
        <View style={[styles.header, {backgroundColor: c.primary, paddingTop: insets.top + wp(6), paddingLeft: Math.max(wp(12), insets.left + wp(6)), paddingRight: Math.max(wp(12), insets.right + wp(6))}]}>
          <TouchableOpacity onPress={() => navigation.goBack()} style={styles.backBtn} activeOpacity={0.7}>
            <Icon name="arrow-back" size={22} color={c.textOnPrimary} />
          </TouchableOpacity>
          <View style={{flex: 1}}>
            <Text style={[styles.headerTitle, {color: c.textOnPrimary, fontFamily: MONO}]}>Delivered To</Text>
          </View>
        </View>
        <View style={{flex: 1, justifyContent: 'center', alignItems: 'center', paddingHorizontal: 30}}>
          <Icon name="location-off" size={ms(48)} color={c.textMuted} />
          <Text style={{fontSize: ms(16), fontWeight: '700', color: c.textPrimary, marginTop: 16, textAlign: 'center', fontFamily: MONO}}>{address || 'No address'}</Text>
          <Text style={{fontSize: ms(12), color: c.textSecondary, marginTop: 8, textAlign: 'center', fontFamily: MONO}}>No coordinates available for this delivery</Text>
          {address && (
            <TouchableOpacity style={{flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, backgroundColor: c.primary, marginTop: 24, paddingVertical: 14, paddingHorizontal: 28, borderRadius: 8}} onPress={openGoogleMaps} activeOpacity={0.8}>
              <Icon name="directions" size={20} color="#fff" />
              <Text style={{fontSize: 15, fontWeight: '800', color: '#fff', fontFamily: MONO}}>Open in Google Maps</Text>
            </TouchableOpacity>
          )}
          <TouchableOpacity style={{marginTop: 16}} onPress={() => navigation.goBack()} activeOpacity={0.7}>
            <Text style={{fontSize: ms(14), fontWeight: '600', color: c.accent, fontFamily: MONO}}>Go Back</Text>
          </TouchableOpacity>
        </View>
      </View>
    );
  }

  return (
    <View style={[styles.container, {backgroundColor: c.background}]}>
      {/* Header */}
      <View style={[styles.header, {backgroundColor: c.primary, paddingTop: insets.top + wp(6), paddingLeft: Math.max(wp(12), insets.left + wp(6)), paddingRight: Math.max(wp(12), insets.right + wp(6))}]}>
        <TouchableOpacity onPress={() => navigation.goBack()} style={styles.backBtn} activeOpacity={0.7}>
          <Icon name="arrow-back" size={22} color={c.textOnPrimary} />
        </TouchableOpacity>
        <View style={{flex: 1}}>
          <Text style={[styles.headerTitle, {color: c.textOnPrimary, fontFamily: MONO}]} numberOfLines={1}>
            {address || 'Delivery Location'}
          </Text>
          <Text style={[styles.headerSub, {color: c.textOnDark70, fontFamily: MONO}]}>
            {delivery.lat.toFixed(6)}, {delivery.lng.toFixed(6)}
          </Text>
        </View>
        <TouchableOpacity onPress={() => setIsSatellite(s => !s)} style={[styles.headerBtn, {backgroundColor: c.overlay15}]} activeOpacity={0.7}>
          <Icon name={isSatellite ? 'map' : 'satellite'} size={20} color={c.textOnPrimary} />
        </TouchableOpacity>
        <TouchableOpacity onPress={openGoogleMaps} style={[styles.headerBtn, {backgroundColor: c.overlay15}]} activeOpacity={0.7}>
          <Icon name="directions" size={20} color={c.textOnPrimary} />
        </TouchableOpacity>
      </View>

      {/* Map */}
      <View style={{flex: 1}}>
        <MapboxGL.MapView
          style={{flex: 1}}
          styleURL={isSatellite ? MapboxGL.StyleURL.SatelliteStreet : MapboxGL.StyleURL.Street}
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
            <View style={[styles.marker, {backgroundColor: '#EF4444'}]}>
              <Icon name="place" size={20} color="#fff" />
            </View>
          </MapboxGL.PointAnnotation>
        </MapboxGL.MapView>

        {/* Zoom controls */}
        <View style={[styles.zoomControls, {right: 12, bottom: 80}]}>
          <TouchableOpacity
            style={[styles.zoomBtn, {borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: '#ccc'}]}
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
          <TouchableOpacity style={[styles.directionsBtn, {backgroundColor: '#2E7D32'}]} onPress={openGoogleMaps} activeOpacity={0.8}>
            <Icon name="directions" size={20} color="#fff" />
            <Text style={[styles.directionsBtnText, {fontFamily: MONO}]}>DIRECTIONS</Text>
          </TouchableOpacity>
          <TouchableOpacity style={styles.recenterBtn} onPress={recenter} activeOpacity={0.8}>
            <Icon name="my-location" size={20} color="#333" />
          </TouchableOpacity>
        </View>
      </View>
    </View>
  );
}

const createStyles = () => StyleSheet.create({
  container: {flex: 1},
  header: {paddingBottom: wp(10), flexDirection: 'row', alignItems: 'center', gap: wp(10), elevation: 4, shadowColor: '#000', shadowOffset: {width: 0, height: 2}, shadowOpacity: 0.15, shadowRadius: 4, zIndex: 10},
  backBtn: {width: wp(36), height: wp(36), borderRadius: wp(10), justifyContent: 'center', alignItems: 'center'},
  headerTitle: {fontSize: ms(14), fontWeight: '700', color: '#fff'},
  headerSub: {fontSize: ms(10), marginTop: 1},
  headerBtn: {width: wp(36), height: wp(36), borderRadius: wp(10), justifyContent: 'center', alignItems: 'center'},
  marker: {width: 36, height: 36, borderRadius: 18, justifyContent: 'center', alignItems: 'center', elevation: 4, shadowColor: '#000', shadowOffset: {width: 0, height: 2}, shadowOpacity: 0.25, shadowRadius: 4},
  zoomControls: {position: 'absolute', backgroundColor: '#fff', borderRadius: 6, elevation: 4, shadowColor: '#000', shadowOffset: {width: 0, height: 2}, shadowOpacity: 0.2, shadowRadius: 4, borderWidth: 1, borderColor: '#ccc', overflow: 'hidden'},
  zoomBtn: {width: 40, height: 40, justifyContent: 'center', alignItems: 'center'},
  bottomBar: {position: 'absolute', bottom: 0, left: 0, right: 0, flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 16, paddingTop: 12, backgroundColor: 'rgba(255,255,255,0.95)'},
  directionsBtn: {flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, paddingVertical: 14, borderRadius: 8, elevation: 3, shadowColor: '#000', shadowOffset: {width: 0, height: 2}, shadowOpacity: 0.2, shadowRadius: 4},
  directionsBtnText: {fontSize: 15, fontWeight: '800', color: '#fff', letterSpacing: 0.5},
  recenterBtn: {width: 48, height: 48, borderRadius: 8, backgroundColor: '#fff', justifyContent: 'center', alignItems: 'center', elevation: 3, shadowColor: '#000', shadowOffset: {width: 0, height: 2}, shadowOpacity: 0.15, shadowRadius: 4, borderWidth: 1, borderColor: '#ddd'},
});
