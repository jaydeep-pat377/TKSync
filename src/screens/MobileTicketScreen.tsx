import React, {useEffect, useState, useCallback} from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  StatusBar,
  useWindowDimensions,
  ActivityIndicator,
} from 'react-native';
import {useSafeAreaInsets} from 'react-native-safe-area-context';
import MaterialIcons from 'react-native-vector-icons/MaterialIcons';
import type {NativeStackNavigationProp} from '@react-navigation/native-stack';
import type {RouteProp} from '@react-navigation/native';
import {useTheme} from '../contexts/ThemeContext';
import {wp, ms} from '../utils/responsive';
import {ticketsApi, type MobileTicketPrint} from '../services/api';

type Props = {
  navigation: NativeStackNavigationProp<any>;
  route: RouteProp<{MobileTicket: {ticketId?: number}}, 'MobileTicket'>;
};

const fmtTime = (t: string | null) => {
  if (!t) return '--';
  const d = new Date(t);
  const h = d.getHours();
  const m = d.getMinutes().toString().padStart(2, '0');
  const ampm = h >= 12 ? 'PM' : 'AM';
  const h12 = h % 12 || 12;
  return `${h12}:${m} ${ampm}`;
};

const fmtAmount = (v: number | null, onAccount: boolean) => {
  if (onAccount || v == null) return 'ON ACCOUNT';
  return `$${v.toFixed(2)}`;
};

// Temporary frontend UOM normalization — should be fixed in API
const UOM_MAP: Record<string, string> = {MQ: 'CY'};
const normalizeUOM = (unit: string | null): string => {
  if (!unit) return '-';
  return UOM_MAP[unit.toUpperCase()] || unit;
};

// Landscape section header
function LSectionHead({icon, title, color}: {icon: string; title: string; color: string}) {
  return (
    <View style={{flexDirection: 'row', alignItems: 'center', gap: 5, marginBottom: 8}}>
      <MaterialIcons name={icon as any} size={ms(15)} color={color} />
      <Text style={{fontSize: ms(13), fontWeight: '800', letterSpacing: 0.5, color}}>{title}</Text>
    </View>
  );
}

// Landscape info row
function LRow({label, value, highlight, highlightBg, textColor, labelColor, labelW = 80}: {label: string; value: string; highlight?: boolean; highlightBg?: string; textColor: string; labelColor?: string; labelW?: number}) {
  return (
    <View style={{flexDirection: 'row', paddingVertical: 6}}>
      <Text style={{minWidth: labelW, maxWidth: labelW + 10, fontSize: ms(12), fontWeight: '600', color: labelColor || '#9E9E9E'}}>{label}</Text>
      <Text style={[
        {flex: 1, fontSize: ms(13), fontWeight: '600', color: textColor},
        highlight && {paddingHorizontal: 4, paddingVertical: 2, backgroundColor: highlightBg, borderRadius: 3},
      ]}>{value}</Text>
    </View>
  );
}

// Section label with icon
function SLabel({text, icon, color}: {text: string; icon?: string; color: string}) {
  return (
    <View style={{flexDirection: 'row', alignItems: 'center', gap: wp(5), marginBottom: wp(6)}}>
      {icon && <MaterialIcons name={icon as any} size={ms(13)} color={color} />}
      <Text style={{fontSize: ms(10), fontWeight: '800', letterSpacing: 0.6, color}}>{text}</Text>
    </View>
  );
}

