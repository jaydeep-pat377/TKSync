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
  KeyboardAvoidingView,
  useWindowDimensions,
} from 'react-native';
import ResponsiveModal from './ResponsiveModal';
import SignaturePad from './SignaturePad';
import ThemedAlert from './ThemedAlert';
import Icon from './Icon';
import {useTheme} from '../contexts/ThemeContext';
import {wp, ms} from '../utils/responsive';
import {ticketsApi} from '../services/api';
import type {SigningData} from '../services/api';
import {offlineStorage} from '../services/offlineStorage';
import {useOfflineSync} from '../contexts/OfflineSyncContext';

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
  const s = createS();
  const {c, isDark} = useTheme();
  const {isOnline, enqueueOffline} = useOfflineSync();

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

  // Reset state when modal opens/closes or ticketId changes
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
        // Cache full signing data for offline use
        offlineStorage.cacheSigningData(ticketId, res.data);
        // Cache ticket info
        if (ticketInfo) {
          offlineStorage.cacheCurblineTicketInfo(ticketId, ticketInfo);
        }
        const accepted = res.data?.status?.accepted;
        if (accepted) {
          if (accepted.email) setEmail(accepted.email);
          if (accepted.customer_notes)
            setCustomerNotes(accepted.customer_notes);
          if (accepted.signed_name) setTypeName(accepted.signed_name);
          if (accepted.signature_image) {
            setSignature(accepted.signature_image);
            setLoadedSignature(accepted.signature_image);
          }
        }
        // Overlay any pending offline submit
        applyPendingOfflineData(ticketId);
      } catch (err: any) {
        if (cancelled) return;
        // API failed - try local cache
        const cached = offlineStorage.getCachedSigningData(
          ticketId,
        ) as SigningData | null;
        if (cached) {
          setData(cached);
          const accepted = cached.status?.accepted;
          if (accepted) {
            if (accepted.email) setEmail(accepted.email);
            if (accepted.customer_notes)
              setCustomerNotes(accepted.customer_notes);
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

    return () => {
      cancelled = true;
    };
  }, [visible, ticketId]);

  function applyPendingOfflineData(tid: number) {
    const pending = offlineStorage.getPendingForTicket(tid, 'sign');
    if (pending.length > 0) {
      const latest = pending[pending.length - 1];
      if (latest.body.email) setEmail(latest.body.email);
      if (latest.body.customer_notes)
        setCustomerNotes(latest.body.customer_notes);
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
  const isFormDisabled = alreadySigned || alreadyDisputed;

  const isEmailValid = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim());
  const isNotesValid = customerNotes.trim().length > 0;
  const isNameValid = typeName.trim().length > 0;
  const isSigned = signature !== null && signature.length > 0;
  const canSubmit =
    isEmailValid &&
    isNotesValid &&
    isNameValid &&
    isSigned &&
    !submitting &&
    !isFormDisabled;

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
      const cached = offlineStorage.getCachedSigningData(
        ticketId,
      ) as SigningData | null;
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
        setAlert({
          type: 'success',
          title: 'Saved Offline',
          message:
            'Ticket will be signed automatically when connection is restored.',
        });
      } else {
        await ticketsApi.sign(ticketId, body);
        updateSigningCache();
        setAlert({
          type: 'success',
          title: 'Success',
          message: 'Ticket signed successfully.',
        });
      }
    } catch (err: any) {
      if (
        err?.message?.includes('Network request failed') ||
        err?.name === 'AbortError'
      ) {
        enqueueOffline(ticketId, 'sign', body, 'sign');
        updateSigningCache();
        setAlert({
          type: 'success',
          title: 'Saved Offline',
          message:
            'Ticket will be signed automatically when connection is restored.',
        });
      } else {
        setAlert({
          type: 'error',
          title: 'Error',
          message: err.message || 'Failed to sign ticket.',
        });
      }
    } finally {
      setSubmitting(false);
    }
  }, [
    canSubmit,
    ticketId,
    email,
    customerNotes,
    typeName,
    signature,
    isOnline,
    enqueueOffline,
  ]);

  const handleAlertClose = useCallback(() => {
    const wasSuccess = alert?.type === 'success';
    setAlert(null);
    if (wasSuccess) onClose();
  }, [alert, onClose]);

  const {width: screenW, height: screenH} = useWindowDimensions();
  const sigHeight = isLandscape ? Math.round(screenH * 0.2) : Math.round(screenH * 0.18);
  const scrollMaxH = Math.round(screenH * (isLandscape ? 0.72 : 0.75));

  // Render modal content
  const renderContent = () => {
    // Loading state
    if (loading) {
      return (
        <View style={s.centerContent}>
          <ActivityIndicator size="large" color={c.accent} />
          <Text style={[s.loadingText, {color: c.textSecondary}]}>
            Loading ticket...
          </Text>
        </View>
      );
    }

    // Error state
    if (loadError || !data) {
      return (
        <View style={s.centerContent}>
          <Icon name="error-outline" size={ms(36)} color={c.error} />
          <Text style={[s.errorText, {color: c.textPrimary}]}>
            {loadError || 'No data available.'}
          </Text>
          <TouchableOpacity
            style={[s.retryBtn, {backgroundColor: c.accent}]}
            onPress={onClose}>
            <Text style={[s.retryBtnText, {color: c.textOnPrimary}]}>
              CLOSE
            </Text>
          </TouchableOpacity>
        </View>
      );
    }

    const {products, legal} = data;

    return (
        <ScrollView
          style={{maxHeight: scrollMaxH}}
          contentContainerStyle={s.scrollContent}
          showsVerticalScrollIndicator={true}
          persistentScrollbar
          keyboardShouldPersistTaps="handled"
          scrollEnabled={scrollEnabled}
          nestedScrollEnabled>
          {/* Offline banner */}
          {loadedFromOffline && (
            <View
              style={[
                s.offlineBanner,
                {
                  backgroundColor: c.warningSurface,
                  borderBottomColor: c.warningBorder,
                },
              ]}>
              <Icon name="cloud-off" size={ms(11)} color={c.warningDark} />
              <Text style={[s.offlineBannerText, {color: c.warningDark}]}>
                Loaded from local data
              </Text>
            </View>
          )}

          {/* Already signed/disputed banner */}
          {isFormDisabled && (
            <View
              style={[
                s.banner,
                {
                  backgroundColor: alreadySigned
                    ? c.successSurface
                    : c.errorSurface,
                },
              ]}>
              <Icon
                name={alreadySigned ? 'check-circle' : 'report-problem'}
                size={ms(14)}
                color={alreadySigned ? c.success : c.error}
              />
              <Text
                style={[
                  s.bannerText,
                  {color: alreadySigned ? c.success : c.error},
                ]}>
                {alreadySigned
                  ? 'This ticket has already been signed.'
                  : 'This ticket has been disputed.'}
              </Text>
            </View>
          )}

          {/* Caution Section */}
          <View style={[s.section, {borderBottomColor: c.border}]}>
            <Text style={[s.sectionTitle, {color: c.textPrimary}]}>
              CAUTION
            </Text>
            <Text style={[s.bodyText, {color: c.textPrimary}]}>
              {legal.caution ? legal.caution.charAt(0).toUpperCase() + legal.caution.slice(1).toLowerCase() : ''}
            </Text>
          </View>

          {/* Products Table */}
          <View style={[s.section, {borderBottomColor: c.border}]}>
            <Text style={[s.sectionTitle, {color: c.textPrimary}]}>
              PRODUCTS
            </Text>

            {/* Table Header */}
            <View
              style={[
                s.tableRow,
                s.tableHeader,
                {borderBottomColor: c.textPrimary, borderTopWidth: 2, borderTopColor: c.primary, paddingTop: wp(4)},
              ]}>
              <Text style={[s.colCode, s.thText, {color: c.textPrimary}]}>
                CODE
              </Text>
              <Text style={[s.colDesc, s.thText, {color: c.textPrimary}]}>
                DESCRIPTION
              </Text>
              <Text style={[s.colQty, s.thText, {color: c.textPrimary}]}>
                QTY
              </Text>
              <Text style={[s.colUnit, s.thText, {color: c.textPrimary}]}>
                UNIT
              </Text>
            </View>

            {/* Table Body */}
            {products.map((row, i) => (
              <View
                key={`${row.code}-${i}`}
                style={[s.tableRow, {borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: c.borderLight}]}>
                <Text style={[s.colCode, s.tdText, {color: c.textPrimary}]}>
                  {row.code}
                </Text>
                <Text style={[s.colDesc, s.tdText, {color: c.textPrimary}]}>
                  {row.description}
                </Text>
                <Text style={[s.colQty, s.tdText, {color: c.textPrimary}]}>
                  {row.quantity != null ? row.quantity : '-'}
                </Text>
                <Text style={[s.colUnit, s.tdText, {color: c.textPrimary}]}>
                  {row.unit || '-'}
                </Text>
              </View>
            ))}
          </View>

          {/* Email Mobile Ticket */}
          <View style={[s.section, {borderBottomColor: c.border}]}>
            <Text style={[s.sectionTitle, {color: c.textPrimary}]}>
              EMAIL MOBILE TICKET
            </Text>

            <Text style={[s.inputLabel, {color: c.textPrimary}]}>EMAIL ADDRESS</Text>
            <TextInput
              style={[s.inputBox, {borderColor: c.border, color: c.textPrimary}]}
              value={email}
              onChangeText={setEmail}
              keyboardType="email-address"
              autoCapitalize="none"
              placeholder="name@example.com"
              placeholderTextColor={c.textMuted}
              editable={!isFormDisabled}
            />

            <Text style={[s.inputLabel, {color: c.textPrimary, marginTop: wp(6)}]}>CUSTOMER NOTES</Text>
            <TextInput
              style={[s.inputBox, {borderColor: c.border, color: c.textPrimary}]}
              value={customerNotes}
              onChangeText={setCustomerNotes}
              placeholder="Enter notes"
              placeholderTextColor={c.textMuted}
              editable={!isFormDisabled}
            />
          </View>

          {/* Terms & Conditions */}
          <View style={[s.section, {borderTopWidth: 1, borderTopColor: c.border}]}>
            <Text style={[s.termsText, {color: c.textPrimary}]}>
              {legal.terms_en}
            </Text>
            {legal.terms_fr ? (
              <Text
                style={[
                  s.termsText,
                  {color: c.textPrimary, marginTop: wp(6)},
                ]}>
                {legal.terms_fr}
              </Text>
            ) : null}
          </View>

          {/* Type Name + Signature + Submit */}
          <View style={[s.signSection, {borderTopWidth: 1, borderTopColor: c.border}]}>
            <Text style={[s.inputLabel, {color: c.textPrimary}]}>TYPE NAME</Text>
            <TextInput
              style={[s.inputBox, {borderColor: c.border, color: c.textPrimary}]}
              value={typeName}
              onChangeText={setTypeName}
              placeholder="Enter name"
              placeholderTextColor={c.textMuted}
              editable={!isFormDisabled}
            />

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

            <TouchableOpacity onPress={() => { sigClearRef.current?.(); setSignature(null); setLoadedSignature(null); setEditingSignature(false); }} activeOpacity={0.7} style={{marginTop: wp(3)}}>
              <Text style={{fontSize: ms(8), fontWeight: '600', color: c.primary}}>Clear signature</Text>
            </TouchableOpacity>

            {!isFormDisabled && (
              <TouchableOpacity
                style={[
                  s.submitBtn,
                  {
                    backgroundColor: canSubmit ? '#157a15' : isDark ? '#4A5B6E' : '#cfd6de',
                  },
                ]}
                activeOpacity={canSubmit ? 0.8 : 1}
                disabled={!canSubmit}
                onPress={handleSubmit}>
                {submitting ? (
                  <ActivityIndicator size="small" color={c.textOnPrimary} />
                ) : (
                  <Text
                    style={[
                      s.submitBtnText,
                      {color: canSubmit ? '#FFFFFF' : '#9E9E9E'},
                    ]}>
                    SUBMIT
                  </Text>
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
        maxWidth={isLandscape ? Math.round(screenW * 0.75) : Math.round(screenW * 0.95)}
        widthPercent={isLandscape ? 75 : 95}
        maxHeightPercent={isLandscape ? 92 : 90}
        avoidKeyboard>
        {/* Header */}
        <View style={[s.header, {borderBottomColor: c.border}]}>
          <Text style={[s.headerTitle, {color: c.textPrimary}]}>
            SIGN & ACCEPT TICKET
          </Text>
          <TouchableOpacity
            style={[s.closeBtn, {backgroundColor: c.surface}]}
            onPress={onClose}
            activeOpacity={0.7}
            hitSlop={{top: 8, bottom: 8, left: 8, right: 8}}>
            <Icon name="close" size={ms(12)} color={c.textSecondary} />
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

const createS = () =>
  StyleSheet.create({
    flex1: {flex: 1},
    centerContent: {
      flex: 1,
      justifyContent: 'center',
      alignItems: 'center',
      paddingVertical: wp(30),
      paddingHorizontal: wp(16),
    },

    // Loading / Error
    loadingText: {fontSize: ms(9), marginTop: wp(8)},
    errorText: {
      fontSize: ms(9),
      fontWeight: '600',
      marginTop: wp(8),
      textAlign: 'center',
      paddingHorizontal: wp(12),
    },
    retryBtn: {
      marginTop: wp(10),
      paddingVertical: wp(6),
      paddingHorizontal: wp(16),
      borderRadius: wp(6),
    },
    retryBtnText: {fontSize: ms(8), fontWeight: '800'},

    // Header
    header: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      paddingVertical: wp(5),
      paddingHorizontal: wp(8),
      borderBottomWidth: 0,
    },
    headerTitle: {
      fontSize: ms(10),
      fontWeight: '800',
      letterSpacing: 0.5,
      flex: 1,
      textAlign: 'center',
    },
    closeBtn: {
      width: wp(20),
      height: wp(20),
      borderRadius: wp(10),
      justifyContent: 'center',
      alignItems: 'center',
      position: 'absolute',
      right: wp(6),
    },

    // Banners
    offlineBanner: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      gap: wp(4),
      paddingVertical: wp(4),
      borderBottomWidth: 1,
    },
    offlineBannerText: {fontSize: ms(7), fontWeight: '600'},
    banner: {
      flexDirection: 'row',
      alignItems: 'center',
      paddingVertical: wp(6),
      paddingHorizontal: wp(8),
      gap: wp(6),
    },
    bannerText: {fontSize: ms(8), fontWeight: '700', flex: 1},

    // Scroll
    scrollContent: {paddingBottom: wp(8)},

    // Section
    section: {
      paddingHorizontal: wp(10),
      paddingVertical: wp(5),
      borderBottomWidth: 0,
    },
    sectionTitle: {
      fontSize: ms(8),
      fontWeight: '800',
      textAlign: 'center',
      marginBottom: wp(3),
      letterSpacing: 0.3,
    },

    // Body text
    bodyText: {fontSize: ms(6), fontWeight: '400', lineHeight: ms(10)},

    // Table
    tableRow: {
      flexDirection: 'row',
      alignItems: 'center',
      paddingVertical: wp(3),
      borderBottomWidth: 0,
    },
    tableHeader: {borderBottomWidth: 1.5, paddingBottom: wp(3)},
    colCode: {width: wp(45)},
    colDesc: {flex: 1, paddingRight: wp(6)},
    colQty: {width: wp(35), textAlign: 'right'},
    colUnit: {width: wp(28), textAlign: 'right'},
    thText: {fontSize: ms(7), fontWeight: '800', letterSpacing: 0.3},
    tdText: {fontSize: ms(7), fontWeight: '600'},

    // Input
    inputLabel: {
      fontSize: ms(7),
      fontWeight: '800',
      marginBottom: wp(1),
      marginTop: wp(3),
    },
    inputBox: {
      borderWidth: 1,
      borderRadius: wp(3),
      paddingVertical: wp(5),
      paddingHorizontal: wp(6),
      fontSize: ms(7),
    },

    // Terms
    termsText: {fontSize: ms(6), fontWeight: '400', lineHeight: ms(9)},

    // Sign section
    signSection: {paddingHorizontal: wp(10), paddingVertical: wp(5)},

    // Submit
    submitBtn: {
      marginTop: wp(6),
      paddingVertical: wp(7),
      borderRadius: 2,
      minHeight: wp(30),
      alignItems: 'center',
      justifyContent: 'center',
      width: '100%',
    },
    submitBtnText: {
      fontSize: ms(8),
      fontWeight: '800',
      letterSpacing: 1,
    },
  });
