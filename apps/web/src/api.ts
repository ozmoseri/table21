import type { MeResponse } from '@table21/protocol';
import { useSyncExternalStore } from 'react';

export class ApiError extends Error {
  constructor(public status: number, public code: string, public data: any = null) {
    super(code);
  }
}

export async function api<T = any>(path: string, opts: { method?: string; body?: unknown } = {}): Promise<T> {
  const res = await fetch(path, {
    method: opts.method ?? 'GET',
    credentials: 'same-origin',
    headers: opts.body !== undefined || (opts.method && opts.method !== 'GET') ? { 'content-type': 'application/json', 'x-t21': '1' } : {},
    body: opts.body !== undefined ? JSON.stringify(opts.body) : opts.method && opts.method !== 'GET' ? '{}' : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new ApiError(res.status, res.status === 429 ? 'rate_limited' : (data?.error ?? 'error'), data);
  return data as T;
}

/* Tiny global store for the signed-in user. */
export type MeState = { status: 'loading' } | { status: 'guest-needed' } | { status: 'offline' } | { status: 'ready'; me: MeResponse };
let me: MeState = { status: 'loading' };
const subs = new Set<() => void>();
const emit = () => subs.forEach((f) => f());

export async function refreshMe(): Promise<MeState> {
  try {
    me = { status: 'ready', me: await api<MeResponse>('/api/me') };
  } catch (e) {
    me = e instanceof ApiError && e.status === 401 ? { status: 'guest-needed' } : { status: 'offline' };
  }
  emit();
  return me;
}

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
