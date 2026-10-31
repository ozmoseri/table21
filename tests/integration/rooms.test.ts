import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import type { Db } from '../../apps/server/src/db.ts';
import type { RoomManager } from '../../apps/server/src/rooms.ts';
import { Social } from '../../apps/server/src/social.ts';
import { DEFAULT_ECONOMY } from '../../apps/server/src/auth.ts';
import {
  ShoeQueue,
  assertLedgerConsistent,
  freshDb,
  makeUser,
  manager,
  phase,
  send,
  shoeOf,
  version,
  wallet,
  waitFor,
} from './setup.ts';

let db: Db;
const managers: RoomManager[] = [];
const mk = (...a: Parameters<typeof manager>) => {
  const m = manager(...a);
  managers.push(m);
  return m;
};

beforeEach(async () => {
  for (const m of managers.splice(0)) m.stop();
  if (db) await db.close();
  db = await freshDb();
});
afterAll(async () => {
  for (const m of managers) m.stop();
  await db?.close();
});

async function table(n: number, shoes: ShoeQueue, opts: Parameters<typeof manager>[1] = {}, mode: 'casual' | 'match' = 'casual') {
  const m = mk(db, { shoes, ...opts });
  const users = [];
  for (let i = 0; i < n; i++) users.push(await makeUser(db, `P${i}`));
  const { roomId } = await m.createRoom(users[0], { mode, settings: {}, matchStackCoins: 1000, matchRounds: 2 });
  for (const u of users) {
    await m.connect(roomId, u.id);
    expect((await send(m, u, roomId, { type: 'sit' })).ok).toBe(true);
  }
  return { m, users, roomId };
}

const turnOf = async (m: RoomManager, roomId: string) => {
  const s = await m._engineState(roomId);
  return s?.phase === 'player_turns' && s.turn ? s.seats[s.turn.seat].playerId : null;
};

