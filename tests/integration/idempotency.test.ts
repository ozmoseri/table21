import { randomUUID } from 'node:crypto';
import { afterAll, afterEach, beforeEach, describe, expect, it } from 'vitest';
import { postgresDb, type Db, type Q } from '../../apps/server/src/db.ts';
import type { RoomManager } from '../../apps/server/src/rooms.ts';
import { IdempotencyConflict, requestHash } from '../../apps/server/src/idempotency.ts';
import { lockWallet, move } from '../../apps/server/src/wallet.ts';
import { sendGift } from '../../apps/server/src/gifts.ts';
import type { Command } from '@table21/protocol';
import { FAST, ShoeQueue, TEST_DB_URL, assertLedgerConsistent, freshDb, makeUser, manager, phase, send, shoeOf, version, waitFor, wallet } from './setup.ts';
import { makeApp } from './http.ts';

/**
 * Idempotency for every action that moves coins (docs/QA_REPORT.md section 8):
 * - socket commands: the commandId is the key (bet, double, split, leave);
 * - gifts: the client event id;
 * - HTTP: the Idempotency-Key header (guest, room, club, daily and rescue grants);
 * - settlement and grants inside the server: the ledger idem_key.
 * Same key + same request: the first result again, nothing charged twice. Same key + different request: refused,
 * nothing changed. The key is written in the same transaction as the coins it moves.
 */
let db: Db;
const managers: RoomManager[] = [];
let apps: Awaited<ReturnType<typeof makeApp>>[] = [];
const extra: Db[] = [];
beforeEach(async () => {
  if (db) await db.close();
  db = await freshDb();
});
afterEach(async () => {
  for (const m of managers.splice(0)) m.stop();
  for (const a of apps.splice(0)) await a.server.close();
  for (const d of extra.splice(0)) await d.close();
});
afterAll(async () => db?.close());

const mk = (d: Db, shoes = new ShoeQueue(), timing = {}) => {
  const m = manager(d, { shoes, timing: { ...FAST, ...timing } });
  managers.push(m);
  return m;
};
const n = async (sql: string, p: unknown[] = []) => Number((await db.query(sql, p))[0].n);
const key = () => randomUUID().replace(/-/g, '');
const state = async (roomId: string, userIds: string[]) => ({
  version: await version(db, roomId),
  wallets: await Promise.all(userIds.map((u) => wallet(db, u))),
  ledger: await n(`select count(*)::int as n from ledger`),
  seats: await db.query(`select user_id, bet_units from seats where room_id = $1 order by user_id`, [roomId]),
  round: (await db.query(`select state from rounds where room_id = $1 order by number desc limit 1`, [roomId]))[0]?.state ?? null,
});

async function seated(shoe?: string[], timing = {}) {
  const shoes = new ShoeQueue();
  if (shoe) shoes.shoes.push(shoeOf(shoe));
  const m = mk(db, shoes, timing);
  const a = await makeUser(db, 'A');
  const { roomId } = await m.createRoom(a, { mode: 'casual', settings: {}, matchStackCoins: 1000, matchRounds: 2 });
  await m.connect(roomId, a.id);
  await send(m, a, roomId, { type: 'sit' });
  return { m, a, roomId };
}
const cmdOf = async (roomId: string, c: Partial<Command> & { type: Command['type'] }, commandId = key()) =>
  ({ commandId, roomId, expectedVersion: await version(db, roomId), ...c }) as Command;

