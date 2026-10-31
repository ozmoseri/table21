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
  const host = process.env.HOST ?? (deployment === 'lan' ? '0.0.0.0' : '127.0.0.1');
  const port = Number(process.env.PORT ?? 3021);
  const fast = process.env.T21_FAST === '1';
  const db = await openDb();
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
  await server.app.listen({ host, port });
  console.log(`[table21] ${deployment} server on ${tls ? 'https' : 'http'}://${host}:${port} (db: ${db.kind}, resumed rooms: ${resumed})`);
  const shutdown = async () => {
    await server.close();
    await db.close();
    process.exit(0);
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((e) => {
    console.error(e);
    process.exit(1);
  });
}
