import React, {useRef, useEffect, useState} from 'react';
import {
  Modal,
  View,
  Animated,
  StyleSheet,
  useWindowDimensions,
  KeyboardAvoidingView,
  Platform,
  StatusBar,
  Keyboard,
} from 'react-native';
import {useSafeAreaInsets} from 'react-native-safe-area-context';
import {useTheme} from '../contexts/ThemeContext';

type Props = {
  visible: boolean;
  onClose: () => void;
  children: React.ReactNode;
  maxWidth?: number;
  widthPercent?: number;
  maxHeightPercent?: number;
  animationType?: 'scale' | 'slide';
  avoidKeyboard?: boolean;
};

export default function ResponsiveModal({
  visible,
  onClose,
  children,
  maxWidth = 500,
  widthPercent = 92,
  maxHeightPercent = 85,
  animationType = 'scale',
  avoidKeyboard = false,
}: Props) {
  const {c} = useTheme();
  const {width, height} = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const isLandscape = width > height;

  const fade = useRef(new Animated.Value(0)).current;
  const scale = useRef(new Animated.Value(0.9)).current;
  const slide = useRef(new Animated.Value(30)).current;
  const keyboardOffset = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    if (visible) {
      if (animationType === 'scale') {
        scale.setValue(0.9);
        fade.setValue(0);
        Animated.parallel([
          Animated.spring(scale, {toValue: 1, friction: 8, tension: 80, useNativeDriver: true}),
          Animated.timing(fade, {toValue: 1, duration: 200, useNativeDriver: true}),
        ]).start();
      } else {
        slide.setValue(30);
        fade.setValue(0);
        Animated.parallel([
          Animated.timing(fade, {toValue: 1, duration: 220, useNativeDriver: true}),
          Animated.spring(slide, {toValue: 0, friction: 8, tension: 60, useNativeDriver: true}),
        ]).start();
      }
    } else {
      fade.setValue(0);
      scale.setValue(0.9);
      slide.setValue(30);
      keyboardOffset.setValue(0);
    }
  }, [visible, fade, scale, slide, animationType, keyboardOffset]);

  // Track keyboard on Android to shift modal up
  useEffect(() => {
    if (!avoidKeyboard || Platform.OS !== 'android') return;
    const showSub = Keyboard.addListener('keyboardDidShow', (e) => {
      Animated.timing(keyboardOffset, {
        toValue: -(e.endCoordinates.height / 2),
        duration: 200,
        useNativeDriver: true,
      }).start();
    });
    const hideSub = Keyboard.addListener('keyboardDidHide', () => {
      Animated.timing(keyboardOffset, {
        toValue: 0,
        duration: 200,
        useNativeDriver: true,
      }).start();
    });
    return () => {
      showSub.remove();
      hideSub.remove();
    };
  }, [avoidKeyboard, keyboardOffset]);

  // Compute dimensions from live values (not static wp())
  const statusBarH = StatusBar.currentHeight || 0;
  const safeV = insets.top + insets.bottom + statusBarH;
  const safeH = insets.left + insets.right;
  const availH = height - safeV;
  const availW = width - safeH;
  const isPhone = Math.min(width, height) < 600;
  const effectivePercent = isLandscape ? Math.min(Math.max(maxHeightPercent, 85), 95) : maxHeightPercent;
  const modalMaxH = availH * (effectivePercent / 100);
  // On phones, ensure modal uses at least 90% width for usability
  const effectiveWidthPercent = isPhone ? Math.max(widthPercent, 90) : widthPercent;
  const modalW = Math.min(availW * (effectiveWidthPercent / 100), maxWidth);

  const animatedStyle = animationType === 'scale'
    ? {transform: [{scale}, {translateY: avoidKeyboard && Platform.OS === 'android' ? keyboardOffset : 0}], opacity: fade}
    : {transform: [{translateY: slide}], opacity: fade};

  const cardContent = (
    <Animated.View
      style={[
        s.card,
        {
          width: modalW,
          maxHeight: modalMaxH,
          backgroundColor: c.white,
          shadowColor: c.shadowColor,
        },
        animatedStyle,
      ]}>
      {children}
    </Animated.View>
  );

  const overlay = (
    <View style={[s.overlay, {backgroundColor: c.overlayModal}]}>
      <View style={s.overlayTouch} />
      {cardContent}
    </View>
  );

  if (avoidKeyboard && Platform.OS === 'ios') {
    return (
      <Modal transparent visible={visible} animationType="none" onRequestClose={onClose} statusBarTranslucent>
        <KeyboardAvoidingView
          style={s.flex1}
          behavior="padding"
          keyboardVerticalOffset={0}>
          {overlay}
        </KeyboardAvoidingView>
      </Modal>
    );
  }

  return (
    <Modal transparent visible={visible} animationType="none" onRequestClose={onClose} statusBarTranslucent>
      {overlay}
    </Modal>
  );
}

const s = StyleSheet.create({
  flex1: {flex: 1},
  overlay: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  overlayTouch: {
    position: 'absolute', top: 0, left: 0, right: 0, bottom: 0,
  },
  card: {
    borderRadius: 18,
    overflow: 'hidden',
    elevation: 12,
    shadowColor: '#000',
    shadowOffset: {width: 0, height: 6},
    shadowOpacity: 0.18,
    shadowRadius: 16,
  },
});
