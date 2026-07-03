import React, {useEffect, useState, useRef} from 'react';
import {Animated, StyleSheet, Text, TouchableOpacity, View} from 'react-native';
import {useSafeAreaInsets} from 'react-native-safe-area-context';
import Icon from './Icon';
import {ToastItem, onToastChange, dismissToast} from '../utils/toast';

const TOAST_COLORS: Record<string, {bg: string; icon: string}> = {
  error: {bg: '#D32F2F', icon: 'error-outline'},
  success: {bg: '#2E7D32', icon: 'check-circle-outline'},
  warning: {bg: '#F57C00', icon: 'warning-amber'},
  info: {bg: '#1565C0', icon: 'info-outline'},
};

function ToastRow({item}: {item: ToastItem}) {
  const opacity = useRef(new Animated.Value(0)).current;
  const translateY = useRef(new Animated.Value(-20)).current;

  useEffect(() => {
    Animated.parallel([
      Animated.timing(opacity, {toValue: 1, duration: 250, useNativeDriver: true}),
      Animated.timing(translateY, {toValue: 0, duration: 250, useNativeDriver: true}),
    ]).start();
  }, [opacity, translateY]);

  const handleDismiss = () => {
    Animated.parallel([
      Animated.timing(opacity, {toValue: 0, duration: 200, useNativeDriver: true}),
      Animated.timing(translateY, {toValue: -20, duration: 200, useNativeDriver: true}),
    ]).start(({finished}) => {
      if (finished) dismissToast(item.id);
    });
  };

  const color = TOAST_COLORS[item.type] || TOAST_COLORS.info;

  return (
    <Animated.View style={[styles.toast, {backgroundColor: color.bg, opacity, transform: [{translateY}]}]}>
      <Icon name={color.icon} size={20} color="#fff" />
      <View style={styles.textWrap}>
        <Text style={styles.title}>{item.title}</Text>
        {item.message ? <Text style={styles.message}>{item.message}</Text> : null}
      </View>
      <TouchableOpacity onPress={handleDismiss} hitSlop={{top: 10, bottom: 10, left: 10, right: 10}}>
        <Icon name="close" size={18} color="rgba(255,255,255,0.7)" />
      </TouchableOpacity>
    </Animated.View>
  );
}

export default function ToastContainer() {
  const [toasts, setToasts] = useState<ToastItem[]>([]);
  const insets = useSafeAreaInsets();

  useEffect(() => onToastChange(setToasts), []);

  if (toasts.length === 0) return null;

  return (
    <View style={[styles.container, {top: insets.top + 50}]} pointerEvents="box-none">
      {toasts.map(t => (
        <ToastRow key={t.id} item={t} />
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    position: 'absolute',
    left: 16,
    right: 16,
    zIndex: 10000,
    alignItems: 'center',
  },
  toast: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 10,
    paddingHorizontal: 14,
    borderRadius: 10,
    marginBottom: 8,
    width: '100%',
    maxWidth: 500,
    shadowColor: '#000',
    shadowOffset: {width: 0, height: 2},
    shadowOpacity: 0.25,
    shadowRadius: 4,
    elevation: 6,
  },
  textWrap: {
    flex: 1,
    marginLeft: 10,
    marginRight: 8,
  },
  title: {
    color: '#fff',
    fontSize: 13,
    fontWeight: '700',
  },
  message: {
    color: 'rgba(255,255,255,0.85)',
    fontSize: 12,
    marginTop: 2,
  },
});
