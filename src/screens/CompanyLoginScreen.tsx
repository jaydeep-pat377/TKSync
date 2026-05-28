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
  const shortDim = Math.min(width, height);
  const isTablet = shortDim > 600;
  const isLandscape = width > height;
  const landscapePhone = isLandscape && !isTablet;
  const landscapeTablet = isLandscape && isTablet;

  const fadeAnim = useRef(new Animated.Value(0)).current;
  const slideAnim = useRef(new Animated.Value(30)).current;

  useEffect(() => {
    Animated.parallel([
      Animated.timing(fadeAnim, {toValue: 1, duration: 600, useNativeDriver: true}),
      Animated.spring(slideAnim, {toValue: 0, friction: 8, tension: 50, useNativeDriver: true}),
    ]).start();
  }, [fadeAnim, slideAnim]);

  const handleConnect = () => {
    navigation.navigate('DriverLogin');
  };

  // Fixed maxWidth caps (NOT scaled by wp() — prevents bloating on tablets)
  const formMaxW = isTablet ? 520 : 480;
  const brandingMaxW = isTablet ? 360 : 280;

  return (
    <View style={[styles.container, {backgroundColor: c.primaryDark}]}>
      <StatusBar translucent backgroundColor="transparent" barStyle="light-content" />

      <View style={[styles.bgTop, {backgroundColor: c.primary}]} />
      <View style={[styles.bgBottom, {backgroundColor: c.primaryDark}]} />

      <KeyboardAvoidingView
        style={styles.content}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <ScrollView
          contentContainerStyle={[
            styles.innerContent,
            {
              paddingTop: isLandscape ? insets.top + wp(6) : insets.top + wp(16),
              paddingBottom: isLandscape ? Math.max(insets.bottom, wp(8)) : wp(24),
              paddingLeft: Math.max(isTablet ? 40 : wp(20), insets.left + 10),
              paddingRight: Math.max(isTablet ? 40 : wp(20), insets.right + 10),
            },
            isLandscape && styles.innerContentLandscape,
            landscapeTablet && {gap: 50},
          ]}
          showsVerticalScrollIndicator={false}
          keyboardShouldPersistTaps="handled"
          bounces={false}>

          {/* Branding */}
          <Animated.View
            style={[
              styles.brandingSection,
              isLandscape && {marginBottom: 0, flex: 1, maxWidth: brandingMaxW},
              landscapePhone && {maxWidth: 240},
              {opacity: fadeAnim},
            ]}>
            <View style={{marginBottom: landscapePhone ? 8 : 16}}>
              <View style={[
                styles.logoOuter,
                landscapePhone && {width: 60, height: 60, borderRadius: 20},
                isTablet && {width: 100, height: 100, borderRadius: 30},
                {backgroundColor: c.overlay15, borderColor: c.overlay25},
              ]}>
                <View style={[
                  styles.logoInner,
                  landscapePhone && {width: 44, height: 44, borderRadius: 14},
                  isTablet && {width: 72, height: 72, borderRadius: 22},
                  {backgroundColor: c.primaryLight, shadowColor: c.shadowColor},
                ]}>
                  <MaterialIcons
                    name="sync"
                    size={landscapePhone ? 22 : isTablet ? 36 : 30}
                    color={c.textOnPrimary}
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
          </Animated.View>

          {/* Form Card */}
          <Animated.View
            style={[
              {maxWidth: formMaxW},
              !isLandscape && {width: '100%'},
              isLandscape && {flex: 1, maxWidth: formMaxW},
              {opacity: fadeAnim, transform: [{translateY: slideAnim}]},
            ]}>
            <View style={[
              styles.formCard,
              landscapePhone && {paddingVertical: wp(14), paddingHorizontal: wp(16), borderRadius: 18},
              isTablet && {paddingVertical: 24, paddingHorizontal: 28, borderRadius: 22},
              {backgroundColor: c.white, shadowColor: c.shadowColor},
            ]}>
              {/* Login type indicator */}
              <View style={[styles.loginTypeBadge, {backgroundColor: c.primarySurface, borderColor: c.primaryBorder}]}>
                <MaterialIcons name="business" size={ms(14)} color={c.primary} />
                <Text style={[styles.loginTypeText, {color: c.primary}]}>
                  {t('companyLogin.badge')}
                </Text>
              </View>

              <Text style={[
                styles.welcomeText,
                landscapePhone && {fontSize: ms(20), marginBottom: 2},
                isTablet && {fontSize: ms(20)},
                {color: c.textPrimary},
              ]}>
                {t('companyLogin.title')}
              </Text>
              <Text style={[
                styles.welcomeSub,
                landscapePhone && {marginBottom: wp(12)},
                isTablet && {marginBottom: 18},
                {color: c.textTertiary},
              ]}>
                {t('companyLogin.subtitle')}
              </Text>

              {/* Company Code */}
              <View style={{marginBottom: landscapePhone ? wp(10) : isTablet ? 14 : wp(18)}}>
                <Text style={[styles.fieldLabel, {color: c.textSecondary}]}>
                  {t('companyLogin.companyCode')}
                </Text>
                <View style={[
                  styles.inputRow,
                  isTablet && {borderRadius: 14},
                  {backgroundColor: c.surface, borderColor: c.border},
                ]}>
                  <View style={[
                    styles.inputIconBox,
                    landscapePhone && {width: 34, height: 34},
                    isTablet && {width: 42, height: 42},
                  ]}>
                    <MaterialIcons name="vpn-key" size={isTablet ? 22 : 20} color={c.primaryLight} />
                  </View>
                  <TextInput
                    style={[
                      styles.input,
                      landscapePhone && {paddingVertical: wp(8)},
                      isTablet && {paddingVertical: 10, fontSize: ms(14)},
                      {color: c.textPrimary},
                    ]}
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
                  landscapePhone && {paddingVertical: wp(10), borderRadius: 10, marginTop: 4},
                  isTablet && {paddingVertical: 14, borderRadius: 12, marginTop: 6},
                  {backgroundColor: c.primary, shadowColor: c.primary},
                ]}
                onPress={handleConnect}
                activeOpacity={0.85}>
                <Text style={[styles.connectButtonText, isTablet && {fontSize: ms(14)}, {color: c.textOnPrimary}]}>
                  {t('companyLogin.connect')}
                </Text>
                <MaterialIcons name="arrow-forward" size={isTablet ? 22 : 20} color={c.textOnPrimary} />
              </TouchableOpacity>

              {/* Footer */}
              <View style={[styles.footer, landscapePhone && {marginTop: wp(10)}, isTablet && {marginTop: 16}]}>
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
  bgTop: {position: 'absolute', top: 0, left: -5, right: -5, height: '65%', borderBottomLeftRadius: 40, borderBottomRightRadius: 40},
  bgBottom: {position: 'absolute', bottom: 0, left: -5, right: -5, height: '50%'},
  content: {flex: 1},
  innerContent: {flexGrow: 1, alignItems: 'center', justifyContent: 'center'},
  innerContentLandscape: {flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: wp(20)},
  brandingSection: {alignItems: 'center', marginBottom: wp(24)},
  logoOuter: {width: wp(82), height: wp(82), borderRadius: wp(26), justifyContent: 'center', alignItems: 'center', borderWidth: 2},
  logoInner: {width: wp(60), height: wp(60), borderRadius: wp(18), justifyContent: 'center', alignItems: 'center', elevation: 8, shadowOffset: {width: 0, height: 4}, shadowOpacity: 0.3, shadowRadius: 8},
  appName: {fontSize: ms(30), fontWeight: '800', letterSpacing: 2},
  appTagline: {fontSize: ms(14), marginTop: 4, letterSpacing: 0.5},
  formCard: {borderRadius: wp(22), paddingHorizontal: wp(20), paddingVertical: wp(22), elevation: 20, shadowOffset: {width: 0, height: 10}, shadowOpacity: 0.15, shadowRadius: 30},
  loginTypeBadge: {flexDirection: 'row', alignItems: 'center', alignSelf: 'flex-start', paddingHorizontal: wp(12), paddingVertical: wp(5), borderRadius: wp(20), gap: wp(6), marginBottom: wp(12), borderWidth: 1},
  loginTypeText: {fontSize: ms(12), fontWeight: '700', letterSpacing: 0.3},
  welcomeText: {fontSize: ms(24), fontWeight: '700', marginBottom: 4},
  welcomeSub: {fontSize: ms(14), marginBottom: wp(18)},
  fieldLabel: {fontSize: ms(13), fontWeight: '600', marginBottom: wp(6), letterSpacing: 0.3},
  inputRow: {flexDirection: 'row', alignItems: 'center', borderRadius: wp(12), borderWidth: 1.5},
  inputIconBox: {width: wp(40), height: wp(40), justifyContent: 'center', alignItems: 'center', marginLeft: wp(4)},
  input: {flex: 1, paddingVertical: wp(12), fontSize: ms(15), paddingRight: wp(14)},
  connectButton: {flexDirection: 'row', borderRadius: wp(12), paddingVertical: wp(14), alignItems: 'center', justifyContent: 'center', gap: wp(8), marginTop: wp(6), elevation: 6, shadowOffset: {width: 0, height: 4}, shadowOpacity: 0.3, shadowRadius: 8},
  connectButtonText: {fontSize: ms(16), fontWeight: '700', letterSpacing: 0.5},
  footer: {flexDirection: 'row', alignItems: 'center', marginTop: wp(16), gap: wp(12)},
  footerDivider: {flex: 1, height: 1},
  footerText: {fontSize: ms(12), fontWeight: '500'},
});
