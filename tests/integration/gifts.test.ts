import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import type { Db } from '../../apps/server/src/db.ts';
import { activeGifts, sendGift } from '../../apps/server/src/gifts.ts';
import { freshDb, makeUser, manager, ShoeQueue } from './setup.ts';

let db: Db;
beforeEach(async () => {
  if (db) await db.close();
  db = await freshDb();
});
afterAll(async () => db?.close());

async function room() {
  const a = await makeUser(db, 'A');
  const b = await makeUser(db, 'B');
  const m = manager(db, { shoes: new ShoeQueue() });
  const { roomId } = await m.createRoom(a, { mode: 'casual', settings: {}, matchStackCoins: 1000, matchRounds: 10 });
  return { a, b, m, roomId };
}

describe('table gifts', () => {
  it('records a gift once per event id, even under concurrent retries; never touches wallets', async () => {
    const { a, b, m, roomId } = await room();
    const t = Date.now();
    const send = () => sendGift(db, { roomId, senderId: a.id, recipientId: b.id, giftId: 'coffee', eventId: 'evt_000000001', now: t });
    const results = await Promise.all([send(), send(), send()]);
    expect(results.every((r) => r.ok)).toBe(true);
    expect(results.filter((r) => r.ok && !r.duplicate)).toHaveLength(1);
    expect((await db.query('select count(*)::int as n from gift_events'))[0].n).toBe(1);
    expect((await db.query(`select count(*)::int as n from ledger where kind not in ('grant_welcome')`))[0].n).toBe(0);
    const snap = (await m.snapshots(roomId, [b.id])).get(b.id)!;
    expect(snap.gifts).toHaveLength(1);
    expect(snap.gifts[0]).toMatchObject({ fromId: a.id, toId: b.id, giftId: 'coffee' });
    m.stop();
  });

  it('rate limits: one gift per 6 seconds and 30 per hour per sender; no self gifts', async () => {
    const { a, b, roomId } = await room();
    let t = Date.now();
    const send = (n: number) => sendGift(db, { roomId, senderId: a.id, recipientId: b.id, giftId: 'rose', eventId: `evt_rate_${String(n).padStart(4, '0')}`, now: t });
    expect((await send(1)).ok).toBe(true);
    expect(await send(2)).toEqual({ ok: false, error: 'rate_limited' });
    for (let i = 3; i < 32; i++) {
      t += 6_500;
      expect((await send(i)).ok).toBe(true);
    }
    t += 6_500;
    expect(await send(99)).toEqual({ ok: false, error: 'rate_limited' }); // 30 within the hour
    expect(await sendGift(db, { roomId, senderId: a.id, recipientId: a.id, giftId: 'tea', eventId: 'evt_selfgift1', now: t })).toEqual({ ok: false, error: 'forbidden' });
  });

  it('expired gifts drop out of the table view', async () => {
    const { a, b, roomId } = await room();
    const t = Date.now();
    await sendGift(db, { roomId, senderId: a.id, recipientId: b.id, giftId: 'trophy', eventId: 'evt_expire01', now: t });
    expect(await activeGifts(db, roomId, t + 10_000)).toHaveLength(1);
    expect(await activeGifts(db, roomId, t + 46_000)).toHaveLength(0);
  });
});
