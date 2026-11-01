import { afterAll, afterEach, beforeEach, describe, expect, it } from 'vitest';
import { io as ioc, type Socket } from 'socket.io-client';
import type { Db } from '../../apps/server/src/db.ts';
import { sendGift } from '../../apps/server/src/gifts.ts';
import { freshDb } from './setup.ts';
import { makeApp } from './http.ts';

let db: Db;
let ctx: Awaited<ReturnType<typeof makeApp>>;
beforeEach(async () => {
  if (db) await db.close();
  db = await freshDb();
  ctx = await makeApp(db);
});
afterEach(async () => ctx?.server.close());
afterAll(async () => db?.close());

describe('invite links', () => {
  it('friend invite: preview without a session, accept creates the friendship once, self and revoked links refused', async () => {
    const a = ctx.device();
    const meA = await a.guest('Inviter');
    const inv = (await a.post('/api/invites', { kind: 'friend', maxUses: 3 })).body;
    expect(inv.token).toMatch(/^[\w-]{24}$/);
    expect((await db.query('select token_hash from invites'))[0].token_hash).not.toContain(inv.token);

    const anon = ctx.device();
    const pv = await anon.get(`/api/invites/${inv.token}`);
    expect(pv.body).toMatchObject({ kind: 'friend', state: 'valid', inviter: { name: 'Inviter' } });
    expect((await anon.post(`/api/invites/${inv.token}/accept`)).status).toBe(401);

    await anon.guest('Joiner');
    const acc = await anon.post(`/api/invites/${inv.token}/accept`);
    expect(acc.body).toMatchObject({ ok: true, kind: 'friend', friendId: meA.userId });
    await anon.post(`/api/invites/${inv.token}/accept`);
    expect((await a.get('/api/invites')).body[0]).toMatchObject({ uses: 1, maxUses: 3, state: 'valid' });
    expect((await a.get('/api/friends')).body.map((f: any) => f.name)).toEqual(['Joiner']);

    expect((await a.post(`/api/invites/${inv.token}/accept`)).body.error).toBe('invite_self');
    expect((await a.post(`/api/invites/${inv.id}/revoke`)).body.ok).toBe(true);
    const late = ctx.device();
    await late.guest('Late');
    expect((await late.post(`/api/invites/${inv.token}/accept`)).body.error).toBe('invite_revoked');
    expect((await late.get(`/api/invites/${'x'.repeat(24)}`)).status).toBe(404);
  });

  it('concurrent accepts never exceed max uses; expired links refused', async () => {
    let t = Date.now();
    await ctx.server.close();
    ctx = await makeApp(db, { now: () => t });
    const a = ctx.device();
    await a.guest('Host');
    const inv = (await a.post('/api/invites', { kind: 'friend', maxUses: 2, ttlHours: 1 })).body;
    const joiners = await Promise.all(
      Array.from({ length: 6 }, async (_, i) => {
        const d = ctx.device();
        await d.guest(`J${i}`);
        return d;
      }),
    );
    const res = await Promise.all(joiners.map((d) => d.post(`/api/invites/${inv.token}/accept`)));
    expect(res.filter((r) => r.body.ok)).toHaveLength(2);
    expect(res.filter((r) => r.body.error === 'invite_used_up')).toHaveLength(4);
    expect((await db.query('select uses from invites'))[0].uses).toBe(2);

    const inv2 = (await a.post('/api/invites', { kind: 'friend', ttlHours: 1 })).body;
    t += 3601_000;
    expect((await joiners[5].post(`/api/invites/${inv2.token}/accept`)).body.error).toBe('invite_expired');
    expect((await joiners[5].get(`/api/invites/${inv2.token}`)).body.state).toBe('expired');
  });

  it('club invite: only members can create; accepting joins the club; the owner leaving hands over ownership', async () => {
    const a = ctx.device();
    await a.guest('Owner');
    const g = (await a.post('/api/groups', { name: 'שישי' })).body;
    const outsider = ctx.device();
    await outsider.guest('Out');
    expect((await outsider.post('/api/invites', { kind: 'club', groupId: g.id })).status).toBe(403);
    const inv = (await a.post('/api/invites', { kind: 'club', groupId: g.id })).body;
    expect((await outsider.get(`/api/invites/${inv.token}`)).body.group).toMatchObject({ name: 'שישי', members: 1 });
    expect((await outsider.post(`/api/invites/${inv.token}/accept`)).body).toMatchObject({ ok: true, kind: 'club', groupId: g.id });
    expect((await a.post(`/api/groups/${g.id}/leave`)).body.ok).toBe(true);
    const groups = (await outsider.get('/api/groups')).body;
    expect(groups[0]).toMatchObject({ id: g.id, isOwner: true });
  });
});

