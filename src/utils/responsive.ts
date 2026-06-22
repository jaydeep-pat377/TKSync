import {Dimensions, PixelRatio} from 'react-native';
import {getFontScale} from '../contexts/FontSizeContext';

// Base design dimensions (standard phone: 390pt short dimension - iPhone 14 logical)
const BASE_SHORT = 390;

// Tablet trim: multiplied into the scale on tablet devices (shortDim > 600)
// to make the UI slightly more compact. 0.9 = 10% reduction.
// Phones are completely unaffected.
const TABLET_TRIM = 0.9;

/**
 * Get the short dimension (always the smaller of width/height).
 * This is stable regardless of orientation.
 */
function getShortDim(): number {
  const {width, height} = Dimensions.get('window');
  return Math.min(width, height);
}

/**
 * Scale a value proportionally to device size.
 * Uses the short dimension (portrait width) as reference to ensure
 * consistent scaling regardless of orientation.
 *
 * On phones, scaling is purely linear (1:1 at 390pt).
 * On small phones (shortDim < 360), a floor of 0.85 prevents UI from
 * becoming too cramped.
 * On tablets (shortDim > 600), a 10% trim is applied for a more compact UI.
 */
export function wp(size: number): number {
  const shortDim = getShortDim();
  let scale = shortDim / BASE_SHORT;
  if (shortDim > 600) {
    scale *= TABLET_TRIM;
  } else if (shortDim < 360) {
    scale = Math.max(scale, 0.85);
  }
  return Math.round(PixelRatio.roundToNearestPixel(size * scale));
}

/**
 * Moderate scale for fonts and icons.
 * Scales less aggressively than wp() so text doesn't balloon on tablets.
 * factor: 0 = no scaling, 1 = same as wp(), 0.45 = default.
 *
 * On tablets (shortDim > 600), the minimum factor is raised to 0.6
 * so drivers can read text comfortably. TABLET_TRIM is NOT applied
 * to font scaling — only to layout dimensions via wp().
 */
export function ms(size: number, factor: number = 0.45): number {
  const shortDim = getShortDim();
  const scale = shortDim / BASE_SHORT;
  const effectiveFactor = shortDim > 600 ? Math.max(factor, 0.6) : factor;
  const newSize = size + (size * scale - size) * effectiveFactor;
  return Math.round(PixelRatio.roundToNearestPixel(newSize * getFontScale()));
}

/**
 * Height-proportional scaling using the long dimension.
 */
export function hp(size: number): number {
  const {width, height} = Dimensions.get('window');
  const longDim = Math.max(width, height);
  const scale = longDim / 844; // iPhone 14 long dimension
  return Math.round(PixelRatio.roundToNearestPixel(size * scale));
}

/**
 * Landscape-proportional scaling.
 * Scales linearly with the short dimension (screen height in landscape),
 * referenced to 810dp (iPad 10.2"). Values stay identical on the reference
 * device and scale proportionally on larger/smaller tablets.
 *
 * Use for spacing AND font sizes in landscape layouts where ms() is too
 * aggressive (due to the 0.6 min factor on tablets).
 */
const LANDSCAPE_REF = 810;
export function ls(size: number): number {
  const shortDim = getShortDim();
  const scale = shortDim / LANDSCAPE_REF;
  return Math.round(PixelRatio.roundToNearestPixel(size * scale));
}

/**
 * Device type detection with granular breakpoints.
 */
export type DeviceType = 'smallPhone' | 'phone' | 'tablet' | 'largeTablet';

export function getDeviceType(): DeviceType {
  const shortDim = getShortDim();
  if (shortDim < 360) return 'smallPhone';
  if (shortDim < 600) return 'phone';
  if (shortDim < 900) return 'tablet';
  return 'largeTablet';
}

export function isTablet(): boolean {
  return getShortDim() >= 600;
}

/**
 * Static landscape check. For components, prefer using
 * useWindowDimensions() which triggers re-renders on rotation.
 */
export function isLandscape(): boolean {
  const {width, height} = Dimensions.get('window');
  return width > height;
}

/**
 * Responsive value picker - returns the right value for current device.
 */
export function responsive<T>(values: {
  smallPhone?: T;
  phone: T;
  tablet?: T;
  largeTablet?: T;
}): T {
  const device = getDeviceType();
  switch (device) {
    case 'smallPhone':
      return values.smallPhone ?? values.phone;
    case 'phone':
      return values.phone;
    case 'tablet':
      return values.tablet ?? values.phone;
    case 'largeTablet':
      return values.largeTablet ?? values.tablet ?? values.phone;
  }
}

/**
 * Minimum touch target size (48dp per Material Design / Apple HIG).
 */
export const MIN_TOUCH_TARGET = 48;

/**
 * Clamp a scaled value between min and max.
 */
export function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

/**
 * Orientation-aware layout helpers.
 * Use these with live width/height from useWindowDimensions().
 */
export function orientationLayout(width: number, height: number) {
  const landscape = width > height;
  const shortDim = Math.min(width, height);
  const tablet = shortDim >= 600;
  const phone = !tablet;
  const smallPhone = shortDim < 360;

  return {
    isLandscape: landscape,
    isPortrait: !landscape,
    isTablet: tablet,
    isPhone: phone,
    isSmallPhone: smallPhone,
    // In portrait on phone, use full-width stacking; in landscape use side-by-side
    contentDirection: (landscape || tablet) ? 'row' as const : 'column' as const,
    // Cards that should be side-by-side in landscape but stack in portrait
    cardDirection: (landscape && phone) || tablet ? 'row' as const : 'column' as const,
    // Available content width for centering cards in portrait tablet
    maxContentWidth: tablet ? Math.min(width * 0.85, 800) : width,
    // Horizontal padding adjustment
    contentPadding: tablet ? wp(24) : landscape ? wp(16) : smallPhone ? wp(10) : wp(14),
    // Landscape phone: most space-constrained combo
    isLandscapePhone: landscape && phone,
  };
}
