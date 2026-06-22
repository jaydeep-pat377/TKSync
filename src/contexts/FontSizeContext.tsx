import React, {createContext, useContext, useState, useCallback, useMemo} from 'react';
import {createMMKV} from 'react-native-mmkv';

const fontStore = createMMKV({id: 'tksync-fontsize'});
const SCALE_KEY = 'font_scale';
const MIN_SCALE = 0.85;
const MAX_SCALE = 1.30;
const STEP = 0.05;
const DEFAULT_SCALE = 1.0;

function loadScale(): number {
  const raw = fontStore.getNumber(SCALE_KEY);
  if (raw == null) return DEFAULT_SCALE;
  return Math.max(MIN_SCALE, Math.min(MAX_SCALE, raw));
}

type FontSizeContextType = {
  fontScale: number;
  increase: () => void;
  decrease: () => void;
  reset: () => void;
};

const FontSizeContext = createContext<FontSizeContextType>({
  fontScale: DEFAULT_SCALE,
  increase: () => {},
  decrease: () => {},
  reset: () => {},
});

export function FontSizeProvider({children}: {children: React.ReactNode}) {
  const [fontScale, setFontScale] = useState(loadScale);

  // Keep global scale in sync immediately when state changes
  _globalFontScale = fontScale;

  const update = useCallback((scale: number) => {
    const clamped = Math.round(Math.max(MIN_SCALE, Math.min(MAX_SCALE, scale)) * 100) / 100;
    _globalFontScale = clamped;
    setFontScale(clamped);
    fontStore.set(SCALE_KEY, clamped);
  }, []);

  const increase = useCallback(() => update(fontScale + STEP), [fontScale, update]);
  const decrease = useCallback(() => update(fontScale - STEP), [fontScale, update]);
  const reset = useCallback(() => update(DEFAULT_SCALE), [update]);

  const value = useMemo(() => ({fontScale, increase, decrease, reset}), [fontScale, increase, decrease, reset]);

  return (
    <FontSizeContext.Provider value={value}>
      {children}
    </FontSizeContext.Provider>
  );
}

export function useFontSize(): FontSizeContextType {
  return useContext(FontSizeContext);
}

/** Subscribe to font scale changes — triggers re-render when scale changes.
 *  Use in any component that calls createStyles() or ms() in its render. */
export function useFontScaleRefresh(): number {
  const {fontScale} = useContext(FontSizeContext);
  return fontScale;
}

/** Global font scale — readable outside React (for ms() in responsive.ts). */
let _globalFontScale = loadScale();

export function getFontScale(): number {
  return _globalFontScale;
}

export function setGlobalFontScale(scale: number): void {
  _globalFontScale = scale;
}
