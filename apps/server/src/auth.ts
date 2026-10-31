import type { Db, Q } from './db.ts';
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
export async function createGuest(db: Db, input: { name: string; avatar: AvatarId; locale: 'he' | 'en' }, eco: Economy) {
  const token = newToken();
  const userId = newId('u');
  await db.tx(async (q) => {
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
    await q.query('insert into sessions(token_hash, user_id) values ($1,$2)', [sha256(token), userId]);
    await q.query(`insert into grant_claims(user_id, kind, period_key) values ($1, 'welcome', 'once')`, [userId]);
    const w = await ensureWallet(q, userId, 'casual');
    await move(q, w, 'grant_welcome', eco.welcomeUnits, 0, { idemKey: `welcome:${userId}` });
  });
  return { token, userId };
}

export async function userFromToken(q: Q, token: string | undefined): Promise<SessionUser | null> {
  if (!token || token.length > 100) return null;
  const rows = await q.query<SessionUser>(
    `select u.id, u.name, u.avatar, u.locale, u.friend_code, u.card_back, u.table_theme
       from sessions s join users u on u.id = s.user_id where s.token_hash = $1`,
    [sha256(token)],
  );
  return rows[0] ?? null;
}
