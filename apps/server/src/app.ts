import Fastify, { type FastifyReply, type FastifyRequest } from 'fastify';
import cookie from '@fastify/cookie';
import rateLimit from '@fastify/rate-limit';
import fastifyStatic from '@fastify/static';
import { idemFrom, pruneIdem } from './idempotency.ts';
import { Pilot, pilotConfigFromEnv, type PilotConfig } from './pilot.ts';
import { exportDb } from './backup.ts';
import { gzipSync } from 'node:zlib';
import { Server as IOServer } from 'socket.io';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { networkInterfaces } from 'node:os';
import { z } from 'zod';
import type { Card } from '@table21/game-engine';
import { AVATARS, AUTH_PROVIDERS, PROTOCOL_HEADER, PROTOCOL_VERSION, CodeInput, Command, DisplayName, GiftInput, InviteCreate, ProviderAuthInput, ReactionInput, RoomCreate, SessionCreate, UserRef } from '@table21/protocol';
import { sendGift } from './gifts.ts';
import type { Db } from './db.ts';
import { DEFAULT_ECONOMY, SESSION_COOKIE, SESSION_DAYS, createGuest, deviceLabel, userFromToken, type Economy, type SessionUser } from './auth.ts';
import { Accounts, NONCE_TTL_MS, type SwitchResult } from './identity/accounts.ts';
import { Providers, assertSafeAuthConfig, providerConfigFromEnv, type ProviderConfig } from './identity/providers.ts';
import { Friends, blockPeers, blockedEither } from './friends.ts';
import { CmdError, RoomManager, type Timing } from './rooms.ts';
import { Social } from './social.ts';
import { RateLimiter, normalizeCode } from './util.ts';
import { adsStatus } from './ads.ts';

export interface AppOptions {
  db: Db;
  deployment?: 'online' | 'lan';
  webDist?: string;
  timing?: Partial<Timing>;
  economy?: Partial<Economy>;
  shoeFactory?: () => Card[];
  now?: () => number;
  leaderboardMinHands?: number;
  logger?: boolean;
  https?: { key: Buffer; cert: Buffer };
  /** Guest creations per IP per minute. */
  sessionRateLimit?: number;
  /** Sign-in providers. Defaults to the environment (T21_GOOGLE_CLIENT_ID, T21_FACEBOOK_APP_ID/SECRET, T21_TEST_AUTH). */
  providers?: ProviderConfig;
  /** Free-tier pilot card and backups for the operator. Defaults to the environment (T21_PILOT_PLAN, RENDER, ...). */
  pilot?: PilotConfig;
  /** Wire protocol this server speaks (tests only override it). Defaults to PROTOCOL_VERSION. */
  protocolVersion?: number;
}

/** A client's protocol from a header or handshake value. Clients from before the field existed send nothing: 1. */
export const clientProtocol = (v: unknown) => {
  const n = Number(Array.isArray(v) ? v[0] : v);
  return Number.isInteger(n) && n > 0 && n < 1000 ? n : 1;
};

/** The build id of the client this server serves (written by the web build), so open clients can see a newer one. */
function servedBuild(webDist?: string): string | null {
  try {
    return webDist ? (JSON.parse(readFileSync(join(webDist, 'version.json'), 'utf8')).build ?? null) : null;
  } catch {
    return null;
  }
}

const NONCE_COOKIE = 't21n';

declare module 'fastify' {
  interface FastifyRequest {
    user: SessionUser | null;
  }
}

