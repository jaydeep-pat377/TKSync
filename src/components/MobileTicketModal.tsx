import React, {useEffect, useState, useCallback, useRef} from 'react';
import {
  Modal,
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  useWindowDimensions,
  ActivityIndicator,
  Platform,
} from 'react-native';
import {useSafeAreaInsets} from 'react-native-safe-area-context';
import Icon from './Icon';
import {useTheme} from '../contexts/ThemeContext';
import {wp} from '../utils/responsive';
import {ticketsApi, type MobileTicketPrint} from '../services/api';

type Props = {
  visible: boolean;
  onClose: () => void;
  ticketId?: number;
  onSign?: () => void;
  onDispute?: () => void;
};

// ── Palettes ──
const P_DARK = {
  overlay: 'rgba(0,0,0,0.75)',
  bg: '#27292C',
  header: '#35383C',
  sectionBar: 'rgba(157,237,62,0.06)',
  accent: '#9DED3E',
  text: '#FFFFFF',
  textBold: '#FFFFFF',
  label: '#7A7D83',
  border: '#3E4147',
  borderLight: '#353840',
  instrBorder: '#9DED3E',
  signBtn: '#3D7A1A',
  disputeBtn: '#8B1A1A',
  totalAccent: '#9DED3E',
  dotOn: '#5e9c2a',
  dotOff: '#6E7178',
  sigBorder: '#D4A800',
  sigBg: 'rgba(212,168,0,0.04)',
};

const P_LIGHT = {
  overlay: 'rgba(20,28,40,0.5)',
  bg: '#FFFFFF',
  header: '#2D3035',
  sectionBar: 'rgba(94,156,42,0.07)',
  accent: '#4A7A1E',
  text: '#1B2532',
  textBold: '#1B2532',
  label: '#76828F',
  border: '#DDE1E8',
  borderLight: '#EEF1F5',
  instrBorder: '#5e9c2a',
  signBtn: '#5e9c2a',
  disputeBtn: '#B5291A',
  totalAccent: '#4A7A1E',
  dotOn: '#5e9c2a',
  dotOff: '#B0B4BA',
  sigBorder: '#D4A800',
  sigBg: 'rgba(212,168,0,0.06)',
};

// ── Fonts (matching web reference) ──
const MONO = Platform.OS === 'ios' ? 'Menlo' : 'monospace';
const TITLE_FONT = Platform.OS === 'ios' ? 'Helvetica' : 'sans-serif';

// ── Helpers ──
const UOM_MAP: Record<string, string> = {MQ: 'CY'};
const normUOM = (u: string | null) => (!u ? '-' : UOM_MAP[u.toUpperCase()] || u);
const fmtDate = (t: string | null) => {
  if (!t) return '--';
  const d = new Date(t);
  return `${(d.getMonth() + 1).toString().padStart(2, '0')}/${d.getDate().toString().padStart(2, '0')}/${d.getFullYear()}`;
};
const fmtTime = (t: string | null) => {
  if (!t) return '---';
  const d = new Date(t);
  return `${d.getHours().toString().padStart(2, '0')}:${d.getMinutes().toString().padStart(2, '0')}`;
};
const fmtAmt = (v: number | null, oa: boolean) => (oa || v == null ? 'ON ACCOUNT' : `$${v.toFixed(2)}`);

