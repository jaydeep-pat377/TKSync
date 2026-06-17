import React, {useEffect, useRef, useState} from 'react';
import {Animated, StyleSheet, Text, View} from 'react-native';
import {useSafeAreaInsets} from 'react-native-safe-area-context';
import MaterialIcons from 'react-native-vector-icons/MaterialIcons';
import {useNetworkStatus} from '../hooks/useNetworkStatus';

const RESTORED_DISPLAY_MS = 4000;

export default function NetworkBanner() {
  const {isOnline} = useNetworkStatus();
  const insets = useSafeAreaInsets();
  const [showRestored, setShowRestored] = useState(false);
  const wasOffline = useRef(false);
  const slideAnim = useRef(new Animated.Value(-100)).current;
  const restoredTimer = useRef<ReturnType<typeof setTimeout>>();

  const visible = !isOnline || showRestored;

  useEffect(() => {
    if (!isOnline) {
      // Connection lost
      wasOffline.current = true;
      setShowRestored(false);
      if (restoredTimer.current) clearTimeout(restoredTimer.current);
    } else if (wasOffline.current) {
      // Connection restored after being offline
      wasOffline.current = false;
      setShowRestored(true);
      restoredTimer.current = setTimeout(() => setShowRestored(false), RESTORED_DISPLAY_MS);
    }
    return () => {
      if (restoredTimer.current) clearTimeout(restoredTimer.current);
    };
  }, [isOnline]);

  useEffect(() => {
    Animated.timing(slideAnim, {
      toValue: visible ? 0 : -100,
      duration: 300,
      useNativeDriver: true,
    }).start();
  }, [visible, slideAnim]);

  if (!visible && slideAnim._value !== 0) return null;

  const isOfflineBanner = !isOnline;
  const bg = isOfflineBanner ? '#D32F2F' : '#2E7D32';
  const icon = isOfflineBanner ? 'wifi-off' : 'wifi';
  const message = isOfflineBanner
    ? 'No Internet Connection'
    : 'Connection Restored';

  return (
    <Animated.View
      style={[
        styles.container,
        {
          paddingTop: insets.top + 4,
          backgroundColor: bg,
          transform: [{translateY: slideAnim}],
        },
      ]}
      pointerEvents="none">
      <View style={styles.content}>
        <MaterialIcons name={icon} size={16} color="#fff" />
        <Text style={styles.text}>{message}</Text>
      </View>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  container: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    zIndex: 9999,
    paddingBottom: 8,
  },
  content: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
  },
  text: {
    color: '#fff',
    fontSize: 13,
    fontWeight: '600',
  },
});
