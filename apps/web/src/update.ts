import { useEffect, useSyncExternalStore } from 'react';
import { PROTOCOL_VERSION } from '@table21/protocol';

/**
 * Safe app updates.
 * - A new service worker installs in the background and waits (it has no skipWaiting on install).
 * - "New version available" appears only at a safe point: in the lobby, before a bet, or after a hand (results).
 *   Never while a hand is being played, online or local.
 * - The page reloads only when the player taps "refresh". Nothing reloads by itself.
 * - If the server speaks a newer protocol, it refuses this client's game actions (`client_outdated`) without touching
 *   any coins; the client says so and offers the same refresh. An online hand survives a reload (the server holds it).
 */
declare const __T21_BUILD__: string | undefined;
export const CLIENT_BUILD: string = typeof __T21_BUILD__ === 'string' ? __T21_BUILD__ : 'dev';

/** The protocol this client speaks. Lab builds (tests only) can pretend to be an older client. */
export function clientProtocol(): number {
  if (import.meta.env.VITE_LAB === '1') {
    try {
      const v = Number(sessionStorage.getItem('t21:lab-protocol'));
      if (Number.isInteger(v) && v > 0) return v;
    } catch {}
  }
  return PROTOCOL_VERSION;
}

export interface UpdateState {
  /** A new service worker is installed and waiting for a safe point. */
  waiting: boolean;
  /** The server serves a different build than this page runs. */
  serverNewer: boolean;
  /** The server refuses this client's actions (protocol changed). */
  outdated: boolean;
  /** A hand is in progress somewhere on screen. */
  busy: boolean;
  /** "Later" was tapped: hidden until the next hand ends. */
  dismissed: boolean;
}

let state: UpdateState = { waiting: false, serverNewer: false, outdated: false, busy: false, dismissed: false };
let serverBuild: string | null = null;
const subs = new Set<() => void>();
function set(p: Partial<UpdateState>) {
  const next = { ...state, ...p };
  if (Object.keys(next).every((k) => next[k as keyof UpdateState] === state[k as keyof UpdateState])) return;
  state = next;
  subs.forEach((f) => f());
  maybeSilentSwap();
}
const subscribe = (f: () => void) => {
  subs.add(f);
  return () => subs.delete(f);
};
export const useUpdate = () => useSyncExternalStore(subscribe, () => state);
export const getUpdateState = () => state;

/** True when the "new version" message may be shown now. */
export const updateVisible = (s: UpdateState) => !s.busy && !s.dismissed && (s.waiting || s.serverNewer || s.outdated);

const busySources = new Set<string>();
export function setBusy(source: string, on: boolean) {
  if (on) busySources.add(source);
  else busySources.delete(source);
  const busy = busySources.size > 0;
  // A new hand clears "later": the offer comes back at the next safe point.
  set(busy ? { busy, dismissed: false } : { busy });
}
/** Marks a hand in progress for as long as `on` is true and the component is mounted. */
export function useHandBusy(source: string, on: boolean) {
  useEffect(() => {
    setBusy(source, on);
    return () => setBusy(source, false);
  }, [source, on]);
}

export const dismissUpdate = () => set({ dismissed: true });
export function markOutdated() {
  set({ outdated: true });
}

let reg: ServiceWorkerRegistration | null = null;
let applying = false;

/** The page already runs the server's build: a waiting worker can take over quietly, no reload, between hands. */
function maybeSilentSwap() {
  if (!reg?.waiting || state.busy || applying || !serverBuild || serverBuild !== CLIENT_BUILD) return;
  reg.waiting.postMessage({ type: 'SKIP_WAITING' });
}

export function noteServer(cfg: { build?: string | null; protocol?: number } | null) {
  if (!cfg) return;
  serverBuild = cfg.build ?? null;
  const patch: Partial<UpdateState> = {};
  if (serverBuild && CLIENT_BUILD !== 'dev' && serverBuild !== CLIENT_BUILD) patch.serverNewer = true;
  if (typeof cfg.protocol === 'number' && cfg.protocol !== clientProtocol()) patch.outdated = true;
  set(patch);
  if (patch.serverNewer) void reg?.update().catch(() => {});
  maybeSilentSwap();
}

export async function checkForUpdate() {
  try {
    const r = await fetch('/api/config', { cache: 'no-store' });
    if (r.ok) noteServer(await r.json());
  } catch {}
  try {
    await reg?.update();
  } catch {}
}

export async function initUpdates() {
  if (!('serviceWorker' in navigator) || !isSecureContext || !import.meta.env.PROD) return;
  try {
    reg = await navigator.serviceWorker.register('/sw.js');
  } catch {
    return;
  }
  if (!reg) return; // no registration (service workers blocked or unavailable): no update flow
  const watch = (w: ServiceWorker | null) => {
    if (!w) return;
    const on = () => {
      // "installed" with a controller = an update waiting (the very first install has no controller and just activates).
      if (w.state === 'installed' && navigator.serviceWorker.controller) set({ waiting: true });
    };
    w.addEventListener('statechange', on);
    on();
  };
  if (reg.waiting && navigator.serviceWorker.controller) set({ waiting: true });
  watch(reg.installing);
  reg.addEventListener('updatefound', () => watch(reg?.installing ?? null));
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (applying) location.reload(); // only after the player tapped "refresh"
    else set({ waiting: !!reg?.waiting });
  });
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') void checkForUpdate();
  });
  setInterval(() => void checkForUpdate(), 15 * 60_000);
  maybeSilentSwap();
}

/** Player tapped "refresh": let the waiting worker take over, then reload into the new version. */
export async function applyUpdate() {
  if (applying) return;
  applying = true;
  if (state.outdated) {
    try {
      sessionStorage.removeItem('t21:lab-protocol');
    } catch {}
  }
  const waitInstalled = async () => {
    const w = reg?.installing;
    if (!w) return;
    await new Promise<void>((res) => {
      const done = () => (w.state === 'installed' || w.state === 'redundant' ? res() : undefined);
      w.addEventListener('statechange', done);
      setTimeout(res, 8000);
    });
  };
  await waitInstalled();
  if (reg?.waiting) {
    reg.waiting.postMessage({ type: 'SKIP_WAITING' });
    setTimeout(() => location.reload(), 4000); // in case controllerchange never fires
  } else location.reload();
}
