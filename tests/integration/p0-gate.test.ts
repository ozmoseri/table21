import { randomUUID } from 'node:crypto';
import { afterAll, afterEach, beforeEach, describe, expect, it } from 'vitest';
import { io as ioc, type Socket } from 'socket.io-client';
import type { Db } from '../../apps/server/src/db.ts';
import type { RoomManager } from '../../apps/server/src/rooms.ts';
import { FAST, ShoeQueue, assertLedgerConsistent, freshDb, makeUser, manager, phase, send, shoeOf, version, waitFor, wallet } from './setup.ts';
import { makeApp } from './http.ts';

/** P0 acceptance gate: resilience of money and state, and server-side security (docs/QA_REPORT.md). */
let db: Db;
const managers: RoomManager[] = [];
const mk = (...a: Parameters<typeof manager>) => {
  const m = manager(...a);
  managers.push(m);
  return m;
};
let apps: Awaited<ReturnType<typeof makeApp>>[] = [];
const sockets: Socket[] = [];
beforeEach(async () => {
  if (db) await db.close();
  db = await freshDb();
});
afterEach(async () => {
  for (const s of sockets.splice(0)) s.close();
  for (const m of managers.splice(0)) m.stop();
  for (const a of apps.splice(0)) await a.server.close();
});
afterAll(async () => db?.close());

const turnOf = async (m: RoomManager, roomId: string) => {
  const s = await m._engineState(roomId);
  return s?.phase === 'player_turns' && s.turn ? s.seats[s.turn.seat].playerId : null;
};
const sumWallets = async () => Number((await db.query(`select coalesce(sum(available_units + reserved_units), 0)::bigint as n from wallets where scope = 'casual'`))[0].n);
const sumGrants = async () => Number((await db.query(`select coalesce(sum(delta_available), 0)::bigint as n from ledger where kind like 'grant_%'`))[0].n);
/** House view: every coin a player holds came from a grant, minus stakes, plus returns. Nothing else may create coins. */
async function assertCoinsAccounted() {
  const r = (await db.query(`select coalesce(sum(stake_units), 0)::bigint as s, coalesce(sum(return_units), 0)::bigint as r from settlements`))[0];
  const open = Number((await db.query(`select coalesce(sum(reserved_units), 0)::bigint as n from wallets`))[0].n);
  expect(await sumWallets()).toBe((await sumGrants()) - Number(r.s) + Number(r.r) + 0 * open);
  await assertLedgerConsistent(db);
}

