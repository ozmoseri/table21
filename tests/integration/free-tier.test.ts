import { randomUUID } from 'node:crypto';
import { gunzipSync } from 'node:zlib';
import { afterAll, afterEach, beforeEach, describe, expect, it } from 'vitest';
import { postgresDb, migrate, type Db, type Q } from '../../apps/server/src/db.ts';
import type { RoomManager } from '../../apps/server/src/rooms.ts';
import { exportDb, fingerprint, restoreDb, type Backup } from '../../apps/server/src/backup.ts';
import { Pilot } from '../../apps/server/src/pilot.ts';
import { FAST, ShoeQueue, TEST_DB_URL, assertLedgerConsistent, freshDb, makeUser, manager, phase, send, shoeOf, waitFor, wallet } from './setup.ts';
import { makeApp } from './http.ts';

/** Render free-tier risks (docs/QA_REPORT.md section 6): cold-start retries, a database lost mid-payout, backups. */
let db: Db;
const managers: RoomManager[] = [];
let apps: Awaited<ReturnType<typeof makeApp>>[] = [];
const extraDbs: Db[] = [];
beforeEach(async () => {
  if (db) await db.close();
  db = await freshDb();
});
afterEach(async () => {
  for (const m of managers.splice(0)) m.stop();
  for (const a of apps.splice(0)) await a.server.close();
  for (const d of extraDbs.splice(0)) await d.close();
});
afterAll(async () => db?.close());

const key = () => randomUUID().replace(/-/g, '');
const count = async (sql: string, p: unknown[] = []) => Number((await db.query(sql, p))[0].n);

async function rawPost(app: Awaited<ReturnType<typeof makeApp>>, url: string, body: unknown, headers: Record<string, string> = {}, cookie?: string) {
  const res = await app.server.app.inject({
    method: 'POST',
    url,
    headers: { 'x-t21': '1', 'content-type': 'application/json', ...(cookie ? { cookie } : {}), ...headers },
    payload: JSON.stringify(body),
  });
  const set = (res.cookies as { name: string; value: string }[]).find((c) => c.name === 't21s');
  return { status: res.statusCode, body: res.json(), cookie: set ? `t21s=${set.value}` : undefined };
}
const meOf = async (app: Awaited<ReturnType<typeof makeApp>>, cookie: string) =>
  (await app.server.app.inject({ method: 'GET', url: '/api/me', headers: { cookie } })).json();

