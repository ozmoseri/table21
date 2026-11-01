import type { Db } from './db.ts';
import type { Economy, SessionUser } from './auth.ts';
import { ensureWallet, lockWallet, move } from './wallet.ts';
import { blockedEither } from './friends.ts';
import { jerusalemDate, jerusalemWeekStart, newCode, newId, nextJerusalemMidnight } from './util.ts';
import type { LeaderboardRow, MeResponse, StatsResponse } from '@table21/protocol';

export const UNLOCKS: StatsResponse['unlocks'] = [
  { id: 'classic', kind: 'card_back', requirement: 0, unlocked: false },
  { id: 'brass', kind: 'card_back', requirement: 25, unlocked: false },
  { id: 'midnight', kind: 'card_back', requirement: 100, unlocked: false },
  { id: 'emerald', kind: 'table_theme', requirement: 0, unlocked: false },
  { id: 'sapphire', kind: 'table_theme', requirement: 50, unlocked: false },
  { id: 'bordeaux', kind: 'table_theme', requirement: 150, unlocked: false },
];

export const levelFor = (hands: number) => {
  // Level n needs 10 * n * (n - 1) / 2 hands: 0, 10, 30, 60, 100, ...
  let level = 1;
  while ((10 * level * (level + 1)) / 2 <= hands) level++;
  return { level, nextLevelAt: (10 * level * (level + 1)) / 2 };
};

export class Social {
  constructor(private db: Db, private eco: Economy, private now: () => number = Date.now) {}

  async me(user: SessionUser): Promise<Omit<MeResponse, 'account' | 'crossDeviceRecovery'>> {
    const w = (await this.db.query('select available_units, reserved_units from wallets where user_id = $1 and scope = $2', [user.id, 'casual']))[0];
    const g = await this.grantStatus(user.id, w?.available_units ?? 0);
    const active = (
      await this.db.query(`select r.id, r.code from seats s join rooms r on r.id = s.room_id where s.user_id = $1 and r.status = 'open'`, [user.id])
    )[0];
    return {
      userId: user.id,
      name: user.name,
      avatar: user.avatar,
      friendCode: user.friend_code,
      locale: user.locale,
      cardBack: user.card_back,
      tableTheme: user.table_theme,
      wallet: { availableUnits: w?.available_units ?? 0, reservedUnits: w?.reserved_units ?? 0 },
      grants: g,
      activeRoom: active ? { roomId: active.id, code: active.code } : null,
    };
  }

  private async grantStatus(userId: string, available: number) {
    const now = this.now();
    const today = jerusalemDate(now);
    const daily = await this.db.query(`select 1 from grant_claims where user_id = $1 and kind = 'daily' and period_key = $2`, [userId, today]);
    const lastRescue = (await this.db.query(`select max(claimed_at) as t from grant_claims where user_id = $1 and kind = 'rescue'`, [userId]))[0]?.t;
    const rescueAt = lastRescue ? new Date(lastRescue).getTime() + this.eco.rescueCooldownMs : 0;
    return {
      dailyAvailable: daily.length === 0,
      nextDailyAt: daily.length ? new Date(nextJerusalemMidnight(now)).toISOString() : null,
      rescueAvailable: available < this.eco.minStakeUnits && rescueAt <= now,
      nextRescueAt: rescueAt > now ? new Date(rescueAt).toISOString() : null,
    };
  }

  /** Daily grant: one per Asia/Jerusalem calendar date, enforced by a primary key. */
  async claimDaily(user: SessionUser): Promise<{ ok: boolean; reason?: string }> {
    const day = jerusalemDate(this.now());
    return this.db.tx(async (q) => {
      const w = await ensureWallet(q, user.id, 'casual');
      const ins = await q.query(
        `insert into grant_claims(user_id, kind, period_key) values ($1,'daily',$2) on conflict do nothing returning user_id`,
        [user.id, day],
      );
      if (!ins.length) return { ok: false, reason: 'already_claimed' };
      await move(q, w, 'grant_daily', this.eco.dailyUnits, 0, { idemKey: `daily:${user.id}:${day}` });
      return { ok: true };
    });
  }

