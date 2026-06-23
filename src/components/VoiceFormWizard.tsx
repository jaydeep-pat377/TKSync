import React, {useState, useRef, useEffect, useCallback} from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  Animated,
  ScrollView,
  Linking,
  TextInput,
} from 'react-native';
import MaterialIcons from 'react-native-vector-icons/MaterialIcons';
import ResponsiveModal from './ResponsiveModal';
import {useTheme} from '../contexts/ThemeContext';
import {wp, ms} from '../utils/responsive';
import {deepgramSpeech, deepgramTTS, type DeepgramEvent} from '../services/deepgramSpeech';

// ─── TYPES ───

export type VoiceFieldType = 'text' | 'number' | 'boolean' | 'choice' | 'time';

export interface VoiceField {
  key: string;
  label: string;
  prompt: string;
  type: VoiceFieldType;
  choices?: string[];
  skip?: boolean;
  min?: number;
  max?: number;
  required?: boolean;
  /** Show this field only when another field has a specific value */
  dependsOn?: {key: string; value: string};
}

export type VoiceResults = Record<string, string>;

interface Props {
  visible: boolean;
  onClose: () => void;
  fields: VoiceField[];
  onComplete: (results: VoiceResults) => void;
  /** Domain-specific keywords for Deepgram boosting */
  keywords?: string[];
  /** Enable TTS to speak prompts aloud before listening */
  speakPrompts?: boolean;
}

// ─── STATUS TYPES ───

type WizardPhase = 'ready' | 'listening' | 'processing' | 'confirm' | 'review';

type ValidationStatus = 'valid' | 'invalid' | 'skipped';
interface FieldValidation {
  status: ValidationStatus;
  message: string;
}

// ─── VALIDATION ───

function validateField(value: string | undefined, field: VoiceField): FieldValidation {
  if (!value || value.trim() === '') {
    if (field.required) return {status: 'invalid', message: 'Required field'};
    return {status: 'skipped', message: 'Skipped'};
  }
  const trimmed = value.trim();
  switch (field.type) {
    case 'number': {
      const num = Number(trimmed);
      if (isNaN(num)) return {status: 'invalid', message: `"${trimmed}" is not a valid number`};
      if (field.min != null && num < field.min) return {status: 'invalid', message: `Must be at least ${field.min}`};
      if (field.max != null && num > field.max) return {status: 'invalid', message: `Must be at most ${field.max}`};
      return {status: 'valid', message: String(num)};
    }
    case 'boolean': {
      const lower = trimmed.toLowerCase();
      if (lower === 'yes' || lower === 'no') return {status: 'valid', message: ''};
      return {status: 'invalid', message: `Expected "yes" or "no", got "${trimmed}"`};
    }
    case 'choice': {
      if (!field.choices) return {status: 'valid', message: ''};
      const match = field.choices.find(ch => ch.toLowerCase() === trimmed.toLowerCase());
      if (match) return {status: 'valid', message: ''};
      return {status: 'invalid', message: `Not a valid option. Expected: ${field.choices.join(', ')}`};
    }
    default:
      return {status: 'valid', message: ''};
  }
}

// ─── VOICE INPUT PROCESSING ───

function processVoiceInput(text: string, field: VoiceField): string {
  const trimmed = text.trim();
  switch (field.type) {
    case 'number': {
      // Deepgram with numerals=true already converts "fifteen" → "15"
      const numMatch = trimmed.match(/[-]?[\d.]+/);
      if (numMatch) return numMatch[0];
      return spokenToNumber(trimmed);
    }
    case 'boolean': {
      const lower = trimmed.toLowerCase();
      if (/^(yes|yeah|yep|yup|affirmative|correct|true|sure)/.test(lower)) return 'yes';
      if (/^(no|nah|nope|negative|false|not)/.test(lower)) return 'no';
      return trimmed;
    }
    case 'choice': {
      if (!field.choices) return trimmed;
      const lower = trimmed.toLowerCase();
      const exact = field.choices.find(ch => ch.toLowerCase() === lower);
      if (exact) return exact;
      const partial = field.choices.find(ch =>
        lower.includes(ch.toLowerCase()) || ch.toLowerCase().includes(lower),
      );
      if (partial) return partial;
      return trimmed;
    }
    default:
      return trimmed;
  }
}

function spokenToNumber(text: string): string {
  const map: Record<string, string> = {
    zero: '0', one: '1', two: '2', three: '3', four: '4', five: '5',
    six: '6', seven: '7', eight: '8', nine: '9', ten: '10',
    fifteen: '15', twenty: '20', thirty: '30', forty: '40', fifty: '50',
    sixty: '60', seventy: '70', eighty: '80', ninety: '90', hundred: '100',
  };
  return map[text.toLowerCase().trim()] || text;
}

