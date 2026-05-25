import React, {useEffect, useRef} from 'react';
import {
  View,
  Text,
  StyleSheet,
  Animated,
  StatusBar,
  useWindowDimensions,
} from 'react-native';
import {useSafeAreaInsets} from 'react-native-safe-area-context';
import MaterialIcons from 'react-native-vector-icons/MaterialIcons';
import Orientation from 'react-native-orientation-locker';
import type {NativeStackNavigationProp} from '@react-navigation/native-stack';
import {useTheme} from '../contexts/ThemeContext';

type Props = {
  navigation: NativeStackNavigationProp<any>;
};

export default function SplashScreen({navigation}: Props) {
  const {c} = useTheme();
  const {width, height} = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const isLandscape = width > height;
  const isTablet = Math.min(width, height) > 600;

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

  useEffect(() => {
    // Allow all orientations during splash
    Orientation.unlockAllOrientations();

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

    // Fade out and navigate
    const timer = setTimeout(() => {
      Animated.timing(screenFade, {
        toValue: 0,
        duration: 500,
        useNativeDriver: true,
      }).start(() => {
        // Lock to landscape after splash
        Orientation.lockToLandscape();
        navigation.replace('Login');
      });
    }, 3200);

    return () => clearTimeout(timer);
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
    navigation,
  ]);

  const logoSpin = logoRotate.interpolate({
    inputRange: [0, 1],
    outputRange: ['-15deg', '0deg'],
  });

  const smallDim = Math.min(width, height);
  const ringBaseSize = isTablet ? smallDim * 0.5 : smallDim * 0.6;
  const logoSize = isTablet ? 120 : isLandscape ? 80 : 96;
  const logoInnerSize = isTablet ? 88 : isLandscape ? 58 : 68;
  const iconSize = isTablet ? 48 : isLandscape ? 32 : 38;
  const titleSize = isTablet ? 46 : isLandscape ? 32 : 38;
  const taglineSize = isTablet ? 18 : isLandscape ? 13 : 15;
  const dotSize = isTablet ? 10 : 7;

  return (
    <Animated.View style={[styles.container, {backgroundColor: c.primaryDark, opacity: screenFade}]}>
      <StatusBar
        translucent
        backgroundColor="transparent"
        barStyle="light-content"
      />

      {/* Base gradient layers */}
      <View style={[styles.bgBase, {backgroundColor: c.primaryDark}]} />
      <View style={[styles.bgTopGradient, {backgroundColor: c.primary}]} />
      <View style={[styles.bgBottomGradient, {backgroundColor: c.primaryDark, bottom: 0}]} />

      {/* Animated glow overlay */}
      <Animated.View
        style={[
          styles.glowOverlay,
          {
            backgroundColor: c.primaryLight,
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
                  borderColor: c.overlay12,
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
          {paddingTop: insets.top, paddingBottom: insets.bottom},
          isLandscape && styles.contentLandscape,
        ]}>
        {/* Logo section */}
        <View
          style={[
            styles.logoSection,
            isLandscape && styles.logoSectionLandscape,
          ]}>
          <Animated.View
            style={[
              styles.logoOuter,
              {
                backgroundColor: c.overlay12,
                borderColor: c.overlay20,
                shadowColor: c.shadowColor,
                width: logoSize,
                height: logoSize,
                borderRadius: logoSize * 0.3,
                transform: [{scale: logoScale}, {rotate: logoSpin}],
              },
            ]}>
            <View
              style={[
                styles.logoInner,
                {
                  backgroundColor: c.primaryLight,
                  shadowColor: c.primaryDark,
                  width: logoInnerSize,
                  height: logoInnerSize,
                  borderRadius: logoInnerSize * 0.28,
                },
              ]}>
              <Animated.View style={{opacity: iconOpacity}}>
                <MaterialIcons
                  name="local-shipping"
                  size={iconSize}
                  color={c.textOnPrimary}
                />
              </Animated.View>
            </View>
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
                color: c.textOnPrimary,
                fontSize: titleSize,
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
                color: c.textOnDark65,
                fontSize: taglineSize,
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
                backgroundColor: c.overlay25,
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
                    backgroundColor: c.textOnPrimary,
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
            isLandscape && styles.versionContainerLandscape,
            {opacity: versionOpacity},
          ]}>
          <View style={[styles.versionBadge, {backgroundColor: c.overlay10, borderColor: c.overlay08}]}>
            <Text style={[styles.versionText, {color: c.textOnDark60}]}>v1.20.0</Text>
          </View>
          <Text style={[styles.copyrightText, {color: c.textOnDark35}]}>Powered by TKSync</Text>
        </Animated.View>
      </View>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  container: {flex: 1},
  bgBase: {...StyleSheet.absoluteFill},
  bgTopGradient: {position: 'absolute', top: 0, left: 0, right: 0, height: '60%', borderBottomLeftRadius: 60, borderBottomRightRadius: 60},
  bgBottomGradient: {position: 'absolute', left: 0, right: 0, height: '45%'},
  glowOverlay: {...StyleSheet.absoluteFill},
  ringsContainer: {...StyleSheet.absoluteFill, justifyContent: 'center', alignItems: 'center'},
  ring: {position: 'absolute', left: '50%', top: '50%', borderWidth: 1.5, backgroundColor: 'transparent'},
  content: {flex: 1, alignItems: 'center', justifyContent: 'center'},
  contentLandscape: {flexDirection: 'row', justifyContent: 'center', gap: 40},
  logoSection: {alignItems: 'center', marginBottom: 28},
  logoSectionLandscape: {marginBottom: 0},
  logoOuter: {justifyContent: 'center', alignItems: 'center', borderWidth: 2, elevation: 20, shadowOffset: {width: 0, height: 8}, shadowOpacity: 0.35, shadowRadius: 16},
  logoInner: {justifyContent: 'center', alignItems: 'center', elevation: 10, shadowOffset: {width: 0, height: 4}, shadowOpacity: 0.4, shadowRadius: 10},
  textSection: {alignItems: 'center'},
  textSectionLandscape: {alignItems: 'flex-start'},
  appName: {fontWeight: '900', letterSpacing: 4},
  tagline: {marginTop: 6, letterSpacing: 1, fontWeight: '500'},
  divider: {width: 60, height: 2.5, borderRadius: 2, marginTop: 20, marginBottom: 20},
  dotsRow: {flexDirection: 'row', gap: 8, alignItems: 'center'},
  dot: {},
  versionContainer: {position: 'absolute', bottom: 40, alignItems: 'center'},
  versionContainerLandscape: {bottom: 20, right: 30, left: undefined},
  versionBadge: {paddingHorizontal: 16, paddingVertical: 5, borderRadius: 14, borderWidth: 1, marginBottom: 8},
  versionText: {fontSize: 12, fontWeight: '600', letterSpacing: 0.5},
  copyrightText: {fontSize: 11, fontWeight: '500', letterSpacing: 0.3},
});
