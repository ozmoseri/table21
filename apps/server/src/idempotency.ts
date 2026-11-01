import { createHash } from 'node:crypto';
import type { Db, Q } from './db.ts';

/**
 * Idempotency for "create" requests that a phone may retry while a free server wakes up (cold start, about a minute).
 * The client sends the same `Idempotency-Key` header on every retry of one action. The key row is inserted inside the
 * creating transaction: a concurrent retry blocks on the primary key until the first transaction ends, then either
 * replays the committed result or (after a rollback) creates the thing once itself.
 */
export const IDEM_HEADER = 'idempotency-key';
const KEY = /^[A-Za-z0-9_-]{16,64}$/;
export const KEY_TTL_HOURS = 24;

export interface Idem {
  scope: string;
  key: string;
  /** Fingerprint of the request the key was first used for. */
  hash?: string;
}

/** The same key used for a different request. Nothing was changed; HTTP answers 409, sockets `idempotency_conflict`. */
export class IdempotencyConflict extends Error {
  constructor(public where: string) {
    super('idempotency_conflict');
  }
}

/** Stable JSON (sorted keys) so the same request always gives the same fingerprint. */
function canonical(v: unknown): string {
  if (v === null || typeof v !== 'object') return JSON.stringify(v ?? null);
  if (Array.isArray(v)) return `[${v.map(canonical).join(',')}]`;
  return `{${Object.keys(v as object)
    .sort()
    .filter((k) => (v as Record<string, unknown>)[k] !== undefined)
    .map((k) => `${JSON.stringify(k)}:${canonical((v as Record<string, unknown>)[k])}`)
    .join(',')}}`;
}
export const requestHash = (body: unknown) => createHash('sha256').update(canonical(body)).digest('hex').slice(0, 32);

/** Reads and validates the header. A malformed key is ignored (the request still works, without replay). */
export function idemFrom(headers: Record<string, unknown>, scope: string, body: unknown = {}): Idem | undefined {
  const v = headers[IDEM_HEADER];
  return typeof v === 'string' && KEY.test(v) ? { scope, key: v, hash: requestHash(body ?? {}) } : undefined;
}

/** Returns the stored result of an earlier attempt, or null when this transaction is the first. */
export async function idemReplay<T>(q: Q, idem: Idem | undefined): Promise<{ response: T; userId: string | null } | null> {
  if (!idem) return null;
  const rows = await q.query<{ response: T; user_id: string | null; request_hash: string | null }>(
    `select response, user_id, request_hash from idempotency_keys where scope = $1 and key = $2 and created_at > now() - make_interval(hours => $3)`,
    [idem.scope, idem.key, KEY_TTL_HOURS],
  );
  if (!rows[0]) return null;
  if (rows[0].request_hash && idem.hash && rows[0].request_hash !== idem.hash) throw new IdempotencyConflict(idem.scope);
  return { response: rows[0].response, userId: rows[0].user_id };
}

/**
 * Records the result. Called last in the creating transaction. If another attempt committed the same key first
 * (a retry that raced past idemReplay), the unique key aborts this transaction and the caller retries into the replay.
 */
export async function idemSave(q: Q, idem: Idem | undefined, response: unknown, userId: string | null): Promise<void> {
  if (!idem) return;
  await q.query(`delete from idempotency_keys where scope = $1 and key = $2 and created_at <= now() - make_interval(hours => $3)`, [idem.scope, idem.key, KEY_TTL_HOURS]);
  await q.query(`insert into idempotency_keys(scope, key, user_id, response, request_hash) values ($1,$2,$3,$4,$5)`, [
    idem.scope,
    idem.key,
    userId,
    JSON.stringify(response),
    idem.hash ?? null,
  ]);
}

/**
 * Runs a creating transaction with replay. A unique violation on the key means a concurrent attempt won: run again,
 * which now replays. Bounded, so a broken key can never loop.
 */
export async function withIdem<T>(db: Db, idem: Idem | undefined, fn: (q: Q) => Promise<T>): Promise<T> {
  for (let attempt = 0; ; attempt++) {
    try {
      return await db.tx(fn);
    } catch (e: any) {
      if (idem && e?.code === '23505' && `${e?.constraint ?? ''} ${e?.message ?? ''}`.includes('idempotency_keys') && attempt < 2) continue;
      throw e;
    }
  }
}

export async function pruneIdem(db: Db): Promise<void> {
  await db.query(`delete from idempotency_keys where created_at < now() - make_interval(hours => $1)`, [KEY_TTL_HOURS]);
}
