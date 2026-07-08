import React, {useState, useRef, useEffect} from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  StatusBar,
  KeyboardAvoidingView,
  ScrollView,
  Platform,
  Animated,
  Keyboard,
  Image,
  useWindowDimensions,
} from 'react-native';
import {useSafeAreaInsets} from 'react-native-safe-area-context';
import Icon from '../components/Icon';
import type {NativeStackNavigationProp} from '@react-navigation/native-stack';
import {useTranslation} from 'react-i18next';
import {useTheme} from '../contexts/ThemeContext';
import {useAuth} from '../contexts/AuthContext';
import {ApiError} from '../services/api';
import {storage} from '../services/storage';
import {wp, ms} from '../utils/responsive';
import {useFontScaleRefresh} from '../contexts/FontSizeContext';

const MONO = Platform.OS === 'ios' ? 'Menlo' : 'monospace';

type Props = {
  navigation: NativeStackNavigationProp<any>;
};

export default function CompanyLoginScreen({navigation}: Props) {
  useFontScaleRefresh();
  const savedRemember = storage.getBoolean('remember_driver') ?? false;
  const [companyCode, setCompanyCode] = useState(savedRemember ? (storage.getString('saved_company_code') ?? '') : '');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const {t} = useTranslation();
  const {c} = useTheme();
  const {companyLogin, isCompanyLoggedIn, isDriverLoggedIn} = useAuth();
  const insets = useSafeAreaInsets();
  const {width, height} = useWindowDimensions();

  const shortDim = Math.min(width, height);
  const isTablet = shortDim > 600;
  const isLandscape = width > height;
  const landscapePhone = isLandscape && !isTablet;
  const landscapeTablet = isLandscape && isTablet;

  const styles = createStyles(c, isTablet, landscapePhone, landscapeTablet);

  const fadeAnim = useRef(new Animated.Value(0)).current;
  const slideAnim = useRef(new Animated.Value(30)).current;
  const animStarted = useRef(false);
  const scrollRef = useRef<ScrollView>(null);

  // Track keyboard height directly — don't rely on adjustResize (broken on MIUI)
  const [keyboardHeight, setKeyboardHeight] = useState(0);
  useEffect(() => {
    if (Platform.OS !== 'android') return;
    const showSub = Keyboard.addListener('keyboardDidShow', e => {
      setKeyboardHeight(e.endCoordinates.height);
    });
    const hideSub = Keyboard.addListener('keyboardDidHide', () => {
      setKeyboardHeight(0);
    });
    return () => { showSub.remove(); hideSub.remove(); };
  }, []);

  const handleInputFocus = () => {
    setTimeout(() => scrollRef.current?.scrollToEnd({animated: true}), 350);
  };

  useEffect(() => {
    if (isDriverLoggedIn) {
      navigation.replace('Dashboard');
    } else if (isCompanyLoggedIn) {
      navigation.replace('DriverLogin');
    }
  }, [isCompanyLoggedIn, isDriverLoggedIn, navigation]);

  useEffect(() => {
    if (!animStarted.current) {
      animStarted.current = true;
      Animated.parallel([
        Animated.timing(fadeAnim, {toValue: 1, duration: 600, useNativeDriver: true}),
        Animated.spring(slideAnim, {toValue: 0, friction: 8, tension: 50, useNativeDriver: true}),
      ]).start();
    }
  }, [fadeAnim, slideAnim]);

  // Dismiss keyboard on orientation change to prevent layout chaos
  const prevLandscape = useRef(isLandscape);
  useEffect(() => {
    if (prevLandscape.current !== isLandscape) {
      prevLandscape.current = isLandscape;
      Keyboard.dismiss();
    }
  }, [isLandscape]);

  const handleConnect = async () => {
    const code = companyCode.trim();
    if (!code) {
      setError(t('companyLogin.errorEmpty', 'Please enter a company code'));
      return;
    }

    setError('');
    setLoading(true);
    try {
      await companyLogin(code);
      navigation.replace('DriverLogin');
    } catch (err) {
      if (err instanceof ApiError) {
        setError(err.message);
      } else {
        setError(t('companyLogin.errorNetwork', 'Network error. Please try again.'));
      }
    } finally {
      setLoading(false);
    }
  };

  // Fixed maxWidth caps (NOT scaled by wp() — prevents bloating on tablets)
  const formMaxW = isTablet ? 520 : 480;
  const brandingMaxW = isTablet ? 360 : 280;

  // Compute explicit widths from screen dimensions to avoid "one-render-behind" bug
  // (percentage/flex widths resolve against stale parent layout during rotation)
  const padL = Math.max(isTablet ? 40 : wp(20), insets.left + 10);
  const padR = Math.max(isTablet ? 40 : wp(20), insets.right + 10);
  const contentW = width - padL - padR;
  const gap = landscapeTablet ? 50 : wp(20);
  const brandingW = isLandscape
    ? Math.min(landscapePhone ? 240 : brandingMaxW, (contentW - gap) * 0.4)
    : contentW;
  const formW = isLandscape
    ? Math.min(formMaxW, contentW - brandingW - gap)
    : Math.min(formMaxW, contentW);

  return (
    <View style={styles.container}>
      <StatusBar translucent backgroundColor="transparent" barStyle="light-content" />

      <View style={styles.bgTop} />
      <View style={styles.bgBottom} />

      <KeyboardAvoidingView
        style={styles.content}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <ScrollView
          ref={scrollRef}
          contentContainerStyle={[
            styles.innerContent,
            {
              paddingTop: isLandscape ? insets.top + 4 : insets.top + wp(16),
              paddingBottom: (isLandscape ? insets.bottom + 8 : wp(24)) + keyboardHeight,
              paddingLeft: padL,
              paddingRight: padR,
            },
          ]}
          showsVerticalScrollIndicator={false}
          keyboardShouldPersistTaps="handled"
          bounces={false}>

          <View style={[
            styles.innerRow,
            {width: contentW},
            isLandscape && styles.innerRowLandscape,
            landscapeTablet && styles.innerRowLandscapeTablet,
          ]}>
            {/* Branding */}
            <Animated.View
              style={[
                styles.brandingSection,
                isLandscape && styles.brandingSectionLandscape,
                isLandscape && {width: brandingW},
                {opacity: fadeAnim},
              ]}>
              <View style={landscapePhone ? styles.logoWrapperLandscapePhone : styles.logoWrapper}>
                <View style={[
                  styles.logoOuter,
                  landscapePhone && styles.logoOuterLandscapePhone,
                  isTablet && styles.logoOuterTablet,
                ]}>
                  <View style={[
                    styles.logoInner,
                    landscapePhone && styles.logoInnerLandscapePhone,
                    isTablet && styles.logoInnerTablet,
                  ]}>
                    <Image
                      source={require('../assets/images/logo.png')}
                      style={landscapePhone ? styles.logoImageLandscapePhone : isTablet ? styles.logoImageTablet : styles.logoImageDefault}
                    />
                  </View>
                </View>
              </View>
              <Text style={[
                styles.appName,
                landscapePhone ? styles.appNameLandscapePhone : isTablet ? styles.appNameTablet : styles.appNameDefault,
              ]}>
                {t('app.name')}
              </Text>
              <Text style={[
                styles.appTagline,
                landscapePhone ? styles.appTaglineLandscapePhone : isTablet ? styles.appTaglineTablet : styles.appTaglineDefault,
              ]}>
                {t('app.tagline')}
              </Text>
            </Animated.View>

            {/* Form Card */}
            <Animated.View
              style={[
                {width: formW},
                {opacity: fadeAnim, transform: [{translateY: slideAnim}]},
              ]}>
            <View style={[
              styles.formCard,
              landscapePhone && styles.formCardLandscapePhone,
              isTablet && styles.formCardTablet,
            ]}>
              {/* Login type indicator — hide in landscape phone */}
              {!landscapePhone && (
                <View style={styles.loginTypeBadge}>
                  <Icon name="business" size={ms(14)} color={c.primary} />
                  <Text style={styles.loginTypeText}>
                    {t('companyLogin.badge')}
                  </Text>
                </View>
              )}

              <Text style={[
                styles.welcomeText,
                landscapePhone ? styles.welcomeTextLandscapePhone : isTablet ? styles.welcomeTextTablet : styles.welcomeTextDefault,
              ]}>
                {t('companyLogin.title')}
              </Text>
              <Text style={[
                styles.welcomeSub,
                landscapePhone ? styles.welcomeSubLandscapePhone : isTablet ? styles.welcomeSubTablet : styles.welcomeSubDefault,
              ]}>
                {t('companyLogin.subtitle')}
              </Text>

              {/* Company Code */}
              <View style={landscapePhone ? styles.codeFieldWrapLandscapePhone : isTablet ? styles.codeFieldWrapTablet : styles.codeFieldWrap}>
                <Text style={[styles.fieldLabel, landscapePhone && styles.fieldLabelLandscapePhone]}>
                  {t('companyLogin.companyCode')}
                </Text>
                <View style={[
                  styles.inputRow,
                  isTablet && styles.inputRowTablet,
                ]}>
                  <View style={[
                    styles.inputIconBox,
                    landscapePhone && styles.inputIconBoxLandscapePhone,
                    isTablet && styles.inputIconBoxTablet,
                  ]}>
                    <Icon name="vpn-key" size={isTablet ? 22 : landscapePhone ? 16 : 20} color={c.primaryLight} />
                  </View>
                  <TextInput
                    style={[
                      styles.input,
                      landscapePhone ? styles.inputLandscapePhone : isTablet ? styles.inputTablet : styles.inputDefault,
                    ]}
                    placeholder={t('companyLogin.companyCodePlaceholder')}
                    placeholderTextColor={c.textPlaceholder}
                    value={companyCode}
                    onChangeText={setCompanyCode}
                    autoCapitalize="characters"
                    onFocus={handleInputFocus}
                    returnKeyType="go"
                    onSubmitEditing={handleConnect}
                    maxLength={50}
                  />
                </View>
              </View>

              {/* Error Message */}
              {error ? (
                <View style={styles.errorBox}>
                  <Icon name="error-outline" size={ms(14)} color={c.error} />
                  <Text style={styles.errorText}>{error}</Text>
                </View>
              ) : null}

              {/* Connect Button */}
              <TouchableOpacity
                style={[
                  styles.connectButton,
                  landscapePhone && styles.connectButtonLandscapePhone,
                  isTablet && styles.connectButtonTablet,
                  loading && styles.connectButtonLoading,
                ]}
                onPress={handleConnect}
                activeOpacity={0.85}
                disabled={loading}>
                <Text style={[
                  styles.connectButtonText,
                  landscapePhone ? styles.connectButtonTextLandscapePhone : isTablet ? styles.connectButtonTextTablet : styles.connectButtonTextDefault,
                ]}>
                  {loading ? t('companyLogin.connecting', 'Connecting...') : t('companyLogin.connect')}
                </Text>
                {!loading && <Icon name="arrow-forward" size={isTablet ? 22 : landscapePhone ? 18 : 20} color={c.textOnPrimary} />}
              </TouchableOpacity>

              {/* Footer — hide in landscape phone */}
              {!landscapePhone && (
                <View style={[styles.footer, isTablet && styles.footerTablet]}>
                  <View style={styles.footerDivider} />
                  <Text style={styles.footerText}>{t('app.poweredBy')}</Text>
                  <View style={styles.footerDivider} />
                </View>
              )}
            </View>
          </Animated.View>
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </View>
  );
}

