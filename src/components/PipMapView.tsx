import React, {useEffect, useState} from 'react';
import {View, Text, StyleSheet, Platform} from 'react-native';
import MapboxGL from '@rnmapbox/maps';
import Config from 'react-native-config';
import {backgroundGpsTracker, type GpsPosition} from '../services/backgroundGpsTracker';
import {gpsSyncManager} from '../services/gpsSyncManager';
import {usePipMode} from '../hooks/usePipMode';

MapboxGL.setAccessToken(Config.MAPBOX_ACCESS_TOKEN || '');

const MONO = Platform.OS === 'ios' ? 'Menlo' : 'monospace';

/**
 * The picture-in-picture window's contents.
 *
 * Rendered at the app root and shown ONLY while in PiP, so it covers whichever
 * screen the driver happened to be on when they pressed Home. Auto-enter is
 * allowed from any screen, so it cannot assume MapScreen is mounted.
 *
 * The window is ~200dp wide: no headers, no controls, no touch targets. Just the
 * truck and one line of status, sized to stay legible.
 */
export default function PipMapView() {
  const inPipMode = usePipMode();
  const [position, setPosition] = useState<GpsPosition | null>(
    backgroundGpsTracker.getLastPosition(),
  );

  useEffect(() => {
    // Only subscribe while floating — no cost when the window is closed.
    if (!inPipMode) return;
    setPosition(backgroundGpsTracker.getLastPosition());
    return backgroundGpsTracker.addListener(p => setPosition(p));
  }, [inPipMode]);

  if (!inPipMode) return null;

  const coords: [number, number] | null = position
    ? [position.longitude, position.latitude]
    : null;
  const speedKmh = position ? Math.round((position.speed || 0) * 3.6) : 0;
  const ticketCode = gpsSyncManager.getTicketCode();

  return (
    <View style={styles.root}>
      {coords ? (
        <MapboxGL.MapView
          style={styles.map}
          styleURL="mapbox://styles/mapbox/traffic-day-v2"
          logoEnabled={false}
          attributionEnabled={false}
          scaleBarEnabled={false}
          compassEnabled={false}
          scrollEnabled={false}
          zoomEnabled={false}
          rotateEnabled={false}
          pitchEnabled={false}>
          <MapboxGL.Camera
            centerCoordinate={coords}
            zoomLevel={15}
            animationDuration={600}
          />
          <MapboxGL.PointAnnotation id="pip-truck" coordinate={coords}>
            <View style={styles.dotOuter}>
              <View style={styles.dotInner} />
            </View>
          </MapboxGL.PointAnnotation>
        </MapboxGL.MapView>
      ) : (
        <View style={[styles.map, styles.waiting]}>
          <Text style={styles.waitingText}>Waiting for GPS…</Text>
        </View>
      )}

      <View style={styles.footer}>
        <Text style={styles.footerTitle} numberOfLines={1}>
          {ticketCode ? `Ticket ${ticketCode}` : 'Tracking'}
        </Text>
        <Text style={styles.footerSub} numberOfLines={1}>
          {position ? `${speedKmh} km/h` : 'no fix'}
        </Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: {position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: '#0d1b17'},
  map: {flex: 1},
  waiting: {alignItems: 'center', justifyContent: 'center', backgroundColor: '#12211c'},
  waitingText: {color: '#8d9891', fontSize: 12, fontFamily: MONO},
  dotOuter: {
    width: 20, height: 20, borderRadius: 10,
    backgroundColor: 'rgba(37,99,235,0.28)',
    alignItems: 'center', justifyContent: 'center',
  },
  dotInner: {
    width: 11, height: 11, borderRadius: 6,
    backgroundColor: '#2563eb', borderWidth: 2, borderColor: '#fff',
  },
  footer: {paddingHorizontal: 10, paddingVertical: 7, backgroundColor: '#12564a'},
  footerTitle: {color: '#fff', fontSize: 14, fontWeight: '700'},
  footerSub: {color: '#cfe7e0', fontSize: 11, fontFamily: MONO, marginTop: 1},
});
