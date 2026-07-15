import React, {useEffect, useRef} from 'react';
import {
  View,
  Text,
  StyleSheet,
  Animated,
  StatusBar,
  Platform,
  useWindowDimensions,
  Easing,
} from 'react-native';
import {useSafeAreaInsets} from 'react-native-safe-area-context';
import type {NativeStackNavigationProp} from '@react-navigation/native-stack';
import {useTheme} from '../contexts/ThemeContext';
import {ms} from '../utils/responsive';

const MONO = Platform.OS === 'ios' ? 'Menlo' : 'monospace';
import {useFontScaleRefresh} from '../contexts/FontSizeContext';
import YellowTruck from '../assets/svgs/yellowTruck.svg';

type Props = {
  navigation: NativeStackNavigationProp<any>;
};

export default function SplashScreen({navigation}: Props) {
  useFontScaleRefresh();
  const {c} = useTheme();
  const {width, height} = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const isLandscape = width > height;
  const isTablet = Math.min(width, height) > 600;

  const styles = createStyles(c, isLandscape, isTablet);

  // Animation values
  const bgGlow = useRef(new Animated.Value(0)).current;
  const ring1Scale = useRef(new Animated.Value(0.3)).current;
  const ring1Opacity = useRef(new Animated.Value(0)).current;
  const ring2Scale = useRef(new Animated.Value(0.3)).current;
  const ring2Opacity = useRef(new Animated.Value(0)).current;
  const ring3Scale = useRef(new Animated.Value(0.3)).current;
  const ring3Opacity = useRef(new Animated.Value(0)).current;
  const logoScale = useRef(new Animated.Value(0)).current;
  const logoRotate = useRef(new Animated.Value(0)).current;
  const iconOpacity = useRef(new Animated.Value(0)).current;
  const nameOpacity = useRef(new Animated.Value(0)).current;
  const nameTranslateY = useRef(new Animated.Value(20)).current;
  const taglineOpacity = useRef(new Animated.Value(0)).current;
  const taglineTranslateY = useRef(new Animated.Value(15)).current;
  const dividerWidth = useRef(new Animated.Value(0)).current;
  const dot1Opacity = useRef(new Animated.Value(0)).current;
  const dot2Opacity = useRef(new Animated.Value(0)).current;
  const dot3Opacity = useRef(new Animated.Value(0)).current;
  const versionOpacity = useRef(new Animated.Value(0)).current;
  const screenFade = useRef(new Animated.Value(1)).current;
  const wheelRotation = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    const ringPulse = (
      scale: Animated.Value,
      opacity: Animated.Value,
      delay: number,
    ) =>
      Animated.sequence([
        Animated.delay(delay),
        Animated.parallel([
          Animated.spring(scale, {
            toValue: 1,
            friction: 6,
            tension: 40,
            useNativeDriver: true,
          }),
          Animated.timing(opacity, {
            toValue: 0.4,
            duration: 600,
            useNativeDriver: true,
          }),
        ]),
      ]);

    // Dot pulse loop
    const dotPulse = (dot: Animated.Value, delay: number) =>
      Animated.sequence([
        Animated.delay(delay),
        Animated.loop(
          Animated.sequence([
            Animated.timing(dot, {
              toValue: 1,
              duration: 400,
              useNativeDriver: true,
            }),
            Animated.timing(dot, {
              toValue: 0.2,
              duration: 400,
              useNativeDriver: true,
            }),
          ]),
        ),
      ]);

    // Wheel spin
    const wheelAnimation = Animated.loop(
      Animated.timing(wheelRotation, {
        toValue: 1,
        duration: 800,
        easing: Easing.linear,
        useNativeDriver: true,
      }),
    );
    wheelAnimation.start();

    // Main sequence
    Animated.parallel([
      // Background glow
      Animated.timing(bgGlow, {
        toValue: 1,
        duration: 1200,
        useNativeDriver: true,
      }),

      // Rings cascade
      ringPulse(ring1Scale, ring1Opacity, 0),
      ringPulse(ring2Scale, ring2Opacity, 150),
      ringPulse(ring3Scale, ring3Opacity, 300),

      // Logo entrance
      Animated.sequence([
        Animated.delay(200),
        Animated.parallel([
          Animated.spring(logoScale, {
            toValue: 1,
            friction: 5,
            tension: 60,
            useNativeDriver: true,
          }),
          Animated.timing(logoRotate, {
            toValue: 1,
            duration: 800,
            useNativeDriver: true,
          }),
        ]),
      ]),

      // Icon fade in
      Animated.sequence([
        Animated.delay(500),
        Animated.timing(iconOpacity, {
          toValue: 1,
          duration: 400,
          useNativeDriver: true,
        }),
      ]),

      // App name
      Animated.sequence([
        Animated.delay(700),
        Animated.parallel([
          Animated.timing(nameOpacity, {
            toValue: 1,
            duration: 500,
            useNativeDriver: true,
          }),
          Animated.spring(nameTranslateY, {
            toValue: 0,
            friction: 8,
            tension: 50,
            useNativeDriver: true,
          }),
        ]),
      ]),

      // Tagline
      Animated.sequence([
        Animated.delay(1000),
        Animated.parallel([
          Animated.timing(taglineOpacity, {
            toValue: 1,
            duration: 400,
            useNativeDriver: true,
          }),
          Animated.spring(taglineTranslateY, {
            toValue: 0,
            friction: 8,
            tension: 50,
            useNativeDriver: true,
          }),
        ]),
      ]),

      // Divider line
      Animated.sequence([
        Animated.delay(1200),
        Animated.spring(dividerWidth, {
          toValue: 1,
          friction: 8,
          tension: 40,
          useNativeDriver: true,
        }),
      ]),

      // Loading dots
      dotPulse(dot1Opacity, 1400),
      dotPulse(dot2Opacity, 1550),
      dotPulse(dot3Opacity, 1700),

      // Version
      Animated.sequence([
        Animated.delay(1500),
        Animated.timing(versionOpacity, {
          toValue: 1,
          duration: 400,
          useNativeDriver: true,
        }),
      ]),
    ]).start();

    // Fade out and navigate after splash animation
    const timer = setTimeout(() => {
      Animated.timing(screenFade, {
        toValue: 0,
        duration: 500,
        useNativeDriver: true,
      }).start(() => {
        navigation.replace('Login');
      });
    }, 3200);

    return () => {
      clearTimeout(timer);
      wheelAnimation.stop();
    };
  }, [
    bgGlow,
    ring1Scale,
    ring1Opacity,
    ring2Scale,
    ring2Opacity,
    ring3Scale,
    ring3Opacity,
    logoScale,
    logoRotate,
    iconOpacity,
    nameOpacity,
    nameTranslateY,
    taglineOpacity,
    taglineTranslateY,
    dividerWidth,
    dot1Opacity,
    dot2Opacity,
    dot3Opacity,
    versionOpacity,
    screenFade,
    wheelRotation,
    navigation,
  ]);

  const logoSpin = logoRotate.interpolate({
    inputRange: [0, 1],
    outputRange: ['-15deg', '0deg'],
  });

  const wheelSpin = wheelRotation.interpolate({
    inputRange: [0, 1],
    outputRange: ['0deg', '360deg'],
  });

  const smallDim = Math.min(width, height);
  const ringBaseSize = isTablet ? smallDim * 0.5 : smallDim * 0.6;
  const dotSize = isTablet ? 10 : 7;

  return (
    <Animated.View style={[styles.container, {opacity: screenFade}]}>
      <StatusBar
        translucent
        backgroundColor="transparent"
        barStyle="light-content"
      />

      {/* Base gradient layers */}
      <View style={styles.bgBase} />
      <View style={styles.bgTopGradient} />
      <View style={styles.bgBottomGradient} />

      {/* Animated glow overlay */}
      <Animated.View
        style={[
          styles.glowOverlay,
          {
            opacity: bgGlow.interpolate({
              inputRange: [0, 1],
              outputRange: [0, 0.15],
            }),
          },
        ]}
      />

      {/* Animated rings */}
      <View style={styles.ringsContainer} pointerEvents="none">
        {[
          {scale: ring1Scale, opacity: ring1Opacity, sizeMul: 1},
          {scale: ring2Scale, opacity: ring2Opacity, sizeMul: 1.5},
          {scale: ring3Scale, opacity: ring3Opacity, sizeMul: 2},
        ].map((ring, i) => {
          const size = ringBaseSize * ring.sizeMul;
          return (
            <Animated.View
              key={i}
              style={[
                styles.ring,
                {
                  width: size,
                  height: size,
                  borderRadius: size / 2,
                  marginLeft: -size / 2,
                  marginTop: -size / 2,
                  opacity: ring.opacity,
                  transform: [{scale: ring.scale}],
                },
              ]}
            />
          );
        })}
      </View>

      {/* Main content */}
      <View
        style={[
          styles.content,
          {paddingTop: insets.top, paddingBottom: insets.bottom, paddingLeft: insets.left, paddingRight: insets.right},
          isLandscape && styles.contentLandscape,
        ]}>
        {/* Logo section */}
        <View
          style={[
            styles.logoSection,
            isLandscape && styles.logoSectionLandscape,
          ]}>
          <Animated.View
            style={{
              opacity: iconOpacity,
              transform: [{scale: logoScale}],
            }}>
            {(() => {
              const truckWidth = isTablet ? 240 : isLandscape ? 160 : 200;
              const truckHeight = (truckWidth * 86) / 157;
              const s = truckWidth / 157;
              // Wheel centers from SVG: rear(42.2, 75.9), middle(62.9, 75.9), front(127.5, 75.9)
              // Inner wheel radius in SVG ≈ 6.5
              const wheelSize = 13 * s;
              const wheelBottom = (86 - 75.9) * s - wheelSize / 2;
              const spokeW = 2 * s;
              const wheels = [
                {left: 42.2 * s - wheelSize / 2},
                {left: 62.9 * s - wheelSize / 2},
                {left: 127.5 * s - wheelSize / 2},
              ];
              return (
                <View style={{width: truckWidth, height: truckHeight}}>
                  <YellowTruck width={truckWidth} height={truckHeight} />
                  {wheels.map((w, i) => (
                    <Animated.View
                      key={i}
                      style={[
                        styles.wheelOverlay,
                        {
                          width: wheelSize,
                          height: wheelSize,
                          left: w.left,
                          bottom: wheelBottom,
                          transform: [{rotate: wheelSpin}],
                        },
                      ]}>
                      <View style={[styles.wheelSpoke, {height: wheelSize * 0.8, width: spokeW}]} />
                      <View style={[styles.wheelSpoke, styles.spokeRotated, {height: wheelSize * 0.8, width: spokeW}]} />
                    </Animated.View>
                  ))}
                </View>
              );
            })()}
          </Animated.View>
        </View>

        {/* Text section */}
        <View
          style={[
            styles.textSection,
            isLandscape && styles.textSectionLandscape,
          ]}>
          <Animated.Text
            style={[
              styles.appName,
              {
                opacity: nameOpacity,
                transform: [{translateY: nameTranslateY}],
              },
            ]}>
            TKSync
          </Animated.Text>

          <Animated.Text
            style={[
              styles.tagline,
              {
                opacity: taglineOpacity,
                transform: [{translateY: taglineTranslateY}],
              },
            ]}>
            Ticket Tracking System
          </Animated.Text>

          {/* Decorative divider */}
          <Animated.View
            style={[
              styles.divider,
              {
                transform: [{scaleX: dividerWidth}],
                opacity: dividerWidth,
              },
            ]}
          />

          {/* Loading dots */}
          <View style={styles.dotsRow}>
            {[dot1Opacity, dot2Opacity, dot3Opacity].map((dot, i) => (
              <Animated.View
                key={i}
                style={[
                  styles.dot,
                  {
                    width: dotSize,
                    height: dotSize,
                    borderRadius: dotSize / 2,
                    opacity: dot,
                  },
                ]}
              />
            ))}
          </View>
        </View>

        {/* Version at bottom */}
        <Animated.View
          style={[
            styles.versionContainer,
            {bottom: Math.max(40, insets.bottom + 16)},
            isLandscape && [styles.versionContainerLandscape, {bottom: Math.max(20, insets.bottom + 8)}],
            {opacity: versionOpacity},
          ]}>
          <View style={styles.versionBadge}>
            <Text style={styles.versionText}>v1.20.0</Text>
          </View>
          <Text style={styles.copyrightText}>Powered by TKSync</Text>
        </Animated.View>
      </View>
    </Animated.View>
  );
}

