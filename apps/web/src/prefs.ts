import { get, set } from 'idb-keyval';
import { useSyncExternalStore } from 'react';
import type { Locale } from './i18n.ts';

export interface Prefs {
  sound: boolean;
  /** 'system' follows the OS setting live, also while a game is running. */
  motion: 'system' | 'full' | 'reduced';
  haptics: boolean;
  locale: Locale;
}

const mq = typeof matchMedia !== 'undefined' ? matchMedia('(prefers-reduced-motion: reduce)') : null;
let prefs: Prefs = { sound: true, motion: 'system', haptics: true, locale: 'he' };
const subs = new Set<() => void>();
mq?.addEventListener?.('change', () => {
  apply();
  subs.forEach((f) => f());
});

/** IndexedDB holds only settings and offline practice data. Wrapped so private modes still work. */
export async function loadPrefs(): Promise<Prefs> {
  try {
    const stored = await get<Partial<Prefs>>('t21:prefs');
    if (stored) prefs = { ...prefs, ...stored };
  } catch {}
  apply();
  return prefs;
}

function apply() {
  document.documentElement.dataset.motion = reducedMotion() ? 'reduced' : 'full';
}

export function setPrefs(p: Partial<Prefs>) {
  prefs = { ...prefs, ...p };
  apply();
  subs.forEach((f) => f());
  set('t21:prefs', prefs).catch(() => {});
}

export const getPrefs = () => prefs;
export const usePrefs = () =>
  useSyncExternalStore(
    (f) => {
      subs.add(f);
      return () => subs.delete(f);
    },
    () => prefs,
  );

export const reducedMotion = () => prefs.motion === 'reduced' || (prefs.motion === 'system' && !!mq?.matches);

/** Local practice identity and coins for offline modes. Never sent to the server. */
export interface LocalProfile {
  name: string;
  avatar: string;
  practiceUnits: number;
  passPlayers: { name: string; avatar: string }[];
}

const defaultLocal: LocalProfile = { name: '', avatar: 'amber', practiceUnits: 4000, passPlayers: [] };
let localMem: LocalProfile = defaultLocal;

export async function loadLocal(): Promise<LocalProfile> {
  try {
    localMem = { ...defaultLocal, ...((await get<LocalProfile>('t21:local')) ?? {}) };
  } catch {}
  return localMem;
}
export function saveLocal(p: Partial<LocalProfile>) {
  localMem = { ...localMem, ...p };
  set('t21:local', localMem).catch(() => {});
  return localMem;
}
export const getLocal = () => localMem;

/** Subscribe to preference changes, including live OS reduced-motion changes. */
export const subscribePrefs = (f: () => void) => {
  subs.add(f);
  return () => {
    subs.delete(f);
  };
};
