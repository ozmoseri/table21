import type { Q } from './db.ts';
import { newId } from './util.ts';

export type LedgerKind =
  | 'grant_welcome'
  | 'grant_daily'
  | 'grant_rescue'
  | 'match_stack'
  | 'stake_reserve'
  | 'stake_release'
  | 'stake_return'
  | 'refund';

export interface Wallet {
  id: string;
  user_id: string;
  scope: string;
  available_units: number;
  reserved_units: number;
}

export class FundsError extends Error {
  constructor() {
    super('insufficient_funds');
  }
}

export async function ensureWallet(q: Q, userId: string, scope: string): Promise<Wallet> {
  await q.query(
    `insert into wallets(id, user_id, scope, available_units) values ($1, $2, $3, 0) on conflict (user_id, scope) do nothing`,
    [newId('w'), userId, scope],
  );
  return lockWallet(q, userId, scope);
}

/** Locks the wallet row for the rest of the transaction. Serializes changes across rooms and tabs. */
export async function lockWallet(q: Q, userId: string, scope: string): Promise<Wallet> {
  const rows = await q.query<Wallet>('select * from wallets where user_id = $1 and scope = $2 for update', [userId, scope]);
  if (!rows[0]) throw new Error('wallet_missing');
  return rows[0];
}

export async function getWallet(q: Q, userId: string, scope: string): Promise<Wallet | null> {
  const rows = await q.query<Wallet>('select * from wallets where user_id = $1 and scope = $2', [userId, scope]);
  return rows[0] ?? null;
}

/**
 * Applies a ledger movement to a locked wallet. Returns false (no change) when `idemKey` was already applied.
 * Throws FundsError rather than letting available or reserved go negative.
 */
export async function move(
  q: Q,
  w: Wallet,
  kind: LedgerKind,
  dAvailable: number,
  dReserved: number,
  ref: { roomId?: string; roundId?: string; commandId?: string; idemKey?: string } = {},
): Promise<boolean> {
  if (!Number.isSafeInteger(dAvailable) || !Number.isSafeInteger(dReserved)) throw new Error('non_integer_amount');
  if (w.available_units + dAvailable < 0 || w.reserved_units + dReserved < 0) throw new FundsError();
  if (ref.idemKey) {
    const ins = await q.query(
      `insert into ledger(wallet_id, kind, delta_available, delta_reserved, room_id, round_id, command_id, idem_key)
       values ($1,$2,$3,$4,$5,$6,$7,$8) on conflict (idem_key) do nothing returning id`,
      [w.id, kind, dAvailable, dReserved, ref.roomId ?? null, ref.roundId ?? null, ref.commandId ?? null, ref.idemKey],
    );
    if (ins.length === 0) return false;
  } else {
    await q.query(
      `insert into ledger(wallet_id, kind, delta_available, delta_reserved, room_id, round_id, command_id) values ($1,$2,$3,$4,$5,$6,$7)`,
      [w.id, kind, dAvailable, dReserved, ref.roomId ?? null, ref.roundId ?? null, ref.commandId ?? null],
    );
  }
  await q.query(
    'update wallets set available_units = available_units + $2, reserved_units = reserved_units + $3, updated_at = now() where id = $1',
    [w.id, dAvailable, dReserved],
  );
  w.available_units += dAvailable;
  w.reserved_units += dReserved;
  return true;
}