describe('bets (socket commands): commandId is the idempotency key', () => {
  it('the same bet sent again (sequential and 6 at once) is charged once and answers like the first', async () => {
    const { m, a, roomId } = await seated(undefined, { autoDealDelayMs: 60_000, betSeconds: 600 } as any);
    const cmd = await cmdOf(roomId, { type: 'bet', coins: 10 });
    const first = await m.command(a, cmd);
    expect(first.ok).toBe(true);
    const again = await m.command(a, cmd);
    expect(again).toMatchObject({ ok: true, version: first.version, duplicate: true });
    const burst = await Promise.all(Array.from({ length: 6 }, () => m.command(a, cmd)));
    expect(burst.every((r) => r.ok && r.duplicate)).toBe(true);
    expect(await wallet(db, a.id)).toEqual({ a: 4000 - 20, r: 20 });
    expect(await n(`select count(*)::int as n from ledger where kind = 'stake_reserve'`)).toBe(1);
    await assertLedgerConsistent(db);
  });

  it('two server instances receiving the same bet at the same moment charge it once (the key is claimed in the database)', async () => {
    const { m, a, roomId } = await seated(undefined, { autoDealDelayMs: 60_000 });
    const m2 = mk(db, new ShoeQueue(), { autoDealDelayMs: 60_000 });
    const cmd = await cmdOf(roomId, { type: 'bet', coins: 25 });
    const [r1, r2] = await Promise.all([m.command(a, cmd), m2.command(a, cmd)]);
    expect(r1.ok && r2.ok).toBe(true);
    expect([r1.duplicate, r2.duplicate].filter(Boolean)).toHaveLength(1);
    expect(await wallet(db, a.id)).toEqual({ a: 4000 - 50, r: 50 });
    expect(await n(`select count(*)::int as n from commands where command_id = $1`, [cmd.commandId])).toBe(1);
    await assertLedgerConsistent(db);
  });

  it('the same commandId with a different body is refused and changes nothing', async () => {
    const { m, a, roomId } = await seated(undefined, { autoDealDelayMs: 60_000 });
    const cmd = await cmdOf(roomId, { type: 'bet', coins: 10 });
    expect((await m.command(a, cmd)).ok).toBe(true);
    const before = await state(roomId, [a.id]);
    const stored = (await db.query(`select result, request_hash from commands where command_id = $1`, [cmd.commandId]))[0];
    for (const other of [{ ...cmd, coins: 25 }, { ...cmd, type: 'leave_seat' }, { ...cmd, expectedVersion: cmd.expectedVersion + 1 }] as Command[]) {
      const r = await m.command(a, other);
      expect(r).toMatchObject({ ok: false, error: 'idempotency_conflict' });
    }
    expect(await state(roomId, [a.id])).toEqual(before);
    expect((await db.query(`select result, request_hash from commands where command_id = $1`, [cmd.commandId]))[0]).toEqual(stored);
    expect(stored.request_hash).toBe(requestHash({ roomId, expectedVersion: cmd.expectedVersion, type: 'bet', coins: 10 }));
  });

  it('the key and the coins commit together: a transaction cut after the coins moved leaves neither; the retry applies once', async () => {
    const inner = postgresDb(TEST_DB_URL);
    extra.push(inner);
    let cut = false;
    const wrap = (q: Q): Q => ({
      async query(sql, params) {
        if (cut && sql.startsWith('update commands set result')) {
          cut = false;
          await q.query('select pg_terminate_backend(pg_backend_pid())'); // the connection dies before commit
        }
        return q.query(sql, params);
      },
    });
    const faulty: Db = { kind: inner.kind, query: (s, p) => inner.query(s, p), tx: (fn) => inner.tx((q) => fn(wrap(q))), close: () => inner.close() };
    const m = mk(faulty, new ShoeQueue(), { autoDealDelayMs: 60_000 });
    const a = await makeUser(db, 'A');
    const { roomId } = await m.createRoom(a, { mode: 'casual', settings: {}, matchStackCoins: 1000, matchRounds: 2 });
    await m.connect(roomId, a.id);
    await send(m, a, roomId, { type: 'sit' });
    const cmd = await cmdOf(roomId, { type: 'bet', coins: 50 });
    cut = true;
    const lost = await m.command(a, cmd);
    expect(lost.ok).toBe(false);
    expect(await n(`select count(*)::int as n from commands where command_id = $1`, [cmd.commandId])).toBe(0);
    expect(await n(`select count(*)::int as n from ledger where command_id = $1`, [cmd.commandId])).toBe(0);
    expect(await wallet(db, a.id)).toEqual({ a: 4000, r: 0 });
    const retry = await m.command(a, cmd);
    expect(retry).toMatchObject({ ok: true });
    expect(retry.duplicate).toBeFalsy();
    expect(await m.command(a, cmd)).toMatchObject({ ok: true, duplicate: true });
    expect(await wallet(db, a.id)).toEqual({ a: 3900, r: 100 });
    await assertLedgerConsistent(db);
  });
});

