import { createSign, generateKeyPairSync, randomUUID } from 'node:crypto';
import { buildApp, type AppOptions } from '../../apps/server/src/app.ts';
import type { Db } from '../../apps/server/src/db.ts';
import type { Jwk } from '../../apps/server/src/identity/jwt.ts';

/** A browser stand-in: keeps its own cookie jar against an in-process app (Fastify inject). */
export class Device {
  cookies = new Map<string, string>();
  constructor(public app: Awaited<ReturnType<typeof buildApp>>['app'], public ua = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) Safari/605.1') {}
  async req(method: string, url: string, body?: unknown) {
    const res = await this.app.inject({
      method: method as any,
      url,
      headers: {
        'x-t21': '1',
        'user-agent': this.ua,
        ...(this.cookies.size ? { cookie: [...this.cookies].map(([k, v]) => `${k}=${v}`).join('; ') } : {}),
        ...(body !== undefined ? { 'content-type': 'application/json' } : {}),
      },
      payload: body !== undefined ? JSON.stringify(body) : method === 'GET' ? undefined : '{}',
    });
    for (const c of res.cookies as { name: string; value: string; maxAge?: number; expires?: Date }[]) {
      const cleared = c.value === '' || c.maxAge === 0 || (c.expires && c.expires.getTime() < Date.now());
      if (cleared) this.cookies.delete(c.name);
      else this.cookies.set(c.name, c.value);
    }
    let json: any = null;
    try {
      json = res.json();
    } catch {}
    return { status: res.statusCode, body: json };
  }
  get = (url: string) => this.req('GET', url);
  post = (url: string, body?: unknown) => this.req('POST', url, body ?? {});
  async guest(name: string) {
    const r = await this.post('/api/session', { name, avatar: 'amber', locale: 'he' });
    if (r.status !== 200) throw new Error(`guest failed ${r.status}`);
    return (await this.get('/api/me')).body;
  }
  /** The raw session cookie (to prove an old token stopped working). */
  get token() {
    return this.cookies.get('t21s');
  }
}

/** A local RSA key that plays Google's role in tests. Tokens are signed exactly like real ID tokens (RS256 JWT). */
export function fakeGoogle(clientId = 'test-client.apps.googleusercontent.com') {
  const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
  const kid = randomUUID();
  const jwk = { ...(publicKey.export({ format: 'jwk' }) as Jwk), kid, alg: 'RS256', use: 'sig' };
  const other = generateKeyPairSync('rsa', { modulusLength: 2048 });
  const sign = (claims: Record<string, unknown>, opts: { key?: 'good' | 'other'; kid?: string; alg?: string } = {}) => {
    const header = Buffer.from(JSON.stringify({ alg: opts.alg ?? 'RS256', kid: opts.kid ?? kid, typ: 'JWT' })).toString('base64url');
    const now = Math.floor(Date.now() / 1000);
    const payload = Buffer.from(
      JSON.stringify({ iss: 'https://accounts.google.com', aud: clientId, iat: now, exp: now + 3600, email_verified: true, ...claims }),
    ).toString('base64url');
    const sig = createSign('RSA-SHA256').update(`${header}.${payload}`).sign(opts.key === 'other' ? other.privateKey : privateKey);
    return `${header}.${payload}.${sig.toString('base64url')}`;
  };
  return { clientId, keys: async () => [jwk], sign };
}

export const testCredential = (sub: string, nonce: string, email?: string) => Buffer.from(JSON.stringify({ sub, nonce, email })).toString('base64url');

export async function makeApp(db: Db, extra: Partial<AppOptions> = {}) {
  const google = fakeGoogle();
  const fbCalls: string[] = [];
  const fbTokens = new Map<string, { app_id: string; user_id: string; is_valid: boolean; expires_at: number }>();
  const fbFetch = (async (url: URL | string) => {
    const u = new URL(String(url));
    fbCalls.push(u.pathname);
    const d = fbTokens.get(u.searchParams.get('input_token') ?? '');
    return new Response(JSON.stringify({ data: d ? { ...d, type: 'USER' } : { is_valid: false } }), { status: 200 });
  }) as typeof fetch;
  const server = await buildApp({
    db,
    providers: {
      google: { clientId: google.clientId, keys: google.keys },
      facebook: { appId: '1234567890', appSecret: 'test-secret-not-real', fetch: fbFetch },
      test: true,
    },
    sessionRateLimit: 1000,
    ...extra,
  });
  return { server, google, fbTokens, fbCalls, device: (ua?: string) => new Device(server.app, ua) };
}