describe('resilience: crash and restart in the middle of a hand', () => {
  for (const point of ['after bets, before the deal', 'in the middle of the turns', 'during the dealer turn'] as const) {
    it(`crash ${point}: the hand recovers, settles once, no coin is lost or duplicated`, async () => {
      const shoes = new ShoeQueue();
      // P0 10+8, P1 9+7, dealer 6 up, 5 hole, then draws: 10 -> 21
      shoes.shoes.push(shoeOf(['10', '9', '6', '8', '7', '5', '10']));
      const m = mk(db, { shoes, timing: point === 'after bets, before the deal' ? { ...FAST, autoDealDelayMs: 60_000 } : FAST });
      const [a, b] = [await makeUser(db, 'A'), await makeUser(db, 'B')];
      const { roomId } = await m.createRoom(a, { mode: 'casual', settings: {}, matchStackCoins: 1000, matchRounds: 2 });
      for (const u of [a, b]) {
        await m.connect(roomId, u.id);
        await send(m, u, roomId, { type: 'sit' });
      }
      const grants = await sumGrants();
      await send(m, a, roomId, { type: 'bet', coins: 25 });
      await send(m, b, roomId, { type: 'bet', coins: 10 });
      if (point !== 'after bets, before the deal') {
        await waitFor(async () => (await turnOf(m, roomId)) === a.id);
        if (point === 'during the dealer turn') {
          await send(m, a, roomId, { type: 'action', action: 'stand' });
          await send(m, b, roomId, { type: 'action', action: 'stand' });
        } else await send(m, a, roomId, { type: 'action', action: 'stand' });
      }
      expect(await sumWallets()).toBe(grants); // reserved stakes still count as the player's until settled
      m.stop(); // crash: memory and timers gone, the database stays

      // The outage outlasted the stored betting deadline: the restarted server must deal from the reserved stakes.
      if (point === 'after bets, before the deal') await db.query(`update rooms set deadline_at = now() where id = $1`, [roomId]);
      for (let redeploy = 0; redeploy < 2; redeploy++) {
        const m2 = mk(db, { shoes: new ShoeQueue(), timing: FAST });
        await m2.recover();
        for (const u of [a, b]) await m2.connect(roomId, u.id);
        if (redeploy === 0) {
          for (let i = 0; i < 20 && (await phase(db, roomId)) !== 'results'; i++) {
            const who = await turnOf(m2, roomId);
            if (who) await send(m2, who === a.id ? a : b, roomId, { type: 'action', action: 'stand' });
            else if ((await phase(db, roomId)) === 'betting') await (m2 as any).tick(roomId, await version(db, roomId));
            await new Promise((r) => setTimeout(r, 40));
          }
          await waitFor(async () => (await phase(db, roomId)) === 'results', 8000);
        }
        // A stale timer after another redeploy must not settle again.
        await (m2 as any).tick(roomId, 1);
        m2.stop();
      }
      const settled = await db.query(`select user_id, stake_units, return_units from settlements order by user_id`);
      expect(settled).toHaveLength(2);
      expect((await db.query(`select count(*)::int as n from ledger where kind = 'stake_return'`))[0].n).toBeLessThanOrEqual(2);
      const wa = await wallet(db, a.id);
      expect(wa.r).toBe(0);
      await assertCoinsAccounted();
    });
  }

  it('a command retried after a restart with the same commandId is applied once', async () => {
    const shoes = new ShoeQueue();
    shoes.shoes.push(shoeOf(['10', '6', '8', '5']));
    const m = mk(db, { shoes, timing: { ...FAST, autoDealDelayMs: 60_000 } });
    const a = await makeUser(db, 'A');
    const { roomId } = await m.createRoom(a, { mode: 'casual', settings: {}, matchStackCoins: 1000, matchRounds: 2 });
    await m.connect(roomId, a.id);
    await send(m, a, roomId, { type: 'sit' });
    const cmd = { commandId: randomUUID().replace(/-/g, ''), roomId, expectedVersion: await version(db, roomId), type: 'bet' as const, coins: 50 };
    expect((await m.command(a, cmd)).ok).toBe(true);
    m.stop();
    const m2 = mk(db, { shoes: new ShoeQueue(), timing: { ...FAST, autoDealDelayMs: 60_000 } });
    await m2.recover();
    await m2.connect(roomId, a.id);
    const again = await m2.command(a, cmd);
    expect(again.ok).toBe(true);
    expect(await wallet(db, a.id)).toEqual({ a: 4000 - 100, r: 100 });
    await assertLedgerConsistent(db);
  });

  it('data survives a redeploy (Postgres): same session, same wallet, same friends', async () => {
    const first = await makeApp(db);
    apps.push(first);
    const d = first.device();
    const me = await d.guest('Persist');
    await d.post('/api/grants/daily');
    const before = (await d.get('/api/me')).body;
    await first.server.close();
    apps = [];
    const second = await makeApp(db);
    apps.push(second);
    const d2 = second.device();
    d2.cookies = new Map(d.cookies);
    const after = (await d2.get('/api/me')).body;
    expect(after.userId).toBe(me.userId);
    expect(after.wallet).toEqual(before.wallet);
    expect(after.grants.dailyAvailable).toBe(false);
  });
});

