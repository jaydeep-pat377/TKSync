import React, {useState, useRef} from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  Platform,
  Linking,
  ScrollView,
  useWindowDimensions,
  ActivityIndicator,
} from 'react-native';
import {useSafeAreaInsets} from 'react-native-safe-area-context';
import MapboxGL from '@rnmapbox/maps';
import Config from 'react-native-config';
import MaterialIcons from 'react-native-vector-icons/MaterialIcons';
import type {NativeStackNavigationProp} from '@react-navigation/native-stack';
import type {RouteProp} from '@react-navigation/native';
import {useTheme} from '../contexts/ThemeContext';
import {ms, wp} from '../utils/responsive';

MapboxGL.setAccessToken(Config.MAPBOX_ACCESS_TOKEN || '');

type MapItem = {
  type: string;
  address?: string;
  value?: string;
  mapPage?: string;
  latitude: number | null;
  longitude: number | null;
  status: string;
  is_current: boolean;
  directions: boolean;
};

type Props = {
  navigation: NativeStackNavigationProp<any>;
  route: RouteProp<any>;
};

const TYPE_COLORS: Record<string, {icon: string; bg: string; marker: string}> = {
  'Job Site': {icon: '#EF4444', bg: '#FEE2E2', marker: '#EF4444'},
  'My Truck': {icon: '#7B1FA2', bg: '#F3E5F5', marker: '#7B1FA2'},
  'Truck Ahead': {icon: '#F57C00', bg: '#FFF3E0', marker: '#F57C00'},
  'Truck Behind': {icon: '#1976D2', bg: '#DBEAFE', marker: '#1976D2'},
  'Plant': {icon: '#00897B', bg: '#E0F2F1', marker: '#00897B'},
};
const DEFAULT_COLOR = {icon: '#616161', bg: '#F5F5F5', marker: '#616161'};