const createStyles = (c: any, isLandscape: boolean, isTablet: boolean) => {
  const titleSize = ms(isTablet ? 46 : isLandscape ? 32 : 38);
  const taglineSize = ms(isTablet ? 18 : isLandscape ? 13 : 15);

  return StyleSheet.create({
    container: {flex: 1, overflow: 'hidden', backgroundColor: c.primaryDark},
    bgBase: {...StyleSheet.absoluteFill, backgroundColor: c.primaryDark},
    bgTopGradient: {position: 'absolute', top: 0, left: -5, right: -5, height: '65%', borderBottomLeftRadius: 40, borderBottomRightRadius: 40, backgroundColor: c.primary},
    bgBottomGradient: {position: 'absolute', left: -5, right: -5, bottom: 0, height: '50%', backgroundColor: c.primaryDark},
    glowOverlay: {...StyleSheet.absoluteFill, backgroundColor: c.primaryLight},
    ringsContainer: {...StyleSheet.absoluteFill, justifyContent: 'center', alignItems: 'center'},
    ring: {position: 'absolute', left: '50%', top: '50%', borderWidth: 1.5, backgroundColor: 'transparent', borderColor: c.overlay12},
    content: {flex: 1, alignItems: 'center', justifyContent: 'center'},
    contentLandscape: {flexDirection: 'row', justifyContent: 'center', gap: 40},
    logoSection: {alignItems: 'center', marginBottom: 28},
    logoSectionLandscape: {marginBottom: 0},
    logoOuter: {justifyContent: 'center', alignItems: 'center', borderWidth: 2, elevation: 20, shadowOffset: {width: 0, height: 8}, shadowOpacity: 0.35, shadowRadius: 16},
    logoInner: {justifyContent: 'center', alignItems: 'center', elevation: 10, shadowOffset: {width: 0, height: 4}, shadowOpacity: 0.4, shadowRadius: 10},
    textSection: {alignItems: 'center'},
    textSectionLandscape: {alignItems: 'flex-start'},
    appName: {fontWeight: '900', letterSpacing: 4, color: c.textOnPrimary, fontSize: titleSize},
    tagline: {marginTop: 6, letterSpacing: 1, fontWeight: '500', color: c.textOnDark65, fontSize: taglineSize},
    divider: {width: 60, height: 2.5, borderRadius: 2, marginTop: 20, marginBottom: 20, backgroundColor: c.overlay25},
    dotsRow: {flexDirection: 'row', gap: 8, alignItems: 'center'},
    dot: {backgroundColor: c.textOnPrimary},
    wheelOverlay: {position: 'absolute', alignItems: 'center', justifyContent: 'center'},
    wheelSpoke: {position: 'absolute', backgroundColor: 'rgba(255,255,255,0.5)', borderRadius: 1},
    spokeRotated: {transform: [{rotate: '90deg'}]},
    versionContainer: {position: 'absolute', alignItems: 'center'},
    versionContainerLandscape: {right: 30, left: undefined},
    versionBadge: {paddingHorizontal: 16, paddingVertical: 5, borderRadius: 14, borderWidth: 1, marginBottom: 8, backgroundColor: c.overlay10, borderColor: c.overlay08},
    versionText: {fontSize: ms(12), fontWeight: '600', letterSpacing: 0.5, color: c.textOnDark60, fontFamily: MONO},
    copyrightText: {fontSize: ms(11), fontWeight: '500', letterSpacing: 0.3, color: c.textOnDark35, fontFamily: MONO},
  });
};
