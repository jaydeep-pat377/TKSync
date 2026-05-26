import React from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  StatusBar,
  useWindowDimensions,
} from 'react-native';
import {useSafeAreaInsets} from 'react-native-safe-area-context';
import MaterialIcons from 'react-native-vector-icons/MaterialIcons';
import type {NativeStackNavigationProp} from '@react-navigation/native-stack';
import {useTheme} from '../contexts/ThemeContext';
import {wp, ms} from '../utils/responsive';

type Props = {
  navigation: NativeStackNavigationProp<any>;
};

const CHARGES = [
  {code: '6138609', desc: '35MPA AIR C1 .40 MR', qty: '9.00', unit: 'm3', price: '', amount: 'ON ACCOUNT'},
  {code: '2782', desc: 'EASYFLOW MID', qty: '0', unit: '/m', price: '', amount: 'ON ACCOUNT'},
  {code: '12581', desc: 'TOARC FEE', qty: '9.00', unit: '/m', price: '', amount: 'ON ACCOUNT'},
  {code: '14301', desc: 'FLEX FUEL SURCHARGE', qty: '9.00', unit: '/m', price: '', amount: 'ON ACCOUNT'},
  {code: '15902', desc: 'INDUSTRIAL EMISSIONS CHARGE', qty: '9.00', unit: '/m', price: '', amount: 'ON ACCOUNT'},
  {code: '2294', desc: 'AFTER HOURS CHARGE', qty: '9.00', unit: '/m', price: '', amount: 'ON ACCOUNT'},
  {code: '2571', desc: 'ENVIRONMENTAL CHARGE - M3', qty: '9.00', unit: '/m', price: '', amount: 'ON ACCOUNT'},
  {code: '5843', desc: 'FUEL SURCHARGE - CBM /M3', qty: '9.00', unit: '/m', price: '', amount: 'ON ACCOUNT'},
];

const TIMELINE_GRID = [
  {label: 'LOADING', time: '05:23'},
  {label: 'TO JOB', time: '05:49'},
  {label: 'ON JOB', time: '06:13'},
  {label: 'POURING', time: '06:19'},
  {label: 'WASHING', time: '06:47'},
  {label: 'TO PLANT', time: '06:55'},
  {label: 'AT PLANT', time: '--'},
];

