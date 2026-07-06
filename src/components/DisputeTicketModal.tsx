import React, {useState, useCallback, useEffect, useRef} from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  TextInput,
  ActivityIndicator,
  Platform,
  useWindowDimensions,
} from 'react-native';
import {useSafeAreaInsets} from 'react-native-safe-area-context';
import ResponsiveModal from './ResponsiveModal';
import SignaturePad from './SignaturePad';
import ThemedAlert from './ThemedAlert';
import Icon from './Icon';
import {useTheme} from '../contexts/ThemeContext';
import {ticketsApi} from '../services/api';
import type {SigningData} from '../services/api';
import {offlineStorage} from '../services/offlineStorage';
import {useOfflineSync} from '../contexts/OfflineSyncContext';

const MONO = Platform.OS === 'ios' ? 'Menlo' : 'monospace';

type Props = {
  visible: boolean;
  onClose: () => void;
  ticketId: number | null;
  ticketInfo?: {
    customer_name: string;
    customer_code: string;
    project_name: string;
    project_code: string;
    order_code: string;
    ticket_code: string;
  } | null;
  isLandscape: boolean;
};

export default function DisputeTicketModal({
  visible,
  onClose,
  ticketId,
  ticketInfo,
  isLandscape,
}: Props) {
  const {c, isDark} = useTheme();
  const {isOnline, enqueueOffline} = useOfflineSync();
  const {width: screenW, height: screenH} = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const shortDim = Math.min(screenW, screenH);

  // ── Same scaling as Dashboard / MobileTicketModal ──
  const LREF = 810;
  const sc = Math.max(0.65, Math.min(1.35, shortDim / LREF));
  const fs = (base: number) => Math.round(base * sc);
  const fst = (base: number) => Math.round((base - 1) * sc);

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
  const sigClearRef = useRef<(() => void) | null>(null);
  const [alert, setAlert] = useState<{
    type: 'success' | 'error';
    title: string;
    message: string;
  } | null>(null);
  const [loadedFromOffline, setLoadedFromOffline] = useState(false);
  const [loadedSignature, setLoadedSignature] = useState<string | null>(null);

  useEffect(() => {
    if (!visible) {
      setData(null);
      setLoading(true);
      setLoadError(null);
      setQuantity('');
      setReason('');
      setTypeName('');
      setSignature(null);
      setScrollEnabled(true);
      setSubmitting(false);
      setEditingSignature(false);
      setAlert(null);
      setLoadedFromOffline(false);
      setLoadedSignature(null);
      return;
    }
    if (!ticketId) return;

    let cancelled = false;

    (async () => {
      try {
        setLoading(true);
        setLoadError(null);
        const res = await ticketsApi.getSigning(ticketId);
        if (cancelled) return;
        setData(res.data);
        offlineStorage.cacheSigningData(ticketId, res.data);
        if (ticketInfo) {
          offlineStorage.cacheCurblineTicketInfo(ticketId, ticketInfo);
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
        applyPendingOfflineData(ticketId);
      } catch (err: any) {
        if (cancelled) return;
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
  }, [visible, ticketId]);

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
  const isFormDisabled = alreadyDisputed;

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
        cached.status = {
          ...cached.status,
          is_disputed: true,
          dispute: { quantity: body.quantity, reason: body.reason, signed_name: body.signed_name, signature_image: body.signature_image },
        };
        offlineStorage.cacheSigningData(ticketId, cached);
      }
    };
    try {
      if (!isOnline) {
        enqueueOffline(ticketId, 'dispute', body, 'dispute');
        updateSigningCache();
        setAlert({ type: 'success', title: 'Saved Offline', message: 'Dispute will be submitted automatically when connection is restored.' });
      } else {
        await ticketsApi.dispute(ticketId, body);
        updateSigningCache();
        setAlert({ type: 'success', title: 'Success', message: 'Ticket disputed successfully.' });
      }
    } catch (err: any) {
      if (err?.message?.includes('Network request failed') || err?.name === 'AbortError') {
        enqueueOffline(ticketId, 'dispute', body, 'dispute');
        updateSigningCache();
        setAlert({ type: 'success', title: 'Saved Offline', message: 'Dispute will be submitted automatically when connection is restored.' });
      } else {
        setAlert({ type: 'error', title: 'Error', message: err.message || 'Failed to dispute ticket.' });
      }
    } finally {
      setSubmitting(false);
    }
  }, [canSubmit, ticketId, quantity, reason, typeName, signature, isOnline, enqueueOffline]);

  const handleAlertClose = useCallback(() => {
    const wasSuccess = alert?.type === 'success';
    setAlert(null);
    if (wasSuccess) onClose();
  }, [alert, onClose]);

  const handleQuantityChange = (text: string) => {
    setQuantity(text.replace(/[^0-9.]/g, ''));
  };

  const sigHeight = fs(170);
  const scrollMaxH = Math.round(screenH * (isLandscape ? 0.72 : 0.75));
  const pad = fs(24);
  const safeW = screenW - insets.left - insets.right;
  const modalMaxW = Math.round(safeW * 0.76);

  const renderContent = () => {
    if (loading) {
      return (
        <View style={{flex: 1, justifyContent: 'center', alignItems: 'center', paddingVertical: fs(40)}}>
          <ActivityIndicator size="large" color={c.accent} />
          <Text style={{fontSize: fst(12), marginTop: fs(8), color: c.textSecondary, fontFamily: MONO}}>Loading ticket...</Text>
        </View>
      );
    }

    if (loadError || !data) {
      return (
        <View style={{flex: 1, justifyContent: 'center', alignItems: 'center', paddingVertical: fs(40)}}>
          <Icon name="error-outline" size={fs(36)} color={c.error} />
          <Text style={{fontSize: fst(12), fontWeight: '600', marginTop: fs(8), color: c.textPrimary, textAlign: 'center', fontFamily: MONO}}>
            {loadError || 'No data available.'}
          </Text>
          <TouchableOpacity style={{marginTop: fs(10), paddingVertical: fs(6), paddingHorizontal: fs(16), borderRadius: fs(6), backgroundColor: c.accent}} onPress={onClose}>
            <Text style={{fontSize: fst(12), fontWeight: '800', color: c.textOnPrimary, fontFamily: MONO}}>CLOSE</Text>
          </TouchableOpacity>
        </View>
      );
    }

    const {products} = data;

    return (
      <ScrollView
        style={{maxHeight: scrollMaxH}}
        contentContainerStyle={{paddingBottom: fs(8)}}
        showsVerticalScrollIndicator={true}
        persistentScrollbar
        keyboardShouldPersistTaps="handled"
        scrollEnabled={scrollEnabled}
        nestedScrollEnabled>

        {/* Offline banner */}
        {loadedFromOffline && (
          <View style={{flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: fs(4), paddingVertical: fs(4), borderBottomWidth: 1, backgroundColor: c.warningSurface, borderBottomColor: c.warningBorder}}>
            <Icon name="cloud-off" size={fst(11)} color={c.warningDark} />
            <Text style={{fontSize: fst(11), fontWeight: '600', color: c.warningDark, fontFamily: MONO}}>Loaded from local data</Text>
          </View>
        )}

        {/* Already disputed */}
        {alreadyDisputed && (
          <View style={{flexDirection: 'row', alignItems: 'center', paddingVertical: fs(6), paddingHorizontal: pad, gap: fs(6), backgroundColor: c.errorSurface}}>
            <Icon name="report-problem" size={fst(14)} color={c.error} />
            <Text style={{fontSize: fst(12), fontWeight: '700', flex: 1, color: c.error, fontFamily: MONO}}>This ticket has already been disputed.</Text>
          </View>
        )}

        {/* Info Section */}
        <View style={{paddingHorizontal: pad, paddingVertical: fs(16), borderBottomWidth: 1, borderBottomColor: c.border}}>
          {[
            {l: 'TICKET', v: ticketInfo?.ticket_code || data.ticket?.ticket_code || '-'},
            {l: 'PRODUCT', v: products.length > 0 ? products[0].description : '-'},
          ].map(row => (
            <View key={row.l} style={{flexDirection: 'row', alignItems: 'center', paddingVertical: fs(6), gap: fs(8)}}>
              <Text style={{width: fs(108), fontSize: fst(11), fontWeight: '800', letterSpacing: 0.4, color: c.textPrimary, fontFamily: MONO}}>{row.l}</Text>
              <Text style={{flex: 1, fontSize: fst(13), fontWeight: '500', color: c.textPrimary, fontFamily: MONO}}>{row.v}</Text>
            </View>
          ))}

          {/* Quantity */}
          <View style={{flexDirection: 'row', alignItems: 'center', paddingVertical: fs(6), gap: fs(8)}}>
            <Text style={{width: fs(108), fontSize: fst(11), fontWeight: '800', letterSpacing: 0.4, color: c.textPrimary, fontFamily: MONO}}>QUANTITY</Text>
            <TextInput
              style={{width: fs(74), borderBottomWidth: 1.5, borderBottomColor: c.border, paddingVertical: fs(3), fontSize: fst(15), fontWeight: '700', color: c.textPrimary, textAlign: 'center', fontFamily: MONO}}
              value={quantity}
              onChangeText={handleQuantityChange}
              keyboardType="decimal-pad"
              maxLength={6}
              editable={!isFormDisabled}
            />
            <Text style={{fontSize: fst(13), fontWeight: '600', color: c.textPrimary, fontFamily: MONO}}>M3</Text>
          </View>

          {/* Reason */}
          <View style={{flexDirection: 'row', alignItems: 'center', paddingVertical: fs(6), gap: fs(8)}}>
            <Text style={{width: fs(108), fontSize: fst(11), fontWeight: '800', letterSpacing: 0.4, color: c.textPrimary, fontFamily: MONO}}>REASON</Text>
            <TextInput
              style={{flex: 1, borderBottomWidth: 1.5, borderBottomColor: c.border, paddingVertical: fs(3), fontSize: fst(14), color: c.textPrimary, fontFamily: MONO}}
              value={reason}
              onChangeText={setReason}
              placeholder="Enter reason"
              placeholderTextColor={c.textMuted}
              editable={!isFormDisabled}
            />
          </View>
        </View>

        {/* Type Name + Signature + Submit */}
        <View style={{paddingHorizontal: pad, paddingVertical: fs(16)}}>
          <Text style={{fontSize: fst(11), fontWeight: '800', letterSpacing: 0.5, marginBottom: fs(5), color: c.textPrimary, fontFamily: MONO}}>TYPE NAME</Text>
          <TextInput
            style={{borderWidth: 1, borderColor: '#cfd6de', borderRadius: fs(6), paddingVertical: fs(9), paddingHorizontal: fs(10), fontSize: fst(14), color: c.textPrimary, backgroundColor: '#fff', fontFamily: MONO}}
            value={typeName}
            onChangeText={setTypeName}
            placeholder="Enter name"
            placeholderTextColor={c.textMuted}
            editable={!isFormDisabled}
          />

          {/* Signature pad */}
          {loadedSignature && !editingSignature ? (
            <SignaturePad
              onSignatureChange={handleSignatureChange}
              height={sigHeight}
              readOnly
              initialImage={loadedSignature}
              onEditPress={() => setEditingSignature(true)}
              minimal
            />
          ) : (
            <SignaturePad
              onSignatureChange={handleSignatureChange}
              height={sigHeight}
              onTouchStart={() => setScrollEnabled(false)}
              onTouchEnd={() => setScrollEnabled(true)}
              minimal
              clearRef={sigClearRef}
            />
          )}

          {/* Clear */}
          <TouchableOpacity onPress={() => { sigClearRef.current?.(); setSignature(null); setLoadedSignature(null); setEditingSignature(false); }} activeOpacity={0.7} style={{marginTop: fs(8)}}>
            <Text style={{fontSize: fst(12), fontWeight: '400', color: '#2f7ed0', fontFamily: MONO}}>Clear signature</Text>
          </TouchableOpacity>

          {/* Submit */}
          {!isFormDisabled && (
            <TouchableOpacity
              style={{marginTop: fs(16), paddingVertical: fs(16), borderRadius: 2, alignItems: 'center', justifyContent: 'center', backgroundColor: canSubmit ? '#8a1414' : isDark ? '#4A5B6E' : '#cfd6de'}}
              activeOpacity={canSubmit ? 0.8 : 1}
              disabled={!canSubmit}
              onPress={handleDispute}>
              {submitting ? (
                <ActivityIndicator size="small" color="#fff" />
              ) : (
                <Text style={{fontSize: fst(14), fontWeight: '800', letterSpacing: 1, color: canSubmit ? '#fff' : '#9E9E9E', fontFamily: MONO}}>DISPUTE</Text>
              )}
            </TouchableOpacity>
          )}
        </View>
      </ScrollView>
    );
  };

  return (
    <>
      <ResponsiveModal
        visible={visible}
        onClose={onClose}
        maxWidth={modalMaxW}
        widthPercent={76}
        maxHeightPercent={92}
        avoidKeyboard>
        {/* Header */}
        <View style={{flexDirection: 'row', alignItems: 'center', justifyContent: 'center', paddingVertical: fs(16), paddingHorizontal: pad, borderBottomWidth: 1, borderBottomColor: c.border}}>
          <Text style={{fontSize: fst(16), fontWeight: '800', letterSpacing: 0.5, flex: 1, textAlign: 'center', color: c.textPrimary, fontFamily: MONO}}>DISPUTE LOAD</Text>
          <TouchableOpacity
            style={{width: fs(30), height: fs(30), borderWidth: 1.5, borderColor: '#1a2230', backgroundColor: '#fff', borderRadius: fs(5), justifyContent: 'center', alignItems: 'center', position: 'absolute', right: fs(16)}}
            onPress={onClose}
            activeOpacity={0.7}
            hitSlop={{top: 8, bottom: 8, left: 8, right: 8}}>
            <Text style={{fontSize: fst(13), fontWeight: '400', color: '#1a2230', fontFamily: MONO}}>✕</Text>
          </TouchableOpacity>
        </View>

        {renderContent()}
      </ResponsiveModal>

      <ThemedAlert
        visible={alert !== null}
        type={alert?.type || 'success'}
        title={alert?.title || ''}
        message={alert?.message || ''}
        onClose={handleAlertClose}
      />
    </>
  );
}