// ─── COMPONENT ───

export default function VoiceFormWizard({visible, onClose, fields, onComplete, keywords, speakPrompts}: Props) {
  const {c} = useTheme();

  const [phase, setPhase] = useState<WizardPhase>('ready');
  const [currentIdx, setCurrentIdx] = useState(0);
  const [results, setResults] = useState<VoiceResults>({});
  const activeFields = fields.filter(f => {
    if (f.skip) return false;
    if (f.dependsOn) return results[f.dependsOn.key] === f.dependsOn.value;
    return true;
  });
  const [partialResult, setPartialResult] = useState('');
  const [error, setError] = useState('');
  const [editingKey, setEditingKey] = useState<string | null>(null);
  const [editValue, setEditValue] = useState('');
  const [isSpeakingPrompt, setIsSpeakingPrompt] = useState(false);

  const pulseAnim = useRef(new Animated.Value(1)).current;
  const fadeAnim = useRef(new Animated.Value(0)).current;
  const pulseLoop = useRef<Animated.CompositeAnimation | null>(null);
  const isMounted = useRef(true);
  const currentIdxRef = useRef(0);
  currentIdxRef.current = currentIdx;
  // Auto-chain: when a field is captured, signal the next field to auto-start
  const pendingAutoStart = useRef(false);
  // Refs so handleDeepgramEvent can call these without circular deps
  const speakPromptsRef = useRef(speakPrompts);
  speakPromptsRef.current = speakPrompts;
  const startListeningRef = useRef<() => void>(() => {});

  const currentField = activeFields[currentIdx];

  // ─── Computed validations ───
  const validations: Record<string, FieldValidation> = {};
  let validCount = 0;
  let invalidCount = 0;
  let skippedFieldCount = 0;
  activeFields.forEach(f => {
    const v = validateField(results[f.key], f);
    validations[f.key] = v;
    if (v.status === 'valid') validCount++;
    else if (v.status === 'invalid') invalidCount++;
    else skippedFieldCount++;
  });

  // ─── Reset on open/close ───
  useEffect(() => {
    isMounted.current = true;
    if (visible) {
      setPhase('ready');
      setCurrentIdx(0);
      setResults({});
      setPartialResult('');
      setError('');
      setEditingKey(null);
      fadeAnim.setValue(0);
      Animated.timing(fadeAnim, {toValue: 1, duration: 300, useNativeDriver: true}).start();
    } else {
      deepgramTTS.stopPlayback();
      deepgramSpeech.destroy();
    }
    return () => {
      isMounted.current = false;
      deepgramTTS.stopPlayback();
      deepgramSpeech.destroy();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible]);

  // ─── Animations ───
  const startPulse = useCallback(() => {
    pulseAnim.setValue(1);
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(pulseAnim, {toValue: 1.15, duration: 800, useNativeDriver: true}),
        Animated.timing(pulseAnim, {toValue: 1, duration: 800, useNativeDriver: true}),
      ]),
    );
    pulseLoop.current = loop;
    loop.start();
  }, [pulseAnim]);

  const stopPulse = useCallback(() => {
    pulseLoop.current?.stop();
    pulseAnim.setValue(1);
  }, [pulseAnim]);

  // ─── Deepgram event handler ───
  const handleDeepgramEvent = useCallback((event: DeepgramEvent) => {
    if (!isMounted.current) return;

    switch (event.type) {
      case 'partial':
        setPartialResult(event.text);
        break;

      case 'final': {
        // Stop streaming, process result
        deepgramSpeech.stop();
        stopPulse();
        setPartialResult('');
        setPhase('processing');

        const idx = currentIdxRef.current;
        const field = activeFields[idx];
        const processed = processVoiceInput(event.text, field);
        setResults(prev => ({...prev, [field.key]: processed}));

        // Validate immediately
        const validation = validateField(processed, field);

        if (validation.status === 'invalid') {
          // ─── INVALID: stay on same field, notify, auto-retry ───
          setTimeout(async () => {
            if (!isMounted.current) return;
            setError(`Not valid value: ${validation.message}`);
            setPhase('ready');

            // Speak the rejection via TTS if enabled, then auto-retry
            if (speakPromptsRef.current) {
              setIsSpeakingPrompt(true);
              try {
                await deepgramTTS.speak(`Not valid. ${validation.message}. Please try again.`);
              } catch {}
              if (!isMounted.current) return;
              setIsSpeakingPrompt(false);
            }

            // Auto-restart listening on the same field
            setError('');
            startListeningRef.current();
          }, 800);
        } else {
          // ─── VALID: auto-advance to next field ───
          setTimeout(() => {
            if (!isMounted.current) return;
            if (idx < activeFields.length - 1) {
              pendingAutoStart.current = true;
              setCurrentIdx(idx + 1);
              setPhase('ready');
              setError('');
            } else {
              setPhase('confirm');
            }
          }, 800);
        }
        break;
      }

      case 'error':
        stopPulse();
        setError(event.message);
        setPhase('ready');
        break;

      case 'ready':
        // WebSocket connected, mic is streaming
        break;

      case 'closed':
        stopPulse();
        break;
    }
  }, [activeFields, stopPulse]);

  // ─── Core actions ───

  /** Speak prompt via TTS, then auto-start mic listening */
  const speakThenListen = useCallback(async () => {
    if (!speakPrompts || !currentField) {
      // No TTS — go straight to listening
      return startListeningOnly();
    }

    setError('');
    setPartialResult('');
    setIsSpeakingPrompt(true);
    setPhase('ready');

    try {
      await deepgramTTS.speak(currentField.prompt);
    } catch (err: any) {
      // TTS failed — not critical, just proceed to listen
      console.warn('[VoiceWizard] TTS error:', err?.message);
    }

    if (!isMounted.current) return;
    setIsSpeakingPrompt(false);

    // Auto-start mic after prompt finishes
    await startListeningOnly();
  }, [speakPrompts, currentField]);

  /** Start mic listening only (no TTS) */
  const startListeningOnly = useCallback(async () => {
    setError('');
    setPartialResult('');
    setPhase('listening');
    startPulse();

    await deepgramSpeech.start(handleDeepgramEvent, keywords);
  }, [startPulse, handleDeepgramEvent, keywords]);

  /** Public entry point — speaks prompt if enabled, then listens */
  const startListening = speakPrompts ? speakThenListen : startListeningOnly;
  // Keep ref in sync for handleDeepgramEvent retry access
  startListeningRef.current = startListeningOnly;

  // ─── Auto-chain: when currentIdx advances and pendingAutoStart is set,
  //     automatically start listening for the next field ───
  useEffect(() => {
    if (pendingAutoStart.current && isMounted.current && phase === 'ready') {
      pendingAutoStart.current = false;
      // Small delay to let the UI render the new field before speaking/listening
      const timer = setTimeout(() => {
        if (isMounted.current) {
          startListening();
        }
      }, 200);
      return () => clearTimeout(timer);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentIdx, phase]);

  const stopListening = useCallback(async () => {
    deepgramTTS.stopPlayback();
    setIsSpeakingPrompt(false);
    await deepgramSpeech.stop();
    stopPulse();
    // If we were listening but got no final result, go back to ready
    if (phase === 'listening') {
      setPhase('ready');
    }
  }, [stopPulse, phase]);

  const skipField = useCallback(() => {
    deepgramSpeech.stop();
    stopPulse();
    if (currentIdx < activeFields.length - 1) {
      setCurrentIdx(prev => prev + 1);
      setPhase('ready');
      setError('');
      setPartialResult('');
    } else {
      setPhase('confirm');
    }
  }, [currentIdx, activeFields.length, stopPulse]);

  const handleConfirmOk = useCallback(() => {
    // Only apply valid fields — skip invalid ones
    const validResults: VoiceResults = {};
    activeFields.forEach(f => {
      const v = validateField(results[f.key], f);
      if (v.status === 'valid' && results[f.key]) {
        validResults[f.key] = results[f.key];
      }
    });
    onComplete(validResults);
    onClose();
  }, [results, activeFields, onComplete, onClose]);
  const handleConfirmRefill = useCallback(() => {
    deepgramTTS.stopPlayback();
    deepgramSpeech.destroy();
    setResults({});
    setCurrentIdx(0);
    setPartialResult('');
    setError('');
    setPhase('ready');
  }, []);

  const handleReRecordField = useCallback((idx: number) => {
    setCurrentIdx(idx);
    setPhase('ready');
    setError('');
    setPartialResult('');
    setEditingKey(null);
  }, []);

  const handleStartEdit = useCallback((key: string, val: string) => {
    setEditingKey(key);
    setEditValue(val || '');
  }, []);

  const handleSaveEdit = useCallback(() => {
    if (editingKey) {
      setResults(prev => ({...prev, [editingKey]: editValue}));
      setEditingKey(null);
    }
  }, [editingKey, editValue]);

  const handleCancelEdit = useCallback(() => setEditingKey(null), []);

  const handleApply = useCallback(() => { onComplete(results); onClose(); }, [results, onComplete, onClose]);
  const handleCancel = useCallback(() => { deepgramTTS.stopPlayback(); deepgramSpeech.destroy(); onClose(); }, [onClose]);
  const openSettings = useCallback(() => Linking.openSettings(), []);

  const progress = activeFields.length > 0 ? (currentIdx + 1) / activeFields.length : 0;
  const filledCount = Object.keys(results).filter(k => results[k]?.trim()).length;
  const skippedCount = activeFields.length - filledCount - (phase === 'confirm' || phase === 'review' ? 0 : (activeFields.length - currentIdx - 1));

  // ─── Dynamic title/subtitle based on current state ───
  const getDynamicTitle = (): string => {
    switch (phase) {
      case 'ready': return isSpeakingPrompt ? 'Speaking Prompt...' : 'Ready to Listen';
      case 'listening': return 'Listening...';
      case 'processing': return 'Processing...';
      case 'confirm': return 'Voice Capture Complete';
      case 'review': return 'Review & Edit';
      default: return 'Voice Input';
    }
  };

  const getDynamicSubtitle = (): string => {
    if (phase === 'ready' || phase === 'listening' || phase === 'processing') {
      const parts: string[] = [];
      if (filledCount > 0) parts.push(`${filledCount} filled`);
      if (invalidCount > 0) parts.push(`${invalidCount} invalid`);
      const remaining = activeFields.length - currentIdx - (phase === 'processing' ? 1 : 0);
      if (remaining > 0) parts.push(`${remaining} remaining`);
      return parts.join('  |  ') || `Field ${currentIdx + 1} of ${activeFields.length}`;
    }
    if (phase === 'confirm' || phase === 'review') {
      const parts: string[] = [`${validCount} valid`];
      if (invalidCount > 0) parts.push(`${invalidCount} invalid`);
      const sk = activeFields.length - validCount - invalidCount;
      if (sk > 0) parts.push(`${sk} skipped`);
      return parts.join('  |  ');
    }
    return '';
  };

  // ─── Validation icon ───
  const VI = ({status}: {status: ValidationStatus}) => {
    if (status === 'valid') return <MaterialIcons name="check-circle" size={ms(16)} color={c.success} />;
    if (status === 'invalid') return <MaterialIcons name="error" size={ms(16)} color={c.error} />;
    return <MaterialIcons name="remove-circle-outline" size={ms(16)} color={c.textMuted} />;
  };

  // ─── RENDER ───

  return (
    <ResponsiveModal visible={visible} onClose={handleCancel} maxWidth={400} maxHeightPercent={60}>
      <Animated.View style={[styles.container, {backgroundColor: c.white, opacity: fadeAnim}]}>
        {/* Header with real-time title + subtitle */}
        <View style={[styles.header, {borderBottomColor: c.border}]}>
          <View style={styles.headerLeft}>
            <MaterialIcons name="mic" size={ms(18)} color={c.primary} />
            <View>
              <Text style={[styles.headerTitle, {color: c.textPrimary}]}>{getDynamicTitle()}</Text>
              <Text style={[styles.headerSubtitle, {color: c.textSecondary}]}>{getDynamicSubtitle()}</Text>
            </View>
          </View>
          <TouchableOpacity onPress={handleCancel} hitSlop={{top: 12, bottom: 12, left: 12, right: 12}}>
            <MaterialIcons name="close" size={ms(20)} color={c.textMuted} />
          </TouchableOpacity>
        </View>

        {/* Real-time field status strip — shows during capture phases */}
        {(phase === 'ready' || phase === 'listening' || phase === 'processing') && filledCount > 0 && (
          <ScrollView horizontal showsHorizontalScrollIndicator={false} style={[styles.fieldStrip, {backgroundColor: c.surface}]} contentContainerStyle={styles.fieldStripContent}>
            {activeFields.map((f, idx) => {
              const val = results[f.key];
              const v = validations[f.key];
              const isCurrent = idx === currentIdx;
              return (
                <View key={f.key} style={[styles.fieldChip, isCurrent && {borderColor: c.primary, borderWidth: 1.5}, !isCurrent && {borderColor: 'transparent', borderWidth: 1.5}]}>
                  {val ? <VI status={v.status} /> : (isCurrent ? <MaterialIcons name="mic" size={ms(12)} color={c.primary} /> : <MaterialIcons name="radio-button-unchecked" size={ms(12)} color={c.textMuted} />)}
                  <Text style={[styles.fieldChipText, {color: isCurrent ? c.primary : val ? c.textPrimary : c.textMuted}]} numberOfLines={1}>{val || f.label.split(' ')[0]}</Text>
                </View>
              );
            })}
          </ScrollView>
        )}

        {/* Progress bar */}
        {(phase === 'ready' || phase === 'listening' || phase === 'processing') && (
          <View style={[styles.progressTrack, {backgroundColor: c.borderLight}]}>
            <View style={[styles.progressFill, {backgroundColor: c.primary, width: `${progress * 100}%`}]} />
          </View>
        )}

        {/* ═══ CONFIRM ═══ */}
        {phase === 'confirm' && (
          <View style={styles.confirmContainer}>
            <View style={styles.confirmHeader}>
              <MaterialIcons name="assignment-turned-in" size={ms(26)} color={c.primary} />
              <Text style={[styles.confirmQuestion, {color: c.textPrimary}]}>
                Voice capture complete
              </Text>
            </View>

            {/* Summary badges */}
            <View style={styles.confirmStats}>
              <View style={[styles.statBadge, {backgroundColor: c.successSurface}]}>
                <MaterialIcons name="check-circle" size={ms(10)} color={c.success} />
                <Text style={[styles.statText, {color: c.success}]}>{validCount} Filled</Text>
              </View>
              {skippedFieldCount > 0 && (
                <View style={[styles.statBadge, {backgroundColor: c.surface}]}>
                  <MaterialIcons name="remove-circle-outline" size={ms(10)} color={c.textMuted} />
                  <Text style={[styles.statText, {color: c.textMuted}]}>{skippedFieldCount} Empty</Text>
                </View>
              )}
              {invalidCount > 0 && (
                <View style={[styles.statBadge, {backgroundColor: c.errorSurface}]}>
                  <MaterialIcons name="error" size={ms(10)} color={c.error} />
                  <Text style={[styles.statText, {color: c.error}]}>{invalidCount} Invalid</Text>
                </View>
              )}
            </View>

            {/* Warning for invalid fields */}
            {invalidCount > 0 && (
              <Text style={[styles.confirmWarning, {color: c.error}]}>
                {invalidCount} field{invalidCount > 1 ? 's have' : ' has'} invalid values and will be skipped.
              </Text>
            )}

            {/* Field list */}
            <ScrollView style={styles.confirmScrollOuter} showsVerticalScrollIndicator contentContainerStyle={styles.confirmScrollInner}>
              {activeFields.map(f => {
                const val = results[f.key];
                const v = validations[f.key];
                return (
                  <View key={f.key} style={[styles.confirmSummaryRow, {borderBottomColor: c.borderLight}]}>
                    <VI status={v.status} />
                    <Text style={[styles.confirmSummaryLabel, {color: v.status === 'skipped' ? c.textMuted : c.textSecondary}]} numberOfLines={1}>{f.label}</Text>
                    <Text style={[styles.confirmSummaryValue, {color: v.status === 'invalid' ? c.error : val ? c.textPrimary : c.textMuted}]} numberOfLines={1}>
                      {v.status === 'invalid' ? val : val || '—'}
                    </Text>
                  </View>
                );
              })}
            </ScrollView>

            <View style={styles.confirmButtons}>
              <TouchableOpacity style={[styles.actionBtn, {backgroundColor: c.surface, borderColor: c.border, borderWidth: 1}]} onPress={() => setPhase('review')} activeOpacity={0.7}>
                <MaterialIcons name="edit" size={ms(16)} color={c.textSecondary} />
                <Text style={[styles.actionBtnText, {color: c.textSecondary}]}>Edit</Text>
              </TouchableOpacity>
              <TouchableOpacity style={[styles.actionBtn, {backgroundColor: c.primary}]} onPress={handleConfirmOk} activeOpacity={0.7}>
                <MaterialIcons name="check" size={ms(16)} color="#FFF" />
                <Text style={[styles.actionBtnText, {color: '#FFF'}]}>OK</Text>
              </TouchableOpacity>
            </View>
          </View>
        )}

        {/* ═══ REVIEW ═══ */}
        {phase === 'review' && (
          <View style={styles.reviewContainer}>
            <View style={styles.reviewStats}>
              <View style={[styles.statBadge, {backgroundColor: c.successSurface}]}>
                <MaterialIcons name="check-circle" size={ms(12)} color={c.success} />
                <Text style={[styles.statText, {color: c.success}]}>{validCount} Valid</Text>
              </View>
              {invalidCount > 0 && (
                <View style={[styles.statBadge, {backgroundColor: c.errorSurface}]}>
                  <MaterialIcons name="error" size={ms(12)} color={c.error} />
                  <Text style={[styles.statText, {color: c.error}]}>{invalidCount} Invalid</Text>
                </View>
              )}
            </View>
            <ScrollView style={styles.reviewScroll} showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled">
              {activeFields.map((field, idx) => {
                const val = results[field.key];
                const v = validations[field.key];
                const isEditing = editingKey === field.key;
                return (
                  <View key={field.key} style={[styles.reviewRow, {borderBottomColor: c.borderLight}]}>
                    <View style={styles.reviewRowHeader}>
                      <VI status={v.status} />
                      <Text style={[styles.reviewLabel, {color: c.textSecondary}]}>{field.label}</Text>
                    </View>
                    {isEditing ? (
                      <View style={styles.editRow}>
                        <TextInput
                          style={[styles.editInput, {color: c.textPrimary, borderColor: c.primary, backgroundColor: c.surface}]}
                          value={editValue}
                          onChangeText={setEditValue}
                          autoFocus
                          keyboardType={field.type === 'number' ? 'numeric' : 'default'}
                          returnKeyType="done"
                          onSubmitEditing={handleSaveEdit}
                          placeholderTextColor={c.textMuted}
                          placeholder={`Enter ${field.label.toLowerCase()}`}
                        />
                        <TouchableOpacity onPress={handleSaveEdit} style={[styles.editActionBtn, {backgroundColor: c.primary}]}>
                          <MaterialIcons name="check" size={ms(14)} color="#FFF" />
                        </TouchableOpacity>
                        <TouchableOpacity onPress={handleCancelEdit} style={[styles.editActionBtn, {backgroundColor: c.surface, borderColor: c.border, borderWidth: 1}]}>
                          <MaterialIcons name="close" size={ms(14)} color={c.textMuted} />
                        </TouchableOpacity>
                      </View>
                    ) : (
                      <View style={styles.reviewValueRow}>
                        <Text style={[styles.reviewValue, {color: val ? (v.status === 'invalid' ? c.error : c.textPrimary) : c.textMuted}]} numberOfLines={2}>{val || 'Skipped'}</Text>
                        <View style={styles.reviewActions}>
                          <TouchableOpacity onPress={() => handleStartEdit(field.key, val || '')} hitSlop={{top: 8, bottom: 8, left: 8, right: 8}}>
                            <MaterialIcons name="edit" size={ms(15)} color={c.textMuted} />
                          </TouchableOpacity>
                          <TouchableOpacity onPress={() => handleReRecordField(idx)} hitSlop={{top: 8, bottom: 8, left: 8, right: 8}}>
                            <MaterialIcons name="mic" size={ms(15)} color={c.primary} />
                          </TouchableOpacity>
                        </View>
                      </View>
                    )}
                    {v.status === 'invalid' && v.message && !isEditing && (
                      <Text style={[styles.validationMsg, {color: c.error}]}>{v.message}</Text>
                    )}
                  </View>
                );
              })}
            </ScrollView>
            <View style={styles.reviewButtons}>
              <TouchableOpacity style={[styles.actionBtn, {backgroundColor: c.surface, borderColor: c.border, borderWidth: 1}]} onPress={handleCancel} activeOpacity={0.7}>
                <Text style={[styles.actionBtnText, {color: c.textSecondary}]}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity style={[styles.actionBtn, {backgroundColor: c.primary}]} onPress={handleApply} activeOpacity={0.7}>
                <MaterialIcons name="check" size={ms(16)} color="#FFF" />
                <Text style={[styles.actionBtnText, {color: '#FFF'}]}>Apply All</Text>
              </TouchableOpacity>
            </View>
          </View>
        )}

        {/* ═══ FIELD PROMPT ═══ */}
        {(phase === 'ready' || phase === 'listening' || phase === 'processing') && (
          <View style={styles.promptContainer}>
            <Text style={[styles.stepText, {color: c.textMuted}]}>Field {currentIdx + 1} of {activeFields.length}{results[currentField?.key] ? ' (re-record)' : ''}</Text>
            <Text style={[styles.fieldLabel, {color: c.textPrimary}]}>{currentField?.label}</Text>
            <Text style={[styles.promptText, {color: c.textSecondary}]}>{currentField?.prompt}</Text>

            {currentField?.type === 'choice' && currentField.choices && (
              <View style={[styles.choicesHint, {backgroundColor: c.surface, borderColor: c.borderLight}]}>
                <Text style={[styles.choicesTitle, {color: c.textMuted}]}>Say one of:</Text>
                {currentField.choices.map(ch => (
                  <Text key={ch} style={[styles.choiceItem, {color: c.textSecondary}]}>{ch}</Text>
                ))}
              </View>
            )}

            {(partialResult || results[currentField?.key]) ? (
              <View>
                <View style={[styles.resultBox, {borderColor: phase === 'listening' ? c.primary :
                    (results[currentField?.key] && validations[currentField?.key]?.status === 'invalid') ? c.error : c.primary}]}>
                  <Text style={[styles.resultText, {color: c.textPrimary}]}>
                    {phase === 'listening' ? partialResult : results[currentField?.key]}
                  </Text>
                </View>
                {phase === 'processing' && results[currentField?.key] && (
                  <View style={styles.inlineValidation}>
                    <VI status={validations[currentField?.key]?.status || 'skipped'} />
                    <Text style={[styles.inlineValidationText, {color: validations[currentField?.key]?.status === 'valid' ? c.success : c.error}]}>
                      {validations[currentField?.key]?.status === 'valid' ? 'Valid' : validations[currentField?.key]?.message}
                    </Text>
                  </View>
                )}
              </View>
            ) : null}

            {error ? <Text style={[styles.errorText, {color: c.error}]}>{error}</Text> : null}

            {error.includes('permission') && (
              <TouchableOpacity onPress={openSettings} style={styles.settingsLink} activeOpacity={0.6}>
                <MaterialIcons name="settings" size={ms(14)} color={c.linkBlue} />
                <Text style={[styles.settingsText, {color: c.linkBlue}]}>Open Settings</Text>
              </TouchableOpacity>
            )}

            <View style={styles.micContainer}>
              <Animated.View style={{transform: [{scale: pulseAnim}]}}>
                <TouchableOpacity
                  style={[styles.micButton, {backgroundColor: phase === 'listening' ? c.error : c.primary}]}
                  onPress={phase === 'listening' ? stopListening : startListening}
                  activeOpacity={0.7}
                  disabled={phase === 'processing' || isSpeakingPrompt}>
                  <MaterialIcons name={phase === 'listening' ? 'stop' : 'mic'} size={ms(22)} color="#FFF" />
                </TouchableOpacity>
              </Animated.View>
              <Text style={[styles.micHint, {color: c.textMuted}]}>
                {isSpeakingPrompt ? 'Speaking prompt...' : phase === 'listening' ? 'Listening... Tap to stop' : phase === 'processing' ? 'Processing...' : 'Tap to speak'}
              </Text>
            </View>

            <TouchableOpacity style={styles.skipButton} onPress={skipField} activeOpacity={0.6} disabled={phase === 'processing'}>
              <Text style={[styles.skipText, {color: c.textMuted}]}>Skip this field</Text>
              <MaterialIcons name="skip-next" size={ms(14)} color={c.textMuted} />
            </TouchableOpacity>
          </View>
        )}
      </Animated.View>
    </ResponsiveModal>
  );
}

