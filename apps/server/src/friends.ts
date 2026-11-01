import type { Db, Q } from './db.ts';
import type { SessionUser } from './auth.ts';
import { newId, newToken, sha256 } from './util.ts';

/* --------------------------------- blocks --------------------------------- */

/** True when either user blocked the other. Blocks act in both directions. */
export async function blockedEither(q: Q, a: string, b: string): Promise<boolean> {
  const r = await q.query(`select 1 from blocks where (blocker_id = $1 and blocked_id = $2) or (blocker_id = $2 and blocked_id = $1) limit 1`, [a, b]);
  return r.length > 0;
}

/** Every user id that has a block with `userId`, in either direction. */
export async function blockPeers(q: Q, userId: string): Promise<Set<string>> {
  const r = await q.query<{ other: string }>(
    `select blocked_id as other from blocks where blocker_id = $1 union select blocker_id from blocks where blocked_id = $1`,
    [userId],
  );
  return new Set(r.map((x) => x.other));
}

export const INVITE_DEFAULTS = { friend: { maxUses: 10, ttlHours: 168 }, club: { maxUses: 20, ttlHours: 168 } } as const;
export const MAX_ACTIVE_INVITES = 20;

export type InviteState = 'valid' | 'expired' | 'revoked' | 'used_up';

export class Friends {
  constructor(private db: Db, private now: () => number = Date.now) {}

  async block(user: SessionUser, otherId: string): Promise<boolean> {
    if (otherId === user.id) return false;
    return this.db.tx(async (q) => {
      const exists = await q.query(`select 1 from users where id = $1`, [otherId]);
      if (!exists.length) return false;
      await q.query(`insert into blocks(blocker_id, blocked_id) values ($1,$2) on conflict do nothing`, [user.id, otherId]);
      const [a, b] = [user.id, otherId].sort();
      await q.query(`delete from friendships where user_a = $1 and user_b = $2`, [a, b]);
      return true;
    });
  }

  async unblock(user: SessionUser, otherId: string) {
    await this.db.query(`delete from blocks where blocker_id = $1 and blocked_id = $2`, [user.id, otherId]);
  }

  async blocked(user: SessionUser) {
    return this.db.query(
      `select u.id as "userId", u.name, u.avatar from blocks b join users u on u.id = b.blocked_id where b.blocker_id = $1 order by b.created_at desc`,
      [user.id],
    );
  }

  async removeFriend(user: SessionUser, otherId: string) {
    const [a, b] = [user.id, otherId].sort();
    await this.db.query(`delete from friendships where user_a = $1 and user_b = $2`, [a, b]);
  }

  /** Leaves a club. If the owner leaves, the longest-standing member becomes the owner. */
  async leaveGroup(user: SessionUser, groupId: string): Promise<boolean> {
    return this.db.tx(async (q) => {
      const del = await q.query(`delete from group_members where group_id = $1 and user_id = $2 returning 1`, [groupId, user.id]);
      if (!del.length) return false;
      const g = (await q.query(`select owner_id from groups where id = $1 for update`, [groupId]))[0];
      if (g?.owner_id === user.id) {
        const next = (await q.query(`select user_id from group_members where group_id = $1 order by joined_at limit 1`, [groupId]))[0];
        if (next) await q.query(`update groups set owner_id = $2 where id = $1`, [groupId, next.user_id]);
      }
      await q.query(`update invites set revoked_at = coalesce(revoked_at, now()) where group_id = $1 and owner_id = $2`, [groupId, user.id]);
      return true;
    });
  }

  /* -------------------------------- invites -------------------------------- */

  /** Creates an invite link token. The plain token is returned once; only its hash is stored. */
  async createInvite(user: SessionUser, input: { kind: 'friend' | 'club'; groupId?: string; maxUses?: number; ttlHours?: number }) {
    const d = INVITE_DEFAULTS[input.kind];
    const maxUses = Math.min(50, Math.max(1, Math.floor(input.maxUses ?? d.maxUses)));
    const ttl = Math.min(720, Math.max(1, Math.floor(input.ttlHours ?? d.ttlHours)));
    return this.db.tx(async (q) => {
      if (input.kind === 'club') {
        const m = await q.query(`select 1 from group_members where group_id = $1 and user_id = $2`, [input.groupId ?? '', user.id]);
        if (!m.length) return { ok: false as const, error: 'forbidden' as const };
      }
      const active = (
        await q.query(`select count(*)::int as n from invites where owner_id = $1 and revoked_at is null and expires_at > $2 and uses < max_uses`, [user.id, new Date(this.now())])
      )[0].n;
      if (active >= MAX_ACTIVE_INVITES) return { ok: false as const, error: 'too_many' as const };
      const token = newToken().slice(0, 24);
      const id = newId('inv');
      const expires = new Date(this.now() + ttl * 3600_000);
      await q.query(
        `insert into invites(id, token_hash, kind, owner_id, group_id, max_uses, expires_at, created_at) values ($1,$2,$3,$4,$5,$6,$7,$8)`,
        [id, sha256(token), input.kind, user.id, input.kind === 'club' ? input.groupId : null, maxUses, expires, new Date(this.now())],
      );
      return { ok: true as const, id, token, expiresAt: expires.toISOString(), maxUses };
    });
  }

