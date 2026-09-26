import React from 'react';
import {Linking, Platform, Pressable, StyleSheet, Text, View} from 'react-native';
import {useSafeAreaInsets} from 'react-native-safe-area-context';
import Icon from './Icon';
import {useBackgroundLocationPermission} from '../hooks/useBackgroundLocationPermission';
import {useNetworkStatus} from '../hooks/useNetworkStatus';
import {ms} from '../utils/responsive';
import {useFontScaleRefresh} from '../contexts/FontSizeContext';

/**
 * Persistent warning while location is "While using the app".
 *
 * A driver in that state loses background GPS completely: on Android 10+ the
 * native fused provider returns nothing once the app is backgrounded, and on iOS
 * the OS stops delivering fixes. Nothing crashes, nothing is logged, and the
 * shift ends with a total gap in the route.
 *
 * This used to be one toast at login, which the driver sees once and never
 * again. It has to stay on screen until it is fixed — and tapping it must land
 * them where they can fix it.
 */
export default function BackgroundPermissionBanner() {
  useFontScaleRefresh();
  const level = useBackgroundLocationPermission();
  const {isOnline} = useNetworkStatus();
  const insets = useSafeAreaInsets();

  // NetworkBanner occupies the same strip and takes priority while offline.
  if (level !== 'foregroundOnly' || !isOnline) return null;

  const message =
    Platform.OS === 'ios'
      ? 'Set Location to "Always" — tap to fix'
      : 'Set Location to "Allow all the time" — tap to fix';

  return (
    <Pressable
      onPress={() => Linking.openSettings().catch(() => {})}
      style={[styles.container, {paddingTop: insets.top + 4}]}>
      <View style={styles.content}>
        <Icon name="location-off" size={16} color="#fff" />
        <View style={styles.textWrap}>
          <Text style={[styles.title, {fontSize: ms(13)}]}>
            Background tracking is off
          </Text>
          <Text style={[styles.sub, {fontSize: ms(11)}]}>{message}</Text>
        </View>
        <Icon name="chevron-right" size={18} color="#fff" />
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  container: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    zIndex: 9998, // Below NetworkBanner (9999)
    paddingBottom: 8,
    backgroundColor: '#E65100',
  },
  content: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    paddingHorizontal: 12,
  },
  textWrap: {flexShrink: 1},
  title: {color: '#fff', fontWeight: '700'},
  sub: {color: '#ffe0b2', fontWeight: '500'},
});