// ─── STYLES ───

const styles = StyleSheet.create({
  container: {borderRadius: 14, overflow: 'hidden'},
  header: {flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: wp(12), paddingVertical: wp(8), borderBottomWidth: StyleSheet.hairlineWidth},
  headerLeft: {flexDirection: 'row', alignItems: 'center', gap: wp(6)},
  headerTitle: {fontSize: ms(13), fontWeight: '600'},
  headerSubtitle: {fontSize: ms(8), fontWeight: '500', marginTop: wp(1)},
  fieldStrip: {maxHeight: wp(34)},
  fieldStripContent: {paddingHorizontal: wp(8), paddingVertical: wp(4), gap: wp(4), alignItems: 'center'},
  fieldChip: {flexDirection: 'row', alignItems: 'center', gap: wp(2), paddingHorizontal: wp(6), paddingVertical: wp(5), borderRadius: wp(10), backgroundColor: 'transparent'},
  fieldChipText: {fontSize: ms(8), fontWeight: '600', maxWidth: wp(40), lineHeight: ms(12)},
  progressTrack: {height: 2, width: '100%'},
  progressFill: {height: '100%', borderRadius: 1},

  promptContainer: {alignItems: 'center', paddingHorizontal: wp(16), paddingTop: wp(12), paddingBottom: wp(10)},
  stepText: {fontSize: ms(9), fontWeight: '500', textTransform: 'uppercase', letterSpacing: 0.5},
  fieldLabel: {fontSize: ms(15), fontWeight: '700', marginTop: wp(4), textAlign: 'center'},
  promptText: {fontSize: ms(11), marginTop: wp(4), textAlign: 'center', lineHeight: ms(15)},
  choicesHint: {marginTop: wp(8), borderRadius: wp(6), borderWidth: 1, paddingHorizontal: wp(10), paddingVertical: wp(6), alignSelf: 'stretch'},
  choicesTitle: {fontSize: ms(9), fontWeight: '600', textTransform: 'uppercase', marginBottom: wp(2)},
  choiceItem: {fontSize: ms(10), paddingVertical: wp(1)},
  resultBox: {marginTop: wp(8), borderWidth: 1.5, borderRadius: wp(8), paddingHorizontal: wp(10), paddingVertical: wp(6), alignSelf: 'stretch', minHeight: wp(30), justifyContent: 'center'},
  resultText: {fontSize: ms(13), fontWeight: '500', textAlign: 'center'},
  inlineValidation: {flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: wp(3), marginTop: wp(4)},
  inlineValidationText: {fontSize: ms(9), fontWeight: '500'},
  errorText: {fontSize: ms(9), marginTop: wp(4), textAlign: 'center', paddingHorizontal: wp(6)},
  settingsLink: {flexDirection: 'row', alignItems: 'center', gap: wp(3), marginTop: wp(4), paddingVertical: wp(3), paddingHorizontal: wp(6)},
  settingsText: {fontSize: ms(10), fontWeight: '600', textDecorationLine: 'underline'},
  micContainer: {alignItems: 'center', marginTop: wp(12), gap: wp(6)},
  micButton: {width: wp(48), height: wp(48), borderRadius: wp(24), alignItems: 'center', justifyContent: 'center', elevation: 4, shadowColor: '#000', shadowOffset: {width: 0, height: 2}, shadowOpacity: 0.2, shadowRadius: 4},
  micHint: {fontSize: ms(9)},
  skipButton: {flexDirection: 'row', alignItems: 'center', gap: wp(3), marginTop: wp(8), paddingVertical: wp(4), paddingHorizontal: wp(8)},
  skipText: {fontSize: ms(10)},

  confirmContainer: {paddingHorizontal: wp(12), paddingBottom: wp(12)},
  confirmHeader: {alignItems: 'center', paddingTop: wp(10), paddingBottom: wp(6)},
  confirmQuestion: {fontSize: ms(12), fontWeight: '600', marginTop: wp(4), textAlign: 'center'},
  confirmStats: {flexDirection: 'row', justifyContent: 'center', gap: wp(6), marginTop: wp(6), marginBottom: wp(4)},
  confirmWarning: {fontSize: ms(8), textAlign: 'center', marginBottom: wp(4)},
  confirmScrollOuter: {maxHeight: wp(140)},
  confirmScrollInner: {paddingHorizontal: wp(2)},
  confirmSummaryRow: {flexDirection: 'row', alignItems: 'center', gap: wp(4), paddingVertical: wp(5), borderBottomWidth: StyleSheet.hairlineWidth},
  confirmSummaryLabel: {fontSize: ms(9), fontWeight: '600', flex: 1},
  confirmSummaryValue: {fontSize: ms(10), fontWeight: '500', maxWidth: '40%', textAlign: 'right'},
  confirmButtons: {flexDirection: 'row', gap: wp(8), marginTop: wp(10), marginBottom: wp(12)},

  reviewContainer: {paddingHorizontal: wp(12), paddingTop: wp(6), paddingBottom: wp(12)},
  reviewStats: {flexDirection: 'row', justifyContent: 'center', gap: wp(8), marginTop: wp(4), marginBottom: wp(6)},
  statBadge: {flexDirection: 'row', alignItems: 'center', gap: wp(3), paddingHorizontal: wp(8), paddingVertical: wp(3), borderRadius: wp(10)},
  statText: {fontSize: ms(9), fontWeight: '700'},
  reviewScroll: {maxHeight: wp(220)},
  reviewRow: {paddingVertical: wp(5), borderBottomWidth: StyleSheet.hairlineWidth},
  reviewRowHeader: {flexDirection: 'row', alignItems: 'center', gap: wp(4)},
  reviewLabel: {fontSize: ms(9), fontWeight: '600', textTransform: 'uppercase', letterSpacing: 0.3},
  reviewValueRow: {flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: wp(2)},
  reviewValue: {fontSize: ms(11), fontWeight: '500', flex: 1},
  reviewActions: {flexDirection: 'row', alignItems: 'center', gap: wp(10), marginLeft: wp(6)},
  validationMsg: {fontSize: ms(8), marginTop: wp(1), fontWeight: '500'},
  editRow: {flexDirection: 'row', alignItems: 'center', gap: wp(4), marginTop: wp(3)},
  editInput: {flex: 1, fontSize: ms(11), fontWeight: '500', borderWidth: 1.5, borderRadius: wp(6), paddingHorizontal: wp(8), paddingVertical: wp(4), minHeight: wp(28)},
  editActionBtn: {width: wp(26), height: wp(26), borderRadius: wp(6), justifyContent: 'center', alignItems: 'center'},
  reviewButtons: {flexDirection: 'row', gap: wp(8), marginTop: wp(10)},

  actionBtn: {flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: wp(4), paddingVertical: wp(8), borderRadius: wp(8), minHeight: wp(36)},
  actionBtnText: {fontSize: ms(12), fontWeight: '600'},
});