describe('double and split: one extra stake per key', () => {
  for (const [name, shoe, action] of [
    ['double', ['6', '10', '5', '7', '9'], 'double'],
    ['split', ['8', '10', '8', '7', '3', '2'], 'split'],
  ] as const) {
    it(`${name}: repeated and concurrent sends reserve the extra stake once; the same key for another action is refused`, async () => {
      const { m, a, roomId } = await seated([...shoe]);
      await send(m, a, roomId, { type: 'bet', coins: 10 });
      await waitFor(async () => (await phase(db, roomId)) === 'player_turns');
      const cmd = await cmdOf(roomId, { type: 'action', action });
      const all = await Promise.all(Array.from({ length: 5 }, () => m.command(a, cmd)));
      expect(all.every((r) => r.ok)).toBe(true);
      expect(all.filter((r) => !r.duplicate)).toHaveLength(1);
      expect(await n(`select count(*)::int as n from ledger where kind = 'stake_reserve'`)).toBe(2); // bet + one extra
      // A double ends the turn and the dealer plays on timers: compare states only once the table is still.
      if (action === 'double') await waitFor(async () => (await phase(db, roomId)) === 'results', 5000);
      await m.idle();
      const st = await state(roomId, [a.id]);
      const conflict = await m.command(a, { ...cmd, action: 'hit' } as Command);
      expect(conflict).toMatchObject({ ok: false, error: 'idempotency_conflict' });
      expect(await state(roomId, [a.id])).toEqual(st);
      expect((await m.command(a, cmd)).duplicate).toBe(true);
      await assertLedgerConsistent(db);
    });
  }
});

describe('gifts: the client event id is the key', () => {
  it('repeated and concurrent sends record one gift; the same id for another gift, recipient or room is refused', async () => {
    const m = mk(db);
    const [a, b, c] = [await makeUser(db, 'A'), await makeUser(db, 'B'), await makeUser(db, 'C')];
    const { roomId } = await m.createRoom(a, { mode: 'casual', settings: {}, matchStackCoins: 1000, matchRounds: 2 });
    const other = (await m.createRoom(a, { mode: 'casual', settings: {}, matchStackCoins: 1000, matchRounds: 2 })).roomId;
    const eventId = key();
    const input = { roomId, senderId: a.id, recipientId: b.id, giftId: 'coffee' as const, eventId, now: Date.now() };
    const all = await Promise.all(Array.from({ length: 5 }, () => sendGift(db, input)));
    expect(all.every((r) => r.ok)).toBe(true);
    expect(all.filter((r) => r.ok && !r.duplicate)).toHaveLength(1);
    expect(await n(`select count(*)::int as n from gift_events`)).toBe(1);
    for (const changed of [{ giftId: 'rose' as const }, { recipientId: c.id }, { roomId: other }]) {
      expect(await sendGift(db, { ...input, ...changed, now: Date.now() + 60_000 })).toEqual({ ok: false, error: 'idempotency_conflict' });
    }
    expect(await n(`select count(*)::int as n from gift_events`)).toBe(1);
  });
});

