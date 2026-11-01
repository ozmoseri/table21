import type { AuthProviderId, ProviderStatus } from '@table21/protocol';
import { api, ApiError } from './api.ts';

/**
 * Browser side of provider sign-in. A provider button is only offered when the server reports it as "ready"
 * (configured) and the page is a secure context. Nothing here simulates a successful login: the server verifies
 * every token. The test provider exists only in VITE_LAB builds used by automated tests.
 */

export async function loadProviders(): Promise<ProviderStatus[]> {
  try {
    return (await api<{ providers: ProviderStatus[] }>('/api/auth/providers')).providers.filter((p) => p.id !== 'test' || import.meta.env.VITE_LAB === '1');
  } catch {
    return [];
  }
}

export const usable = (p: ProviderStatus) => p.state === 'ready' && (!p.needsHttps || window.isSecureContext);

export async function newNonce(): Promise<string> {
  return (await api<{ nonce: string }>('/api/auth/nonce', { method: 'POST' })).nonce;
}

const scripts = new Map<string, Promise<void>>();
function loadScript(src: string): Promise<void> {
  if (!scripts.has(src))
    scripts.set(
      src,
      new Promise((res, rej) => {
        const s = document.createElement('script');
        s.src = src;
        s.async = true;
        s.onload = () => res();
        s.onerror = () => (scripts.delete(src), rej(new Error('script')));
        document.head.appendChild(s);
      }),
    );
  return scripts.get(src)!;
}

/** Renders Google's own button (Google Identity Services). The ID token arrives in `onCredential` with our nonce inside. */
export async function mountGoogleButton(el: HTMLElement, clientId: string, nonce: string, locale: string, onCredential: (jwt: string) => void) {
  await loadScript('https://accounts.google.com/gsi/client');
  const g = (window as any).google?.accounts?.id;
  if (!g) throw new Error('gsi');
  g.initialize({ client_id: clientId, nonce, ux_mode: 'popup', auto_select: false, itp_support: true, callback: (r: { credential: string }) => onCredential(r.credential) });
  g.renderButton(el, { type: 'standard', theme: 'outline', size: 'large', text: 'continue_with', shape: 'pill', locale });
}

/** Facebook Login for the Web (JS SDK). Only `public_profile` is requested; the server checks the token with debug_token. */
export async function facebookAccessToken(appId: string, graphVersion: string): Promise<string> {
  await loadScript('https://connect.facebook.net/en_US/sdk.js');
  const FB = (window as any).FB;
  if (!FB) throw new Error('fb');
  FB.init({ appId, version: graphVersion, cookie: false, xfbml: false, status: false });
  return new Promise((res, rej) => FB.login((r: any) => (r?.authResponse?.accessToken ? res(r.authResponse.accessToken) : rej(new Error('cancelled'))), { scope: 'public_profile' }));
}

/** Test builds only: a credential the server accepts when T21_TEST_AUTH=1 (refused in production and LAN). */
export const testCredential = (sub: string, nonce: string) => btoa(JSON.stringify({ sub, nonce })).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

export type AuthOutcome =
  | { kind: 'done'; status: string }
  | { kind: 'confirm_switch'; guest: { name: string; availableUnits: number } }
  | { kind: 'no_account' }
  | { kind: 'identity_in_use' }
  | { kind: 'error'; code: string };

/** Posts to an auth endpoint and turns HTTP answers into outcomes the screens can show. */
export async function authCall(path: string, body: Record<string, unknown>): Promise<AuthOutcome> {
  try {
    const r = await api<{ status: string }>(path, { method: 'POST', body });
    if (r.status === 'no_account') return { kind: 'no_account' };
    return { kind: 'done', status: r.status };
  } catch (e) {
    if (e instanceof ApiError && e.code === 'confirm_switch') return { kind: 'confirm_switch', guest: (e as any).data?.guest ?? { name: '', availableUnits: 0 } };
    if (e instanceof ApiError && e.code === 'identity_in_use') return { kind: 'identity_in_use' };
    return { kind: 'error', code: e instanceof ApiError ? e.code : 'error' };
  }
}

export function providerName(id: AuthProviderId) {
  return id === 'google' ? 'Google' : id === 'facebook' ? 'Facebook' : id === 'apple' ? 'Apple' : 'Test';
}

/** After any account change the page reloads, so sockets and cached state start clean for the new account. */
export function reloadHome() {
  location.hash = '#/';
  location.reload();
}
