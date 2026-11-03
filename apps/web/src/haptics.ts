import { FEEL } from './feel.ts';
import { getPrefs, reducedMotion } from './prefs.ts';

/**
 * Haptics (DESIGN_BIBLE 7). navigator.vibrate exists on Android Chrome; iOS Safari has none, so every call is a silent
 * no-op there (never promised in the UI). Off with the Haptics setting. With reduced motion only single short pulses
 * play, never the longer patterns.
 */
export const HAPTICS = FEEL.haptics;
export type Haptic = keyof typeof FEEL.haptics;

export function haptic(kind: Haptic) {
  if (!getPrefs().haptics) return;
  const p = HAPTICS[kind];
  if (Array.isArray(p) && reducedMotion()) return;
  try {
    navigator.vibrate?.(p as number | number[]);
  } catch {}
}
