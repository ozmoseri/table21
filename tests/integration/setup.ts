import { randomUUID } from 'node:crypto';
import { postgresDb, migrate, type Db } from '../../apps/server/src/db.ts';
import { createGuest, userFromToken, DEFAULT_ECONOMY, type SessionUser } from '../../apps/server/src/auth.ts';
import { RoomManager, type Timing } from '../../apps/server/src/rooms.ts';
import type { Card } from '@table21/game-engine';
import type { Command } from '@table21/protocol';

export const TEST_DB_URL = process.env.T21_TEST_DATABASE_URL ?? 'postgres://t21@127.0.0.1:55432/table21_test';

export async function freshDb(): Promise<Db> {
  const db = postgresDb(TEST_DB_URL);
  await db.query('drop schema if exists public cascade');
  await db.query('create schema public');
  await migrate(db);
  return db;
}

export async function makeUser(db: Db, name: string): Promise<SessionUser & { token: string }> {
  const { token } = await createGuest(db, { name, avatar: 'fox', locale: 'he' }, DEFAULT_ECONOMY);
  return { ...(await userFromToken(db, token))!, token };
}

export const FAST: Partial<Timing> = { dealerStepMs: 10, autoDealDelayMs: 20, humanDealerSeconds: 1, reconnectGraceMs: 200 };

/** Shoe queue: tests push stacked shoes; once empty, a long neutral shoe is returned. */
export class ShoeQueue {
  shoes: Card[][] = [];
  next = (): Card[] => this.shoes.shift() ?? neutralShoe();
}

let uid = 10_000;
export function shoeOf(ranks: string[], fill = 200): Card[] {
  const suits = ['S', 'H', 'D', 'C'] as const;
  const out: Card[] = ranks.map((r, i) => ({ uid: uid++, rank: r as Card['rank'], suit: suits[i % 4] }));
  // Neutral filler: 10s and 7s so dealer outcomes stay predictable.
  for (let i = 0; i < fill; i++) out.push({ uid: uid++, rank: i % 2 ? '7' : '10', suit: suits[i % 4] });
  return out;
}
export const neutralShoe = () => shoeOf([], 300);

export function manager(db: Db, opts: { shoes?: ShoeQueue; emit?: (roomId: string) => void; timing?: Partial<Timing>; now?: () => number } = {}) {
  return new RoomManager({ db, emit: opts.emit ?? (() => {}), shoeFactory: opts.shoes?.next, timing: { ...FAST, ...opts.timing }, now: opts.now });
}

export async function version(db: Db, roomId: string): Promise<number> {
  return (await db.query('select version from rooms where id = $1', [roomId]))[0].version;
}

export async function send(m: RoomManager, user: SessionUser, roomId: string, c: Partial<Command> & { type: Command['type'] }) {
  const v = await version(m.db, roomId);
  return m.command(user, { commandId: randomUUID().replace(/-/g, ''), roomId, expectedVersion: v, ...c } as Command);
}

export async function waitFor<T>(fn: () => Promise<T | false | null | undefined>, ms = 5000): Promise<T> {
  const end = Date.now() + ms;
  for (;;) {
    const v = await fn();
    if (v) return v;
    if (Date.now() > end) throw new Error('waitFor timeout');
    await new Promise((r) => setTimeout(r, 15));
  }
}

export async function phase(db: Db, roomId: string): Promise<string> {
  return (await db.query('select phase from rooms where id = $1', [roomId]))[0].phase;
}

export async function wallet(db: Db, userId: string, scope = 'casual') {
  return (await db.query('select available_units as a, reserved_units as r from wallets where user_id = $1 and scope = $2', [userId, scope]))[0] as {
    a: number;
    r: number;
  };
}

/** Ledger invariant: every wallet equals the sum of its ledger movements and never goes negative. */
export async function assertLedgerConsistent(db: Db): Promise<void> {
  const bad = await db.query(`
    select w.id, w.available_units, w.reserved_units, coalesce(sum(l.delta_available),0) as sa, coalesce(sum(l.delta_reserved),0) as sr
      from wallets w left join ledger l on l.wallet_id = w.id group by w.id
     having w.available_units <> coalesce(sum(l.delta_available),0) or w.reserved_units <> coalesce(sum(l.delta_reserved),0)
         or w.available_units < 0 or w.reserved_units < 0`);
  if (bad.length) throw new Error(`ledger mismatch: ${JSON.stringify(bad)}`);
}
