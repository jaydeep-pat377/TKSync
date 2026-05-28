import React, {useRef, useState, useCallback} from 'react';
import {View, Text, TouchableOpacity, StyleSheet} from 'react-native';
import SignatureScreen from 'react-native-signature-canvas';
import MaterialIcons from 'react-native-vector-icons/MaterialIcons';
import {useTheme} from '../contexts/ThemeContext';
import {wp, ms} from '../utils/responsive';

type Props = {
  onSignatureChange: (signature: string | null) => void;
  height?: number;
  onTouchStart?: () => void;
  onTouchEnd?: () => void;
};

export default function SignaturePad({onSignatureChange, height = 220, onTouchStart, onTouchEnd}: Props) {
  const {c, isDark} = useTheme();
  const sigRef = useRef<any>(null);
  const [hasSignature, setHasSignature] = useState(false);
  const hasDrawn = useRef(false);

  const handleBegin = useCallback(() => {
    onTouchStart?.();
    if (!hasDrawn.current) {
      hasDrawn.current = true;
      setHasSignature(true);
      onSignatureChange('drawn');
    }
  }, [onSignatureChange, onTouchStart]);

  const handleEnd = useCallback(() => {
    onTouchEnd?.();
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

  const webStyle = `
    .m-signature-pad { box-shadow: none; border: none; margin: 0; }
    .m-signature-pad--body { border: none; }
    .m-signature-pad--footer { display: none; }
    body, html { background-color: ${isDark ? '#1E2230' : '#F1F5F9'}; margin: 0; padding: 0; }
    canvas { width: 100% !important; height: 100% !important; touch-action: none; }
  `;

  return (
    <View style={st.wrapper}>
      <View style={st.labelRow}>
        <MaterialIcons name="draw" size={ms(16)} color={c.textMuted} />
        <Text style={[st.label, {color: c.textMuted}]}>Draw your signature below</Text>
      </View>

      <View style={[st.padOuter, {height, backgroundColor: c.surface, borderColor: hasSignature ? c.primary : c.border}]}>
        <SignatureScreen
          ref={sigRef}
          onBegin={handleBegin}
          onEnd={handleEnd}
          onOK={handleOK}
          onEmpty={handleEmpty}
          webStyle={webStyle}
          backgroundColor="transparent"
          penColor={isDark ? '#F1F5F9' : '#1A202C'}
          minWidth={1.5}
          maxWidth={3}
          dotSize={2}
          autoClear={false}
        />

        {/* Clear button */}
        <TouchableOpacity
          style={[st.clearBtn, {backgroundColor: c.white, borderColor: c.border}]}
          onPress={handleClear}
          activeOpacity={0.7}>
          <MaterialIcons name="refresh" size={ms(14)} color={c.textSecondary} />
          <Text style={[st.clearText, {color: c.textSecondary}]}>Clear</Text>
        </TouchableOpacity>

        {/* Sign line */}
        <View style={[st.signLine, {borderBottomColor: c.textMuted}]}>
          <MaterialIcons name="play-arrow" size={ms(14)} color={c.textMuted} />
        </View>

        {/* Sign here label */}
        <Text style={[st.signHere, {color: c.textMuted}]}>SIGN HERE</Text>

        {/* Status indicator */}
        {hasSignature && (
          <View style={[st.statusBadge, {backgroundColor: c.primarySurface}]}>
            <MaterialIcons name="check" size={ms(12)} color={c.primary} />
          </View>
        )}
      </View>
    </View>
  );
}

const st = StyleSheet.create({
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
  signLine: {position: 'absolute', bottom: wp(34), left: wp(20), right: wp(20), borderBottomWidth: 1, flexDirection: 'row', alignItems: 'flex-end'},
  signHere: {position: 'absolute', bottom: wp(14), alignSelf: 'center', fontSize: ms(11), fontWeight: '600', letterSpacing: 0.5},
  statusBadge: {position: 'absolute', top: wp(10), left: wp(10), width: wp(24), height: wp(24), borderRadius: wp(12), justifyContent: 'center', alignItems: 'center'},
});
