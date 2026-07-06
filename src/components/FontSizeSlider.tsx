import React, {useRef, useCallback, useMemo, useState, useEffect} from 'react';
import {
  View,
  Text,
  StyleSheet,
  PanResponder,
  Animated,
  TouchableOpacity,
  Platform,
  Vibration,
  useWindowDimensions,
} from 'react-native';
import Svg, {Path} from 'react-native-svg';
import Icon from './Icon';
import {useFontSize, setGlobalFontScale} from '../contexts/FontSizeContext';
import {useTheme} from '../contexts/ThemeContext';

const MONO = Platform.OS === 'ios' ? 'Menlo' : 'monospace';

const MIN_SCALE = 0.85;
const MAX_SCALE = 1.30;
const STEPS = Math.round((MAX_SCALE - MIN_SCALE) / 0.05);
const SWIPE_THRESHOLD = 25;
const FAST_SWIPE_VEL = 0.8;
const PILL_W = 48;
const COLLAPSED_H = 58;
const EXPANDED_H = 220;
const EDGE_PADDING = 10;
const AUTO_COLLAPSE_MS = 5000;
const TRACK_H = 60;

function tick() {
  if (Platform.OS === 'android') Vibration.vibrate(10);
}

function scaleToPct(scale: number): number {
  return Math.max(0, Math.min(1, (scale - MIN_SCALE) / (MAX_SCALE - MIN_SCALE)));
}

// Memoized to prevent re-renders from re-creating the SVG on every frame
const CurveIcon = React.memo(function CurveIcon({size, color, side}: {size: number; color: string; side: 'left' | 'right'}) {
  const mirror = side === 'left';
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24">
      <Path
        d={mirror
          ? 'M8 4 C16 4, 20 8, 20 12 C20 16, 16 20, 8 20'   // curve sweeps right
          : 'M16 4 C8 4, 4 8, 4 12 C4 16, 8 20, 16 20'}      // curve sweeps left
        stroke={color}
        strokeWidth={2.5}
        strokeLinecap="round"
        fill="none"
      />
      <Path
        d={mirror
          ? 'M11 17 L8 20 L11 23'   // arrow points right
          : 'M13 17 L16 20 L13 23'}  // arrow points left
        stroke={color}
        strokeWidth={2}
        strokeLinecap="round"
        strokeLinejoin="round"
        fill="none"
      />
    </Svg>
  );
});

