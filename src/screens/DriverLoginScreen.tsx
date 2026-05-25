import React, {useState, useRef, useEffect} from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  StatusBar,
  KeyboardAvoidingView,
  Platform,
  useWindowDimensions,
  Animated,
} from 'react-native';
import {useSafeAreaInsets} from 'react-native-safe-area-context';
import MaterialIcons from 'react-native-vector-icons/MaterialIcons';
import type {NativeStackNavigationProp} from '@react-navigation/native-stack';
import {useTranslation} from 'react-i18next';
import {Colors} from '../constants/colors';

type Props = {
  navigation: NativeStackNavigationProp<any>;
};

export default function DriverLoginScreen({navigation}: Props) {
  const [truckNumber, setTruckNumber] = useState('');
  const [driverPin, setDriverPin] = useState('');
  const {t} = useTranslation();
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
    <View style={styles.container}>
      <StatusBar
        translucent
        backgroundColor="transparent"
        barStyle="light-content"
      />

      <View style={styles.bgTop} />
      <View style={styles.bgBottom} />

      <KeyboardAvoidingView
        style={styles.content}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <View
          style={[
            styles.innerContent,
            {paddingTop: insets.top + 20},
            isLandscape && styles.innerContentLandscape,
          ]}>
          {/* Branding */}
          <Animated.View
            style={[
              styles.brandingSection,
              isLandscape && isTablet && styles.brandingSectionLandscape,
              {opacity: fadeAnim},
            ]}>
            <View style={styles.logoContainer}>
              <View style={[styles.logoOuter, isTablet && styles.logoOuterTablet]}>
                <View style={[styles.logoInner, isTablet && styles.logoInnerTablet]}>
                  <MaterialIcons
                    name="local-shipping"
                    size={isTablet ? 40 : 32}
                    color={Colors.textOnPrimary}
                  />
                </View>
              </View>
            </View>
            <Text style={[styles.appName, isTablet && styles.appNameTablet]}>
              {t('app.name')}
            </Text>
            <Text style={[styles.appTagline, isTablet && styles.appTaglineTablet]}>
              {t('app.tagline')}
            </Text>
            <View style={styles.companyBadge}>
              <MaterialIcons name="check-circle" size={12} color={Colors.success} />
              <Text style={styles.companyBadgeText}>ACME Ready-Mix</Text>
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
            <View style={[styles.formCard, isTablet && styles.formCardTablet]}>
              {/* Login type indicator */}
              <View style={styles.loginTypeBadge}>
                <MaterialIcons
                  name="local-shipping"
                  size={14}
                  color={Colors.textOnPrimary}
                />
                <Text style={styles.loginTypeText}>
                  {t('driverLogin.badge')}
                </Text>
              </View>

              <Text
                style={[
                  styles.welcomeText,
                  isTablet && styles.welcomeTextTablet,
                ]}>
                {t('driverLogin.title')}
              </Text>
              <Text
                style={[
                  styles.welcomeSub,
                  isTablet && styles.welcomeSubTablet,
                ]}>
                {t('driverLogin.subtitle')}
              </Text>

              {/* Truck Number */}
              <View style={styles.fieldGroup}>
                <Text
                  style={[
                    styles.fieldLabel,
                    isTablet && styles.fieldLabelTablet,
                  ]}>
                  {t('driverLogin.truckNumber')}
                </Text>
                <View
                  style={[
                    styles.inputRow,
                    isTablet && styles.inputRowTablet,
                  ]}>
                  <View
                    style={[
                      styles.inputIconBox,
                      isTablet && styles.inputIconBoxTablet,
                    ]}>
                    <MaterialIcons
                      name="local-shipping"
                      size={isTablet ? 24 : 20}
                      color={Colors.primaryLight}
                    />
                  </View>
                  <TextInput
                    style={[styles.input, isTablet && styles.inputTablet]}
                    placeholder={t('driverLogin.truckNumberPlaceholder')}
                    placeholderTextColor={Colors.textPlaceholder}
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
                  ]}>
                  {t('driverLogin.driverPin')}
                </Text>
                <View
                  style={[
                    styles.inputRow,
                    isTablet && styles.inputRowTablet,
                  ]}>
                  <View
                    style={[
                      styles.inputIconBox,
                      isTablet && styles.inputIconBoxTablet,
                    ]}>
                    <MaterialIcons
                      name="badge"
                      size={isTablet ? 24 : 20}
                      color={Colors.primaryLight}
                    />
                  </View>
                  <TextInput
                    style={[styles.input, isTablet && styles.inputTablet]}
                    placeholder={t('driverLogin.driverPinPlaceholder')}
                    placeholderTextColor={Colors.textPlaceholder}
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
                ]}
                onPress={handleLogin}
                activeOpacity={0.85}>
                <Text
                  style={[
                    styles.loginButtonText,
                    isTablet && styles.loginButtonTextTablet,
                  ]}>
                  {t('driverLogin.signIn')}
                </Text>
                <MaterialIcons
                  name="arrow-forward"
                  size={isTablet ? 24 : 20}
                  color={Colors.textOnPrimary}
                />
              </TouchableOpacity>

              {/* Switch to Company Login */}
              <TouchableOpacity
                style={styles.switchRow}
                onPress={() => navigation.navigate('CompanyLogin')}
                activeOpacity={0.6}>
                <Text style={styles.switchText}>
                  {t('driverLogin.switchCompany')}
                </Text>
                <Text style={styles.switchLink}>
                  {t('driverLogin.companyLogin')}
                </Text>
              </TouchableOpacity>

              {/* Footer */}
              <View style={styles.footer}>
                <View style={styles.footerDivider} />
                <Text style={styles.footerText}>{t('app.poweredBy')}</Text>
                <View style={styles.footerDivider} />
              </View>
            </View>
          </Animated.View>
        </View>
      </KeyboardAvoidingView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: Colors.primaryDark,
  },
  bgTop: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    height: '55%',
    backgroundColor: Colors.primary,
    borderBottomLeftRadius: 40,
    borderBottomRightRadius: 40,
  },
  bgBottom: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    height: '50%',
    backgroundColor: Colors.primaryDark,
  },
  content: {flex: 1},
  innerContent: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 24,
  },
  innerContentLandscape: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 40,
  },
  brandingSection: {alignItems: 'center', marginBottom: 32},
  brandingSectionLandscape: {marginBottom: 0, flex: 1, maxWidth: 320},
  logoContainer: {marginBottom: 16},
  logoOuter: {
    width: 88,
    height: 88,
    borderRadius: 28,
    backgroundColor: Colors.overlay15,
    justifyContent: 'center',
    alignItems: 'center',
    borderWidth: 2,
    borderColor: Colors.overlay25,
  },
  logoOuterTablet: {width: 100, height: 100, borderRadius: 32},
  logoInner: {
    width: 64,
    height: 64,
    borderRadius: 20,
    backgroundColor: Colors.primaryLight,
    justifyContent: 'center',
    alignItems: 'center',
    elevation: 8,
    shadowColor: Colors.shadowColor,
    shadowOffset: {width: 0, height: 4},
    shadowOpacity: 0.3,
    shadowRadius: 8,
  },
  logoInnerTablet: {width: 72, height: 72, borderRadius: 22},
  appName: {
    fontSize: 32,
    fontWeight: '800',
    color: Colors.textOnPrimary,
    letterSpacing: 2,
  },
  appNameTablet: {fontSize: 38},
  appTagline: {
    fontSize: 14,
    color: Colors.textOnDark70,
    marginTop: 4,
    letterSpacing: 0.5,
  },
  appTaglineTablet: {fontSize: 17},
  companyBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginTop: 12,
    backgroundColor: Colors.textOnDark12,
    paddingHorizontal: 14,
    paddingVertical: 5,
    borderRadius: 14,
  },
  companyBadgeText: {
    color: Colors.textOnDark70,
    fontSize: 12,
    fontWeight: '600',
    letterSpacing: 0.3,
  },
  formWrapper: {width: '100%', maxWidth: 480},
  formWrapperLandscape: {flex: 1, maxWidth: 460},
  formCard: {
    backgroundColor: Colors.white,
    borderRadius: 24,
    paddingHorizontal: 28,
    paddingVertical: 32,
    elevation: 20,
    shadowColor: Colors.shadowColor,
    shadowOffset: {width: 0, height: 10},
    shadowOpacity: 0.15,
    shadowRadius: 30,
  },
  formCardTablet: {paddingHorizontal: 36, paddingVertical: 40},
  loginTypeBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'flex-start',
    backgroundColor: Colors.primaryDark,
    paddingHorizontal: 12,
    paddingVertical: 5,
    borderRadius: 20,
    gap: 6,
    marginBottom: 16,
  },
  loginTypeText: {
    fontSize: 12,
    fontWeight: '700',
    color: Colors.textOnPrimary,
    letterSpacing: 0.3,
  },
  welcomeText: {
    fontSize: 26,
    fontWeight: '700',
    color: Colors.textPrimary,
    marginBottom: 4,
  },
  welcomeTextTablet: {fontSize: 30},
  welcomeSub: {fontSize: 14, color: Colors.textTertiary, marginBottom: 24},
  welcomeSubTablet: {fontSize: 16},
  fieldGroup: {marginBottom: 18},
  fieldLabel: {
    fontSize: 13,
    fontWeight: '600',
    color: Colors.textSecondary,
    marginBottom: 8,
    letterSpacing: 0.3,
  },
  fieldLabelTablet: {fontSize: 15, marginBottom: 10},
  inputRow: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: Colors.surface,
    borderRadius: 14,
    borderWidth: 1.5,
    borderColor: Colors.border,
  },
  inputRowTablet: {borderRadius: 16},
  inputIconBox: {
    width: 44,
    height: 44,
    justifyContent: 'center',
    alignItems: 'center',
    marginLeft: 4,
  },
  inputIconBoxTablet: {width: 52, height: 52},
  input: {
    flex: 1,
    paddingVertical: 14,
    fontSize: 15,
    color: Colors.textPrimary,
    paddingRight: 14,
  },
  inputTablet: {paddingVertical: 16, fontSize: 17},
  loginButton: {
    flexDirection: 'row',
    backgroundColor: Colors.primary,
    borderRadius: 14,
    paddingVertical: 16,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    marginTop: 8,
    elevation: 6,
    shadowColor: Colors.primary,
    shadowOffset: {width: 0, height: 4},
    shadowOpacity: 0.3,
    shadowRadius: 8,
  },
  loginButtonTablet: {paddingVertical: 18, borderRadius: 16, marginTop: 12},
  loginButtonText: {
    color: Colors.textOnPrimary,
    fontSize: 16,
    fontWeight: '700',
    letterSpacing: 0.5,
  },
  loginButtonTextTablet: {fontSize: 18},
  switchRow: {
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    marginTop: 18,
    gap: 4,
  },
  switchText: {fontSize: 13, color: Colors.textMuted},
  switchLink: {fontSize: 13, fontWeight: '700', color: Colors.primary},
  footer: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 20,
    gap: 12,
  },
  footerDivider: {flex: 1, height: 1, backgroundColor: Colors.border},
  footerText: {color: Colors.textPlaceholder, fontSize: 12, fontWeight: '500'},
});
