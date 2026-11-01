import type { Db, Q } from '../db.ts';
import { authEvent, issueSession, revokeSessions, type SessionUser } from '../auth.ts';
import { newCode, newId, newToken, sha256 } from '../util.ts';
import { TokenError } from './jwt.ts';
import type { ProviderId, Providers } from './providers.ts';

export const RECOVERY_CODE_COUNT = 8;
export const PAIR_TTL_MS = 10 * 60_000;
export const NONCE_TTL_MS = 10 * 60_000;

/** Codes are typed by people: same alphabet as room codes (no 0/O, 1/I/L), dashes and case ignored. */
export const normalizeAuthCode = (s: string) => s.toUpperCase().replace(/[^0-9A-Z]/g, '').slice(0, 16);
const recoveryCode = () => `${newCode(4)}-${newCode(4)}-${newCode(4)}`;
const pairCode = () => `${newCode(4)}-${newCode(4)}`;

export interface Device {
  label: string;
}

/** Outcome of anything that may move this device to another account. The token goes only into the cookie. */
export type SwitchResult =
  | { status: 'signed_in'; token: string; sessionId: string; userId: string }
  | { status: 'same_account' }
  | { status: 'confirm_switch'; guest: { name: string; availableUnits: number } }
  | { status: 'invalid' };

export type ProviderResult =
  | SwitchResult
  | { status: 'linked'; token: string; sessionId: string }
  | { status: 'already_linked' }
  | { status: 'no_account' }
  | { status: 'identity_in_use' }
  | { status: 'provider_already_linked' }
  | { status: 'rejected'; reason: string };

export interface AccountSummary {
  kind: 'guest' | 'saved';
  identities: { provider: ProviderId; emailHint: string | null; linkedAt: string }[];
  recovery: { remaining: number; createdAt: string | null };
  sessions: number;
}

/** "o***@gmail.com": enough to recognize the account, not enough to harvest addresses. */
export const emailHint = (email: string | null) => {
  if (!email || !email.includes('@')) return null;
  const [local, domain] = email.split('@');
  return `${local.slice(0, 1)}***@${domain}`;
};

export class Accounts {
  constructor(
    private db: Db,
    private providers: Providers,
    private now: () => number = Date.now,
    /** Called after commit with session ids that were revoked, so live sockets can be closed. */
    private onRevoked: (sessionIds: string[]) => void = () => {},
  ) {}

  /* ------------------------------ status ------------------------------ */

  /** A guest becomes "saved" once it has a way back: a linked provider or unused recovery codes. */
  async secured(q: Q, userId: string): Promise<boolean> {
    const r = await q.query(
      `select (select count(*)::int from auth_identities where user_id = $1) as ids,
              (select count(*)::int from auth_codes where user_id = $1 and kind = 'recovery' and used_at is null) as codes`,
      [userId],
    );
    return r[0].ids > 0 || r[0].codes > 0;
  }

  async summary(userId: string): Promise<AccountSummary> {
    const ids = await this.db.query(`select provider, email, created_at from auth_identities where user_id = $1 order by created_at`, [userId]);
    const rec = (
      await this.db.query(
        `select count(*) filter (where used_at is null)::int as remaining, max(created_at) as created from auth_codes where user_id = $1 and kind = 'recovery'`,
        [userId],
      )
    )[0];
    const sessions = (await this.db.query(`select count(*)::int as n from sessions where user_id = $1 and revoked_at is null and expires_at > now()`, [userId]))[0].n;
    return {
      kind: ids.length || rec.remaining ? 'saved' : 'guest',
      identities: ids.map((i) => ({ provider: i.provider, emailHint: emailHint(i.email), linkedAt: new Date(i.created_at).toISOString() })),
      recovery: { remaining: rec.remaining, createdAt: rec.created ? new Date(rec.created).toISOString() : null },
      sessions,
    };
  }

  /* ---------------------------- switching ----------------------------- */

  /**
   * Moves this device to `targetId`. If the current account is an unsaved guest with no other signed-in device, the
   * switch would make it unreachable, so it needs an explicit confirmation. Nothing is merged: the guest's online wallet
   * stays with the guest, and local practice coins never reach the server.
   */
  private async switchTo(q: Q, current: SessionUser | null, targetId: string, confirm: boolean, device: Device, reason: string): Promise<SwitchResult> {
    if (current && current.id === targetId) return { status: 'same_account' };
    if (current && !confirm && !(await this.secured(q, current.id))) {
      const others = (await q.query(`select count(*)::int as n from sessions where user_id = $1 and id <> $2 and revoked_at is null and expires_at > now()`, [current.id, current.session_id]))[0].n;
      if (others === 0) {
        const w = (await q.query(`select available_units from wallets where user_id = $1 and scope = 'casual'`, [current.id]))[0];
        return { status: 'confirm_switch', guest: { name: current.name, availableUnits: Number(w?.available_units ?? 0) } };
      }
    }
    const revoked = current ? await revokeSessions(q, { sessionId: current.session_id }, `switched:${reason}`) : [];
    const s = await issueSession(q, targetId, { label: device.label, rotatedFrom: current?.session_id ?? null, now: this.now() });
    if (current) await authEvent(q, current.id, 'switched_away', reason);
    await authEvent(q, targetId, 'signed_in', reason);
    this.afterCommit(revoked);
    return { status: 'signed_in', token: s.token, sessionId: s.id, userId: targetId };
  }

