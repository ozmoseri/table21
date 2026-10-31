import Fastify, { type FastifyReply, type FastifyRequest } from 'fastify';
import cookie from '@fastify/cookie';
import rateLimit from '@fastify/rate-limit';
import fastifyStatic from '@fastify/static';
import { Server as IOServer } from 'socket.io';
import { existsSync } from 'node:fs';
import { networkInterfaces } from 'node:os';
import { z } from 'zod';
import type { Card } from '@table21/game-engine';
import { AVATARS, Command, DisplayName, ReactionInput, RoomCreate, SessionCreate } from '@table21/protocol';
import type { Db } from './db.ts';
import { DEFAULT_ECONOMY, SESSION_COOKIE, createGuest, userFromToken, type Economy, type SessionUser } from './auth.ts';
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
}

declare module 'fastify' {
  interface FastifyRequest {
    user: SessionUser | null;
  }
}

export async function buildApp(opts: AppOptions) {
  const deployment = opts.deployment ?? 'online';
  const eco: Economy = { ...DEFAULT_ECONOMY, ...opts.economy };
  const now = opts.now ?? Date.now;
  const app = Fastify({ logger: opts.logger ? { level: 'info' } : false, trustProxy: true, bodyLimit: 16 * 1024 });
  await app.register(cookie);
  await app.register(rateLimit, { max: 600, timeWindow: '1 minute' });

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
  const onlineUsers = new Map<string, number>();
  const isOnline = (id: string) => (onlineUsers.get(id) ?? 0) > 0;

  app.addHook('onSend', async (_req, reply, payload) => {
    reply.header('x-content-type-options', 'nosniff');
    reply.header('referrer-policy', 'same-origin');
    reply.header(
      'content-security-policy',
      "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; font-src 'self'; connect-src 'self' ws: wss:; frame-ancestors 'none'; base-uri 'self'",
    );
    return payload;
  });

  app.decorateRequest('user', null);
  app.addHook('preHandler', async (req) => {
    req.user = await userFromToken(opts.db, req.cookies[SESSION_COOKIE]);
  });

  /** CSRF: state-changing API calls need a custom header (not sendable cross-site without CORS) and a same-origin Origin. */
  const guard = async (req: FastifyRequest, reply: FastifyReply) => {
    if (req.method === 'GET' || req.method === 'HEAD') return;
    const origin = req.headers.origin;
    if (req.headers['x-t21'] !== '1') return reply.code(403).send({ error: 'csrf' });
    if (origin && new URL(origin).host !== req.headers.host) return reply.code(403).send({ error: 'origin' });
  };
  const needUser = async (req: FastifyRequest, reply: FastifyReply) => {
    if (!req.user) return reply.code(401).send({ error: 'unauthorized' });
  };
  const secure = (req: FastifyRequest) => req.protocol === 'https';
  const authed = { preHandler: [guard, needUser] };

  app.get('/api/health', async () => ({ ok: true, db: opts.db.kind, deployment }));
  app.get('/api/config', async () => ({ deployment, ads: adsStatus(), avatars: AVATARS, leaderboardMinHands: opts.leaderboardMinHands ?? 20 }));
  app.get('/api/lan-info', async () => {
    if (deployment !== 'lan') return { addresses: [] };
    const addrs = Object.values(networkInterfaces())
      .flat()
      .filter((i): i is NonNullable<typeof i> => !!i && i.family === 'IPv4' && !i.internal)
      .map((i) => i.address);
    return { addresses: addrs };
  });

  app.post('/api/session', { preHandler: guard, config: { rateLimit: { max: 10, timeWindow: '1 minute' } } }, async (req, reply) => {
    const body = SessionCreate.safeParse(req.body);
    if (!body.success) return reply.code(400).send({ error: 'bad_request' });
    if (req.user) {
      await social.updateProfile(req.user, { name: body.data.name, avatar: body.data.avatar, locale: body.data.locale });
      return { ok: true, created: false };
    }
    const { token } = await createGuest(opts.db, body.data, eco);
    reply.setCookie(SESSION_COOKIE, token, { httpOnly: true, sameSite: 'lax', path: '/', secure: secure(req), maxAge: 400 * 24 * 3600 });
    return { ok: true, created: true };
  });

  app.get('/api/me', async (req, reply) => {
    if (!req.user) return reply.code(401).send({ error: 'unauthorized' });
    return social.me(req.user);
  });

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
    return manager.createRoom(req.user!, body.data);
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
    return social.createGroup(req.user!, body.data.name);
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
      setHeaders(res, path) {
        if (path.includes('/assets/')) (res as any).setHeader('cache-control', 'public, max-age=31536000, immutable');
        else (res as any).setHeader('cache-control', 'no-cache');
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
      next();
    } catch {
      next(new Error('unauthorized'));
    }
  });

  io.on('connection', (socket) => {
    const user = socket.data.user as SessionUser;
    let roomId: string | null = null;
    onlineUsers.set(user.id, (onlineUsers.get(user.id) ?? 0) + 1);

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
      if (!room) return ack({ ok: false, error: 'not_found' });
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

    socket.on('cmd', async (raw, ack) => {
      if (typeof ack !== 'function') return;
      if (!cmdLimiter.take(socket.id)) return ack({ ok: false, error: 'rate_limited', version: 0 });
      const parsed = Command.safeParse(raw);
      if (!parsed.success) return ack({ ok: false, error: 'bad_request', version: 0 });
      if (parsed.data.roomId !== roomId) return ack({ ok: false, error: 'forbidden', version: 0 });
      ack(await manager.command(user, parsed.data));
    });

    socket.on('react', (raw) => {
      const p = ReactionInput.safeParse(raw);
      if (!p.success || p.data.roomId !== roomId) return;
      const t = now();
      if ((reactLast.get(user.id) ?? 0) + 2500 > t) return;
      reactLast.set(user.id, t);
      io.to(roomId).emit('room:reaction', { userId: user.id, name: user.name, reaction: p.data.reaction, at: t });
    });

    socket.on('disconnect', async () => {
      onlineUsers.set(user.id, Math.max(0, (onlineUsers.get(user.id) ?? 1) - 1));
      await leave();
    });
  });

  return {
    app,
    io,
    manager,
    social,
    async close() {
      manager.stop();
      io.close();
      await app.close();
    },
  };
}