export default function MobileTicketScreen({navigation}: Props) {
  const {c} = useTheme();
  const insets = useSafeAreaInsets();
  const {width, height: winHeight} = useWindowDimensions();
  const isTablet = Math.min(width, winHeight) > 600;

  return (
    <View style={[styles.container, {backgroundColor: c.background}]}>
      <StatusBar translucent backgroundColor="transparent" barStyle="light-content" />

      {/* Blue header bar */}
      <View style={[styles.topBar, {paddingTop: insets.top, backgroundColor: c.accentBg}]} />

      <ScrollView
        style={[styles.scroll, {backgroundColor: c.accentBg}]}
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}>

        {/* Ticket Card */}
        <View style={[styles.ticketCard, {backgroundColor: c.white, shadowColor: c.shadowColor}, isTablet && {marginHorizontal: wp(40), maxWidth: wp(800), alignSelf: 'center', width: '100%'}]}>

          {/* Banner */}
          <View style={[styles.banner, {backgroundColor: c.bannerBg}]}>
            <Text style={[styles.bannerTitle, {color: c.textOnPrimary}]}>MOBILE TICKET</Text>
            <View style={[styles.qrPlaceholder, {backgroundColor: c.overlay15}]}>
              <MaterialIcons name="qr-code-2" size={ms(48)} color={c.textOnPrimary} />
            </View>
          </View>

          {/* Order / Ticket / Date row */}
          <View style={[styles.metaRow, {borderBottomColor: c.border}]}>
            <View style={styles.metaItem}>
              <Text style={[styles.metaLabel, {color: c.textPrimary}]}>ORDER</Text>
              <Text style={[styles.metaValue, {color: c.textPrimary}]}>2605</Text>
            </View>
            <View style={styles.metaItem}>
              <Text style={[styles.metaLabel, {color: c.textPrimary}]}>TICKET</Text>
              <Text style={[styles.metaValue, {color: c.textPrimary}]}>26209538</Text>
            </View>
            <View style={styles.metaItem}>
              <Text style={[styles.metaLabel, {color: c.textPrimary}]}>DATE</Text>
              <Text style={[styles.metaValue, {color: c.textPrimary}]}>05/22/2026</Text>
            </View>
            <TouchableOpacity
              style={[styles.closeBtn, {backgroundColor: c.surface}]}
              onPress={() => navigation.goBack()}
              activeOpacity={0.7}>
              <MaterialIcons name="close" size={ms(20)} color={c.textSecondary} />
            </TouchableOpacity>
          </View>

          {/* Customer Info */}
          <View style={[styles.section, {borderBottomColor: c.border}]}>
            {[
              {label: 'CUSTOMER', value: 'GILLAM CONSTRUCTION GROUP'},
              {label: 'PROJECT', value: 'BLDG A - SEWELLS ROAD RESIDENTIAL BUILDI'},
              {label: 'ADDRESS', value: '3080 BOSTWICK RD LONDON\nMapPage:LOT88'},
              {label: 'ORDERED BY', value: 'MARK'},
              {label: 'INSTRUCTIONS', value: 'GREY TOWER CRANE - PICK POINT 1 - POURING OFF BOSTWICK RD', highlight: true},
            ].map(item => (
              <View key={item.label} style={styles.infoRow}>
                <Text style={[styles.infoLabel, {color: c.textPrimary}]}>{item.label}</Text>
                <Text style={[
                  styles.infoValue,
                  {color: c.textPrimary},
                  item.highlight && styles.highlightValue,
                  item.highlight && {backgroundColor: c.highlight},
                ]}>
                  {item.value}
                </Text>
              </View>
            ))}
          </View>

          {/* Driver / Truck Info */}
          <View style={[styles.section, {borderBottomColor: c.border}]}>
            <View style={styles.twoColGrid}>
              <View style={styles.gridCol}>
                {[
                  {label: 'DRIVER', value: '109003'},
                  {label: 'PLANT', value: '26-SCARBOROUGH R/M'},
                  {label: 'LOAD', value: '9.00 M3 (0.00 M3 Poured)'},
                  {label: 'QUANTITY', value: '9.00 M3 of 110.10 M3'},
                ].map(item => (
                  <View key={item.label} style={styles.gridRow}>
                    <Text style={[styles.gridLabel, {color: c.textPrimary}]}>{item.label}</Text>
                    <Text style={[styles.gridValue, {color: c.textPrimary}]}>{item.value}</Text>
                  </View>
                ))}
              </View>
              <View style={styles.gridCol}>
                {[
                  {label: 'TRUCK', value: '605'},
                  {label: 'TRUCK AHEAD', value: ''},
                  {label: 'SLUMP', value: '120+-30 mm'},
                  {label: 'USAGE', value: ''},
                ].map(item => (
                  <View key={item.label} style={styles.gridRow}>
                    <Text style={[styles.gridLabel, {color: c.textPrimary}]}>{item.label}</Text>
                    <Text style={[styles.gridValue, {color: c.textPrimary}]}>{item.value}</Text>
                  </View>
                ))}
              </View>
            </View>
          </View>

          {/* Charges Table */}
          <View style={[styles.section, {borderBottomColor: c.border}]}>
            <ScrollView horizontal showsHorizontalScrollIndicator={false}>
              <View style={{minWidth: wp(420)}}>
                {/* Table Header */}
                <View style={[styles.tableRow, styles.tableHeader, {borderBottomColor: c.textPrimary}]}>
                  <Text style={[styles.colCode, styles.thText, {color: c.textPrimary}]}>CODE</Text>
                  <Text style={[styles.colDesc, styles.thText, {color: c.textPrimary}]}>DESCRIPTION</Text>
                  <Text style={[styles.colQty, styles.thText, {color: c.textPrimary}]}>QTY</Text>
                  <Text style={[styles.colUnit, styles.thText, {color: c.textPrimary}]}>UNIT</Text>
                  <Text style={[styles.colPrice, styles.thText, {color: c.textPrimary}]}>PRICE</Text>
                  <Text style={[styles.colAmount, styles.thText, {color: c.textPrimary}]}>TICKET{'\n'}AMOUNT</Text>
                </View>
                {/* Table Body */}
                {CHARGES.map((row, i) => (
                  <View key={`${row.code}-${i}`} style={[styles.tableRow, {borderBottomColor: c.borderLight}]}>
                    <Text style={[styles.colCode, styles.tdText, {color: c.textPrimary}]}>{row.code}</Text>
                    <Text style={[styles.colDesc, styles.tdText, {color: c.textPrimary}]}>{row.desc}</Text>
                    <Text style={[styles.colQty, styles.tdText, {color: c.textPrimary}]}>{row.qty}</Text>
                    <Text style={[styles.colUnit, styles.tdText, {color: c.textPrimary}]}>{row.unit}</Text>
                    <Text style={[styles.colPrice, styles.tdText, {color: c.textPrimary}]}>{row.price}</Text>
                    <Text style={[styles.colAmount, styles.tdText, {color: c.textPrimary}]}>{row.amount}</Text>
                  </View>
                ))}
              </View>
            </ScrollView>
            {/* Totals */}
            <View style={styles.totalsBlock}>
              {[
                {label: 'Sub', value: '0.00'},
                {label: 'Tax', value: '0.00'},
                {label: 'Total', value: 'ON ACCOUNT'},
              ].map(item => (
                <View key={item.label} style={styles.totalRow}>
                  <Text style={[styles.totalLabel, {color: c.textPrimary}]}>{item.label}</Text>
                  <Text style={[styles.totalValue, {color: c.textPrimary}]}>{item.value}</Text>
                </View>
              ))}
            </View>
          </View>

          {/* Timeline Grid */}
          <View style={[styles.section, {borderBottomColor: c.border}]}>
            <View style={styles.timeGrid}>
              {TIMELINE_GRID.map(item => (
                <View key={item.label} style={styles.timeCell}>
                  <Text style={[styles.timeLabel, {color: c.textPrimary}]}>{item.label}</Text>
                  <Text style={[styles.timeValue, {color: c.textPrimary}]}>{item.time}</Text>
                </View>
              ))}
            </View>
          </View>

          {/* Signature Area */}
          <View style={styles.signatureSection}>
            <View style={[styles.signatureBox, {backgroundColor: c.surface, borderColor: c.border}]} />

            {/* Action Buttons */}
            <View style={styles.actionRow}>
              <TouchableOpacity style={[styles.signBtn, {backgroundColor: c.signBtn}]} activeOpacity={0.8} onPress={() => navigation.navigate('AcceptTicket')}>
                <Text style={[styles.signBtnText, {color: c.textOnPrimary}]}>SIGN</Text>
              </TouchableOpacity>
              <TouchableOpacity style={[styles.disputeBtn, {backgroundColor: c.disputeBtn}]} activeOpacity={0.8} onPress={() => navigation.navigate('DisputeTicket')}>
                <Text style={[styles.disputeBtnText, {color: c.textOnPrimary}]}>DISPUTE</Text>
              </TouchableOpacity>
            </View>

            {/* Dashboard Link */}
            <TouchableOpacity
              style={styles.dashboardLink}
              onPress={() => navigation.goBack()}
              activeOpacity={0.7}>
              <Text style={[styles.dashboardLinkText, {color: c.linkBlue}]}>DASHBOARD</Text>
            </TouchableOpacity>
          </View>

        </View>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {flex: 1},
  topBar: {height: 0},
  scroll: {flex: 1},
  scrollContent: {paddingTop: wp(8), paddingBottom: wp(30)},
  ticketCard: {marginHorizontal: wp(12), borderRadius: wp(14), overflow: 'hidden', elevation: 4, shadowOffset: {width: 0, height: 2}, shadowOpacity: 0.12, shadowRadius: 8},
  banner: {flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: wp(16), paddingVertical: wp(16)},
  bannerTitle: {fontSize: ms(22), fontWeight: '900', letterSpacing: 1.5},
  qrPlaceholder: {width: wp(64), height: wp(64), borderRadius: wp(8), justifyContent: 'center', alignItems: 'center'},
  metaRow: {flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', paddingVertical: wp(12), paddingHorizontal: wp(16), borderBottomWidth: 1, gap: wp(4)},
  metaItem: {flex: 1, alignItems: 'center', minWidth: wp(70)},
  metaLabel: {fontSize: ms(11), fontWeight: '800', letterSpacing: 0.5},
  metaValue: {fontSize: ms(14), fontWeight: '600', marginTop: 2},
  closeBtn: {width: wp(32), height: wp(32), borderRadius: wp(16), justifyContent: 'center', alignItems: 'center'},
  section: {paddingHorizontal: wp(14), paddingVertical: wp(14), borderBottomWidth: 1},
  infoRow: {flexDirection: 'row', paddingVertical: wp(6)},
  infoLabel: {minWidth: wp(75), maxWidth: wp(110), fontSize: ms(12), fontWeight: '800'},
  infoValue: {flex: 1, fontSize: ms(13), fontWeight: '500'},
  highlightValue: {paddingHorizontal: wp(4), paddingVertical: wp(2)},
  twoColGrid: {flexDirection: 'row', gap: wp(8)},
  gridCol: {flex: 1},
  gridRow: {flexDirection: 'row', paddingVertical: wp(6)},
  gridLabel: {minWidth: wp(55), maxWidth: wp(90), fontSize: ms(11), fontWeight: '800'},
  gridValue: {flex: 1, fontSize: ms(12), fontWeight: '500'},
  tableRow: {flexDirection: 'row', alignItems: 'center', paddingVertical: wp(10), borderBottomWidth: 0.5},
  tableHeader: {borderBottomWidth: 1.5, paddingBottom: wp(8)},
  colCode: {minWidth: wp(50), maxWidth: wp(70)}, colDesc: {flex: 1}, colQty: {minWidth: wp(40), maxWidth: wp(55), textAlign: 'right'}, colUnit: {minWidth: wp(30), maxWidth: wp(45), textAlign: 'center'}, colPrice: {minWidth: wp(40), maxWidth: wp(55), textAlign: 'right'}, colAmount: {minWidth: wp(60), maxWidth: wp(95), textAlign: 'right'},
  thText: {fontSize: ms(12), fontWeight: '800'}, tdText: {fontSize: ms(12), fontWeight: '500'},
  totalsBlock: {marginTop: wp(12), alignItems: 'flex-end'},
  totalRow: {flexDirection: 'row', paddingVertical: wp(8), minWidth: wp(160), maxWidth: wp(240)},
  totalLabel: {flex: 1, fontSize: ms(14), fontWeight: '800', textAlign: 'right', paddingRight: wp(16)},
  totalValue: {minWidth: wp(80), maxWidth: wp(130), fontSize: ms(14), fontWeight: '500'},
  timeGrid: {flexDirection: 'row', flexWrap: 'wrap'},
  timeCell: {width: '50%', flexDirection: 'row', paddingVertical: wp(6)},
  timeLabel: {fontSize: ms(11), fontWeight: '800', minWidth: wp(55), maxWidth: wp(80)},
  timeValue: {fontSize: ms(12), fontWeight: '500'},
  signatureSection: {paddingHorizontal: wp(14), paddingVertical: wp(10), alignItems: 'center'},
  signatureBox: {width: '90%', maxWidth: wp(500), height: wp(80), borderRadius: wp(8), borderWidth: 1, marginBottom: wp(10)},
  actionRow: {flexDirection: 'row', gap: wp(10), width: '90%', maxWidth: wp(500)},
  signBtn: {flex: 1, paddingVertical: wp(8), borderRadius: wp(6), alignItems: 'center', justifyContent: 'center', minHeight: wp(36)},
  signBtnText: {fontSize: ms(14), fontWeight: '800', letterSpacing: 0.5},
  disputeBtn: {flex: 1, paddingVertical: wp(8), borderRadius: wp(6), alignItems: 'center', justifyContent: 'center', minHeight: wp(36)},
  disputeBtnText: {fontSize: ms(14), fontWeight: '800', letterSpacing: 0.5},
  dashboardLink: {marginTop: wp(12)},
  dashboardLinkText: {fontSize: ms(14), fontWeight: '700', letterSpacing: 0.3},
});
