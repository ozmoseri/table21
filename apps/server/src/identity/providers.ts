import { createHmac } from 'node:crypto';
import { TokenError, jwksSource, verifyIdToken, type Jwk } from './jwt.ts';

export const PROVIDERS = ['google', 'facebook', 'apple', 'test'] as const;
export type ProviderId = (typeof PROVIDERS)[number];

export interface VerifiedIdentity {
  provider: ProviderId;
  subject: string;
  email: string | null;
  emailVerified: boolean;
}

/**
 * ready: configured on this server, the client may show the provider's button.
 * not_configured: the code exists but the owner has not supplied the provider settings. The UI shows it as unavailable.
 * planned: not built yet on any server.
 */
export interface ProviderStatus {
  id: ProviderId;
  state: 'ready' | 'not_configured' | 'planned';
  /** Public values the browser needs (never secrets). */
  publicConfig?: Record<string, string>;
  /** Environment variable names still missing (names only, never values). */
  missing?: string[];
  /** Needs a secure (HTTPS) page in the browser. */
  needsHttps?: boolean;
}

export interface ProviderConfig {
  google?: { clientId: string; keys?: (refresh: boolean) => Promise<Jwk[]> };
  facebook?: { appId: string; appSecret: string; graphVersion?: string; fetch?: typeof fetch };
  /** Automated tests only. Refused in production and LAN mode (see assertSafeAuthConfig). */
  test?: boolean;
}

export const GOOGLE_ISSUERS = ['accounts.google.com', 'https://accounts.google.com'];
export const GOOGLE_JWKS_URL = 'https://www.googleapis.com/oauth2/v3/certs';
export const FACEBOOK_GRAPH_DEFAULT = 'v26.0';

/** Reads provider settings from the environment. Missing values leave the provider "not configured". */
export function providerConfigFromEnv(env: NodeJS.ProcessEnv): ProviderConfig {
  const cfg: ProviderConfig = {};
  if (env.T21_GOOGLE_CLIENT_ID) cfg.google = { clientId: env.T21_GOOGLE_CLIENT_ID.trim() };
  if (env.T21_FACEBOOK_APP_ID && env.T21_FACEBOOK_APP_SECRET)
    cfg.facebook = { appId: env.T21_FACEBOOK_APP_ID.trim(), appSecret: env.T21_FACEBOOK_APP_SECRET, graphVersion: env.T21_FACEBOOK_GRAPH_VERSION?.trim() || undefined };
  if (env.T21_TEST_AUTH === '1') cfg.test = true;
  return cfg;
}

/** The test provider can sign anyone in. Startup must fail if it is switched on outside automated tests. */
export function assertSafeAuthConfig(env: NodeJS.ProcessEnv, deployment: 'online' | 'lan') {
  if (env.T21_TEST_AUTH !== '1') return;
  if (env.NODE_ENV === 'production' || deployment === 'lan' || env.T21_PUBLIC_ORIGIN)
    throw new Error('T21_TEST_AUTH=1 is for automated tests only and cannot be used with NODE_ENV=production, LAN mode or a public origin.');
}

export class Providers {
  private googleKeys?: (refresh: boolean) => Promise<Jwk[]>;
  constructor(private cfg: ProviderConfig, private now: () => number = Date.now) {
    if (cfg.google) this.googleKeys = cfg.google.keys ?? jwksSource(GOOGLE_JWKS_URL);
  }

  status(): ProviderStatus[] {
    const out: ProviderStatus[] = [
      this.cfg.google
        ? { id: 'google', state: 'ready', publicConfig: { clientId: this.cfg.google.clientId }, needsHttps: true }
        : { id: 'google', state: 'not_configured', missing: ['T21_GOOGLE_CLIENT_ID'], needsHttps: true },
      this.cfg.facebook
        ? { id: 'facebook', state: 'ready', publicConfig: { appId: this.cfg.facebook.appId, graphVersion: this.graphVersion }, needsHttps: true }
        : { id: 'facebook', state: 'not_configured', missing: ['T21_FACEBOOK_APP_ID', 'T21_FACEBOOK_APP_SECRET'], needsHttps: true },
      { id: 'apple', state: 'planned' },
    ];
    if (this.cfg.test) out.push({ id: 'test', state: 'ready' });
    return out;
  }

