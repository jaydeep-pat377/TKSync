import React, {useState, useCallback, useEffect} from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  TextInput,
  StatusBar,
  useWindowDimensions,
  KeyboardAvoidingView,
  Platform,
  ActivityIndicator,
} from 'react-native';
import {useSafeAreaInsets} from 'react-native-safe-area-context';
import MaterialIcons from 'react-native-vector-icons/MaterialIcons';
import type {NativeStackNavigationProp} from '@react-navigation/native-stack';
import type {RouteProp} from '@react-navigation/native';
import {useTheme} from '../contexts/ThemeContext';
import {useOfflineSync} from '../contexts/OfflineSyncContext';
import {ticketsApi} from '../services/api';
import {offlineStorage} from '../services/offlineStorage';
import {wp, ms} from '../utils/responsive';
import SignaturePad from '../components/SignaturePad';
import ThemedAlert from '../components/ThemedAlert';
import {useFontScaleRefresh} from '../contexts/FontSizeContext';

type TicketInfo = {
  customer_name: string;
  customer_code: string;
  project_name: string;
  project_code: string;
  order_code: string;
  ticket_code: string;
};

type Props = {
  navigation: NativeStackNavigationProp<any>;
  route: RouteProp<any>;
};

export default function CurblineReleaseScreen({navigation, route}: Props) {
  useFontScaleRefresh();
  const s = createS();
  const {ticketId, ticketInfo: routeTicketInfo} = (route.params || {}) as {
    ticketId?: number;
    ticketInfo?: TicketInfo;
  };
  const {c} = useTheme();
  const insets = useSafeAreaInsets();
  const {width, height} = useWindowDimensions();
  const {isOnline, enqueueOffline} = useOfflineSync();
  const isTablet = Math.min(width, height) > 600;
  const isLandscape = width > height;
  const sigHeight = isTablet
    ? Math.min(300, Math.max(200, height * 0.28))
    : Math.min(isLandscape ? 200 : 280, Math.max(160, height * 0.32));
  const [typeName, setTypeName] = useState('');
  const [signature, setSignature] = useState<string | null>(null);
  const [scrollEnabled, setScrollEnabled] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [loading, setLoading] = useState(true);
  const [existingRelease, setExistingRelease] = useState<{id: number; signed_name: string; signature_image: string} | null>(null);
  const [editingSignature, setEditingSignature] = useState(false);
  const [alert, setAlert] = useState<{type: 'success' | 'error'; title: string; message: string} | null>(null);
  const [ticketInfo, setTicketInfo] = useState<TicketInfo | null>(routeTicketInfo || null);
  const [loadedFromOffline, setLoadedFromOffline] = useState(false);
  const [loadedSignature, setLoadedSignature] = useState<string | null>(null);

  // Cache ticket info when received from route params
  useEffect(() => {
    if (ticketId && routeTicketInfo) {
      offlineStorage.cacheCurblineTicketInfo(ticketId, routeTicketInfo);
    }
  }, [ticketId, routeTicketInfo]);

  // Fetch existing curbline release on mount — with offline fallback
  useEffect(() => {
    if (!ticketId) { setLoading(false); return; }

    // Try API first
    ticketsApi.getCurblineRelease(ticketId)
      .then(({data}) => {
        if (data.curbline_release) {
          const release = data.curbline_release;
          setExistingRelease(release as any);
          setTypeName(release.signed_name || '');
          setSignature(release.signature_image || null);
          if (release.signature_image) setLoadedSignature(release.signature_image);
          // Cache for offline use
          offlineStorage.cacheCurblineRelease(ticketId, release);
        }
        // Check if there's a pending offline save on top of the API data
        applyPendingOfflineData(ticketId);
      })
      .catch(() => {
        // API failed (offline) — load from local sources
        loadFromLocalStorage(ticketId);
      })
      .finally(() => setLoading(false));
  }, [ticketId]);

  function loadFromLocalStorage(tid: number) {
    // 1. Load cached API response
    const cached = offlineStorage.getCachedCurblineRelease(tid);
    if (cached) {
      setExistingRelease(cached as any);
      setTypeName(cached.signed_name || '');
      setSignature(cached.signature_image || null);
      if (cached.signature_image) setLoadedSignature(cached.signature_image);
    }

    // 2. Load cached ticket info if not from route params
    if (!routeTicketInfo) {
      const cachedInfo = offlineStorage.getCachedCurblineTicketInfo(tid);
      if (cachedInfo) setTicketInfo(cachedInfo);
    }

    // 3. Overlay any pending offline save
    applyPendingOfflineData(tid);

    setLoadedFromOffline(true);
  }

  function applyPendingOfflineData(tid: number) {
    const pending = offlineStorage.getPendingForTicket(tid, 'curbline-release');
    if (pending.length > 0) {
      const latest = pending[pending.length - 1];
      if (latest.body.name) setTypeName(latest.body.name);
      if (latest.body.sign) {
        setSignature(latest.body.sign);
        setLoadedSignature(latest.body.sign);
      }
      setLoadedFromOffline(true);
    }
  }

  const handleSignatureChange = useCallback((sig: string | null) => {
    setSignature(sig);
  }, []);

  const canSubmit = typeName.trim().length > 0 && signature !== null && signature.length > 0 && !submitting;

  const handleSubmit = useCallback(async () => {
    if (!canSubmit || !ticketId) return;

    const body = {name: typeName.trim(), sign: signature!};
    setSubmitting(true);

    try {
      if (!isOnline) {
        enqueueOffline(ticketId, 'curbline-release', body, 'curbline-release' as any);
        // Cache locally so reopening the screen shows the pending data
        offlineStorage.cacheCurblineRelease(ticketId, {
          id: existingRelease?.id || -1,
          signed_name: body.name,
          signature_image: body.sign,
        });
        setAlert({type: 'success', title: 'Saved Offline', message: 'Curbline release will be submitted automatically when connection is restored.'});
      } else if (existingRelease && existingRelease.id > 0) {
        await ticketsApi.updateCurblineRelease(ticketId, body);
        // Update cache with new data
        offlineStorage.cacheCurblineRelease(ticketId, {
          id: existingRelease.id,
          signed_name: body.name,
          signature_image: body.sign,
        });
        setAlert({type: 'success', title: 'Success', message: 'Curbline release updated successfully.'});
      } else {
        await ticketsApi.curblineRelease(ticketId, body);
        offlineStorage.cacheCurblineRelease(ticketId, {
          id: -1,
          signed_name: body.name,
          signature_image: body.sign,
        });
        setAlert({type: 'success', title: 'Success', message: 'Curbline release submitted successfully.'});
      }
    } catch (err: any) {
      if (err?.message?.includes('Network request failed') || err?.name === 'AbortError') {
        enqueueOffline(ticketId, 'curbline-release', body, 'curbline-release' as any);
        offlineStorage.cacheCurblineRelease(ticketId, {
          id: existingRelease?.id || -1,
          signed_name: body.name,
          signature_image: body.sign,
        });
        setAlert({type: 'success', title: 'Saved Offline', message: 'Curbline release will be submitted automatically when connection is restored.'});
      } else {
        setAlert({type: 'error', title: 'Error', message: err.message || 'Failed to submit curbline release.'});
      }
    } finally {
      setSubmitting(false);
    }
  }, [canSubmit, ticketId, typeName, signature, isOnline, enqueueOffline, existingRelease]);

  const handleAlertClose = useCallback(() => {
    const wasSuccess = alert?.type === 'success';
    setAlert(null);
    if (wasSuccess) navigation.goBack();
  }, [alert, navigation]);

  // Resolved ticket info: route params > cached
  const info = ticketInfo;
  const customerLabel = info ? `${info.customer_name}${info.customer_code ? ` (${info.customer_code})` : ''}` : '-';
  const projectLabel = info ? `${info.project_name}${info.project_code ? ` (${info.project_code})` : ''}` : '-';
  const orderLabel = info?.order_code || '-';
  const ticketLabel = info?.ticket_code || '-';

  if (loading) {
    return (
      <View style={[s.container, s.centerContent, {backgroundColor: c.white}]}>
        <StatusBar translucent backgroundColor="transparent" barStyle="dark-content" />
        <ActivityIndicator size="large" color={c.primary} />
      </View>
    );
  }

  return (
    <View style={[s.container, {backgroundColor: isLandscape ? c.white : c.accentBg}]}>
      <StatusBar translucent backgroundColor="transparent" barStyle={isLandscape ? 'dark-content' : 'light-content'} />

      <KeyboardAvoidingView
        style={s.flex1}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        keyboardVerticalOffset={Platform.OS === 'ios' ? 0 : 0}>
      <ScrollView
        style={s.scroll}
        contentContainerStyle={[s.scrollContent, {paddingTop: insets.top + (isLandscape ? 4 : wp(8)), paddingLeft: Math.max(insets.left, isLandscape && !isTablet ? 12 : 0), paddingRight: Math.max(insets.right, isLandscape && !isTablet ? 12 : 0), paddingBottom: Math.max(isLandscape ? wp(20) : wp(50), insets.bottom)}]}
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
        scrollEnabled={scrollEnabled}>

        <View style={[s.card, {backgroundColor: c.white}, isLandscape ? {maxWidth: isTablet ? undefined : 700, alignSelf: 'center' as const, width: '100%', borderRadius: wp(14), marginBottom: wp(10)} : {marginHorizontal: wp(10), borderRadius: wp(10)}]}>

          {/* Header */}
          <View style={[s.header, {borderBottomColor: c.border}]}>
            <Text style={[s.headerTitle, {color: c.textPrimary}]}>CURBLINE RELEASE</Text>
            <TouchableOpacity
              style={[s.closeBtn, {backgroundColor: c.surface}]}
              onPress={() => navigation.goBack()}
              activeOpacity={0.7}
              hitSlop={{top: 8, bottom: 8, left: 8, right: 8}}>
              <MaterialIcons name="close" size={ms(20)} color={c.textSecondary} />
            </TouchableOpacity>
          </View>

          {/* Offline indicator */}
          {loadedFromOffline && (
            <View style={[s.offlineBanner, {backgroundColor: c.warningSurface, borderBottomColor: c.warningBorder}]}>
              <MaterialIcons name="cloud-off" size={ms(14)} color={c.warningDark} />
              <Text style={[s.offlineBannerText, {color: c.warningDark}]}>Loaded from local data</Text>
            </View>
          )}

          {/* Info Section */}
          <View style={s.infoSection}>
            <View style={s.infoRow}>
              <Text style={[s.infoLabel, {color: c.textPrimary}]}>CUSTOMER</Text>
              <Text style={[s.infoValue, {color: c.textPrimary}]}>{customerLabel}</Text>
            </View>
            <View style={s.infoRow}>
              <Text style={[s.infoLabel, {color: c.textPrimary}]}>PROJECT</Text>
              <Text style={[s.infoValue, {color: c.textPrimary}]}>{projectLabel}</Text>
            </View>
            <View style={s.infoRow}>
              <Text style={[s.infoLabel, {color: c.textPrimary}]}>ORDER</Text>
              <Text style={[s.infoValue, {color: c.textPrimary}]}>{orderLabel}</Text>
            </View>
            <View style={s.infoRow}>
              <Text style={[s.infoLabel, {color: c.textPrimary}]}>TICKET</Text>
              <Text style={[s.infoValue, {color: c.textPrimary}]}>{ticketLabel}</Text>
            </View>
            <View style={s.infoRow}>
              <Text style={[s.infoLabel, {color: c.textPrimary}]}>RELEASED</Text>
              <Text style={[s.infoValue, {color: c.textMuted}]} />
            </View>
          </View>

          {/* Divider */}
          <View style={[s.divider, {backgroundColor: c.border}]} />

          {/* Sign Section */}
          <View style={s.signSection}>
            <View style={s.typeNameRow}>
              <Text style={[s.typeNameLabel, {color: c.textPrimary}]}>TYPE NAME</Text>
              <TextInput
                style={[s.typeNameInput, {borderBottomColor: c.border, color: c.textPrimary}]}
                value={typeName}
                onChangeText={setTypeName}
                placeholder="Enter name"
                placeholderTextColor={c.textMuted}
              />
            </View>

            {loadedSignature && !editingSignature ? (
              <SignaturePad
                onSignatureChange={handleSignatureChange}
                height={sigHeight}
                readOnly
                initialImage={loadedSignature}
                onEditPress={() => setEditingSignature(true)}
              />
            ) : (
              <SignaturePad
                onSignatureChange={handleSignatureChange}
                height={sigHeight}
                onTouchStart={() => setScrollEnabled(false)}
                onTouchEnd={() => setScrollEnabled(true)}
              />
            )}

            <TouchableOpacity
              style={[s.submitBtn, {backgroundColor: canSubmit ? c.signBtn : c.border}]}
              activeOpacity={canSubmit ? 0.8 : 1}
              disabled={!canSubmit}
              onPress={handleSubmit}>
              {submitting ? (
                <ActivityIndicator color={c.textOnPrimary} />
              ) : (
                <Text style={[s.submitBtnText, {color: canSubmit ? c.textOnPrimary : c.textMuted}]}>
                  {existingRelease && existingRelease.id > 0 ? 'UPDATE' : 'SUBMIT'}
                </Text>
              )}
            </TouchableOpacity>
          </View>

        </View>
      </ScrollView>
      </KeyboardAvoidingView>

      <ThemedAlert
        visible={alert !== null}
        type={alert?.type || 'success'}
        title={alert?.title || ''}
        message={alert?.message || ''}
        onClose={handleAlertClose}
      />
    </View>
  );
}

