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

export default function CurblineReleaseScreen({navigation}: Props) {
  const {c} = useTheme();
  const insets = useSafeAreaInsets();
  const {height} = useWindowDimensions();
  const sigHeight = Math.min(220, Math.max(120, height * 0.3));
  const [typeName, setTypeName] = useState('');
  const [signature, setSignature] = useState<string | null>(null);

  const handleSignatureChange = useCallback((sig: string | null) => {
    setSignature(sig);
  }, []);

  const canSubmit = typeName.trim().length > 0 && signature !== null && signature.length > 0;

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
            <Text style={[s.headerTitle, {color: c.textPrimary}]}>CURBLINE RELEASE</Text>
            <TouchableOpacity
              style={[s.closeBtn, {backgroundColor: c.surface}]}
              onPress={() => navigation.goBack()}
              activeOpacity={0.7}>
              <MaterialIcons name="close" size={20} color={c.textSecondary} />
            </TouchableOpacity>
          </View>

          {/* Info Section */}
          <View style={s.infoSection}>
            <View style={s.infoRow}>
              <Text style={[s.infoLabel, {color: c.textPrimary}]}>CUSTOMER</Text>
              <Text style={[s.infoValue, {color: c.textPrimary}]}>GILLAM CONSTRUCTION GROUP (5902227)</Text>
            </View>
            <View style={s.infoRow}>
              <Text style={[s.infoLabel, {color: c.textPrimary}]}>PROJECT</Text>
              <Text style={[s.infoValue, {color: c.textPrimary}]}>BLDG A - SEWELLS ROAD RESIDENTIAL (5000157438)</Text>
            </View>
            <View style={s.infoRow}>
              <Text style={[s.infoLabel, {color: c.textPrimary}]}>ORDER</Text>
              <Text style={[s.infoValue, {color: c.textPrimary}]}>2605</Text>
            </View>
            <View style={s.infoRow}>
              <Text style={[s.infoLabel, {color: c.textPrimary}]}>TICKET</Text>
              <Text style={[s.infoValue, {color: c.textPrimary}]}>26209538</Text>
            </View>
            <View style={s.infoRow}>
              <Text style={[s.infoLabel, {color: c.textPrimary}]}>RELEASED</Text>
              <Text style={[s.infoValue, {color: c.textMuted}]} />
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

            <SignaturePad onSignatureChange={handleSignatureChange} height={sigHeight} />

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
  card: {marginHorizontal: 10, marginBottom: 10, borderRadius: 14, overflow: 'hidden'},

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

  infoSection: {paddingHorizontal: 24, paddingVertical: 20},
  infoRow: {flexDirection: 'row', alignItems: 'flex-start', paddingVertical: 14, gap: 16},
  infoLabel: {fontSize: 14, fontWeight: '800', width: 120},
  infoValue: {fontSize: 14, fontWeight: '500', flex: 1},

  divider: {height: 1, marginHorizontal: 20},

  signSection: {paddingHorizontal: 24, paddingVertical: 24},
  typeNameRow: {flexDirection: 'row', alignItems: 'center', gap: 16, marginBottom: 8},
  typeNameLabel: {fontSize: 14, fontWeight: '800'},
  typeNameInput: {flex: 1, borderBottomWidth: 1, paddingVertical: 4, fontSize: 14},

  submitBtn: {marginTop: 24, paddingVertical: 16, borderRadius: 10, alignItems: 'center'},
  submitBtnText: {fontSize: 16, fontWeight: '800', letterSpacing: 0.5},
});
