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
} from 'react-native';
import {useSafeAreaInsets} from 'react-native-safe-area-context';
import MaterialIcons from 'react-native-vector-icons/MaterialIcons';
import type {NativeStackNavigationProp} from '@react-navigation/native-stack';
import {useTheme} from '../contexts/ThemeContext';
import SignaturePad from '../components/SignaturePad';

type Props = {navigation: NativeStackNavigationProp<any>};

export default function DisputeTicketScreen({navigation}: Props) {
  const {c} = useTheme();
  const insets = useSafeAreaInsets();
  const {height} = useWindowDimensions();
  const sigHeight = Math.min(220, Math.max(120, height * 0.3));
  const [quantity, setQuantity] = useState('6');
  const [reason, setReason] = useState('');
  const [typeName, setTypeName] = useState('');
  const [signature, setSignature] = useState<string | null>(null);

  const handleSignatureChange = useCallback((sig: string | null) => {
    setSignature(sig);
  }, []);

  const canSubmit = typeName.trim().length > 0 && signature !== null && signature.length > 0;

  const handleQuantityChange = (text: string) => {
    setQuantity(text.replace(/[^0-9.]/g, ''));
  };

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
            <Text style={[s.headerTitle, {color: c.textPrimary}]}>DISPUTE TICKET</Text>
            <TouchableOpacity
              style={[s.closeBtn, {backgroundColor: c.surface}]}
              onPress={() => navigation.goBack()}
              activeOpacity={0.7}>
              <MaterialIcons name="close" size={20} color={c.textSecondary} />
            </TouchableOpacity>
          </View>

          {/* Ticket Info */}
          <View style={s.infoSection}>
            <View style={s.infoRow}>
              <Text style={[s.infoLabel, {color: c.textPrimary}]}>TICKET</Text>
              <Text style={[s.infoValue, {color: c.textPrimary}]}>26209538</Text>
            </View>
            <View style={s.infoRow}>
              <Text style={[s.infoLabel, {color: c.textPrimary}]}>PRODUCT</Text>
              <Text style={[s.infoValue, {color: c.textPrimary}]}>32MPA AIR C2 .45 SIDEWALK</Text>
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
              />
            </View>
          </View>

          {/* Divider */}
          <View style={[s.divider, {backgroundColor: c.border}]} />

          {/* Sign Section */}
          <View style={s.signSection}>
            <View style={s.typeNameRow}>
              <Text style={[s.typeNameLabel, {color: c.textPrimary}]}>TYPE NAME</Text>
              <TextInput
                style={[s.typeNameInput, {borderBottomColor: c.border, color: c.textPrimary}]}
                value={typeName}
                onChangeText={setTypeName}
                placeholder="Enter name"
                placeholderTextColor={c.textMuted}
              />
            </View>

            {/* Signature Pad */}
            <SignaturePad onSignatureChange={handleSignatureChange} height={sigHeight} />

            {/* Dispute Button */}
            <TouchableOpacity
              style={[s.disputeBtn, {backgroundColor: canSubmit ? c.disputeBtn : c.border}]}
              activeOpacity={canSubmit ? 0.8 : 1}
              disabled={!canSubmit}>
              <Text style={[s.disputeBtnText, {color: canSubmit ? c.textOnPrimary : c.textMuted}]}>DISPUTE</Text>
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

  // Info
  infoSection: {paddingHorizontal: 24, paddingVertical: 20},
  infoRow: {flexDirection: 'row', alignItems: 'center', paddingVertical: 14, gap: 16},
  infoLabel: {fontSize: 14, fontWeight: '800', width: 120},
  infoValue: {fontSize: 14, fontWeight: '500', flex: 1},

  // Quantity
  qtyRow: {flexDirection: 'row', alignItems: 'center', gap: 10},
  qtyInput: {width: 80, borderBottomWidth: 1, paddingVertical: 4, fontSize: 15, fontWeight: '600'},
  qtyUnit: {fontSize: 14, fontWeight: '600'},

  // Reason
  reasonInput: {flex: 1, borderBottomWidth: 1, paddingVertical: 4, fontSize: 14},

  // Divider
  divider: {height: 1, marginHorizontal: 20},

  // Sign
  signSection: {paddingHorizontal: 24, paddingVertical: 24},
  typeNameRow: {flexDirection: 'row', alignItems: 'center', gap: 16, marginBottom: 20},
  typeNameLabel: {fontSize: 14, fontWeight: '800'},
  typeNameInput: {flex: 1, borderBottomWidth: 1, paddingVertical: 4, fontSize: 14},


  // Dispute button
  disputeBtn: {
    marginTop: 24,
    paddingVertical: 16,
    borderRadius: 10,
    alignItems: 'center',
  },
  disputeBtnText: {fontSize: 16, fontWeight: '800', letterSpacing: 0.5},
});