export default function MobileTicketScreen({navigation, route}: Props) {
  const {c} = useTheme();
  const insets = useSafeAreaInsets();
  const {width, height: winHeight} = useWindowDimensions();
  const isTablet = Math.min(width, winHeight) > 600;
  const isLandscape = width > winHeight;
  const wide = isTablet || isLandscape;
  const hMargin = isTablet ? 24 : isLandscape ? 16 : wp(10);

  const ticketId = route.params?.ticketId;
  const [data, setData] = useState<MobileTicketPrint | null>(null);
  const [loading, setLoading] = useState(false);

  const fetchPrintable = useCallback(async (id: number) => {
    setLoading(true);
    try {
      const res = await ticketsApi.getPrintable(id);
      setData(res.data);
    } catch (err) {
      console.log('[MobileTicket] fetch error:', err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (ticketId) {
      fetchPrintable(ticketId);
    }
  }, [ticketId, fetchPrintable]);

  // Derived display data
  const header = data?.header;
  const cust = data?.customer;
  const dt = data?.driver_truck;
  const tl = data?.timeline;
  const totals = data?.totals;
  const charges = data?.charges || [];

  const orderCode = header?.order_code || '-';
  const ticketCode = header?.ticket_code || '-';
  const orderDate = header?.order_date
    ? new Date(header.order_date).toLocaleDateString('en-US', {month: '2-digit', day: '2-digit', year: 'numeric'})
    : '-';

  const customerInfo = cust ? [
    {label: 'CUSTOMER', value: cust.customer_name || '-'},
    {label: 'PROJECT', value: cust.project_name || '-'},
    {label: 'ADDRESS', value: cust.address ? `${cust.address}${cust.map_page ? `\nMapPage:${cust.map_page}` : ''}` : '-'},
    {label: 'ORDERED BY', value: cust.ordered_by || '-'},
    {label: 'INSTRUCTIONS', value: cust.instructions || '-', highlight: Boolean(cust.instructions)},
  ] : [];

  const driverCol = dt ? [
    {label: 'DRIVER', value: dt.driver_code || '-'},
    {label: 'PLANT', value: dt.plant_name || '-'},
    {label: 'LOAD', value: dt.load.display || '-'},
    {label: 'QUANTITY', value: dt.quantity.display || '-'},
  ] : [];

  const truckCol = dt ? [
    {label: 'TRUCK', value: dt.truck_code || '-'},
    {label: 'TRUCK AHEAD', value: dt.truck_ahead || '-'},
    {label: 'SLUMP', value: dt.slump || '-'},
    {label: 'USAGE', value: dt.usage || '-'},
  ] : [];

  const timelineGrid = tl?.steps
    ? tl.steps.map(step => ({label: step.label.toUpperCase(), time: fmtTime(step.time)}))
    : [];

  const subTotal = totals?.subtotal != null ? totals.subtotal.toFixed(2) : '0.00';
  const taxTotal = totals?.tax != null ? totals.tax.toFixed(2) : '0.00';
  const grandTotal = totals ? String(totals.total_display ?? 'ON ACCOUNT') : 'ON ACCOUNT';

  const chargeRows = charges.map(ch => ({
    code: ch.code || '-',
    desc: ch.description || '-',
    qty: ch.quantity != null ? String(ch.quantity) : '-',
    unit: normalizeUOM(ch.unit),
    price: ch.price != null ? ch.price.toFixed(2) : '-',
    amount: fmtAmount(ch.amount, totals?.on_account ?? true),
  }));

  if (loading) {
    return (
      <View style={[s.container, {backgroundColor: c.accentBg, justifyContent: 'center', alignItems: 'center'}]}>
        <StatusBar translucent backgroundColor="transparent" barStyle="light-content" />
        <ActivityIndicator size="large" color={c.textOnPrimary} />
      </View>
    );
  }

  return (
    <View style={[s.container, {backgroundColor: c.background}]}>
      <StatusBar translucent backgroundColor="transparent" barStyle="light-content" />
      <View style={[s.topBar, {paddingTop: insets.top, backgroundColor: c.accentBg}]} />

      <ScrollView
        style={[s.scroll, {backgroundColor: c.accentBg}]}
        contentContainerStyle={[s.scrollContent, {paddingLeft: Math.max(0, insets.left), paddingRight: Math.max(0, insets.right), paddingBottom: isLandscape ? Math.max(wp(40), insets.bottom + wp(20)) : Math.max(wp(60), insets.bottom + wp(40))}]}
        showsVerticalScrollIndicator={false}>

        {/* Ticket Card */}
        <View style={[s.ticketCard, {backgroundColor: c.white, shadowColor: c.shadowColor, marginHorizontal: hMargin}]}>

          {/* Banner */}
          <View style={[s.banner, {backgroundColor: c.bannerBg}, wide && {paddingHorizontal: 16, paddingVertical: 12}]}>
            <View style={[s.bannerIcon, {backgroundColor: c.overlay15}, wide && {width: 34, height: 34, borderRadius: 10}]}>
              <MaterialIcons name="receipt-long" size={wide ? 19 : ms(16)} color={c.textOnPrimary} />
            </View>
            <View style={{flex: 1}}>
              <Text style={[s.bannerTitle, {color: c.textOnPrimary}, wide && {fontSize: 16}]}>MOBILE TICKET</Text>
              <View style={{flexDirection: 'row', gap: wide ? 14 : wp(14), marginTop: wide ? 5 : wp(8)}}>
                {[{label: 'ORDER', value: orderCode}, {label: 'TICKET', value: ticketCode}, {label: 'DATE', value: orderDate}].map(item => (
                  <View key={item.label} style={{flexDirection: 'row', alignItems: 'center', gap: wide ? 4 : wp(3)}}>
                    <Text style={{fontSize: wide ? 9 : ms(9), fontWeight: '600', color: c.textOnDark60}}>{item.label}</Text>
                    <Text style={{fontSize: wide ? 12 : ms(11), fontWeight: '800', color: c.textOnPrimary}}>{item.value}</Text>
                  </View>
                ))}
              </View>
            </View>
            <View style={{flexDirection: 'row', alignItems: 'center', gap: wide ? 6 : wp(6)}}>
              <View style={[s.qrPlaceholder, {backgroundColor: c.overlay15}, wide && {width: 30, height: 30, borderRadius: 7}]}>
                <MaterialIcons name="qr-code-2" size={wide ? 20 : ms(20)} color={c.textOnPrimary} />
              </View>
              <TouchableOpacity
                style={[s.closeBtn, {backgroundColor: c.overlay15}, wide && {width: 30, height: 30, borderRadius: 15}]}
                onPress={() => navigation.goBack()} activeOpacity={0.7}>
                <MaterialIcons name="close" size={wide ? 16 : ms(18)} color={c.textOnPrimary} />
              </TouchableOpacity>
            </View>
          </View>

          {/* ─── LANDSCAPE LAYOUT ─── */}
          {isLandscape ? (
            <View style={{flexDirection: 'row', padding: isTablet ? 12 : 6, gap: isTablet ? 8 : 5}}>
              {/* Column 1: Customer + Driver/Truck */}
              <View style={{flex: 30, gap: isTablet ? 8 : 5}}>
                <View style={[lCard, {backgroundColor: c.white, borderColor: c.border}]}>
                  <LSectionHead icon="people" title="CUSTOMER" color={c.primary} />
                  {customerInfo.map(item => (
                    <LRow key={item.label} label={item.label} value={item.value} highlight={item.highlight} highlightBg={c.highlight} textColor={c.textPrimary} labelW={70} />
                  ))}
                </View>
                <View style={[lCard, {backgroundColor: c.white, borderColor: c.border}]}>
                  <LSectionHead icon="local-shipping" title="DRIVER & TRUCK" color={c.primary} />
                  {[...driverCol, ...truckCol].map(item => (
                    <LRow key={item.label} label={item.label} value={item.value} textColor={c.textPrimary} labelW={65} />
                  ))}
                </View>
              </View>

              {/* Columns 2+3: Charges, Timeline, and shared buttons */}
              <View style={{flex: 70, gap: isTablet ? 8 : 5}}>
                {/* Charges + Timeline row */}
                <View style={{flexDirection: 'row', gap: isTablet ? 8 : 5, flex: 1}}>
                  {/* Charges */}
                  <View style={[lCard, {flex: 1, backgroundColor: c.white, borderColor: c.border}]}>
                    <LSectionHead icon="receipt-long" title="CHARGES" color={c.primary} />
                    <View style={{flexDirection: 'row', alignItems: 'center', paddingVertical: 5, borderBottomWidth: 1, borderBottomColor: c.primary, gap: 5}}>
                      <Text style={{width: 56, fontSize: 11, fontWeight: '800', color: c.textPrimary}}>CODE</Text>
                      <Text style={{flex: 1, fontSize: 11, fontWeight: '800', color: c.textPrimary}}>DESCRIPTION</Text>
                      <Text style={{width: 35, fontSize: 11, fontWeight: '800', color: c.textPrimary}}>QTY</Text>
                      <Text style={{width: 28, fontSize: 11, fontWeight: '800', color: c.textPrimary}}>UNIT</Text>
                      <Text style={{width: 38, fontSize: 11, fontWeight: '800', color: c.textPrimary}}>PRICE</Text>
                      <Text style={{width: 72, fontSize: 11, fontWeight: '800', color: c.textPrimary}}>AMOUNT</Text>
                    </View>
                    {chargeRows.map((row, i) => (
                      <View key={`${row.code}-${i}`} style={{flexDirection: 'row', alignItems: 'center', paddingVertical: 5, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: c.borderLight, gap: 5}}>
                        <Text style={{width: 56, fontSize: 11, fontWeight: '500', color: c.textMuted}}>{row.code}</Text>
                        <Text style={{flex: 1, fontSize: 11, fontWeight: '500', color: c.textPrimary}} numberOfLines={1}>{row.desc}</Text>
                        <Text style={{width: 35, fontSize: 11, fontWeight: '500', color: c.textPrimary}}>{row.qty}</Text>
                        <Text style={{width: 28, fontSize: 11, fontWeight: '500', color: c.textMuted}}>{row.unit}</Text>
                        <Text style={{width: 38, fontSize: 11, fontWeight: '500', color: c.textPrimary}}>{row.price}</Text>
                        <Text style={{width: 72, fontSize: 11, fontWeight: '500', color: c.textPrimary}}>{row.amount}</Text>
                      </View>
                    ))}
                    <View style={{borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: c.border, marginTop: 6, paddingTop: 6}}>
                      {[{label: 'Sub', value: subTotal}, {label: 'Tax', value: taxTotal}, {label: 'Total', value: grandTotal}].map(item => (
                        <View key={item.label} style={{flexDirection: 'row', paddingVertical: 3}}>
                          <Text style={{minWidth: 42, fontSize: 12, fontWeight: item.label === 'Total' ? '800' : '600', color: item.label === 'Total' ? c.textPrimary : c.textMuted}}>{item.label}</Text>
                          <Text style={{flex: 1, fontSize: 12, fontWeight: item.label === 'Total' ? '700' : '500', color: c.textPrimary}}>{item.value}</Text>
                        </View>
                      ))}
                    </View>
                  </View>

                  {/* Timeline */}
                  <View style={[lCard, {width: isTablet ? 280 : 200, backgroundColor: c.white, borderColor: c.border}]}>
                    <LSectionHead icon="schedule" title="TIMELINE" color={c.primary} />
                    {timelineGrid.map(item => (
                      <View key={item.label} style={{flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingVertical: 5}}>
                        <Text style={{fontSize: 11, fontWeight: '600', color: c.textMuted}}>{item.label}</Text>
                        <Text style={{fontSize: 13, fontWeight: '700', color: c.textPrimary}}>{item.time}</Text>
                      </View>
                    ))}
                  </View>
                </View>

                {/* Shared Actions */}
                <View style={[lCard, {flexDirection: 'row', alignItems: 'center', backgroundColor: c.white, borderColor: c.border, gap: isTablet ? 10 : 8}]}>
                  <TouchableOpacity style={{flex: 1, paddingVertical: isTablet ? 18 : 14, borderRadius: 9, alignItems: 'center', justifyContent: 'center', minHeight: isTablet ? 56 : 44, backgroundColor: c.signBtn}} activeOpacity={0.8} onPress={() => navigation.navigate('AcceptTicket', {ticketId})}>
                    <Text style={{fontSize: isTablet ? 16 : 14, fontWeight: '800', letterSpacing: 0.4, color: c.textOnPrimary}}>SIGN</Text>
                  </TouchableOpacity>
                  <TouchableOpacity style={{flex: 1, paddingVertical: isTablet ? 18 : 14, borderRadius: 9, alignItems: 'center', justifyContent: 'center', minHeight: isTablet ? 56 : 44, backgroundColor: c.disputeBtn}} activeOpacity={0.8} onPress={() => navigation.navigate('DisputeTicket', {ticketId})}>
                    <Text style={{fontSize: isTablet ? 16 : 14, fontWeight: '800', letterSpacing: 0.4, color: c.textOnPrimary}}>DISPUTE</Text>
                  </TouchableOpacity>
                </View>
              </View>
            </View>
          ) : (
            /* ─── PORTRAIT LAYOUT ─── */
            <>
              {/* Customer Info */}
              <View style={[s.section, {borderBottomColor: c.border}]}>
                <SLabel text="CUSTOMER DETAILS" icon="people" color={c.primary} />
                {customerInfo.map(item => (
                  <View key={item.label} style={s.infoRow}>
                    <Text style={[s.infoLabel, {color: c.textMuted}]}>{item.label}</Text>
                    <Text style={[
                      s.infoValue, {color: c.textPrimary},
                      item.highlight && s.highlightValue,
                      item.highlight && {backgroundColor: c.highlight},
                    ]}>{item.value}</Text>
                  </View>
                ))}
              </View>

              {/* Driver / Truck */}
              <View style={[s.section, {borderBottomColor: c.border}]}>
                <SLabel text="DRIVER & TRUCK" icon="local-shipping" color={c.primary} />
                <View style={s.twoColGrid}>
                  <View style={s.gridCol}>
                    {driverCol.map(item => (
                      <View key={item.label} style={s.gridRow}>
                        <Text style={[s.gridLabel, {color: c.textMuted}]}>{item.label}</Text>
                        <Text style={[s.gridValue, {color: c.textPrimary}]}>{item.value}</Text>
                      </View>
                    ))}
                  </View>
                  <View style={s.gridCol}>
                    {truckCol.map(item => (
                      <View key={item.label} style={s.gridRow}>
                        <Text style={[s.gridLabel, {color: c.textMuted}]}>{item.label}</Text>
                        <Text style={[s.gridValue, {color: c.textPrimary}]}>{item.value}</Text>
                      </View>
                    ))}
                  </View>
                </View>
              </View>

              {/* Timeline + Totals */}
              <View style={[s.section, {borderBottomColor: c.border, backgroundColor: c.surface}]}>
                <View style={{flexDirection: 'row'}}>
                  <View style={{flex: 1}}>
                    <SLabel text="DELIVERY TIMELINE" icon="schedule" color={c.primary} />
                    <View style={s.timeGrid}>
                      {timelineGrid.map(item => (
                        <View key={item.label} style={s.timeCell}>
                          <Text style={[s.timeLabel, {color: c.textMuted}]}>{item.label}</Text>
                          <Text style={[s.timeValue, {color: c.textPrimary}]}>{item.time}</Text>
                        </View>
                      ))}
                    </View>
                  </View>
                  <View style={{borderLeftWidth: StyleSheet.hairlineWidth, borderLeftColor: c.border, paddingLeft: wp(10), justifyContent: 'center'}}>
                    <SLabel text="TOTALS" color={c.primary} />
                    {[{label: 'Sub', value: subTotal}, {label: 'Tax', value: taxTotal}, {label: 'Total', value: grandTotal}].map(item => (
                      <View key={item.label} style={{flexDirection: 'row', paddingVertical: wp(3), gap: wp(8)}}>
                        <Text style={{fontSize: ms(11), fontWeight: '700', color: c.textMuted, minWidth: wp(34)}}>{item.label}</Text>
                        <Text style={[{fontSize: ms(11), fontWeight: '600', color: c.textPrimary}, item.label === 'Total' && {fontWeight: '800'}]}>{item.value}</Text>
                      </View>
                    ))}
                  </View>
                </View>
              </View>

              {/* Charges */}
              <View style={[s.section, {borderBottomColor: c.border}]}>
                <SLabel text="CHARGES" icon="receipt-long" color={c.primary} />
                {chargeRows.map((row, i) => (
                  <View key={`${row.code}-${i}`} style={[s.chargeItem, {backgroundColor: i % 2 === 0 ? c.surface : c.white, borderLeftColor: c.primary}]}>
                    <View style={s.chargeTop}>
                      <Text style={[s.chargeDesc, {color: c.textPrimary}]} numberOfLines={2}>{row.desc}</Text>
                      <Text style={[s.chargeCode, {color: c.textMuted, backgroundColor: c.white, paddingHorizontal: wp(4), paddingVertical: wp(1), borderRadius: wp(4), overflow: 'hidden'}]}>{row.code}</Text>
                    </View>
                    <View style={s.chargeFields}>
                      {[
                        {label: 'QTY', value: row.qty},
                        {label: 'UNIT', value: row.unit},
                        {label: 'PRICE', value: row.price},
                        {label: 'AMOUNT', value: row.amount},
                      ].map(f => (
                        <View key={f.label} style={s.chargeField}>
                          <Text style={[s.chargeFieldLabel, {color: c.textMuted}]}>{f.label}</Text>
                          <Text style={[s.chargeFieldValue, {color: f.label === 'AMOUNT' ? c.primary : c.textPrimary, fontWeight: f.label === 'AMOUNT' ? '700' : '600'}]}>{f.value}</Text>
                        </View>
                      ))}
                    </View>
                  </View>
                ))}
              </View>

              {/* Actions */}
              <View style={s.actionsSection}>
                <View style={s.actionRowHalf}>
                  <TouchableOpacity style={[s.actionBtnHalf, {backgroundColor: c.signBtn}, isTablet && {minHeight: 64, paddingVertical: 20}]} activeOpacity={0.8} onPress={() => navigation.navigate('AcceptTicket', {ticketId})}>
                    <Text style={[s.actionBtnFullText, {color: c.textOnPrimary}, isTablet && {fontSize: 17}]}>SIGN</Text>
                  </TouchableOpacity>
                  <TouchableOpacity style={[s.actionBtnHalf, {backgroundColor: c.disputeBtn}, isTablet && {minHeight: 64, paddingVertical: 20}]} activeOpacity={0.8} onPress={() => navigation.navigate('DisputeTicket', {ticketId})}>
                    <Text style={[s.actionBtnFullText, {color: c.textOnPrimary}, isTablet && {fontSize: 16}]}>DISPUTE</Text>
                  </TouchableOpacity>
                </View>
              </View>
            </>
          )}
        </View>
      </ScrollView>
    </View>
  );
}

// Landscape card style
const lCard = {borderRadius: 10, borderWidth: StyleSheet.hairlineWidth, padding: 10, overflow: 'hidden' as const};

const s = StyleSheet.create({
  container: {flex: 1},
  topBar: {height: 0},
  scroll: {flex: 1},
  scrollContent: {paddingTop: wp(5), paddingBottom: wp(16)},
  ticketCard: {borderRadius: wp(12), overflow: 'hidden', elevation: 3, shadowOffset: {width: 0, height: 1}, shadowOpacity: 0.1, shadowRadius: 6},
  banner: {flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: wp(12), paddingVertical: wp(8), gap: wp(8)},
  bannerIcon: {width: wp(32), height: wp(32), borderRadius: wp(10), justifyContent: 'center', alignItems: 'center'},
  bannerTitle: {fontSize: ms(14), fontWeight: '900', letterSpacing: 0.6},
  qrPlaceholder: {width: wp(32), height: wp(32), borderRadius: wp(7), justifyContent: 'center', alignItems: 'center'},
  closeBtn: {width: wp(34), height: wp(34), borderRadius: wp(17), justifyContent: 'center', alignItems: 'center'},
  section: {paddingHorizontal: wp(14), paddingVertical: wp(12), borderBottomWidth: StyleSheet.hairlineWidth},
  divider: {height: StyleSheet.hairlineWidth, marginVertical: wp(4)},
  infoRow: {flexDirection: 'row', paddingVertical: wp(6)},
  infoLabel: {minWidth: wp(72), maxWidth: wp(98), fontSize: ms(11), fontWeight: '700', letterSpacing: 0.2},
  infoValue: {flex: 1, fontSize: ms(13), fontWeight: '600'},
  highlightValue: {paddingHorizontal: wp(5), paddingVertical: wp(2), borderRadius: wp(4)},
  twoColGrid: {flexDirection: 'row', flexWrap: 'wrap', gap: wp(6)},
  gridCol: {flex: 1, minWidth: 120},
  gridRow: {flexDirection: 'row', paddingVertical: wp(4)},
  gridLabel: {minWidth: wp(52), maxWidth: wp(78), fontSize: ms(11), fontWeight: '700'},
  gridValue: {flex: 1, fontSize: ms(13), fontWeight: '500'},
  // Charges — card-style rows
  chargeItem: {paddingVertical: wp(8), paddingHorizontal: wp(10), paddingLeft: wp(12), marginBottom: wp(4), borderRadius: wp(6), borderLeftWidth: 3},
  chargeTop: {flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between', gap: wp(8), marginBottom: wp(6)},
  chargeCode: {fontSize: ms(9), fontWeight: '600'},
  chargeDesc: {flex: 1, fontSize: ms(13), fontWeight: '700', lineHeight: ms(18)},
  chargeFields: {flexDirection: 'row', flexWrap: 'wrap', gap: wp(12)},
  chargeField: {gap: wp(2), minWidth: wp(40)},
  chargeFieldLabel: {fontSize: ms(9), fontWeight: '700', letterSpacing: 0.5},
  chargeFieldValue: {fontSize: ms(13), fontWeight: '600'},
  timeGrid: {flexDirection: 'row', flexWrap: 'wrap'},
  timeCell: {width: '25%', paddingVertical: wp(4)},
  timeLabel: {fontSize: ms(9), fontWeight: '700', letterSpacing: 0.3},
  timeValue: {fontSize: ms(13), fontWeight: '700', marginTop: 2},
  actionsSection: {paddingHorizontal: wp(14), paddingVertical: wp(12)},
  actionRowHalf: {flexDirection: 'row', gap: wp(10)},
  actionBtnHalf: {flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, paddingVertical: 16, borderRadius: 12, minHeight: 54, elevation: 2, shadowColor: '#000', shadowOffset: {width: 0, height: 1}, shadowOpacity: 0.12, shadowRadius: 3},
  actionBtnOutline: {backgroundColor: 'transparent', borderWidth: 1.5, elevation: 0, shadowOpacity: 0},
  actionBtnFullText: {fontSize: ms(14), fontWeight: '800', letterSpacing: 0.5},
});