export default function MapScreen({navigation, route}: Props) {
  const params = (route.params || {}) as {
    mapItems?: MapItem[];
    delivery?: {lat: number; lng: number};
    plant?: {lat: number; lng: number};
    truck?: {lat: number; lng: number};
    address?: string;
    plantName?: string;
  };
  const {mapItems, delivery, plant, truck, address, plantName} = params;
  const {c} = useTheme();
  const insets = useSafeAreaInsets();
  const {width, height} = useWindowDimensions();
  const isLandscape = width > height;
  const isTablet = Math.min(width, height) > 600;
  const [isSatellite, setIsSatellite] = useState(false);
  const [zoomLevel, setZoomLevel] = useState(14);
  const [mapLoaded, setMapLoaded] = useState(false);
  const cameraRef = useRef<MapboxGL.Camera>(null);

  const hasMapItems = mapItems && mapItems.length > 0;

  // Collect all valid coordinates for bounds
  const allCoords: {lat: number; lng: number}[] = [];
  if (hasMapItems) {
    mapItems.forEach(m => { if (m.latitude != null && m.longitude != null) allCoords.push({lat: m.latitude, lng: m.longitude}); });
  }
  if (!allCoords.length) {
    if (delivery) allCoords.push(delivery);
    if (plant) allCoords.push(plant);
    if (truck) allCoords.push(truck);
  }

  const center = allCoords.length > 0 ? allCoords[0] : null;
  const bounds = allCoords.length > 1 ? {
    ne: [Math.max(...allCoords.map(c => c.lng)), Math.max(...allCoords.map(c => c.lat))] as [number, number],
    sw: [Math.min(...allCoords.map(c => c.lng)), Math.min(...allCoords.map(c => c.lat))] as [number, number],
    paddingTop: 80, paddingBottom: hasMapItems && !isLandscape ? 200 : 80, paddingLeft: 80, paddingRight: 80,
  } : null;

  if (!center) {
    return (
      <View style={[styles.container, {backgroundColor: c.background}]}>
        <Text style={{color: c.textPrimary, textAlign: 'center', marginTop: 100}}>No location data</Text>
      </View>
    );
  }

  const openDirections = (lat: number, lng: number) => {
    const url = Platform.select({
      ios: `maps:0,0?daddr=${lat},${lng}`,
      default: `https://www.google.com/maps/dir/?api=1&destination=${lat},${lng}`,
    });
    Linking.openURL(url!);
  };

  const flyTo = (lat: number, lng: number) => {
    cameraRef.current?.setCamera({
      centerCoordinate: [lng, lat],
      zoomLevel: 16,
      animationDuration: 800,
    });
  };

  const recenter = () => {
    if (bounds) {
      cameraRef.current?.fitBounds(bounds.ne, bounds.sw, [bounds.paddingTop, bounds.paddingRight, bounds.paddingBottom, bounds.paddingLeft], 800);
    } else {
      cameraRef.current?.setCamera({
        centerCoordinate: [center!.lng, center!.lat],
        zoomLevel: 14,
        animationDuration: 800,
      });
    }
  };

  // Responsive sizes
  const titleSize = isTablet ? 18 : isLandscape ? 15 : 16;
  const valueSize = isTablet ? 15 : isLandscape ? 13 : 14;
  const dirSize = isTablet ? 15 : isLandscape ? 13 : 14;
  const iconSize = isTablet ? 24 : isLandscape ? 20 : 22;
  const iconBox = isTablet ? 44 : isLandscape ? 36 : 40;
  const itemPad = isTablet ? 16 : isLandscape ? 8 : 12;
  const indentLeft = iconBox + (isTablet ? 14 : 12);

  // Build panel from mapItems
  const panelContent = hasMapItems ? (
    <ScrollView
      style={{flex: 1}}
      contentContainerStyle={{
        paddingVertical: isLandscape ? 14 : insets.top + 10,
        paddingHorizontal: isTablet ? 24 : isLandscape ? 16 : 20,
      }}
      bounces={false}
      showsVerticalScrollIndicator={false}>
      {mapItems.map((item, idx) => {
        const colors = TYPE_COLORS[item.type] || DEFAULT_COLOR;
        const displayValue = item.type === 'Job Site'
          ? [item.address, item.mapPage ? `MapPage: ${item.mapPage}` : ''].filter(Boolean).join('\n')
          : item.value || item.status;
        const hasCoords = item.latitude != null && item.longitude != null;
        return (
          <TouchableOpacity
            key={`${item.type}-${idx}`}
            style={[styles.panelItem, {paddingVertical: itemPad, borderBottomColor: idx < mapItems.length - 1 ? c.borderLight : 'transparent'}]}
            activeOpacity={hasCoords ? 0.6 : 1}
            disabled={!hasCoords}
            onPress={() => hasCoords && flyTo(item.latitude!, item.longitude!)}>
            <View style={[styles.panelIconRow, {gap: isTablet ? 14 : 12}]}>
              <View style={[styles.panelIcon, {width: iconBox, height: iconBox, borderRadius: iconBox / 2, backgroundColor: colors.bg}]}>
                <MaterialIcons name={item.type === 'Plant' ? 'factory' : item.type === 'Job Site' ? 'place' : 'local-shipping'} size={iconSize} color={colors.icon} />
              </View>
              <Text style={[styles.panelTitle, {fontSize: titleSize, color: c.textPrimary}]}>{item.type}</Text>
            </View>
            <Text style={[styles.panelValue, {fontSize: valueSize, marginLeft: indentLeft, color: c.textPrimary}]}>{displayValue}</Text>
            {hasCoords && item.directions && (
              <TouchableOpacity onPress={() => openDirections(item.latitude!, item.longitude!)} activeOpacity={0.7}>
                <Text style={[styles.panelDirections, {fontSize: dirSize, marginLeft: indentLeft}]}>DIRECTIONS</Text>
              </TouchableOpacity>
            )}
          </TouchableOpacity>
        );
      })}
    </ScrollView>
  ) : null;

  const mapView = (
    <View style={styles.mapContainer}>
      {!mapLoaded && (
        <View style={styles.loader}>
          <ActivityIndicator size="large" color={c.primary} />
        </View>
      )}
      <MapboxGL.MapView
        style={styles.map}
        styleURL={isSatellite ? MapboxGL.StyleURL.SatelliteStreet : MapboxGL.StyleURL.Street}
        logoEnabled={false}
        attributionEnabled={false}
        scaleBarEnabled={false}
        onDidFinishLoadingMap={() => setMapLoaded(true)}>
        <MapboxGL.Camera
          ref={cameraRef}
          {...(bounds
            ? {bounds: {ne: bounds.ne, sw: bounds.sw, paddingTop: bounds.paddingTop, paddingBottom: bounds.paddingBottom, paddingLeft: bounds.paddingLeft, paddingRight: bounds.paddingRight}}
            : {zoomLevel: 14, centerCoordinate: [center!.lng, center!.lat]}
          )}
          animationMode="flyTo"
          animationDuration={1000}
        />

        {/* Markers from mapItems */}
        {hasMapItems && mapItems.map((item, idx) => {
          if (item.latitude == null || item.longitude == null) return null;
          const colors = TYPE_COLORS[item.type] || DEFAULT_COLOR;
          const iconName = item.type === 'Plant' ? 'factory' : item.type === 'Job Site' ? 'place' : 'local-shipping';
          return (
            <MapboxGL.PointAnnotation
              key={`marker-${item.type}-${idx}`}
              id={`marker-${item.type}-${idx}`}
              coordinate={[item.longitude, item.latitude]}
              title={item.type}>
              <View style={[styles.marker, {backgroundColor: colors.marker}]}>
                <MaterialIcons name={iconName} size={18} color="#fff" />
              </View>
            </MapboxGL.PointAnnotation>
          );
        })}

        {/* Fallback markers if no mapItems */}
        {!hasMapItems && delivery && (
          <MapboxGL.PointAnnotation id="delivery" coordinate={[delivery.lng, delivery.lat]} title={address || 'Delivery'}>
            <View style={[styles.marker, {backgroundColor: '#EF4444'}]}>
              <MaterialIcons name="place" size={18} color="#fff" />
            </View>
          </MapboxGL.PointAnnotation>
        )}
        {!hasMapItems && plant && (
          <MapboxGL.PointAnnotation id="plant" coordinate={[plant.lng, plant.lat]} title="Plant">
            <View style={[styles.marker, {backgroundColor: '#00897B'}]}>
              <MaterialIcons name="factory" size={18} color="#fff" />
            </View>
          </MapboxGL.PointAnnotation>
        )}
        {!hasMapItems && truck && (
          <MapboxGL.PointAnnotation id="truck" coordinate={[truck.lng, truck.lat]} title="Truck">
            <View style={[styles.marker, {backgroundColor: '#1976D2'}]}>
              <MaterialIcons name="local-shipping" size={18} color="#fff" />
            </View>
          </MapboxGL.PointAnnotation>
        )}
      </MapboxGL.MapView>

      {/* Satellite toggle */}
      <TouchableOpacity
        style={[styles.mapBtn, {top: 12, right: 56}]}
        onPress={() => setIsSatellite(s => !s)}
        activeOpacity={0.7}>
        <MaterialIcons name={isSatellite ? 'map' : 'satellite'} size={20} color="#333" />
      </TouchableOpacity>

      {/* Close button */}
      <TouchableOpacity
        style={[styles.mapBtn, {top: 12, right: 12}]}
        onPress={() => navigation.goBack()}
        activeOpacity={0.7}>
        <Text style={styles.closeBtnText}>X</Text>
      </TouchableOpacity>

      {/* Zoom controls */}
      <View style={[styles.zoomControls, {right: 12, bottom: hasMapItems && !isLandscape ? height * 0.44 + 70 : 70}]}>
        <TouchableOpacity
          style={[styles.zoomBtn, {borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: '#ccc'}]}
          onPress={() => { const z = Math.min(20, zoomLevel + 1); setZoomLevel(z); cameraRef.current?.setCamera({zoomLevel: z, animationDuration: 300}); }}
          activeOpacity={0.7}>
          <MaterialIcons name="add" size={22} color="#333" />
        </TouchableOpacity>
        <TouchableOpacity
          style={styles.zoomBtn}
          onPress={() => { const z = Math.max(1, zoomLevel - 1); setZoomLevel(z); cameraRef.current?.setCamera({zoomLevel: z, animationDuration: 300}); }}
          activeOpacity={0.7}>
          <MaterialIcons name="remove" size={22} color="#333" />
        </TouchableOpacity>
      </View>

      {/* Recenter button */}
      <TouchableOpacity
        style={[styles.recenterBtn, {bottom: hasMapItems && !isLandscape ? height * 0.44 + 20 : Math.max(16, insets.bottom + 8)}]}
        onPress={recenter}
        activeOpacity={0.8}>
        <Text style={styles.recenterText}>RECENTER</Text>
      </TouchableOpacity>
    </View>
  );

  // Has map items: show panel + map
  if (hasMapItems) {
    if (isLandscape) {
      return (
        <View style={[styles.container, {backgroundColor: c.background, flexDirection: 'row'}]}>
          <View style={[styles.sidePanel, {backgroundColor: c.white, paddingTop: insets.top, borderRightColor: c.borderLight, width: isTablet ? 300 : 260}]}>
            {panelContent}
          </View>
          {mapView}
        </View>
      );
    }
    return (
      <View style={[styles.container, {backgroundColor: c.background}]}>
        {mapView}
        <View style={[styles.bottomPanel, {backgroundColor: c.white, paddingBottom: Math.max(insets.bottom, 12), maxHeight: isTablet ? '45%' : '42%'}]}>
          <View style={styles.bottomPanelHandle}>
            <View style={[styles.handleBar, {backgroundColor: c.border}]} />
          </View>
          {panelContent}
        </View>
      </View>
    );
  }

  // No map items: header + map (original layout)
  return (
    <View style={[styles.container, {backgroundColor: c.background}]}>
      <View style={[
        styles.header,
        {
          backgroundColor: c.primary,
          paddingTop: insets.top + wp(6),
          paddingLeft: Math.max(wp(12), insets.left + wp(6)),
          paddingRight: Math.max(wp(12), insets.right + wp(6)),
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
          <TouchableOpacity onPress={() => openDirections(delivery.lat, delivery.lng)} style={[styles.navBtn, {backgroundColor: c.overlay15}]} activeOpacity={0.7}>
            <MaterialIcons name="navigation" size={20} color={c.textOnPrimary} />
          </TouchableOpacity>
        )}
      </View>
      {mapView}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {flex: 1},
  header: {paddingBottom: wp(10), flexDirection: 'row', alignItems: 'center', gap: wp(10), elevation: 4, shadowColor: '#000', shadowOffset: {width: 0, height: 2}, shadowOpacity: 0.15, shadowRadius: 4, zIndex: 10},
  backBtn: {width: wp(36), height: wp(36), borderRadius: wp(10), justifyContent: 'center', alignItems: 'center'},
  headerCenter: {flex: 1},
  headerTitle: {fontSize: ms(14), fontWeight: '700'},
  headerSub: {fontSize: ms(10), marginTop: 1},
  navBtn: {width: wp(36), height: wp(36), borderRadius: wp(10), justifyContent: 'center', alignItems: 'center'},
  mapContainer: {flex: 1},
  loader: {position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, justifyContent: 'center', alignItems: 'center', zIndex: 10},
  map: {flex: 1},
  marker: {width: 32, height: 32, borderRadius: 16, justifyContent: 'center', alignItems: 'center', elevation: 4, shadowColor: '#000', shadowOffset: {width: 0, height: 2}, shadowOpacity: 0.25, shadowRadius: 4},

  // Side panel (landscape)
  sidePanel: {borderRightWidth: StyleSheet.hairlineWidth},
  // Bottom panel (portrait)
  bottomPanel: {position: 'absolute', bottom: 0, left: 0, right: 0, borderTopLeftRadius: 18, borderTopRightRadius: 18, elevation: 12, shadowColor: '#000', shadowOffset: {width: 0, height: -4}, shadowOpacity: 0.15, shadowRadius: 12},
  bottomPanelHandle: {alignItems: 'center', paddingTop: 10, paddingBottom: 4},
  handleBar: {width: 40, height: 4, borderRadius: 2},

  // Panel items
  panelItem: {borderBottomWidth: StyleSheet.hairlineWidth},
  panelIconRow: {flexDirection: 'row', alignItems: 'center', marginBottom: 4},
  panelIcon: {justifyContent: 'center', alignItems: 'center'},
  panelTitle: {fontWeight: '800'},
  panelValue: {fontWeight: '500', lineHeight: 21, marginBottom: 6},
  panelDirections: {fontWeight: '700', color: '#1976D2', textDecorationLine: 'underline'},

  // Map overlay buttons
  mapBtn: {position: 'absolute', width: 40, height: 40, borderRadius: 6, backgroundColor: '#fff', justifyContent: 'center', alignItems: 'center', elevation: 4, shadowColor: '#000', shadowOffset: {width: 0, height: 2}, shadowOpacity: 0.2, shadowRadius: 4, borderWidth: 1, borderColor: '#ccc'},
  closeBtnText: {fontSize: 18, fontWeight: '900', color: '#333'},

  // Zoom controls
  zoomControls: {position: 'absolute', backgroundColor: '#fff', borderRadius: 6, elevation: 4, shadowColor: '#000', shadowOffset: {width: 0, height: 2}, shadowOpacity: 0.2, shadowRadius: 4, borderWidth: 1, borderColor: '#ccc', overflow: 'hidden'},
  zoomBtn: {width: 40, height: 40, justifyContent: 'center', alignItems: 'center'},

  // Recenter button
  recenterBtn: {position: 'absolute', alignSelf: 'center', backgroundColor: '#2E7D32', paddingVertical: 12, paddingHorizontal: 40, borderRadius: 4, elevation: 4, shadowColor: '#000', shadowOffset: {width: 0, height: 2}, shadowOpacity: 0.2, shadowRadius: 4},
  recenterText: {fontSize: 15, fontWeight: '800', color: '#fff', letterSpacing: 1},
});
