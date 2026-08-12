import React, {useEffect, useRef, useState} from 'react';
import {
  View,
  Text,
  Image,
  StyleSheet,
  Animated,
  StatusBar,
  Platform,
  PermissionsAndroid,
  Linking,
  Alert,
  AppState,
  NativeModules,
  useWindowDimensions,
  Easing,
  TouchableOpacity,
} from 'react-native';
import {useSafeAreaInsets} from 'react-native-safe-area-context';
import type {NativeStackNavigationProp} from '@react-navigation/native-stack';
import MaterialIcons from 'react-native-vector-icons/MaterialIcons';
import Entypo from 'react-native-vector-icons/Entypo';
import Geolocation from 'react-native-geolocation-service';
import messaging from '@react-native-firebase/messaging';
import {useTheme} from '../contexts/ThemeContext';
import {ms, wp} from '../utils/responsive';
import {storage} from '../services/storage';

const ONBOARDING_KEY = 'permissions_onboarding_done';

export function isPermissionOnboardingDone(): boolean {
  return storage.getBoolean(ONBOARDING_KEY) === true;
}

const {LocationTrackingModule} = NativeModules;

type Props = {navigation: NativeStackNavigationProp<any>};
type Step = 'location' | 'notification' | 'battery';

const STEPS: {key: Step; icon: string; title: string; desc: string; hint: string; features: {icon: string; text: string}[]}[] = [
  {
    key: 'location',
    icon: 'my-location',
    title: 'Location Access',
    desc: 'TKSync needs GPS to track your deliveries in real-time and record trip history.',
    hint: 'Tap Allow, then select "Allow all the time"',
    features: [
      {icon: 'gps-fixed', text: 'Live vehicle tracking'},
      {icon: 'route', text: 'Trip history & routes'},
      {icon: 'nights-stay', text: 'Works with screen off'},
    ],
  },
  {
    key: 'notification',
    icon: 'notifications-active',
    title: 'Notifications',
    desc: 'Stay connected with instant alerts for deliveries, idle warnings, and dispatcher messages.',
    hint: 'Tap Allow to enable push notifications',
    features: [
      {icon: 'local-shipping', text: 'New delivery alerts'},
      {icon: 'timer', text: 'Idle & timeout warnings'},
      {icon: 'message', text: 'Dispatcher messages'},
    ],
  },
  {
    key: 'battery',
    icon: 'battery-charging-full',
    title: 'Battery Optimization',
    desc: 'Allow TKSync to run in the background so GPS tracking continues without interruption.',
    hint: 'Tap Allow to prevent Android from stopping GPS',
    features: [
      {icon: 'gps-fixed', text: 'GPS stays active in background'},
      {icon: 'power-settings-new', text: 'Prevents auto-kill by Android'},
      {icon: 'verified', text: 'Reliable delivery tracking'},
    ],
  },
];

