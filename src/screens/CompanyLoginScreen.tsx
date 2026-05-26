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
import {wp, ms} from '../utils/responsive';

type Props = {
  navigation: NativeStackNavigationProp<any>;
};

export default function CompanyLoginScreen({navigation}: Props) {
  const [companyCode, setCompanyCode] = useState('');
  const {t} = useTranslation();
  const {c} = useTheme();
  const insets = useSafeAreaInsets();
  const {width, height} = useWindowDimensions();
  const isTablet = Math.min(width, height) > 600;
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

  const handleConnect = () => {
    navigation.navigate('DriverLogin');
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
            {paddingTop: insets.top + wp(20)},
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
                    name="sync"
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
              <View style={[styles.loginTypeBadge, {backgroundColor: c.primarySurface, borderColor: c.primaryBorder}]}>
                <MaterialIcons
                  name="business"
                  size={ms(14)}
                  color={c.primary}
                />
                <Text style={[styles.loginTypeText, {color: c.primary}]}>
                  {t('companyLogin.badge')}
                </Text>
              </View>

              <Text
                style={[
                  styles.welcomeText,
                  isTablet && styles.welcomeTextTablet,
                  {color: c.textPrimary},
                ]}>
                {t('companyLogin.title')}
              </Text>
              <Text
                style={[
                  styles.welcomeSub,
                  isTablet && styles.welcomeSubTablet,
                  {color: c.textTertiary},
                ]}>
                {t('companyLogin.subtitle')}
              </Text>

              {/* Company Code */}
              <View style={styles.fieldGroup}>
                <Text
                  style={[
                    styles.fieldLabel,
                    isTablet && styles.fieldLabelTablet,
                    {color: c.textSecondary},
                  ]}>
                  {t('companyLogin.companyCode')}
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
                      name="vpn-key"
                      size={isTablet ? 24 : 20}
                      color={c.primaryLight}
                    />
                  </View>
                  <TextInput
                    style={[styles.input, isTablet && styles.inputTablet, {color: c.textPrimary}]}
                    placeholder={t('companyLogin.companyCodePlaceholder')}
                    placeholderTextColor={c.textPlaceholder}
                    value={companyCode}
                    onChangeText={setCompanyCode}
                    autoCapitalize="characters"
                  />
                </View>
              </View>



              {/* Connect Button */}
              <TouchableOpacity
                style={[
                  styles.connectButton,
                  isTablet && styles.connectButtonTablet,
                  {backgroundColor: c.primary, shadowColor: c.primary},
                ]}
                onPress={handleConnect}
                activeOpacity={0.85}>
                <Text
                  style={[
                    styles.connectButtonText,
                    isTablet && styles.connectButtonTextTablet,
                    {color: c.textOnPrimary},
                  ]}>
                  {t('companyLogin.connect')}
                </Text>
                <MaterialIcons
                  name="arrow-forward"
                  size={isTablet ? 24 : 20}
                  color={c.textOnPrimary}
                />
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
  container: {flex: 1, overflow: 'hidden'},
  bgTop: {position: 'absolute', top: 0, left: -5, right: -5, height: '60%', borderBottomLeftRadius: 40, borderBottomRightRadius: 40},
  bgBottom: {position: 'absolute', bottom: 0, left: -5, right: -5, height: '55%'},
  content: {flex: 1},
  innerContent: {flexGrow: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: wp(24), paddingBottom: wp(30)},
  innerContentLandscape: {flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: wp(40)},
  brandingSection: {alignItems: 'center', marginBottom: wp(32)},
  brandingSectionLandscape: {marginBottom: 0, flex: 1, maxWidth: wp(320)},
  logoContainer: {marginBottom: 16},
  logoOuter: {width: wp(88), height: wp(88), borderRadius: wp(28), justifyContent: 'center', alignItems: 'center', borderWidth: 2},
  logoOuterTablet: {width: wp(88), height: wp(88), borderRadius: wp(28)},
  logoInner: {width: wp(64), height: wp(64), borderRadius: wp(20), justifyContent: 'center', alignItems: 'center', elevation: 8, shadowOffset: {width: 0, height: 4}, shadowOpacity: 0.3, shadowRadius: 8},
  logoInnerTablet: {width: wp(64), height: wp(64), borderRadius: wp(20)},
  appName: {fontSize: ms(32), fontWeight: '800', letterSpacing: 2},
  appNameTablet: {fontSize: ms(32)},
  appTagline: {fontSize: ms(14), marginTop: 4, letterSpacing: 0.5},
  appTaglineTablet: {fontSize: ms(14)},
  formWrapper: {width: '100%', maxWidth: wp(480)},
  formWrapperLandscape: {flex: 1, maxWidth: wp(460)},
  formCard: {borderRadius: wp(24), paddingHorizontal: wp(20), paddingVertical: wp(28), elevation: 20, shadowOffset: {width: 0, height: 10}, shadowOpacity: 0.15, shadowRadius: 30},
  formCardTablet: {paddingHorizontal: wp(18), paddingVertical: wp(18)},
  loginTypeBadge: {flexDirection: 'row', alignItems: 'center', alignSelf: 'flex-start', paddingHorizontal: wp(12), paddingVertical: wp(5), borderRadius: wp(20), gap: wp(6), marginBottom: wp(16), borderWidth: 1},
  loginTypeText: {fontSize: ms(12), fontWeight: '700', letterSpacing: 0.3},
  welcomeText: {fontSize: ms(26), fontWeight: '700', marginBottom: 4},
  welcomeTextTablet: {fontSize: ms(22)},
  welcomeSub: {fontSize: ms(14), marginBottom: wp(24)},
  welcomeSubTablet: {fontSize: ms(14)},
  fieldGroup: {marginBottom: wp(18)},
  fieldLabel: {fontSize: ms(13), fontWeight: '600', marginBottom: wp(8), letterSpacing: 0.3},
  fieldLabelTablet: {fontSize: ms(12), marginBottom: wp(4)},
  inputRow: {flexDirection: 'row', alignItems: 'center', borderRadius: wp(14), borderWidth: 1.5},
  inputRowTablet: {borderRadius: wp(16)},
  inputIconBox: {width: wp(44), height: wp(44), justifyContent: 'center', alignItems: 'center', marginLeft: wp(4)},
  inputIconBoxTablet: {width: wp(38), height: wp(38)},
  input: {flex: 1, paddingVertical: wp(14), fontSize: ms(15), paddingRight: wp(14)},
  inputTablet: {paddingVertical: wp(8), fontSize: ms(13)},
  connectButton: {flexDirection: 'row', borderRadius: wp(14), paddingVertical: wp(16), alignItems: 'center', justifyContent: 'center', gap: wp(8), marginTop: wp(8), elevation: 6, shadowOffset: {width: 0, height: 4}, shadowOpacity: 0.3, shadowRadius: 8},
  connectButtonTablet: {paddingVertical: wp(9), borderRadius: wp(12), marginTop: wp(6)},
  connectButtonText: {fontSize: ms(16), fontWeight: '700', letterSpacing: 0.5},
  connectButtonTextTablet: {fontSize: ms(13)},
  switchRow: {flexDirection: 'row', justifyContent: 'center', alignItems: 'center', marginTop: wp(18), gap: wp(4)},
  switchText: {fontSize: ms(13)},
  switchLink: {fontSize: ms(13), fontWeight: '700'},
  footer: {flexDirection: 'row', alignItems: 'center', marginTop: wp(20), gap: wp(12)},
  footerDivider: {flex: 1, height: 1},
  footerText: {fontSize: ms(12), fontWeight: '500'},
});