const createS = () => StyleSheet.create({
  container: {flex: 1},
  flex1: {flex: 1},
  scroll: {flex: 1},
  scrollContent: {},
  centerContent: {justifyContent: 'center', alignItems: 'center'},
  card: {marginHorizontal: wp(8), marginBottom: wp(10), borderRadius: wp(12), overflow: 'visible'},

  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: wp(10),
    paddingHorizontal: wp(14),
    borderBottomWidth: 1,
    borderTopLeftRadius: wp(14),
    borderTopRightRadius: wp(14),
    overflow: 'hidden',
  },
  headerTitle: {fontSize: ms(15), fontWeight: '800', letterSpacing: 0.5, flex: 1, textAlign: 'center'},
  closeBtn: {width: wp(32), height: wp(32), borderRadius: wp(16), justifyContent: 'center', alignItems: 'center', position: 'absolute', right: wp(8)},

  offlineBanner: {flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: wp(6), paddingVertical: wp(6), borderBottomWidth: 1},
  offlineBannerText: {fontSize: ms(11), fontWeight: '600'},

  infoSection: {paddingHorizontal: wp(16), paddingVertical: wp(14)},
  infoRow: {flexDirection: 'row', alignItems: 'flex-start', flexWrap: 'wrap', paddingVertical: wp(8), gap: wp(8)},
  infoLabel: {fontSize: ms(11), fontWeight: '800', minWidth: wp(68), maxWidth: wp(100)},
  infoValue: {fontSize: ms(11), fontWeight: '500', flex: 1, minWidth: 80},

  divider: {height: StyleSheet.hairlineWidth, marginHorizontal: wp(16)},

  signSection: {paddingHorizontal: wp(16), paddingVertical: wp(16)},
  typeNameRow: {flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: wp(10), marginBottom: wp(8)},
  typeNameLabel: {fontSize: ms(13), fontWeight: '800'},
  typeNameInput: {flex: 1, borderBottomWidth: 1, paddingVertical: wp(4), fontSize: ms(13)},

  submitBtn: {marginTop: wp(12), paddingVertical: wp(10), borderRadius: wp(10), minHeight: wp(44), alignItems: 'center', justifyContent: 'center'},
  submitBtnText: {fontSize: ms(14), fontWeight: '800', letterSpacing: 0.5},
});
