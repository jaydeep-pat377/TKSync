import React, {useState, useCallback} from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  TextInput,
  StatusBar,
} from 'react-native';
import SignaturePad from '../components/SignaturePad';
import {useSafeAreaInsets} from 'react-native-safe-area-context';
import MaterialIcons from 'react-native-vector-icons/MaterialIcons';
import type {NativeStackNavigationProp} from '@react-navigation/native-stack';
import {useTheme} from '../contexts/ThemeContext';

type Props = {navigation: NativeStackNavigationProp<any>};

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

export default function AcceptTicketScreen({navigation}: Props) {
  const {c} = useTheme();
  const insets = useSafeAreaInsets();
  const [email, setEmail] = useState('');
  const [customerNotes, setCustomerNotes] = useState('');
  const [typeName, setTypeName] = useState('');
  const [signature, setSignature] = useState<string | null>(null);

  const handleSignatureChange = useCallback((sig: string | null) => {
    setSignature(sig);
  }, []);

  const isEmailValid = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim());
  const isNotesValid = customerNotes.trim().length > 0;
  const isNameValid = typeName.trim().length > 0;
  const isSigned = signature !== null && signature.length > 0;
  const canSubmit = isEmailValid && isNotesValid && isNameValid && isSigned;

  return (
    <View style={[s.container, {backgroundColor: c.accentBg}]}>
      <StatusBar translucent backgroundColor="transparent" barStyle="light-content" />

      <ScrollView
        style={s.scroll}
        contentContainerStyle={[s.scrollContent, {paddingTop: insets.top + 8}]}
        showsVerticalScrollIndicator={false}>

        <View style={[s.card, {backgroundColor: c.white}]}>

          {/* Header */}
          <View style={[s.header, {borderBottomColor: c.border}]}>
            <Text style={[s.headerTitle, {color: c.textPrimary}]}>ACCEPT TICKET</Text>
            <TouchableOpacity
              style={[s.closeBtn, {backgroundColor: c.surface}]}
              onPress={() => navigation.goBack()}
              activeOpacity={0.7}>
              <MaterialIcons name="close" size={20} color={c.textSecondary} />
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
            <SignaturePad onSignatureChange={handleSignatureChange} height={200} />

            {/* Submit Button */}
            <TouchableOpacity
              style={[s.submitBtn, {backgroundColor: canSubmit ? c.signBtn : c.border}]}
              activeOpacity={canSubmit ? 0.8 : 1}
              disabled={!canSubmit}>
              <Text style={[s.submitBtnText, {color: canSubmit ? c.textOnPrimary : c.textMuted}]}>SUBMIT</Text>
            </TouchableOpacity>
          </View>

        </View>
      </ScrollView>
    </View>
  );
}

const s = StyleSheet.create({
  container: {flex: 1},
  scroll: {flex: 1},
  scrollContent: {paddingBottom: 30},

  card: {
    marginHorizontal: 10,
    marginBottom: 10,
    borderRadius: 14,
    overflow: 'hidden',
  },

  // Header
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 18,
    paddingHorizontal: 20,
    borderBottomWidth: 1,
  },
  headerTitle: {fontSize: 18, fontWeight: '800', letterSpacing: 0.5, flex: 1, textAlign: 'center'},
  closeBtn: {width: 36, height: 36, borderRadius: 18, justifyContent: 'center', alignItems: 'center', position: 'absolute', right: 16},

  // Section
  section: {paddingHorizontal: 24, paddingVertical: 20, borderBottomWidth: 1},
  sectionTitle: {fontSize: 15, fontWeight: '800', textAlign: 'center', marginBottom: 14, letterSpacing: 0.3},

  // Body text
  bodyText: {fontSize: 13, fontWeight: '500', lineHeight: 20},

  // Table
  tableRow: {flexDirection: 'row', alignItems: 'center', paddingVertical: 10, borderBottomWidth: 0.5},
  tableHeader: {borderBottomWidth: 1.5, paddingBottom: 8},
  colCode: {width: 80},
  colDesc: {flex: 1},
  colQty: {width: 55, textAlign: 'right'},
  colUnit: {width: 45, textAlign: 'right'},
  thText: {fontSize: 13, fontWeight: '800'},
  tdText: {fontSize: 13, fontWeight: '500'},

  // Input rows
  inputRow: {flexDirection: 'row', alignItems: 'center', paddingVertical: 12, gap: 12},
  inputLabel: {fontSize: 13, fontWeight: '800', width: 140},
  inputLine: {flex: 1, borderBottomWidth: 1, paddingVertical: 6, fontSize: 14},

  // Terms
  termsText: {fontSize: 12, fontWeight: '500', lineHeight: 19},

  // Sign section
  signSection: {paddingHorizontal: 24, paddingVertical: 20},


  // Submit
  submitBtn: {
    marginTop: 24,
    paddingVertical: 16,
    borderRadius: 10,
    alignItems: 'center',
  },
  submitBtnText: {fontSize: 16, fontWeight: '800', letterSpacing: 0.5},
});
