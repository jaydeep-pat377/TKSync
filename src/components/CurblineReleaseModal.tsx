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

export default function CurblineReleaseModal({
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

  const LREF = 810;
  const sc = Math.max(0.65, Math.min(1.35, shortDim / LREF));
  const fs = (base: number) => Math.round(base * sc);
  const fst = (base: number) => Math.round((base - 1) * sc);

  const [loading, setLoading] = useState(true);
  const [typeName, setTypeName] = useState('');
  const [signature, setSignature] = useState<string | null>(null);
  const [scrollEnabled, setScrollEnabled] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [existingRelease, setExistingRelease] = useState<{id: number; signed_name: string; signature_image: string} | null>(null);
  const [editingSignature, setEditingSignature] = useState(false);
  const [loadedFromOffline, setLoadedFromOffline] = useState(false);
  const [loadedSignature, setLoadedSignature] = useState<string | null>(null);
  const sigClearRef = useRef<(() => void) | null>(null);
  const [alert, setAlert] = useState<{type: 'success' | 'error'; title: string; message: string} | null>(null);

  useEffect(() => {
    if (!visible) {
      setLoading(true); setTypeName(''); setSignature(null); setScrollEnabled(true);
      setSubmitting(false); setExistingRelease(null); setEditingSignature(false);
      setLoadedFromOffline(false); setLoadedSignature(null); setAlert(null);
      return;
    }
    if (!ticketId) { setLoading(false); return; }
    if (ticketInfo) offlineStorage.cacheCurblineTicketInfo(ticketId, ticketInfo);

    let cancelled = false;
    (async () => {
      try {
        setLoading(true);
        const {data} = await ticketsApi.getCurblineRelease(ticketId);
        if (cancelled) return;
        if (data.curbline_release) {
          const release = data.curbline_release;
          setExistingRelease(release as any);
          setTypeName(release.signed_name || '');
          setSignature(release.signature_image || null);
          if (release.signature_image) setLoadedSignature(release.signature_image);
          offlineStorage.cacheCurblineRelease(ticketId, release);
        }
        applyPendingOfflineData(ticketId);
      } catch {
        if (cancelled) return;
        loadFromLocalStorage(ticketId);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [visible, ticketId]);

  function loadFromLocalStorage(tid: number) {
    const cached = offlineStorage.getCachedCurblineRelease(tid);
    if (cached) {
      setExistingRelease(cached as any);
      setTypeName(cached.signed_name || '');
      setSignature(cached.signature_image || null);
      if (cached.signature_image) setLoadedSignature(cached.signature_image);
    }
    applyPendingOfflineData(tid);
    setLoadedFromOffline(true);
  }

  function applyPendingOfflineData(tid: number) {
    const pending = offlineStorage.getPendingForTicket(tid, 'curbline-release', 'curbline-release');
    if (pending.length > 0) {
      const latest = pending[pending.length - 1];
      if (latest.body.name) setTypeName(latest.body.name);
      if (latest.body.sign) { setSignature(latest.body.sign); setLoadedSignature(latest.body.sign); }
      setLoadedFromOffline(true);
    }
  }

  const handleSignatureChange = useCallback((sig: string | null) => { setSignature(sig); }, []);
  const canSubmit = typeName.trim().length > 0 && signature !== null && signature.length > 0 && !submitting;

  const handleSubmit = useCallback(async () => {
    if (!canSubmit || !ticketId) return;
    const body = {name: typeName.trim(), sign: signature!};
    setSubmitting(true);
    try {
      if (!isOnline) {
        enqueueOffline(ticketId, 'curbline-release', body, 'curbline-release');
        offlineStorage.cacheCurblineRelease(ticketId, {id: existingRelease?.id || -1, signed_name: body.name, signature_image: body.sign});
        setAlert({type: 'success', title: 'Saved Offline', message: 'Curbline release will be submitted automatically when connection is restored.'});
      } else if (existingRelease && existingRelease.id > 0) {
        await ticketsApi.updateCurblineRelease(ticketId, body);
        offlineStorage.cacheCurblineRelease(ticketId, {id: existingRelease.id, signed_name: body.name, signature_image: body.sign});
        setAlert({type: 'success', title: 'Success', message: 'Curbline release updated successfully.'});
      } else {
        await ticketsApi.curblineRelease(ticketId, body);
        offlineStorage.cacheCurblineRelease(ticketId, {id: -1, signed_name: body.name, signature_image: body.sign});
        setAlert({type: 'success', title: 'Success', message: 'Curbline release submitted successfully.'});
      }
    } catch (err: any) {
      if (err?.message?.includes('Network request failed') || err?.name === 'AbortError') {
        enqueueOffline(ticketId, 'curbline-release', body, 'curbline-release');
        offlineStorage.cacheCurblineRelease(ticketId, {id: existingRelease?.id || -1, signed_name: body.name, signature_image: body.sign});
        setAlert({type: 'success', title: 'Saved Offline', message: 'Curbline release will be submitted automatically when connection is restored.'});
      } else {
        setAlert({type: 'error', title: 'Error', message: err.message || 'Failed to submit curbline release.'});
      }
    } finally { setSubmitting(false); }
  }, [canSubmit, ticketId, typeName, signature, isOnline, enqueueOffline, existingRelease]);

  const handleAlertClose = useCallback(() => {
    const wasSuccess = alert?.type === 'success';
    setAlert(null);
    if (wasSuccess) onClose();
  }, [alert, onClose]);

  const sigHeight = fs(170);
  const scrollMaxH = Math.round(screenH * (isLandscape ? 0.72 : 0.75));
  const pad = fs(24);
  const safeW = screenW - insets.left - insets.right;
  const modalMaxW = Math.round(safeW * 0.76);

  const customerLabel = ticketInfo?.customer_name || '-';
  const projectLabel = ticketInfo?.project_name || '-';
  const orderLabel = ticketInfo?.order_code || '-';
  const ticketLabel = ticketInfo?.ticket_code || '-';

  const renderContent = () => {
    if (loading) {
      return (
        <View style={{flex: 1, justifyContent: 'center', alignItems: 'center', paddingVertical: fs(40)}}>
          <ActivityIndicator size="large" color={c.accent} />
          <Text style={{fontSize: fst(12), marginTop: fs(8), color: c.textSecondary, fontFamily: MONO}}>Loading...</Text>
        </View>
      );
    }

    return (
      <ScrollView  contentContainerStyle={{paddingBottom: fs(24)}} showsVerticalScrollIndicator={true} persistentScrollbar={true} fadingEdgeLength={0} indicatorStyle={isDark ? 'white' : 'black'} keyboardShouldPersistTaps="handled" scrollEnabled={scrollEnabled} nestedScrollEnabled>
        {loadedFromOffline && (
          <View style={{flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: fs(4), paddingVertical: fs(4), borderBottomWidth: 1, backgroundColor: c.warningSurface, borderBottomColor: c.warningBorder}}>
            <Icon name="cloud-off" size={fst(11)} color={c.warningDark} />
            <Text style={{fontSize: fst(11), fontWeight: '600', color: c.warningDark, fontFamily: MONO}}>Loaded from local data</Text>
          </View>
        )}

        {/* Info Section */}
        <View style={{paddingHorizontal: pad, paddingVertical: fs(16), borderBottomWidth: 1, borderBottomColor: c.border}}>
          {[
            {l: 'CUSTOMER', v: customerLabel},
            {l: 'PROJECT', v: projectLabel},
            {l: 'ORDER', v: orderLabel},
            {l: 'TICKET', v: ticketLabel},
            {l: 'RELEASED', v: ''},
          ].map(row => (
            <View key={row.l} style={{flexDirection: 'row', alignItems: 'center', paddingVertical: fs(6), gap: fs(8)}}>
              <Text style={{width: fs(108), fontSize: fst(11), fontWeight: '800', letterSpacing: 0.4, color: c.textPrimary, fontFamily: MONO}}>{row.l}</Text>
              <Text style={{flex: 1, fontSize: fst(13), fontWeight: '500', color: row.v ? c.textPrimary : c.textMuted, fontFamily: MONO}}>{row.v || '-'}</Text>
            </View>
          ))}
        </View>

        {/* Type Name + Signature + Submit */}
        <View style={{paddingHorizontal: pad, paddingVertical: fs(16)}}>
          <Text style={{fontSize: fst(11), fontWeight: '800', letterSpacing: 0.5, marginBottom: fs(5), color: c.textPrimary, fontFamily: MONO}}>TYPE NAME</Text>
          <TextInput
            style={{borderWidth: 1, borderColor: isDark ? '#4A4E55' : '#cfd6de', borderRadius: fs(6), paddingVertical: fs(9), paddingHorizontal: fs(10), fontSize: fst(14), color: c.textPrimary, backgroundColor: isDark ? '#3A3E44' : '#fff', fontFamily: MONO}}
            value={typeName}
            onChangeText={setTypeName}
            placeholder="Enter name"
            placeholderTextColor={c.textMuted}
          />

          {loadedSignature && !editingSignature ? (
            <SignaturePad onSignatureChange={handleSignatureChange} height={sigHeight} readOnly initialImage={loadedSignature} onEditPress={() => setEditingSignature(true)} minimal />
          ) : (
            <SignaturePad onSignatureChange={handleSignatureChange} height={sigHeight} onTouchStart={() => setScrollEnabled(false)} onTouchEnd={() => setScrollEnabled(true)} minimal clearRef={sigClearRef} />
          )}

          <TouchableOpacity onPress={() => { sigClearRef.current?.(); setSignature(null); setLoadedSignature(null); setEditingSignature(false); }} activeOpacity={0.7} style={{marginTop: fs(8)}}>
            <Text style={{fontSize: fst(12), fontWeight: '400', color: '#2f7ed0', fontFamily: MONO}}>Clear signature</Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={{marginTop: fs(16), paddingVertical: fs(16), borderRadius: 2, alignItems: 'center', justifyContent: 'center', backgroundColor: canSubmit ? '#157a15' : isDark ? '#4A5B6E' : '#cfd6de'}}
            activeOpacity={canSubmit ? 0.8 : 1} disabled={!canSubmit} onPress={handleSubmit}>
            {submitting ? (
              <ActivityIndicator size="small" color="#fff" />
            ) : (
              <Text style={{fontSize: fst(14), fontWeight: '800', letterSpacing: 1, color: canSubmit ? '#fff' : '#9E9E9E', fontFamily: MONO}}>
                {existingRelease && existingRelease.id > 0 ? 'UPDATE' : 'SUBMIT'}
              </Text>
            )}
          </TouchableOpacity>
        </View>
      </ScrollView>
    );
  };

  return (
    <>
      <ResponsiveModal visible={visible} onClose={onClose} maxWidth={modalMaxW} widthPercent={76} maxHeightPercent={85} avoidKeyboard>
        <View style={{flexDirection: 'row', alignItems: 'center', justifyContent: 'center', paddingVertical: fs(16), paddingHorizontal: pad, borderBottomWidth: 1, borderBottomColor: c.border}}>
          <Text style={{fontSize: fst(16), fontWeight: '800', letterSpacing: 0.5, flex: 1, textAlign: 'center', color: c.textPrimary, fontFamily: MONO}}>CURBLINE RELEASE</Text>
          <TouchableOpacity
            style={{width: fs(30), height: fs(30), borderWidth: 1.5, borderColor: isDark ? 'rgba(255,255,255,0.3)' : '#1a2230', backgroundColor: isDark ? 'rgba(255,255,255,0.1)' : '#fff', borderRadius: fs(5), justifyContent: 'center', alignItems: 'center', position: 'absolute', right: fs(16)}}
            onPress={onClose} activeOpacity={0.7} hitSlop={{top: 8, bottom: 8, left: 8, right: 8}}>
            <Text style={{fontSize: fst(13), fontWeight: '400', color: isDark ? '#fff' : '#1a2230', fontFamily: MONO}}>✕</Text>
          </TouchableOpacity>
        </View>
        {renderContent()}
      </ResponsiveModal>

      <ThemedAlert visible={alert !== null} type={alert?.type || 'success'} title={alert?.title || ''} message={alert?.message || ''} onClose={handleAlertClose} />
    </>
  );
}