// ── Main ──
export default function MobileTicketModal({visible, onClose, ticketId, onSign, onDispute}: Props) {
  const {isDark} = useTheme();
  const p = isDark ? P_DARK : P_LIGHT;
  const {width, height: winHeight} = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const isLandscape = width > winHeight;
  const shortDim = Math.min(width, winHeight);

  // ── Same scaling as Dashboard landscape ──
  const LREF = 810;
  const s = Math.max(0.65, Math.min(1.35, shortDim / LREF));
  const fs = (base: number) => Math.round(base * s);   // spacing
  const fst = (base: number) => Math.round((base - 1) * s); // font size (text)

  const scrollRef = useRef<ScrollView>(null);
  const [data, setData] = useState<MobileTicketPrint | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(false);

  const load = useCallback(async (id: number) => {
    setLoading(true);
    setError(false);
    try { setData((await ticketsApi.getPrintable(id)).data); }
    catch { setError(true); }
    finally { setLoading(false); }
  }, []);

  useEffect(() => {
    if (visible && ticketId) load(ticketId);
    if (!visible) { setData(null); setError(false); }
  }, [visible, ticketId, load]);

  // Flash scroll indicator when data loads
  useEffect(() => {
    if (data && scrollRef.current) {
      setTimeout(() => scrollRef.current?.flashScrollIndicators(), 300);
    }
  }, [data]);

  // ── Derived data ──
  const hdr = data?.header;
  const cu = data?.customer;
  const dt = data?.driver_truck;
  const tl = data?.timeline;
  const tot = data?.totals;
  const charges = data?.charges || [];

  const custRows = cu
    ? [
        {l: 'CUSTOMER', v: cu.customer_name || '-'},
        {l: 'PROJECT', v: cu.project_name || '-'},
        {l: 'ADDRESS', v: cu.address ? `${cu.address}${cu.map_page ? `\nMapPage: ${cu.map_page}` : ''}` : '-'},
        {l: 'ORDERED BY', v: cu.ordered_by || '-'},
        ...(cu.instructions ? [{l: 'INSTRUCTIONS', v: cu.instructions, hl: true as const}] : []),
      ]
    : [];

  const ldRow1 = dt
    ? [
        {l: 'DRIVER', v: `#${dt.driver_code}`},
        {l: 'TRUCK', v: dt.truck_code || '-'},
        {l: 'PLANT', v: dt.plant_name || '-'},
        {l: 'TRUCK AHEAD', v: dt.truck_ahead || '-'},
      ]
    : [];
  const ldRow2 = dt
    ? [
        {l: 'LOAD', v: dt.load.display || '-'},
        {l: 'SLUMP', v: dt.slump || '-'},
        {l: 'QUANTITY', v: dt.quantity.display || '-'},
        {l: 'USAGE', v: dt.usage || '-'},
      ]
    : [];

  const steps = tl?.steps?.map(step => ({
    label: step.label.toUpperCase(),
    time: fmtTime(step.time),
    on: step.done,
  })) || [];

  const chRows = charges.map(ch => ({
    code: ch.code || '-',
    desc: ch.description || '-',
    qty: ch.quantity != null ? ch.quantity.toFixed(2) : '-',
    unit: normUOM(ch.unit),
    price: ch.price != null ? ch.price.toFixed(2) : '-',
    amt: fmtAmt(ch.amount, tot?.on_account ?? true),
  }));

  const sub = tot?.subtotal?.toFixed(2) ?? '0.00';
  const tax = tot?.tax?.toFixed(2) ?? '0.00';
  const total = tot ? String(tot.total_display ?? 'ON ACCOUNT') : 'ON ACCOUNT';

  // ── Modal sizing (within safe area) ──
  const safeW = width - insets.left - insets.right;
  const safeH = winHeight - insets.top - insets.bottom;
  const modalW = safeW * 0.76;
  const modalH = safeH * 0.92;
  const pad = fs(12); // section body horizontal padding (matches dashboard card padding)
  const ct = shortDim < 820; // compact tablet flag (same as dashboard)
  const rowPv = ct ? fs(7) : fs(8); // row vertical padding

  return (
    <Modal transparent visible={visible} animationType="fade" onRequestClose={onClose} statusBarTranslucent>
      <View style={[st.overlay, {backgroundColor: p.overlay, paddingTop: insets.top, paddingBottom: insets.bottom, paddingLeft: insets.left, paddingRight: insets.right}]}>
        <View style={[st.card, {width: modalW, height: modalH, borderRadius: fs(6), backgroundColor: p.bg}]}>

          {/* Loading */}
          {loading && (
            <View style={st.center}>
              <ActivityIndicator size="large" color={p.accent} />
            </View>
          )}

          {/* Error */}
          {error && !data && !loading && (
            <View style={st.center}>
              <Icon name="error-outline" size={fs(40)} color={p.label} />
              <Text style={{fontSize: fst(15), fontWeight: '700', color: p.text, marginTop: fs(12), fontFamily: MONO}}>Unable to load ticket</Text>
              <TouchableOpacity
                onPress={() => ticketId && load(ticketId)}
                activeOpacity={0.7}
                style={{flexDirection: 'row', alignItems: 'center', gap: fs(6), marginTop: fs(16), backgroundColor: p.accent, paddingVertical: fs(8), paddingHorizontal: fs(20), borderRadius: fs(6)}}>
                <Icon name="refresh" size={fst(14)} color="#fff" />
                <Text style={{fontSize: fst(13), fontWeight: '700', color: '#fff', fontFamily: MONO}}>Retry</Text>
              </TouchableOpacity>
              <TouchableOpacity onPress={onClose} style={{marginTop: fs(10)}}>
                <Text style={{fontSize: fst(12), fontWeight: '600', color: p.accent, fontFamily: MONO}}>Close</Text>
              </TouchableOpacity>
            </View>
          )}

          {/* Data */}
          {data && !loading && (
            <>
              {/* ════ HEADER BANNER ════ */}
              <View style={{flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', backgroundColor: p.header, paddingHorizontal: fs(24), paddingVertical: fs(18), borderBottomWidth: 3, borderBottomColor: '#4e8a2f'}}>
                <Text style={{fontSize: fst(28), fontWeight: '800', color: '#fff', letterSpacing: 3, lineHeight: fst(34), fontFamily: TITLE_FONT}}>
                  MOBILE{'\n'}TICKET
                </Text>
                <View style={{flex: 1}} />
                {/* QR code — white card with icon */}
                <View style={{backgroundColor: '#fff', padding: fs(6), borderRadius: fs(6)}}>
                  <Icon name="qr-code-2" size={fs(80)} color="#000" />
                </View>
              </View>

              {/* ════ ORDER / TICKET / DATE + CLOSE ════ */}
              <View style={{flexDirection: 'row', alignItems: 'center', borderBottomWidth: StyleSheet.hairlineWidth, borderColor: p.border}}>
                {[
                  {l: 'ORDER', v: hdr?.order_code || '-'},
                  {l: 'TICKET', v: hdr?.ticket_code || '-'},
                  {l: 'DATE', v: fmtDate(hdr?.order_date ?? null)},
                ].map((item, i) => (
                  <View key={item.l} style={[{flex: 1, alignItems: 'center', paddingVertical: fs(10)}, i < 2 && {borderRightWidth: StyleSheet.hairlineWidth, borderRightColor: p.border}]}>
                    <Text style={{fontSize: fst(11), fontWeight: '800', letterSpacing: 1, color: p.label, fontFamily: MONO}}>{item.l}</Text>
                    <Text style={{fontSize: fst(20), fontWeight: '800', marginTop: fs(5), color: p.textBold, fontFamily: MONO}}>{item.v}</Text>
                  </View>
                ))}
                {/* Close button — white square with dark border */}
                <TouchableOpacity
                  style={{width: fs(30), height: fs(30), borderWidth: 1.5, borderColor: '#1a2230', backgroundColor: '#fff', borderRadius: fs(5), alignItems: 'center', justifyContent: 'center', marginRight: fs(14)}}
                  onPress={onClose} activeOpacity={0.7}>
                  <Text style={{fontSize: fst(13), fontWeight: '400', color: '#1a2230', fontFamily: MONO}}>✕</Text>
                </TouchableOpacity>
              </View>

              {/* ════ SCROLLABLE BODY ════ */}
              <ScrollView ref={scrollRef} style={{flex: 1}} showsVerticalScrollIndicator={true} persistentScrollbar={true} fadingEdgeLength={0}>

                {/* ── ORDER DETAILS ── */}
                <View style={{borderLeftWidth: fs(4), borderLeftColor: p.accent, backgroundColor: p.sectionBar, paddingHorizontal: fs(12), paddingVertical: ct ? fs(5) : fs(6)}}>
                  <Text style={{fontSize: fst(11), fontWeight: '800', letterSpacing: 0.8, color: p.accent, fontFamily: MONO}}>ORDER DETAILS</Text>
                </View>
                <View style={{paddingHorizontal: pad, paddingVertical: fs(4)}}>
                  {custRows.map(row => (
                    <View key={row.l} style={{flexDirection: 'row', alignItems: 'flex-start', paddingVertical: rowPv, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: p.borderLight}}>
                      <Text style={{width: '20%', fontSize: fst(10), fontWeight: '600', letterSpacing: 0.5, color: p.label, fontFamily: MONO}}>{row.l}</Text>
                      {'hl' in row && row.hl ? (
                        <View style={{backgroundColor: '#FFFF00', borderRadius: fs(4), paddingHorizontal: fs(5), paddingVertical: fs(3)}}>
                          <Text style={{fontSize: fst(12), fontWeight: '800', color: '#000', fontFamily: MONO}}>{row.v}</Text>
                        </View>
                      ) : (
                        <Text style={{flex: 1, fontSize: fst(12), fontWeight: '800', color: p.text, fontFamily: MONO}}>{row.v}</Text>
                      )}
                    </View>
                  ))}
                </View>

                {/* ── LOAD & DELIVERY ── */}
                <View style={{borderLeftWidth: fs(4), borderLeftColor: p.accent, backgroundColor: p.sectionBar, paddingHorizontal: fs(12), paddingVertical: ct ? fs(5) : fs(6)}}>
                  <Text style={{fontSize: fst(11), fontWeight: '800', letterSpacing: 0.8, color: p.accent, fontFamily: MONO}}>LOAD & DELIVERY</Text>
                </View>
                {[ldRow1, ldRow2].map((cells, ri) => (
                  <View key={ri} style={{flexDirection: 'row', borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: p.border}}>
                    {cells.map((cell, ci) => (
                      <View key={cell.l} style={[{flex: 1, paddingVertical: rowPv, paddingHorizontal: fs(10)}, ci < cells.length - 1 && {borderRightWidth: StyleSheet.hairlineWidth, borderRightColor: p.borderLight}]}>
                        <Text style={{fontSize: fst(10), fontWeight: '600', letterSpacing: 0.5, marginBottom: fs(2), color: p.label, fontFamily: MONO}}>{cell.l}</Text>
                        <Text style={{fontSize: fst(12), fontWeight: '800', color: p.textBold, fontFamily: MONO}} numberOfLines={2}>{cell.v}</Text>
                      </View>
                    ))}
                  </View>
                ))}

                {/* ── PRODUCTS & CHARGES ── */}
                <View style={{borderLeftWidth: fs(4), borderLeftColor: p.accent, backgroundColor: p.sectionBar, paddingHorizontal: fs(12), paddingVertical: ct ? fs(5) : fs(6)}}>
                  <Text style={{fontSize: fst(11), fontWeight: '800', letterSpacing: 0.8, color: p.accent, fontFamily: MONO}}>PRODUCTS & CHARGES</Text>
                </View>
                <View style={{paddingHorizontal: pad, paddingVertical: fs(4)}}>
                  {/* table header */}
                  <View style={{flexDirection: 'row', alignItems: 'center', paddingVertical: fs(6), borderBottomWidth: 2, borderBottomColor: p.accent}}>
                    <Text style={{width: '10%', fontSize: fst(10), fontWeight: '800', letterSpacing: 0.5, color: p.textBold, fontFamily: MONO}}>CODE</Text>
                    <Text style={{flex: 1, fontSize: fst(10), fontWeight: '800', letterSpacing: 0.5, color: p.textBold, fontFamily: MONO}}>DESCRIPTION</Text>
                    <Text style={{width: '8%', fontSize: fst(10), fontWeight: '800', letterSpacing: 0.5, color: p.textBold, textAlign: 'right', fontFamily: MONO}}>QTY</Text>
                    <Text style={{width: '8%', fontSize: fst(10), fontWeight: '800', letterSpacing: 0.5, color: p.textBold, textAlign: 'center', fontFamily: MONO}}>UNIT</Text>
                    <Text style={{width: '8%', fontSize: fst(10), fontWeight: '800', letterSpacing: 0.5, color: p.textBold, textAlign: 'right', fontFamily: MONO}}>PRICE</Text>
                    <Text style={{width: '16%', fontSize: fst(10), fontWeight: '800', letterSpacing: 0.5, color: p.textBold, textAlign: 'right', fontFamily: MONO}}>TICKET AMOUNT</Text>
                  </View>
                  {/* table rows */}
                  {chRows.map((r, i) => (
                    <View key={`${r.code}-${i}`} style={{flexDirection: 'row', alignItems: 'center', paddingVertical: rowPv, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: p.borderLight}}>
                      <Text style={{width: '10%', fontSize: fst(12), fontWeight: '500', color: p.label, fontFamily: MONO}} numberOfLines={1}>{r.code}</Text>
                      <Text style={{flex: 1, fontSize: fst(12), fontWeight: '700', color: p.text, fontFamily: MONO}} numberOfLines={1}>{r.desc}</Text>
                      <Text style={{width: '8%', fontSize: fst(12), fontWeight: '500', color: p.text, textAlign: 'right', fontFamily: MONO}}>{r.qty}</Text>
                      <Text style={{width: '8%', fontSize: fst(12), fontWeight: '500', color: p.label, textAlign: 'center', fontFamily: MONO}}>{r.unit}</Text>
                      <Text style={{width: '8%', fontSize: fst(12), fontWeight: '500', color: p.text, textAlign: 'right', fontFamily: MONO}}>{r.price}</Text>
                      <Text style={{width: '16%', fontSize: fst(12), fontWeight: '500', color: p.text, textAlign: 'right', fontFamily: MONO}}>{r.amt}</Text>
                    </View>
                  ))}
                  {/* totals */}
                  <View style={{alignItems: 'flex-end', marginTop: fs(8)}}>
                    {[
                      {l: 'Sub', v: sub, bold: false},
                      {l: 'Tax', v: tax, bold: false},
                      {l: 'Total', v: total, bold: true},
                    ].map(t => (
                      <View key={t.l} style={{flexDirection: 'row', paddingVertical: fs(2), gap: fs(12)}}>
                        <Text style={{width: fs(40), textAlign: 'right', fontSize: fst(12), fontWeight: t.bold ? '800' : '600', color: t.bold ? p.textBold : p.label, fontFamily: MONO}}>{t.l}</Text>
                        <Text style={{width: fs(80), textAlign: 'right', fontSize: fst(12), fontWeight: t.bold ? '800' : '500', color: t.bold ? p.totalAccent : p.text, fontFamily: MONO}}>{t.v}</Text>
                      </View>
                    ))}
                  </View>
                </View>

                {/* ── STATUS TIMES ── */}
                <View style={{borderLeftWidth: 4, borderLeftColor: '#4e8a2f', backgroundColor: '#f3f7f2', paddingHorizontal: fs(20), paddingVertical: fs(9), borderBottomWidth: 1, borderBottomColor: '#e3e7ec'}}>
                  <Text style={{fontSize: fst(11), fontWeight: '800', letterSpacing: 1.2, color: '#3f7d2f', fontFamily: MONO}}>STATUS TIMES</Text>
                </View>
                {/* Grid: 4 columns, 1px gray gap between cells */}
                <View style={{backgroundColor: '#e3e7ec'}}>
                  {[0, 1].map(rowIdx => {
                    const rowSteps = steps.slice(rowIdx * 4, rowIdx * 4 + 4);
                    if (rowSteps.length === 0) return null;
                    return (
                      <View key={rowIdx} style={{flexDirection: 'row', marginTop: rowIdx > 0 ? 1 : 0}}>
                        {[0, 1, 2, 3].map(colIdx => {
                          const step = rowSteps[colIdx];
                          return (
                            <View key={colIdx} style={{flex: 1, backgroundColor: '#fff', padding: fs(12), paddingHorizontal: fs(14), flexDirection: 'row', alignItems: 'center', gap: fs(9), marginLeft: colIdx > 0 ? 1 : 0}}>
                              {step ? (
                                <>
                                  <View style={{width: fs(9), height: fs(9), borderRadius: fs(5), backgroundColor: step.on ? '#2bb24c' : '#c4ccd6'}} />
                                  <Text style={{flex: 1, fontSize: fst(11), fontWeight: '800', letterSpacing: 0.3, color: step.on ? '#1a2230' : '#5a6573', fontFamily: MONO}}>{step.label}</Text>
                                  <Text style={{fontSize: fst(13), fontWeight: '700', color: step.on ? '#1a2230' : '#9aa3ad', fontFamily: MONO}}>{step.time}</Text>
                                </>
                              ) : null}
                            </View>
                          );
                        })}
                      </View>
                    );
                  })}
                </View>

                {/* signature box — .tkSignBox */}
                <View style={{paddingHorizontal: fs(24)}}>
                  <View style={{height: fs(120), backgroundColor: '#ededed', borderRadius: fs(5), marginBottom: fs(16)}} />
                </View>

                {/* ── ACTION BUTTONS — .tkBtns ── */}
                <View style={{flexDirection: 'row', paddingHorizontal: fs(24), paddingBottom: fs(24), gap: fs(14)}}>
                  <TouchableOpacity
                    style={{flex: 1, padding: fs(15), borderRadius: 2, alignItems: 'center', justifyContent: 'center', backgroundColor: '#157a15'}}
                    onPress={onSign} activeOpacity={0.8}>
                    <Text style={{fontSize: fst(14), fontWeight: '800', color: '#fff', letterSpacing: 0.5, fontFamily: MONO}}>SIGN</Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    style={{flex: 1, padding: fs(15), borderRadius: 2, alignItems: 'center', justifyContent: 'center', backgroundColor: '#8a1414'}}
                    onPress={onDispute} activeOpacity={0.8}>
                    <Text style={{fontSize: fst(14), fontWeight: '800', color: '#fff', letterSpacing: 0.5, fontFamily: MONO}}>DISPUTE</Text>
                  </TouchableOpacity>
                </View>
              </ScrollView>
            </>
          )}
        </View>
      </View>
    </Modal>
  );
}

const st = StyleSheet.create({
  overlay: {flex: 1, justifyContent: 'center', alignItems: 'center'},
  card: {
    overflow: 'hidden',
    elevation: 16,
    shadowColor: '#000',
    shadowOffset: {width: 0, height: 8},
    shadowOpacity: 0.3,
    shadowRadius: 20,
  },
  center: {flex: 1, justifyContent: 'center', alignItems: 'center', padding: 24},
});
