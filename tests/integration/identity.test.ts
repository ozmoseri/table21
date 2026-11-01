import { afterAll, afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { Db } from '../../apps/server/src/db.ts';
import { assertSafeAuthConfig } from '../../apps/server/src/identity/providers.ts';
import { buildApp } from '../../apps/server/src/app.ts';
import { freshDb, wallet, assertLedgerConsistent } from './setup.ts';
import { makeApp, testCredential, type Device } from './http.ts';

let db: Db;
let ctx: Awaited<ReturnType<typeof makeApp>>;
beforeEach(async () => {
  if (db) await db.close();
  db = await freshDb();
  ctx = await makeApp(db);
});
afterEach(async () => ctx?.server.close());
afterAll(async () => db?.close());

const nonce = async (d: Device) => (await d.post('/api/auth/nonce')).body.nonce as string;
const ledgerRows = async () => (await db.query('select count(*)::int as n from ledger'))[0].n as number;

describe('providers status', () => {
  it('unconfigured providers are reported as not configured and the test provider never appears by default', async () => {
    const bare = await buildApp({ db });
    const d = ctx.device();
    const r = await bare.app.inject({ method: 'GET', url: '/api/auth/providers' });
    const list = r.json().providers as { id: string; state: string; missing?: string[] }[];
    expect(list.find((p) => p.id === 'google')).toMatchObject({ state: 'not_configured', missing: ['T21_GOOGLE_CLIENT_ID'] });
    expect(list.find((p) => p.id === 'facebook')).toMatchObject({ state: 'not_configured' });
    expect(list.find((p) => p.id === 'apple')).toMatchObject({ state: 'planned' });
    expect(list.some((p) => p.id === 'test')).toBe(false);
    // CSP never names provider hosts that are not configured.
    expect(String(r.headers['content-security-policy'])).not.toContain('google');
    const guestCreated = await d.guest('x');
    expect(guestCreated.account.kind).toBe('guest');
    const pr = await bare.app.inject({ method: 'POST', url: '/api/auth/provider', headers: { 'x-t21': '1', 'content-type': 'application/json' }, payload: { provider: 'google', credential: 'a.b.c', nonce: 'n', intent: 'signin' } });
    expect(pr.json().error).toBe('provider_not_configured');
    await bare.close();
  });

  it('startup refuses the test provider in production, LAN mode or with a public origin', () => {
    expect(() => assertSafeAuthConfig({ T21_TEST_AUTH: '1', NODE_ENV: 'production' }, 'online')).toThrow();
    expect(() => assertSafeAuthConfig({ T21_TEST_AUTH: '1' }, 'lan')).toThrow();
    expect(() => assertSafeAuthConfig({ T21_TEST_AUTH: '1', T21_PUBLIC_ORIGIN: 'https://x.example' }, 'online')).toThrow();
    expect(() => assertSafeAuthConfig({ T21_TEST_AUTH: '1' }, 'online')).not.toThrow();
    expect(() => assertSafeAuthConfig({}, 'lan')).not.toThrow();
  });
});

describe('recovery codes and device pairing', () => {
  it('recovery code restores the same account on a new device, once; regenerating invalidates old codes', async () => {
    const a = ctx.device();
    const me = await a.guest('עוז');
    const codes = (await a.post('/api/auth/recovery-codes')).body.codes as string[];
    expect(codes).toHaveLength(8);
    expect((await a.get('/api/me')).body.account.kind).toBe('saved');
    expect((await a.get('/api/me')).body.crossDeviceRecovery).toBe(true);

    const b = ctx.device('Mozilla/5.0 (Windows NT 10.0) Chrome/140.0 Safari/537.36');
    const r = await b.post('/api/auth/recover', { code: codes[0].toLowerCase().replace(/-/g, ' ') });
    expect(r.body.status).toBe('signed_in');
    const meB = (await b.get('/api/me')).body;
    expect(meB.userId).toBe(me.userId);
    expect(meB.wallet).toEqual(me.wallet);
    expect(meB.account.recovery.remaining).toBe(7);

    const c = ctx.device();
    expect((await c.post('/api/auth/recover', { code: codes[0] })).status).toBe(400); // single use

    const fresh = (await a.post('/api/auth/recovery-codes')).body.codes as string[];
    expect((await c.post('/api/auth/recover', { code: codes[1] })).body.error).toBe('invalid_code');
    expect((await c.post('/api/auth/recover', { code: fresh[0] })).body.status).toBe('signed_in');

    // Same account on the same device: code is not spent.
    expect((await a.post('/api/auth/recover', { code: fresh[1] })).body.status).toBe('same_account');
    expect((await a.get('/api/me')).body.account.recovery.remaining).toBe(7);
  });

  it('switching away from an unsaved guest needs explicit confirmation; nothing is merged', async () => {
    const owner = ctx.device();
    const ownerMe = await owner.guest('Owner');
    const code = (await owner.post('/api/auth/recovery-codes')).body.codes[0];

    const phone = ctx.device();
    const guestMe = await phone.guest('Guest');
    const guestToken = phone.token!;
    const before = await ledgerRows();

    const ask = await phone.post('/api/auth/recover', { code });
    expect(ask.status).toBe(409);
    expect(ask.body).toMatchObject({ error: 'confirm_switch', guest: { name: 'Guest', availableUnits: 4000 } });
    expect((await phone.get('/api/me')).body.userId).toBe(guestMe.userId); // nothing changed yet

    const ok = await phone.post('/api/auth/recover', { code, confirmSwitch: true });
    expect(ok.body.status).toBe('signed_in');
    expect((await phone.get('/api/me')).body.userId).toBe(ownerMe.userId);
    expect(phone.token).not.toBe(guestToken);

    // The guest's server wallet stays with the guest; the owner's wallet is untouched; no ledger movement.
    expect(await wallet(db, guestMe.userId)).toEqual({ a: 4000, r: 0 });
    expect(await wallet(db, ownerMe.userId)).toEqual({ a: 4000, r: 0 });
    expect(await ledgerRows()).toBe(before);
    await assertLedgerConsistent(db);
  });

  it('pairing code: one use, ten minutes, and signing out other devices revokes them', async () => {
    let t = Date.now();
    await ctx.server.close();
    ctx = await makeApp(db, { now: () => t });
    const a = ctx.device();
    const me = await a.guest('A');
    const { code, expiresAt } = (await a.post('/api/auth/pair')).body;
    expect(code).toMatch(/^[0-9A-Z]{4}-[0-9A-Z]{4}$/);
    expect(new Date(expiresAt).getTime() - t).toBe(600_000);

    const b = ctx.device('Mozilla/5.0 (Linux; Android 15) Chrome/140.0 Mobile Safari/537.36');
    expect((await b.post('/api/auth/pair/redeem', { code })).body.status).toBe('signed_in');
    expect((await b.get('/api/me')).body.userId).toBe(me.userId);
    expect((await ctx.device().post('/api/auth/pair/redeem', { code })).status).toBe(400);

    const late = (await a.post('/api/auth/pair')).body.code;
    t += 601_000;
    expect((await ctx.device().post('/api/auth/pair/redeem', { code: late })).body.error).toBe('invalid_code');

    const sessions = (await a.get('/api/auth/sessions')).body;
    expect(sessions).toHaveLength(2);
    expect(sessions.find((s: any) => s.current).label).toBe('iPhone · Safari');
    expect(sessions.find((s: any) => !s.current).label).toBe('Android · Chrome');
    expect((await a.post('/api/auth/sessions/revoke-others')).body.revoked).toBe(1);
    expect((await b.get('/api/me')).status).toBe(401);
    expect((await a.get('/api/me')).status).toBe(200);
  });

  it('signing out an unsaved guest on its only device needs confirmation; expired sessions stop working', async () => {
    const a = ctx.device();
    await a.guest('Solo');
    expect((await a.post('/api/auth/signout')).body.error).toBe('confirm_loss');
    expect((await a.get('/api/me')).status).toBe(200);
    expect((await a.post('/api/auth/signout', { confirmLoss: true })).body.ok).toBe(true);
    expect((await a.get('/api/me')).status).toBe(401);

    const b = ctx.device();
    await b.guest('Exp');
    await db.query(`update sessions set expires_at = now() - interval '1 second'`);
    expect((await b.get('/api/me')).status).toBe(401);
  });
});

describe('provider identities', () => {
  it('Google ID token: link to a guest keeps the wallet, rotates the session, then signs in on another device', async () => {
    const a = ctx.device();
    const me = await a.guest('Noa');
    const oldToken = a.token!;
    const n = await nonce(a);
    const cred = ctx.google.sign({ sub: 'g-111', email: 'noa@example.com', nonce: n });
    const r = await a.post('/api/auth/provider', { provider: 'google', credential: cred, nonce: n, intent: 'link', localUnits: 999999 });
    expect(r.body.status).toBe('linked');
    expect(a.token).not.toBe(oldToken);
    const after = (await a.get('/api/me')).body;
    expect(after.userId).toBe(me.userId);
    expect(after.wallet).toEqual(me.wallet); // extra fields such as local practice coins are ignored
    expect(after.account.identities).toEqual([expect.objectContaining({ provider: 'google', emailHint: 'n***@example.com' })]);
    // The pre-rotation token no longer works.
    const stale = await ctx.server.app.inject({ method: 'GET', url: '/api/me', headers: { cookie: `t21s=${oldToken}` } });
    expect(stale.statusCode).toBe(401);
    // Nonce is single use.
    expect((await a.post('/api/auth/provider', { provider: 'google', credential: cred, nonce: n, intent: 'link' })).status).toBe(401);

    const b = ctx.device();
    const n2 = await nonce(b);
    const s = await b.post('/api/auth/provider', { provider: 'google', credential: ctx.google.sign({ sub: 'g-111', nonce: n2 }), nonce: n2, intent: 'signin' });
    expect(s.body.status).toBe('signed_in');
    expect((await b.get('/api/me')).body.userId).toBe(me.userId);
  });

  it('rejects wrong audience, issuer, expiry, signature, algorithm, key id and nonce', async () => {
    const a = ctx.device();
    await a.guest('Check');
    const now = Math.floor(Date.now() / 1000);
    const cases: [string, (n: string) => string][] = [
      ['aud', (n) => ctx.google.sign({ sub: 'x', nonce: n, aud: 'someone-else' })],
      ['iss', (n) => ctx.google.sign({ sub: 'x', nonce: n, iss: 'https://evil.example' })],
      ['expired', (n) => ctx.google.sign({ sub: 'x', nonce: n, exp: now - 3600 })],
      ['signature', (n) => ctx.google.sign({ sub: 'x', nonce: n }, { key: 'other' })],
      ['alg', (n) => ctx.google.sign({ sub: 'x', nonce: n }, { alg: 'HS256' })],
      ['kid', (n) => ctx.google.sign({ sub: 'x', nonce: n }, { kid: 'unknown' })],
      ['nonce', () => ctx.google.sign({ sub: 'x', nonce: 'not-the-cookie-nonce' })],
    ];
    for (const [reason, make] of cases) {
      const n = await nonce(a);
      const r = await a.post('/api/auth/provider', { provider: 'google', credential: make(n), nonce: n, intent: 'link' });
      expect(r.status, reason).toBe(401);
      expect(r.body.reason, reason).toBe(reason);
    }
    // A nonce that this browser did not receive (no cookie) is refused before verification.
    const other = ctx.device();
    const n = await nonce(a);
    await other.guest('Other');
    const r = await other.post('/api/auth/provider', { provider: 'google', credential: ctx.google.sign({ sub: 'x', nonce: n }), nonce: n, intent: 'link' });
    expect(r.body.reason).toBe('nonce');
    expect((await db.query('select count(*)::int as n from auth_identities'))[0].n).toBe(0);
  });

  it('same email with a different subject is a different person: no merge, no takeover', async () => {
    const a = ctx.device();
    const meA = await a.guest('A');
    let n = await nonce(a);
    await a.post('/api/auth/provider', { provider: 'google', credential: ctx.google.sign({ sub: 'g-A', email: 'shared@example.com', nonce: n }), nonce: n, intent: 'link' });

    const b = ctx.device();
    const meB = await b.guest('B');
    n = await nonce(b);
    const signin = await b.post('/api/auth/provider', { provider: 'google', credential: ctx.google.sign({ sub: 'g-B', email: 'shared@example.com', nonce: n }), nonce: n, intent: 'signin' });
    expect(signin.body.status).toBe('no_account');
    expect((await b.get('/api/me')).body.userId).toBe(meB.userId);
    // Linking the second subject attaches it to B only.
    const link = await b.post('/api/auth/provider', { provider: 'google', credential: ctx.google.sign({ sub: 'g-B', email: 'shared@example.com', nonce: n }), nonce: n, intent: 'link' });
    expect(link.body.status).toBe('linked');
    const owners = await db.query(`select user_id, subject from auth_identities order by subject`);
    expect(owners).toEqual([
      { user_id: meA.userId, subject: 'g-A' },
      { user_id: meB.userId, subject: 'g-B' },
    ]);

    // B cannot link A's subject.
    n = await nonce(b);
    const steal = await b.post('/api/auth/provider', { provider: 'test', credential: testCredential('t-1', n), nonce: n, intent: 'link' });
    expect(steal.body.status).toBe('linked');
    const c = ctx.device();
    await c.guest('C');
    n = await nonce(c);
    const inUse = await c.post('/api/auth/provider', { provider: 'test', credential: testCredential('t-1', n), nonce: n, intent: 'link' });
    expect(inUse.status).toBe(409);
    expect(inUse.body.error).toBe('identity_in_use');
  });

  it('Facebook: token must be valid and issued for our app; the app secret stays on the server', async () => {
    const a = ctx.device();
    const me = await a.guest('FB');
    ctx.fbTokens.set('tok-other-app', { app_id: '999', user_id: '555', is_valid: true, expires_at: Math.floor(Date.now() / 1000) + 3600 });
    ctx.fbTokens.set('tok-expired', { app_id: '1234567890', user_id: '555', is_valid: true, expires_at: Math.floor(Date.now() / 1000) - 10 });
    ctx.fbTokens.set('tok-good', { app_id: '1234567890', user_id: '555', is_valid: true, expires_at: Math.floor(Date.now() / 1000) + 3600 });
    expect((await a.post('/api/auth/provider', { provider: 'facebook', credential: 'tok-other-app', intent: 'link' })).body.reason).toBe('aud');
    expect((await a.post('/api/auth/provider', { provider: 'facebook', credential: 'tok-expired', intent: 'link' })).body.reason).toBe('expired');
    expect((await a.post('/api/auth/provider', { provider: 'facebook', credential: 'tok-unknown', intent: 'link' })).body.reason).toBe('invalid');
    expect((await a.post('/api/auth/provider', { provider: 'facebook', credential: 'tok-good', intent: 'link' })).body.status).toBe('linked');
    expect(ctx.fbCalls.every((p) => p.endsWith('/debug_token'))).toBe(true);
    const status = (await a.get('/api/auth/providers')).body.providers.find((p: any) => p.id === 'facebook');
    expect(JSON.stringify(status)).not.toContain('test-secret-not-real');
    expect((await a.get('/api/me')).body.userId).toBe(me.userId);
  });

  it('unlinking the last way back is refused; with recovery codes it is allowed', async () => {
    const a = ctx.device();
    await a.guest('U');
    const n = await nonce(a);
    await a.post('/api/auth/provider', { provider: 'test', credential: testCredential('u-1', n), nonce: n, intent: 'link' });
    expect((await a.post('/api/auth/unlink', { provider: 'test' })).body.error).toBe('last_method');
    await a.post('/api/auth/recovery-codes');
    expect((await a.post('/api/auth/unlink', { provider: 'test' })).body.ok).toBe(true);
    expect((await a.get('/api/me')).body.account.identities).toEqual([]);
  });
});

describe('account deletion', () => {
  it('needs the display name, is refused while seated, then removes identities, sessions, friends and codes', async () => {
    const a = ctx.device();
    const me = await a.guest('Del');
    const b = ctx.device();
    const meB = await b.guest('Friend');
    await b.post('/api/friends', { friendCode: me.friendCode });
    await a.post('/api/auth/recovery-codes');
    const n = await nonce(a);
    await a.post('/api/auth/provider', { provider: 'test', credential: testCredential('del-1', n), nonce: n, intent: 'link' });

    expect((await a.post('/api/auth/delete', { confirmName: 'wrong' })).body.error).toBe('confirm');
    const room = (await a.post('/api/rooms', { mode: 'casual', settings: {} })).body;
    await db.query(`insert into seats(room_id, seat_index, user_id) select id, 0, $1 from rooms where code = $2`, [me.userId, room.code]);
    expect((await a.post('/api/auth/delete', { confirmName: 'Del' })).body.error).toBe('in_room');
    await db.query(`delete from seats where user_id = $1`, [me.userId]);

    const ledgerBefore = await ledgerRows();
    expect((await a.post('/api/auth/delete', { confirmName: 'Del' })).body.ok).toBe(true);
    expect((await a.get('/api/me')).status).toBe(401);
    for (const table of ['auth_identities', 'auth_codes']) expect((await db.query(`select count(*)::int as n from ${table} where user_id = $1`, [me.userId]))[0].n).toBe(0);
    expect((await db.query(`select count(*)::int as n from sessions where user_id = $1 and revoked_at is null`, [me.userId]))[0].n).toBe(0);
    expect((await b.get('/api/friends')).body).toEqual([]);
    expect((await b.post('/api/friends', { friendCode: me.friendCode })).status).toBe(404);
    expect(await ledgerRows()).toBe(ledgerBefore); // history stays, anonymized
    expect((await db.query(`select name from users where id = $1`, [me.userId]))[0].name).toBe('שחקן לשעבר');
    // The provider identity can be used again by a new account.
    const c = ctx.device();
    await c.guest('New');
    const n2 = await nonce(c);
    expect((await c.post('/api/auth/provider', { provider: 'test', credential: testCredential('del-1', n2), nonce: n2, intent: 'signin' })).body.status).toBe('no_account');
    expect(meB.userId).toBeTruthy();
  });
});
