import React, {useRef, useState, useCallback} from 'react';
import {View, Text, Image, TouchableOpacity, StyleSheet, Platform} from 'react-native';
import SignatureScreen from 'react-native-signature-canvas';
import Icon from './Icon';
import {useTheme} from '../contexts/ThemeContext';
import {wp, ms} from '../utils/responsive';
import {useFontScaleRefresh} from '../contexts/FontSizeContext';

const MONO = Platform.OS === 'ios' ? 'Menlo' : 'monospace';

type Props = {
  onSignatureChange: (signature: string | null) => void;
  height?: number;
  onTouchStart?: () => void;
  onTouchEnd?: () => void;
  readOnly?: boolean;
  initialImage?: string | null;
  onEditPress?: () => void;
  minimal?: boolean;
  clearRef?: React.MutableRefObject<(() => void) | null>;
};

export default function SignaturePad({onSignatureChange, height = 280, onTouchStart, onTouchEnd, readOnly, initialImage, onEditPress, minimal, clearRef}: Props) {
  useFontScaleRefresh();
  const st = createSt();
  const {c, isDark} = useTheme();
  const sigRef = useRef<any>(null);
  const [hasSignature, setHasSignature] = useState(false);
  const hasDrawn = useRef(false);
  const scrollDisabled = useRef(false);

  const handleBegin = useCallback(() => {
    if (!scrollDisabled.current) {
      scrollDisabled.current = true;
      onTouchStart?.();
    }
    if (!hasDrawn.current) {
      hasDrawn.current = true;
      setHasSignature(true);
      onSignatureChange('drawn');
    }
  }, [onSignatureChange, onTouchStart]);

  const handleEnd = useCallback(() => {
    if (scrollDisabled.current) {
      scrollDisabled.current = false;
      onTouchEnd?.();
    }
    setTimeout(() => {
      sigRef.current?.readSignature();
    }, 300);
  }, [onTouchEnd]);

  const handleOK = useCallback(
    (sig: string) => {
      if (sig && sig.length > 50) {
        onSignatureChange(sig);
      }
    },
    [onSignatureChange],
  );

  const handleEmpty = useCallback(() => {
    hasDrawn.current = false;
    setHasSignature(false);
    onSignatureChange(null);
  }, [onSignatureChange]);

  const handleClear = useCallback(() => {
    sigRef.current?.clearSignature();
    hasDrawn.current = false;
    setHasSignature(false);
    onSignatureChange(null);
  }, [onSignatureChange]);

  // Expose clear to parent via ref
  if (clearRef) clearRef.current = handleClear;

  const webStyle = `
    .m-signature-pad { box-shadow: none; border: none; margin: 0; }
    .m-signature-pad--body { border: none; }
    .m-signature-pad--footer { display: none; }
    body, html { background-color: #FFFFFF; margin: 0; padding: 0; }
    canvas { width: 100% !important; height: 100% !important; touch-action: none; }
  `;

  if (readOnly && initialImage) {
    return (
      <View style={[st.wrapper]}>
        <View style={[st.labelRow]}>
          <Icon name="draw" size={ms(16)} color={c.textMuted} />
          <Text style={[st.label, {color: c.textMuted, fontFamily: MONO}]}>Signature</Text>
        </View>
        <View style={[st.padOuter, {height, backgroundColor: '#FFFFFF', borderColor: c.primary}]}>
          <Image source={{uri: initialImage}} style={st.readOnlyImage} resizeMode="contain" />
          <View style={[st.signLine, {borderBottomColor: c.textMuted}]}>
            <Icon name="play-arrow" size={ms(14)} color={c.textMuted} />
          </View>
          {onEditPress && (
            <TouchableOpacity
              style={[st.editBtn, {backgroundColor: c.white, borderColor: c.border}]}
              onPress={onEditPress}
              activeOpacity={0.7}>
              <Icon name="edit" size={ms(14)} color={c.textSecondary} />
              <Text style={[st.editText, {color: c.textSecondary, fontFamily: MONO}]}>Edit</Text>
            </TouchableOpacity>
          )}
          <View style={[st.statusBadge, {backgroundColor: c.primarySurface}]}>
            <Icon name="check" size={ms(12)} color={c.primary} />
          </View>
        </View>
      </View>
    );
  }

  return (
    <View style={[st.wrapper, minimal && {marginTop: wp(4)}]}>
      {!minimal && (
        <View style={[st.labelRow]}>
          <Icon name="draw" size={ms(16)} color={c.textMuted} />
          <Text style={[st.label, {color: c.textMuted, fontFamily: MONO}]}>Draw your signature below</Text>
        </View>
      )}

      <View style={[st.padOuter, {height, backgroundColor: '#FFFFFF', borderColor: hasSignature ? c.primary : c.border}, minimal && {borderRadius: wp(6), borderWidth: 1}]}>
        <SignatureScreen
          ref={sigRef}
          onBegin={handleBegin}
          onEnd={handleEnd}
          onOK={handleOK}
          onEmpty={handleEmpty}
          webStyle={webStyle}
          backgroundColor="transparent"
          penColor="#1A202C"
          minWidth={1.5}
          maxWidth={3}
          dotSize={2}
          autoClear={false}
          scrollable={false}
          {...(Platform.OS === 'android' ? {androidHardwareAccelerationDisabled: true, nestedScrollEnabled: false} : {})}
        />

        {/* Clear button */}
        {!minimal && (
          <TouchableOpacity
            style={[st.clearBtn, {backgroundColor: c.white, borderColor: c.border}]}
            onPress={handleClear}
            activeOpacity={0.7}>
            <Icon name="refresh" size={ms(14)} color={c.textSecondary} />
            <Text style={[st.clearText, {color: c.textSecondary, fontFamily: MONO}]}>Clear</Text>
          </TouchableOpacity>
        )}

        {/* Sign line */}
        {!minimal && (
          <View style={[st.signLine, {borderBottomColor: isDark ? c.textMuted : '#333'}]}>
            <Icon name="play-arrow" size={ms(14)} color={isDark ? c.textMuted : '#333'} />
          </View>
        )}

        {/* Sign here label */}
        <Text style={[st.signHere, {color: isDark ? c.textMuted : '#999', fontFamily: MONO}]}>SIGN HERE</Text>

        {/* Status indicator */}
        {!minimal && hasSignature && (
          <View style={[st.statusBadge, {backgroundColor: c.primarySurface}]}>
            <Icon name="check" size={ms(12)} color={c.primary} />
          </View>
        )}
      </View>
    </View>
  );
}

