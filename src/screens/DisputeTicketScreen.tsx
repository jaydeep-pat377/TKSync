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
} from 'react-native';
import {useSafeAreaInsets} from 'react-native-safe-area-context';
import MaterialIcons from 'react-native-vector-icons/MaterialIcons';
import type {NativeStackNavigationProp} from '@react-navigation/native-stack';
import {useTheme} from '../contexts/ThemeContext';
import {wp, ms} from '../utils/responsive';
import SignaturePad from '../components/SignaturePad';

type Props = {navigation: NativeStackNavigationProp<any>};

export default function DisputeTicketScreen({navigation}: Props) {
  const {c} = useTheme();
  const insets = useSafeAreaInsets();
  const {width, height} = useWindowDimensions();
  const isTablet = Math.min(width, height) > 600;
  const isLandscape = width > height;
  const sigHeight = isTablet
    ? Math.min(220, Math.max(140, height * 0.2))
    : Math.min(isLandscape ? 160 : 220, Math.max(100, height * 0.25));
  const [quantity, setQuantity] = useState('6');
  const [reason, setReason] = useState('');
  const [typeName, setTypeName] = useState('');
  const [signature, setSignature] = useState<string | null>(null);
  const [scrollEnabled, setScrollEnabled] = useState(true);

  const handleSignatureChange = useCallback((sig: string | null) => {
    setSignature(sig);
  }, []);

  const canSubmit = typeName.trim().length > 0 && signature !== null && signature.length > 0;

  const handleQuantityChange = (text: string) => {
    setQuantity(text.replace(/[^0-9.]/g, ''));
  };

  return (
    <View style={[s.container, {backgroundColor: isLandscape ? c.white : c.accentBg}]}>
      <StatusBar translucent backgroundColor="transparent" barStyle={isLandscape ? 'dark-content' : 'light-content'} />

      <KeyboardAvoidingView
        style={s.flex1}
        behavior="padding"
        keyboardVerticalOffset={Platform.OS === 'ios' ? 0 : 20}>
      <ScrollView
        style={s.scroll}
        contentContainerStyle={[s.scrollContent, {paddingTop: insets.top + (isLandscape ? 4 : wp(8)), paddingLeft: insets.left, paddingRight: insets.right, paddingBottom: wp(50)}]}
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
        scrollEnabled={scrollEnabled}>

        <View style={[s.card, {backgroundColor: c.white}, isLandscape && {marginHorizontal: 0, borderRadius: 0, marginBottom: 0}, isTablet && !isLandscape && {maxWidth: 650, alignSelf: 'center' as const, width: '100%'}]}>

          {/* Header */}
          <View style={[s.header, {borderBottomColor: c.border}]}>
            <Text style={[s.headerTitle, {color: c.textPrimary}]}>DISPUTE TICKET</Text>
            <TouchableOpacity
              style={[s.closeBtn, {backgroundColor: c.surface}]}
              onPress={() => navigation.goBack()}
              activeOpacity={0.7}>
              <MaterialIcons name="close" size={ms(20)} color={c.textSecondary} />
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
            <SignaturePad onSignatureChange={handleSignatureChange} height={sigHeight} onTouchStart={() => setScrollEnabled(false)} onTouchEnd={() => setScrollEnabled(true)} />

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
      </KeyboardAvoidingView>
    </View>
  );
}

const s = StyleSheet.create({
  container: {flex: 1},
  flex1: {flex: 1},
  scroll: {flex: 1},
  scrollContent: {flexGrow: 1},

  card: {
    marginHorizontal: wp(10),
    marginBottom: wp(10),
    borderRadius: wp(14),
    overflow: 'hidden',
  },

  // Header
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: wp(10),
    paddingHorizontal: wp(14),
    borderBottomWidth: 1,
  },
  headerTitle: {fontSize: ms(15), fontWeight: '800', letterSpacing: 0.5, flex: 1, textAlign: 'center'},
  closeBtn: {width: wp(32), height: wp(32), borderRadius: wp(16), justifyContent: 'center', alignItems: 'center', position: 'absolute', right: wp(8)},

  // Info
  infoSection: {paddingHorizontal: wp(16), paddingVertical: wp(18)},
  infoRow: {flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', paddingVertical: wp(10), gap: wp(10)},
  infoLabel: {fontSize: ms(13), fontWeight: '800', minWidth: wp(75), maxWidth: wp(110)},
  infoValue: {fontSize: ms(13), fontWeight: '500', flex: 1},

  // Quantity
  qtyRow: {flexDirection: 'row', alignItems: 'center', gap: wp(8)},
  qtyInput: {width: wp(80), borderBottomWidth: 1, paddingVertical: wp(4), fontSize: ms(14), fontWeight: '600'},
  qtyUnit: {fontSize: ms(14), fontWeight: '600'},

  // Reason
  reasonInput: {flex: 1, borderBottomWidth: 1, paddingVertical: wp(4), fontSize: ms(14)},

  // Divider
  divider: {height: 1, marginHorizontal: wp(20)},

  // Sign
  signSection: {paddingHorizontal: wp(16), paddingVertical: wp(20)},
  typeNameRow: {flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: wp(10), marginBottom: wp(16)},
  typeNameLabel: {fontSize: ms(14), fontWeight: '800'},
  typeNameInput: {flex: 1, borderBottomWidth: 1, paddingVertical: wp(4), fontSize: ms(14)},


  // Dispute button
  disputeBtn: {
    marginTop: wp(14),
    paddingVertical: wp(8),
    borderRadius: wp(6),
    minHeight: wp(36),
    alignItems: 'center',
    justifyContent: 'center',
  },
  disputeBtnText: {fontSize: ms(14), fontWeight: '800', letterSpacing: 0.5},
});
