import {useRef, useState, useCallback} from 'react';
import {Animated, NativeSyntheticEvent, NativeScrollEvent} from 'react-native';

/** Hook that tracks scroll position and returns props + thumb render data. */
export function useScrollIndicator() {
  const scrollY = useRef(new Animated.Value(0)).current;
  const [containerH, setContainerH] = useState(0);
  const [contentH, setContentH] = useState(0);

  const onScroll = Animated.event(
    [{nativeEvent: {contentOffset: {y: scrollY}}}],
    {useNativeDriver: false},
  );

  const onLayout = useCallback((e: any) => {
    setContainerH(e.nativeEvent.layout.height);
  }, []);

  const onContentSizeChange = useCallback((_w: number, h: number) => {
    setContentH(h);
  }, []);

  const canScroll = contentH > containerH && containerH > 0;
  const thumbMinH = 24;
  const trackW = 4;
  const thumbRatio = canScroll ? containerH / contentH : 1;
  const thumbH = Math.max(thumbMinH, containerH * thumbRatio);
  const scrollRange = contentH - containerH;
  const trackRange = containerH - thumbH;

  const translateY = canScroll
    ? scrollY.interpolate({inputRange: [0, Math.max(scrollRange, 1)], outputRange: [0, trackRange], extrapolate: 'clamp'})
    : new Animated.Value(0);

  return {
    scrollViewProps: {
      onScroll,
      scrollEventThrottle: 16,
      onLayout,
      onContentSizeChange,
      showsVerticalScrollIndicator: false,
    },
    canScroll,
    thumbH,
    trackW,
    translateY,
  };
}
