import React, {useState, useCallback, useEffect, useRef} from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  TextInput,
  ActivityIndicator,
  Animated,
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
import {useScrollIndicator} from './ScrollIndicator';

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

export default function AcceptTicketModal({
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

  const scrollRef = useRef<ScrollView>(null);
  const [data, setData] = useState<SigningData | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [email, setEmail] = useState('');
  const [customerNotes, setCustomerNotes] = useState('');
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
  const scrollIndicator = useScrollIndicator();

  useEffect(() => {
    if (!visible) {
      setData(null);
      setLoading(true);
      setLoadError(null);
      setEmail('');
      setCustomerNotes('');
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
        const accepted = res.data?.status?.accepted;
        if (accepted) {
          if (accepted.email) setEmail(accepted.email);
          if (accepted.customer_notes) setCustomerNotes(accepted.customer_notes);
          if (accepted.signed_name) setTypeName(accepted.signed_name);
          if (accepted.signature_image) {
            setSignature(accepted.signature_image);
            setLoadedSignature(accepted.signature_image);
          }
        }
        applyPendingOfflineData(ticketId);
      } catch (err: any) {
        if (cancelled) return;
        const cached = offlineStorage.getCachedSigningData(ticketId) as SigningData | null;
        if (cached) {
          setData(cached);
          const accepted = cached.status?.accepted;
          if (accepted) {
            if (accepted.email) setEmail(accepted.email);
            if (accepted.customer_notes) setCustomerNotes(accepted.customer_notes);
            if (accepted.signed_name) setTypeName(accepted.signed_name);
            if (accepted.signature_image) {
              setSignature(accepted.signature_image);
              setLoadedSignature(accepted.signature_image);
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

  useEffect(() => {
    if (data && scrollRef.current) {
      setTimeout(() => scrollRef.current?.flashScrollIndicators(), 300);
    }
  }, [data]);

  function applyPendingOfflineData(tid: number) {
    const pending = offlineStorage.getPendingForTicket(tid, 'sign', 'sign');
    if (pending.length > 0) {
      const latest = pending[pending.length - 1];
      if (latest.body.email) setEmail(latest.body.email);
      if (latest.body.customer_notes) setCustomerNotes(latest.body.customer_notes);
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

  const alreadySigned = data?.status?.is_signed === true;
  const alreadyDisputed = data?.status?.is_disputed === true;
  const alreadySubmitted = alreadySigned || alreadyDisputed;

  const isEmailValid = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim());
  const isNotesValid = customerNotes.trim().length > 0;
  const isNameValid = typeName.trim().length > 0;
  const isSigned = signature !== null && signature.length > 0;
  const canSubmit = isEmailValid && isNotesValid && isNameValid && isSigned && !submitting;

  const handleSubmit = useCallback(async () => {
    if (!canSubmit || !ticketId || !signature) return;
    setSubmitting(true);
    const body = {
      email: email.trim() || undefined,
      customer_notes: customerNotes.trim() || undefined,
      signed_name: typeName.trim(),
      signature_image: signature,
    };
    const updateSigningCache = () => {
      const cached = offlineStorage.getCachedSigningData(ticketId) as SigningData | null;
      if (cached) {
        cached.status = {
          ...cached.status,
          is_signed: true,
          accepted: {
            email: body.email || null,
            customer_notes: body.customer_notes || null,
            signed_name: body.signed_name,
            signature_image: body.signature_image,
          },
        };
        offlineStorage.cacheSigningData(ticketId, cached);
      }
    };
    try {
      if (!isOnline) {
        enqueueOffline(ticketId, 'sign', body, 'sign');
        updateSigningCache();
        setAlert({ type: 'success', title: 'Saved Offline', message: 'Ticket will be signed automatically when connection is restored.' });
      } else {
        await ticketsApi.sign(ticketId, body);
        updateSigningCache();
        setAlert({ type: 'success', title: 'Success', message: 'Ticket signed successfully.' });
      }
    } catch (err: any) {
      if (err?.message?.includes('Network request failed') || err?.name === 'AbortError') {
        enqueueOffline(ticketId, 'sign', body, 'sign');
        updateSigningCache();
        setAlert({ type: 'success', title: 'Saved Offline', message: 'Ticket will be signed automatically when connection is restored.' });
      } else {
        setAlert({ type: 'error', title: 'Error', message: err.message || 'Failed to sign ticket.' });
      }
    } finally {
      setSubmitting(false);
    }
  }, [canSubmit, ticketId, email, customerNotes, typeName, signature, isOnline, enqueueOffline]);

  const handleAlertClose = useCallback(() => {
    const wasSuccess = alert?.type === 'success';
    setAlert(null);
    if (wasSuccess) onClose();
  }, [alert, onClose]);

  const sigHeight = fs(170);
  const scrollMaxH = Math.round(screenH * (isLandscape ? 0.72 : 0.75));
  const pad = fs(24); // matches .tkSection padding

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

    const {products, legal} = data;

    return (
      <View style={{flex: 0, maxHeight: scrollMaxH}}>
      <ScrollView
        {...scrollIndicator.scrollViewProps}
        ref={scrollRef}
        contentContainerStyle={{paddingBottom: fs(60)}}
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

        {/* Already signed/disputed — info only */}
        {alreadySubmitted && (
          <View style={{flexDirection: 'row', alignItems: 'center', paddingVertical: fs(6), paddingHorizontal: pad, gap: fs(6), backgroundColor: c.warningSurface}}>
            <Icon name="info" size={fst(14)} color={c.warningDark} />
            <Text style={{fontSize: fst(12), fontWeight: '700', flex: 1, color: c.warningDark, fontFamily: MONO}}>
              {alreadySigned ? 'This ticket has been signed. You can edit and resubmit.' : 'This ticket has been disputed. You can edit and resubmit.'}
            </Text>
          </View>
        )}

        {/* Caution — .tkCenterHd + .tkSmall */}
        <View style={{paddingHorizontal: pad, paddingVertical: fs(16), borderBottomWidth: 1, borderBottomColor: c.border}}>
          <Text style={{fontSize: fst(13), fontWeight: '800', textAlign: 'center', letterSpacing: 0.5, marginBottom: fs(10), color: c.textPrimary, fontFamily: MONO}}>CAUTION</Text>
          <Text style={{fontSize: fst(12), fontWeight: '400', lineHeight: fst(12) * 1.5, color: c.textPrimary, fontFamily: MONO}}>
            {legal.caution ? legal.caution.charAt(0).toUpperCase() + legal.caution.slice(1).toLowerCase() : ''}
          </Text>
        </View>

        {/* Products — .tkProducts */}
        <View style={{paddingHorizontal: pad, paddingVertical: fs(16), borderBottomWidth: 1, borderBottomColor: c.border}}>
          <Text style={{fontSize: fst(13), fontWeight: '800', textAlign: 'center', letterSpacing: 0.5, marginBottom: fs(6), color: c.textPrimary, fontFamily: MONO}}>PRODUCTS</Text>

          {/* Table header */}
          <View style={{flexDirection: 'row', alignItems: 'center', paddingVertical: fs(6), borderTopWidth: 1, borderTopColor: c.border, borderBottomWidth: 2, borderBottomColor: '#4e8a2f', backgroundColor: isDark ? '#3A3E44' : '#f4f6f8'}}>
            <Text style={{width: '15%', fontSize: fst(12), fontWeight: '800', letterSpacing: 0.4, color: isDark ? '#C8CACD' : '#3a4350', fontFamily: MONO}}>CODE</Text>
            <Text style={{flex: 1, fontSize: fst(12), fontWeight: '800', letterSpacing: 0.4, color: isDark ? '#C8CACD' : '#3a4350', fontFamily: MONO}}>DESCRIPTION</Text>
            <Text style={{width: '12%', fontSize: fst(12), fontWeight: '800', letterSpacing: 0.4, color: '#3a4350', textAlign: 'right', fontFamily: MONO}}>QTY</Text>
            <Text style={{width: '10%', fontSize: fst(12), fontWeight: '800', letterSpacing: 0.4, color: '#3a4350', textAlign: 'right', fontFamily: MONO}}>UNIT</Text>
          </View>

          {/* Table rows */}
          {products.map((row, i) => (
            <View key={`${row.code}-${i}`} style={{flexDirection: 'row', alignItems: 'center', paddingVertical: fs(9), borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: c.borderLight, backgroundColor: i % 2 === 1 ? (isDark ? '#353840' : '#fafbfc') : 'transparent'}}>
              <Text style={{width: '15%', fontSize: fst(13), fontWeight: '500', color: c.textPrimary, fontFamily: MONO}}>{row.code}</Text>
              <Text style={{flex: 1, fontSize: fst(13), fontWeight: '600', color: c.textPrimary, fontFamily: MONO}}>{row.description}</Text>
              <Text style={{width: '12%', fontSize: fst(13), fontWeight: '500', color: c.textPrimary, textAlign: 'right', fontFamily: MONO}}>{row.quantity != null ? row.quantity : '-'}</Text>
              <Text style={{width: '10%', fontSize: fst(13), fontWeight: '500', color: c.textPrimary, textAlign: 'right', fontFamily: MONO}}>{row.unit || '-'}</Text>
            </View>
          ))}
        </View>

        {/* Email — .tkField */}
        <View style={{paddingHorizontal: pad, paddingVertical: fs(16), borderBottomWidth: 1, borderBottomColor: c.border}}>
          <Text style={{fontSize: fst(13), fontWeight: '800', textAlign: 'center', letterSpacing: 0.5, marginBottom: fs(10), color: c.textPrimary, fontFamily: MONO}}>EMAIL MOBILE TICKET</Text>

          <Text style={{fontSize: fst(11), fontWeight: '800', letterSpacing: 0.5, marginBottom: fs(5), color: c.textPrimary, fontFamily: MONO}}>EMAIL ADDRESS</Text>
          <TextInput
            style={{borderWidth: 1, borderColor: isDark ? '#4A4E55' : '#cfd6de', borderRadius: fs(6), paddingVertical: fs(9), paddingHorizontal: fs(10), fontSize: fst(14), color: c.textPrimary, backgroundColor: isDark ? '#3A3E44' : '#fff'}}
            value={email}
            onChangeText={setEmail}
            keyboardType="email-address"
            autoCapitalize="none"
            placeholder="name@example.com"
            placeholderTextColor={c.textMuted}
            editable
          />

          <Text style={{fontSize: fst(11), fontWeight: '800', letterSpacing: 0.5, marginBottom: fs(5), marginTop: fs(14), color: c.textPrimary, fontFamily: MONO}}>CUSTOMER NOTES</Text>
          <TextInput
            style={{borderWidth: 1, borderColor: isDark ? '#4A4E55' : '#cfd6de', borderRadius: fs(6), paddingVertical: fs(9), paddingHorizontal: fs(10), fontSize: fst(14), color: c.textPrimary, backgroundColor: isDark ? '#3A3E44' : '#fff'}}
            value={customerNotes}
            onChangeText={setCustomerNotes}
            placeholder="Enter notes"
            placeholderTextColor={c.textMuted}
            editable
          />
        </View>

        {/* Terms — .tkTerms */}
        <View style={{paddingHorizontal: pad, paddingVertical: fs(14), borderBottomWidth: 1, borderBottomColor: c.border}}>
          <Text style={{fontSize: fst(11), fontWeight: '400', lineHeight: fst(11) * 1.5, color: isDark ? '#8A8D93' : '#5a6573', fontFamily: MONO}}>{legal.terms_en}</Text>
          {legal.terms_fr ? (
            <Text style={{fontSize: fst(11), fontWeight: '400', lineHeight: fst(11) * 1.5, color: '#5a6573', marginTop: fs(6), fontFamily: MONO}}>{legal.terms_fr}</Text>
          ) : null}
        </View>

        {/* Type Name + Signature + Submit */}
        <View style={{paddingHorizontal: pad, paddingVertical: fs(16)}}>
          <Text style={{fontSize: fst(11), fontWeight: '800', letterSpacing: 0.5, marginBottom: fs(5), color: c.textPrimary, fontFamily: MONO}}>TYPE NAME</Text>
          <TextInput
            style={{borderWidth: 1, borderColor: isDark ? '#4A4E55' : '#cfd6de', borderRadius: fs(6), paddingVertical: fs(9), paddingHorizontal: fs(10), fontSize: fst(14), color: c.textPrimary, backgroundColor: isDark ? '#3A3E44' : '#fff'}}
            value={typeName}
            onChangeText={setTypeName}
            placeholder="Enter name"
            placeholderTextColor={c.textMuted}
            editable
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

          {/* Clear — .tkClear */}
          <TouchableOpacity onPress={() => { sigClearRef.current?.(); setSignature(null); setLoadedSignature(null); setEditingSignature(false); }} activeOpacity={0.7} style={{marginTop: fs(8)}}>
            <Text style={{fontSize: fst(12), fontWeight: '400', color: '#2f7ed0', fontFamily: MONO}}>Clear signature</Text>
          </TouchableOpacity>

          {/* Submit — .tkSubmit */}
          <TouchableOpacity
            style={{marginTop: fs(16), paddingVertical: fs(16), borderRadius: 2, alignItems: 'center', justifyContent: 'center', backgroundColor: canSubmit ? '#157a15' : isDark ? '#4A5B6E' : '#cfd6de'}}
            activeOpacity={canSubmit ? 0.8 : 1}
            disabled={!canSubmit}
            onPress={handleSubmit}>
            {submitting ? (
              <ActivityIndicator size="small" color="#fff" />
            ) : (
              <Text style={{fontSize: fst(14), fontWeight: '800', letterSpacing: 1, color: canSubmit ? '#fff' : '#9E9E9E', fontFamily: MONO}}>{alreadySubmitted ? 'UPDATE' : 'SUBMIT'}</Text>
            )}
          </TouchableOpacity>
        </View>
      </ScrollView>
      {scrollIndicator.canScroll && (
        <View style={{position: 'absolute', right: 1, top: 0, bottom: 0, width: scrollIndicator.trackW, backgroundColor: isDark ? 'rgba(255,255,255,0.1)' : 'rgba(0,0,0,0.08)', borderRadius: 2}} pointerEvents="none">
          <Animated.View style={{width: scrollIndicator.trackW, height: scrollIndicator.thumbH, borderRadius: 2, backgroundColor: isDark ? 'rgba(255,255,255,0.4)' : 'rgba(0,0,0,0.3)', transform: [{translateY: scrollIndicator.translateY}]}} />
        </View>
      )}
      </View>
    );
  };

  // Modal width — compact, matching MobileTicketModal proportions
  // Match MobileTicketModal sizing: 76% width, 92% height
  const safeW = screenW - (insets?.left || 0) - (insets?.right || 0);
  const modalMaxW = Math.round(safeW * 0.76);

  return (
    <>
      <ResponsiveModal
        visible={visible}
        onClose={onClose}
        maxWidth={modalMaxW}
        widthPercent={76}
        maxHeightPercent={85}
        avoidKeyboard>
        {/* Header — .tkAcceptHead */}
        <View style={{flexDirection: 'row', alignItems: 'center', justifyContent: 'center', paddingVertical: fs(16), paddingHorizontal: pad, borderBottomWidth: 1, borderBottomColor: c.border}}>
          <Text style={{fontSize: fst(16), fontWeight: '800', letterSpacing: 0.5, flex: 1, textAlign: 'center', color: c.textPrimary, fontFamily: MONO}}>SIGN & ACCEPT TICKET</Text>
          <TouchableOpacity
            style={{width: fs(30), height: fs(30), borderWidth: 1.5, borderColor: isDark ? 'rgba(255,255,255,0.3)' : '#1a2230', backgroundColor: isDark ? 'rgba(255,255,255,0.1)' : '#fff', borderRadius: fs(5), justifyContent: 'center', alignItems: 'center', position: 'absolute', right: fs(16)}}
            onPress={onClose}
            activeOpacity={0.7}
            hitSlop={{top: 8, bottom: 8, left: 8, right: 8}}>
            <Text style={{fontSize: fst(13), fontWeight: '400', color: isDark ? '#fff' : '#1a2230', fontFamily: MONO}}>✕</Text>
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