  private pending: string[] = [];
  private afterCommit(ids: string[]) {
    this.pending.push(...ids);
  }
  /** Runs `fn` in a transaction and only reports revoked sessions once it committed. */
  private async tx<T>(fn: (q: Q) => Promise<T>): Promise<T> {
    this.pending = [];
    const out = await this.db.tx(fn);
    const ids = this.pending;
    this.pending = [];
    if (ids.length) this.onRevoked(ids);
    return out;
  }

  /* ----------------------------- providers ---------------------------- */

  async createNonce(): Promise<string> {
    const nonce = newToken();
    await this.db.query(`delete from auth_nonces where expires_at < $1`, [new Date(this.now())]);
    await this.db.query(`insert into auth_nonces(nonce_hash, expires_at) values ($1,$2)`, [sha256(nonce), new Date(this.now() + NONCE_TTL_MS)]);
    return nonce;
  }

  private async nonceUsable(q: Q, nonce: string): Promise<boolean> {
    const r = await q.query(`select 1 from auth_nonces where nonce_hash = $1 and used_at is null and expires_at > $2`, [sha256(nonce), new Date(this.now())]);
    return r.length > 0;
  }
  private async consumeNonce(q: Q, nonce: string): Promise<boolean> {
    const r = await q.query(`update auth_nonces set used_at = $2 where nonce_hash = $1 and used_at is null and expires_at > $2 returning 1`, [sha256(nonce), new Date(this.now())]);
    return r.length > 0;
  }

  /**
   * link: attach the provider identity to the current account (guest upgrade or second provider).
   * signin: load the account that owns this identity on this device.
   * The nonce is consumed only when the request completes, so "no_account" or "confirm_switch" can be answered with a
   * second request carrying the same token.
   */
  async providerAuth(
    current: SessionUser | null,
    input: { provider: ProviderId; credential: string; nonce: string | null; intent: 'link' | 'signin'; confirmSwitch?: boolean },
    device: Device,
  ): Promise<ProviderResult> {
    let id;
    try {
      id = await this.providers.verify(input.provider, input.credential, input.nonce);
    } catch (e) {
      return { status: 'rejected', reason: e instanceof TokenError ? e.reason : 'invalid' };
    }
    const needsNonce = this.providers.usesNonce(input.provider);
    return this.tx(async (q) => {
      if (needsNonce && !(input.nonce && (await this.nonceUsable(q, input.nonce)))) return { status: 'rejected', reason: 'nonce' } as const;
      const consume = async () => !needsNonce || (await this.consumeNonce(q, input.nonce!));
      const owner = (await q.query(`select i.user_id from auth_identities i join users u on u.id = i.user_id where i.provider = $1 and i.subject = $2 and u.deleted_at is null`, [id.provider, id.subject]))[0];

      if (input.intent === 'link') {
        if (!current) return { status: 'rejected', reason: 'unauthorized' } as const;
        if (owner?.user_id === current.id) return (await consume()) ? ({ status: 'already_linked' } as const) : ({ status: 'rejected', reason: 'nonce' } as const);
        if (owner) return { status: 'identity_in_use' } as const;
        const has = await q.query(`select 1 from auth_identities where user_id = $1 and provider = $2`, [current.id, id.provider]);
        if (has.length) return { status: 'provider_already_linked' } as const;
        if (!(await consume())) return { status: 'rejected', reason: 'nonce' } as const;
        await q.query(`insert into auth_identities(id, user_id, provider, subject, email, email_verified) values ($1,$2,$3,$4,$5,$6)`, [
          newId('ai'),
          current.id,
          id.provider,
          id.subject,
          id.email,
          id.emailVerified,
        ]);
        // Privilege change: rotate this device's session.
        const revoked = await revokeSessions(q, { sessionId: current.session_id }, 'rotated:link');
        const s = await issueSession(q, current.id, { label: device.label, rotatedFrom: current.session_id, now: this.now() });
        await authEvent(q, current.id, 'identity_linked', id.provider);
        this.afterCommit(revoked);
        return { status: 'linked', token: s.token, sessionId: s.id } as const;
      }

      if (!owner) return { status: 'no_account' } as const;
      const r = await this.switchTo(q, current, owner.user_id, !!input.confirmSwitch, device, id.provider);
      if (r.status === 'signed_in' || r.status === 'same_account') {
        if (!(await consume())) throw new TokenError('nonce');
        await q.query(`update auth_identities set last_used_at = now() where provider = $1 and subject = $2`, [id.provider, id.subject]);
      }
      return r;
    }).catch((e) => (e instanceof TokenError ? { status: 'rejected' as const, reason: e.reason } : Promise.reject(e)));
  }