describe('HTTP: Idempotency-Key header', () => {
  async function post(app: Awaited<ReturnType<typeof makeApp>>, url: string, body: unknown, k?: string, cookie?: string) {
    const res = await app.server.app.inject({
      method: 'POST',
      url,
      headers: { 'x-t21': '1', 'content-type': 'application/json', ...(k ? { 'idempotency-key': k } : {}), ...(cookie ? { cookie } : {}) },
      payload: JSON.stringify(body),
    });
    const set = (res.cookies as { name: string; value: string }[]).find((x) => x.name === 't21s');
    return { status: res.statusCode, body: res.json(), cookie: set ? `t21s=${set.value}` : cookie };
  }

  it('daily grant: the same key (sequential and 5 at once) pays once and answers the same; the key is saved with the payment', async () => {
    const app = await makeApp(db);
    apps.push(app);
    const g = await post(app, '/api/session', { name: 'G', avatar: 'amber', locale: 'he' });
    const k = key();
    const all = await Promise.all(Array.from({ length: 5 }, () => post(app, '/api/grants/daily', {}, k, g.cookie)));
    expect(all.map((r) => r.body)).toEqual(Array(5).fill({ ok: true }));
    expect((await post(app, '/api/grants/daily', {}, k, g.cookie)).body).toEqual({ ok: true }); // replay, not "already claimed"
    expect((await post(app, '/api/grants/daily', {}, key(), g.cookie)).body).toEqual({ ok: false, reason: 'already_claimed' });
    expect(await n(`select count(*)::int as n from ledger where kind = 'grant_daily'`)).toBe(1);
    expect(await n(`select count(*)::int as n from idempotency_keys where key = $1`, [k])).toBe(1);
    await assertLedgerConsistent(db);
  });

  it('the same key with a different body is refused with 409 and creates nothing (guest, room, club, grant)', async () => {
    const app = await makeApp(db);
    apps.push(app);
    const k = key();
    const g = await post(app, '/api/session', { name: 'One', avatar: 'amber', locale: 'he' }, k);
    expect(g.status).toBe(200);
    const dupGuest = await post(app, '/api/session', { name: 'Two', avatar: 'amber', locale: 'he' }, k);
    expect(dupGuest).toMatchObject({ status: 409, body: { error: 'idempotency_conflict' } });
    expect(await n(`select count(*)::int as n from users`)).toBe(1);

    const r1 = await post(app, '/api/rooms', { mode: 'casual', settings: { turnSeconds: 25 } }, k, g.cookie);
    const r2 = await post(app, '/api/rooms', { mode: 'casual', settings: { turnSeconds: 40 } }, k, g.cookie);
    expect(r1.status).toBe(200);
    expect(r2).toMatchObject({ status: 409, body: { error: 'idempotency_conflict' } });
    expect(await n(`select count(*)::int as n from rooms`)).toBe(1);

    const c1 = await post(app, '/api/groups', { name: 'Friday' }, k, g.cookie);
    const c2 = await post(app, '/api/groups', { name: 'Saturday' }, k, g.cookie);
    expect(c1.status).toBe(200);
    expect(c2.status).toBe(409);
    expect(await db.query(`select name from groups`)).toEqual([{ name: 'Friday' }]);

    const before = await n(`select count(*)::int as n from ledger`);
    expect((await post(app, '/api/grants/daily', {}, k, g.cookie)).status).toBe(200);
    expect((await post(app, '/api/grants/daily', { extra: 1 }, k, g.cookie)).status).toBe(409);
    expect(await n(`select count(*)::int as n from ledger`)).toBe(before + 1);
  });
});

describe('settlement and grants inside the server: the ledger idem_key', () => {
  it('the same ledger key with the same movement is a no-op; with a different movement it is refused and nothing changes', async () => {
    const a = await makeUser(db, 'A');
    await db.tx(async (q) => {
      const w = await lockWallet(q, a.id, 'casual');
      expect(await move(q, w, 'stake_reserve', -20, 20, { idemKey: 'test:reserve' })).toBe(true);
    });
    await db.tx(async (q) => {
      const w = await lockWallet(q, a.id, 'casual');
      expect(await move(q, w, 'stake_reserve', -20, 20, { idemKey: 'test:reserve' })).toBe(false);
    });
    const before = { w: await wallet(db, a.id), l: await n(`select count(*)::int as n from ledger`) };
    for (const [kind, da, dr] of [['stake_reserve', -40, 40], ['stake_return', 20, -20]] as const) {
      await expect(
        db.tx(async (q) => {
          const w = await lockWallet(q, a.id, 'casual');
          await move(q, w, kind, da, dr, { idemKey: 'test:reserve' });
        }),
      ).rejects.toBeInstanceOf(IdempotencyConflict);
    }
    expect({ w: await wallet(db, a.id), l: await n(`select count(*)::int as n from ledger`) }).toEqual(before);
    await assertLedgerConsistent(db);
  });

  it('a whole round with retries everywhere: every movement in the ledger has a key, and every coin is accounted for', async () => {
    const { m, a, roomId } = await seated(['9', '10', '7', '8']);
    const bet = await cmdOf(roomId, { type: 'bet', coins: 10 });
    await m.command(a, bet);
    await m.command(a, bet);
    await waitFor(async () => (await phase(db, roomId)) === 'player_turns');
    const stand = await cmdOf(roomId, { type: 'action', action: 'stand' });
    await Promise.all([m.command(a, stand), m.command(a, stand)]);
    await waitFor(async () => (await phase(db, roomId)) === 'results', 5000);
    await m.idle();
    await (m as any).tick(roomId, 1);
    expect(await n(`select count(*)::int as n from ledger where idem_key is null`)).toBe(0);
    expect(await n(`select count(*)::int as n from settlements`)).toBe(1);
    const w = await wallet(db, a.id);
    expect(w.r).toBe(0);
    expect(w.a).toBe(4000 - 20 + (await n(`select return_units as n from settlements`)));
    await assertLedgerConsistent(db);
  });
});
