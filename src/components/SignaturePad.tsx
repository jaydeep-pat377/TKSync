import React, {useRef, useState, useCallback, useEffect} from 'react';
import {View, Text, TouchableOpacity, StyleSheet} from 'react-native';
import SignatureScreen from 'react-native-signature-canvas';
import MaterialIcons from 'react-native-vector-icons/MaterialIcons';
import {useTheme} from '../contexts/ThemeContext';

type Props = {
  onSignatureChange: (signature: string | null) => void;
  height?: number;
};

export default function SignaturePad({onSignatureChange, height = 220}: Props) {
  const {c, isDark} = useTheme();
  const sigRef = useRef<any>(null);
  const [hasSignature, setHasSignature] = useState(false);
  const [drawCount, setDrawCount] = useState(0);

  // When user finishes a stroke, mark as drawn and read signature
  const handleEnd = useCallback(() => {
    setDrawCount(prev => prev + 1);
    setHasSignature(true);
    // Small delay to let the canvas finish rendering the stroke
    setTimeout(() => {
      sigRef.current?.readSignature();
    }, 100);
  }, []);

  // Called when readSignature() returns data
  const handleOK = useCallback(
    (sig: string) => {
      if (sig && sig.length > 50) {
        // Valid base64 signature data (not just empty canvas header)
        onSignatureChange(sig);
      }
    },
    [onSignatureChange],
  );

  // Fallback: if onOK never fires but user drew something, still enable
  useEffect(() => {
    if (drawCount > 0 && !hasSignature) {
      setHasSignature(true);
    }
  }, [drawCount, hasSignature]);

  // When drawCount increases and we haven't got a signature yet via onOK,
  // try reading again after a longer delay
  useEffect(() => {
    if (drawCount > 0) {
      const timer = setTimeout(() => {
        sigRef.current?.readSignature();
      }, 500);
      return () => clearTimeout(timer);
    }
  }, [drawCount]);

  // Also notify parent that signature exists based on draw activity
  useEffect(() => {
    if (hasSignature && drawCount > 0) {
      // If onOK hasn't fired with real data, send a placeholder to unblock button
      onSignatureChange('drawn');
    }
  }, [hasSignature, drawCount, onSignatureChange]);

  const handleEmpty = useCallback(() => {
    setHasSignature(false);
    setDrawCount(0);
    onSignatureChange(null);
  }, [onSignatureChange]);

  const handleClear = useCallback(() => {
    sigRef.current?.clearSignature();
    setHasSignature(false);
    setDrawCount(0);
    onSignatureChange(null);
  }, [onSignatureChange]);

  const handleBegin = useCallback(() => {
    // User started drawing — preemptively mark as having content
    if (!hasSignature) {
      setHasSignature(true);
    }
  }, [hasSignature]);

  const webStyle = `
    .m-signature-pad { box-shadow: none; border: none; margin: 0; }
    .m-signature-pad--body { border: none; }
    .m-signature-pad--footer { display: none; }
    body, html { background-color: ${isDark ? '#1E2230' : '#F1F5F9'}; margin: 0; padding: 0; }
    canvas { width: 100% !important; height: 100% !important; }
  `;

  return (
    <View style={st.wrapper}>
      <View style={st.labelRow}>
        <MaterialIcons name="draw" size={16} color={c.textMuted} />
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
          trimWhitespace
          autoClear={false}
        />

        {/* Clear button */}
        <TouchableOpacity
          style={[st.clearBtn, {backgroundColor: c.white, borderColor: c.border}]}
          onPress={handleClear}
          activeOpacity={0.7}>
          <MaterialIcons name="refresh" size={14} color={c.textSecondary} />
          <Text style={[st.clearText, {color: c.textSecondary}]}>Clear</Text>
        </TouchableOpacity>

        {/* Sign line */}
        <View style={[st.signLine, {borderBottomColor: c.textMuted}]}>
          <MaterialIcons name="play-arrow" size={14} color={c.textMuted} />
        </View>

        {/* Sign here label */}
        <Text style={[st.signHere, {color: c.textMuted}]}>SIGN HERE</Text>

        {/* Status indicator */}
        {hasSignature && (
          <View style={[st.statusBadge, {backgroundColor: c.primarySurface}]}>
            <MaterialIcons name="check" size={12} color={c.primary} />
          </View>
        )}
      </View>
    </View>
  );
}

const st = StyleSheet.create({
  wrapper: {marginTop: 8},
  labelRow: {flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 10},
  label: {fontSize: 12, fontWeight: '600'},
  padOuter: {borderRadius: 12, borderWidth: 1.5, overflow: 'hidden', position: 'relative'},
  clearBtn: {
    position: 'absolute',
    top: 10,
    right: 10,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 8,
    borderWidth: 1,
    zIndex: 10,
  },
  clearText: {fontSize: 12, fontWeight: '600'},
  signLine: {position: 'absolute', bottom: 34, left: 20, right: 20, borderBottomWidth: 1, flexDirection: 'row', alignItems: 'flex-end'},
  signHere: {position: 'absolute', bottom: 14, alignSelf: 'center', fontSize: 11, fontWeight: '600', letterSpacing: 0.5},
  statusBadge: {position: 'absolute', top: 10, left: 10, width: 24, height: 24, borderRadius: 12, justifyContent: 'center', alignItems: 'center'},
});
