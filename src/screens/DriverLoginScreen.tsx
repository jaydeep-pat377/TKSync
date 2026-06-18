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
import MaterialIcons from 'react-native-vector-icons/MaterialIcons';
import type {NativeStackNavigationProp} from '@react-navigation/native-stack';
import {useTranslation} from 'react-i18next';
import {useTheme} from '../contexts/ThemeContext';
import {useAuth} from '../contexts/AuthContext';
import {ApiError} from '../services/api';
import {storage} from '../services/storage';
import {wp, ms} from '../utils/responsive';

type Props = {
  navigation: NativeStackNavigationProp<any>;
};

const REMEMBER_KEY = 'remember_driver';
const SAVED_TRUCK_KEY = 'saved_truck';
const SAVED_PIN_KEY = 'saved_pin';
const SAVED_COMPANY_CODE_KEY = 'saved_company_code';

export default function DriverLoginScreen({navigation}: Props) {
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
    <View style={[styles.container, {backgroundColor: c.primaryDark}]}>
      <StatusBar translucent backgroundColor="transparent" barStyle="light-content" />

      <View style={[styles.bgTop, {backgroundColor: c.primary}]} />
      <View style={[styles.bgBottom, {backgroundColor: c.primaryDark}]} />

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
            landscapeTablet && {gap: 50},
          ]}>
            {/* Branding */}
            <Animated.View
              style={[
                styles.brandingSection,
                isLandscape && {marginBottom: 0, width: brandingW},
                {opacity: fadeAnim},
              ]}>
              <View style={{marginBottom: landscapePhone ? 4 : 16}}>
                <View style={[
                  styles.logoOuter,
                  landscapePhone && {width: 50, height: 50, borderRadius: 16},
                  isTablet && {width: 100, height: 100, borderRadius: 30},
                  {backgroundColor: c.overlay15, borderColor: c.overlay25},
                ]}>
                  <View style={[
                    styles.logoInner,
                    landscapePhone && {width: 36, height: 36, borderRadius: 12},
                    isTablet && {width: 72, height: 72, borderRadius: 22},
                    {backgroundColor: c.primaryLight, shadowColor: c.shadowColor},
                  ]}>
                    <Image
                      source={require('../assets/images/logo.png')}
                      style={{width: landscapePhone ? 32 : isTablet ? 65 : 52, height: landscapePhone ? 32 : isTablet ? 65 : 52, borderRadius: landscapePhone ? 10 : isTablet ? 18 : 14}}
                    />
                  </View>
                </View>
              </View>
              <Text style={[
                styles.appName,
                landscapePhone && {fontSize: ms(22)},
                isTablet && {fontSize: ms(28)},
                {color: c.textOnPrimary},
              ]}>
                {t('app.name')}
              </Text>
              <Text style={[styles.appTagline, {color: c.textOnDark70}]}>
                {t('app.tagline')}
              </Text>
              <View style={[styles.companyBadge, {backgroundColor: c.textOnDark12}]}>
                <MaterialIcons name="check-circle" size={ms(12)} color={c.success} />
                <Text style={[styles.companyBadgeText, {color: c.textOnDark70}]}>{company?.company_name ?? ''}</Text>
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
              landscapePhone && {paddingVertical: 10, paddingHorizontal: 16, borderRadius: 14},
              isTablet && {paddingVertical: 24, paddingHorizontal: 28, borderRadius: 22},
              {backgroundColor: c.white, shadowColor: c.shadowColor},
            ]}>
              {/* Login type indicator — hide in landscape phone to save space */}
              {!landscapePhone && (
                <View style={[styles.loginTypeBadge, {backgroundColor: c.primaryDark}]}>
                  <MaterialIcons name="local-shipping" size={ms(14)} color={c.textOnPrimary} />
                  <Text style={[styles.loginTypeText, {color: c.textOnPrimary}]}>
                    {t('driverLogin.badge')}
                  </Text>
                </View>
              )}

              <Text style={[
                styles.welcomeText,
                landscapePhone && {fontSize: ms(18), marginBottom: 1},
                isTablet && {fontSize: ms(20)},
                {color: c.textPrimary},
              ]}>
                {t('driverLogin.title')}
              </Text>
              <Text style={[
                styles.welcomeSub,
                landscapePhone && {marginBottom: 6, fontSize: ms(12)},
                isTablet && {marginBottom: 18},
                {color: c.textTertiary},
              ]}>
                {t('driverLogin.subtitle')}
              </Text>

              {/* Truck Number */}
              <View style={{marginBottom: landscapePhone ? 6 : isTablet ? 14 : wp(18)}}>
                <Text style={[styles.fieldLabel, landscapePhone && {marginBottom: 3}, {color: c.textSecondary}]}>
                  {t('driverLogin.truckNumber')}
                </Text>
                <View style={[
                  styles.inputRow,
                  isTablet && {borderRadius: 14},
                  {backgroundColor: c.surface, borderColor: c.border},
                ]}>
                  <View style={[
                    styles.inputIconBox,
                    landscapePhone && {width: 30, height: 30},
                    isTablet && {width: 42, height: 42},
                  ]}>
                    <MaterialIcons name="local-shipping" size={isTablet ? 22 : landscapePhone ? 16 : 20} color={c.primaryLight} />
                  </View>
                  <TextInput
                    style={[
                      styles.input,
                      landscapePhone && {paddingVertical: 6, fontSize: ms(13)},
                      isTablet && {paddingVertical: 10, fontSize: ms(14)},
                      {color: c.textPrimary},
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
              <View style={{marginBottom: landscapePhone ? 6 : isTablet ? 14 : wp(18)}}>
                <Text style={[styles.fieldLabel, landscapePhone && {marginBottom: 3}, {color: c.textSecondary}]}>
                  {t('driverLogin.driverPin')}
                </Text>
                <View style={[
                  styles.inputRow,
                  isTablet && {borderRadius: 14},
                  {backgroundColor: c.surface, borderColor: c.border},
                ]}>
                  <View style={[
                    styles.inputIconBox,
                    landscapePhone && {width: 30, height: 30},
                    isTablet && {width: 42, height: 42},
                  ]}>
                    <MaterialIcons name="badge" size={isTablet ? 22 : landscapePhone ? 16 : 20} color={c.primaryLight} />
                  </View>
                  <TextInput
                    style={[
                      styles.input,
                      landscapePhone && {paddingVertical: 6, fontSize: ms(13)},
                      isTablet && {paddingVertical: 10, fontSize: ms(14)},
                      {color: c.textPrimary},
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
                <View style={[styles.errorBox, {backgroundColor: c.errorSurface, borderColor: c.error}]}>
                  <MaterialIcons name="error-outline" size={ms(14)} color={c.error} />
                  <Text style={[styles.errorText, {color: c.error || '#EF4444'}]}>{error}</Text>
                </View>
              ) : null}

              {/* Remember Me */}
              <TouchableOpacity
                style={[styles.rememberRow, landscapePhone && {marginBottom: 4}]}
                onPress={() => setRememberMe(!rememberMe)}
                activeOpacity={0.7}>
                <View style={[
                  styles.checkbox,
                  {borderColor: rememberMe ? c.primary : c.border},
                  rememberMe && {backgroundColor: c.primary},
                ]}>
                  {rememberMe && <MaterialIcons name="check" size={ms(12)} color={c.textOnPrimary} />}
                </View>
                <Text style={[styles.rememberText, {color: c.textSecondary}]}>
                  {t('driverLogin.rememberMe', 'Remember Me')}
                </Text>
              </TouchableOpacity>

              {/* Sign In Button */}
              <TouchableOpacity
                style={[
                  styles.loginButton,
                  landscapePhone && {paddingVertical: 8, borderRadius: 10, marginTop: 2},
                  isTablet && {paddingVertical: 14, borderRadius: 12, marginTop: 6},
                  {backgroundColor: c.primary, shadowColor: c.primary},
                  loading && {opacity: 0.7},
                ]}
                onPress={handleLogin}
                activeOpacity={0.85}
                disabled={loading}>
                <Text style={[styles.loginButtonText, landscapePhone && {fontSize: ms(13)}, isTablet && {fontSize: ms(14)}, {color: c.textOnPrimary}]}>
                  {loading ? t('driverLogin.signingIn', 'Signing In...') : t('driverLogin.signIn')}
                </Text>
                {!loading && <MaterialIcons name="arrow-forward" size={isTablet ? 22 : landscapePhone ? 18 : 20} color={c.textOnPrimary} />}
              </TouchableOpacity>

              {/* Footer — hide in landscape phone to save space */}
              {!landscapePhone && (
                <View style={[styles.footer, isTablet && {marginTop: 16}]}>
                  <View style={[styles.footerDivider, {backgroundColor: c.border}]} />
                  <Text style={[styles.footerText, {color: c.textPlaceholder}]}>{t('app.poweredBy')}</Text>
                  <View style={[styles.footerDivider, {backgroundColor: c.border}]} />
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

const styles = StyleSheet.create({
  container: {flex: 1, overflow: 'hidden'},
  bgTop: {position: 'absolute', top: 0, left: -5, right: -5, height: '65%', borderBottomLeftRadius: 40, borderBottomRightRadius: 40},
  bgBottom: {position: 'absolute', bottom: 0, left: -5, right: -5, height: '50%'},
  content: {flex: 1},
  innerContent: {flexGrow: 1, alignItems: 'center', justifyContent: 'center'},
  innerRow: {alignItems: 'center', justifyContent: 'center'},
  innerRowLandscape: {flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: wp(20)},
  brandingSection: {alignItems: 'center', marginBottom: wp(24)},
  logoOuter: {width: wp(82), height: wp(82), borderRadius: wp(26), justifyContent: 'center', alignItems: 'center', borderWidth: 2},
  logoInner: {width: wp(60), height: wp(60), borderRadius: wp(18), justifyContent: 'center', alignItems: 'center', elevation: 8, shadowOffset: {width: 0, height: 4}, shadowOpacity: 0.3, shadowRadius: 8},
  appName: {fontSize: ms(30), fontWeight: '800', letterSpacing: 2},
  appTagline: {fontSize: ms(14), marginTop: 4, letterSpacing: 0.5},
  companyBadge: {flexDirection: 'row', alignItems: 'center', gap: wp(6), marginTop: wp(10), paddingHorizontal: wp(14), paddingVertical: wp(5), borderRadius: wp(14)},
  companyBadgeText: {fontSize: ms(12), fontWeight: '600', letterSpacing: 0.3},
  formCard: {borderRadius: wp(22), paddingHorizontal: wp(20), paddingVertical: wp(22), elevation: 20, shadowOffset: {width: 0, height: 10}, shadowOpacity: 0.15, shadowRadius: 30},
  loginTypeBadge: {flexDirection: 'row', alignItems: 'center', alignSelf: 'flex-start', paddingHorizontal: wp(12), paddingVertical: wp(5), borderRadius: wp(20), gap: wp(6), marginBottom: wp(12)},
  loginTypeText: {fontSize: ms(12), fontWeight: '700', letterSpacing: 0.3},
  welcomeText: {fontSize: ms(24), fontWeight: '700', marginBottom: 4},
  welcomeSub: {fontSize: ms(14), marginBottom: wp(16)},
  fieldLabel: {fontSize: ms(13), fontWeight: '600', marginBottom: wp(6), letterSpacing: 0.3},
  inputRow: {flexDirection: 'row', alignItems: 'center', borderRadius: wp(12), borderWidth: 1.5},
  inputIconBox: {width: wp(40), height: wp(40), justifyContent: 'center', alignItems: 'center', marginLeft: wp(4)},
  input: {flex: 1, paddingVertical: wp(12), fontSize: ms(15), paddingRight: wp(14)},
  errorBox: {flexDirection: 'row', alignItems: 'center', gap: wp(6), paddingHorizontal: wp(12), paddingVertical: wp(8), borderRadius: wp(8), borderWidth: 1, marginBottom: wp(10)},
  errorText: {fontSize: ms(12), fontWeight: '500', flex: 1},
  rememberRow: {flexDirection: 'row', alignItems: 'center', gap: wp(8), marginBottom: wp(10)},
  checkbox: {width: wp(20), height: wp(20), borderRadius: wp(5), borderWidth: 1.5, justifyContent: 'center', alignItems: 'center'},
  rememberText: {fontSize: ms(13), fontWeight: '500'},
  loginButton: {flexDirection: 'row', borderRadius: wp(12), paddingVertical: wp(14), alignItems: 'center', justifyContent: 'center', gap: wp(8), marginTop: wp(6), elevation: 6, shadowOffset: {width: 0, height: 4}, shadowOpacity: 0.3, shadowRadius: 8},
  loginButtonText: {fontSize: ms(16), fontWeight: '700', letterSpacing: 0.5},
  footer: {flexDirection: 'row', alignItems: 'center', marginTop: wp(14), gap: wp(12)},
  footerDivider: {flex: 1, height: 1},
  footerText: {fontSize: ms(12), fontWeight: '500'},
});