describe('cold start: a retried create is applied once (Idempotency-Key)', () => {
  it('guest creation retried after a lost response: one account, one welcome grant, both attempts signed in to it', async () => {
    const app = await makeApp(db);
    apps.push(app);
    const k = key();
    const body = { name: 'Waking', avatar: 'amber', locale: 'he' };
    const first = await rawPost(app, '/api/session', body, { 'idempotency-key': k });
    // The phone never saw `first` (the proxy dropped it while the server woke up) and retries with the same key.
    const retry = await rawPost(app, '/api/session', body, { 'idempotency-key': k });
    expect(first.status).toBe(200);
    expect(retry.status).toBe(200);
    expect(first.body.replayed).toBe(false);
    expect(retry.body.replayed).toBe(true);
    expect(await count(`select count(*) as n from users`)).toBe(1);
    expect(await count(`select count(*) as n from ledger where kind = 'grant_welcome'`)).toBe(1);
    const a = await meOf(app, first.cookie!);
    const b = await meOf(app, retry.cookie!);
    expect(b.userId).toBe(a.userId);
    expect(b.wallet).toEqual(a.wallet);
    await assertLedgerConsistent(db);
  });

  it('five concurrent retries with one key create one account; different keys create different accounts', async () => {
    const app = await makeApp(db);
    apps.push(app);
    const k = key();
    const body = { name: 'Burst', avatar: 'amber', locale: 'he' };
    const all = await Promise.all(Array.from({ length: 5 }, () => rawPost(app, '/api/session', body, { 'idempotency-key': k })));
    expect(all.every((r) => r.status === 200)).toBe(true);
    expect(await count(`select count(*) as n from users`)).toBe(1);
    const ids = new Set(await Promise.all(all.map(async (r) => (await meOf(app, r.cookie!)).userId)));
    expect(ids.size).toBe(1);
    await rawPost(app, '/api/session', body, { 'idempotency-key': key() });
    await rawPost(app, '/api/session', body); // no key: plain creation, as before
    expect(await count(`select count(*) as n from users`)).toBe(3);
    expect(await count(`select count(*) as n from ledger where kind = 'grant_welcome'`)).toBe(3);
  });

  it('a malformed key is ignored rather than trusted', async () => {
    const app = await makeApp(db);
    apps.push(app);
    for (let i = 0; i < 2; i++) await rawPost(app, '/api/session', { name: 'X', avatar: 'amber', locale: 'he' }, { 'idempotency-key': 'short' });
    expect(await count(`select count(*) as n from users`)).toBe(2);
    expect(await count(`select count(*) as n from idempotency_keys`)).toBe(0);
  });

  it('room and club creation retried with the same key return the same room and club; keys are per user', async () => {
    const app = await makeApp(db);
    apps.push(app);
    const a = await rawPost(app, '/api/session', { name: 'A', avatar: 'amber', locale: 'he' });
    const b = await rawPost(app, '/api/session', { name: 'B', avatar: 'amber', locale: 'he' });
    const k = key();
    const room = { mode: 'casual', settings: {} };
    const r1 = await rawPost(app, '/api/rooms', room, { 'idempotency-key': k }, a.cookie);
    const r2 = await rawPost(app, '/api/rooms', room, { 'idempotency-key': k }, a.cookie);
    expect(r1.status).toBe(200);
    expect(r2.body).toEqual(r1.body);
    const rb = await rawPost(app, '/api/rooms', room, { 'idempotency-key': k }, b.cookie); // same key, other user
    expect(rb.body.roomId).not.toBe(r1.body.roomId);
    expect(await count(`select count(*) as n from rooms`)).toBe(2);
    const g = await Promise.all([1, 2, 3].map(() => rawPost(app, '/api/groups', { name: 'Club' }, { 'idempotency-key': k }, a.cookie)));
    expect(new Set(g.map((x) => x.body.id)).size).toBe(1);
    expect(await count(`select count(*) as n from groups`)).toBe(1);
    expect(await count(`select count(*) as n from group_members`)).toBe(1);
  });

  it('keys expire after a day, so the table stays small', async () => {
    const app = await makeApp(db);
    apps.push(app);
    const k = key();
    await rawPost(app, '/api/session', { name: 'Old', avatar: 'amber', locale: 'he' }, { 'idempotency-key': k });
    await db.query(`update idempotency_keys set created_at = now() - interval '25 hours'`);
    const again = await rawPost(app, '/api/session', { name: 'Old', avatar: 'amber', locale: 'he' }, { 'idempotency-key': k });
    expect(again.body.replayed).toBe(false);
    expect(await count(`select count(*) as n from idempotency_keys`)).toBe(1);
  });
});

/**
 * A database wrapper that can cut the real connection in the middle of a transaction: it asks Postgres to terminate
 * the backend that is running the transaction (pg_terminate_backend), exactly what a database restart or a dropped
 * network does. While `down` is true every matching statement is cut, so retries fail too (an outage).
 */
function cuttable(inner: Db, shouldCut: (sql: string, params: unknown[]) => boolean) {
  const state = { down: false, cuts: 0 };
  const wrap = (q: Q): Q => ({
    async query(sql, params) {
      if (state.down && shouldCut(sql, params ?? [])) {
        state.cuts++;
        await q.query('select pg_terminate_backend(pg_backend_pid())');
      }
      return q.query(sql, params);
    },
  });
  const db: Db = { kind: inner.kind, query: (s, p) => inner.query(s, p), tx: (fn) => inner.tx((q) => fn(wrap(q))), close: () => inner.close() };
  return { db, state };
}

