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
  useWindowDimensions,
  Animated,
} from 'react-native';
import {useSafeAreaInsets} from 'react-native-safe-area-context';
import MaterialIcons from 'react-native-vector-icons/MaterialIcons';
import type {NativeStackNavigationProp} from '@react-navigation/native-stack';
import {useTranslation} from 'react-i18next';
import {useTheme} from '../contexts/ThemeContext';

type Props = {
  navigation: NativeStackNavigationProp<any>;
};

export default function DriverLoginScreen({navigation}: Props) {
  const [truckNumber, setTruckNumber] = useState('');
  const [driverPin, setDriverPin] = useState('');
  const {t} = useTranslation();
  const {c} = useTheme();
  const insets = useSafeAreaInsets();
  const {width, height} = useWindowDimensions();
  const isTablet = width > 600;
  const isLandscape = width > height;

  const fadeAnim = useRef(new Animated.Value(0)).current;
  const slideAnim = useRef(new Animated.Value(30)).current;

  useEffect(() => {
    Animated.parallel([
      Animated.timing(fadeAnim, {
        toValue: 1,
        duration: 600,
        useNativeDriver: true,
      }),
      Animated.spring(slideAnim, {
        toValue: 0,
        friction: 8,
        tension: 50,
        useNativeDriver: true,
      }),
    ]).start();
  }, [fadeAnim, slideAnim]);

  const handleLogin = () => {
    navigation.replace('Dashboard');
  };

  return (
    <View style={[styles.container, {backgroundColor: c.primaryDark}]}>
      <StatusBar
        translucent
        backgroundColor="transparent"
        barStyle="light-content"
      />

      <View style={[styles.bgTop, {backgroundColor: c.primary}]} />
      <View style={[styles.bgBottom, {backgroundColor: c.primaryDark}]} />

      <KeyboardAvoidingView
        style={styles.content}
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
        <ScrollView
          contentContainerStyle={[
            styles.innerContent,
            {paddingTop: insets.top + 20},
            isLandscape && styles.innerContentLandscape,
          ]}
          showsVerticalScrollIndicator={false}
          keyboardShouldPersistTaps="handled"
          bounces={false}>
          {/* Branding */}
          <Animated.View
            style={[
              styles.brandingSection,
              isLandscape && isTablet && styles.brandingSectionLandscape,
              {opacity: fadeAnim},
            ]}>
            <View style={styles.logoContainer}>
              <View style={[styles.logoOuter, isTablet && styles.logoOuterTablet, {backgroundColor: c.overlay15, borderColor: c.overlay25}]}>
                <View style={[styles.logoInner, isTablet && styles.logoInnerTablet, {backgroundColor: c.primaryLight, shadowColor: c.shadowColor}]}>
                  <MaterialIcons
                    name="local-shipping"
                    size={isTablet ? 40 : 32}
                    color={c.textOnPrimary}
                  />
                </View>
              </View>
            </View>
            <Text style={[styles.appName, isTablet && styles.appNameTablet, {color: c.textOnPrimary}]}>
              {t('app.name')}
            </Text>
            <Text style={[styles.appTagline, isTablet && styles.appTaglineTablet, {color: c.textOnDark70}]}>
              {t('app.tagline')}
            </Text>
            <View style={[styles.companyBadge, {backgroundColor: c.textOnDark12}]}>
              <MaterialIcons name="check-circle" size={12} color={c.success} />
              <Text style={[styles.companyBadgeText, {color: c.textOnDark70}]}>ACME Ready-Mix</Text>
            </View>
          </Animated.View>

          {/* Form Card */}
          <Animated.View
            style={[
              styles.formWrapper,
              isLandscape && isTablet && styles.formWrapperLandscape,
              {
                opacity: fadeAnim,
                transform: [{translateY: slideAnim}],
              },
            ]}>
            <View style={[styles.formCard, isTablet && styles.formCardTablet, {backgroundColor: c.white, shadowColor: c.shadowColor}]}>
              {/* Login type indicator */}
              <View style={[styles.loginTypeBadge, {backgroundColor: c.primaryDark}]}>
                <MaterialIcons
                  name="local-shipping"
                  size={14}
                  color={c.textOnPrimary}
                />
                <Text style={[styles.loginTypeText, {color: c.textOnPrimary}]}>
                  {t('driverLogin.badge')}
                </Text>
              </View>

              <Text
                style={[
                  styles.welcomeText,
                  isTablet && styles.welcomeTextTablet,
                  {color: c.textPrimary},
                ]}>
                {t('driverLogin.title')}
              </Text>
              <Text
                style={[
                  styles.welcomeSub,
                  isTablet && styles.welcomeSubTablet,
                  {color: c.textTertiary},
                ]}>
                {t('driverLogin.subtitle')}
              </Text>

              {/* Truck Number */}
              <View style={styles.fieldGroup}>
                <Text
                  style={[
                    styles.fieldLabel,
                    isTablet && styles.fieldLabelTablet,
                    {color: c.textSecondary},
                  ]}>
                  {t('driverLogin.truckNumber')}
                </Text>
                <View
                  style={[
                    styles.inputRow,
                    isTablet && styles.inputRowTablet,
                    {backgroundColor: c.surface, borderColor: c.border},
                  ]}>
                  <View
                    style={[
                      styles.inputIconBox,
                      isTablet && styles.inputIconBoxTablet,
                    ]}>
                    <MaterialIcons
                      name="local-shipping"
                      size={isTablet ? 24 : 20}
                      color={c.primaryLight}
                    />
                  </View>
                  <TextInput
                    style={[styles.input, isTablet && styles.inputTablet, {color: c.textPrimary}]}
                    placeholder={t('driverLogin.truckNumberPlaceholder')}
                    placeholderTextColor={c.textPlaceholder}
                    value={truckNumber}
                    onChangeText={setTruckNumber}
                    keyboardType="number-pad"
                  />
                </View>
              </View>

              {/* Driver PIN */}
              <View style={styles.fieldGroup}>
                <Text
                  style={[
                    styles.fieldLabel,
                    isTablet && styles.fieldLabelTablet,
                    {color: c.textSecondary},
                  ]}>
                  {t('driverLogin.driverPin')}
                </Text>
                <View
                  style={[
                    styles.inputRow,
                    isTablet && styles.inputRowTablet,
                    {backgroundColor: c.surface, borderColor: c.border},
                  ]}>
                  <View
                    style={[
                      styles.inputIconBox,
                      isTablet && styles.inputIconBoxTablet,
                    ]}>
                    <MaterialIcons
                      name="badge"
                      size={isTablet ? 24 : 20}
                      color={c.primaryLight}
                    />
                  </View>
                  <TextInput
                    style={[styles.input, isTablet && styles.inputTablet, {color: c.textPrimary}]}
                    placeholder={t('driverLogin.driverPinPlaceholder')}
                    placeholderTextColor={c.textPlaceholder}
                    value={driverPin}
                    onChangeText={setDriverPin}
                    autoCapitalize="none"
                  />
                </View>
              </View>

              {/* Sign In Button */}
              <TouchableOpacity
                style={[
                  styles.loginButton,
                  isTablet && styles.loginButtonTablet,
                  {backgroundColor: c.primary, shadowColor: c.primary},
                ]}
                onPress={handleLogin}
                activeOpacity={0.85}>
                <Text
                  style={[
                    styles.loginButtonText,
                    isTablet && styles.loginButtonTextTablet,
                    {color: c.textOnPrimary},
                  ]}>
                  {t('driverLogin.signIn')}
                </Text>
                <MaterialIcons
                  name="arrow-forward"
                  size={isTablet ? 24 : 20}
                  color={c.textOnPrimary}
                />
              </TouchableOpacity>

              {/* Switch to Company Login */}
              <TouchableOpacity
                style={styles.switchRow}
                onPress={() => navigation.navigate('CompanyLogin')}
                activeOpacity={0.6}>
                <Text style={[styles.switchText, {color: c.textMuted}]}>
                  {t('driverLogin.switchCompany')}
                </Text>
                <Text style={[styles.switchLink, {color: c.primary}]}>
                  {t('driverLogin.companyLogin')}
                </Text>
              </TouchableOpacity>

              {/* Footer */}
              <View style={styles.footer}>
                <View style={[styles.footerDivider, {backgroundColor: c.border}]} />
                <Text style={[styles.footerText, {color: c.textPlaceholder}]}>{t('app.poweredBy')}</Text>
                <View style={[styles.footerDivider, {backgroundColor: c.border}]} />
              </View>
            </View>
          </Animated.View>
        </ScrollView>
      </KeyboardAvoidingView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {flex: 1},
  bgTop: {position: 'absolute', top: 0, left: 0, right: 0, height: '55%', borderBottomLeftRadius: 40, borderBottomRightRadius: 40},
  bgBottom: {position: 'absolute', bottom: 0, left: 0, right: 0, height: '50%'},
  content: {flex: 1},
  innerContent: {flexGrow: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 24, paddingBottom: 30},
  innerContentLandscape: {flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 40},
  brandingSection: {alignItems: 'center', marginBottom: 32},
  brandingSectionLandscape: {marginBottom: 0, flex: 1, maxWidth: 320},
  logoContainer: {marginBottom: 16},
  logoOuter: {width: 88, height: 88, borderRadius: 28, justifyContent: 'center', alignItems: 'center', borderWidth: 2},
  logoOuterTablet: {width: 100, height: 100, borderRadius: 32},
  logoInner: {width: 64, height: 64, borderRadius: 20, justifyContent: 'center', alignItems: 'center', elevation: 8, shadowOffset: {width: 0, height: 4}, shadowOpacity: 0.3, shadowRadius: 8},
  logoInnerTablet: {width: 72, height: 72, borderRadius: 22},
  appName: {fontSize: 32, fontWeight: '800', letterSpacing: 2},
  appNameTablet: {fontSize: 38},
  appTagline: {fontSize: 14, marginTop: 4, letterSpacing: 0.5},
  appTaglineTablet: {fontSize: 17},
  companyBadge: {flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 12, paddingHorizontal: 14, paddingVertical: 5, borderRadius: 14},
  companyBadgeText: {fontSize: 12, fontWeight: '600', letterSpacing: 0.3},
  formWrapper: {width: '100%', maxWidth: 480},
  formWrapperLandscape: {flex: 1, maxWidth: 460},
  formCard: {borderRadius: 24, paddingHorizontal: 28, paddingVertical: 32, elevation: 20, shadowOffset: {width: 0, height: 10}, shadowOpacity: 0.15, shadowRadius: 30},
  formCardTablet: {paddingHorizontal: 36, paddingVertical: 40},
  loginTypeBadge: {flexDirection: 'row', alignItems: 'center', alignSelf: 'flex-start', paddingHorizontal: 12, paddingVertical: 5, borderRadius: 20, gap: 6, marginBottom: 16},
  loginTypeText: {fontSize: 12, fontWeight: '700', letterSpacing: 0.3},
  welcomeText: {fontSize: 26, fontWeight: '700', marginBottom: 4},
  welcomeTextTablet: {fontSize: 30},
  welcomeSub: {fontSize: 14, marginBottom: 24},
  welcomeSubTablet: {fontSize: 16},
  fieldGroup: {marginBottom: 18},
  fieldLabel: {fontSize: 13, fontWeight: '600', marginBottom: 8, letterSpacing: 0.3},
  fieldLabelTablet: {fontSize: 15, marginBottom: 10},
  inputRow: {flexDirection: 'row', alignItems: 'center', borderRadius: 14, borderWidth: 1.5},
  inputRowTablet: {borderRadius: 16},
  inputIconBox: {width: 44, height: 44, justifyContent: 'center', alignItems: 'center', marginLeft: 4},
  inputIconBoxTablet: {width: 52, height: 52},
  input: {flex: 1, paddingVertical: 14, fontSize: 15, paddingRight: 14},
  inputTablet: {paddingVertical: 16, fontSize: 17},
  loginButton: {flexDirection: 'row', borderRadius: 14, paddingVertical: 16, alignItems: 'center', justifyContent: 'center', gap: 8, marginTop: 8, elevation: 6, shadowOffset: {width: 0, height: 4}, shadowOpacity: 0.3, shadowRadius: 8},
  loginButtonTablet: {paddingVertical: 18, borderRadius: 16, marginTop: 12},
  loginButtonText: {fontSize: 16, fontWeight: '700', letterSpacing: 0.5},
  loginButtonTextTablet: {fontSize: 18},
  switchRow: {flexDirection: 'row', justifyContent: 'center', alignItems: 'center', marginTop: 18, gap: 4},
  switchText: {fontSize: 13},
  switchLink: {fontSize: 13, fontWeight: '700'},
  footer: {flexDirection: 'row', alignItems: 'center', marginTop: 20, gap: 12},
  footerDivider: {flex: 1, height: 1},
  footerText: {fontSize: 12, fontWeight: '500'},
});
