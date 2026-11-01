import type { MeResponse } from '@table21/protocol';
import { useSyncExternalStore } from 'react';

export class ApiError extends Error {
  constructor(public status: number, public code: string, public data: any = null) {
    super(code);
  }
}

export async function api<T = any>(path: string, opts: { method?: string; body?: unknown; idem?: string; timeoutMs?: number } = {}): Promise<T> {
  const write = opts.body !== undefined || (opts.method && opts.method !== 'GET');
  const ctl = opts.timeoutMs ? new AbortController() : null;
  const timer = ctl ? setTimeout(() => ctl.abort(), opts.timeoutMs) : 0;
  let res: Response;
  try {
    res = await fetch(path, {
      method: opts.method ?? 'GET',
      credentials: 'same-origin',
      headers: write ? { 'content-type': 'application/json', 'x-t21': '1', ...(opts.idem ? { 'idempotency-key': opts.idem } : {}) } : {},
      body: opts.body !== undefined ? JSON.stringify(opts.body) : write ? '{}' : undefined,
      signal: ctl?.signal,
    });
  } catch {
    throw new ApiError(0, 'network'); // offline, refused, or no answer in time (a sleeping server)
  } finally {
    if (timer) clearTimeout(timer);
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new ApiError(res.status, res.status === 429 ? 'rate_limited' : (data?.error ?? 'error'), data);
  return data as T;
}

/** No answer, or the host answered for a server that is not up yet (Render returns 502/503/504 while it wakes). */
export const isUnreachable = (e: unknown) => e instanceof ApiError && (e.status === 0 || e.status === 502 || e.status === 503 || e.status === 504);

export const newIdemKey = () =>
  Array.from(crypto.getRandomValues(new Uint8Array(16)), (b) => b.toString(16).padStart(2, '0')).join('');

/**
 * A create request that survives a cold start: the same Idempotency-Key on every attempt, so the server applies it
 * once even when an earlier attempt did reach it and only the answer was lost. Retries for up to `maxMs`.
 */
export async function createWithRetry<T = any>(path: string, body: unknown, maxMs = 120_000): Promise<T> {
  const idem = newIdemKey();
  const started = Date.now();
  for (let attempt = 0; ; attempt++) {
    try {
      const out = await api<T>(path, { method: 'POST', body, idem, timeoutMs: 25_000 });
      setPending(false);
      return out;
    } catch (e) {
      if (!isUnreachable(e) || Date.now() - started > maxMs) {
        setPending(false);
        throw e;
      }
      setPending(true);
      await new Promise((r) => setTimeout(r, Math.min(1500 * (attempt + 1), 6000)));
    }
  }
}

/* Tiny global store for the signed-in user. */
export type MeState = { status: 'loading' } | { status: 'guest-needed' } | { status: 'offline' } | { status: 'ready'; me: MeResponse };
let me: MeState = { status: 'loading' };
const subs = new Set<() => void>();
export interface NetState {
  waking: boolean;
  since: number;
  pending: boolean;
  slowBoot: boolean;
}
let net: NetState = { waking: false, since: 0, pending: false, slowBoot: false };
const emit = () => {
  if (net.waking !== waking || net.since !== wakingSince || net.pending !== pending || net.slowBoot !== slowBoot) net = { waking, since: wakingSince, pending, slowBoot };
  subs.forEach((f) => f());
};

export async function refreshMe(): Promise<MeState> {
  try {
    me = { status: 'ready', me: await api<MeResponse>('/api/me', { timeoutMs: 10_000 }) };
  } catch (e) {
    me = e instanceof ApiError && e.status === 401 ? { status: 'guest-needed' } : { status: 'offline' };
  }
  emit();
  return me;
}

/**
 * A free host may be asleep (cold start takes up to about a minute). While the server is unreachable the app shows
 * the "waking up" screen, keeps offline modes available and retries; once it answers, the app continues by itself.
 */
let waking = false;
let wakingSince = 0;
let pending = false;
let slowBoot = false;
let retryNowFn: (() => void) | null = null;
export const isWaking = () => waking;
export const wakingStartedAt = () => wakingSince;
/** A create request is retrying while the server wakes (shown next to the button that started it). */
export const isPending = () => pending;
/** The very first /api/me has had no answer for a few seconds (the request is held while the host spins up). */
export const isSlowBoot = () => slowBoot;
function setPending(v: boolean) {
  if (pending === v) return;
  pending = v;
  emit();
}
export function markBootSlow() {
  setTimeout(() => {
    if (me.status === 'loading') {
      slowBoot = true;
      wakingSince ||= Date.now() - 2500;
      emit();
    }
  }, 2500);
}
export const retryNow = () => retryNowFn?.();
export function retryUntilOnline(maxMs = 150_000) {
  if (waking || me.status !== 'offline') return;
  waking = true;
  wakingSince ||= Date.now();
  emit();
  const started = Date.now();
  let timer: ReturnType<typeof setTimeout>;
  const tick = async () => {
    clearTimeout(timer);
    const r = await refreshMe();
    if (r.status !== 'offline' || Date.now() - started > maxMs) {
      waking = false;
      slowBoot = false;
      retryNowFn = null;
      if (r.status !== 'offline') wakingSince = 0;
      emit();
      if (r.status !== 'offline') void loadConfig();
      return;
    }
    timer = setTimeout(tick, 4000);
  };
  retryNowFn = () => void tick();
  timer = setTimeout(tick, 3000);
}

const subscribe = (f: () => void) => {
  subs.add(f);
  return () => subs.delete(f);
};
/** Connection state for the "server is waking up" screen and busy buttons. */
export const useNet = () => useSyncExternalStore(subscribe, () => net);

export const useMe = () =>
  useSyncExternalStore(
    (f) => {
      subs.add(f);
      return () => subs.delete(f);
    },
    () => me,
  );

export let serverConfig: { deployment: 'online' | 'lan'; leaderboardMinHands: number } = { deployment: 'online', leaderboardMinHands: 20 };
export async function loadConfig() {
  try {
    serverConfig = await api('/api/config');
  } catch {}
}