describe('authoritative multiplayer round', () => {
  it('three players: stakes, turns, dealer and exact payouts', async () => {
    const shoes = new ShoeQueue();
    shoes.shoes.push(shoeOf(['10', '10', '9', '6', '7', '8', '5', '10']));
    const { m, users, roomId } = await table(3, shoes);
    const [a, b, c] = users;
    expect((await send(m, a, roomId, { type: 'bet', coins: 100 })).ok).toBe(true);
    expect((await send(m, b, roomId, { type: 'bet', coins: 50 })).ok).toBe(true);
    expect(await wallet(db, a.id)).toEqual({ a: 3800, r: 200 });
    expect((await send(m, c, roomId, { type: 'bet', coins: 25 })).ok).toBe(true);
    await waitFor(async () => (await phase(db, roomId)) === 'player_turns');

    // Wrong user and stale version are rejected.
    expect((await send(m, b, roomId, { type: 'action', action: 'stand' })).error).toBe('not_your_turn');
    const stale = await m.command(a, { commandId: 'stalecmd01', roomId, expectedVersion: (await version(db, roomId)) - 1, type: 'action', action: 'stand' });
    expect(stale.error).toBe('stale_version');

    expect((await send(m, a, roomId, { type: 'action', action: 'stand' })).ok).toBe(true);
    expect((await send(m, b, roomId, { type: 'action', action: 'stand' })).ok).toBe(true);
    expect((await send(m, c, roomId, { type: 'action', action: 'hit' })).ok).toBe(true);
    await waitFor(async () => (await phase(db, roomId)) === 'results');

    expect(await wallet(db, a.id)).toEqual({ a: 4200, r: 0 });
    expect(await wallet(db, b.id)).toEqual({ a: 4100, r: 0 });
    expect(await wallet(db, c.id)).toEqual({ a: 3950, r: 0 });
    const res = await db.query('select user_id, outcome, net_units from hand_results order by net_units');
    expect(res.map((r) => r.outcome)).toEqual(['lose', 'win', 'win']);
    expect((await db.query('select count(*)::int as n from settlements'))[0].n).toBe(3);
    await assertLedgerConsistent(db);
    await waitFor(async () => (await phase(db, roomId)) === 'waiting', 10000);
  });

  it('duplicate command ids apply once; concurrent bets keep the ledger consistent', async () => {
    const { m, users, roomId } = await table(1, new ShoeQueue(), { timing: { autoDealDelayMs: 60_000 } });
    const [a] = users;
    const v = await version(db, roomId);
    const cmd = { commandId: 'dupcommand01', roomId, expectedVersion: v, type: 'bet' as const, coins: 50 };
    const [r1, r2] = await Promise.all([m.command(a, cmd), m.command(a, cmd)]);
    expect([r1.duplicate, r2.duplicate].filter(Boolean)).toHaveLength(1);
    expect(await wallet(db, a.id)).toEqual({ a: 3900, r: 100 });
    await Promise.all([10, 25, 50, 100, 250].map((coins) => send(m, a, roomId, { type: 'bet', coins })));
    const w = await wallet(db, a.id);
    expect(w.a + w.r).toBe(4000);
    expect([20, 50, 100, 200, 500]).toContain(w.r);
    expect((await send(m, a, roomId, { type: 'bet', coins: 7 })).error).toBe('bad_stake');
    await assertLedgerConsistent(db);
  });

  it('one wagering seat per player across rooms (no cross-room double spend)', async () => {
    const { m, users } = await table(1, new ShoeQueue());
    const { roomId: other } = await m.createRoom(users[0], { mode: 'casual', settings: {}, matchStackCoins: 1000, matchRounds: 10 });
    expect((await send(m, users[0], other, { type: 'sit' })).error).toBe('already_seated_elsewhere');
  });

  it('insufficient funds blocks bets and doubles', async () => {
    const shoes = new ShoeQueue();
    shoes.shoes.push(shoeOf(['5', '9', '6', '7']));
    const { m, users, roomId } = await table(1, shoes, { timing: { autoDealDelayMs: 20 } });
    const [a] = users;
    await db.query(`update wallets set available_units = 300 where user_id = $1`, [a.id]);
    await db.query(`insert into ledger(wallet_id, kind, delta_available, delta_reserved) select id, 'adjustment', -3700, 0 from wallets where user_id = $1`, [a.id]);
    expect((await send(m, a, roomId, { type: 'bet', coins: 250 })).error).toBe('insufficient_funds');
    expect((await send(m, a, roomId, { type: 'bet', coins: 100 })).ok).toBe(true);
    await waitFor(async () => (await turnOf(m, roomId)) === a.id);
    const snap = (await m.snapshots(roomId, [a.id])).get(a.id)!;
    expect(snap.you.legalActions).not.toContain('double');
    expect((await send(m, a, roomId, { type: 'action', action: 'double' })).error).toBe('insufficient_funds');
    await assertLedgerConsistent(db);
  });

  it('never sends the hole card, shoe or physical ids to clients', async () => {
    const shoes = new ShoeQueue();
    shoes.shoes.push(shoeOf(['10', 'K', '7', 'Q']));
    const { m, users, roomId } = await table(1, shoes);
    await send(m, users[0], roomId, { type: 'bet', coins: 10 });
    await waitFor(async () => (await phase(db, roomId)) === 'player_turns');
    const engine = (await m._engineState(roomId))!;
    const hole = engine.dealer.cards[1];
    const snap = (await m.snapshots(roomId, [users[0].id])).get(users[0].id)!;
    const json = JSON.stringify(snap);
    expect(snap.round!.dealer.cards[1]).toEqual({ id: `${engine.roundId}:${hole.slot}`, hidden: true });
    expect(json).not.toContain('"shoe"');
    expect(json).not.toContain('"uid"');
    expect(json).not.toContain('"Q"'); // the only Q in this shoe is the hole card
    expect(snap.round!.dealer.total).toBe(10);
  });

  it('turn timeout stands the hand; leaving mid-round does not undo the stake', async () => {
    let skew = 0;
    const shoes = new ShoeQueue();
    shoes.shoes.push(shoeOf(['10', '10', '6', '7', '8', '10']));
    const { m, users, roomId } = await table(2, shoes, { now: () => Date.now() + skew });
    const [a, b] = users;
    await send(m, a, roomId, { type: 'bet', coins: 100 });
    await send(m, b, roomId, { type: 'bet', coins: 100 });
    await waitFor(async () => (await turnOf(m, roomId)) === a.id);
    expect((await send(m, a, roomId, { type: 'leave_seat' })).ok).toBe(true);
    skew = 26_000;
    await (m as any).tick(roomId, await version(db, roomId));
    expect(await turnOf(m, roomId)).toBe(b.id);
    await send(m, b, roomId, { type: 'action', action: 'stand' });
    await waitFor(async () => (await phase(db, roomId)) === 'results');
    // a stood on 17 via timeout; dealer 16 draws 10 and busts, so a still wins and is paid even after leaving.
    expect(await wallet(db, a.id)).toEqual({ a: 4200, r: 0 });
    skew = 60_000;
    await (m as any).tick(roomId, await version(db, roomId));
    expect((await db.query('select user_id from seats')).map((r) => r.user_id)).toEqual([b.id]);
    await assertLedgerConsistent(db);
  });

  it('restart recovery resumes the same hand and settles exactly once; emit failures do not lose state', async () => {
    const shoes = new ShoeQueue();
    shoes.shoes.push(shoeOf(['10', '9', '6', '7', '8', '5']));
    let fail = false;
    const { m, users, roomId } = await table(2, shoes, {
      emit: () => {
        if (fail) throw new Error('process crashed before emit');
      },
    });
    const [a, b] = users;
    await send(m, a, roomId, { type: 'bet', coins: 100 });
    await send(m, b, roomId, { type: 'bet', coins: 50 });
    await waitFor(async () => (await turnOf(m, roomId)) === a.id);
    fail = true;
    expect((await send(m, a, roomId, { type: 'action', action: 'stand' })).ok).toBe(true);
    const before = await m._engineState(roomId);
    m.stop(); // crash: timers and memory gone

    const m2 = mk(db, { shoes: new ShoeQueue() });
    await m2.recover();
    const after = await m2._engineState(roomId);
    expect(after!.dealer.cards).toEqual(before!.dealer.cards);
    expect(after!.seats).toEqual(before!.seats);
    await m2.connect(roomId, a.id);
    await m2.connect(roomId, b.id);
    expect((await send(m2, b, roomId, { type: 'action', action: 'stand' })).ok).toBe(true);
    await waitFor(async () => (await phase(db, roomId)) === 'results');
    // Re-running a stale tick must not settle twice.
    await (m2 as any).tick(roomId, 1);
    expect((await db.query(`select count(*)::int as n from ledger where kind = 'stake_return'`))[0].n).toBe(2);
    await assertLedgerConsistent(db);
  });

  it('shoe exhaustion voids the whole round and refunds every stake once', async () => {
    const { m, users, roomId } = await table(2, new ShoeQueue());
    const [a, b] = users;
    await send(m, a, roomId, { type: 'bet', coins: 100 });
    await send(m, b, roomId, { type: 'bet', coins: 50 });
    await waitFor(async () => (await turnOf(m, roomId)) === a.id);
    // Simulate the rare exhaustion mid-hand: the stored shoe runs out before the next draw.
    await db.query(`update rounds set state = jsonb_set(state, '{engine,shoe}', '[]'::jsonb)`);
    const oldShoe = (await db.query('select shoe from rooms'))[0].shoe;
    expect((await send(m, a, roomId, { type: 'action', action: 'hit' })).ok).toBe(true);
    expect(await phase(db, roomId)).toBe('results');
    expect((await db.query('select status from rounds'))[0].status).toBe('voided');
    expect(await wallet(db, a.id)).toEqual({ a: 4000, r: 0 });
    expect(await wallet(db, b.id)).toEqual({ a: 4000, r: 0 });
    expect((await db.query(`select count(*)::int as n from ledger where kind = 'refund'`))[0].n).toBe(2);
    expect((await db.query('select shoe from rooms'))[0].shoe).not.toEqual(oldShoe); // reshuffled
    expect((await db.query('select count(*)::int as n from hand_results'))[0].n).toBe(0);
    await assertLedgerConsistent(db);
  });

  it('presenter dealer: cannot also play, controls steps, auto takes over on disconnect', async () => {
    const shoes = new ShoeQueue();
    shoes.shoes.push(shoeOf(['10', '5', '8', '6', '3', '9']));
    const m = mk(db, { shoes });
    const [owner, dealer] = [await makeUser(db, 'Owner'), await makeUser(db, 'Dealer')];
    const { roomId } = await m.createRoom(owner, { mode: 'casual', settings: { dealerMode: 'human' }, matchStackCoins: 1000, matchRounds: 10 });
    await m.connect(roomId, owner.id);
    await m.connect(roomId, dealer.id);
    expect((await send(m, dealer, roomId, { type: 'claim_dealer' })).ok).toBe(true);
    expect((await send(m, dealer, roomId, { type: 'sit' })).error).toBe('forbidden');
    await send(m, owner, roomId, { type: 'sit' });
    await send(m, owner, roomId, { type: 'bet', coins: 50 });
    expect((await send(m, owner, roomId, { type: 'deal' })).error).toBe('forbidden');
    expect((await send(m, dealer, roomId, { type: 'deal' })).ok).toBe(true);
    await send(m, owner, roomId, { type: 'action', action: 'stand' });
    expect(await phase(db, roomId)).toBe('dealer_turn');
    expect((await send(m, owner, roomId, { type: 'dealer_step' })).error).toBe('forbidden');
    const snap = (await m.snapshots(roomId, [dealer.id])).get(dealer.id)!;
    expect(snap.you.canDealerStep).toBe(true);
    expect(snap.round!.dealer.cards[1]).toHaveProperty('hidden', true); // presenter cannot peek
    expect((await send(m, dealer, roomId, { type: 'dealer_step' })).ok).toBe(true); // reveal
    await m.disconnect(roomId, dealer.id);
    await waitFor(async () => (await phase(db, roomId)) === 'results');
    const s = (await m._engineState(roomId))!;
    expect(s.dealer.cards.map((c) => c.rank)).toEqual(['5', '6', '3', '9']); // same mandatory draws
    expect(await wallet(db, dealer.id)).toEqual({ a: 4000, r: 0 }); // presenter's coins are never at risk
    await assertLedgerConsistent(db);
  });

  it('equal-stack match: separate stacks, rankings, casual wallet untouched', async () => {
    const shoes = new ShoeQueue();
    shoes.shoes.push(shoeOf(['10', '10', '6', '9', '7', '10', '10', '9', '6', '7', '8', '10']));
    const { m, users, roomId } = await table(2, shoes, {}, 'match');
    const [a, b] = users;
    expect((await send(m, a, roomId, { type: 'bet', coins: 10 })).error).toBe('match_locked');
    expect((await send(m, b, roomId, { type: 'start_match' })).error).toBe('forbidden');
    expect((await send(m, a, roomId, { type: 'start_match' })).ok).toBe(true);
    const outsider = await makeUser(db, 'Late');
    await m.connect(roomId, outsider.id);
    expect((await send(m, outsider, roomId, { type: 'sit' })).error).toBe('match_locked');
    for (let round = 0; round < 2; round++) {
      await waitFor(async () => ['waiting', 'betting'].includes(await phase(db, roomId)), 10000);
      await send(m, a, roomId, { type: 'bet', coins: 100 });
      await send(m, b, roomId, { type: 'bet', coins: 50 });
      await waitFor(async () => (await phase(db, roomId)) === 'player_turns');
      for (let i = 0; i < 6 && (await phase(db, roomId)) === 'player_turns'; i++) {
        const who = await turnOf(m, roomId);
        await send(m, who === a.id ? a : b, roomId, { type: 'action', action: 'stand' });
      }
      await waitFor(async () => (await phase(db, roomId)) === 'results');
      if (round === 0) await (m as any).tick(roomId, await version(db, roomId));
    }
    const snap = (await m.snapshots(roomId, [a.id])).get(a.id)!;
    expect(snap.match!.status).toBe('finished');
    expect(snap.match!.roundsPlayed).toBe(2);
    expect(snap.match!.standings).toHaveLength(2);
    expect(await wallet(db, a.id)).toEqual({ a: 4000, r: 0 });
    expect((await send(m, a, roomId, { type: 'bet', coins: 10 })).ok).toBe(false);
    await assertLedgerConsistent(db);
  });

  it('reconnect window: a seat is released only after the grace period between rounds', async () => {
    const { m, users, roomId } = await table(2, new ShoeQueue(), { timing: { reconnectGraceMs: 150 } });
    await m.disconnect(roomId, users[1].id);
    await m.sweep(roomId);
    expect((await db.query('select count(*)::int as n from seats'))[0].n).toBe(2);
    await new Promise((r) => setTimeout(r, 450));
    await m.sweep(roomId);
    expect((await db.query('select user_id from seats')).map((r) => r.user_id)).toEqual([users[0].id]);
  });
});


