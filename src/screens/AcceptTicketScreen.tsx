import React, {useState, useCallback} from 'react';
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

type Props = {
  navigation: NativeStackNavigationProp<any>;
  route: RouteProp<{AcceptTicket: {ticketId?: number}}, 'AcceptTicket'>;
};

const PRODUCTS = [
  {code: '6138506', desc: '32MPA AIR C2 .45 SIDEWALK', qty: '6.00', unit: 'm3'},
  {code: '14301', desc: 'FLEX FUEL SURCHARGE', qty: '6.00', unit: '/m'},
  {code: '5843', desc: 'FUEL SURCHARGE - CBM /M3', qty: '6.00', unit: '/m'},
];

const CAUTION_TEXT =
  'CEMENT POWDER OR FRESHLY MIXED CONCRETE, GROUT OR MORTAR IS CAUSTIC AND CORROSIVE, AND CAN DESTROY SKIN AND TISSUE. FRESH CONCRETE CAN WET AND PENETRATE CLOTHING. THEREFORE, WATERPROOF CLOTHING SHOULD BE USED, AND IF ANY CLOTHING GETS WET, THE SKIN MUST BE PROMPTLY WASHED WITH WATER AND FRESH, DRY CLOTHING PUT ON. IF ANY CEMENT MIXTURE AS ABOVE GETS INTO EYES, RINSE IMMEDIATELY AND REPEATEDLY WITH WATER AND GET PROMPT MEDICAL ATTENTION. KEEP OUT OF REACH OF CHILDREN.';

const TERMS_EN =
  'ST. MARYS CEMENT INC. (CANADA) D/B/A CANADA BUILDING MATERIALS IS PLEASED TO DELIVER THE CONCRETE OR CONCRETE PRODUCTS ("PRODUCTS") DESCRIBED ON THIS DELIVERY TICKET. PLEASE BE ADVISED THAT THE\n    PRODUCT IS SUBJECT TO OUR TERMS AND CONDITIONS OF SALE - CONCRETE (AVAILABLE ON OUR WEBSITE AT HTTP://SALESTERMSANDCONDITIONS.VCNAINC.COM/ OR ON REQUEST). ANY PROPOSAL OR ATTEMPT TO MODIFY\n    THESE TERMS, INCLUDING BY ANNOTATION ON THE FACE OF THIS DELIVERY TICKET, IS EXPRESSLY REJECTED.  ANY DISAGREEMENTS WITH THE INFORMATION CONTAINED ON THIS TICKET MUST BE REPORTED WITHIN 24 HOURS OF DELIVERY, OTHERWISE ALL INFORMATION WILL BE DEEMED FINAL.';

const TERMS_FR =
  '    ST. MARYS CEMENT INC. (CANADA) D/B/A CANADA BUILDING MATERIALS A LE PLAISIR DE LIVRER LE BETON OU LES PRODUITS A BASE DE BETON (LE << PRODUIT >>) DECRITS DANS LA PRESENTE FICHE DE LIVRAISON. VEUILLEZ NOTER QUE LE\n    PRODUIT EST ASSUJETTI A NOS CONDITIONS DE VENTE - BETON (DISPONIBLES SUR NOTRE SITE WEB A L\'ADRESSE HTTP://SALESTERMSANDCONDITIONS.VCNAINC.COM/ OU SUR DEMANDE). TOUTE PROPOSITION OU TENTATIVE DE\n    MODIFICATION DES PRESENTES CONDITIONS, Y COMPRIS PAR ANNOTATION AU RECTO DE LA PRESENTE FICHE DE LIVRAISON, EST EXPRESSEMENT REJETEE.TOUT DESACCORD AVEC LES INFORMATIONS CONTENUES SUR CE BILLET DOIT ETRE SIGNALE DANS LES 24 HEURES SUIVANT LA LIVRAISON, AUTREMENT TOUTES LES INFORMATIONS SERONT CONSIDEREES DEFINITIVES.';