describe('database lost in the middle of a payout', () => {
  it('the payout rolls back as a whole, the room waits, and settles exactly once when the database is back', async () => {
    const inner = postgresDb(TEST_DB_URL);
    extraDbs.push(inner);
    const [a, b] = [await makeUser(db, 'A'), await makeUser(db, 'B')];
    const [first, second] = [a, b].sort((x, y) => x.id.localeCompare(y.id)); // settlement pays in player id order
    const secondWallet = (await db.query(`select id from wallets where user_id = $1 and scope = 'casual'`, [second.id]))[0].id;
    // Cut on the second player's payout: the first player's return is already written inside the transaction.
    const cut = cuttable(inner, (sql, p) => sql.includes('insert into ledger') && p[0] === secondWallet && p[1] === 'stake_return');
    const shoes = new ShoeQueue();
    // A 10+8, B 9+7, dealer 10 up + 6 hole, draws 10 -> 26 bust: both win 1:1
    shoes.shoes.push(shoeOf(['10', '9', '10', '8', '7', '6', '10']));
    const m = manager(cut.db, { shoes, timing: { ...FAST, dbRetryMs: 40, dbRetryMaxMs: 160 } });
    managers.push(m);
    const { roomId } = await m.createRoom(a, { mode: 'casual', settings: {}, matchStackCoins: 1000, matchRounds: 2 });
    for (const u of [a, b]) {
      await m.connect(roomId, u.id);
      await send(m, u, roomId, { type: 'sit' });
    }
    await send(m, a, roomId, { type: 'bet', coins: 25 });
    await send(m, b, roomId, { type: 'bet', coins: 10 });
    await waitFor(async () => (await phase(db, roomId)) === 'player_turns');
    const before = { a: await wallet(db, a.id), b: await wallet(db, b.id) };
    cut.state.down = true; // the outage starts before the dealer finishes
    for (const u of [a, b]) {
      const st = await m._engineState(roomId);
      const who = st?.turn ? st.seats[st.turn.seat].playerId : null;
      await send(m, who === a.id ? a : b, roomId, { type: 'action', action: 'stand' });
      void u;
    }
    // The payout transaction is cut, then every retry is cut while the database is "down".
    await waitFor(async () => cut.state.cuts >= 3, 8000);

    // Paused safely: nothing paid, round not marked finished, stakes still reserved, room still in the dealer turn.
    const roundId = (await db.query(`select id from rounds where room_id = $1 order by created_at desc limit 1`, [roomId]))[0].id;
    expect((await db.query(`select finished_at from rounds where id = $1`, [roundId]))[0].finished_at).toBeNull();
    expect(await count(`select count(*) as n from settlements where round_id = $1`, [roundId])).toBe(0);
    expect(await count(`select count(*) as n from ledger where kind = 'stake_return'`)).toBe(0);
    expect(await wallet(db, a.id)).toEqual(before.a);
    expect(await wallet(db, b.id)).toEqual(before.b);
    expect(await phase(db, roomId)).toBe('dealer_turn');
    await assertLedgerConsistent(db);

    // A second server instance starts during the outage (Render restarts the service): it must not pay either.
    const m2 = manager(cut.db, { shoes: new ShoeQueue(), timing: { ...FAST, dbRetryMs: 40, dbRetryMaxMs: 160 } });
    managers.push(m2);
    await m2.recover();

    cut.state.down = false; // the database is back
    await waitFor(async () => (await phase(db, roomId)) === 'results', 8000);
    await m.idle();
    await m2.idle();
    // Stale timers from both instances fire again: still exactly once.
    await (m as any).tick(roomId, 1);
    await (m2 as any).tick(roomId, 1);

    const settled = await db.query(`select user_id, stake_units, return_units from settlements where round_id = $1 order by user_id`, [roundId]);
    expect(settled).toHaveLength(2);
    expect(await count(`select count(*) as n from ledger where kind = 'stake_return' and round_id = $1`, [roundId])).toBe(2);
    expect(await wallet(db, first.id)).toMatchObject({ r: 0 });
    expect(await wallet(db, a.id)).toEqual({ a: before.a.a + 100, r: 0 }); // 25 coins = 50 units staked, 100 back
    expect(await wallet(db, b.id)).toEqual({ a: before.b.a + 40, r: 0 }); // 10 coins = 20 units staked, 40 back
    await assertLedgerConsistent(db);
  });

  it('an idle connection dropped by the database does not crash the server; the next query reconnects', async () => {
    const pool = postgresDb(TEST_DB_URL);
    extraDbs.push(pool);
    await pool.query('select 1');
    const pids = (await db.query(`select pid from pg_stat_activity where datname = current_database() and pid <> pg_backend_pid() and state = 'idle'`)).map((r) => r.pid);
    for (const pid of pids) await db.query('select pg_terminate_backend($1)', [pid]);
    await new Promise((r) => setTimeout(r, 100));
    expect((await pool.query('select 1 as one'))[0].one).toBe(1);
  });
});

