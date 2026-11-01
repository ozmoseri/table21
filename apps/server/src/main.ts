import { resolve, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { mkdirSync, readFileSync } from 'node:fs';
import { buildApp } from './app.ts';
import { embeddedDb, migrate, postgresDb, type Db } from './db.ts';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');

export async function openDb(): Promise<Db> {
  if (process.env.DATABASE_URL) return postgresDb(process.env.DATABASE_URL);
  const dir = process.env.T21_DATA_DIR ?? join(root, '.data', 'embedded');
  mkdirSync(dir, { recursive: true });
  return embeddedDb(dir);
}

async function main() {
  const deployment = process.env.T21_DEPLOYMENT === 'lan' ? 'lan' : 'online';
  // Hosting platforms (Render sets RENDER and PORT) route traffic to the container, so listen on all interfaces there.
  const platform = !!process.env.RENDER;
  const host = process.env.HOST ?? (deployment === 'lan' || platform ? '0.0.0.0' : '127.0.0.1');
  if (!process.env.T21_PUBLIC_ORIGIN && process.env.RENDER_EXTERNAL_URL) process.env.T21_PUBLIC_ORIGIN = process.env.RENDER_EXTERNAL_URL;
  const port = Number(process.env.PORT ?? 3021);
  const fast = process.env.T21_FAST === '1';
  let db: Db;
  try {
    db = await openDb();
  } catch (e: any) {
    throw new Error(`Could not open the database (${e?.message ?? e}). If another TABLE21 server is running, close it first.`);
  }
  const applied = await migrate(db);
  if (applied.length) console.log(`[db] applied migrations: ${applied.join(', ')}`);
  const tls =
    process.env.T21_TLS_CERT && process.env.T21_TLS_KEY
      ? { cert: readFileSync(process.env.T21_TLS_CERT), key: readFileSync(process.env.T21_TLS_KEY) }
      : undefined;
  const server = await buildApp({
    db,
    https: tls,
    sessionRateLimit: process.env.T21_SESSION_RATE ? Number(process.env.T21_SESSION_RATE) : undefined,
    deployment,
    webDist: process.env.T21_WEB_DIST ?? join(root, 'apps/web/dist'),
    logger: process.env.T21_LOG === '1',
    timing: fast ? { dealerStepMs: 150, autoDealDelayMs: 300, humanDealerSeconds: 6, reconnectGraceMs: 4000 } : undefined,
  });
  const resumed = await server.manager.recover();
  try {
    await server.app.listen({ host, port });
  } catch (e: any) {
    if (e?.code === 'EADDRINUSE') throw new Error(`Port ${port} is already in use. Close the other TABLE21 window, or start with a different PORT (for example PORT=3022).`);
    if (e?.code === 'EACCES') throw new Error(`No permission to listen on port ${port}. Try a port above 1024.`);
    throw e;
  }
  console.log(`[table21] ${deployment} server on ${tls ? 'https' : 'http'}://${host}:${port} (db: ${db.kind}, resumed rooms: ${resumed})`);
  const shutdown = async () => {
    await server.close();
    await db.close();
    process.exit(0);
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

const self = fileURLToPath(import.meta.url);
const entry = process.argv[1] ? resolve(process.argv[1]) : '';
const same = process.platform === 'win32' ? entry.toLowerCase() === self.toLowerCase() : entry === self;
if (same) {
  main().catch((e) => {
    console.error(`[table21] ${e instanceof Error ? e.message : e}`);
    if (process.env.T21_LOG === '1') console.error(e);
    process.exit(1);
  });
}
