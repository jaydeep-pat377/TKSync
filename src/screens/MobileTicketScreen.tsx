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
  Platform,
} from 'react-native';
import {useSafeAreaInsets} from 'react-native-safe-area-context';
import Icon from '../components/Icon';
import type {NativeStackNavigationProp} from '@react-navigation/native-stack';
import type {RouteProp} from '@react-navigation/native';
import {useTheme} from '../contexts/ThemeContext';
import {wp, ms} from '../utils/responsive';
import {ticketsApi, type MobileTicketPrint} from '../services/api';
import {useFontScaleRefresh} from '../contexts/FontSizeContext';

type Props = {
  navigation: NativeStackNavigationProp<any>;
  route: RouteProp<{MobileTicket: {ticketId?: number}}, 'MobileTicket'>;
};

const fmtTime = (t: string | null) => {
  if (!t) return '--';
  const d = new Date(t);
  const Y = d.getFullYear();
  const M = (d.getMonth() + 1).toString().padStart(2, '0');
  const D = d.getDate().toString().padStart(2, '0');
  const h = d.getHours().toString().padStart(2, '0');
  const m = d.getMinutes().toString().padStart(2, '0');
  const s = d.getSeconds().toString().padStart(2, '0');
  return `${Y}-${M}-${D} ${h}:${m}:${s}`;
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
function LSectionHead({icon, title, color, fs}: {icon: string; title: string; color: string; fs: (n: number) => number}) {
  return (
    <View style={{flexDirection: 'row', alignItems: 'center', gap: 5, marginBottom: 8}}>
      <Icon name={icon as any} size={fs(12)} color={color} />
      <Text style={{fontSize: fs(12), fontWeight: '800', letterSpacing: 0.5, color}}>{title}</Text>
    </View>
  );
}

// Landscape info row
function LRow({label, value, highlight, highlightBg, textColor, labelColor, labelW = 80, wrap, fs}: {label: string; value: string; highlight?: boolean; highlightBg?: string; textColor: string; labelColor?: string; labelW?: number; wrap?: boolean; fs: (n: number) => number}) {
  return (
    <View style={{flexDirection: 'row', paddingVertical: wp(4)}}>
      <Text style={{width: labelW, fontSize: fs(11), fontWeight: '600', color: labelColor || '#9E9E9E'}}>{label}</Text>
      <Text style={[
        {flex: 1, fontSize: fs(14), fontWeight: '600', color: textColor, minWidth: 60},
        highlight && {paddingHorizontal: 4, paddingVertical: 2, backgroundColor: highlightBg, borderRadius: 3},
      ]} numberOfLines={wrap ? undefined : 2}>{value}</Text>
    </View>
  );
}

// Section label with icon
function SLabel({text, icon, color}: {text: string; icon?: string; color: string}) {
  return (
    <View style={{flexDirection: 'row', alignItems: 'center', gap: wp(5), marginBottom: wp(6)}}>
      {icon && <Icon name={icon as any} size={ms(13)} color={color} />}
      <Text style={{fontSize: ms(9), fontWeight: '800', letterSpacing: 0.6, color}}>{text}</Text>
    </View>
  );
}

export default function MobileTicketScreen({navigation, route}: Props) {
  useFontScaleRefresh();
  const s = createS();
  const {c, isDark} = useTheme();
  const insets = useSafeAreaInsets();
  const {width, height: winHeight} = useWindowDimensions();
  const isTablet = Math.min(width, winHeight) > 600;
  const isLandscape = width > winHeight;
  const wide = isTablet || isLandscape;
  const shortDim = Math.min(width, winHeight);
  const isSmallPhone = shortDim < 360;
  const hMargin = isTablet ? 24 : isLandscape ? 16 : isSmallPhone ? wp(6) : wp(10);

  // Landscape scale factor — same as Dashboard
  const lh = winHeight - insets.top - insets.bottom;
  const lsScale = Math.max(0.65, Math.min(1, lh / 660));
  const fs = (base: number) => Math.round(base * lsScale);

  const ticketId = route.params?.ticketId;
  const [data, setData] = useState<MobileTicketPrint | null>(null);
  const [loading, setLoading] = useState(false);
  const [fetchError, setFetchError] = useState(false);

  const fetchPrintable = useCallback(async (id: number) => {
    setLoading(true);
    setFetchError(false);
    try {
      const res = await ticketsApi.getPrintable(id);
      setData(res.data);
    } catch (err) {
      console.log('[MobileTicket] fetch error:', err);
      setFetchError(true);
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
    ? fmtTime(header.order_date)
    : '-';

  const customerInfo = cust ? [
    {label: 'CUSTOMER', value: cust.customer_name || '-'},
    {label: 'PROJECT', value: cust.project_name || '-'},
    {label: 'ADDRESS', value: cust.address ? `${cust.address}${cust.map_page ? `\nMapPage:${cust.map_page}` : ''}` : '-'},
    {label: 'ORDERED BY', value: cust.ordered_by || '-'},
    {label: 'INSTRUCTIONS', value: cust.instructions || '-', highlight: Boolean(cust.instructions), wrap: true},
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

  const fmtTimeOnly = (t: string | null) => {
    if (!t) return '--';
    const d = new Date(t);
    return `${d.getHours().toString().padStart(2, '0')}:${d.getMinutes().toString().padStart(2, '0')}:${d.getSeconds().toString().padStart(2, '0')}`;
  };

  const timelineGrid = tl?.steps
    ? tl.steps.map(step => ({label: step.label.toUpperCase(), time: fmtTime(step.time), timeOnly: fmtTimeOnly(step.time)}))
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

  if (fetchError && !data) {
    return (
      <View style={[s.container, {backgroundColor: c.background, justifyContent: 'center', alignItems: 'center', paddingHorizontal: wp(24)}]}>
        <StatusBar translucent backgroundColor="transparent" barStyle="light-content" />
        <Icon name="error-outline" size={ms(48)} color={c.textSecondary} />
        <Text style={{fontSize: ms(15), fontWeight: '700', color: c.textPrimary, marginTop: wp(12), textAlign: 'center'}}>Server Error</Text>
        <Text style={{fontSize: ms(12), color: c.textSecondary, marginTop: wp(6), textAlign: 'center'}}>Unable to connect to the server. Please try again later.</Text>
        <TouchableOpacity
          onPress={() => ticketId && fetchPrintable(ticketId)}
          activeOpacity={0.7}
          style={{flexDirection: 'row', alignItems: 'center', gap: wp(6), marginTop: wp(20), backgroundColor: c.primary, paddingVertical: wp(10), paddingHorizontal: wp(24), borderRadius: wp(8)}}>
          <Icon name="refresh" size={ms(16)} color="#fff" />
          <Text style={{fontSize: ms(13), fontWeight: '700', color: '#fff'}}>Retry</Text>
        </TouchableOpacity>
        <TouchableOpacity onPress={() => navigation.goBack()} activeOpacity={0.7} style={{marginTop: wp(12)}}>
          <Text style={{fontSize: ms(12), color: c.primary, fontWeight: '600'}}>Go Back</Text>
        </TouchableOpacity>
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
              <Icon name="receipt-long" size={wide ? 19 : ms(16)} color={c.textOnPrimary} />
            </View>
            <View style={{flex: 1}}>
              <Text style={[s.bannerTitle, {color: c.textOnPrimary}, wide && {fontSize: 18}]}>MOBILE TICKET</Text>
              <View style={{flexDirection: 'row', flexWrap: 'wrap', gap: wide ? 14 : wp(8), marginTop: wide ? 5 : wp(6)}}>
                {[{label: 'ORDER', value: orderCode}, {label: 'TICKET', value: ticketCode}, {label: 'DATE', value: orderDate}].map(item => (
                  <View key={item.label} style={{flexDirection: 'row', alignItems: 'center', gap: wide ? 4 : wp(3)}}>
                    <Text style={{fontSize: wide ? 11 : ms(10), fontWeight: '600', color: c.textOnDark60}}>{item.label}</Text>
                    <Text style={{fontSize: wide ? 14 : ms(12), fontWeight: '800', color: c.textOnPrimary}} numberOfLines={1}>{item.value}</Text>
                  </View>
                ))}
              </View>
            </View>
            <View style={{flexDirection: 'row', alignItems: 'center', gap: wide ? 6 : wp(6)}}>
              <View style={[s.qrPlaceholder, {backgroundColor: c.overlay15}, wide && {width: 30, height: 30, borderRadius: 7}]}>
                <Icon name="qr-code-2" size={wide ? 20 : ms(20)} color={c.textOnPrimary} />
              </View>
              <TouchableOpacity
                style={[s.closeBtn, {backgroundColor: c.overlay15}, wide && {width: 30, height: 30, borderRadius: 15}]}
                onPress={() => navigation.goBack()} activeOpacity={0.7}>
                <Icon name="close" size={wide ? 16 : ms(18)} color={c.textOnPrimary} />
              </TouchableOpacity>
            </View>
          </View>

          {/* ─── LANDSCAPE LAYOUT ─── */}
          {isLandscape ? (
            <View style={{flexDirection: 'row', padding: isTablet ? 12 : wp(6), gap: isTablet ? 8 : wp(5)}}>
              {/* Column 1: Customer + Driver/Truck */}
              <View style={{flex: 30, gap: isTablet ? 8 : wp(5)}}>
                <View style={[lCard, {backgroundColor: c.white, borderColor: c.border}]}>
                  <LSectionHead icon="people" title="CUSTOMER" color={isDark ? '#B0BEC5' : c.primary} fs={fs} />
                  {customerInfo.map(item => (
                    <LRow key={item.label} label={item.label} value={item.value} highlight={item.highlight} highlightBg={c.highlight} textColor={c.textPrimary} labelW={isTablet ? 115 : 85} wrap={item.wrap} fs={fs} />
                  ))}
                </View>
                <View style={[lCard, {backgroundColor: c.white, borderColor: c.border}]}>
                  <LSectionHead icon="local-shipping" title="DRIVER & TRUCK" color={isDark ? '#B0BEC5' : c.primary} fs={fs} />
                  {[...driverCol, ...truckCol].map(item => (
                    <LRow key={item.label} label={item.label} value={item.value} textColor={c.textPrimary} labelW={isTablet ? 115 : 85} fs={fs} />
                  ))}
                </View>
              </View>

              {/* Columns 2+3: Charges, Timeline, and shared buttons */}
              <View style={{flex: 70, gap: isTablet ? 8 : wp(5)}}>
                {/* Charges + Timeline row */}
                <View style={{flexDirection: 'row', gap: isTablet ? 8 : wp(5), flex: 1}}>
                  {/* Charges */}
                  <View style={[lCard, {flex: 1, backgroundColor: c.white, borderColor: c.border}]}>
                    <LSectionHead icon="receipt-long" title="CHARGES" color={isDark ? '#B0BEC5' : c.primary} fs={fs} />
                    <View style={{flexDirection: 'row', alignItems: 'center', paddingVertical: 5, borderBottomWidth: 1, borderBottomColor: c.primary, gap: isTablet ? 5 : 3}}>
                      <Text style={{width: isTablet ? 56 : 44, fontSize: fs(10), fontWeight: '800', color: c.textPrimary}}>CODE</Text>
                      <Text style={{flex: 1, fontSize: fs(10), fontWeight: '800', color: c.textPrimary}}>DESCRIPTION</Text>
                      <Text style={{width: isTablet ? 40 : 28, fontSize: fs(10), fontWeight: '800', color: c.textPrimary}}>QTY</Text>
                      <Text style={{width: isTablet ? 48 : 32, fontSize: fs(10), fontWeight: '800', color: c.textPrimary}}>UNIT</Text>
                      <Text style={{width: isTablet ? 55 : 42, fontSize: fs(10), fontWeight: '800', color: c.textPrimary}}>PRICE</Text>
                      <Text style={{width: isTablet ? 85 : 65, fontSize: fs(10), fontWeight: '800', color: c.textPrimary}}>AMOUNT</Text>
                    </View>
                    {chargeRows.map((row, i) => (
                      <View key={`${row.code}-${i}`} style={{flexDirection: 'row', alignItems: 'center', paddingVertical: isTablet ? 5 : 4, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: c.borderLight, gap: isTablet ? 5 : 3}}>
                        <Text style={{width: isTablet ? 56 : 44, fontSize: fs(13), fontWeight: '500', color: c.textMuted}} numberOfLines={1}>{row.code}</Text>
                        <Text style={{flex: 1, fontSize: fs(13), fontWeight: '500', color: c.textPrimary}} numberOfLines={1}>{row.desc}</Text>
                        <Text style={{width: isTablet ? 40 : 28, fontSize: fs(13), fontWeight: '500', color: c.textPrimary}}>{row.qty}</Text>
                        <Text style={{width: isTablet ? 48 : 32, fontSize: fs(13), fontWeight: '500', color: c.textMuted}}>{row.unit}</Text>
                        <Text style={{width: isTablet ? 55 : 42, fontSize: fs(13), fontWeight: '500', color: c.textPrimary}}>{row.price}</Text>
                        <Text style={{width: isTablet ? 85 : 65, fontSize: fs(13), fontWeight: '500', color: c.textPrimary}}>{row.amount}</Text>
                      </View>
                    ))}
                    <View style={{borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: c.border, marginTop: 6, paddingTop: 6}}>
                      {[{label: 'Sub', value: subTotal}, {label: 'Tax', value: taxTotal}, {label: 'Total', value: grandTotal}].map(item => (
                        <View key={item.label} style={{flexDirection: 'row', paddingVertical: 3}}>
                          <Text style={{minWidth: isTablet ? 42 : 34, fontSize: fs(12), fontWeight: item.label === 'Total' ? '800' : '600', color: item.label === 'Total' ? c.textPrimary : c.textMuted}}>{item.label}</Text>
                          <Text style={{flex: 1, fontSize: fs(12), fontWeight: item.label === 'Total' ? '700' : '500', color: c.textPrimary}}>{item.value}</Text>
                        </View>
                      ))}
                    </View>
                  </View>

                  {/* Timeline */}
                  <View style={[lCard, {width: isTablet ? 280 : 160, backgroundColor: c.white, borderColor: c.border}]}>
                    <LSectionHead icon="schedule" title="TIMELINE" color={isDark ? '#B0BEC5' : c.primary} fs={fs} />
                    {timelineGrid.map(item => (
                      <View key={item.label} style={{flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingVertical: isTablet ? 5 : 3}}>
                        <Text style={{fontSize: fs(11), fontWeight: '600', color: c.textMuted}}>{item.label}</Text>
                        <Text style={{fontSize: fs(13), fontWeight: '700', color: c.textPrimary}}>{item.timeOnly}</Text>
                      </View>
                    ))}
                  </View>
                </View>

                {/* Shared Actions */}
                <View style={[lCard, {flexDirection: 'row', alignItems: 'center', backgroundColor: c.white, borderColor: c.border, gap: isTablet ? 10 : wp(6)}]}>
                  <TouchableOpacity style={{flex: 1, paddingVertical: isTablet ? 18 : wp(10), borderRadius: 9, alignItems: 'center', justifyContent: 'center', minHeight: isTablet ? 56 : wp(40), backgroundColor: c.signBtn}} activeOpacity={0.8} onPress={() => navigation.navigate('AcceptTicket', {ticketId})}>
                    <Text style={{fontSize: fs(16), fontWeight: '800', letterSpacing: 0.4, color: c.textOnPrimary}}>SIGN</Text>
                  </TouchableOpacity>
                  <TouchableOpacity style={{flex: 1, paddingVertical: isTablet ? 18 : wp(10), borderRadius: 9, alignItems: 'center', justifyContent: 'center', minHeight: isTablet ? 56 : wp(40), backgroundColor: c.disputeBtn}} activeOpacity={0.8} onPress={() => navigation.navigate('DisputeTicket', {ticketId})}>
                    <Text style={{fontSize: fs(16), fontWeight: '800', letterSpacing: 0.4, color: c.textOnPrimary}}>DISPUTE</Text>
                  </TouchableOpacity>
                </View>
              </View>
            </View>
          ) : (
            /* ─── PORTRAIT LAYOUT ─── */
            <>
              {/* Customer Info */}
              <View style={[s.section, {borderBottomColor: c.border}]}>
                <SLabel text="CUSTOMER DETAILS" icon="people" color={isDark ? '#B0BEC5' : c.primary} />
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
                <SLabel text="DRIVER & TRUCK" icon="local-shipping" color={isDark ? '#B0BEC5' : c.primary} />
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
              <View style={[s.section, {borderBottomColor: c.border}]}>
                <SLabel text="DELIVERY TIMELINE" icon="schedule" color={isDark ? '#B0BEC5' : c.primary} />
                <View style={{flexDirection: 'row', gap: wp(10)}}>
                  <View style={{flex: 1}}>
                    {timelineGrid.slice(0, 4).map(item => (
                      <View key={item.label} style={{flexDirection: 'row', paddingVertical: 6, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: c.borderLight}}>
                        <Text style={{fontSize: ms(9), fontWeight: '600', color: c.textMuted, width: '55%', letterSpacing: 0.3}}>{item.label}</Text>
                        <Text style={{fontSize: ms(9), fontWeight: '800', color: c.textPrimary, flex: 1}}>{item.timeOnly}</Text>
                      </View>
                    ))}
                  </View>
                  <View style={{width: StyleSheet.hairlineWidth, backgroundColor: c.border}} />
                  <View style={{flex: 1}}>
                    {timelineGrid.slice(4).map(item => (
                      <View key={item.label} style={{flexDirection: 'row', paddingVertical: 6, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: c.borderLight}}>
                        <Text style={{fontSize: ms(9), fontWeight: '600', color: c.textMuted, width: '55%', letterSpacing: 0.3}}>{item.label}</Text>
                        <Text style={{fontSize: ms(9), fontWeight: '800', color: c.textPrimary, flex: 1}}>{item.timeOnly}</Text>
                      </View>
                    ))}
                  </View>
                </View>
                {/* Totals */}
                <View style={{flexDirection: 'row', marginTop: 10, backgroundColor: c.surface, borderRadius: 8, paddingVertical: 10, paddingHorizontal: 12}}>
                  <View style={{flex: 1, alignItems: 'center'}}>
                    <Text style={{fontSize: ms(8), fontWeight: '600', color: c.textMuted, letterSpacing: 0.3}}>SUB</Text>
                    <Text style={{fontSize: ms(9), fontWeight: '700', color: c.textPrimary, marginTop: 2}}>{subTotal}</Text>
                  </View>
                  <View style={{width: StyleSheet.hairlineWidth, backgroundColor: c.border}} />
                  <View style={{flex: 1, alignItems: 'center'}}>
                    <Text style={{fontSize: ms(8), fontWeight: '600', color: c.textMuted, letterSpacing: 0.3}}>TAX</Text>
                    <Text style={{fontSize: ms(9), fontWeight: '700', color: c.textPrimary, marginTop: 2}}>{taxTotal}</Text>
                  </View>
                  <View style={{width: StyleSheet.hairlineWidth, backgroundColor: c.border}} />
                  <View style={{flex: 1.5, alignItems: 'center'}}>
                    <Text style={{fontSize: ms(8), fontWeight: '800', color: c.primary, letterSpacing: 0.3}}>TOTAL</Text>
                    <Text style={{fontSize: ms(10), fontWeight: '900', color: c.primary, marginTop: 2}}>{grandTotal}</Text>
                  </View>
                </View>
              </View>

              {/* Charges */}
              <View style={[s.section, {borderBottomColor: c.border}]}>
                <SLabel text="CHARGES" icon="receipt-long" color={isDark ? '#B0BEC5' : c.primary} />
                <View style={{flexDirection: 'row', alignItems: 'center', paddingVertical: 5, borderBottomWidth: 1, borderBottomColor: c.primary}}>
                  <Text style={{flex: 0.8, fontSize: ms(9), fontWeight: '800', color: c.textPrimary}}>CODE</Text>
                  <Text style={{flex: 3, fontSize: ms(9), fontWeight: '800', color: c.textPrimary}}>DESCRIPTION</Text>
                  <Text style={{flex: 0.6, fontSize: ms(9), fontWeight: '800', color: c.textPrimary}}>QTY</Text>
                  <Text style={{flex: 0.6, fontSize: ms(9), fontWeight: '800', color: c.textPrimary}}>UNIT</Text>
                  <Text style={{flex: 0.7, fontSize: ms(9), fontWeight: '800', color: c.textPrimary}}>PRICE</Text>
                  <Text style={{flex: 1.2, fontSize: ms(9), fontWeight: '800', color: c.textPrimary}}>AMOUNT</Text>
                </View>
                {chargeRows.map((row, i) => (
                  <View key={`${row.code}-${i}`} style={{flexDirection: 'row', alignItems: 'center', paddingVertical: 4, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: c.borderLight}}>
                    <Text style={{flex: 0.8, fontSize: ms(9), fontWeight: '500', color: c.textMuted}} numberOfLines={1}>{row.code}</Text>
                    <Text style={{flex: 3, fontSize: ms(9), fontWeight: '500', color: c.textPrimary}} numberOfLines={1}>{row.desc}</Text>
                    <Text style={{flex: 0.6, fontSize: ms(9), fontWeight: '500', color: c.textPrimary}}>{row.qty}</Text>
                    <Text style={{flex: 0.6, fontSize: ms(9), fontWeight: '500', color: c.textMuted}}>{row.unit}</Text>
                    <Text style={{flex: 0.7, fontSize: ms(9), fontWeight: '500', color: c.textPrimary}}>{row.price}</Text>
                    <Text style={{flex: 1.2, fontSize: ms(9), fontWeight: '500', color: c.textPrimary}}>{row.amount}</Text>
                  </View>
                ))}
              </View>

              {/* Actions */}
              <View style={s.actionsSection}>
                <View style={s.actionRowHalf}>
                  <TouchableOpacity style={[s.actionBtnHalf, {backgroundColor: c.signBtn, paddingVertical: wp(8), minHeight: wp(36)}, isTablet && {minHeight: 50, paddingVertical: 14}]} activeOpacity={0.8} onPress={() => navigation.navigate('AcceptTicket', {ticketId})}>
                    <Text style={[s.actionBtnFullText, {color: c.textOnPrimary}, isTablet && {fontSize: 17}]}>SIGN</Text>
                  </TouchableOpacity>
                  <TouchableOpacity style={[s.actionBtnHalf, {backgroundColor: c.disputeBtn, paddingVertical: wp(8), minHeight: wp(36)}, isTablet && {minHeight: 50, paddingVertical: 14}]} activeOpacity={0.8} onPress={() => navigation.navigate('DisputeTicket', {ticketId})}>
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

const createS = () => StyleSheet.create({
  container: {flex: 1},
  topBar: {height: 0},
  scroll: {flex: 1},
  scrollContent: {paddingTop: wp(5), paddingBottom: wp(16)},
  ticketCard: {borderRadius: wp(12), overflow: 'hidden', elevation: 3, shadowOffset: {width: 0, height: 1}, shadowOpacity: 0.1, shadowRadius: 6},
  banner: {flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: wp(12), paddingVertical: wp(8), gap: wp(8)},
  bannerIcon: {width: wp(32), height: wp(32), borderRadius: wp(10), justifyContent: 'center', alignItems: 'center'},
  bannerTitle: {fontSize: ms(16), fontWeight: '900', letterSpacing: 3, fontFamily: Platform.OS === 'ios' ? 'Helvetica' : 'sans-serif'},
  qrPlaceholder: {width: wp(32), height: wp(32), borderRadius: wp(7), justifyContent: 'center', alignItems: 'center'},
  closeBtn: {width: wp(34), height: wp(34), borderRadius: wp(17), justifyContent: 'center', alignItems: 'center'},
  section: {paddingHorizontal: wp(14), paddingVertical: wp(12), borderBottomWidth: StyleSheet.hairlineWidth},
  divider: {height: StyleSheet.hairlineWidth, marginVertical: wp(4)},
  infoRow: {flexDirection: 'row', paddingVertical: wp(6), flexWrap: 'wrap'},
  infoLabel: {minWidth: wp(68), maxWidth: wp(90), fontSize: ms(9), fontWeight: '700', letterSpacing: 0.2},
  infoValue: {flex: 1, fontSize: ms(9), fontWeight: '600', minWidth: 80},
  highlightValue: {paddingHorizontal: wp(5), paddingVertical: wp(2), borderRadius: wp(4)},
  twoColGrid: {flexDirection: 'row', flexWrap: 'wrap', gap: wp(6)},
  gridCol: {flex: 1, minWidth: 120},
  gridRow: {flexDirection: 'row', paddingVertical: wp(4)},
  gridLabel: {minWidth: wp(52), maxWidth: wp(78), fontSize: ms(9), fontWeight: '700'},
  gridValue: {flex: 1, fontSize: ms(9), fontWeight: '500'},
  // Charges — card-style rows
  chargeItem: {paddingVertical: wp(8), paddingHorizontal: wp(10), paddingLeft: wp(12), marginBottom: wp(4), borderRadius: wp(6), borderLeftWidth: 3},
  chargeTop: {flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between', gap: wp(8), marginBottom: wp(6)},
  chargeCode: {fontSize: ms(9), fontWeight: '600'},
  chargeDesc: {flex: 1, fontSize: ms(9), fontWeight: '700', lineHeight: ms(14)},
  chargeFields: {flexDirection: 'row', flexWrap: 'wrap', gap: wp(10)},
  chargeField: {gap: wp(2), minWidth: wp(36)},
  chargeFieldLabel: {fontSize: ms(9), fontWeight: '700', letterSpacing: 0.5},
  chargeFieldValue: {fontSize: ms(9), fontWeight: '600'},
  timeGrid: {flexDirection: 'row', flexWrap: 'wrap'},
  timeCell: {width: '25%', minWidth: 70, paddingVertical: wp(4)},
  timeLabel: {fontSize: ms(9), fontWeight: '700', letterSpacing: 0.3},
  timeValue: {fontSize: ms(9), fontWeight: '700', marginTop: 2},
  actionsSection: {paddingHorizontal: wp(14), paddingVertical: wp(12)},
  actionRowHalf: {flexDirection: 'row', gap: wp(10)},
  actionBtnHalf: {flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: wp(8), paddingVertical: wp(14), borderRadius: wp(12), minHeight: wp(48), elevation: 2, shadowColor: '#000', shadowOffset: {width: 0, height: 1}, shadowOpacity: 0.12, shadowRadius: 3},
  actionBtnOutline: {backgroundColor: 'transparent', borderWidth: 1.5, elevation: 0, shadowOpacity: 0},
  actionBtnFullText: {fontSize: ms(14), fontWeight: '800', letterSpacing: 0.5},
});