  /** Removes a provider only if another way back remains (another provider or unused recovery codes). */
  async unlink(user: SessionUser, provider: ProviderId): Promise<{ ok: true } | { ok: false; error: 'not_found' | 'last_method' }> {
    return this.tx(async (q) => {
      const row = await q.query(`select id from auth_identities where user_id = $1 and provider = $2`, [user.id, provider]);
      if (!row.length) return { ok: false, error: 'not_found' } as const;
      const rest = (
        await q.query(
          `select (select count(*)::int from auth_identities where user_id = $1 and provider <> $2) as ids,
                  (select count(*)::int from auth_codes where user_id = $1 and kind = 'recovery' and used_at is null) as codes`,
          [user.id, provider],
        )
      )[0];
      if (rest.ids === 0 && rest.codes === 0) return { ok: false, error: 'last_method' } as const;
      await q.query(`delete from auth_identities where id = $1`, [row[0].id]);
      await authEvent(q, user.id, 'identity_unlinked', provider);
      return { ok: true } as const;
    });
  }

  /* -------------------------- recovery codes -------------------------- */

  /** New set of single-use recovery codes. Old unused codes stop working. The plain codes are returned once. */
  async createRecoveryCodes(user: SessionUser): Promise<string[]> {
    const codes = Array.from({ length: RECOVERY_CODE_COUNT }, recoveryCode);
    await this.tx(async (q) => {
      await q.query(`delete from auth_codes where user_id = $1 and kind = 'recovery'`, [user.id]);
      for (const c of codes)
        await q.query(`insert into auth_codes(id, user_id, kind, code_hash, created_at) values ($1,$2,'recovery',$3,$4)`, [newId('ac'), user.id, sha256(normalizeAuthCode(c)), new Date(this.now())]);
      await authEvent(q, user.id, 'recovery_codes_created');
    });
    return codes;
  }

  async redeemRecovery(current: SessionUser | null, code: string, confirm: boolean, device: Device): Promise<SwitchResult> {
    return this.redeem(current, 'recovery', code, confirm, device);
  }

  /* ---------------------------- pairing ------------------------------- */

  /** Short code to sign this account in on another device. One active code per account, 10 minutes, single use. */
  async createPairCode(user: SessionUser): Promise<{ code: string; expiresAt: string }> {
    const code = pairCode();
    const expires = new Date(this.now() + PAIR_TTL_MS);
    await this.tx(async (q) => {
      await q.query(`delete from auth_codes where user_id = $1 and kind = 'pair'`, [user.id]);
      await q.query(`insert into auth_codes(id, user_id, kind, code_hash, created_at, expires_at) values ($1,$2,'pair',$3,$4,$5)`, [
        newId('ac'),
        user.id,
        sha256(normalizeAuthCode(code)),
        new Date(this.now()),
        expires,
      ]);
      await authEvent(q, user.id, 'pair_code_created');
    });
    return { code, expiresAt: expires.toISOString() };
  }

  async redeemPair(current: SessionUser | null, code: string, confirm: boolean, device: Device): Promise<SwitchResult> {
    return this.redeem(current, 'pair', code, confirm, device);
  }

  private async redeem(current: SessionUser | null, kind: 'recovery' | 'pair', code: string, confirm: boolean, device: Device): Promise<SwitchResult> {
    const norm = normalizeAuthCode(code);
    if (norm.length !== (kind === 'recovery' ? 12 : 8)) return { status: 'invalid' };
    return this.tx(async (q) => {
      const row = (
        await q.query(
          `select c.id, c.user_id from auth_codes c join users u on u.id = c.user_id
            where c.code_hash = $1 and c.kind = $2 and c.used_at is null and (c.expires_at is null or c.expires_at > $3) and u.deleted_at is null
            for update of c`,
          [sha256(norm), kind, new Date(this.now())],
        )
      )[0];
      if (!row) {
        await authEvent(q, null, `${kind}_failed`);
        return { status: 'invalid' } as const;
      }
      const r = await this.switchTo(q, current, row.user_id, confirm, device, kind);
      // Same account: the code is not spent. Confirm prompt: nothing changes yet.
      if (r.status === 'signed_in') await q.query(`update auth_codes set used_at = $2 where id = $1`, [row.id, new Date(this.now())]);
      return r;
    });
  }