  /** Rescue refill: only below the minimum stake, at most once per cooldown, serialized by the wallet lock. */
  async claimRescue(user: SessionUser): Promise<{ ok: boolean; reason?: string }> {
    const now = this.now();
    return this.db.tx(async (q) => {
      const w = await lockWallet(q, user.id, 'casual');
      if (w.available_units >= this.eco.minStakeUnits) return { ok: false, reason: 'balance_not_low' };
      const last = (await q.query(`select max(claimed_at) as t from grant_claims where user_id = $1 and kind = 'rescue'`, [user.id]))[0]?.t;
      if (last && new Date(last).getTime() + this.eco.rescueCooldownMs > now) return { ok: false, reason: 'cooldown' };
      const key = new Date(now).toISOString();
      await q.query(`insert into grant_claims(user_id, kind, period_key, claimed_at) values ($1,'rescue',$2,$3)`, [user.id, key, new Date(now)]);
      await move(q, w, 'grant_rescue', this.eco.rescueUnits, 0, { idemKey: `rescue:${user.id}:${key}` });
      return { ok: true };
    });
  }

  async stats(userId: string): Promise<StatsResponse> {
    const r = (
      await this.db.query(
        `select count(*)::int as hands,
                count(*) filter (where outcome in ('win','blackjack'))::int as wins,
                count(*) filter (where outcome = 'lose')::int as losses,
                count(*) filter (where outcome = 'push')::int as pushes,
                count(*) filter (where is_natural)::int as naturals,
                coalesce(sum(net_units), 0)::bigint as net
           from hand_results where user_id = $1`,
        [userId],
      )
    )[0];
    const { level, nextLevelAt } = levelFor(r.hands);
    return {
      hands: r.hands,
      wins: r.wins,
      losses: r.losses,
      pushes: r.pushes,
      naturals: r.naturals,
      netUnits: Number(r.net),
      level,
      nextLevelAt,
      unlocks: UNLOCKS.map((u) => ({ ...u, unlocked: r.hands >= u.requirement })),
    };
  }

  async history(userId: string, limit = 30) {
    return this.db.query(
      `select h.round_id as "roundId", h.hand_index as "hand", h.stake_units as "stakeUnits", h.return_units as "returnUnits",
              h.net_units as "netUnits", h.outcome, h.is_natural as "natural", h.mode, h.created_at as "at", r.code as "roomCode"
         from hand_results h join rooms r on r.id = h.room_id
        where h.user_id = $1 order by h.created_at desc, h.hand_index limit $2`,
      [userId, Math.min(100, Math.max(1, limit))],
    );
  }

  async updateProfile(user: SessionUser, patch: { name?: string; avatar?: string; locale?: string; cardBack?: string; tableTheme?: string }) {
    const stats = await this.stats(user.id);
    const ok = (kind: string, id: string) => stats.unlocks.some((u) => u.kind === kind && u.id === id && u.unlocked);
    if (patch.cardBack && !ok('card_back', patch.cardBack)) throw new Error('locked');
    if (patch.tableTheme && !ok('table_theme', patch.tableTheme)) throw new Error('locked');
    await this.db.query(
      `update users set name = coalesce($2, name), avatar = coalesce($3, avatar), locale = coalesce($4, locale),
              card_back = coalesce($5, card_back), table_theme = coalesce($6, table_theme) where id = $1`,
      [user.id, patch.name ?? null, patch.avatar ?? null, patch.locale ?? null, patch.cardBack ?? null, patch.tableTheme ?? null],
    );
  }

  /* -------------------------------- groups --------------------------------- */

  async createGroup(user: SessionUser, name: string) {
    const id = newId('g');
    const code = newCode(6);
    await this.db.tx(async (q) => {
      await q.query('insert into groups(id, name, code, owner_id) values ($1,$2,$3,$4)', [id, name, code, user.id]);
      await q.query('insert into group_members(group_id, user_id) values ($1,$2)', [id, user.id]);
    });
    return { id, code };
  }

