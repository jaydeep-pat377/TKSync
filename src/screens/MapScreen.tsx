import React, {useState} from 'react';
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
import MaterialIcons from 'react-native-vector-icons/MaterialIcons';
import type {NativeStackNavigationProp} from '@react-navigation/native-stack';
import type {RouteProp} from '@react-navigation/native';
import {useTheme} from '../contexts/ThemeContext';
import {ms} from '../utils/responsive';

MapboxGL.setAccessToken(Config.MAPBOX_ACCESS_TOKEN || '');

type Props = {
  navigation: NativeStackNavigationProp<any>;
  route: RouteProp<any>;
};

export default function MapScreen({navigation, route}: Props) {
  const params = (route.params || {}) as {
    delivery?: {lat: number; lng: number; radius_m?: number};
    plant?: {lat: number; lng: number};
    truck?: {lat: number; lng: number};
    address?: string;
  };
  const {delivery, plant, truck, address} = params;
  const {c} = useTheme();
  const insets = useSafeAreaInsets();
  const {width, height} = useWindowDimensions();
  const isLandscape = width > height;
  const [isSatellite, setIsSatellite] = useState(false);

  // Center on delivery location, fallback to plant, then truck
  const center = delivery || plant || truck;
  if (!center) {
    return (
      <View style={[styles.container, {backgroundColor: c.background}]}>
        <Text style={{color: c.textPrimary, textAlign: 'center', marginTop: 100}}>No location data</Text>
      </View>
    );
  }

  const openExternalNav = () => {
    if (!delivery) return;
    const {lat, lng} = delivery;
    const url = Platform.select({
      ios: `maps:0,0?daddr=${lat},${lng}`,
      default: `https://www.google.com/maps/dir/?api=1&destination=${lat},${lng}`,
    });
    Linking.openURL(url!);
  };

  return (
    <View style={[styles.container, {backgroundColor: c.background}]}>
      {/* Header */}
      <View style={[
        styles.header,
        {
          backgroundColor: c.primary,
          paddingTop: insets.top + 8,
          paddingLeft: Math.max(16, insets.left + 8),
          paddingRight: Math.max(16, insets.right + 8),
        },
      ]}>
        <TouchableOpacity onPress={() => navigation.goBack()} style={styles.backBtn} activeOpacity={0.7}>
          <MaterialIcons name="arrow-back" size={22} color={c.textOnPrimary} />
        </TouchableOpacity>
        <View style={styles.headerCenter}>
          <Text style={[styles.headerTitle, {color: c.textOnPrimary}]}>
            {address || 'Delivery Location'}
          </Text>
          {delivery && (
            <Text style={[styles.headerSub, {color: c.textOnDark70}]}>
              {delivery.lat.toFixed(6)}, {delivery.lng.toFixed(6)}
            </Text>
          )}
        </View>
        <TouchableOpacity onPress={() => setIsSatellite(s => !s)} style={[styles.navBtn, {backgroundColor: c.overlay15}]} activeOpacity={0.7}>
          <MaterialIcons name={isSatellite ? 'map' : 'satellite'} size={20} color={c.textOnPrimary} />
        </TouchableOpacity>
        {delivery && (
          <TouchableOpacity onPress={openExternalNav} style={[styles.navBtn, {backgroundColor: c.overlay15}]} activeOpacity={0.7}>
            <MaterialIcons name="navigation" size={20} color={c.textOnPrimary} />
          </TouchableOpacity>
        )}
      </View>

      {/* Map */}
      <View style={styles.mapContainer}>
        <MapboxGL.MapView
          style={styles.map}
          styleURL={isSatellite ? MapboxGL.StyleURL.SatelliteStreet : MapboxGL.StyleURL.Street}
          logoEnabled={false}
          attributionEnabled={false}
          scaleBarEnabled={false}>
          <MapboxGL.Camera
            zoomLevel={14}
            centerCoordinate={[center.lng, center.lat]}
            animationMode="flyTo"
            animationDuration={1000}
          />

          {/* Delivery marker */}
          {delivery && (
            <MapboxGL.PointAnnotation
              id="delivery"
              coordinate={[delivery.lng, delivery.lat]}
              title={address || 'Delivery'}>
              <View style={[styles.marker, {backgroundColor: '#EF4444'}]}>
                <MaterialIcons name="place" size={18} color="#fff" />
              </View>
            </MapboxGL.PointAnnotation>
          )}

          {/* Plant marker */}
          {plant && (
            <MapboxGL.PointAnnotation
              id="plant"
              coordinate={[plant.lng, plant.lat]}
              title="Plant">
              <View style={[styles.marker, {backgroundColor: '#3B82F6'}]}>
                <MaterialIcons name="factory" size={18} color="#fff" />
              </View>
            </MapboxGL.PointAnnotation>
          )}

          {/* Truck marker */}
          {truck && (
            <MapboxGL.PointAnnotation
              id="truck"
              coordinate={[truck.lng, truck.lat]}
              title="Truck">
              <View style={[styles.marker, {backgroundColor: '#22C55E'}]}>
                <MaterialIcons name="local-shipping" size={18} color="#fff" />
              </View>
            </MapboxGL.PointAnnotation>
          )}
        </MapboxGL.MapView>

        {/* Legend */}
        <View style={[
          styles.legend,
          {
            backgroundColor: c.white,
            bottom: Math.max(16, insets.bottom + 8),
            right: Math.max(16, insets.right + 8),
          },
        ]}>
          {delivery && (
            <View style={styles.legendItem}>
              <View style={[styles.legendDot, {backgroundColor: '#EF4444'}]} />
              <Text style={[styles.legendText, {color: c.textPrimary}]}>Delivery</Text>
            </View>
          )}
          {plant && (
            <View style={styles.legendItem}>
              <View style={[styles.legendDot, {backgroundColor: '#3B82F6'}]} />
              <Text style={[styles.legendText, {color: c.textPrimary}]}>Plant</Text>
            </View>
          )}
          {truck && (
            <View style={styles.legendItem}>
              <View style={[styles.legendDot, {backgroundColor: '#22C55E'}]} />
              <Text style={[styles.legendText, {color: c.textPrimary}]}>Truck</Text>
            </View>
          )}
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {flex: 1},
  header: {paddingBottom: 12, flexDirection: 'row', alignItems: 'center', gap: 12, elevation: 4, shadowColor: '#000', shadowOffset: {width: 0, height: 2}, shadowOpacity: 0.15, shadowRadius: 4, zIndex: 10},
  backBtn: {width: 36, height: 36, borderRadius: 10, justifyContent: 'center', alignItems: 'center'},
  headerCenter: {flex: 1},
  headerTitle: {fontSize: ms(15), fontWeight: '700'},
  headerSub: {fontSize: ms(11), marginTop: 1},
  navBtn: {width: 36, height: 36, borderRadius: 10, justifyContent: 'center', alignItems: 'center'},
  mapContainer: {flex: 1},
  map: {flex: 1},
  marker: {width: 32, height: 32, borderRadius: 16, justifyContent: 'center', alignItems: 'center', elevation: 4, shadowColor: '#000', shadowOffset: {width: 0, height: 2}, shadowOpacity: 0.25, shadowRadius: 4},
  legend: {position: 'absolute', paddingHorizontal: 12, paddingVertical: 8, borderRadius: 10, elevation: 4, shadowColor: '#000', shadowOffset: {width: 0, height: 2}, shadowOpacity: 0.1, shadowRadius: 4, gap: 6},
  legendItem: {flexDirection: 'row', alignItems: 'center', gap: 6},
  legendDot: {width: 10, height: 10, borderRadius: 5},
  legendText: {fontSize: ms(11), fontWeight: '600'},
});