export async function buildApp(opts: AppOptions) {
  const deployment = opts.deployment ?? 'online';
  const protocol = opts.protocolVersion ?? PROTOCOL_VERSION;
  const pilot = new Pilot(opts.db, opts.pilot ?? (deployment === 'lan' ? {} : pilotConfigFromEnv(process.env)), opts.now ?? Date.now);
  const eco: Economy = { ...DEFAULT_ECONOMY, ...opts.economy };
  const now = opts.now ?? Date.now;
  const app = Fastify({ logger: opts.logger ? { level: 'info' } : false, trustProxy: true, bodyLimit: 16 * 1024, ...(opts.https ? { https: opts.https } : {}) } as any) as unknown as import('fastify').FastifyInstance;
  await app.register(cookie);
  // Rate limits apply to the API only (static assets are cacheable and shared by friends behind one IP).
  // Signed-in requests are keyed by session, so several friends on the same home network do not share a bucket.
  await app.register(rateLimit, {
    max: 600,
    timeWindow: '1 minute',
    allowList: (req) => !req.url.startsWith('/api/'),
    keyGenerator: (req) => {
      const tok = app.parseCookie(req.headers.cookie ?? '')[SESSION_COOKIE];
      return tok ? `s:${tok.slice(0, 16)}` : `ip:${req.ip}`;
    },
  });

  let io: IOServer;
  const manager = new RoomManager({
    db: opts.db,
    now,
    timing: opts.timing,
    shoeFactory: opts.shoeFactory,
    emit: async (roomId) => {
      if (!io) return;
      const sockets = await io.in(roomId).fetchSockets();
      const ids = [...new Set(sockets.map((s) => (s.data.user as SessionUser).id))];
      if (!ids.length) return;
      const snaps = await manager.snapshots(roomId, ids);
      for (const s of sockets) {
        const snap = snaps.get((s.data.user as SessionUser).id);
        if (snap) s.emit('room:state', snap);
      }
    },
  });
  const social = new Social(opts.db, eco, now);
  if (!opts.providers) assertSafeAuthConfig(process.env, deployment);
  const providerCfg = opts.providers ?? providerConfigFromEnv(process.env);
  if (providerCfg.test && deployment === 'lan') throw new Error('The test sign-in provider cannot run in LAN mode.');
  const providers = new Providers(providerCfg, now);
  /** Live sockets by session id, so a revoked session (sign out elsewhere, deletion, switch) loses realtime access too. */
  const socketsBySession = new Map<string, Set<{ disconnect: (close?: boolean) => void }>>();
  const accounts = new Accounts(opts.db, providers, now, (ids) => {
    for (const id of ids) for (const s of socketsBySession.get(id) ?? []) s.disconnect(true);
  });
  const friendsSvc = new Friends(opts.db, now);
  const touched = new Map<string, number>();
  const onlineUsers = new Map<string, number>();
  const isOnline = (id: string) => (onlineUsers.get(id) ?? 0) > 0;

  // Provider origins are added to the CSP only when that provider is configured on this server.
  const ready = new Set(providers.status().filter((p) => p.state === 'ready').map((p) => p.id));
  const csp = {
    script: ["'self'", ...(ready.has('google') ? ['https://accounts.google.com/gsi/client'] : []), ...(ready.has('facebook') ? ['https://connect.facebook.net'] : [])],
    style: ["'self'", "'unsafe-inline'", ...(ready.has('google') ? ['https://accounts.google.com/gsi/style'] : [])],
    frame: [...(ready.has('google') ? ['https://accounts.google.com/gsi/'] : []), ...(ready.has('facebook') ? ['https://www.facebook.com', 'https://web.facebook.com'] : [])],
    connect: ["'self'", 'ws:', 'wss:', ...(ready.has('google') ? ['https://accounts.google.com/gsi/'] : []), ...(ready.has('facebook') ? ['https://www.facebook.com', 'https://graph.facebook.com'] : [])],
  };
  const cspHeader = [
    "default-src 'self'",
    `script-src ${csp.script.join(' ')}`,
    `style-src ${csp.style.join(' ')}`,
    "img-src 'self' data: blob:",
    "font-src 'self'",
    `connect-src ${csp.connect.join(' ')}`,
    ...(csp.frame.length ? [`frame-src ${csp.frame.join(' ')}`] : []),
    "frame-ancestors 'none'",
    "base-uri 'self'",
  ].join('; ');
  app.addHook('onSend', async (_req, reply, payload) => {
    reply.header('x-content-type-options', 'nosniff');
    reply.header('referrer-policy', 'same-origin');
    reply.header('content-security-policy', cspHeader);
    return payload;
  });

  app.decorateRequest('user', null);
  app.addHook('preHandler', async (req) => {
    req.user = await userFromToken(opts.db, req.cookies[SESSION_COOKIE]);
    // last_seen_at for the devices list, written at most every 10 minutes per session.
    if (req.user && (touched.get(req.user.session_id) ?? 0) + 600_000 < now()) {
      touched.set(req.user.session_id, now());
      if (touched.size > 20_000) touched.clear();
      void opts.db.query('update sessions set last_seen_at = now() where id = $1', [req.user.session_id]).catch(() => {});
    }
  });

  /** CSRF: state-changing API calls need a custom header (not sendable cross-site without CORS) and a same-origin Origin. */
  const guard = async (req: FastifyRequest, reply: FastifyReply) => {
    if (req.method === 'GET' || req.method === 'HEAD') return;
    const origin = req.headers.origin;
    if (req.headers['x-t21'] !== '1') return reply.code(403).send({ error: 'csrf' });
    if (origin && new URL(origin).host !== req.headers.host) return reply.code(403).send({ error: 'origin' });
    // An older client must not change anything it may no longer understand: refuse before any handler runs.
    if (clientProtocol(req.headers[PROTOCOL_HEADER]) !== protocol) return reply.code(426).send({ error: 'client_outdated', protocol });
  };
  const needUser = async (req: FastifyRequest, reply: FastifyReply) => {
    if (!req.user) return reply.code(401).send({ error: 'unauthorized' });
  };
  const secure = (req: FastifyRequest) => req.protocol === 'https';
  const authed = { preHandler: [guard, needUser] };

  app.get('/api/health', async () => ({ ok: true, db: opts.db.kind, deployment }));
  app.get('/api/config', async (_req, reply) => {
    reply.header('cache-control', 'no-store');
    // Read per request (tiny file): a deploy that swaps the files is reported without a restart.
    return { deployment, ads: adsStatus(), avatars: AVATARS, leaderboardMinHands: opts.leaderboardMinHands ?? 20, build: servedBuild(opts.webDist), protocol };
  });
  app.get('/api/lan-info', async () => {
    if (deployment !== 'lan') return { addresses: [] };
    const addrs = Object.values(networkInterfaces())
      .flat()
      .filter((i): i is NonNullable<typeof i> => !!i && i.family === 'IPv4' && !i.internal)
      .map((i) => i.address);
    return { addresses: addrs };
  });

  app.post('/api/session', { preHandler: guard, config: { rateLimit: { max: opts.sessionRateLimit ?? 10, timeWindow: '1 minute' } } }, async (req, reply) => {
    const body = SessionCreate.safeParse(req.body);
    if (!body.success) return reply.code(400).send({ error: 'bad_request' });
    if (req.user) {
      await social.updateProfile(req.user, { name: body.data.name, avatar: body.data.avatar, locale: body.data.locale });
      return { ok: true, created: false };
    }
    const { token, replayed } = await createGuest(opts.db, body.data, eco, deviceLabel(req.headers['user-agent']), idemFrom(req.headers, 'guest'));
    setSession(req, reply, token);
    return { ok: true, created: true, replayed };
  });

  app.get('/api/me', async (req, reply) => {
    if (!req.user) return reply.code(401).send({ error: 'unauthorized' });
    const account = await accounts.summary(req.user.id);
    const admin = pilot.enabled && (await pilot.isAdmin(req.user.id));
    return { ...(await social.me(req.user)), crossDeviceRecovery: account.kind === 'saved', account, admin };
  });

  /* --------------------------- operator (free pilot) --------------------------- */

  const adminOnly = async (req: FastifyRequest, reply: FastifyReply) => {
    if (!req.user) return reply.code(401).send({ error: 'unauthorized' });
    if (!pilot.enabled || !(await pilot.isAdmin(req.user.id))) return reply.code(403).send({ error: 'forbidden' });
  };
  app.get('/api/admin/pilot', { preHandler: [guard, adminOnly] }, async () => ({ pilot: await pilot.info() }));
  // Download a full backup without opening the database to the internet (docs/DEPLOY.md "Backup and restore").
  app.get('/api/admin/backup', { preHandler: [guard, adminOnly], config: { rateLimit: { max: 6, timeWindow: '15 minutes' } } }, async (req, reply) => {
    const backup = await exportDb(opts.db, now);
    const day = backup.createdAt.slice(0, 10);
    reply.header('content-type', 'application/gzip');
    reply.header('content-disposition', `attachment; filename="table21-backup-${day}.json.gz"`);
    reply.header('cache-control', 'no-store');
    return reply.send(gzipSync(Buffer.from(JSON.stringify(backup))));
  });

  /* ------------------------------- identity -------------------------------- */

  function setSession(req: FastifyRequest, reply: FastifyReply, token: string) {
    reply.setCookie(SESSION_COOKIE, token, { httpOnly: true, sameSite: 'lax', path: '/', secure: secure(req), maxAge: SESSION_DAYS * 24 * 3600 });
  }
  const device = (req: FastifyRequest) => ({ label: deviceLabel(req.headers['user-agent']) });
  /** Maps a switch outcome to HTTP. The session token only ever travels in the httpOnly cookie. */
  const switchReply = (req: FastifyRequest, reply: FastifyReply, r: SwitchResult | { status: string; [k: string]: any }) => {
    if ('token' in r && r.token) {
      setSession(req, reply, r.token);
      return { status: r.status };
    }
    if (r.status === 'invalid') return reply.code(400).send({ error: 'invalid_code' });
    if (r.status === 'rejected') return reply.code(401).send({ error: 'provider_rejected', reason: (r as any).reason });
    if (r.status === 'confirm_switch') return reply.code(409).send({ error: 'confirm_switch', guest: (r as any).guest });
    if (['identity_in_use', 'provider_already_linked'].includes(r.status)) return reply.code(409).send({ error: r.status });
    return { status: r.status };
  };
  const strict = (max: number, minutes = 15) => ({ rateLimit: { max, timeWindow: `${minutes} minutes` } });

  app.get('/api/auth/providers', async () => ({ providers: providers.status(), deployment }));
  app.get('/api/auth/account', authed, async (req) => accounts.summary(req.user!.id));
  app.post('/api/auth/nonce', { preHandler: guard, config: strict(30, 1) }, async (req, reply) => {
    const nonce = await accounts.createNonce();
    reply.setCookie(NONCE_COOKIE, nonce, { httpOnly: true, sameSite: 'strict', path: '/api/auth', secure: secure(req), maxAge: NONCE_TTL_MS / 1000 });
    return { nonce };
  });
  app.post('/api/auth/provider', { preHandler: guard, config: strict(30) }, async (req, reply) => {
    const body = ProviderAuthInput.safeParse(req.body);
    if (!body.success) return reply.code(400).send({ error: 'bad_request' });
    if (!providers.isReady(body.data.provider)) return reply.code(400).send({ error: 'provider_not_configured' });
    // The nonce in the token must also be the one this browser received (cookie), so a token cannot be replayed elsewhere.
    if (providers.usesNonce(body.data.provider) && (!body.data.nonce || req.cookies[NONCE_COOKIE] !== body.data.nonce))
      return reply.code(401).send({ error: 'provider_rejected', reason: 'nonce' });
    if (body.data.intent === 'link' && !req.user) return reply.code(401).send({ error: 'unauthorized' });
    const r = await accounts.providerAuth(req.user, body.data, device(req));
    if (r.status === 'signed_in' || r.status === 'linked' || r.status === 'already_linked' || r.status === 'same_account') reply.clearCookie(NONCE_COOKIE, { path: '/api/auth' });
    return switchReply(req, reply, r);
  });
  app.post('/api/auth/unlink', authed, async (req, reply) => {
    const body = z.object({ provider: z.enum(AUTH_PROVIDERS) }).safeParse(req.body);
    if (!body.success) return reply.code(400).send({ error: 'bad_request' });
    const r = await accounts.unlink(req.user!, body.data.provider);
    return r.ok ? r : reply.code(r.error === 'not_found' ? 404 : 409).send({ error: r.error });
  });
  app.post('/api/auth/recovery-codes', { ...authed, config: strict(10) }, async (req) => ({ codes: await accounts.createRecoveryCodes(req.user!) }));
  app.post('/api/auth/recover', { preHandler: guard, config: strict(10) }, async (req, reply) => {
    const body = CodeInput.safeParse(req.body);
    if (!body.success) return reply.code(400).send({ error: 'bad_request' });
    return switchReply(req, reply, await accounts.redeemRecovery(req.user, body.data.code, body.data.confirmSwitch, device(req)));
  });
  app.post('/api/auth/pair', { ...authed, config: strict(20) }, async (req) => accounts.createPairCode(req.user!));
  app.post('/api/auth/pair/redeem', { preHandler: guard, config: strict(15) }, async (req, reply) => {
    const body = CodeInput.safeParse(req.body);
    if (!body.success) return reply.code(400).send({ error: 'bad_request' });
    return switchReply(req, reply, await accounts.redeemPair(req.user, body.data.code, body.data.confirmSwitch, device(req)));
  });
  app.get('/api/auth/sessions', authed, async (req) => accounts.sessions(req.user!));
  app.post('/api/auth/sessions/revoke', authed, async (req, reply) => {
    const body = z.object({ sessionId: z.string().max(64) }).safeParse(req.body);
    if (!body.success) return reply.code(400).send({ error: 'bad_request' });
    return (await accounts.revokeSession(req.user!, body.data.sessionId)) ? { ok: true } : reply.code(404).send({ error: 'not_found' });
  });
  app.post('/api/auth/sessions/revoke-others', authed, async (req) => ({ revoked: await accounts.revokeOthers(req.user!) }));
  app.post('/api/auth/signout', authed, async (req, reply) => {
    const body = z.object({ confirmLoss: z.boolean().default(false) }).safeParse(req.body ?? {});
    const r = await accounts.signOut(req.user!, body.success ? body.data.confirmLoss : false);
    if (!r.ok) return reply.code(409).send({ error: r.error });
    reply.clearCookie(SESSION_COOKIE, { path: '/' });
    return r;
  });
  app.post('/api/auth/delete', { ...authed, config: strict(5) }, async (req, reply) => {
    const body = z.object({ confirmName: z.string().max(40) }).safeParse(req.body);
    if (!body.success) return reply.code(400).send({ error: 'bad_request' });
    const r = await accounts.deleteAccount(req.user!, body.data.confirmName);
    if (!r.ok) return reply.code(409).send({ error: r.error });
    reply.clearCookie(SESSION_COOKIE, { path: '/' });
    return r;
  });

  /* ------------------------- invites, blocks, clubs ------------------------- */

  app.post('/api/invites', { ...authed, config: { rateLimit: { max: 20, timeWindow: '1 minute' } } }, async (req, reply) => {
    const body = InviteCreate.safeParse(req.body);
    if (!body.success) return reply.code(400).send({ error: 'bad_request' });
    const r = await friendsSvc.createInvite(req.user!, body.data);
    return r.ok ? r : reply.code(r.error === 'forbidden' ? 403 : 429).send({ error: r.error });
  });
  app.get('/api/invites', authed, async (req) => friendsSvc.myInvites(req.user!));
  app.get('/api/invites/:token', { config: { rateLimit: { max: 30, timeWindow: '1 minute' } } }, async (req, reply) => {
    const p = await friendsSvc.preview(String((req.params as any).token), req.user?.id ?? null);
    return p ?? reply.code(404).send({ error: 'invite_not_found' });
  });
  app.post('/api/invites/:token/accept', { ...authed, config: { rateLimit: { max: 20, timeWindow: '1 minute' } } }, async (req, reply) => {
    const r = await friendsSvc.accept(req.user!, String((req.params as any).token));
    if (r.ok) return r;
    return reply.code(r.error === 'not_found' ? 404 : 409).send({ error: r.error === 'not_found' ? 'invite_not_found' : `invite_${r.error}` });
  });
  app.post('/api/invites/:id/revoke', authed, async (req, reply) =>
    (await friendsSvc.revokeInvite(req.user!, String((req.params as any).id))) ? { ok: true } : reply.code(404).send({ error: 'not_found' }),
  );
  app.post('/api/friends/remove', authed, async (req, reply) => {
    const body = UserRef.safeParse(req.body);
    if (!body.success) return reply.code(400).send({ error: 'bad_request' });
    await friendsSvc.removeFriend(req.user!, body.data.userId);
    return { ok: true };
  });
  app.get('/api/blocks', authed, async (req) => friendsSvc.blocked(req.user!));
  app.post('/api/blocks', authed, async (req, reply) => {
    const body = UserRef.safeParse(req.body);
    if (!body.success) return reply.code(400).send({ error: 'bad_request' });
    return (await friendsSvc.block(req.user!, body.data.userId)) ? { ok: true } : reply.code(404).send({ error: 'not_found' });
  });
  app.post('/api/blocks/remove', authed, async (req, reply) => {
    const body = UserRef.safeParse(req.body);
    if (!body.success) return reply.code(400).send({ error: 'bad_request' });
    await friendsSvc.unblock(req.user!, body.data.userId);
    return { ok: true };
  });
  app.post('/api/groups/:id/leave', authed, async (req, reply) =>
    (await friendsSvc.leaveGroup(req.user!, String((req.params as any).id))) ? { ok: true } : reply.code(404).send({ error: 'not_found' }),
  );

  const ProfilePatch = z.object({
    name: DisplayName.optional(),
    avatar: z.enum(AVATARS).optional(),
    locale: z.enum(['he', 'en']).optional(),
    cardBack: z.string().max(20).optional(),
    tableTheme: z.string().max(20).optional(),
  });
  app.patch('/api/me', authed, async (req, reply) => {
    const body = ProfilePatch.safeParse(req.body);
    if (!body.success) return reply.code(400).send({ error: 'bad_request' });
    try {
      await social.updateProfile(req.user!, body.data);
    } catch {
      return reply.code(403).send({ error: 'locked' });
    }
    return { ok: true };
  });

  app.post('/api/grants/daily', authed, async (req) => social.claimDaily(req.user!));
  app.post('/api/grants/rescue', authed, async (req) => social.claimRescue(req.user!));
  app.get('/api/stats', authed, async (req) => social.stats(req.user!.id));
  app.get('/api/history', authed, async (req) => social.history(req.user!.id, 40));

  app.post('/api/rooms', { ...authed, config: { rateLimit: { max: 20, timeWindow: '1 minute' } } }, async (req, reply) => {
    const body = RoomCreate.safeParse(req.body ?? {});
    if (!body.success) return reply.code(400).send({ error: 'bad_request' });
    return manager.createRoom(req.user!, body.data, idemFrom(req.headers, `room:${req.user!.id}`));
  });
  app.post('/api/rooms/:roomId/rotate-code', authed, async (req, reply) => {
    try {
      return { code: await manager.rotateCode(req.user!, (req.params as any).roomId) };
    } catch (e) {
      return reply.code(e instanceof CmdError && e.code === 'forbidden' ? 403 : 404).send({ error: e instanceof CmdError ? e.code : 'not_found' });
    }
  });

  app.post('/api/groups', authed, async (req, reply) => {
    const body = z.object({ name: DisplayName }).safeParse(req.body);
    if (!body.success) return reply.code(400).send({ error: 'bad_request' });
    return social.createGroup(req.user!, body.data.name, idemFrom(req.headers, `group:${req.user!.id}`));
  });
  app.post('/api/groups/join', { ...authed, config: { rateLimit: { max: 20, timeWindow: '1 minute' } } }, async (req, reply) => {
    const body = z.object({ code: z.string().max(12) }).safeParse(req.body);
    if (!body.success) return reply.code(400).send({ error: 'bad_request' });
    const g = await social.joinGroup(req.user!, normalizeCode(body.data.code));
    if (!g) return reply.code(404).send({ error: 'not_found' });
    return g;
  });
  app.get('/api/groups', authed, async (req) => social.groups(req.user!, isOnline));
  app.post('/api/friends', { ...authed, config: { rateLimit: { max: 20, timeWindow: '1 minute' } } }, async (req, reply) => {
    const body = z.object({ friendCode: z.string().max(12) }).safeParse(req.body);
    if (!body.success) return reply.code(400).send({ error: 'bad_request' });
    const ok = await social.addFriend(req.user!, normalizeCode(body.data.friendCode));
    return ok ? { ok } : reply.code(404).send({ error: 'not_found' });
  });
  app.get('/api/friends', authed, async (req) => social.friends(req.user!, isOnline));
  app.get('/api/leaderboard', authed, async (req, reply) => {
    const qs = z.object({ groupId: z.string().max(64), kind: z.enum(['weekly', 'balance']).default('weekly') }).safeParse(req.query);
    if (!qs.success) return reply.code(400).send({ error: 'bad_request' });
    const lb = await social.leaderboard(req.user!, qs.data.groupId, qs.data.kind, opts.leaderboardMinHands ?? 20);
    return lb ?? reply.code(403).send({ error: 'forbidden' });
  });

  if (opts.webDist && existsSync(opts.webDist)) {
    await app.register(fastifyStatic, {
      root: opts.webDist,
      wildcard: false,
      preCompressed: true, // .br / .gz written at build time (apps/web/vite.config.ts precompress)
      setHeaders(res: any, path: string) {
        const set = (k: string, v: string) => (typeof res.setHeader === 'function' ? res.setHeader(k, v) : res.header(k, v));
        set('cache-control', path.includes('/assets/') ? 'public, max-age=31536000, immutable' : 'no-cache');
      },
    });
    app.get('/*', async (req, reply) => {
      const p = (req.params as any)['*'] as string;
      if (p.startsWith('api/')) return reply.code(404).send({ error: 'not_found' });
      if (p && existsSync(`${opts.webDist}/${p}`) && !p.includes('..')) return reply.sendFile(p);
      return reply.sendFile('index.html');
    });
  }

  await app.ready();
  // Idempotency keys only need to outlive a retry window.
  void pruneIdem(opts.db).catch(() => {});
  const pruneTimer = setInterval(() => void pruneIdem(opts.db).catch(() => {}), 3600_000);
  pruneTimer.unref?.();
  app.addHook('onClose', async () => clearInterval(pruneTimer));

  io = new IOServer(app.server, { serveClient: false, maxHttpBufferSize: 8 * 1024, cors: undefined });
  const cmdLimiter = new RateLimiter(12, 6);
  const joinLimiter = new RateLimiter(10, 0.3);
  const reactLast = new Map<string, number>();

  io.use(async (socket, next) => {
    try {
      const origin = socket.handshake.headers.origin;
      if (origin && new URL(origin).host !== socket.handshake.headers.host) return next(new Error('origin'));
      const raw = socket.handshake.headers.cookie ?? '';
      const token = app.parseCookie(raw)[SESSION_COOKIE];
      const user = await userFromToken(opts.db, token);
      if (!user) return next(new Error('unauthorized'));
      socket.data.user = user;
      socket.data.sessionId = user.session_id;
      socket.data.protocol = clientProtocol(socket.handshake.auth?.protocol);
      next();
    } catch {
      next(new Error('unauthorized'));
    }
  });

  io.on('connection', (socket) => {
    const user = socket.data.user as SessionUser;
    let roomId: string | null = null;
    onlineUsers.set(user.id, (onlineUsers.get(user.id) ?? 0) + 1);
    const sid = socket.data.sessionId as string;
    if (!socketsBySession.has(sid)) socketsBySession.set(sid, new Set());
    socketsBySession.get(sid)!.add(socket);

    const leave = async () => {
      if (!roomId) return;
      const r = roomId;
      roomId = null;
      socket.leave(r);
      await manager.disconnect(r, user.id);
    };

    socket.on('room:join', async (raw, ack) => {
      if (typeof ack !== 'function') return;
      if (!joinLimiter.take(user.id)) return ack({ ok: false, error: 'rate_limited' });
      const code = normalizeCode(String(raw?.code ?? ''));
      const room = code ? await manager.findByCode(code) : null;
      // A block with the room owner looks exactly like a missing room.
      if (!room || (room.owner_id !== user.id && (await blockedEither(opts.db, user.id, room.owner_id)))) return ack({ ok: false, error: 'not_found' });
      if (roomId !== room.id) {
        await leave();
        roomId = room.id;
        socket.join(room.id);
        await manager.connect(room.id, user.id);
      }
      const snap = (await manager.snapshots(room.id, [user.id])).get(user.id);
      ack({ ok: true, snapshot: snap });
    });

    socket.on('room:sync', async (_raw, ack) => {
      if (typeof ack !== 'function' || !roomId) return;
      ack({ ok: true, snapshot: (await manager.snapshots(roomId, [user.id])).get(user.id) });
    });

    socket.on('room:leave', async (_raw, ack) => {
      await leave();
      if (typeof ack === 'function') ack({ ok: true });
    });

    // Watching and resyncing stay open to an outdated client (it can see its hand); acting does not.
    const outdated = () => socket.data.protocol !== protocol;

    socket.on('cmd', async (raw, ack) => {
      if (typeof ack !== 'function') return;
      if (outdated()) return ack({ ok: false, error: 'client_outdated', version: 0, protocol });
      if (!cmdLimiter.take(socket.id)) return ack({ ok: false, error: 'rate_limited', version: 0 });
      const parsed = Command.safeParse(raw);
      if (!parsed.success) return ack({ ok: false, error: 'bad_request', version: 0 });
      if (parsed.data.roomId !== roomId) return ack({ ok: false, error: 'forbidden', version: 0 });
      ack(await manager.command(user, parsed.data));
    });

    socket.on('gift', async (raw, ack) => {
      const reply = typeof ack === 'function' ? ack : () => {};
      if (outdated()) return reply({ ok: false, error: 'client_outdated', protocol });
      const p = GiftInput.safeParse(raw);
      if (!p.success || p.data.roomId !== roomId) return reply({ ok: false, error: 'bad_request' });
      const member = await opts.db.query(
        `select 1 from seats where room_id = $1 and user_id = $2 union all select 1 from rooms where id = $1 and dealer_user_id = $2`,
        [p.data.roomId, p.data.recipientId],
      );
      const present = (manager.presence.get(p.data.roomId)?.get(p.data.recipientId)?.sockets ?? 0) > 0;
      if (!member.length && !present) return reply({ ok: false, error: 'not_found' });
      const r = await sendGift(opts.db, { roomId: p.data.roomId, senderId: user.id, recipientId: p.data.recipientId, giftId: p.data.giftId, eventId: p.data.eventId, now: now() });
      if (!r.ok) return reply({ ok: false, error: r.error });
      if (!r.duplicate) io.to(p.data.roomId).emit('room:gift', r.event);
      reply({ ok: true, duplicate: r.duplicate, event: r.event });
    });

    socket.on('react', (raw) => {
      if (outdated()) return;
      const p = ReactionInput.safeParse(raw);
      if (!p.success || p.data.roomId !== roomId) return;
      const t = now();
      if ((reactLast.get(user.id) ?? 0) + 2500 > t) return;
      reactLast.set(user.id, t);
      const r = roomId;
      void (async () => {
        const peers = await blockPeers(opts.db, user.id);
        const msg = { userId: user.id, name: user.name, reaction: p.data.reaction, at: t };
        if (!peers.size) return io.to(r).emit('room:reaction', msg);
        for (const s of await io.in(r).fetchSockets()) if (!peers.has((s.data.user as SessionUser).id)) s.emit('room:reaction', msg);
      })().catch(() => {});
    });

    socket.on('disconnect', async () => {
      socketsBySession.get(sid)?.delete(socket);
      if (!socketsBySession.get(sid)?.size) socketsBySession.delete(sid);
      onlineUsers.set(user.id, Math.max(0, (onlineUsers.get(user.id) ?? 1) - 1));
      await leave();
    });
  });

  return {
    app,
    io,
    manager,
    social,
    accounts,
    friends: friendsSvc,
    providers,
    async close() {
      manager.stop();
      io.close();
      await app.close();
    },
  };
}
