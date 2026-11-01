import { getPrefs, reducedMotion } from './prefs.ts';

/**
 * Haptics (DESIGN_BIBLE 7). navigator.vibrate exists on Android Chrome; iOS Safari has none, so every call is a silent
 * no-op there (never promised in the UI). Off with the Haptics setting. With reduced motion only single short pulses
 * play, never the longer patterns.
 */
export const HAPTICS = {
  selection: 8,
  land: 12, // my own card lands
  bet: 10,
  bust: 30,
  turnWarning: [15, 90, 15], // 5 s left on my turn
  win: [12, 60, 12],
  blackjack: [20, 60, 20, 60, 40],
} as const;
export type Haptic = keyof typeof HAPTICS;

export function haptic(kind: Haptic) {
  if (!getPrefs().haptics) return;
  const p = HAPTICS[kind];
  if (Array.isArray(p) && reducedMotion()) return;
  try {
    navigator.vibrate?.(p as number | number[]);
  } catch {}
}