  async joinGroup(user: SessionUser, code: string) {
    const g = (await this.db.query('select id from groups where code = $1', [code]))[0];
    if (!g) return null;
    await this.db.query('insert into group_members(group_id, user_id) values ($1,$2) on conflict do nothing', [g.id, user.id]);
    return { id: g.id as string };
  }

  async groups(user: SessionUser, online: (userId: string) => boolean) {
    const gs = await this.db.query(
      `select g.id, g.name, g.code, g.owner_id from groups g join group_members m on m.group_id = g.id where m.user_id = $1 order by g.created_at`,
      [user.id],
    );
    const out = [];
    for (const g of gs) {
      const members = await this.db.query(
        `select u.id as "userId", u.name, u.avatar from group_members m join users u on u.id = m.user_id where m.group_id = $1 order by m.joined_at`,
        [g.id],
      );
      out.push({ id: g.id, name: g.name, code: g.code, isOwner: g.owner_id === user.id, members: members.map((m) => ({ ...m, online: online(m.userId) })) });
    }
    return out;
  }

  async addFriend(user: SessionUser, friendCode: string) {
    const f = (await this.db.query('select id from users where friend_code = $1 and deleted_at is null', [friendCode]))[0];
    if (!f || f.id === user.id) return false;
    if (await blockedEither(this.db, user.id, f.id)) return false;
    const [a, b] = [user.id, f.id].sort();
    await this.db.query('insert into friendships(user_a, user_b) values ($1,$2) on conflict do nothing', [a, b]);
    return true;
  }

  async friends(user: SessionUser, online: (userId: string) => boolean) {
    const rows = await this.db.query(
      `select u.id as "userId", u.name, u.avatar from friendships f
         join users u on u.id = case when f.user_a = $1 then f.user_b else f.user_a end
        where f.user_a = $1 or f.user_b = $1 order by u.name`,
      [user.id],
    );
    return rows.map((r) => ({ ...r, online: online(r.userId) }));
  }

  /**
   * Leaderboards. Access-controlled: only members of the group can read it.
   * weekly: settled casual online hand profit/loss since Monday 00:00 Asia/Jerusalem. Grants are excluded by construction.
   * balance: casual wallet comparison (not a skill rating).
   */
  async leaderboard(user: SessionUser, groupId: string, kind: 'weekly' | 'balance', minHands: number) {
    const member = await this.db.query('select 1 from group_members where group_id = $1 and user_id = $2', [groupId, user.id]);
    if (!member.length) return null;
    const since = jerusalemWeekStart(this.now());
    let rows: LeaderboardRow[];
    if (kind === 'weekly') {
      const r = await this.db.query(
        `select u.id as "userId", u.name, u.avatar,
                coalesce(sum(h.net_units), 0)::bigint as value, count(h.id)::int as hands
           from group_members m join users u on u.id = m.user_id
           left join hand_results h on h.user_id = m.user_id and h.mode = 'casual' and h.rules_version = 'std-v1' and h.created_at >= $2
          where m.group_id = $1 group by u.id, u.name, u.avatar`,
        [groupId, new Date(since)],
      );
      rows = r.map((x) => ({ ...(x as any), value: Number(x.value), eligible: x.hands >= minHands, rank: null }));
    } else {
      const r = await this.db.query(
        `select u.id as "userId", u.name, u.avatar, coalesce(w.available_units + w.reserved_units, 0)::bigint as value,
                (select count(*)::int from hand_results h where h.user_id = u.id) as hands
           from group_members m join users u on u.id = m.user_id
           left join wallets w on w.user_id = u.id and w.scope = 'casual'
          where m.group_id = $1`,
        [groupId],
      );
      rows = r.map((x) => ({ ...(x as any), value: Number(x.value), eligible: true, rank: null }));
    }
    rows.sort((a, b) => Number(b.eligible) - Number(a.eligible) || b.value - a.value);
    let rank = 0;
    rows.forEach((row, i) => {
      if (!row.eligible) return;
      rank = i > 0 && rows[i - 1].eligible && rows[i - 1].value === row.value ? rank : i + 1;
      row.rank = rank;
    });
    return { kind, since: new Date(since).toISOString(), minHands, rows };
  }
}
