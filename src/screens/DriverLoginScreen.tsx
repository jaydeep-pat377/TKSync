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

const REMEMBER_KEY = 'remember_driver';
const SAVED_TRUCK_KEY = 'saved_truck';
const SAVED_PIN_KEY = 'saved_pin';
const SAVED_COMPANY_CODE_KEY = 'saved_company_code';

export default function DriverLoginScreen({navigation}: Props) {
  useFontScaleRefresh();
  const savedRemember = storage.getBoolean(REMEMBER_KEY) ?? false;
  const [truckNumber, setTruckNumber] = useState(savedRemember ? (storage.getString(SAVED_TRUCK_KEY) ?? '') : '');
  const [driverPin, setDriverPin] = useState(savedRemember ? (storage.getString(SAVED_PIN_KEY) ?? '') : '');
  const [rememberMe, setRememberMe] = useState(savedRemember);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const {t} = useTranslation();
  const {c} = useTheme();
  const {driverLogin, company} = useAuth();
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
  const pinInputRef = useRef<TextInput>(null);

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

  const handleLogin = async () => {
    const truck = truckNumber.trim();
    const pin = driverPin.trim();
    if (!truck || !pin) {
      setError(t('driverLogin.errorEmpty', 'Please enter truck number and driver PIN'));
      return;
    }

    setError('');
    setLoading(true);
    try {
      await driverLogin(truck, pin);
      if (rememberMe) {
        storage.set(REMEMBER_KEY, true);
        storage.set(SAVED_TRUCK_KEY, truck);
        storage.set(SAVED_PIN_KEY, pin);
        if (company?.company_code) {
          storage.set(SAVED_COMPANY_CODE_KEY, company.company_code);
        }
      } else {
        storage.remove(REMEMBER_KEY);
        storage.remove(SAVED_TRUCK_KEY);
        storage.remove(SAVED_PIN_KEY);
        storage.remove(SAVED_COMPANY_CODE_KEY);
      }
      navigation.replace('Dashboard');
    } catch (err) {
      if (err instanceof ApiError) {
        setError(err.message);
      } else {
        setError(t('driverLogin.errorNetwork', 'Network error. Please try again.'));
      }
    } finally {
      setLoading(false);
    }
  };

  // Fixed maxWidth caps (NOT scaled by wp())
  const formMaxW = isTablet ? 520 : 480;
  const brandingMaxW = isTablet ? 360 : 280;

  // Compute explicit widths from screen dimensions to avoid "one-render-behind" bug
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
              <View style={landscapePhone ? styles.logoWrapLandscapePhone : styles.logoWrapDefault}>
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
                      style={
                        landscapePhone
                          ? styles.logoImageLandscapePhone
                          : isTablet
                          ? styles.logoImageTablet
                          : styles.logoImageDefault
                      }
                    />
                  </View>
                </View>
              </View>
              <Text style={[
                styles.appName,
                landscapePhone && styles.appNameLandscapePhone,
                isTablet && styles.appNameTablet,
              ]}>
                {t('app.name')}
              </Text>
              <Text style={[
                styles.appTagline,
                landscapePhone && styles.appTaglineLandscapePhone,
                isTablet && styles.appTaglineTablet,
              ]}>
                {t('app.tagline')}
              </Text>
              <View style={styles.companyBadge}>
                <Icon name="check-circle" size={ms(12)} color={c.success} />
                <Text style={styles.companyBadgeText}>{company?.company_name ?? ''}</Text>
              </View>
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
              {/* Login type indicator — hide in landscape phone to save space */}
              {!landscapePhone && (
                <View style={styles.loginTypeBadge}>
                  <Icon name="local-shipping" size={ms(14)} color={c.textOnPrimary} />
                  <Text style={styles.loginTypeText}>
                    {t('driverLogin.badge')}
                  </Text>
                </View>
              )}

              <Text style={[
                styles.welcomeText,
                landscapePhone && styles.welcomeTextLandscapePhone,
                isTablet && styles.welcomeTextTablet,
              ]}>
                {t('driverLogin.title')}
              </Text>
              <Text style={[
                styles.welcomeSub,
                landscapePhone && styles.welcomeSubLandscapePhone,
                isTablet && styles.welcomeSubTablet,
              ]}>
                {t('driverLogin.subtitle')}
              </Text>

              {/* Truck Number */}
              <View style={[
                styles.fieldWrapper,
                landscapePhone && styles.fieldWrapperLandscapePhone,
                isTablet && styles.fieldWrapperTablet,
              ]}>
                <Text style={[styles.fieldLabel, landscapePhone && styles.fieldLabelLandscapePhone]}>
                  {t('driverLogin.truckNumber')}
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
                    <Icon name="local-shipping" size={isTablet ? 22 : landscapePhone ? 16 : 20} color={c.primaryLight} />
                  </View>
                  <TextInput
                    style={[
                      styles.input,
                      landscapePhone && styles.inputLandscapePhone,
                      isTablet && styles.inputTablet,
                    ]}
                    placeholder={t('driverLogin.truckNumberPlaceholder')}
                    placeholderTextColor={c.textPlaceholder}
                    value={truckNumber}
                    onChangeText={setTruckNumber}
                    keyboardType="number-pad"
                    onFocus={handleInputFocus}
                    returnKeyType="next"
                    onSubmitEditing={() => pinInputRef.current?.focus()}
                    maxLength={20}
                  />
                </View>
              </View>

              {/* Driver PIN */}
              <View style={[
                styles.fieldWrapper,
                landscapePhone && styles.fieldWrapperLandscapePhone,
                isTablet && styles.fieldWrapperTablet,
              ]}>
                <Text style={[styles.fieldLabel, landscapePhone && styles.fieldLabelLandscapePhone]}>
                  {t('driverLogin.driverPin')}
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
                    <Icon name="badge" size={isTablet ? 22 : landscapePhone ? 16 : 20} color={c.primaryLight} />
                  </View>
                  <TextInput
                    style={[
                      styles.input,
                      landscapePhone && styles.inputLandscapePhone,
                      isTablet && styles.inputTablet,
                    ]}
                    placeholder={t('driverLogin.driverPinPlaceholder')}
                    placeholderTextColor={c.textPlaceholder}
                    ref={pinInputRef}
                    value={driverPin}
                    onChangeText={setDriverPin}
                    keyboardType="number-pad"
                    onFocus={handleInputFocus}
                    returnKeyType="go"
                    onSubmitEditing={handleLogin}
                    maxLength={20}
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

              {/* Remember Me */}
              <TouchableOpacity
                style={[styles.rememberRow, landscapePhone && styles.rememberRowLandscapePhone]}
                onPress={() => setRememberMe(!rememberMe)}
                activeOpacity={0.7}>
                <View style={[
                  styles.checkbox,
                  {borderColor: rememberMe ? c.primary : c.border},
                  rememberMe && {backgroundColor: c.primary},
                ]}>
                  {rememberMe && <Icon name="check" size={ms(12)} color={c.textOnPrimary} />}
                </View>
                <Text style={styles.rememberText}>
                  {t('driverLogin.rememberMe', 'Remember Me')}
                </Text>
              </TouchableOpacity>

              {/* Sign In Button */}
              <TouchableOpacity
                style={[
                  styles.loginButton,
                  landscapePhone && styles.loginButtonLandscapePhone,
                  isTablet && styles.loginButtonTablet,
                  loading && styles.loginButtonLoading,
                ]}
                onPress={handleLogin}
                activeOpacity={0.85}
                disabled={loading}>
                <Text style={[
                  styles.loginButtonText,
                  landscapePhone && styles.loginButtonTextLandscapePhone,
                  isTablet && styles.loginButtonTextTablet,
                ]}>
                  {loading ? t('driverLogin.signingIn', 'Signing In...') : t('driverLogin.signIn')}
                </Text>
                {!loading && <Icon name="arrow-forward" size={isTablet ? 22 : landscapePhone ? 18 : 20} color={c.textOnPrimary} />}
              </TouchableOpacity>

              {/* Footer — hide in landscape phone to save space */}
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
  container: {flex: 1, overflow: 'hidden', backgroundColor: c.primaryDark},
  bgTop: {position: 'absolute', top: 0, left: -5, right: -5, height: '65%', borderBottomLeftRadius: 40, borderBottomRightRadius: 40, backgroundColor: c.primary},
  bgBottom: {position: 'absolute', bottom: 0, left: -5, right: -5, height: '50%', backgroundColor: c.primaryDark},
  content: {flex: 1},
  innerContent: {flexGrow: 1, alignItems: 'center', justifyContent: 'center'},
  innerRow: {alignItems: 'center', justifyContent: 'center'},
  innerRowLandscape: {flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: wp(20)},
  innerRowLandscapeTablet: {gap: 50},
  brandingSection: {alignItems: 'center', marginBottom: wp(24)},
  brandingSectionLandscape: {marginBottom: 0},
  logoWrapDefault: {marginBottom: 16},
  logoWrapLandscapePhone: {marginBottom: 4},
  logoOuter: {width: wp(82), height: wp(82), borderRadius: wp(26), justifyContent: 'center', alignItems: 'center', borderWidth: 2, backgroundColor: c.overlay15, borderColor: c.overlay25},
  logoOuterLandscapePhone: {width: 50, height: 50, borderRadius: 16},
  logoOuterTablet: {width: 100, height: 100, borderRadius: 30},
  logoInner: {width: wp(60), height: wp(60), borderRadius: wp(18), justifyContent: 'center', alignItems: 'center', elevation: 8, shadowOffset: {width: 0, height: 4}, shadowOpacity: 0.3, shadowRadius: 8, backgroundColor: c.primaryLight, shadowColor: c.shadowColor},
  logoInnerLandscapePhone: {width: 36, height: 36, borderRadius: 12},
  logoInnerTablet: {width: 72, height: 72, borderRadius: 22},
  logoImageDefault: {width: 52, height: 52, borderRadius: 14},
  logoImageLandscapePhone: {width: 32, height: 32, borderRadius: 10},
  logoImageTablet: {width: 65, height: 65, borderRadius: 18},
  appName: {fontWeight: '800', letterSpacing: 2, fontSize: ms(18), color: c.textOnPrimary},
  appNameLandscapePhone: {fontSize: ms(16)},
  appNameTablet: {fontSize: ms(20)},
  appTagline: {marginTop: 4, letterSpacing: 0.5, fontSize: ms(10), color: c.textOnDark70},
  appTaglineLandscapePhone: {fontSize: ms(9)},
  appTaglineTablet: {fontSize: ms(11)},
  companyBadge: {flexDirection: 'row', alignItems: 'center', gap: wp(6), marginTop: wp(10), paddingHorizontal: wp(14), paddingVertical: wp(5), borderRadius: wp(14), backgroundColor: c.textOnDark12},
  companyBadgeText: {fontSize: ms(9), fontWeight: '600', letterSpacing: 0.3, color: c.textOnDark70},
  formCard: {borderRadius: wp(22), paddingHorizontal: wp(20), paddingVertical: wp(22), elevation: 20, shadowOffset: {width: 0, height: 10}, shadowOpacity: 0.15, shadowRadius: 30, backgroundColor: c.white, shadowColor: c.shadowColor},
  formCardLandscapePhone: {paddingVertical: 10, paddingHorizontal: 16, borderRadius: 14},
  formCardTablet: {paddingVertical: 24, paddingHorizontal: 28, borderRadius: 22},
  loginTypeBadge: {flexDirection: 'row', alignItems: 'center', alignSelf: 'flex-start', paddingHorizontal: wp(12), paddingVertical: wp(5), borderRadius: wp(20), gap: wp(6), marginBottom: wp(12), backgroundColor: c.primaryDark},
  loginTypeText: {fontSize: ms(9), fontWeight: '700', letterSpacing: 0.3, color: c.textOnPrimary},
  welcomeText: {fontWeight: '700', marginBottom: 4, fontSize: ms(15), color: c.textPrimary},
  welcomeTextLandscapePhone: {fontSize: ms(13), marginBottom: 1},
  welcomeTextTablet: {fontSize: ms(16)},
  welcomeSub: {marginBottom: wp(16), fontSize: ms(10), color: c.textTertiary},
  welcomeSubLandscapePhone: {fontSize: ms(9), marginBottom: 6},
  welcomeSubTablet: {fontSize: ms(11), marginBottom: 18},
  fieldWrapper: {marginBottom: wp(18)},
  fieldWrapperLandscapePhone: {marginBottom: 6},
  fieldWrapperTablet: {marginBottom: 14},
  fieldLabel: {fontSize: ms(10), fontWeight: '600', marginBottom: wp(6), letterSpacing: 0.3, color: c.textSecondary},
  fieldLabelLandscapePhone: {marginBottom: 3},
  inputRow: {flexDirection: 'row', alignItems: 'center', borderRadius: wp(12), borderWidth: 1.5, backgroundColor: c.surface, borderColor: c.border},
  inputRowTablet: {borderRadius: 14},
  inputIconBox: {width: wp(40), height: wp(40), justifyContent: 'center', alignItems: 'center', marginLeft: wp(4)},
  inputIconBoxLandscapePhone: {width: 30, height: 30},
  inputIconBoxTablet: {width: 42, height: 42},
  input: {flex: 1, paddingVertical: wp(12), paddingRight: wp(14), fontSize: ms(11), color: c.textPrimary},
  inputLandscapePhone: {fontSize: ms(10), paddingVertical: 6},
  inputTablet: {fontSize: ms(12), paddingVertical: 10},
  errorBox: {flexDirection: 'row', alignItems: 'center', gap: wp(6), paddingHorizontal: wp(12), paddingVertical: wp(8), borderRadius: wp(8), borderWidth: 1, marginBottom: wp(10), backgroundColor: c.errorSurface, borderColor: c.error},
  errorText: {fontSize: ms(9), fontWeight: '500', flex: 1, color: c.error || '#EF4444'},
  rememberRow: {flexDirection: 'row', alignItems: 'center', gap: wp(8), marginBottom: wp(10)},
  rememberRowLandscapePhone: {marginBottom: 4},
  checkbox: {width: wp(20), height: wp(20), borderRadius: wp(5), borderWidth: 1.5, justifyContent: 'center', alignItems: 'center'},
  rememberText: {fontSize: ms(10), fontWeight: '500', color: c.textSecondary},
  loginButton: {flexDirection: 'row', borderRadius: wp(12), paddingVertical: wp(14), alignItems: 'center', justifyContent: 'center', gap: wp(8), marginTop: wp(6), elevation: 6, shadowOffset: {width: 0, height: 4}, shadowOpacity: 0.3, shadowRadius: 8, backgroundColor: c.primary, shadowColor: c.primary},
  loginButtonLandscapePhone: {paddingVertical: 8, borderRadius: 10, marginTop: 2},
  loginButtonTablet: {paddingVertical: 14, borderRadius: 12, marginTop: 6},
  loginButtonLoading: {opacity: 0.7},
  loginButtonText: {fontWeight: '700', letterSpacing: 0.5, fontSize: ms(11), color: c.textOnPrimary},
  loginButtonTextLandscapePhone: {fontSize: ms(10)},
  loginButtonTextTablet: {fontSize: ms(12)},
  footer: {flexDirection: 'row', alignItems: 'center', marginTop: wp(14), gap: wp(12)},
  footerTablet: {marginTop: 16},
  footerDivider: {flex: 1, height: 1, backgroundColor: c.border},
  footerText: {fontSize: ms(9), fontWeight: '500', color: c.textPlaceholder},
});