export default function AcceptTicketScreen({navigation, route}: Props) {
  const {c} = useTheme();
  const insets = useSafeAreaInsets();
  const {width, height} = useWindowDimensions();
  const isTablet = Math.min(width, height) > 600;
  const isLandscape = width > height;
  const sigHeight = isTablet
    ? Math.min(300, Math.max(200, height * 0.28))
    : Math.min(isLandscape ? 200 : 280, Math.max(160, height * 0.32));
  const ticketId = route.params?.ticketId;
  const [email, setEmail] = useState('');
  const [customerNotes, setCustomerNotes] = useState('');
  const [typeName, setTypeName] = useState('');
  const [signature, setSignature] = useState<string | null>(null);
  const [scrollEnabled, setScrollEnabled] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [alert, setAlert] = useState<{type: 'success' | 'error'; title: string; message: string} | null>(null);

  const handleSignatureChange = useCallback((sig: string | null) => {
    setSignature(sig);
  }, []);

  const isEmailValid = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim());
  const isNotesValid = customerNotes.trim().length > 0;
  const isNameValid = typeName.trim().length > 0;
  const isSigned = signature !== null && signature.length > 0;
  const canSubmit = isEmailValid && isNotesValid && isNameValid && isSigned && !submitting;

  const handleSubmit = useCallback(async () => {
    if (!canSubmit || !ticketId || !signature) return;
    setSubmitting(true);
    try {
      await ticketsApi.sign(ticketId, {
        email: email.trim() || undefined,
        customer_notes: customerNotes.trim() || undefined,
        signed_name: typeName.trim(),
        signature_image: signature,
      });
      setAlert({type: 'success', title: 'Success', message: 'Ticket signed successfully.'});
    } catch (err: any) {
      setAlert({type: 'error', title: 'Error', message: err.message || 'Failed to sign ticket.'});
    } finally {
      setSubmitting(false);
    }
  }, [canSubmit, ticketId, email, customerNotes, typeName, signature]);

  const handleAlertClose = useCallback(() => {
    const wasSuccess = alert?.type === 'success';
    setAlert(null);
    if (wasSuccess) navigation.goBack();
  }, [alert, navigation]);

  return (
    <View style={[s.container, {backgroundColor: isLandscape ? c.white : c.accentBg}]}>
      <StatusBar translucent backgroundColor="transparent" barStyle={isLandscape ? 'dark-content' : 'light-content'} />

      <KeyboardAvoidingView
        style={s.flex1}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        keyboardVerticalOffset={Platform.OS === 'ios' ? 0 : 0}>
      <ScrollView
        style={s.scroll}
        contentContainerStyle={[s.scrollContent, {paddingTop: insets.top + (isLandscape ? 4 : 0), paddingLeft: insets.left, paddingRight: insets.right, paddingBottom: isLandscape ? wp(20) : wp(8)}]}
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
        scrollEnabled={scrollEnabled}>

        <View style={[s.card, {backgroundColor: c.white}, isLandscape ? {maxWidth: 700, alignSelf: 'center', width: '100%', borderRadius: wp(14), marginBottom: wp(10)} : {marginHorizontal: 14, borderRadius: 10}]}>

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

          {/* Caution Section */}
          <View style={[s.section, {borderBottomColor: c.border}]}>
            <Text style={[s.sectionTitle, {color: c.textPrimary}]}>CAUTION</Text>
            <Text style={[s.bodyText, {color: c.textPrimary}]}>{CAUTION_TEXT}</Text>
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
            {PRODUCTS.map((row, i) => (
              <View key={`${row.code}-${i}`} style={[s.tableRow, {borderBottomColor: c.borderLight}]}>
                <Text style={[s.colCode, s.tdText, {color: c.textPrimary}]}>{row.code}</Text>
                <Text style={[s.colDesc, s.tdText, {color: c.textPrimary}]}>{row.desc}</Text>
                <Text style={[s.colQty, s.tdText, {color: c.textPrimary}]}>{row.qty}</Text>
                <Text style={[s.colUnit, s.tdText, {color: c.textPrimary}]}>{row.unit}</Text>
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
              />
            </View>
          </View>

          {/* Terms & Conditions */}
          <View style={[s.section, {borderBottomColor: c.border}]}>
            <Text style={[s.termsText, {color: c.textPrimary}]}>{TERMS_EN}</Text>
            <Text style={[s.termsText, {color: c.textPrimary, marginTop: 12}]}>{TERMS_FR}</Text>
          </View>

          {/* Type Name */}
          <View style={s.signSection}>
            <View style={s.inputRow}>
              <Text style={[s.inputLabel, {color: c.textPrimary}]}>TYPE NAME</Text>
              <TextInput
                style={[s.inputLine, {borderBottomColor: c.border, color: c.textPrimary}]}
                value={typeName}
                onChangeText={setTypeName}
                placeholder="Enter name"
                placeholderTextColor={c.textMuted}
              />
            </View>

            {/* Signature Pad */}
            <SignaturePad onSignatureChange={handleSignatureChange} height={sigHeight} onTouchStart={() => setScrollEnabled(false)} onTouchEnd={() => setScrollEnabled(true)} />

            {/* Submit Button */}
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

  card: {
    marginBottom: wp(10),
    overflow: 'visible',
  },

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

  // Section
  section: {paddingHorizontal: wp(12), paddingVertical: wp(14), borderBottomWidth: 1},
  sectionTitle: {fontSize: ms(14), fontWeight: '800', textAlign: 'center', marginBottom: wp(10), letterSpacing: 0.3},

  // Body text
  bodyText: {fontSize: ms(12), fontWeight: '500', lineHeight: ms(18)},

  // Table
  tableRow: {flexDirection: 'row', alignItems: 'center', paddingVertical: wp(8), borderBottomWidth: 0.5},
  tableHeader: {borderBottomWidth: 1.5, paddingBottom: wp(6)},
  colCode: {minWidth: wp(50), maxWidth: wp(75)},
  colDesc: {flex: 1},
  colQty: {minWidth: wp(40), maxWidth: wp(60), textAlign: 'right'},
  colUnit: {minWidth: wp(35), maxWidth: wp(50), textAlign: 'right'},
  thText: {fontSize: ms(12), fontWeight: '800'},
  tdText: {fontSize: ms(12), fontWeight: '500'},

  // Input rows
  inputRow: {flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', paddingVertical: wp(8), gap: wp(8)},
  inputLabel: {fontSize: ms(12), fontWeight: '800', minWidth: wp(80), maxWidth: wp(130)},
  inputLine: {flex: 1, borderBottomWidth: 1, paddingVertical: wp(5), fontSize: ms(13)},

  // Terms
  termsText: {fontSize: ms(11), fontWeight: '500', lineHeight: ms(17)},

  // Sign section
  signSection: {paddingHorizontal: wp(12), paddingVertical: wp(16)},

  // Submit
  submitBtn: {
    marginTop: wp(12),
    paddingVertical: wp(8),
    borderRadius: wp(8),
    minHeight: wp(36),
    alignItems: 'center',
    justifyContent: 'center',
  },
  submitBtnText: {fontSize: ms(14), fontWeight: '800', letterSpacing: 0.5},
});