const createStyles = (c: any, isTablet: boolean, landscapePhone: boolean, landscapeTablet: boolean) => StyleSheet.create({
  // ── Layout ──────────────────────────────────────────────────────────────────
  container: {flex: 1, overflow: 'hidden', backgroundColor: c.primaryDark},
  bgTop: {position: 'absolute', top: 0, left: -5, right: -5, height: '65%', borderBottomLeftRadius: 40, borderBottomRightRadius: 40, backgroundColor: c.primary},
  bgBottom: {position: 'absolute', bottom: 0, left: -5, right: -5, height: '50%', backgroundColor: c.primaryDark},
  content: {flex: 1},
  innerContent: {flexGrow: 1, alignItems: 'center', justifyContent: 'center'},
  innerRow: {alignItems: 'center', justifyContent: 'center'},
  innerRowLandscape: {flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: wp(20)},
  innerRowLandscapeTablet: {gap: 50},

  // ── Branding section ────────────────────────────────────────────────────────
  brandingSection: {alignItems: 'center', marginBottom: wp(24)},
  brandingSectionLandscape: {marginBottom: 0},

  // ── Logo wrapper (controls margin-bottom around the logo) ───────────────────
  logoWrapper: {marginBottom: 16},
  logoWrapperLandscapePhone: {marginBottom: 4},

  // ── Logo outer ring ─────────────────────────────────────────────────────────
  logoOuter: {width: wp(82), height: wp(82), borderRadius: wp(26), justifyContent: 'center', alignItems: 'center', borderWidth: 2, backgroundColor: c.overlay15, borderColor: c.overlay25},
  logoOuterLandscapePhone: {width: 50, height: 50, borderRadius: 16},
  logoOuterTablet: {width: 100, height: 100, borderRadius: 30},

  // ── Logo inner fill ──────────────────────────────────────────────────────────
  logoInner: {width: wp(60), height: wp(60), borderRadius: wp(18), justifyContent: 'center', alignItems: 'center', elevation: 8, shadowOffset: {width: 0, height: 4}, shadowOpacity: 0.3, shadowRadius: 8, backgroundColor: c.primaryLight, shadowColor: c.shadowColor},
  logoInnerLandscapePhone: {width: 36, height: 36, borderRadius: 12},
  logoInnerTablet: {width: 72, height: 72, borderRadius: 22},

  // ── Logo image ───────────────────────────────────────────────────────────────
  logoImageDefault: {width: 52, height: 52, borderRadius: 14},
  logoImageLandscapePhone: {width: 32, height: 32, borderRadius: 10},
  logoImageTablet: {width: 65, height: 65, borderRadius: 18},

  // ── App name ─────────────────────────────────────────────────────────────────
  appName: {fontWeight: '800', letterSpacing: 2, color: c.textOnPrimary},
  appNameDefault: {fontSize: ms(18)},
  appNameLandscapePhone: {fontSize: ms(16)},
  appNameTablet: {fontSize: ms(20)},

  // ── App tagline ──────────────────────────────────────────────────────────────
  appTagline: {marginTop: 4, letterSpacing: 0.5, color: c.textOnDark70},
  appTaglineDefault: {fontSize: ms(10)},
  appTaglineLandscapePhone: {fontSize: ms(9)},
  appTaglineTablet: {fontSize: ms(11)},

  // ── Form card ────────────────────────────────────────────────────────────────
  formCard: {borderRadius: wp(22), paddingHorizontal: wp(20), paddingVertical: wp(22), elevation: 20, shadowOffset: {width: 0, height: 10}, shadowOpacity: 0.15, shadowRadius: 30, backgroundColor: c.white, shadowColor: c.shadowColor},
  formCardLandscapePhone: {paddingVertical: 10, paddingHorizontal: 16, borderRadius: 14},
  formCardTablet: {paddingVertical: 24, paddingHorizontal: 28, borderRadius: 22},

  // ── Login type badge ─────────────────────────────────────────────────────────
  loginTypeBadge: {flexDirection: 'row', alignItems: 'center', alignSelf: 'flex-start', paddingHorizontal: wp(12), paddingVertical: wp(5), borderRadius: wp(20), gap: wp(6), marginBottom: wp(12), borderWidth: 1, backgroundColor: c.primarySurface, borderColor: c.primaryBorder},
  loginTypeText: {fontSize: ms(9), fontWeight: '700', letterSpacing: 0.3, color: c.primary},

  // ── Welcome text ─────────────────────────────────────────────────────────────
  welcomeText: {fontWeight: '700', marginBottom: 4, color: c.textPrimary},
  welcomeTextDefault: {fontSize: ms(15)},
  welcomeTextLandscapePhone: {fontSize: ms(13), marginBottom: 1},
  welcomeTextTablet: {fontSize: ms(16)},

  // ── Welcome sub ──────────────────────────────────────────────────────────────
  welcomeSub: {color: c.textTertiary},
  welcomeSubDefault: {fontSize: ms(10), marginBottom: wp(18)},
  welcomeSubLandscapePhone: {fontSize: ms(9), marginBottom: 6},
  welcomeSubTablet: {fontSize: ms(11), marginBottom: 18},

  // ── Company code field wrapper ────────────────────────────────────────────────
  codeFieldWrap: {marginBottom: wp(18)},
  codeFieldWrapLandscapePhone: {marginBottom: 6},
  codeFieldWrapTablet: {marginBottom: 14},

  // ── Field label ───────────────────────────────────────────────────────────────
  fieldLabel: {fontSize: ms(10), fontWeight: '600', marginBottom: wp(6), letterSpacing: 0.3, color: c.textSecondary},
  fieldLabelLandscapePhone: {marginBottom: 3},

  // ── Input row ────────────────────────────────────────────────────────────────
  inputRow: {flexDirection: 'row', alignItems: 'center', borderRadius: wp(12), borderWidth: 1.5, backgroundColor: c.surface, borderColor: c.border},
  inputRowTablet: {borderRadius: 14},

  // ── Input icon box ───────────────────────────────────────────────────────────
  inputIconBox: {width: wp(40), height: wp(40), justifyContent: 'center', alignItems: 'center', marginLeft: wp(4)},
  inputIconBoxLandscapePhone: {width: 30, height: 30},
  inputIconBoxTablet: {width: 42, height: 42},

  // ── Text input ───────────────────────────────────────────────────────────────
  input: {flex: 1, paddingRight: wp(14), color: c.textPrimary},
  inputDefault: {fontSize: ms(11), paddingVertical: wp(12)},
  inputLandscapePhone: {fontSize: ms(10), paddingVertical: 6},
  inputTablet: {fontSize: ms(12), paddingVertical: 10},

  // ── Error box ────────────────────────────────────────────────────────────────
  errorBox: {flexDirection: 'row', alignItems: 'center', gap: wp(6), paddingHorizontal: wp(12), paddingVertical: wp(8), borderRadius: wp(8), borderWidth: 1, marginBottom: wp(10), backgroundColor: c.errorSurface, borderColor: c.error},
  errorText: {fontSize: ms(9), fontWeight: '500', flex: 1, color: c.error || '#EF4444'},

  // ── Connect button ───────────────────────────────────────────────────────────
  connectButton: {flexDirection: 'row', borderRadius: wp(12), paddingVertical: wp(14), alignItems: 'center', justifyContent: 'center', gap: wp(8), marginTop: wp(6), elevation: 6, shadowOffset: {width: 0, height: 4}, shadowOpacity: 0.3, shadowRadius: 8, backgroundColor: c.primary, shadowColor: c.primary},
  connectButtonLandscapePhone: {paddingVertical: 8, borderRadius: 10, marginTop: 2},
  connectButtonTablet: {paddingVertical: 14, borderRadius: 12, marginTop: 6},
  connectButtonLoading: {opacity: 0.7},

  // ── Connect button text ──────────────────────────────────────────────────────
  connectButtonText: {fontWeight: '700', letterSpacing: 0.5, color: c.textOnPrimary},
  connectButtonTextDefault: {fontSize: ms(11)},
  connectButtonTextLandscapePhone: {fontSize: ms(10)},
  connectButtonTextTablet: {fontSize: ms(12)},

  // ── Footer ───────────────────────────────────────────────────────────────────
  footer: {flexDirection: 'row', alignItems: 'center', marginTop: wp(16), gap: wp(12)},
  footerTablet: {marginTop: 16},
  footerDivider: {flex: 1, height: 1, backgroundColor: c.border},
  footerText: {fontSize: ms(9), fontWeight: '500', color: c.textPlaceholder},
});