  isReady(p: string): p is ProviderId {
    return this.status().some((s) => s.id === p && s.state === 'ready');
  }

  /** Whether the provider binds its token to our nonce (replay protection). */
  usesNonce(p: ProviderId) {
    return p === 'google' || p === 'test';
  }

  private get graphVersion() {
    return this.cfg.facebook?.graphVersion ?? FACEBOOK_GRAPH_DEFAULT;
  }

  async verify(provider: ProviderId, credential: string, nonce: string | null): Promise<VerifiedIdentity> {
    if (!this.isReady(provider)) throw new TokenError('provider_not_configured');
    if (typeof credential !== 'string' || !credential || credential.length > 8192) throw new TokenError('malformed');
    if (provider === 'google') {
      if (!nonce) throw new TokenError('nonce');
      const p = await verifyIdToken(credential, { issuers: GOOGLE_ISSUERS, audience: this.cfg.google!.clientId, nonce, now: this.now(), keys: this.googleKeys! });
      return { provider, subject: p.sub, email: typeof p.email === 'string' ? p.email : null, emailVerified: p.email_verified === true || p.email_verified === 'true' };
    }
    if (provider === 'facebook') return this.verifyFacebook(credential);
    if (provider === 'test') {
      let p: any;
      try {
        p = JSON.parse(Buffer.from(credential, 'base64url').toString('utf8'));
      } catch {
        throw new TokenError('malformed');
      }
      if (!nonce || p?.nonce !== nonce) throw new TokenError('nonce');
      if (typeof p.sub !== 'string' || !/^[\w.-]{1,64}$/.test(p.sub)) throw new TokenError('sub');
      return { provider, subject: p.sub, email: typeof p.email === 'string' ? p.email.slice(0, 200) : null, emailVerified: false };
    }
    throw new TokenError('provider_not_configured');
  }

  /**
   * Facebook Login for the Web returns a user access token. The server asks Graph API `debug_token` (with the app
   * access token, server side only) whether it is valid and issued for our app, and takes the app-scoped user id.
   */
  private async verifyFacebook(userToken: string): Promise<VerifiedIdentity> {
    const fb = this.cfg.facebook!;
    const f = fb.fetch ?? fetch;
    const url = new URL(`https://graph.facebook.com/${this.graphVersion}/debug_token`);
    url.searchParams.set('input_token', userToken);
    url.searchParams.set('access_token', `${fb.appId}|${fb.appSecret}`);
    let body: any;
    try {
      const res = await f(url, { signal: AbortSignal.timeout(5000) });
      body = await res.json();
      if (!res.ok) throw new TokenError('invalid');
    } catch (e) {
      throw e instanceof TokenError ? e : new TokenError('provider_unavailable');
    }
    const d = body?.data;
    if (!d || d.is_valid !== true) throw new TokenError('invalid');
    if (String(d.app_id) !== fb.appId) throw new TokenError('aud');
    if (d.type && d.type !== 'USER') throw new TokenError('invalid');
    if (typeof d.expires_at === 'number' && d.expires_at !== 0 && d.expires_at * 1000 < this.now()) throw new TokenError('expired');
    const uid = String(d.user_id ?? '');
    if (!/^\d{1,40}$/.test(uid)) throw new TokenError('sub');
    return { provider: 'facebook', subject: uid, email: null, emailVerified: false };
  }
}

/** appsecret_proof for Graph calls made with a user token (kept for future Graph reads such as friends who use the app). */
export const appSecretProof = (appSecret: string, token: string) => createHmac('sha256', appSecret).update(token).digest('hex');