export default function FontSizeSlider() {
  const {fontScale, increase, decrease, reset} = useFontSize();
  const {c} = useTheme();
  const {width: screenW, height: screenH} = useWindowDimensions();

  const [expanded, setExpanded] = useState(false);
  const [side, setSide] = useState<'left' | 'right'>('right');
  const [visible, setVisible] = useState(true);
  const expandAnim = useRef(new Animated.Value(0)).current;
  const collapseTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const pan = useRef(new Animated.ValueXY({x: 0, y: 0})).current;
  const dragOffset = useRef({x: 0, y: 0});
  const [isDragging, setIsDragging] = useState(false);

  // Hide on orientation change, reset position, collapse
  const prevOrientation = useRef(screenW > screenH ? 'landscape' : 'portrait');
  useEffect(() => {
    const current = screenW > screenH ? 'landscape' : 'portrait';
    if (current !== prevOrientation.current) {
      prevOrientation.current = current;
      setVisible(false);
      setExpanded(false);
      setSide('right');
      pan.setValue({x: 0, y: 0});
      dragOffset.current = {x: 0, y: 0};
      expandAnim.setValue(0);
      const timer = setTimeout(() => setVisible(true), 300);
      return () => clearTimeout(timer);
    }
  }, [screenW, screenH, pan, expandAnim]);

  const pulseAnim = useRef(new Animated.Value(1)).current;
  const lastY = useRef(0);
  const accumulated = useRef(0);
  const isFontSwiping = useRef(false);
  // Track if the gesture moved — if not, it was a tap and PanResponder shouldn't block it
  const gestureDidMove = useRef(false);

  const increaseRef = useRef(increase);
  const decreaseRef = useRef(decrease);
  increaseRef.current = increase;
  decreaseRef.current = decrease;

  setGlobalFontScale(fontScale);

  const atMax = fontScale >= MAX_SCALE;
  const atMin = fontScale <= MIN_SCALE;
  const pct = Math.round(fontScale * 100);
  const isDefault = pct === 100;
  const progress = scaleToPct(fontScale);

  const resetAutoCollapse = useCallback(() => {
    if (collapseTimer.current) clearTimeout(collapseTimer.current);
    collapseTimer.current = setTimeout(() => setExpanded(false), AUTO_COLLAPSE_MS);
  }, []);

  useEffect(() => {
    Animated.spring(expandAnim, {
      toValue: expanded ? 1 : 0,
      useNativeDriver: false,
      friction: 8,
      tension: 100,
    }).start();
    if (expanded) resetAutoCollapse();
    return () => { if (collapseTimer.current) clearTimeout(collapseTimer.current); };
  }, [expanded, expandAnim, resetAutoCollapse]);

  const flash = useCallback(() => {
    tick();
    resetAutoCollapse();
    Animated.sequence([
      Animated.timing(pulseAnim, {toValue: 1.08, duration: 60, useNativeDriver: false}),
      Animated.timing(pulseAnim, {toValue: 1, duration: 100, useNativeDriver: false}),
    ]).start();
  }, [pulseAnim, resetAutoCollapse]);

  const clampPosition = useCallback((x: number, y: number) => {
    const clampedX = Math.max(-screenW + PILL_W + EDGE_PADDING, Math.min(EDGE_PADDING, x));
    const h = expanded ? EXPANDED_H : COLLAPSED_H;
    const clampedY = Math.max(-screenH * 0.32 + EDGE_PADDING, Math.min(screenH * 0.68 - h - EDGE_PADDING, y));
    return {x: clampedX, y: clampedY};
  }, [screenW, screenH, expanded]);

  const panResponder = useMemo(
    () =>
      PanResponder.create({
        // FIX 1: Never claim on start — let taps pass through to TouchableOpacity
        onStartShouldSetPanResponder: () => false,
        // FIX 2: Only claim gesture after clear directional movement
        onMoveShouldSetPanResponder: (_, g) => {
          const moved = Math.abs(g.dx) > 8 || Math.abs(g.dy) > 10;
          return moved;
        },
        onPanResponderGrant: (_, g) => {
          isFontSwiping.current = false;
          gestureDidMove.current = false;
          lastY.current = g.y0;
          accumulated.current = 0;
          dragOffset.current = {
            x: (pan.x as any)._value || 0,
            y: (pan.y as any)._value || 0,
          };
        },
        onPanResponderMove: (_, g) => {
          gestureDidMove.current = true;
          const absX = Math.abs(g.dx);
          const absY = Math.abs(g.dy);

          // Decide mode: vertical on expanded pill = font swipe, otherwise = drag
          if (!isFontSwiping.current && absX < 10 && absY > 10 && expanded) {
            isFontSwiping.current = true;
          }

          if (isFontSwiping.current) {
            const delta = lastY.current - g.moveY;
            accumulated.current += delta;
            lastY.current = g.moveY;
            const vel = Math.abs(g.vy);
            const threshold = vel > FAST_SWIPE_VEL ? SWIPE_THRESHOLD * 0.6 : SWIPE_THRESHOLD;
            if (accumulated.current > threshold) {
              increaseRef.current(); flash(); accumulated.current = 0;
            } else if (accumulated.current < -threshold) {
              decreaseRef.current(); flash(); accumulated.current = 0;
            }
          } else {
            setIsDragging(true);
            const clamped = clampPosition(dragOffset.current.x + g.dx, dragOffset.current.y + g.dy);
            pan.setValue(clamped);
          }
        },
        onPanResponderRelease: (_, g) => {
          setIsDragging(false);
          isFontSwiping.current = false;

          // Only snap if it was a real drag (not a tap that barely moved)
          if (gestureDidMove.current && Math.abs(g.dx) > 10) {
            const currentX = dragOffset.current.x + g.dx;
            const snappingLeft = currentX < -(screenW / 2 - PILL_W);
            const snapX = snappingLeft ? -screenW + PILL_W + EDGE_PADDING : 0;
            const clamped = clampPosition(snapX, dragOffset.current.y + g.dy);
            Animated.spring(pan, {toValue: clamped, useNativeDriver: false, friction: 7, tension: 80}).start();
            dragOffset.current = clamped;
            setSide(snappingLeft ? 'left' : 'right');
          }
        },
        onPanResponderTerminate: () => { setIsDragging(false); isFontSwiping.current = false; },
      }),
    [flash, clampPosition, pan, screenW, expanded],
  );

  const toggleExpand = useCallback(() => setExpanded(prev => !prev), []);

  const pillHeight = expandAnim.interpolate({inputRange: [0, 1], outputRange: [COLLAPSED_H, EXPANDED_H]});
  const controlsOpacity = expandAnim.interpolate({inputRange: [0, 0.5, 1], outputRange: [0, 0, 1]});
  const iconOpacity = expandAnim.interpolate({inputRange: [0, 0.3], outputRange: [1, 0], extrapolate: 'clamp'});

  const pillRadius = side === 'right'
    ? {borderTopLeftRadius: 22, borderBottomLeftRadius: 22, borderTopRightRadius: 0, borderBottomRightRadius: 0}
    : {borderTopLeftRadius: 0, borderBottomLeftRadius: 0, borderTopRightRadius: 22, borderBottomRightRadius: 22};

  if (!visible) return null;

  return (
    <View style={st.container} pointerEvents="box-none">
      <Animated.View
        style={[
          st.pill,
          pillRadius,
          {
            backgroundColor: c.primaryDark,
            height: pillHeight,
            transform: [{translateX: pan.x}, {translateY: pan.y}, {scale: pulseAnim}],
            opacity: isDragging ? 0.85 : 1,
          },
        ]}
        {...panResponder.panHandlers}>

        {/* ── COLLAPSED ── */}
        {!expanded && (
          <Animated.View style={[st.collapsedWrap, {opacity: iconOpacity}]}>
            <TouchableOpacity onPress={toggleExpand} activeOpacity={0.7} style={[st.iconBtn, {fontFamily: MONO}]}>
              <View style={[st.iconCircle, {fontFamily: MONO}]}>
                <CurveIcon size={26} color="#fff" side={side} />
              </View>
              <Text style={[st.aaLabel, {fontFamily: MONO}]} allowFontScaling={false}>Aa</Text>
              {!isDefault && <View style={[st.dot, {backgroundColor: '#4FC3F7'}]} />}
            </TouchableOpacity>
          </Animated.View>
        )}

        {/* ── EXPANDED ── */}
        {expanded && (
          <Animated.View style={[st.expandedWrap, {opacity: controlsOpacity}, {fontFamily: MONO}]}>

            {/* Close toggle */}
            <TouchableOpacity onPress={toggleExpand} activeOpacity={0.7} style={[st.closeBtn, {fontFamily: MONO}]}>
              <CurveIcon size={20} color="#fff" side={side} />
            </TouchableOpacity>

            {/* ↑ Increase: space → arrow → space → Aa → space */}
            <TouchableOpacity
              onPress={atMax ? undefined : () => { increase(); flash(); }}
              activeOpacity={0.6}
              disabled={atMax}
              hitSlop={{top: 8, bottom: 4, left: 10, right: 10}}
              style={[st.arrowGroup, {fontFamily: MONO}]}>
              <View style={{height: 6}} />
              <Icon name="keyboard-arrow-up" size={22} color={atMax ? 'rgba(255,255,255,0.2)' : '#fff'} />
              <View style={{height: 4}} />
              <Text style={[st.arrowAa, {fontSize: 13, fontFamily: MONO}, atMax && st.arrowAaOff]} allowFontScaling={false}>A</Text>
              <View style={{height: 6}} />
            </TouchableOpacity>

            {/* Track */}
            <View style={[st.track, {fontFamily: MONO}]}>
              <View style={[st.trackBg, {fontFamily: MONO}]}>
                <View style={[st.trackFill, {height: TRACK_H * progress}]} />
              </View>
              {Array.from({length: STEPS + 1}, (_, i) => {
                const d = i / STEPS;
                return <View key={i} style={[st.stepDot, {bottom: `${d * 100}%`}, d <= progress ? st.dotOn : st.dotOff]} />;
              })}
            </View>

            {/* % / reset */}
            <TouchableOpacity
              onPress={isDefault ? undefined : () => { reset(); tick(); resetAutoCollapse(); }}
              activeOpacity={isDefault ? 1 : 0.6}
              hitSlop={{top: 4, bottom: 4, left: 10, right: 10}}>
              <View style={[st.badge, !isDefault && st.badgeOn]}>
                <Text style={[st.pctNum, {fontFamily: MONO}]} allowFontScaling={false}>{pct}</Text>
                <Text style={[st.pctSign, {fontFamily: MONO}]} allowFontScaling={false}>%</Text>
              </View>
            </TouchableOpacity>

            {/* ↓ Decrease: space → Aa → space → arrow → space */}
            <TouchableOpacity
              onPress={atMin ? undefined : () => { decrease(); flash(); }}
              activeOpacity={0.6}
              disabled={atMin}
              hitSlop={{top: 4, bottom: 8, left: 10, right: 10}}
              style={[st.arrowGroup, {fontFamily: MONO}]}>
              <View style={{height: 6}} />
              <Text style={[st.arrowAa, {fontSize: 10, fontFamily: MONO}, atMin && st.arrowAaOff]} allowFontScaling={false}>A</Text>
              <View style={{height: 4}} />
              <Icon name="keyboard-arrow-down" size={22} color={atMin ? 'rgba(255,255,255,0.2)' : '#fff'} />
              <View style={{height: 6}} />
            </TouchableOpacity>

          </Animated.View>
        )}

      </Animated.View>
    </View>
  );
}