describe('security on the server', () => {
  async function liveApp() {
    const shoes = new ShoeQueue();
    const ctx = await makeApp(db, { timing: FAST, shoeFactory: shoes.next });
    apps.push(ctx);
    await ctx.server.app.listen({ port: 0, host: '127.0.0.1' });
    const port = (ctx.server.app.server.address() as any).port;
    const connect = (cookie?: string): Promise<Socket> =>
      new Promise((res, rej) => {
        const s = ioc(`http://127.0.0.1:${port}`, { transports: ['websocket'], extraHeaders: cookie ? { cookie } : {}, forceNew: true, reconnection: false });
        sockets.push(s);
        s.on('connect', () => res(s));
        s.on('connect_error', (e) => rej(e));
      });
    return { ctx, shoes, connect };
  }
  const emit = (s: Socket, ev: string, payload: unknown) => new Promise<any>((res) => s.emit(ev, payload, res));

  it('no impersonation, no hole card before the reveal, no blocked action through the socket', async () => {
    const { ctx, shoes, connect } = await liveApp();
    shoes.shoes.push(shoeOf(['10', '9', '6', '7', 'Q', '5']));
    const a = ctx.device();
    const meA = await a.guest('A');
    const b = ctx.device();
    const meB = await b.guest('B');
    const room = (await a.post('/api/rooms', { mode: 'casual', settings: {} })).body;

    await expect(connect()).rejects.toThrow(/unauthorized/);
    const sa = await connect(`t21s=${a.token}`);
    const sb = await connect(`t21s=${b.token}`);
    const frames: string[] = [];
    sb.on('room:state', (s) => frames.push(JSON.stringify(s)));

    const cmd = async (s: Socket, c: Record<string, unknown>) => {
      const snap = (await emit(s, 'room:sync', {})).snapshot;
      return emit(s, 'cmd', { commandId: randomUUID().replace(/-/g, ''), roomId: room.roomId, expectedVersion: snap.version, ...c });
    };
    // A command for a room this socket has not joined is refused.
    expect((await emit(sa, 'cmd', { commandId: randomUUID().replace(/-/g, ''), roomId: room.roomId, expectedVersion: 0, type: 'sit' })).error).toBe('forbidden');
    await emit(sa, 'room:join', { code: room.code });
    await emit(sb, 'room:join', { code: room.code });
    await cmd(sa, { type: 'sit' });
    await cmd(sb, { type: 'sit' });
    // Acting before the deal is a blocked action.
    expect((await cmd(sa, { type: 'action', action: 'hit' })).error).toBe('wrong_phase');
    await cmd(sa, { type: 'bet', coins: 10 });
    await cmd(sb, { type: 'bet', coins: 10 });
    await waitFor(async () => (await emit(sa, 'room:sync', {})).snapshot.phase === 'player_turns', 5000);

    // It is A's turn: B cannot act, not even by naming A in the payload.
    expect((await cmd(sb, { type: 'action', action: 'stand' })).error).toBe('not_your_turn');
    expect((await cmd(sb, { type: 'action', action: 'stand', userId: meA.userId, playerId: meA.userId })).ok).toBe(false);
    // Split is not legal on 10+7, double after a hit is not legal, and a stale version is rejected.
    expect((await cmd(sa, { type: 'action', action: 'split' })).error).toBe('illegal_action');
    expect((await emit(sa, 'cmd', { commandId: randomUUID().replace(/-/g, ''), roomId: room.roomId, expectedVersion: 1, type: 'action', action: 'hit' })).error).toBe('stale_version');
    expect((await cmd(sa, { type: 'action', action: 'hit' })).ok).toBe(true);
    expect((await cmd(sa, { type: 'action', action: 'double' })).ok).toBe(false);

    // Until the dealer reveals, nothing B received names the hole card (5 of the stacked shoe) or carries the shoe.
    const snap = (await emit(sb, 'room:sync', {})).snapshot;
    const all = [...frames, JSON.stringify(snap)];
    for (const f of all) {
      expect(f).not.toContain('"shoe"');
      expect(f).not.toContain('"uid"');
      const s = JSON.parse(f);
      if (s.round && !s.round.dealer.revealed) {
        expect(s.round.dealer.cards[1]).toMatchObject({ hidden: true });
        expect(s.round.dealer.cards[1].rank).toBeUndefined();
      }
    }
    expect(meB.userId).not.toBe(meA.userId);
  });

  it('recovery codes are rate limited and can be revoked; practice coins never reach the online wallet', async () => {
    const { ctx } = await liveApp();
    const owner = ctx.device();
    await owner.guest('Owner');
    const codes = (await owner.post('/api/auth/recovery-codes')).body.codes as string[];
    const attacker = ctx.device();
    const statuses: number[] = [];
    for (let i = 0; i < 12; i++) statuses.push((await attacker.post('/api/auth/recover', { code: `ZZZZ-ZZZZ-${String(1000 + i)}` })).status);
    expect(statuses.slice(0, 10).every((s) => s === 400)).toBe(true);
    expect(statuses.slice(10)).toEqual([429, 429]);
    // Even the right code is refused while rate limited.
    expect((await attacker.post('/api/auth/recover', { code: codes[0] })).status).toBe(429);

    // Revocation (on a fresh server so the attacker's rate limit does not apply): new codes invalidate the old set;
    // "sign out other devices" ends a stolen session.
    await ctx.server.close();
    apps = apps.filter((x) => x !== ctx);
    const { ctx: ctx2 } = await liveApp();
    owner.app = ctx2.server.app;
    const fresh = (await owner.post('/api/auth/recovery-codes')).body.codes as string[];
    const thief = ctx2.device();
    expect((await thief.post('/api/auth/recover', { code: codes[1] })).body.error).toBe('invalid_code');
    expect((await thief.post('/api/auth/recover', { code: fresh[0] })).body.status).toBe('signed_in');
    expect((await owner.post('/api/auth/sessions/revoke-others')).body.revoked).toBe(1);
    expect((await thief.get('/api/me')).status).toBe(401);

    // Practice coins: no endpoint accepts them; extra fields are ignored and the ledger does not move.
    const ledger = Number((await db.query('select count(*)::int as n from ledger'))[0].n);
    for (const path of ['/api/wallet/import', '/api/practice/sync', '/api/wallet']) expect((await owner.post(path, { practiceUnits: 999_999 })).status).toBe(404);
    await owner.req('PATCH', '/api/me', { name: 'Owner', practiceUnits: 999_999, units: 999_999 });
    expect(Number((await db.query('select count(*)::int as n from ledger'))[0].n)).toBe(ledger);
    expect((await owner.get('/api/me')).body.wallet.availableUnits).toBe(4000);
  });
});