export default function PermissionScreen({navigation}: Props) {
  const {c} = useTheme();
  const {width, height} = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const isLandscape = width > height;
  const isTablet = Math.min(width, height) > 600;

  const [currentStep, setCurrentStep] = useState(0);
  const [showSettings, setShowSettings] = useState(false);

  const iconPulse = useRef(new Animated.Value(1)).current;

  const step = STEPS[currentStep];
  const L = isLandscape;
  const T = isTablet;

  // On mount: auto-skip already-granted steps
  useEffect(() => {
    (async () => {
      try {
        if (Platform.OS !== 'android') return;

        // Check location
        const fine = await PermissionsAndroid.check(PermissionsAndroid.PERMISSIONS.ACCESS_FINE_LOCATION);
        const bg = Number(Platform.Version) >= 29
          ? await PermissionsAndroid.check(PermissionsAndroid.PERMISSIONS.ACCESS_BACKGROUND_LOCATION)
          : fine;
        if (!fine || !bg) return; // Stay on step 0

        // Check notification
        let notifOk = true;
        if (Number(Platform.Version) >= 33) {
          notifOk = await PermissionsAndroid.check(PermissionsAndroid.PERMISSIONS.POST_NOTIFICATIONS);
        }
        if (!notifOk) { setCurrentStep(1); return; }

        // Check battery optimization
        // If all permissions granted, skip to battery step (step 2)
        setCurrentStep(2);
      } catch {}
    })();
  }, []);

  // Re-check on return from Settings
  useEffect(() => {
    if (!showSettings) return;
    const sub = AppState.addEventListener('change', async (s) => {
      if (s !== 'active') return;
      if (step.key === 'location') {
        const bgOk = Number(Platform.Version) >= 29
          ? await PermissionsAndroid.check(PermissionsAndroid.PERMISSIONS.ACCESS_BACKGROUND_LOCATION)
          : await PermissionsAndroid.check(PermissionsAndroid.PERMISSIONS.ACCESS_FINE_LOCATION);
        if (bgOk) { setShowSettings(false); goToNextStep(); }
      } else {
        try {
          const auth = await messaging().hasPermission();
          if (auth === messaging.AuthorizationStatus.AUTHORIZED || auth === messaging.AuthorizationStatus.PROVISIONAL) {
            setShowSettings(false); goToNextStep();
          }
        } catch {}
      }
    });
    return () => sub.remove();
  }, [showSettings, step.key, currentStep]);

  // Icon pulse
  useEffect(() => {
    const pulse = Animated.loop(Animated.sequence([
      Animated.timing(iconPulse, {toValue: 1.05, duration: 1800, easing: Easing.inOut(Easing.ease), useNativeDriver: true}),
      Animated.timing(iconPulse, {toValue: 1, duration: 1800, easing: Easing.inOut(Easing.ease), useNativeDriver: true}),
    ]));
    pulse.start();
    return () => pulse.stop();
  }, [currentStep, iconPulse]);

  const goToNextStep = () => {
    if (currentStep < STEPS.length - 1) {
      setCurrentStep(p => p + 1);
      setShowSettings(false);
    } else {
      storage.set(ONBOARDING_KEY, true);
      navigation.replace('Login');
    }
  };

  const showBgLocationAlert = () => {
    Alert.alert(
      'Background Location Required',
      'To track deliveries when the screen is off, you need to allow location access "All the time".\n\nTap Permissions → Location → Allow all the time',
      [{
        text: 'Open Settings',
        onPress: () => { setShowSettings(true); Linking.openSettings(); },
      }],
      {cancelable: false},
    );
  };

  const requestLocation = async () => {
    if (Platform.OS === 'ios') {
      const status = await Geolocation.requestAuthorization('always');
      if (status === 'granted' || status === 'restricted' || status === 'whenInUse') { goToNextStep(); return; }
      setShowSettings(true); return;
    }

    // Request fine location if not already granted
    const alreadyFine = await PermissionsAndroid.check(PermissionsAndroid.PERMISSIONS.ACCESS_FINE_LOCATION);
    if (!alreadyFine) {
      const fine = await PermissionsAndroid.request(PermissionsAndroid.PERMISSIONS.ACCESS_FINE_LOCATION,
        {title: 'Location Permission', message: 'TKSync needs your location for delivery tracking.', buttonPositive: 'Allow'});
      if (fine !== PermissionsAndroid.RESULTS.GRANTED) {
        // Denied completely — still show alert about needing "All the time"
        showBgLocationAlert();
        return;
      }
    }

    // Check background location — show alert if not "Allow all the time"
    if (Number(Platform.Version) >= 29) {
      const bgAlready = await PermissionsAndroid.check(PermissionsAndroid.PERMISSIONS.ACCESS_BACKGROUND_LOCATION);
      if (!bgAlready) {
        showBgLocationAlert();
        return;
      }
    }

    goToNextStep();
  };

  const requestNotification = async () => {
    if (Platform.OS === 'android' && Number(Platform.Version) >= 33) {
      const r = await PermissionsAndroid.request(PermissionsAndroid.PERMISSIONS.POST_NOTIFICATIONS,
        {title: 'Enable Notifications', message: 'TKSync needs notifications for tracking alerts.', buttonPositive: 'Allow'});
      if (r !== PermissionsAndroid.RESULTS.GRANTED) { setShowSettings(true); return; }
    } else {
      try {
        const a = await messaging().requestPermission();
        if (a !== messaging.AuthorizationStatus.AUTHORIZED && a !== messaging.AuthorizationStatus.PROVISIONAL) { setShowSettings(true); return; }
      } catch {}
    }
    goToNextStep();
  };

  const requestBattery = async () => {
    if (Platform.OS !== 'android' || !LocationTrackingModule) {
      goToNextStep();
      return;
    }
    try {
      await LocationTrackingModule.requestBatteryOptimizationExemption();
    } catch {}
    // Always proceed — user saw the dialog, whether they allowed or not
    goToNextStep();
  };

  const handleAllow = () => {
    if (step.key === 'location') requestLocation();
    else if (step.key === 'notification') requestNotification();
    else if (step.key === 'battery') requestBattery();
  };

  const iSz = L ? ms(36) : T ? ms(48) : ms(42);

  const s = createStyles(c, L, T);

  return (
    <View style={s.container}>
      <StatusBar translucent backgroundColor="transparent" barStyle="light-content" />

      <View style={[s.root, {paddingTop: insets.top + (L ? 8 : wp(10)), paddingBottom: insets.bottom + (L ? 8 : wp(10)), paddingLeft: insets.left + wp(L ? 12 : 16), paddingRight: insets.right + wp(L ? 12 : 16)}]}>
        <View style={s.inner}>

          {/* LEFT panel (green card with icon) */}
          <View style={[s.leftPanel, L && s.leftPanelLand]}>
            <View style={s.leftTop}>
              <Image source={require('../assets/images/logo.png')} style={s.logoImg} resizeMode="contain" />
              <View style={s.stepPill}>
                <Text style={s.stepPillText}>Step {currentStep + 1} of {STEPS.length}</Text>
              </View>
            </View>

            <View style={s.iconWrap}>
              <Animated.View style={[s.iconCircle, {transform: [{scale: iconPulse}]}]}>
                {step.key === 'location'
                  ? <Entypo name="location-pin" size={iSz} color="#fff" />
                  : <MaterialIcons name={step.icon} size={iSz} color="#fff" />
                }
              </Animated.View>
            </View>

            <View style={s.progressRow}>
              {STEPS.map((_, i) => (
                <View key={i} style={s.track}>
                  <View style={[s.fill, i <= currentStep && s.fillActive]} />
                </View>
              ))}
            </View>
          </View>

          {/* RIGHT panel (card + button) */}
          <View style={[s.rightPanel, L && s.rightPanelLand]}>
            <View style={s.cardWrap}>
              <Text style={[s.title, L && s.titleLand]}>{step.title}</Text>
              <Text style={[s.desc, L && s.descLand]}>{step.desc}</Text>

              {step.features.map((f, i) => (
                <View key={i} style={[s.featRow, L && s.featRowLand]}>
                  <View style={[s.featIcon, L && s.featIconLand]}>
                    <MaterialIcons name={f.icon} size={ms(L ? 14 : 16)} color="#6BB130" />
                  </View>
                  <Text style={[s.featText, L && s.featTextLand]}>{f.text}</Text>
                </View>
              ))}

              <View style={s.hintRow}>
                <MaterialIcons name="info-outline" size={ms(12)} color="rgba(255,255,255,0.3)" />
                <Text style={s.hintText}>{step.hint}</Text>
              </View>
            </View>

            {showSettings ? (
              <View>
                <TouchableOpacity style={s.settingsBtn} activeOpacity={0.8} onPress={() => Linking.openSettings()}>
                  <MaterialIcons name="settings" size={ms(18)} color="rgba(255,255,255,0.9)" />
                  <Text style={s.settingsBtnText}>Open Settings</Text>
                  <MaterialIcons name="open-in-new" size={ms(14)} color="rgba(255,255,255,0.4)" />
                </TouchableOpacity>
                <Text style={s.settingsHint}>
                  {step.key === 'location'
                    ? 'Tap Permissions → Location → Allow all the time, then come back'
                    : 'Tap Permissions → Notifications → Enable, then come back'}
                </Text>
              </View>
            ) : (
              <TouchableOpacity style={s.allowBtn} activeOpacity={0.85} onPress={handleAllow}>
                <View style={s.allowIcon}>
                  <MaterialIcons name={step.key === 'location' ? 'location-on' : step.key === 'notification' ? 'notifications' : 'battery-charging-full'} size={ms(18)} color="#fff" />
                </View>
                <Text style={s.allowText}>Allow {step.key === 'location' ? 'Location' : step.key === 'notification' ? 'Notifications' : 'Battery Access'}</Text>
                <MaterialIcons name="arrow-forward-ios" size={ms(14)} color="rgba(255,255,255,0.4)" />
              </TouchableOpacity>
            )}
          </View>

        </View>
      </View>
    </View>
  );
}