const st = StyleSheet.create({
  container: {
    position: 'absolute',
    right: 0,
    top: '32%',
    zIndex: 9999,
  },
  pill: {
    width: PILL_W,
    alignItems: 'center',
    justifyContent: 'center',
    elevation: 8,
    shadowColor: '#000',
    shadowOffset: {width: -2, height: 2},
    shadowOpacity: 0.3,
    shadowRadius: 6,
  },

  // ── Collapsed ──
  collapsedWrap: {
    width: PILL_W,
    height: COLLAPSED_H,
    justifyContent: 'center',
    alignItems: 'center',
    paddingVertical: 8,
  },
  iconBtn: {
    width: PILL_W,
    height: COLLAPSED_H,
    justifyContent: 'center',
    alignItems: 'center',
  },
  iconCircle: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: 'rgba(255,255,255,0.12)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  aaLabel: {
    color: 'rgba(255,255,255,0.7)',
    fontSize: 14,
    fontWeight: '800',
    letterSpacing: 0.3,
    marginTop: 1,
  },
  dot: {
    position: 'absolute',
    top: 2,
    right: 4,
    width: 6,
    height: 6,
    borderRadius: 3,
  },

  // ── Expanded ──
  expandedWrap: {
    width: PILL_W,
    height: EXPANDED_H,
    alignItems: 'center',
    justifyContent: 'space-evenly',
    paddingVertical: 6,
  },
  closeBtn: {
    width: 36,
    height: 28,
    borderRadius: 12,
    backgroundColor: 'rgba(255,255,255,0.15)',
    justifyContent: 'center',
    alignItems: 'center',
  },

  // ── Arrow + Aa groups ──
  arrowGroup: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 2,
  },
  arrowAa: {
    color: '#fff',
    fontWeight: '900',
    letterSpacing: -0.3,
    marginTop: -2,
  },
  arrowAaOff: {
    color: 'rgba(255,255,255,0.2)',
  },

  // ── Track ──
  track: {
    width: 8,
    height: TRACK_H,
    justifyContent: 'flex-end',
    alignItems: 'center',
  },
  trackBg: {
    width: 4,
    height: '100%',
    borderRadius: 2,
    backgroundColor: 'rgba(255,255,255,0.12)',
    overflow: 'hidden',
    justifyContent: 'flex-end',
  },
  trackFill: {
    width: '100%',
    borderRadius: 2,
    backgroundColor: 'rgba(255,255,255,0.5)',
  },
  stepDot: {
    position: 'absolute',
    width: 6,
    height: 6,
    borderRadius: 3,
    marginBottom: -3,
  },
  dotOn: {backgroundColor: 'rgba(255,255,255,0.6)'},
  dotOff: {backgroundColor: 'rgba(255,255,255,0.12)'},

  // ── Badge ──
  badge: {
    flexDirection: 'row',
    alignItems: 'baseline',
    paddingHorizontal: 3,
    paddingVertical: 1,
    borderRadius: 5,
  },
  badgeOn: {backgroundColor: 'rgba(255,255,255,0.2)'},
  pctNum: {
    color: '#fff',
    fontSize: 12,
    fontWeight: '900',
    letterSpacing: 0.2,
  },
  pctSign: {
    color: 'rgba(255,255,255,0.5)',
    fontSize: 9,
    fontWeight: '700',
  },
});