  /* ----------------------------- sessions ----------------------------- */

  async sessions(user: SessionUser) {
    const rows = await this.db.query(
      `select id, label, created_at, last_seen_at from sessions where user_id = $1 and revoked_at is null and expires_at > now() order by last_seen_at desc`,
      [user.id],
    );
    return rows.map((r) => ({ id: r.id, label: r.label, createdAt: new Date(r.created_at).toISOString(), lastSeenAt: new Date(r.last_seen_at).toISOString(), current: r.id === user.session_id }));
  }

  async revokeSession(user: SessionUser, sessionId: string): Promise<boolean> {
    if (sessionId === user.session_id) return false;
    const ids = await this.tx(async (q) => {
      const ids = await revokeSessions(q, { sessionId, userId: user.id }, 'revoked_by_user');
      if (ids.length) await authEvent(q, user.id, 'session_revoked');
      this.afterCommit(ids);
      return ids;
    });
    return ids.length > 0;
  }

  async revokeOthers(user: SessionUser): Promise<number> {
    return this.tx(async (q) => {
      const ids = await revokeSessions(q, { userId: user.id, exceptId: user.session_id }, 'signed_out_everywhere');
      await authEvent(q, user.id, 'signed_out_others', String(ids.length));
      this.afterCommit(ids);
      return ids.length;
    });
  }

  /** Signing out an unsaved guest on its only device loses it for good, so that needs `confirmLoss`. */
  async signOut(user: SessionUser, confirmLoss: boolean): Promise<{ ok: true } | { ok: false; error: 'confirm_loss' }> {
    return this.tx(async (q) => {
      if (!confirmLoss && !(await this.secured(q, user.id))) {
        const others = (await q.query(`select count(*)::int as n from sessions where user_id = $1 and id <> $2 and revoked_at is null and expires_at > now()`, [user.id, user.session_id]))[0].n;
        if (others === 0) return { ok: false, error: 'confirm_loss' } as const;
      }
      this.afterCommit(await revokeSessions(q, { sessionId: user.session_id }, 'signed_out'));
      await authEvent(q, user.id, 'signed_out');
      return { ok: true } as const;
    });
  }

  /* ----------------------------- deletion ----------------------------- */

  /**
   * Deletes the account: identities, codes, sessions, friendships, club memberships, blocks and invites go away and the
   * profile is anonymized. Game history and ledger rows stay (anonymous) so other players' results and wallet sums remain
   * consistent. Refused while the user holds a seat or the dealer role in an open room.
   */
  async deleteAccount(user: SessionUser, confirmName: string): Promise<{ ok: true } | { ok: false; error: 'confirm' | 'in_room' }> {
    if (confirmName.trim() !== user.name.trim()) return { ok: false, error: 'confirm' };
    return this.tx(async (q) => {
      const busy = await q.query(
        `select 1 from seats s join rooms r on r.id = s.room_id where s.user_id = $1 and r.status = 'open'
         union all select 1 from rooms where dealer_user_id = $1 and status = 'open'`,
        [user.id],
      );
      if (busy.length) return { ok: false, error: 'in_room' } as const;
      await q.query(`update users set name = 'שחקן לשעבר', friend_code = $2, deleted_at = $3 where id = $1`, [user.id, `X${newCode(9)}`, new Date(this.now())]);
      await q.query(`delete from auth_identities where user_id = $1`, [user.id]);
      await q.query(`delete from auth_codes where user_id = $1`, [user.id]);
      await q.query(`delete from friendships where user_a = $1 or user_b = $1`, [user.id]);
      await q.query(`delete from blocks where blocker_id = $1 or blocked_id = $1`, [user.id]);
      await q.query(`update invites set revoked_at = coalesce(revoked_at, now()) where owner_id = $1`, [user.id]);
      const owned = await q.query(`select id from groups where owner_id = $1`, [user.id]);
      await q.query(`delete from group_members where user_id = $1`, [user.id]);
      for (const g of owned) {
        const next = (await q.query(`select user_id from group_members where group_id = $1 order by joined_at limit 1`, [g.id]))[0];
        if (next) await q.query(`update groups set owner_id = $2 where id = $1`, [g.id, next.user_id]);
      }
      this.afterCommit(await revokeSessions(q, { userId: user.id }, 'account_deleted'));
      await authEvent(q, user.id, 'account_deleted');
      return { ok: true } as const;
    });
  }
}
