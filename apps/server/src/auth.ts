import type { Db, Q } from './db.ts';
import { idemReplay, idemSave, withIdem, type Idem } from './idempotency.ts';
import { ensureWallet, move } from './wallet.ts';
import { newCode, newId, newToken, sha256 } from './util.ts';
import type { AvatarId } from '@table21/protocol';

export const SESSION_COOKIE = 't21s';

export interface SessionUser {
  id: string;
  name: string;
  avatar: AvatarId;
  locale: 'he' | 'en';
  friend_code: string;
  card_back: string;
  table_theme: string;
  /** Public id of the session this request was authenticated with. */
  session_id: string;
}

export const SESSION_DAYS = 400;

/** Short device label for the sessions list. The full user agent is never stored. */
export function deviceLabel(ua: string | undefined): string {
  const s = ua ?? '';
  const device = /iPhone/.test(s) ? 'iPhone' : /iPad/.test(s) ? 'iPad' : /Android/.test(s) ? 'Android' : /Windows/.test(s) ? 'Windows' : /Mac OS X|Macintosh/.test(s) ? 'Mac' : /Linux/.test(s) ? 'Linux' : '';
  const browser = /Edg\//.test(s) ? 'Edge' : /SamsungBrowser/.test(s) ? 'Samsung Internet' : /Firefox\//.test(s) ? 'Firefox' : /Chrome\//.test(s) ? 'Chrome' : /Safari\//.test(s) ? 'Safari' : '';
  return [device, browser].filter(Boolean).join(' · ').slice(0, 40);
}

/** Issues a new session. Returns the raw token (only ever placed in the httpOnly cookie) and the public session id. */
export async function issueSession(q: Q, userId: string, opts: { label?: string; rotatedFrom?: string | null; now?: number } = {}) {
  const token = newToken();
  const id = newId('s');
  const now = opts.now ?? Date.now();
  await q.query(
    'insert into sessions(token_hash, user_id, id, expires_at, label, rotated_from, created_at, last_seen_at) values ($1,$2,$3,$4,$5,$6,$7,$7)',
    [sha256(token), userId, id, new Date(now + SESSION_DAYS * 86400_000), opts.label ?? '', opts.rotatedFrom ?? null, new Date(now)],
  );
  return { token, id };
}

export async function revokeSessions(q: Q, where: { sessionId?: string; userId?: string; exceptId?: string }, reason: string): Promise<string[]> {
  const rows = await q.query<{ id: string }>(
    `update sessions set revoked_at = now(), revoke_reason = $4
      where revoked_at is null and ($1::text is null or id = $1) and ($2::text is null or user_id = $2) and ($3::text is null or id <> $3)
      returning id`,
    [where.sessionId ?? null, where.userId ?? null, where.exceptId ?? null, reason],
  );
  return rows.map((r) => r.id);
}

export async function authEvent(q: Q, userId: string | null, kind: string, detail = '') {
  await q.query('insert into auth_events(user_id, kind, detail) values ($1,$2,$3)', [userId, kind, detail.slice(0, 200)]);
}

export interface Economy {
  welcomeUnits: number;
  dailyUnits: number;
  rescueUnits: number;
  rescueCooldownMs: number;
  minStakeUnits: number;
}

export const DEFAULT_ECONOMY: Economy = {
  welcomeUnits: 4000, // 2,000 coins
  dailyUnits: 600, // 300 coins
  rescueUnits: 1000, // 500 coins
  rescueCooldownMs: 6 * 3600_000,
  minStakeUnits: 20, // 10 coins
};

/** Creates a server-side guest identity with a one-time welcome grant. Returns the raw token for the cookie. */
export async function createGuest(db: Db, input: { name: string; avatar: AvatarId; locale: 'he' | 'en' }, eco: Economy, label = '', idem?: Idem) {
  const userId = newId('u');
  return withIdem(db, idem, async (q) => {
    // A retry of the same creation (cold start, lost response): same account, a fresh session for this device.
    const prior = await idemReplay<{ userId: string }>(q, idem);
    if (prior) {
      const session = await issueSession(q, prior.response.userId, { label });
      return { token: session.token, sessionId: session.id, userId: prior.response.userId, replayed: true };
    }
    let code = newCode(7);
    for (let i = 0; i < 5; i++) {
      const hit = await q.query('select 1 from users where friend_code = $1', [code]);
      if (!hit.length) break;
      code = newCode(7);
    }
    await q.query('insert into users(id, name, avatar, friend_code, locale) values ($1,$2,$3,$4,$5)', [
      userId,
      input.name,
      input.avatar,
      code,
      input.locale,
    ]);
    const session = await issueSession(q, userId, { label });
    await q.query(`insert into grant_claims(user_id, kind, period_key) values ($1, 'welcome', 'once')`, [userId]);
    const w = await ensureWallet(q, userId, 'casual');
    await move(q, w, 'grant_welcome', eco.welcomeUnits, 0, { idemKey: `welcome:${userId}` });
    await authEvent(q, userId, 'guest_created');
    await idemSave(q, idem, { userId }, userId);
    return { token: session.token, sessionId: session.id, userId, replayed: false };
  });
}

export async function userFromToken(q: Q, token: string | undefined): Promise<SessionUser | null> {
  if (!token || token.length > 100) return null;
  const rows = await q.query<SessionUser>(
    `select u.id, u.name, u.avatar, u.locale, u.friend_code, u.card_back, u.table_theme, s.id as session_id
       from sessions s join users u on u.id = s.user_id
      where s.token_hash = $1 and s.revoked_at is null and s.expires_at > now() and u.deleted_at is null`,
    [sha256(token)],
  );
  return rows[0] ?? null;
}
