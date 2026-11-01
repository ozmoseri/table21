import { randomUUID } from 'node:crypto';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, afterEach, beforeEach, describe, expect, it } from 'vitest';
import { io as ioc, type Socket } from 'socket.io-client';
import type { Db } from '../../apps/server/src/db.ts';
import { clientProtocol } from '../../apps/server/src/app.ts';
import { FAST, ShoeQueue, assertLedgerConsistent, freshDb, shoeOf, waitFor } from './setup.ts';
import { makeApp } from './http.ts';

/** Safe updates, server side: an outdated client may watch, but every game or money action is refused untouched. */
let db: Db;
let apps: Awaited<ReturnType<typeof makeApp>>[] = [];
const sockets: Socket[] = [];
beforeEach(async () => {
  if (db) await db.close();
  db = await freshDb();
});
afterEach(async () => {
  for (const s of sockets.splice(0)) s.close();
  for (const a of apps.splice(0)) await a.server.close();
});
afterAll(async () => db?.close());

type App = Awaited<ReturnType<typeof makeApp>>;
/** Like a browser: the protocol header goes with every write (or is missing, as in clients built before it existed). */
async function post(app: App, url: string, body: unknown, cookie?: string, protocol?: number) {
  const res = await app.server.app.inject({
    method: 'POST',
    url,
    headers: { 'x-t21': '1', 'content-type': 'application/json', ...(cookie ? { cookie } : {}), ...(protocol !== undefined ? { 'x-t21-protocol': String(protocol) } : {}) },
    payload: JSON.stringify(body),
  });
  const set = (res.cookies as { name: string; value: string }[]).find((c) => c.name === 't21s');
  return { status: res.statusCode, body: res.json(), cookie: set ? `t21s=${set.value}` : cookie };
}
const emit = (s: Socket, ev: string, payload: unknown) => new Promise<any>((res) => s.emit(ev, payload, res));
const money = async () => ({
  wallets: await db.query(`select user_id, available_units, reserved_units from wallets order by user_id, scope`),
  ledger: Number((await db.query(`select count(*)::int as n from ledger`))[0].n),
});

async function live(protocolVersion: number, extra: Parameters<typeof makeApp>[1] = {}) {
  const shoes = new ShoeQueue();
  const app = await makeApp(db, { timing: FAST, shoeFactory: shoes.next, protocolVersion, ...extra });
  apps.push(app);
  await app.server.app.listen({ port: 0, host: '127.0.0.1' });
  const port = (app.server.app.server.address() as any).port;
  const connect = (cookie: string, protocol?: number): Promise<Socket> =>
    new Promise((res, rej) => {
      const s = ioc(`http://127.0.0.1:${port}`, {
        transports: ['websocket'],
        extraHeaders: { cookie },
        auth: protocol === undefined ? {} : { protocol },
        forceNew: true,
        reconnection: false,
      });
      sockets.push(s);
      s.on('connect', () => res(s));
      s.on('connect_error', (e) => rej(e));
    });
  return { app, shoes, connect };
}

