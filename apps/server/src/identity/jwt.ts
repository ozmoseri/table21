import { createPublicKey, createVerify } from 'node:crypto';

/** A public RSA key from a provider's JWKS document. */
export interface Jwk {
  kid?: string;
  kty: string;
  alg?: string;
  use?: string;
  n?: string;
  e?: string;
}

/** Verification failure. `reason` is safe to log; it never contains the token. */
export class TokenError extends Error {
  constructor(public reason: string) {
    super(reason);
  }
}

const b64 = (s: string) => Buffer.from(s, 'base64url');

export function decodeJwt(token: string) {
  if (typeof token !== 'string' || token.length > 8192) throw new TokenError('malformed');
  const parts = token.split('.');
  if (parts.length !== 3 || parts.some((p) => !/^[A-Za-z0-9_-]*$/.test(p))) throw new TokenError('malformed');
  try {
    return {
      header: JSON.parse(b64(parts[0]).toString('utf8')) as Record<string, any>,
      payload: JSON.parse(b64(parts[1]).toString('utf8')) as Record<string, any>,
      signingInput: `${parts[0]}.${parts[1]}`,
      signature: b64(parts[2]),
    };
  } catch {
    throw new TokenError('malformed');
  }
}

export interface JwtRules {
  issuers: string[];
  audience: string;
  /** When set, the token's `nonce` claim must equal it exactly. */
  nonce?: string;
  now: number;
  skewSec?: number;
  /** Returns the provider's current keys. `refresh` asks for a refetch (unknown `kid`, key rotation). */
  keys: (refresh: boolean) => Promise<Jwk[]>;
}

/**
 * Verifies an RS256 ID token: signature against the provider's published keys, then iss, aud, exp, iat, nonce, sub.
 * Only RS256 is accepted (no `none`, no HMAC with a public key).
 */
export async function verifyIdToken(token: string, rules: JwtRules): Promise<Record<string, any>> {
  const { header, payload, signingInput, signature } = decodeJwt(token);
  if (header.alg !== 'RS256') throw new TokenError('alg');
  let jwk = (await rules.keys(false)).find((k) => k.kid === header.kid);
  if (!jwk) jwk = (await rules.keys(true)).find((k) => k.kid === header.kid);
  if (!jwk || jwk.kty !== 'RSA') throw new TokenError('kid');
  let ok = false;
  try {
    const key = createPublicKey({ key: { kty: 'RSA', n: jwk.n, e: jwk.e } as any, format: 'jwk' });
    ok = createVerify('RSA-SHA256').update(signingInput).verify(key, signature);
  } catch {
    ok = false;
  }
  if (!ok) throw new TokenError('signature');
  const skew = rules.skewSec ?? 60;
  const now = Math.floor(rules.now / 1000);
  if (!rules.issuers.includes(payload.iss)) throw new TokenError('iss');
  const aud = Array.isArray(payload.aud) ? payload.aud : [payload.aud];
  if (!aud.includes(rules.audience)) throw new TokenError('aud');
  if (typeof payload.exp !== 'number' || payload.exp + skew < now) throw new TokenError('expired');
  if (typeof payload.iat === 'number' && payload.iat - skew > now) throw new TokenError('iat');
  if (rules.nonce !== undefined && payload.nonce !== rules.nonce) throw new TokenError('nonce');
  if (typeof payload.sub !== 'string' || !payload.sub || payload.sub.length > 255) throw new TokenError('sub');
  return payload;
}

/** Caches a JWKS document. A forced refresh (unknown kid) is allowed at most once a minute. */
export function jwksSource(url: string, fetchFn: typeof fetch = fetch, now: () => number = Date.now, ttlMs = 3600_000) {
  let keys: Jwk[] = [];
  let at = 0;
  let forcedAt = -Infinity;
  let inflight: Promise<Jwk[]> | null = null;
  return async (refresh: boolean): Promise<Jwk[]> => {
    const t = now();
    if (keys.length && !refresh && t - at < ttlMs) return keys;
    if (refresh && keys.length && t - forcedAt < 60_000) return keys;
    if (refresh) forcedAt = t;
    inflight ??= (async () => {
      try {
        const res = await fetchFn(url, { signal: AbortSignal.timeout(5000) });
        if (!res.ok) throw new TokenError('jwks_unavailable');
        const body = (await res.json()) as { keys?: Jwk[] };
        keys = Array.isArray(body.keys) ? body.keys : [];
        at = now();
        return keys;
      } catch (e) {
        throw e instanceof TokenError ? e : new TokenError('jwks_unavailable');
      } finally {
        inflight = null;
      }
    })();
    return inflight;
  };
}