describe('blocks', () => {
  it('block removes the friendship and stops friend codes, invites and gifts in both directions; unblock restores codes', async () => {
    const a = ctx.device();
    const meA = await a.guest('A');
    const b = ctx.device();
    const meB = await b.guest('B');
    await b.post('/api/friends', { friendCode: meA.friendCode });
    expect((await a.get('/api/friends')).body).toHaveLength(1);

    expect((await a.post('/api/blocks', { userId: meB.userId })).body.ok).toBe(true);
    expect((await a.get('/api/friends')).body).toEqual([]);
    expect((await a.get('/api/blocks')).body).toEqual([expect.objectContaining({ userId: meB.userId, name: 'B' })]);
    expect((await b.post('/api/friends', { friendCode: meA.friendCode })).status).toBe(404);
    expect((await a.post('/api/friends', { friendCode: meB.friendCode })).status).toBe(404);

    const inv = (await a.post('/api/invites', { kind: 'friend' })).body;
    expect((await b.get(`/api/invites/${inv.token}`)).status).toBe(404);
    expect((await b.post(`/api/invites/${inv.token}/accept`)).status).toBe(404);

    const room = (await a.post('/api/rooms', { mode: 'casual', settings: {} })).body;
    for (const [from, to] of [
      [meA.userId, meB.userId],
      [meB.userId, meA.userId],
    ])
      expect(await sendGift(db, { roomId: room.roomId, senderId: from, recipientId: to, giftId: 'coffee', eventId: `evt_blk_${from.slice(-6)}`, now: Date.now() })).toEqual({ ok: false, error: 'not_found' });

    await a.post('/api/blocks/remove', { userId: meB.userId });
    expect((await b.post('/api/friends', { friendCode: meA.friendCode })).body.ok).toBe(true);
  });

  it("a blocked player cannot open the blocker's room by code, and a blocked player's reactions are not delivered", async () => {
    await ctx.server.close();
    ctx = await makeApp(db);
    await ctx.server.app.listen({ port: 0, host: '127.0.0.1' });
    const port = (ctx.server.app.server.address() as any).port;
    const a = ctx.device();
    const meA = await a.guest('Host');
    const b = ctx.device();
    const meB = await b.guest('Blocked');
    const c = ctx.device();
    await c.guest('Friend');
    const room = (await a.post('/api/rooms', { mode: 'casual', settings: {} })).body;
    await a.post('/api/blocks', { userId: meB.userId });

    const connect = (cookie: string): Promise<Socket> =>
      new Promise((res, rej) => {
        const s = ioc(`http://127.0.0.1:${port}`, { transports: ['websocket'], extraHeaders: { cookie }, forceNew: true });
        s.on('connect', () => res(s));
        s.on('connect_error', rej);
      });
    const join = (s: Socket, code: string) => new Promise<any>((res) => s.emit('room:join', { code }, res));
    const sa = await connect(`t21s=${a.token}`);
    const sb = await connect(`t21s=${b.token}`);
    const sc = await connect(`t21s=${c.token}`);
    expect((await join(sb, room.code)).error).toBe('not_found');
    expect((await join(sa, room.code)).ok).toBe(true);
    expect((await join(sc, room.code)).ok).toBe(true);

    // Blocks are symmetric for rooms: the blocker cannot open the blocked player's room either.
    const roomB = (await b.post('/api/rooms', { mode: 'casual', settings: {} })).body;
    expect((await join(sa, roomB.code)).error).toBe('not_found');
    // Both can still meet at a third friend's table; there a's screen never shows b's reactions.
    const roomC = (await c.post('/api/rooms', { mode: 'casual', settings: {} })).body;
    for (const s of [sa, sb, sc]) expect((await join(s, roomC.code)).ok).toBe(true);
    const got: Record<string, string[]> = { a: [], c: [] };
    sa.on('room:reaction', (m: any) => got.a.push(m.userId));
    sc.on('room:reaction', (m: any) => got.c.push(m.userId));
    sb.emit('react', { roomId: roomC.roomId, reaction: 'wow' });
    await new Promise((r) => setTimeout(r, 400));
    expect(got.c).toEqual([meB.userId]);
    expect(got.a).toEqual([]);
    expect(meA.userId).toBeTruthy();
    for (const s of [sa, sb, sc]) s.close();
  });

  it('revoking a session closes its live socket', async () => {
    await ctx.server.close();
    ctx = await makeApp(db);
    await ctx.server.app.listen({ port: 0, host: '127.0.0.1' });
    const port = (ctx.server.app.server.address() as any).port;
    const a = ctx.device();
    await a.guest('Two devices');
    const code = (await a.post('/api/auth/pair')).body.code;
    const b = ctx.device();
    await b.post('/api/auth/pair/redeem', { code });
    const sb = ioc(`http://127.0.0.1:${port}`, { transports: ['websocket'], extraHeaders: { cookie: `t21s=${b.token}` }, forceNew: true, reconnection: false });
    await new Promise((r) => sb.on('connect', r));
    const closed = new Promise((r) => sb.on('disconnect', r));
    await a.post('/api/auth/sessions/revoke-others');
    await closed;
    expect(sb.connected).toBe(false);
  });
});
