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

export default function CurblineReleaseModal({
  visible,
  onClose,
  ticketId,
  ticketInfo,
  isLandscape,
}: Props) {
  const s = createS();
  const {c, isDark} = useTheme();
  const {isOnline, enqueueOffline} = useOfflineSync();

  const [loading, setLoading] = useState(true);
  const [typeName, setTypeName] = useState('');
  const [signature, setSignature] = useState<string | null>(null);
  const [scrollEnabled, setScrollEnabled] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [existingRelease, setExistingRelease] = useState<{
    id: number;
    signed_name: string;
    signature_image: string;
  } | null>(null);
  const [editingSignature, setEditingSignature] = useState(false);
  const [loadedFromOffline, setLoadedFromOffline] = useState(false);
  const [loadedSignature, setLoadedSignature] = useState<string | null>(null);
  const sigClearRef = useRef<(() => void) | null>(null);
  const [alert, setAlert] = useState<{
    type: 'success' | 'error';
    title: string;
    message: string;
  } | null>(null);

  // Reset state when modal opens/closes or ticketId changes
  useEffect(() => {
    if (!visible) {
      setLoading(true);
      setTypeName('');
      setSignature(null);
      setScrollEnabled(true);
      setSubmitting(false);
      setExistingRelease(null);
      setEditingSignature(false);
      setLoadedFromOffline(false);
      setLoadedSignature(null);
      setAlert(null);
      return;
    }
    if (!ticketId) {
      setLoading(false);
      return;
    }

    // Cache ticket info when available
    if (ticketInfo) {
      offlineStorage.cacheCurblineTicketInfo(ticketId, ticketInfo);
    }

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
          if (release.signature_image)
            setLoadedSignature(release.signature_image);
          // Cache for offline use
          offlineStorage.cacheCurblineRelease(ticketId, release);
        }
        // Check if there's a pending offline save on top of the API data
        applyPendingOfflineData(ticketId);
      } catch {
        if (cancelled) return;
        // API failed (offline) - load from local sources
        loadFromLocalStorage(ticketId);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
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
    const pending = offlineStorage.getPendingForTicket(
      tid,
      'curbline-release',
    );
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

  const canSubmit =
    typeName.trim().length > 0 &&
    signature !== null &&
    signature.length > 0 &&
    !submitting;

  const handleSubmit = useCallback(async () => {
    if (!canSubmit || !ticketId) return;

    const body = {name: typeName.trim(), sign: signature!};
    setSubmitting(true);

    try {
      if (!isOnline) {
        enqueueOffline(
          ticketId,
          'curbline-release',
          body,
          'curbline-release' as any,
        );
        offlineStorage.cacheCurblineRelease(ticketId, {
          id: existingRelease?.id || -1,
          signed_name: body.name,
          signature_image: body.sign,
        });
        setAlert({
          type: 'success',
          title: 'Saved Offline',
          message:
            'Curbline release will be submitted automatically when connection is restored.',
        });
      } else if (existingRelease && existingRelease.id > 0) {
        await ticketsApi.updateCurblineRelease(ticketId, body);
        offlineStorage.cacheCurblineRelease(ticketId, {
          id: existingRelease.id,
          signed_name: body.name,
          signature_image: body.sign,
        });
        setAlert({
          type: 'success',
          title: 'Success',
          message: 'Curbline release updated successfully.',
        });
      } else {
        await ticketsApi.curblineRelease(ticketId, body);
        offlineStorage.cacheCurblineRelease(ticketId, {
          id: -1,
          signed_name: body.name,
          signature_image: body.sign,
        });
        setAlert({
          type: 'success',
          title: 'Success',
          message: 'Curbline release submitted successfully.',
        });
      }
    } catch (err: any) {
      if (
        err?.message?.includes('Network request failed') ||
        err?.name === 'AbortError'
      ) {
        enqueueOffline(
          ticketId,
          'curbline-release',
          body,
          'curbline-release' as any,
        );
        offlineStorage.cacheCurblineRelease(ticketId, {
          id: existingRelease?.id || -1,
          signed_name: body.name,
          signature_image: body.sign,
        });
        setAlert({
          type: 'success',
          title: 'Saved Offline',
          message:
            'Curbline release will be submitted automatically when connection is restored.',
        });
      } else {
        setAlert({
          type: 'error',
          title: 'Error',
          message: err.message || 'Failed to submit curbline release.',
        });
      }
    } finally {
      setSubmitting(false);
    }
  }, [
    canSubmit,
    ticketId,
    typeName,
    signature,
    isOnline,
    enqueueOffline,
    existingRelease,
  ]);

  const handleAlertClose = useCallback(() => {
    const wasSuccess = alert?.type === 'success';
    setAlert(null);
    if (wasSuccess) onClose();
  }, [alert, onClose]);

  const {width: screenW, height: screenH} = useWindowDimensions();
  const sigHeight = isLandscape
    ? Math.round(screenH * 0.2)
    : Math.round(screenH * 0.18);
  const scrollMaxH = Math.round(screenH * (isLandscape ? 0.72 : 0.75));

  // Resolved ticket info
  const customerLabel = ticketInfo?.customer_name || '-';
  const projectLabel = ticketInfo?.project_name || '-';
  const orderLabel = ticketInfo?.order_code || '-';
  const ticketLabel = ticketInfo?.ticket_code || '-';

  const renderContent = () => {
    if (loading) {
      return (
        <View style={s.centerContent}>
          <ActivityIndicator size="large" color={c.accent} />
          <Text style={[s.loadingText, {color: c.textSecondary}]}>
            Loading...
          </Text>
        </View>
      );
    }

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

        {/* Info Section */}
        <View style={s.infoSection}>
          <View style={s.infoRow}>
            <Text style={[s.infoLabel, {color: c.textPrimary}]}>CUSTOMER</Text>
            <Text style={[s.infoValue, {color: c.textPrimary}]}>
              {customerLabel}
            </Text>
          </View>
          <View style={s.infoRow}>
            <Text style={[s.infoLabel, {color: c.textPrimary}]}>PROJECT</Text>
            <Text style={[s.infoValue, {color: c.textPrimary}]}>
              {projectLabel}
            </Text>
          </View>
          <View style={s.infoRow}>
            <Text style={[s.infoLabel, {color: c.textPrimary}]}>ORDER</Text>
            <Text style={[s.infoValue, {color: c.textPrimary}]}>
              {orderLabel}
            </Text>
          </View>
          <View style={s.infoRow}>
            <Text style={[s.infoLabel, {color: c.textPrimary}]}>TICKET</Text>
            <Text style={[s.infoValue, {color: c.textPrimary}]}>
              {ticketLabel}
            </Text>
          </View>
          <View style={s.infoRow}>
            <Text style={[s.infoLabel, {color: c.textPrimary}]}>RELEASED</Text>
            <Text style={[s.infoValue, {color: c.textMuted}]} />
          </View>
        </View>

        {/* Divider */}
        <View style={[s.divider, {backgroundColor: c.border}]} />

        {/* Type Name */}
        <View style={s.signSection}>
          <Text style={[s.inputLabel, {color: c.textPrimary}]}>TYPE NAME</Text>
          <TextInput
            style={[s.inputBox, {borderColor: c.border, color: c.textPrimary}]}
            value={typeName}
            onChangeText={setTypeName}
            placeholder="Enter name"
            placeholderTextColor={c.textMuted}
          />

          {/* Signature Pad */}
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

          {/* Clear signature link */}
          <TouchableOpacity
            onPress={() => {
              sigClearRef.current?.();
              setSignature(null);
              setLoadedSignature(null);
              setEditingSignature(false);
            }}
            activeOpacity={0.7}
            style={{marginTop: wp(3)}}>
            <Text style={s.clearSigText}>Clear signature</Text>
          </TouchableOpacity>

          {/* Submit button */}
          <TouchableOpacity
            style={[
              s.submitBtn,
              {
                backgroundColor: canSubmit
                  ? '#157a15'
                  : isDark
                    ? '#4A5B6E'
                    : '#cfd6de',
              },
            ]}
            activeOpacity={canSubmit ? 0.8 : 1}
            disabled={!canSubmit}
            onPress={handleSubmit}>
            {submitting ? (
              <ActivityIndicator size="small" color="#FFFFFF" />
            ) : (
              <Text
                style={[
                  s.submitBtnText,
                  {color: canSubmit ? '#FFFFFF' : '#9E9E9E'},
                ]}>
                {existingRelease && existingRelease.id > 0
                  ? 'UPDATE'
                  : 'SUBMIT'}
              </Text>
            )}
          </TouchableOpacity>
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
            CURBLINE RELEASE
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
    loadingText: {fontSize: ms(9), marginTop: wp(8)},

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

    // Scroll
    scrollContent: {paddingBottom: wp(8)},

    // Info Section
    infoSection: {paddingHorizontal: wp(10), paddingVertical: wp(6)},
    infoRow: {
      flexDirection: 'row',
      alignItems: 'flex-start',
      paddingVertical: wp(3),
      gap: wp(8),
    },
    infoLabel: {
      fontSize: ms(8),
      fontWeight: '800',
      minWidth: wp(60),
    },
    infoValue: {
      fontSize: ms(8),
      fontWeight: '500',
      flex: 1,
    },

    // Divider
    divider: {
      height: StyleSheet.hairlineWidth,
      marginHorizontal: wp(10),
    },

    // Sign section
    signSection: {paddingHorizontal: wp(10), paddingVertical: wp(6)},

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

    // Clear signature
    clearSigText: {
      fontSize: ms(8),
      fontWeight: '600',
      color: '#157a15',
    },

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