describe('grants and leaderboards', () => {
  it('daily grant once per Jerusalem day; rescue only below min stake and once per 6h (concurrent claims)', async () => {
    const u = await makeUser(db, 'G');
    let t = Date.parse('2026-11-02T08:00:00Z');
    const social = new Social(db, DEFAULT_ECONOMY, () => t);
    const results = await Promise.all([1, 2, 3, 4].map(() => social.claimDaily(u)));
    expect(results.filter((r) => r.ok)).toHaveLength(1);
    expect((await social.claimRescue(u)).reason).toBe('balance_not_low');
    await db.query(`update wallets set available_units = 10 where user_id = $1`, [u.id]);
    await db.query(`insert into ledger(wallet_id, kind, delta_available, delta_reserved) select id, 'adjustment', -4590, 0 from wallets where user_id = $1`, [u.id]);
    const rescues = await Promise.all([1, 2, 3].map(() => social.claimRescue(u)));
    expect(rescues.filter((r) => r.ok)).toHaveLength(1);
    await db.query(`update wallets set available_units = 10 where user_id = $1`, [u.id]);
    await db.query(`insert into ledger(wallet_id, kind, delta_available, delta_reserved) select id, 'adjustment', -1000, 0 from wallets where user_id = $1`, [u.id]);
    expect((await social.claimRescue(u)).reason).toBe('cooldown');
    t += 6 * 3600_000 + 1000;
    expect((await social.claimRescue(u)).ok).toBe(true);
    t = Date.parse('2026-11-02T22:30:00Z'); // 00:30 Nov 3 in Jerusalem
    expect((await social.claimDaily(u)).ok).toBe(true);
    await assertLedgerConsistent(db);
  });

  it('weekly group ranking counts only settled casual play, with minimum hands and access control', async () => {
    const shoes = new ShoeQueue();
    shoes.shoes.push(shoeOf(['10', '10', '6', '9', '10', '7', '10', '7']));
    const { m, users, roomId } = await table(2, shoes);
    const social = new Social(db, DEFAULT_ECONOMY);
    const g = await social.createGroup(users[0], 'החבר׳ה');
    await social.joinGroup(users[1], g.code);
    const outsider = await makeUser(db, 'X');
    expect(await social.leaderboard(outsider, g.id, 'weekly', 1)).toBeNull();
    await social.claimDaily(users[0]);
    await send(m, users[0], roomId, { type: 'bet', coins: 100 });
    await send(m, users[1], roomId, { type: 'bet', coins: 100 });
    for (let i = 0; i < 4 && (await waitFor(async () => phase(db, roomId))) !== 'results'; i++) {
      const who = await waitFor(async () => (await turnOf(m, roomId)) || ((await phase(db, roomId)) === 'results' ? 'done' : null));
      if (who === 'done') break;
      await send(m, users.find((u) => u.id === who)!, roomId, { type: 'action', action: 'stand' });
    }
    await waitFor(async () => (await phase(db, roomId)) === 'results');
    const lb = (await social.leaderboard(users[0], g.id, 'weekly', 1))!;
    const nets = await db.query('select user_id, sum(net_units)::int as n from hand_results group by user_id');
    for (const row of lb.rows) expect(row.value).toBe(nets.find((n) => n.user_id === row.userId)?.n ?? 0);
    expect(lb.rows.every((r) => r.hands === 1 && r.eligible)).toBe(true);
    const strict = (await social.leaderboard(users[0], g.id, 'weekly', 20))!;
    expect(strict.rows.every((r) => !r.eligible && r.rank === null)).toBe(true);
  });
});
