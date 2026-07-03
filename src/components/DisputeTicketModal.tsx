import React, {useState, useCallback, useEffect, useRef} from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  TextInput,
  ActivityIndicator,
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

export default function DisputeTicketModal({
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

  // Reset state when modal opens/closes or ticketId changes
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
        // Cache full signing data for offline use
        offlineStorage.cacheSigningData(ticketId, res.data);
        // Cache ticket info
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
        // Overlay any pending offline submit
        applyPendingOfflineData(ticketId);
      } catch (err: any) {
        if (cancelled) return;
        // API failed — try local cache
        const cached = offlineStorage.getCachedSigningData(
          ticketId,
        ) as SigningData | null;
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

    return () => {
      cancelled = true;
    };
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

  const canSubmit =
    typeName.trim().length > 0 &&
    signature !== null &&
    signature.length > 0 &&
    !submitting &&
    !isFormDisabled;

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
      const cached = offlineStorage.getCachedSigningData(
        ticketId,
      ) as SigningData | null;
      if (cached) {
        cached.status = {
          ...cached.status,
          is_disputed: true,
          dispute: {
            quantity: body.quantity,
            reason: body.reason,
            signed_name: body.signed_name,
            signature_image: body.signature_image,
          },
        };
        offlineStorage.cacheSigningData(ticketId, cached);
      }
    };
    try {
      if (!isOnline) {
        enqueueOffline(ticketId, 'dispute', body, 'dispute');
        updateSigningCache();
        setAlert({
          type: 'success',
          title: 'Saved Offline',
          message:
            'Dispute will be submitted automatically when connection is restored.',
        });
      } else {
        await ticketsApi.dispute(ticketId, body);
        updateSigningCache();
        setAlert({
          type: 'success',
          title: 'Success',
          message: 'Ticket disputed successfully.',
        });
      }
    } catch (err: any) {
      if (
        err?.message?.includes('Network request failed') ||
        err?.name === 'AbortError'
      ) {
        enqueueOffline(ticketId, 'dispute', body, 'dispute');
        updateSigningCache();
        setAlert({
          type: 'success',
          title: 'Saved Offline',
          message:
            'Dispute will be submitted automatically when connection is restored.',
        });
      } else {
        setAlert({
          type: 'error',
          title: 'Error',
          message: err.message || 'Failed to dispute ticket.',
        });
      }
    } finally {
      setSubmitting(false);
    }
  }, [
    canSubmit,
    ticketId,
    quantity,
    reason,
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

  const handleQuantityChange = (text: string) => {
    setQuantity(text.replace(/[^0-9.]/g, ''));
  };

  const {width: screenW, height: screenH} = useWindowDimensions();
  const sigHeight = isLandscape
    ? Math.round(screenH * 0.2)
    : Math.round(screenH * 0.18);
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

    const {products} = data;

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

        {/* Already disputed banner */}
        {alreadyDisputed && (
          <View style={[s.banner, {backgroundColor: c.errorSurface}]}>
            <Icon
              name="report-problem"
              size={ms(14)}
              color={c.error}
            />
            <Text style={[s.bannerText, {color: c.error}]}>
              This ticket has already been disputed.
            </Text>
          </View>
        )}

        {/* Info Section */}
        <View style={[s.infoSection, {borderBottomColor: c.border}]}>
          <View style={s.infoRow}>
            <Text style={[s.infoLabel, {color: c.textPrimary}]}>TICKET</Text>
            <Text style={[s.infoValue, {color: c.textPrimary}]}>
              {ticketInfo?.ticket_code || data.ticket?.ticket_code || '-'}
            </Text>
          </View>
          <View style={s.infoRow}>
            <Text style={[s.infoLabel, {color: c.textPrimary}]}>PRODUCT</Text>
            <Text style={[s.infoValue, {color: c.textPrimary}]}>
              {products.length > 0 ? products[0].description : '-'}
            </Text>
          </View>
          <View style={s.infoRow}>
            <Text style={[s.infoLabel, {color: c.textPrimary}]}>QUANTITY</Text>
            <View style={s.qtyRow}>
              <TextInput
                style={[
                  s.qtyInput,
                  {borderBottomColor: c.border, color: c.textPrimary},
                ]}
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
              style={[
                s.reasonInput,
                {borderBottomColor: c.border, color: c.textPrimary},
              ]}
              value={reason}
              onChangeText={setReason}
              placeholder="Enter reason"
              placeholderTextColor={c.textMuted}
              editable={!isFormDisabled}
            />
          </View>
        </View>

        {/* Separator */}
        <View style={[s.separator, {backgroundColor: c.border}]} />

        {/* Type Name + Signature + Submit */}
        <View style={s.signSection}>
          <Text style={[s.inputLabel, {color: c.textPrimary}]}>TYPE NAME</Text>
          <TextInput
            style={[
              s.typeNameInput,
              {borderBottomColor: c.border, color: c.textPrimary},
            ]}
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

          <TouchableOpacity
            onPress={() => {
              sigClearRef.current?.();
              setSignature(null);
              setLoadedSignature(null);
              setEditingSignature(false);
            }}
            activeOpacity={0.7}
            style={{marginTop: wp(3)}}>
            <Text
              style={{
                fontSize: ms(8),
                fontWeight: '600',
                color: c.primary,
              }}>
              Clear signature
            </Text>
          </TouchableOpacity>

          {!isFormDisabled && (
            <TouchableOpacity
              style={[
                s.disputeBtn,
                {
                  backgroundColor: canSubmit
                    ? '#8a1414'
                    : isDark
                      ? '#4A5B6E'
                      : '#cfd6de',
                },
              ]}
              activeOpacity={canSubmit ? 0.8 : 1}
              disabled={!canSubmit}
              onPress={handleDispute}>
              {submitting ? (
                <ActivityIndicator size="small" color="#FFFFFF" />
              ) : (
                <Text
                  style={[
                    s.disputeBtnText,
                    {color: canSubmit ? '#FFFFFF' : '#9E9E9E'},
                  ]}>
                  DISPUTE
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
        maxWidth={
          isLandscape
            ? Math.round(screenW * 0.75)
            : Math.round(screenW * 0.95)
        }
        widthPercent={isLandscape ? 75 : 95}
        maxHeightPercent={isLandscape ? 92 : 90}
        avoidKeyboard>
        {/* Header */}
        <View style={[s.header, {borderBottomColor: c.border}]}>
          <Text style={[s.headerTitle, {color: c.textPrimary}]}>
            DISPUTE LOAD
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

    // Info Section
    infoSection: {
      paddingHorizontal: wp(10),
      paddingVertical: wp(5),
      borderBottomWidth: 0,
    },
    infoRow: {
      flexDirection: 'row',
      alignItems: 'center',
      flexWrap: 'wrap',
      paddingVertical: wp(4),
      gap: wp(6),
    },
    infoLabel: {
      fontSize: ms(8),
      fontWeight: '800',
      minWidth: wp(55),
    },
    infoValue: {
      fontSize: ms(8),
      fontWeight: '500',
      flex: 1,
      minWidth: 60,
    },
    qtyRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: wp(6),
    },
    qtyInput: {
      width: wp(60),
      borderBottomWidth: 1,
      paddingVertical: wp(3),
      fontSize: ms(9),
      fontWeight: '600',
    },
    qtyUnit: {
      fontSize: ms(9),
      fontWeight: '600',
    },
    reasonInput: {
      flex: 1,
      borderBottomWidth: 1,
      paddingVertical: wp(3),
      fontSize: ms(9),
    },

    // Separator
    separator: {
      height: StyleSheet.hairlineWidth,
      marginHorizontal: wp(10),
    },

    // Sign section
    signSection: {
      paddingHorizontal: wp(10),
      paddingVertical: wp(5),
    },
    inputLabel: {
      fontSize: ms(7),
      fontWeight: '800',
      marginBottom: wp(1),
      marginTop: wp(3),
    },
    typeNameInput: {
      borderBottomWidth: 1,
      paddingVertical: wp(3),
      fontSize: ms(9),
      marginBottom: wp(4),
    },

    // Dispute button
    disputeBtn: {
      marginTop: wp(6),
      paddingVertical: wp(7),
      borderRadius: 2,
      minHeight: wp(30),
      alignItems: 'center',
      justifyContent: 'center',
      width: '100%',
    },
    disputeBtnText: {
      fontSize: ms(8),
      fontWeight: '800',
      letterSpacing: 1,
    },
  });