describe('free database expiry and backups', () => {
  it('the pilot card shows the database end date to the operator only', async () => {
    const created = '2026-11-01T10:00:00.000Z';
    const now = () => Date.parse('2026-11-25T10:00:00.000Z');
    const app = await makeApp(db, { pilot: { plan: 'render-free', dbCreated: created }, now });
    apps.push(app);
    const owner = app.device();
    await owner.guest('Oz');
    const other = app.device();
    await other.guest('Friend');
    expect((await owner.get('/api/me')).body.admin).toBe(true); // first account on the server
    expect((await other.get('/api/me')).body.admin).toBe(false);
    const p = (await owner.get('/api/admin/pilot')).body.pilot;
    expect(p.dbExpiresAt).toBe('2026-12-01T10:00:00.000Z'); // 30 days
    expect(p.dbDeletedAt).toBe('2026-12-15T10:00:00.000Z'); // + 14 days grace
    expect(p.daysLeft).toBe(6);
    expect(p.state).toBe('soon');
    expect(p.dbLimitBytes).toBe(1024 ** 3);
    expect(p.hoursPerMonth).toBe(750);
    expect(p.dbBytes).toBeGreaterThan(0);
    expect((await other.get('/api/admin/pilot')).status).toBe(403);
    expect((await other.get('/api/admin/backup')).status).toBe(403);
  });

  it('without a pilot plan (local, LAN, paid) nobody is admin and the routes are closed', async () => {
    const app = await makeApp(db, { pilot: {} });
    apps.push(app);
    const d = app.device();
    await d.guest('Oz');
    expect((await d.get('/api/me')).body.admin).toBe(false);
    expect((await d.get('/api/admin/pilot')).status).toBe(403);
  });

  it('T21_ADMIN_USER_IDS picks the operator explicitly; the end date defaults to the first migration', async () => {
    const app = await makeApp(db, { pilot: { plan: 'render-free' } });
    apps.push(app);
    const first = app.device();
    await first.guest('First');
    const second = app.device();
    const me2 = await second.guest('Oz');
    const pilot = new Pilot(db, { plan: 'render-free', adminIds: `x, ${me2.userId}` });
    expect(await pilot.isAdmin(me2.userId)).toBe(true);
    expect(await pilot.isAdmin((await first.get('/api/me')).body.userId)).toBe(false);
    const info = (await pilot.info())!;
    expect(info.dbCreatedSource).toBe('first_migration');
    const applied = (await db.query(`select min(applied_at) as t from schema_migrations`))[0].t as Date;
    expect(Date.parse(info.dbExpiresAt) - applied.getTime()).toBe(30 * 24 * 3600 * 1000);
  });

  it('backup downloaded by the operator restores into an empty database with every row and every coin', async () => {
    // Some real activity: accounts, a club, a played and settled round, a daily grant.
    const app = await makeApp(db, { pilot: { plan: 'render-free' } });
    apps.push(app);
    const oz = app.device();
    await oz.guest('Oz');
    await oz.post('/api/grants/daily');
    await oz.post('/api/groups', { name: 'Friday' });
    await oz.post('/api/auth/recovery-codes');
    const m = manager(db, { shoes: new ShoeQueue() });
    managers.push(m);
    const p = await makeUser(db, 'Player');
    const { roomId } = await m.createRoom(p, { mode: 'casual', settings: {}, matchStackCoins: 1000, matchRounds: 2 });
    await m.connect(roomId, p.id);
    await send(m, p, roomId, { type: 'sit' });
    await send(m, p, roomId, { type: 'bet', coins: 10 });
    await waitFor(async () => (await phase(db, roomId)) === 'player_turns' || (await phase(db, roomId)) === 'results');
    if ((await phase(db, roomId)) === 'player_turns') await send(m, p, roomId, { type: 'action', action: 'stand' });
    await waitFor(async () => (await phase(db, roomId)) === 'results', 8000);
    await m.idle();
    m.stop();

    const res = await app.server.app.inject({ method: 'GET', url: '/api/admin/backup', headers: { cookie: [...oz.cookies].map(([k, v]) => `${k}=${v}`).join('; ') } });
    expect(res.statusCode).toBe(200);
    expect(res.headers['content-disposition']).toMatch(/table21-backup-\d{4}-\d{2}-\d{2}\.json\.gz/);
    const backup = JSON.parse(gunzipSync(res.rawPayload).toString()) as Backup;
    const source = await fingerprint(db);
    expect(source.tables.settlements).toBeGreaterThan(0);

    // Restore into a separate, empty database (own schema in the test database), migrated to the same version.
    const target = postgresDb(TEST_DB_URL.replace(/\/table21_test$/, '/table21_restore_test'));
    extraDbs.push(target);
    await ensureDatabase('table21_restore_test');
    await target.query('drop schema if exists public cascade');
    await target.query('create schema public');
    await migrate(target);
    const report = await restoreDb(target, backup);
    expect(report.tables.users).toBe(source.tables.users);
    const restored = await fingerprint(target);
    expect(restored).toEqual(source);
    await assertLedgerConsistent(target);
    // The bigserial counters continue after the restored ids.
    const next = await target.query(`select nextval(pg_get_serial_sequence('ledger', 'id')) as n`);
    const max = await target.query(`select max(id) as n from ledger`);
    expect(Number(next[0].n)).toBeGreaterThan(Number(max[0].n));
    // The restored server works with the old session: same account, same coins.
    const app2 = await makeApp(target, { pilot: { plan: 'render-free' } });
    apps.push(app2);
    const oz2 = app2.device();
    oz2.cookies = new Map(oz.cookies);
    expect((await oz2.get('/api/me')).body).toMatchObject({ name: 'Oz', wallet: (await oz.get('/api/me')).body.wallet });
    // Restoring twice is refused: nothing is ever overwritten.
    await expect(restoreDb(target, backup)).rejects.toThrow(/not empty/);
    // A backup from a different schema version is refused.
    await expect(restoreDb(target, { ...backup, migrations: backup.migrations.slice(0, 1) })).rejects.toThrow(/schema mismatch/);
    expect((await exportDb(target)).tables.users.rows).toHaveLength(source.tables.users);
  });
});

async function ensureDatabase(name: string) {
  const admin = postgresDb(TEST_DB_URL.replace(/\/table21_test$/, '/postgres'));
  try {
    const has = await admin.query('select 1 from pg_database where datname = $1', [name]);
    if (!has.length) await admin.query(`create database ${name}`);
  } finally {
    await admin.close();
  }
}
