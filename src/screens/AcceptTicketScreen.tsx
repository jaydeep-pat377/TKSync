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
import SignaturePad from '../components/SignaturePad';
import ThemedAlert from '../components/ThemedAlert';
import {useSafeAreaInsets} from 'react-native-safe-area-context';
import MaterialIcons from 'react-native-vector-icons/MaterialIcons';
import type {NativeStackNavigationProp} from '@react-navigation/native-stack';
import type {RouteProp} from '@react-navigation/native';
import {useTheme} from '../contexts/ThemeContext';
import {wp, ms} from '../utils/responsive';
import {ticketsApi} from '../services/api';
import type {SigningData} from '../services/api';
import {useOfflineSync} from '../contexts/OfflineSyncContext';

type Props = {
  navigation: NativeStackNavigationProp<any>;
  route: RouteProp<{AcceptTicket: {ticketId?: number; editable?: boolean}}, 'AcceptTicket'>;
};

export default function AcceptTicketScreen({navigation, route}: Props) {
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
  const ticketId = route.params?.ticketId;
  const editable = route.params?.editable === true;

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
  const [alert, setAlert] = useState<{type: 'success' | 'error'; title: string; message: string} | null>(null);

  useEffect(() => {
    if (!ticketId) return;
    let cancelled = false;
    (async () => {
      try {
        setLoading(true);
        setLoadError(null);
        const res = await ticketsApi.getSigning(ticketId);
        if (!cancelled) {
          setData(res.data);
          const accepted = res.data?.status?.accepted;
          if (accepted) {
            if (accepted.email) setEmail(accepted.email);
            if (accepted.customer_notes) setCustomerNotes(accepted.customer_notes);
            if (accepted.signed_name) setTypeName(accepted.signed_name);
            if (accepted.signature_image) setSignature(accepted.signature_image);
          }
        }
      } catch (err: any) {
        if (!cancelled) setLoadError(err.message || 'Failed to load signing data.');
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [ticketId]);

  const handleSignatureChange = useCallback((sig: string | null) => {
    setSignature(sig);
  }, []);

  const alreadySigned = data?.status?.is_signed === true;
  const alreadyDisputed = data?.status?.is_disputed === true;
  const isFormDisabled = !editable && (alreadySigned || alreadyDisputed);

  const isEmailValid = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim());
  const isNotesValid = customerNotes.trim().length > 0;
  const isNameValid = typeName.trim().length > 0;
  const isSigned = signature !== null && signature.length > 0;
  const canSubmit = isEmailValid && isNotesValid && isNameValid && isSigned && !submitting && !isFormDisabled;

  const handleSubmit = useCallback(async () => {
    if (!canSubmit || !ticketId || !signature) return;
    setSubmitting(true);
    const body = {
      email: email.trim() || undefined,
      customer_notes: customerNotes.trim() || undefined,
      signed_name: typeName.trim(),
      signature_image: signature,
    };
    try {
      if (!isOnline) {
        enqueueOffline(ticketId, 'sign', body, 'sign');
        setAlert({type: 'success', title: 'Saved Offline', message: 'Ticket will be signed automatically when connection is restored.'});
      } else {
        await ticketsApi.sign(ticketId, body);
        setAlert({type: 'success', title: 'Success', message: 'Ticket signed successfully.'});
      }
    } catch (err: any) {
      if (err?.message?.includes('Network request failed')) {
        enqueueOffline(ticketId, 'sign', body, 'sign');
        setAlert({type: 'success', title: 'Saved Offline', message: 'Ticket will be signed automatically when connection is restored.'});
      } else {
        setAlert({type: 'error', title: 'Error', message: err.message || 'Failed to sign ticket.'});
      }
    } finally {
      setSubmitting(false);
    }
  }, [canSubmit, ticketId, email, customerNotes, typeName, signature, isOnline, enqueueOffline]);

  const handleAlertClose = useCallback(() => {
    const wasSuccess = alert?.type === 'success';
    setAlert(null);
    if (wasSuccess) navigation.goBack();
  }, [alert, navigation]);

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

  // Error state
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

  const {ticket, products, legal, status} = data;

  return (
    <View style={[s.container, {backgroundColor: isLandscape ? c.white : c.accentBg}]}>
      <StatusBar translucent backgroundColor="transparent" barStyle={isLandscape ? 'dark-content' : 'light-content'} />

      <KeyboardAvoidingView
        style={s.flex1}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        keyboardVerticalOffset={Platform.OS === 'ios' ? 0 : 0}>
      <ScrollView
        style={s.scroll}
        contentContainerStyle={[s.scrollContent, {paddingTop: insets.top + (isLandscape ? 4 : 0), paddingLeft: Math.max(insets.left, isLandscape && !isTablet ? 12 : 0), paddingRight: Math.max(insets.right, isLandscape && !isTablet ? 12 : 0), paddingBottom: Math.max(isLandscape ? wp(20) : wp(8), insets.bottom)}]}
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
        scrollEnabled={scrollEnabled}>

        <View style={[s.card, {backgroundColor: c.white}, isLandscape ? {maxWidth: cardMaxWidth, alignSelf: 'center', width: '100%', borderRadius: wp(14), marginBottom: wp(10)} : {marginHorizontal: wp(10), borderRadius: wp(10)}]}>

          {/* Header */}
          <View style={[s.header, {borderBottomColor: c.border}]}>
            <Text style={[s.headerTitle, {color: c.textPrimary}]}>ACCEPT TICKET</Text>
            <TouchableOpacity
              style={[s.closeBtn, {backgroundColor: c.surface}]}
              onPress={() => navigation.goBack()}
              activeOpacity={0.7}
              hitSlop={{top: 8, bottom: 8, left: 8, right: 8}}>
              <MaterialIcons name="close" size={ms(20)} color={c.textSecondary} />
            </TouchableOpacity>
          </View>

          {/* Already signed/disputed banner */}
          {isFormDisabled && (
            <View style={[s.banner, {backgroundColor: alreadySigned ? c.successSurface : c.errorSurface}]}>
              <MaterialIcons name={alreadySigned ? 'check-circle' : 'report-problem'} size={ms(18)} color={alreadySigned ? c.success : c.error} />
              <Text style={[s.bannerText, {color: alreadySigned ? c.success : c.error}]}>
                {alreadySigned ? 'This ticket has already been signed.' : 'This ticket has been disputed.'}
              </Text>
            </View>
          )}

          {/* Caution Section */}
          <View style={[s.section, {borderBottomColor: c.border}]}>
            <Text style={[s.sectionTitle, {color: c.textPrimary}]}>CAUTION</Text>
            <Text style={[s.bodyText, {color: c.textPrimary}]}>{legal.caution}</Text>
          </View>

          {/* Products Table */}
          <View style={[s.section, {borderBottomColor: c.border}]}>
            <Text style={[s.sectionTitle, {color: c.textPrimary}]}>PRODUCTS</Text>

            {/* Table Header */}
            <View style={[s.tableRow, s.tableHeader, {borderBottomColor: c.textPrimary}]}>
              <Text style={[s.colCode, s.thText, {color: c.textPrimary}]}>CODE</Text>
              <Text style={[s.colDesc, s.thText, {color: c.textPrimary}]}>DESCRIPTION</Text>
              <Text style={[s.colQty, s.thText, {color: c.textPrimary}]}>QTY</Text>
              <Text style={[s.colUnit, s.thText, {color: c.textPrimary}]}>UNIT</Text>
            </View>

            {/* Table Body */}
            {products.map((row, i) => (
              <View key={`${row.code}-${i}`} style={[s.tableRow, {borderBottomColor: c.borderLight}]}>
                <Text style={[s.colCode, s.tdText, {color: c.textPrimary}]}>{row.code}</Text>
                <Text style={[s.colDesc, s.tdText, {color: c.textPrimary}]}>{row.description}</Text>
                <Text style={[s.colQty, s.tdText, {color: c.textPrimary}]}>{row.quantity != null ? row.quantity : '-'}</Text>
                <Text style={[s.colUnit, s.tdText, {color: c.textPrimary}]}>{row.unit || '-'}</Text>
              </View>
            ))}

          </View>

          {/* Email Mobile Ticket */}
          <View style={[s.section, {borderBottomColor: c.border}]}>
            <Text style={[s.sectionTitle, {color: c.textPrimary}]}>EMAIL MOBILE TICKET</Text>

            <View style={s.inputRow}>
              <Text style={[s.inputLabel, {color: c.textPrimary}]}>EMAIL ADDRESS</Text>
              <TextInput
                style={[s.inputLine, {borderBottomColor: c.border, color: c.textPrimary}]}
                value={email}
                onChangeText={setEmail}
                keyboardType="email-address"
                autoCapitalize="none"
                placeholder="Enter email"
                placeholderTextColor={c.textMuted}
                editable={!isFormDisabled}
              />
            </View>

            <View style={s.inputRow}>
              <Text style={[s.inputLabel, {color: c.textPrimary}]}>CUSTOMER NOTES</Text>
              <TextInput
                style={[s.inputLine, {borderBottomColor: c.border, color: c.textPrimary}]}
                value={customerNotes}
                onChangeText={setCustomerNotes}
                placeholder="Enter notes"
                placeholderTextColor={c.textMuted}
                editable={!isFormDisabled}
              />
            </View>
          </View>

          {/* Terms & Conditions */}
          <View style={[s.section, {borderBottomColor: c.border}]}>
            <Text style={[s.termsText, {color: c.textPrimary}]}>{legal.terms_en}</Text>
            <Text style={[s.termsText, {color: c.textPrimary, marginTop: 12}]}>{legal.terms_fr}</Text>
          </View>

          {/* Type Name + Signature + Submit */}
          <View style={s.signSection}>
            <View style={s.inputRow}>
              <Text style={[s.inputLabel, {color: c.textPrimary}]}>TYPE NAME</Text>
              <TextInput
                style={[s.inputLine, {borderBottomColor: c.border, color: c.textPrimary}]}
                value={typeName}
                onChangeText={setTypeName}
                placeholder="Enter name"
                placeholderTextColor={c.textMuted}
                editable={!isFormDisabled}
              />
            </View>

            {status?.accepted?.signature_image && !editingSignature ? (
              <SignaturePad onSignatureChange={handleSignatureChange} height={sigHeight} readOnly initialImage={status.accepted.signature_image} onEditPress={editable ? () => setEditingSignature(true) : undefined} />
            ) : (
              <SignaturePad onSignatureChange={handleSignatureChange} height={sigHeight} onTouchStart={() => setScrollEnabled(false)} onTouchEnd={() => setScrollEnabled(true)} />
            )}

            {!isFormDisabled && (
              <TouchableOpacity
                style={[s.submitBtn, {backgroundColor: canSubmit ? c.signBtn : c.border}]}
                activeOpacity={canSubmit ? 0.8 : 1}
                disabled={!canSubmit}
                onPress={handleSubmit}>
                {submitting ? (
                  <ActivityIndicator size="small" color={c.textOnPrimary} />
                ) : (
                  <Text style={[s.submitBtnText, {color: canSubmit ? c.textOnPrimary : c.textMuted}]}>SUBMIT</Text>
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

  // Banner
  banner: {flexDirection: 'row', alignItems: 'center', paddingVertical: wp(10), paddingHorizontal: wp(12), gap: wp(8)},
  bannerText: {fontSize: ms(12), fontWeight: '700', flex: 1},

  // Section
  section: {paddingHorizontal: wp(12), paddingVertical: wp(14), borderBottomWidth: 1},
  sectionTitle: {fontSize: ms(14), fontWeight: '800', textAlign: 'center', marginBottom: wp(10), letterSpacing: 0.3},

  // Body text
  bodyText: {fontSize: ms(11), fontWeight: '500', lineHeight: ms(17)},

  // Table
  tableRow: {flexDirection: 'row', alignItems: 'center', paddingVertical: wp(8), borderBottomWidth: 0.5},
  tableHeader: {borderBottomWidth: 1.5, paddingBottom: wp(6)},
  colCode: {minWidth: wp(44), maxWidth: wp(65)},
  colDesc: {flex: 1, paddingRight: wp(4)},
  colQty: {minWidth: wp(32), maxWidth: wp(50), textAlign: 'right'},
  colUnit: {minWidth: wp(28), maxWidth: wp(40), textAlign: 'right'},
  thText: {fontSize: ms(11), fontWeight: '800'},
  tdText: {fontSize: ms(11), fontWeight: '500'},

  // Input rows
  inputRow: {flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', paddingVertical: wp(6), gap: wp(6)},
  inputLabel: {fontSize: ms(11), fontWeight: '800', minWidth: wp(70), maxWidth: wp(120)},
  inputLine: {flex: 1, borderBottomWidth: 1, paddingVertical: wp(5), fontSize: ms(12), minWidth: 100},

  // Terms
  termsText: {fontSize: ms(10), fontWeight: '500', lineHeight: ms(16)},

  // Sign section
  signSection: {paddingHorizontal: wp(12), paddingVertical: wp(16)},

  // Submit
  submitBtn: {
    marginTop: wp(12),
    paddingVertical: wp(10),
    borderRadius: wp(10),
    minHeight: wp(44),
    alignItems: 'center',
    justifyContent: 'center',
  },
  submitBtnText: {fontSize: ms(14), fontWeight: '800', letterSpacing: 0.5},
});
