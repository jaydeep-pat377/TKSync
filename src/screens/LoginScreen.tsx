import React, {useState} from 'react';
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
} from 'react-native';
import {useSafeAreaInsets} from 'react-native-safe-area-context';
import MaterialIcons from 'react-native-vector-icons/MaterialIcons';
import type {NativeStackNavigationProp} from '@react-navigation/native-stack';
import {Colors} from '../constants/colors';

type Props = {
  navigation: NativeStackNavigationProp<any>;
};

export default function LoginScreen({navigation}: Props) {
  const [companyCode, setCompanyCode] = useState('');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const insets = useSafeAreaInsets();
  const {width, height} = useWindowDimensions();
  const isTablet = width > 600;
  const isLandscape = width > height;

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

      {/* Background layers */}
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
          <View
            style={[
              styles.brandingSection,
              isLandscape && isTablet && styles.brandingSectionLandscape,
            ]}>
            <View style={styles.logoContainer}>
              <View style={styles.logoOuter}>
                <View style={styles.logoInner}>
                  <MaterialIcons
                    name="local-shipping"
                    size={isTablet ? 40 : 32}
                    color={Colors.textOnPrimary}
                  />
                </View>
              </View>
            </View>
            <Text style={[styles.appName, isTablet && styles.appNameTablet]}>
              TKSync
            </Text>
            <Text style={styles.appTagline}>Ticket Tracking System</Text>
            <View style={styles.versionBadge}>
              <Text style={styles.versionText}>v1.20.0</Text>
            </View>
          </View>

          {/* Form Card */}
          <View
            style={[
              styles.formWrapper,
              isLandscape && isTablet && styles.formWrapperLandscape,
            ]}>
            <View style={[styles.formCard, isTablet && styles.formCardTablet]}>
              <Text style={styles.welcomeText}>Welcome Back</Text>
              <Text style={styles.welcomeSub}>
                Sign in to your account to continue
              </Text>

              {/* Company Code */}
              <View style={styles.fieldGroup}>
                <Text style={styles.fieldLabel}>Company Code</Text>
                <View style={styles.inputRow}>
                  <View style={styles.inputIconBox}>
                    <MaterialIcons
                      name="business"
                      size={20}
                      color={Colors.primaryLight}
                    />
                  </View>
                  <TextInput
                    style={styles.input}
                    placeholder="Enter company code"
                    placeholderTextColor={Colors.textPlaceholder}
                    value={companyCode}
                    onChangeText={setCompanyCode}
                    autoCapitalize="characters"
                  />
                </View>
              </View>

              {/* Username */}
              <View style={styles.fieldGroup}>
                <Text style={styles.fieldLabel}>Username</Text>
                <View style={styles.inputRow}>
                  <View style={styles.inputIconBox}>
                    <MaterialIcons
                      name="person"
                      size={20}
                      color={Colors.primaryLight}
                    />
                  </View>
                  <TextInput
                    style={styles.input}
                    placeholder="Enter your username"
                    placeholderTextColor={Colors.textPlaceholder}
                    value={username}
                    onChangeText={setUsername}
                    autoCapitalize="none"
                  />
                </View>
              </View>

              {/* Password */}
              <View style={styles.fieldGroup}>
                <Text style={styles.fieldLabel}>Password</Text>
                <View style={styles.inputRow}>
                  <View style={styles.inputIconBox}>
                    <MaterialIcons
                      name="lock"
                      size={20}
                      color={Colors.primaryLight}
                    />
                  </View>
                  <TextInput
                    style={styles.input}
                    placeholder="Enter your password"
                    placeholderTextColor={Colors.textPlaceholder}
                    value={password}
                    onChangeText={setPassword}
                    secureTextEntry={!showPassword}
                  />
                  <TouchableOpacity
                    style={styles.eyeButton}
                    onPress={() => setShowPassword(!showPassword)}
                    activeOpacity={0.6}>
                    <MaterialIcons
                      name={showPassword ? 'visibility' : 'visibility-off'}
                      size={20}
                      color={Colors.textMuted}
                    />
                  </TouchableOpacity>
                </View>
              </View>

              {/* Login Button */}
              <TouchableOpacity
                style={styles.loginButton}
                onPress={handleLogin}
                activeOpacity={0.85}>
                <Text style={styles.loginButtonText}>Sign In</Text>
                <MaterialIcons
                  name="arrow-forward"
                  size={20}
                  color={Colors.textOnPrimary}
                />
              </TouchableOpacity>

              {/* Footer */}
              <View style={styles.footer}>
                <View style={styles.footerDivider} />
                <Text style={styles.footerText}>Powered by TKSync</Text>
                <View style={styles.footerDivider} />
              </View>
            </View>
          </View>
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
  content: {
    flex: 1,
  },
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

  // Branding
  brandingSection: {
    alignItems: 'center',
    marginBottom: 32,
  },
  brandingSectionLandscape: {
    marginBottom: 0,
    flex: 1,
    maxWidth: 320,
  },
  logoContainer: {
    marginBottom: 16,
  },
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
  logoInner: {
    width: 64,
    height: 64,
    borderRadius: 20,
    backgroundColor: Colors.primaryLight,
    justifyContent: 'center',
    alignItems: 'center',
    elevation: 8,
    shadowColor: '#000',
    shadowOffset: {width: 0, height: 4},
    shadowOpacity: 0.3,
    shadowRadius: 8,
  },
  appName: {
    fontSize: 32,
    fontWeight: '800',
    color: Colors.textOnPrimary,
    letterSpacing: 2,
  },
  appNameTablet: {
    fontSize: 38,
  },
  appTagline: {
    fontSize: 14,
    color: Colors.textOnDark70,
    marginTop: 4,
    letterSpacing: 0.5,
  },
  versionBadge: {
    marginTop: 12,
    backgroundColor: Colors.textOnDark12,
    paddingHorizontal: 14,
    paddingVertical: 4,
    borderRadius: 12,
  },
  versionText: {
    color: Colors.textOnDark60,
    fontSize: 12,
    fontWeight: '600',
  },

  // Form
  formWrapper: {
    width: '100%',
    maxWidth: 480,
  },
  formWrapperLandscape: {
    flex: 1,
    maxWidth: 460,
  },
  formCard: {
    backgroundColor: Colors.white,
    borderRadius: 24,
    paddingHorizontal: 28,
    paddingVertical: 32,
    elevation: 20,
    shadowColor: '#000',
    shadowOffset: {width: 0, height: 10},
    shadowOpacity: 0.15,
    shadowRadius: 30,
  },
  formCardTablet: {
    paddingHorizontal: 36,
    paddingVertical: 40,
  },
  welcomeText: {
    fontSize: 26,
    fontWeight: '700',
    color: Colors.textPrimary,
    marginBottom: 4,
  },
  welcomeSub: {
    fontSize: 14,
    color: Colors.textTertiary,
    marginBottom: 28,
  },
  fieldGroup: {
    marginBottom: 20,
  },
  fieldLabel: {
    fontSize: 13,
    fontWeight: '600',
    color: Colors.textSecondary,
    marginBottom: 8,
    letterSpacing: 0.3,
  },
  inputRow: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: Colors.surface,
    borderRadius: 14,
    borderWidth: 1.5,
    borderColor: Colors.border,
  },
  inputIconBox: {
    width: 44,
    height: 44,
    justifyContent: 'center',
    alignItems: 'center',
    marginLeft: 4,
  },
  input: {
    flex: 1,
    paddingVertical: 14,
    fontSize: 15,
    color: Colors.textPrimary,
    paddingRight: 14,
  },
  eyeButton: {
    padding: 12,
  },
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
  loginButtonText: {
    color: Colors.textOnPrimary,
    fontSize: 16,
    fontWeight: '700',
    letterSpacing: 0.5,
  },
  footer: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 24,
    gap: 12,
  },
  footerDivider: {
    flex: 1,
    height: 1,
    backgroundColor: Colors.border,
  },
  footerText: {
    color: Colors.textPlaceholder,
    fontSize: 12,
    fontWeight: '500',
  },
});
