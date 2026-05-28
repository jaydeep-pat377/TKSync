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

const CUSTOMER_INFO = [
  {label: 'CUSTOMER', value: 'GILLAM CONSTRUCTION GROUP'},
  {label: 'PROJECT', value: 'BLDG A - SEWELLS ROAD RESIDENTIAL BUILDI'},
  {label: 'ADDRESS', value: '3080 BOSTWICK RD LONDON\nMapPage:LOT88'},
  {label: 'ORDERED BY', value: 'MARK'},
  {label: 'INSTRUCTIONS', value: 'GREY TOWER CRANE - PICK POINT 1 - POURING OFF BOSTWICK RD', highlight: true},
];

const DRIVER_COL = [
  {label: 'DRIVER', value: '109003'},
  {label: 'PLANT', value: '26-SCARBOROUGH R/M'},
  {label: 'LOAD', value: '9.00 M3 (0.00 M3 Poured)'},
  {label: 'QUANTITY', value: '9.00 M3 of 110.10 M3'},
];

const TRUCK_COL = [
  {label: 'TRUCK', value: '605'},
  {label: 'TRUCK AHEAD', value: ''},
  {label: 'SLUMP', value: '120+-30 mm'},
  {label: 'USAGE', value: ''},
];

// Landscape section header
function LSectionHead({icon, title, color}: {icon: string; title: string; color: string}) {
  return (
    <View style={{flexDirection: 'row', alignItems: 'center', gap: 5, marginBottom: 5}}>
      <MaterialIcons name={icon as any} size={13} color={color} />
      <Text style={{fontSize: 10, fontWeight: '800', letterSpacing: 0.8, color}}>{title}</Text>
    </View>
  );
}

// Landscape info row
function LRow({label, value, highlight, highlightBg, textColor, labelW = 85}: {label: string; value: string; highlight?: boolean; highlightBg?: string; textColor: string; labelW?: number}) {
  return (
    <View style={{flexDirection: 'row', paddingVertical: 3}}>
      <Text style={{minWidth: labelW, maxWidth: labelW + 15, fontSize: 11, fontWeight: '800', color: textColor}}>{label}</Text>
      <Text style={[
        {flex: 1, fontSize: 12, fontWeight: '500', color: textColor},
        highlight && {paddingHorizontal: 4, paddingVertical: 1, backgroundColor: highlightBg, borderRadius: 3},
      ]}>{value}</Text>
    </View>
  );
}

