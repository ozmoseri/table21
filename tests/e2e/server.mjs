// Starts a production-like server for e2e: real PostgreSQL (fresh table21_e2e schema), built client, fast timers.
import { spawn, spawnSync } from 'node:child_process';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';
const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const url = process.env.T21_E2E_DATABASE_URL ?? 'postgres://t21@127.0.0.1:55432/table21_e2e';
spawnSync('pnpm', ['--filter', '@table21/web', 'build'], { cwd: root, stdio: 'inherit' });
const c = new pg.Client({ connectionString: url });
await c.connect();
await c.query('drop schema if exists public cascade; create schema public;');
await c.end();
const p = spawn('pnpm', ['--filter', '@table21/server', 'start'], {
  cwd: root,
  stdio: 'inherit',
  env: { ...process.env, DATABASE_URL: url, PORT: '3121', T21_FAST: '1' },
});
process.on('SIGTERM', () => p.kill('SIGTERM'));
process.on('SIGINT', () => p.kill('SIGTERM'));