const createSt = () => StyleSheet.create({
  wrapper: {marginTop: wp(8)},
  labelRow: {flexDirection: 'row', alignItems: 'center', gap: wp(6), marginBottom: wp(10)},
  label: {fontSize: ms(12), fontWeight: '600'},
  padOuter: {borderRadius: wp(12), borderWidth: 1.5, overflow: 'hidden', position: 'relative'},
  clearBtn: {
    position: 'absolute',
    top: wp(10),
    right: wp(10),
    flexDirection: 'row',
    alignItems: 'center',
    gap: wp(4),
    paddingHorizontal: wp(10),
    paddingVertical: wp(6),
    borderRadius: wp(8),
    borderWidth: 1,
    zIndex: 10,
  },
  clearText: {fontSize: ms(12), fontWeight: '600'},
  signLine: {position: 'absolute', bottom: wp(30), left: wp(16), right: wp(16), borderBottomWidth: 1, flexDirection: 'row', alignItems: 'flex-end'},
  signHere: {position: 'absolute', bottom: wp(12), alignSelf: 'center', fontSize: ms(10), fontWeight: '600', letterSpacing: 0.5},
  statusBadge: {position: 'absolute', top: wp(10), left: wp(10), width: wp(24), height: wp(24), borderRadius: wp(12), justifyContent: 'center', alignItems: 'center'},
  editBtn: {
    position: 'absolute',
    top: wp(10),
    right: wp(10),
    flexDirection: 'row',
    alignItems: 'center',
    gap: wp(4),
    paddingHorizontal: wp(10),
    paddingVertical: wp(6),
    borderRadius: wp(8),
    borderWidth: 1,
    zIndex: 10,
  },
  editText: {fontSize: ms(12), fontWeight: '600'},
  readOnlyImage: {width: '100%', height: '100%'},
});
