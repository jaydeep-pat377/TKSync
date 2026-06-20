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
import {wp, ms} from '../utils/responsive';
import SignaturePad from '../components/SignaturePad';
import ThemedAlert from '../components/ThemedAlert';
import {ticketsApi} from '../services/api';
import type {SigningData} from '../services/api';
import {offlineStorage} from '../services/offlineStorage';
import {useOfflineSync} from '../contexts/OfflineSyncContext';

type Props = {
  navigation: NativeStackNavigationProp<any>;
  route: RouteProp<any>;
};

export default function DisputeTicketScreen({navigation, route}: Props) {
  const {c} = useTheme();
  const {isOnline, enqueueOffline} = useOfflineSync();
  const insets = useSafeAreaInsets();
  const {width, height} = useWindowDimensions();
  const isTablet = Math.min(width, height) > 600;
  const isLandscape = width > height;
  const isTabletLandscape = isTablet && isLandscape;
  const sigHeight = isTablet
    ? Math.min(300, Math.max(200, height * 0.28))
    : Math.min(isLandscape ? 200 : 280, Math.max(160, height * 0.32));
  const cardMaxWidth = isTabletLandscape ? undefined : 700;
  const {ticketId, editable: routeEditable, ticketInfo: routeTicketInfo} = (route.params || {}) as {
    ticketId?: number;
    editable?: boolean;
    ticketInfo?: {customer_name: string; customer_code: string; project_name: string; project_code: string; order_code: string; ticket_code: string};
  };
  const editable = routeEditable === true;

  const [data, setData] = useState<SigningData | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [quantity, setQuantity] = useState('');
  const [reason, setReason] = useState('');
  const [typeName, setTypeName] = useState('');
  const [signature, setSignature] = useState<string | null>(null);
  const [scrollEnabled, setScrollEnabled] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [editingSignature, setEditingSignature] = useState(false);
  const [alert, setAlert] = useState<{type: 'success' | 'error'; title: string; message: string} | null>(null);
  const [loadedFromOffline, setLoadedFromOffline] = useState(false);
  const [loadedSignature, setLoadedSignature] = useState<string | null>(null);

  useEffect(() => {
    if (!ticketId) return;
    let cancelled = false;

    (async () => {
      try {
        setLoading(true);
        setLoadError(null);
        const res = await ticketsApi.getSigning(ticketId);
        if (cancelled) return;
        setData(res.data);
        // Cache full signing data for offline use
        offlineStorage.cacheSigningData(ticketId, res.data);
        // Cache ticket info
        if (routeTicketInfo) {
          offlineStorage.cacheCurblineTicketInfo(ticketId, routeTicketInfo);
        }
        const d = res.data?.status?.dispute;
        if (d) {
          if (d.quantity != null) setQuantity(String(d.quantity));
          if (d.reason) setReason(d.reason);
          if (d.signed_name) setTypeName(d.signed_name);
          if (d.signature_image) {
            setSignature(d.signature_image);
            setLoadedSignature(d.signature_image);
          }
        }
        // Overlay any pending offline submit
        applyPendingOfflineData(ticketId);
      } catch (err: any) {
        if (cancelled) return;
        // API failed — try local cache
        const cached = offlineStorage.getCachedSigningData(ticketId) as SigningData | null;
        if (cached) {
          setData(cached);
          const d = cached.status?.dispute;
          if (d) {
            if (d.quantity != null) setQuantity(String(d.quantity));
            if (d.reason) setReason(d.reason);
            if (d.signed_name) setTypeName(d.signed_name);
            if (d.signature_image) {
              setSignature(d.signature_image);
              setLoadedSignature(d.signature_image);
            }
          }
          applyPendingOfflineData(ticketId);
          setLoadedFromOffline(true);
        } else {
          setLoadError(err.message || 'Failed to load signing data.');
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [ticketId]);

  function applyPendingOfflineData(tid: number) {
    const pending = offlineStorage.getPendingForTicket(tid, 'dispute');
    if (pending.length > 0) {
      const latest = pending[pending.length - 1];
      if (latest.body.quantity != null) setQuantity(String(latest.body.quantity));
      if (latest.body.reason) setReason(latest.body.reason);
      if (latest.body.signed_name) setTypeName(latest.body.signed_name);
      if (latest.body.signature_image) {
        setSignature(latest.body.signature_image);
        setLoadedSignature(latest.body.signature_image);
      }
      setLoadedFromOffline(true);
    }
  }

  const handleSignatureChange = useCallback((sig: string | null) => {
    setSignature(sig);
  }, []);

  const alreadyDisputed = data?.status?.is_disputed === true;
  const isFormDisabled = !editable && alreadyDisputed;

  const canSubmit = typeName.trim().length > 0 && signature !== null && signature.length > 0 && !submitting && !isFormDisabled;

  const handleDispute = useCallback(async () => {
    if (!canSubmit || !ticketId || !signature) return;
    setSubmitting(true);
    const body = {
      quantity: parseFloat(quantity.trim()) || 0,
      reason: reason.trim(),
      signed_name: typeName.trim(),
      signature_image: signature,
    };
    const updateSigningCache = () => {
      const cached = offlineStorage.getCachedSigningData(ticketId) as SigningData | null;
      if (cached) {
        cached.status = {...cached.status, is_disputed: true, dispute: {quantity: body.quantity, reason: body.reason, signed_name: body.signed_name, signature_image: body.signature_image}};
        offlineStorage.cacheSigningData(ticketId, cached);
      }
    };
    try {
      if (!isOnline) {
        enqueueOffline(ticketId, 'dispute', body, 'dispute');
        updateSigningCache();
        setAlert({type: 'success', title: 'Saved Offline', message: 'Dispute will be submitted automatically when connection is restored.'});
      } else {
        await ticketsApi.dispute(ticketId, body);
        updateSigningCache();
        setAlert({type: 'success', title: 'Success', message: 'Ticket disputed successfully.'});
      }
    } catch (err: any) {
      if (err?.message?.includes('Network request failed') || err?.name === 'AbortError') {
        enqueueOffline(ticketId, 'dispute', body, 'dispute');
        updateSigningCache();
        setAlert({type: 'success', title: 'Saved Offline', message: 'Dispute will be submitted automatically when connection is restored.'});
      } else {
        setAlert({type: 'error', title: 'Error', message: err.message || 'Failed to dispute ticket.'});
      }
    } finally {
      setSubmitting(false);
    }
  }, [canSubmit, ticketId, quantity, reason, typeName, signature, isOnline, enqueueOffline]);

  const handleAlertClose = useCallback(() => {
    const wasSuccess = alert?.type === 'success';
    setAlert(null);
    if (wasSuccess) navigation.goBack();
  }, [alert, navigation]);

  const handleQuantityChange = (text: string) => {
    setQuantity(text.replace(/[^0-9.]/g, ''));
  };

  // Loading state
  if (loading) {
    return (
      <View style={[s.container, s.centerContent, {backgroundColor: c.white}]}>
        <StatusBar translucent backgroundColor="transparent" barStyle="dark-content" />
        <ActivityIndicator size="large" color={c.accent} />
        <Text style={[s.loadingText, {color: c.textSecondary}]}>Loading ticket...</Text>
      </View>
    );
  }

  // Error state — only when no cached data available
  if (loadError || !data) {
    return (
      <View style={[s.container, s.centerContent, {backgroundColor: c.white}]}>
        <StatusBar translucent backgroundColor="transparent" barStyle="dark-content" />
        <MaterialIcons name="error-outline" size={ms(48)} color={c.error} />
        <Text style={[s.errorText, {color: c.textPrimary}]}>{loadError || 'No data available.'}</Text>
        <TouchableOpacity style={[s.retryBtn, {backgroundColor: c.accent}]} onPress={() => navigation.goBack()}>
          <Text style={[s.retryBtnText, {color: c.textOnPrimary}]}>GO BACK</Text>
        </TouchableOpacity>
      </View>
    );
  }

  const {ticket, products} = data;

  return (
    <View style={[s.container, {backgroundColor: isLandscape ? c.white : c.accentBg}]}>
      <StatusBar translucent backgroundColor="transparent" barStyle={isLandscape ? 'dark-content' : 'light-content'} />

      <KeyboardAvoidingView
        style={s.flex1}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        keyboardVerticalOffset={Platform.OS === 'ios' ? 0 : 0}>
      <ScrollView
        style={s.scroll}
        contentContainerStyle={[s.scrollContent, {paddingTop: insets.top + (isLandscape ? 4 : 0), paddingLeft: Math.max(insets.left, isLandscape && !isTablet ? 12 : 0), paddingRight: Math.max(insets.right, isLandscape && !isTablet ? 12 : 0), paddingBottom: Math.max(isLandscape ? wp(20) : wp(50), insets.bottom)}]}
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
        scrollEnabled={scrollEnabled}>

        <View style={[s.card, {backgroundColor: c.white}, isLandscape ? {maxWidth: cardMaxWidth, alignSelf: 'center', width: '100%', borderRadius: wp(14), marginBottom: wp(10)} : {marginHorizontal: wp(10), borderRadius: wp(10)}]}>

          {/* Header */}
          <View style={[s.header, {borderBottomColor: c.border}]}>
            <Text style={[s.headerTitle, {color: c.textPrimary}]}>DISPUTE TICKET</Text>
            <TouchableOpacity
              style={[s.closeBtn, {backgroundColor: c.surface}]}
              onPress={() => navigation.goBack()}
              activeOpacity={0.7}
              hitSlop={{top: 8, bottom: 8, left: 8, right: 8}}>
              <MaterialIcons name="close" size={ms(20)} color={c.textSecondary} />
            </TouchableOpacity>
          </View>

          {/* Offline banner */}
          {loadedFromOffline && (
            <View style={[s.offlineBanner, {backgroundColor: c.warningSurface, borderBottomColor: c.warningBorder}]}>
              <MaterialIcons name="cloud-off" size={ms(14)} color={c.warningDark} />
              <Text style={[s.offlineBannerText, {color: c.warningDark}]}>Loaded from local data</Text>
            </View>
          )}

          {/* Already disputed banner */}
          {alreadyDisputed && !editable && (
            <View style={[s.banner, {backgroundColor: c.errorSurface}]}>
              <MaterialIcons name="report-problem" size={ms(18)} color={c.error} />
              <Text style={[s.bannerText, {color: c.error}]}>This ticket has already been disputed.</Text>
            </View>
          )}

          {/* Dispute Form */}
          <View style={s.infoSection}>
            <View style={s.infoRow}>
              <Text style={[s.infoLabel, {color: c.textPrimary}]}>TICKET</Text>
              <Text style={[s.infoValue, {color: c.textPrimary}]}>{ticket.ticket_code}</Text>
            </View>
            <View style={s.infoRow}>
              <Text style={[s.infoLabel, {color: c.textPrimary}]}>PRODUCT</Text>
              <Text style={[s.infoValue, {color: c.textPrimary}]}>{products.length > 0 ? products[0].description : '-'}</Text>
            </View>
            <View style={s.infoRow}>
              <Text style={[s.infoLabel, {color: c.textPrimary}]}>QUANTITY</Text>
              <View style={s.qtyRow}>
                <TextInput
                  style={[s.qtyInput, {borderBottomColor: c.border, color: c.textPrimary}]}
                  value={quantity}
                  onChangeText={handleQuantityChange}
                  keyboardType="decimal-pad"
                  maxLength={6}
                  editable={!isFormDisabled}
                />
                <Text style={[s.qtyUnit, {color: c.textPrimary}]}>M3</Text>
              </View>
            </View>
            <View style={s.infoRow}>
              <Text style={[s.infoLabel, {color: c.textPrimary}]}>REASON</Text>
              <TextInput
                style={[s.reasonInput, {borderBottomColor: c.border, color: c.textPrimary}]}
                value={reason}
                onChangeText={setReason}
                placeholder="Enter reason"
                placeholderTextColor={c.textMuted}
                editable={!isFormDisabled}
              />
            </View>
          </View>

          {/* Type Name + Signature + Submit */}
          <View style={s.signSection}>
            <View style={s.typeNameRow}>
              <Text style={[s.typeNameLabel, {color: c.textPrimary}]}>TYPE NAME</Text>
              <TextInput
                style={[s.typeNameInput, {borderBottomColor: c.border, color: c.textPrimary}]}
                value={typeName}
                onChangeText={setTypeName}
                placeholder="Enter name"
                placeholderTextColor={c.textMuted}
                editable={!isFormDisabled}
              />
            </View>

            {loadedSignature && !editingSignature ? (
              <SignaturePad onSignatureChange={handleSignatureChange} height={sigHeight} readOnly initialImage={loadedSignature} onEditPress={() => setEditingSignature(true)} />
            ) : (
              <SignaturePad onSignatureChange={handleSignatureChange} height={sigHeight} onTouchStart={() => setScrollEnabled(false)} onTouchEnd={() => setScrollEnabled(true)} />
            )}

            {!isFormDisabled && (
              <TouchableOpacity
                style={[s.disputeBtn, {backgroundColor: canSubmit ? c.disputeBtn : c.border}]}
                activeOpacity={canSubmit ? 0.8 : 1}
                disabled={!canSubmit}
                onPress={handleDispute}>
                {submitting ? (
                  <ActivityIndicator size="small" color={c.textOnPrimary} />
                ) : (
                  <Text style={[s.disputeBtnText, {color: canSubmit ? c.textOnPrimary : c.textMuted}]}>DISPUTE</Text>
                )}
              </TouchableOpacity>
            )}
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

const s = StyleSheet.create({
  container: {flex: 1},
  flex1: {flex: 1},
  scroll: {flex: 1},
  scrollContent: {},
  centerContent: {justifyContent: 'center', alignItems: 'center'},

  card: {
    marginBottom: wp(10),
    overflow: 'visible',
  },

  // Loading / Error
  loadingText: {fontSize: ms(13), marginTop: wp(12)},
  errorText: {fontSize: ms(14), fontWeight: '600', marginTop: wp(12), textAlign: 'center', paddingHorizontal: wp(20)},
  retryBtn: {marginTop: wp(16), paddingVertical: wp(10), paddingHorizontal: wp(24), borderRadius: wp(8)},
  retryBtnText: {fontSize: ms(13), fontWeight: '800'},

  // Header
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: wp(10),
    paddingHorizontal: wp(12),
    borderBottomWidth: 1,
    borderTopLeftRadius: 0,
    borderTopRightRadius: 0,
    overflow: 'hidden',
  },
  headerTitle: {fontSize: ms(15), fontWeight: '800', letterSpacing: 0.5, flex: 1, textAlign: 'center'},
  closeBtn: {width: wp(32), height: wp(32), borderRadius: wp(16), justifyContent: 'center', alignItems: 'center', position: 'absolute', right: wp(8)},

  // Banners
  offlineBanner: {flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: wp(6), paddingVertical: wp(6), borderBottomWidth: 1},
  offlineBannerText: {fontSize: ms(11), fontWeight: '600'},
  banner: {flexDirection: 'row', alignItems: 'center', paddingVertical: wp(10), paddingHorizontal: wp(12), gap: wp(8)},
  bannerText: {fontSize: ms(12), fontWeight: '700', flex: 1},

  // Info
  infoSection: {paddingHorizontal: wp(12), paddingVertical: wp(14)},
  infoRow: {flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', paddingVertical: wp(8), gap: wp(8)},
  infoLabel: {fontSize: ms(11), fontWeight: '800', minWidth: wp(68), maxWidth: wp(100)},
  infoValue: {fontSize: ms(11), fontWeight: '500', flex: 1, minWidth: 80},
  qtyRow: {flexDirection: 'row', alignItems: 'center', gap: wp(8)},
  qtyInput: {width: wp(80), borderBottomWidth: 1, paddingVertical: wp(4), fontSize: ms(13), fontWeight: '600'},
  qtyUnit: {fontSize: ms(13), fontWeight: '600'},
  reasonInput: {flex: 1, borderBottomWidth: 1, paddingVertical: wp(4), fontSize: ms(13)},

  // Sign
  signSection: {paddingHorizontal: wp(12), paddingVertical: wp(16)},
  typeNameRow: {flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: wp(10), marginBottom: wp(8)},
  typeNameLabel: {fontSize: ms(13), fontWeight: '800'},
  typeNameInput: {flex: 1, borderBottomWidth: 1, paddingVertical: wp(4), fontSize: ms(13)},

  // Dispute button
  disputeBtn: {
    marginTop: wp(12),
    paddingVertical: wp(10),
    borderRadius: wp(10),
    minHeight: wp(44),
    alignItems: 'center',
    justifyContent: 'center',
  },
  disputeBtnText: {fontSize: ms(14), fontWeight: '800', letterSpacing: 0.5},
});