  private state(row: Record<string, any>): InviteState {
    if (row.revoked_at) return 'revoked';
    if (new Date(row.expires_at as string).getTime() <= this.now()) return 'expired';
    if (row.uses >= row.max_uses) return 'used_up';
    return 'valid';
  }

  /** Public preview of an invite link (no session needed). A blocked viewer sees the same answer as a missing link. */
  async preview(token: string, viewerId: string | null) {
    if (!/^[\w-]{16,40}$/.test(token)) return null;
    const row = (
      await this.db.query(
        `select i.*, u.name as owner_name, u.avatar as owner_avatar, u.deleted_at, g.name as group_name,
                (select count(*)::int from group_members m where m.group_id = i.group_id) as group_size
           from invites i join users u on u.id = i.owner_id left join groups g on g.id = i.group_id where i.token_hash = $1`,
        [sha256(token)],
      )
    )[0];
    if (!row || row.deleted_at) return null;
    if (viewerId && (await blockedEither(this.db, viewerId, row.owner_id))) return null;
    return {
      kind: row.kind as 'friend' | 'club',
      state: this.state(row),
      inviter: { userId: row.owner_id as string, name: row.owner_name as string, avatar: row.owner_avatar as string },
      group: row.kind === 'club' ? { id: row.group_id as string, name: row.group_name as string, members: row.group_size as number } : null,
      expiresAt: new Date(row.expires_at).toISOString(),
      self: viewerId === row.owner_id,
    };
  }

  /**
   * Accepts an invite: friend invites create a friendship with the inviter, club invites add a membership.
   * The invite row is locked, so concurrent accepts can never exceed `max_uses`; a user who already accepted is not
   * counted twice.
   */
  async accept(user: SessionUser, token: string) {
    if (!/^[\w-]{16,40}$/.test(token)) return { ok: false as const, error: 'not_found' as const };
    return this.db.tx(async (q) => {
      const row = (await q.query(`select i.*, u.deleted_at from invites i join users u on u.id = i.owner_id where i.token_hash = $1 for update of i`, [sha256(token)]))[0];
      if (!row || row.deleted_at) return { ok: false as const, error: 'not_found' as const };
      if (row.owner_id === user.id) return { ok: false as const, error: 'self' as const };
      if (await blockedEither(q, user.id, row.owner_id)) return { ok: false as const, error: 'not_found' as const };
      const already = await q.query(`select 1 from invite_uses where invite_id = $1 and user_id = $2`, [row.id, user.id]);
      if (!already.length) {
        const st = this.state(row);
        if (st !== 'valid') return { ok: false as const, error: st };
        await q.query(`insert into invite_uses(invite_id, user_id, used_at) values ($1,$2,$3)`, [row.id, user.id, new Date(this.now())]);
        await q.query(`update invites set uses = uses + 1 where id = $1`, [row.id]);
      }
      if (row.kind === 'friend') {
        const [a, b] = [user.id, row.owner_id].sort();
        await q.query(`insert into friendships(user_a, user_b) values ($1,$2) on conflict do nothing`, [a, b]);
        return { ok: true as const, kind: 'friend' as const, friendId: row.owner_id as string };
      }
      await q.query(`insert into group_members(group_id, user_id) values ($1,$2) on conflict do nothing`, [row.group_id, user.id]);
      return { ok: true as const, kind: 'club' as const, groupId: row.group_id as string };
    });
  }

  async myInvites(user: SessionUser) {
    const rows = await this.db.query(
      `select i.id, i.kind, i.group_id, g.name as group_name, i.uses, i.max_uses, i.expires_at, i.revoked_at, i.created_at
         from invites i left join groups g on g.id = i.group_id where i.owner_id = $1 order by i.created_at desc limit 30`,
      [user.id],
    );
    return rows.map((r) => ({
      id: r.id as string,
      kind: r.kind as 'friend' | 'club',
      group: r.group_id ? { id: r.group_id as string, name: r.group_name as string } : null,
      uses: r.uses as number,
      maxUses: r.max_uses as number,
      expiresAt: new Date(r.expires_at).toISOString(),
      createdAt: new Date(r.created_at).toISOString(),
      state: this.state(r),
    }));
  }

  async revokeInvite(user: SessionUser, inviteId: string): Promise<boolean> {
    const r = await this.db.query(`update invites set revoked_at = now() where id = $1 and owner_id = $2 and revoked_at is null returning 1`, [inviteId, user.id]);
    return r.length > 0;
  }
}