export default function MobileTicketScreen({navigation}: Props) {
  const {c} = useTheme();
  const insets = useSafeAreaInsets();
  const {width, height: winHeight} = useWindowDimensions();
  const isTablet = Math.min(width, winHeight) > 600;
  const isLandscape = width > winHeight;
  const wide = isTablet || isLandscape;
  const hMargin = isTablet ? 24 : isLandscape ? 16 : wp(12);

  return (
    <View style={[styles.container, {backgroundColor: c.background}]}>
      <StatusBar translucent backgroundColor="transparent" barStyle="light-content" />
      <View style={[styles.topBar, {paddingTop: insets.top, backgroundColor: c.accentBg}]} />

      <ScrollView
        style={[styles.scroll, {backgroundColor: c.accentBg}]}
        contentContainerStyle={[styles.scrollContent, {paddingLeft: Math.max(0, insets.left), paddingRight: Math.max(0, insets.right)}]}
        showsVerticalScrollIndicator={false}>

        {/* Ticket Card — full width with consistent margins */}
        <View style={[
          styles.ticketCard,
          {backgroundColor: c.white, shadowColor: c.shadowColor, marginHorizontal: hMargin},
        ]}>

          {/* Banner */}
          <View style={[styles.banner, {backgroundColor: c.bannerBg}, wide && {paddingHorizontal: 14, paddingVertical: 10}]}>
            <Text style={[styles.bannerTitle, {color: c.textOnPrimary}, wide && {fontSize: 17}]}>MOBILE TICKET</Text>
            <View style={[styles.qrPlaceholder, {backgroundColor: c.overlay15}, wide && {width: 42, height: 42, borderRadius: 7}]}>
              <MaterialIcons name="qr-code-2" size={wide ? 28 : ms(40)} color={c.textOnPrimary} />
            </View>
          </View>

          {/* Order / Ticket / Date row */}
          <View style={[styles.metaRow, {borderBottomColor: c.border}, wide && {paddingVertical: 7, paddingHorizontal: 14, gap: 4}]}>
            {[{label: 'ORDER', value: '2605'}, {label: 'TICKET', value: '26209538'}, {label: 'DATE', value: '05/22/2026'}].map(item => (
              <View key={item.label} style={[styles.metaItem, wide && {minWidth: 60}]}>
                <Text style={[styles.metaLabel, {color: c.textPrimary}, wide && {fontSize: 10}]}>{item.label}</Text>
                <Text style={[styles.metaValue, {color: c.textPrimary}, wide && {fontSize: 13}]}>{item.value}</Text>
              </View>
            ))}
            <TouchableOpacity
              style={[styles.closeBtn, {backgroundColor: c.surface}, wide && {width: 28, height: 28, borderRadius: 14}]}
              onPress={() => navigation.goBack()} activeOpacity={0.7}>
              <MaterialIcons name="close" size={wide ? 16 : ms(20)} color={c.textSecondary} />
            </TouchableOpacity>
          </View>

          {/* ─── LANDSCAPE LAYOUT ─── */}
          {isLandscape ? (
            <>
              {/* Row 1: Customer Info (left 55%) + Driver/Truck (right 45%) */}
              <View style={{flexDirection: 'row', borderBottomWidth: 1, borderBottomColor: c.border}}>
                <View style={{flex: 55, paddingHorizontal: 14, paddingVertical: 10, borderRightWidth: 1, borderRightColor: c.border}}>
                  <LSectionHead icon="people" title="CUSTOMER DETAILS" color={c.primary} />
                  {CUSTOMER_INFO.map(item => (
                    <LRow key={item.label} label={item.label} value={item.value} highlight={item.highlight} highlightBg={c.highlight} textColor={c.textPrimary} />
                  ))}
                </View>
                <View style={{flex: 45, paddingHorizontal: 14, paddingVertical: 10}}>
                  <LSectionHead icon="local-shipping" title="DRIVER & TRUCK" color={c.primary} />
                  <View style={{flexDirection: 'row', gap: 10}}>
                    <View style={{flex: 1}}>
                      {DRIVER_COL.map(item => (
                        <LRow key={item.label} label={item.label} value={item.value} textColor={c.textPrimary} labelW={65} />
                      ))}
                    </View>
                    <View style={{flex: 1}}>
                      {TRUCK_COL.map(item => (
                        <LRow key={item.label} label={item.label} value={item.value} textColor={c.textPrimary} labelW={65} />
                      ))}
                    </View>
                  </View>
                </View>
              </View>

              {/* Row 2: Charges Table — full width, inline columns */}
              <View style={{paddingHorizontal: 14, paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: c.border}}>
                <LSectionHead icon="receipt-long" title="CHARGES" color={c.primary} />
                <View>
                  <View style={[styles.tableRow, styles.tableHeader, {borderBottomColor: c.textPrimary, paddingVertical: 6, paddingBottom: 5}]}>
                    <Text style={[wColCode, styles.thText, {color: c.textPrimary}]}>CODE</Text>
                    <Text style={[{flex: 1}, styles.thText, {color: c.textPrimary, fontSize: 11}]}>DESCRIPTION</Text>
                    <Text style={[wColQty, styles.thText, {color: c.textPrimary}]}>QTY</Text>
                    <Text style={[wColUnit, styles.thText, {color: c.textPrimary}]}>UNIT</Text>
                    <Text style={[wColPrice, styles.thText, {color: c.textPrimary}]}>PRICE</Text>
                    <Text style={[wColAmount, styles.thText, {color: c.textPrimary}]}>AMOUNT</Text>
                  </View>
                  {CHARGES.map((row, i) => (
                    <View key={`${row.code}-${i}`} style={[styles.tableRow, {borderBottomColor: c.borderLight, paddingVertical: 5}]}>
                      <Text style={[wColCode, styles.tdText, {color: c.textPrimary}]}>{row.code}</Text>
                      <Text style={[{flex: 1}, styles.tdText, {color: c.textPrimary, fontSize: 11}]}>{row.desc}</Text>
                      <Text style={[wColQty, styles.tdText, {color: c.textPrimary}]}>{row.qty}</Text>
                      <Text style={[wColUnit, styles.tdText, {color: c.textPrimary}]}>{row.unit}</Text>
                      <Text style={[wColPrice, styles.tdText, {color: c.textPrimary}]}>{row.price}</Text>
                      <Text style={[wColAmount, styles.tdText, {color: c.textPrimary}]}>{row.amount}</Text>
                    </View>
                  ))}
                </View>
                <View style={{alignItems: 'flex-end', marginTop: 8}}>
                  {[{label: 'Sub', value: '0.00'}, {label: 'Tax', value: '0.00'}, {label: 'Total', value: 'ON ACCOUNT'}].map(item => (
                    <View key={item.label} style={{flexDirection: 'row', paddingVertical: 4, minWidth: 180, maxWidth: 250}}>
                      <Text style={{flex: 1, fontSize: 13, fontWeight: '800', textAlign: 'right', paddingRight: 14, color: c.textPrimary}}>{item.label}</Text>
                      <Text style={{minWidth: 90, fontSize: 13, fontWeight: '500', color: c.textPrimary}}>{item.value}</Text>
                    </View>
                  ))}
                </View>
              </View>

              {/* Row 3: Timeline (left) + Signature/Actions (right) */}
              <View style={{flexDirection: 'row'}}>
                <View style={{flex: 1, paddingHorizontal: 14, paddingVertical: 10, borderRightWidth: 1, borderRightColor: c.border}}>
                  <LSectionHead icon="schedule" title="DELIVERY TIMELINE" color={c.primary} />
                  <View style={{flexDirection: 'row', flexWrap: 'wrap'}}>
                    {TIMELINE_GRID.map(item => (
                      <View key={item.label} style={{minWidth: 90, flex: 1, paddingVertical: 3, paddingRight: 8}}>
                        <Text style={{fontSize: 10, fontWeight: '800', color: c.textMuted, letterSpacing: 0.3}}>{item.label}</Text>
                        <Text style={{fontSize: 13, fontWeight: '700', color: c.textPrimary, marginTop: 1}}>{item.time}</Text>
                      </View>
                    ))}
                  </View>
                </View>
                <View style={{width: isTablet ? 320 : 220, paddingHorizontal: 14, paddingVertical: 10, alignItems: 'center', justifyContent: 'center'}}>
                  <View style={{width: '100%', height: 48, borderRadius: 8, borderWidth: 1, backgroundColor: c.surface, borderColor: c.border, marginBottom: 8}} />
                  <View style={{flexDirection: 'row', gap: 8, width: '100%'}}>
                    <TouchableOpacity style={{flex: 1, paddingVertical: 8, borderRadius: 7, alignItems: 'center', justifyContent: 'center', backgroundColor: c.signBtn}} activeOpacity={0.8} onPress={() => navigation.navigate('AcceptTicket')}>
                      <Text style={{fontSize: 12, fontWeight: '800', letterSpacing: 0.5, color: c.textOnPrimary}}>SIGN</Text>
                    </TouchableOpacity>
                    <TouchableOpacity style={{flex: 1, paddingVertical: 8, borderRadius: 7, alignItems: 'center', justifyContent: 'center', backgroundColor: c.disputeBtn}} activeOpacity={0.8} onPress={() => navigation.navigate('DisputeTicket')}>
                      <Text style={{fontSize: 12, fontWeight: '800', letterSpacing: 0.5, color: c.textOnPrimary}}>DISPUTE</Text>
                    </TouchableOpacity>
                  </View>
                  <TouchableOpacity style={{marginTop: 8}} onPress={() => navigation.goBack()} activeOpacity={0.7}>
                    <Text style={{fontSize: 12, fontWeight: '700', letterSpacing: 0.3, color: c.linkBlue}}>DASHBOARD</Text>
                  </TouchableOpacity>
                </View>
              </View>
            </>
          ) : (
            /* ─── PORTRAIT LAYOUT ─── */
            <>
              {/* Customer Info */}
              <View style={[styles.section, {borderBottomColor: c.border}]}>
                {CUSTOMER_INFO.map(item => (
                  <View key={item.label} style={styles.infoRow}>
                    <Text style={[styles.infoLabel, {color: c.textPrimary}]}>{item.label}</Text>
                    <Text style={[
                      styles.infoValue, {color: c.textPrimary},
                      item.highlight && styles.highlightValue,
                      item.highlight && {backgroundColor: c.highlight},
                    ]}>{item.value}</Text>
                  </View>
                ))}
              </View>

              {/* Driver / Truck Info */}
              <View style={[styles.section, {borderBottomColor: c.border}]}>
                <View style={styles.twoColGrid}>
                  <View style={styles.gridCol}>
                    {DRIVER_COL.map(item => (
                      <View key={item.label} style={styles.gridRow}>
                        <Text style={[styles.gridLabel, {color: c.textPrimary}]}>{item.label}</Text>
                        <Text style={[styles.gridValue, {color: c.textPrimary}]}>{item.value}</Text>
                      </View>
                    ))}
                  </View>
                  <View style={styles.gridCol}>
                    {TRUCK_COL.map(item => (
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
                  <View style={{minWidth: Math.max(width * 0.85, 360)}}>
                    <View style={[styles.tableRow, styles.tableHeader, {borderBottomColor: c.textPrimary}]}>
                      <Text style={[styles.colCode, styles.thText, {color: c.textPrimary}]}>CODE</Text>
                      <Text style={[styles.colDesc, styles.thText, {color: c.textPrimary}]}>DESCRIPTION</Text>
                      <Text style={[styles.colQty, styles.thText, {color: c.textPrimary}]}>QTY</Text>
                      <Text style={[styles.colUnit, styles.thText, {color: c.textPrimary}]}>UNIT</Text>
                      <Text style={[styles.colPrice, styles.thText, {color: c.textPrimary}]}>PRICE</Text>
                      <Text style={[styles.colAmount, styles.thText, {color: c.textPrimary}]}>TICKET{'\n'}AMOUNT</Text>
                    </View>
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
                <View style={styles.totalsBlock}>
                  {[{label: 'Sub', value: '0.00'}, {label: 'Tax', value: '0.00'}, {label: 'Total', value: 'ON ACCOUNT'}].map(item => (
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
                <View style={styles.actionRow}>
                  <TouchableOpacity style={[styles.signBtn, {backgroundColor: c.signBtn}]} activeOpacity={0.8} onPress={() => navigation.navigate('AcceptTicket')}>
                    <Text style={[styles.signBtnText, {color: c.textOnPrimary}]}>SIGN</Text>
                  </TouchableOpacity>
                  <TouchableOpacity style={[styles.disputeBtn, {backgroundColor: c.disputeBtn}]} activeOpacity={0.8} onPress={() => navigation.navigate('DisputeTicket')}>
                    <Text style={[styles.disputeBtnText, {color: c.textOnPrimary}]}>DISPUTE</Text>
                  </TouchableOpacity>
                </View>
                <TouchableOpacity style={styles.dashboardLink} onPress={() => navigation.goBack()} activeOpacity={0.7}>
                  <Text style={[styles.dashboardLinkText, {color: c.linkBlue}]}>DASHBOARD</Text>
                </TouchableOpacity>
              </View>
            </>
          )}
        </View>
      </ScrollView>
    </View>
  );
}

// Fixed column widths for landscape/tablet table
const wColCode = {minWidth: 60, maxWidth: 70, fontSize: 11};
const wColQty = {minWidth: 36, maxWidth: 50, fontSize: 11, textAlign: 'right' as const};
const wColUnit = {minWidth: 30, maxWidth: 40, fontSize: 11, textAlign: 'center' as const};
const wColPrice = {minWidth: 40, maxWidth: 50, fontSize: 11, textAlign: 'right' as const};
const wColAmount = {minWidth: 65, maxWidth: 95, fontSize: 11, textAlign: 'right' as const};

const styles = StyleSheet.create({
  container: {flex: 1},
  topBar: {height: 0},
  scroll: {flex: 1},
  scrollContent: {paddingTop: wp(6), paddingBottom: wp(40)},
  ticketCard: {borderRadius: wp(14), overflow: 'hidden', elevation: 4, shadowOffset: {width: 0, height: 2}, shadowOpacity: 0.12, shadowRadius: 8},
  banner: {flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: wp(14), paddingVertical: wp(10)},
  bannerTitle: {fontSize: ms(20), fontWeight: '900', letterSpacing: 1.5},
  qrPlaceholder: {width: wp(52), height: wp(52), borderRadius: wp(8), justifyContent: 'center', alignItems: 'center'},
  metaRow: {flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', paddingVertical: wp(8), paddingHorizontal: wp(14), borderBottomWidth: 1, gap: wp(4)},
  metaItem: {flex: 1, alignItems: 'center', minWidth: wp(70)},
  metaLabel: {fontSize: ms(11), fontWeight: '800', letterSpacing: 0.5},
  metaValue: {fontSize: ms(14), fontWeight: '600', marginTop: 2},
  closeBtn: {width: wp(32), height: wp(32), borderRadius: wp(16), justifyContent: 'center', alignItems: 'center'},
  section: {paddingHorizontal: wp(12), paddingVertical: wp(10), borderBottomWidth: 1},
  infoRow: {flexDirection: 'row', paddingVertical: wp(4)},
  infoLabel: {minWidth: wp(75), maxWidth: wp(110), fontSize: ms(11), fontWeight: '800'},
  infoValue: {flex: 1, fontSize: ms(13), fontWeight: '500'},
  highlightValue: {paddingHorizontal: wp(4), paddingVertical: wp(2)},
  twoColGrid: {flexDirection: 'row', flexWrap: 'wrap', gap: wp(8)},
  gridCol: {flex: 1, minWidth: 140},
  gridRow: {flexDirection: 'row', paddingVertical: wp(4)},
  gridLabel: {minWidth: wp(55), maxWidth: wp(90), fontSize: ms(11), fontWeight: '800'},
  gridValue: {flex: 1, fontSize: ms(12), fontWeight: '500'},
  tableRow: {flexDirection: 'row', alignItems: 'center', paddingVertical: wp(7), borderBottomWidth: 0.5},
  tableHeader: {borderBottomWidth: 1.5, paddingBottom: wp(6)},
  colCode: {minWidth: wp(50), maxWidth: wp(70)}, colDesc: {flex: 1}, colQty: {minWidth: wp(40), maxWidth: wp(55), textAlign: 'right'}, colUnit: {minWidth: wp(30), maxWidth: wp(45), textAlign: 'center'}, colPrice: {minWidth: wp(40), maxWidth: wp(55), textAlign: 'right'}, colAmount: {minWidth: wp(60), maxWidth: wp(95), textAlign: 'right'},
  thText: {fontSize: ms(12), fontWeight: '800'}, tdText: {fontSize: ms(12), fontWeight: '500'},
  totalsBlock: {marginTop: wp(8), alignItems: 'flex-end'},
  totalRow: {flexDirection: 'row', paddingVertical: wp(5), minWidth: wp(160), maxWidth: wp(240)},
  totalLabel: {flex: 1, fontSize: ms(13), fontWeight: '800', textAlign: 'right', paddingRight: wp(14)},
  totalValue: {minWidth: wp(80), maxWidth: wp(130), fontSize: ms(13), fontWeight: '500'},
  timeGrid: {flexDirection: 'row', flexWrap: 'wrap'},
  timeCell: {width: '50%', flexDirection: 'row', paddingVertical: wp(4)},
  timeLabel: {fontSize: ms(11), fontWeight: '800', minWidth: wp(55), maxWidth: wp(80)},
  timeValue: {fontSize: ms(12), fontWeight: '500'},
  signatureSection: {paddingHorizontal: wp(12), paddingVertical: wp(8), alignItems: 'center'},
  signatureBox: {width: '90%', maxWidth: wp(500), height: wp(65), borderRadius: wp(8), borderWidth: 1, marginBottom: wp(8)},
  actionRow: {flexDirection: 'row', gap: wp(8), width: '90%', maxWidth: wp(500)},
  signBtn: {flex: 1, paddingVertical: wp(7), borderRadius: wp(6), alignItems: 'center', justifyContent: 'center', minHeight: wp(32)},
  signBtnText: {fontSize: ms(13), fontWeight: '800', letterSpacing: 0.5},
  disputeBtn: {flex: 1, paddingVertical: wp(7), borderRadius: wp(6), alignItems: 'center', justifyContent: 'center', minHeight: wp(32)},
  disputeBtnText: {fontSize: ms(13), fontWeight: '800', letterSpacing: 0.5},
  dashboardLink: {marginTop: wp(8)},
  dashboardLinkText: {fontSize: ms(13), fontWeight: '700', letterSpacing: 0.3},
});