const GREEN = '#3A7D0A';
const DARK = '#1E4D00';

const createStyles = (c: any, L: boolean, T: boolean) =>
  StyleSheet.create({
    container: {flex: 1, backgroundColor: DARK},
    root: {flex: 1},
    inner: {flex: 1, flexDirection: L ? 'row' : 'column'},

    // Left panel
    leftPanel: {
      backgroundColor: GREEN, borderRadius: wp(20), padding: wp(14),
      alignItems: 'center', justifyContent: 'space-between',
      marginBottom: L ? 0 : wp(12),
      height: L ? undefined : wp(T ? 200 : 170),
    },
    leftPanelLand: {flex: 0.38, marginBottom: 0, marginRight: wp(12)},
    leftTop: {flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', width: '100%'},
    logoImg: {width: wp(L ? 26 : 30), height: wp(L ? 26 : 30), borderRadius: wp(8)},
    stepPill: {paddingHorizontal: wp(10), paddingVertical: wp(4), borderRadius: wp(14), backgroundColor: 'rgba(255,255,255,0.15)'},
    stepPillText: {fontSize: ms(L ? 9 : 10), fontWeight: '600', color: '#fff', letterSpacing: 0.5},
    iconWrap: {flex: 1, alignItems: 'center', justifyContent: 'center'},
    iconCircle: {
      width: wp(L ? 70 : 80), height: wp(L ? 70 : 80), borderRadius: wp(L ? 35 : 40),
      alignItems: 'center', justifyContent: 'center',
      backgroundColor: 'rgba(255,255,255,0.18)', borderWidth: 2, borderColor: 'rgba(255,255,255,0.25)',
    },
    progressRow: {flexDirection: 'row', gap: wp(5), width: '80%'},
    track: {flex: 1, height: wp(3), borderRadius: wp(2), backgroundColor: 'rgba(255,255,255,0.15)', overflow: 'hidden'},
    fill: {width: '0%' as any, height: '100%', borderRadius: wp(2)},
    fillActive: {width: '100%' as any, backgroundColor: '#fff'},

    // Right panel
    rightPanel: {flex: 1, justifyContent: 'center'},
    rightPanelLand: {flex: 0.62},
    cardWrap: {marginBottom: wp(L ? 10 : 16)},
    title: {fontSize: ms(T ? 26 : 22), fontWeight: '800', color: '#fff', letterSpacing: 0.3, marginBottom: wp(6)},
    titleLand: {fontSize: ms(T ? 22 : 18)},
    desc: {fontSize: ms(T ? 14 : 12), fontWeight: '400', color: 'rgba(255,255,255,0.55)', lineHeight: ms(T ? 20 : 18), marginBottom: wp(14)},
    descLand: {fontSize: ms(T ? 12 : 11), marginBottom: wp(10)},
    featRow: {flexDirection: 'row', alignItems: 'center', gap: wp(10), marginBottom: wp(10)},
    featRowLand: {marginBottom: wp(7)},
    featIcon: {width: wp(30), height: wp(30), borderRadius: wp(8), backgroundColor: 'rgba(107,177,48,0.12)', alignItems: 'center', justifyContent: 'center'},
    featIconLand: {width: wp(26), height: wp(26)},
    featText: {fontSize: ms(T ? 13 : 12), fontWeight: '500', color: 'rgba(255,255,255,0.8)'},
    featTextLand: {fontSize: ms(T ? 12 : 11)},
    hintRow: {flexDirection: 'row', alignItems: 'center', gap: wp(6), marginTop: wp(4)},
    hintText: {fontSize: ms(L ? 9 : 10), fontWeight: '400', color: 'rgba(255,255,255,0.3)'},

    // Buttons
    allowBtn: {
      flexDirection: 'row', alignItems: 'center', gap: wp(12),
      paddingVertical: wp(L ? 10 : 13), paddingHorizontal: wp(16),
      borderRadius: wp(14), backgroundColor: GREEN, minHeight: wp(48),
    },
    allowIcon: {width: wp(34), height: wp(34), borderRadius: wp(10), backgroundColor: 'rgba(255,255,255,0.15)', alignItems: 'center', justifyContent: 'center'},
    allowText: {flex: 1, fontSize: ms(T ? 16 : 14), fontWeight: '700', color: '#fff', letterSpacing: 0.3},
    settingsBtn: {
      flexDirection: 'row', alignItems: 'center', gap: wp(10),
      paddingVertical: wp(L ? 10 : 13), paddingHorizontal: wp(16),
      borderRadius: wp(14), backgroundColor: 'rgba(255,255,255,0.08)',
      borderWidth: 1, borderColor: 'rgba(255,255,255,0.12)', minHeight: wp(48),
    },
    settingsBtnText: {flex: 1, fontSize: ms(T ? 16 : 14), fontWeight: '700', color: '#fff'},
    settingsHint: {marginTop: wp(8), fontSize: ms(10), color: 'rgba(255,255,255,0.3)', textAlign: 'center'},
  });
