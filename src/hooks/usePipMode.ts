import {useEffect, useState} from 'react';
import {Platform, NativeModules, DeviceEventEmitter} from 'react-native';

const {PipModule} = NativeModules;

/**
 * Picture-in-picture state.
 *
 * The native side floats the activity when the driver presses Home; this hook
 * reports whether we are currently in that small window so screens can render a
 * compact layout. Chrome, headers and controls are unreadable at PiP size and
 * must be stripped — the window is roughly 200dp wide.
 *
 * PiP is visibility only. GPS collection lives in LocationTrackingService and is
 * unaffected by whether the window is floating, backgrounded or gone.
 */
export function usePipMode(): boolean {
  const [inPipMode, setInPipMode] = useState(false);

  useEffect(() => {
    if (Platform.OS !== 'android' || !PipModule) return;
    const sub = DeviceEventEmitter.addListener(
      'pipModeChanged',
      (e: {inPipMode: boolean}) => setInPipMode(!!e?.inPipMode),
    );
    return () => sub.remove();
  }, []);

  return inPipMode;
}

/** Allow PiP to auto-trigger on Home press. Call with true once tracking starts. */
export function setPipAutoEnter(enabled: boolean): void {
  if (Platform.OS !== 'android' || !PipModule?.setAutoEnter) return;
  PipModule.setAutoEnter(enabled).catch(() => {});
}

/** Enter PiP immediately. Only valid while the app is in the foreground. */
export function enterPipMode(): Promise<boolean> {
  if (Platform.OS !== 'android' || !PipModule?.enterPipMode) return Promise.resolve(false);
  return PipModule.enterPipMode().catch(() => false);
}

export async function isPipSupported(): Promise<boolean> {
  if (Platform.OS !== 'android' || !PipModule?.isSupported) return false;
  try {
    return await PipModule.isSupported();
  } catch {
    return false;
  }
}