describe('version mismatch between client and server', () => {
  it('protocol values: missing or junk counts as 1 (clients built before the field)', () => {
    expect(clientProtocol(undefined)).toBe(1);
    expect(clientProtocol('abc')).toBe(1);
    expect(clientProtocol('2')).toBe(2);
    expect(clientProtocol(['3'])).toBe(3);
    expect(clientProtocol(-4)).toBe(1);
  });

  it('HTTP: a write from an older protocol is refused with 426 before any handler runs; nothing is created or paid', async () => {
    const { app } = await live(2);
    const ok = await post(app, '/api/session', { name: 'New', avatar: 'amber', locale: 'he' }, undefined, 2);
    expect(ok.status).toBe(200);
    const before = await money();
    for (const p of [undefined, 1]) {
      const r = await post(app, '/api/grants/daily', {}, ok.cookie, p);
      expect(r.status).toBe(426);
      expect(r.body).toEqual({ error: 'client_outdated', protocol: 2 });
      const g = await post(app, '/api/session', { name: 'Old', avatar: 'amber', locale: 'he' }, undefined, p);
      expect(g.status).toBe(426);
    }
    expect(await money()).toEqual(before);
    expect(Number((await db.query(`select count(*)::int as n from users`))[0].n)).toBe(1);
    expect((await post(app, '/api/grants/daily', {}, ok.cookie, 2)).body.ok).toBe(true); // the same call from the new version works
  });

  it('socket: in the middle of a hand an outdated tab can watch but cannot bet, act or send gifts; wallets and the hand stay as they were', async () => {
    const { app, shoes, connect } = await live(2);
    shoes.shoes.push(shoeOf(['10', '9', '6', '8', '7', '5', '10']));
    const a = await post(app, '/api/session', { name: 'A', avatar: 'amber', locale: 'he' }, undefined, 2);
    const b = await post(app, '/api/session', { name: 'B', avatar: 'amber', locale: 'he' }, undefined, 2);
    const room = (await post(app, '/api/rooms', { mode: 'casual', settings: {} }, a.cookie, 2)).body;
    const sa = await connect(a.cookie!, 2);
    const sb = await connect(b.cookie!, 2);
    const cmd = async (s: Socket, c: Record<string, unknown>) => {
      const snap = (await emit(s, 'room:sync', {})).snapshot;
      return emit(s, 'cmd', { commandId: randomUUID().replace(/-/g, ''), roomId: room.roomId, expectedVersion: snap.version, ...c });
    };
    for (const s of [sa, sb]) await emit(s, 'room:join', { code: room.code });
    await cmd(sa, { type: 'sit' });
    await cmd(sb, { type: 'sit' });
    await cmd(sa, { type: 'bet', coins: 25 });
    await cmd(sb, { type: 'bet', coins: 10 });
    await waitFor(async () => (await emit(sa, 'room:sync', {})).snapshot.phase === 'player_turns', 5000);

    // A's old tab (opened before the deploy) connects with the old protocol, and one with no protocol at all.
    const oldTab = await connect(a.cookie!, 1);
    const ancient = await connect(a.cookie!);
    const before = await money();
    const handBefore = (await emit(sa, 'room:sync', {})).snapshot;
    for (const s of [oldTab, ancient]) {
      const join = await emit(s, 'room:join', { code: room.code });
      expect(join.ok).toBe(true); // can still see the table and its own hand
      expect(join.snapshot.round.roundId).toBe(handBefore.round.roundId);
      for (const c of [{ type: 'action', action: 'stand' }, { type: 'action', action: 'hit' }, { type: 'bet', coins: 50 }, { type: 'leave' }]) {
        const r = await cmd(s, c);
        expect(r).toMatchObject({ ok: false, error: 'client_outdated', protocol: 2 });
      }
      const gift = await emit(s, 'gift', { roomId: room.roomId, recipientId: (await emit(sb, 'room:sync', {})).snapshot.you.userId, giftId: 'coffee', eventId: randomUUID().replace(/-/g, '') });
      expect(gift).toMatchObject({ ok: false, error: 'client_outdated' });
    }
    expect(await money()).toEqual(before);
    const handAfter = (await emit(sa, 'room:sync', {})).snapshot;
    expect(handAfter.version).toBe(handBefore.version);
    expect(handAfter.round).toEqual(handBefore.round);
    expect(Number((await db.query(`select count(*)::int as n from gift_events`))[0].n)).toBe(0);

    // After the refresh (new protocol) the same player finishes the same hand; every coin is accounted for.
    await cmd(sa, { type: 'action', action: 'stand' });
    await cmd(sb, { type: 'action', action: 'stand' });
    await waitFor(async () => (await emit(sa, 'room:sync', {})).snapshot.phase === 'results', 5000);
    expect(Number((await db.query(`select count(*)::int as n from settlements`))[0].n)).toBe(2);
    await assertLedgerConsistent(db);
  });

  it('a current client is not affected; /api/config tells clients which build and protocol the server serves', async () => {
    const dist = mkdtempSync(join(tmpdir(), 't21-dist-'));
    writeFileSync(join(dist, 'index.html'), '<!doctype html><title>t</title>');
    writeFileSync(join(dist, 'version.json'), JSON.stringify({ build: '20261101-abcd1234' }));
    const app = await makeApp(db, { webDist: dist });
    apps.push(app);
    const cfg = (await app.server.app.inject({ method: 'GET', url: '/api/config' })).json();
    expect(cfg.build).toBe('20261101-abcd1234');
    expect(cfg.protocol).toBe(1);
    // A deploy replaces version.json; the running server reports the new build without a restart.
    writeFileSync(join(dist, 'version.json'), JSON.stringify({ build: '20261101-ffff0000' }));
    expect((await app.server.app.inject({ method: 'GET', url: '/api/config' })).json().build).toBe('20261101-ffff0000');
    expect((await post(app, '/api/session', { name: 'Now', avatar: 'amber', locale: 'he' }, undefined, 1)).status).toBe(200);
    expect((await post(app, '/api/session', { name: 'Pre', avatar: 'amber', locale: 'he' })).status).toBe(200);
  });
});
