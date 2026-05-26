import React, {useRef, useEffect} from 'react';
import {
  Modal,
  Pressable,
  Animated,
  StyleSheet,
  useWindowDimensions,
  KeyboardAvoidingView,
  Platform,
  StatusBar,
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
    }
  }, [visible, fade, scale, slide, animationType]);

  // Compute dimensions from live values (not static wp())
  const statusBarH = StatusBar.currentHeight || 0;
  const safeV = insets.top + insets.bottom + statusBarH;
  const availH = height - safeV;
  const modalMaxH = availH * ((isLandscape ? Math.max(maxHeightPercent, 90) : maxHeightPercent) / 100);
  const modalW = Math.min(width * (widthPercent / 100), maxWidth);

  const animatedStyle = animationType === 'scale'
    ? {transform: [{scale}], opacity: fade}
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
      ]}
      onStartShouldSetResponder={() => true}
      onMoveShouldSetResponder={() => true}>
      {children}
    </Animated.View>
  );

  const overlay = (
    <Pressable
      style={[s.overlay, {backgroundColor: c.overlayModal}]}
      onPress={onClose}>
      {cardContent}
    </Pressable>
  );

  if (avoidKeyboard) {
    return (
      <Modal transparent visible={visible} animationType="none" onRequestClose={onClose} statusBarTranslucent>
        <KeyboardAvoidingView
          style={s.flex1}
          behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
          keyboardVerticalOffset={Platform.OS === 'ios' ? 0 : statusBarH}>
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
  card: {
    borderRadius: 18,
    overflow: 'hidden',
    elevation: 16,
    shadowOffset: {width: 0, height: 8},
    shadowOpacity: 0.25,
    shadowRadius: 20,
  },
});
