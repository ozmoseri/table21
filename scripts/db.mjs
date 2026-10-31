#!/usr/bin/env node
// Local PostgreSQL for development and tests, in an isolated data directory (.data/pg, port 55432).
// Never touches any other database. Usage: node scripts/db.mjs start|stop|reset|status|url
import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readdirSync, rmSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const DATA = join(root, '.data', 'pg');
const SOCK = join(root, '.data', 'pg-sock');
const PORT = Number(process.env.T21_PG_PORT ?? 55432);
const DBS = ['table21', 'table21_test'];
export const url = (db = 'table21') => `postgres://t21@127.0.0.1:${PORT}/${db}`;

function binDir() {
  if (process.env.PG_BIN) return process.env.PG_BIN;
  try {
    return execFileSync('pg_config', ['--bindir'], { encoding: 'utf8' }).trim();
  } catch {}
  for (const base of ['/usr/lib/postgresql', '/opt/homebrew/opt', '/usr/local/opt']) {
    if (!existsSync(base)) continue;
    const hit = readdirSync(base)
      .sort()
      .reverse()
      .map((v) => join(base, v, 'bin'))
      .find((b) => existsSync(join(b, 'initdb')));
    if (hit) return hit;
  }
  throw new Error('PostgreSQL binaries not found. Install PostgreSQL 15+ or set PG_BIN, or use the embedded database (omit DATABASE_URL).');
}

// initdb refuses to run as root. In a root container, run the server as an unprivileged user.
const runAs = process.getuid?.() === 0 ? process.env.T21_PG_RUNAS ?? 'claude' : null;
function run(cmd, args, opts = {}) {
  const full = join(binDir(), cmd);
  const [c, a] = runAs ? ['sudo', ['-u', runAs, full, ...args]] : [full, args];
  const r = spawnSync(c, a, { stdio: opts.quiet ? 'pipe' : 'inherit', encoding: 'utf8' });
  if (r.status !== 0 && !opts.allowFail) throw new Error(`${cmd} failed: ${r.stderr ?? ''}`);
  return r;
}

function running() {
  return run('pg_ctl', ['-D', DATA, 'status'], { quiet: true, allowFail: true }).status === 0;
}

function start() {
  mkdirSync(SOCK, { recursive: true });
  if (!existsSync(join(DATA, 'PG_VERSION'))) {
    mkdirSync(DATA, { recursive: true });
    if (runAs) spawnSync('chown', ['-R', runAs, join(root, '.data')]);
    run('initdb', ['-D', DATA, '-U', 't21', '--auth=trust', '-E', 'UTF8', '--no-locale'], { quiet: true });
  }
  if (runAs) spawnSync('chown', ['-R', runAs, join(root, '.data')]);
  if (!running()) {
    run('pg_ctl', ['-D', DATA, '-l', join(root, '.data', 'pg.log'), '-w', '-o', `-p ${PORT} -k ${SOCK} -c listen_addresses=127.0.0.1`, 'start'], { quiet: true });
  }
  for (const db of DBS) {
    const exists = run('psql', ['-h', '127.0.0.1', '-p', String(PORT), '-U', 't21', '-d', 'postgres', '-tAc', `select 1 from pg_database where datname='${db}'`], { quiet: true });
    if (!exists.stdout.trim()) run('createdb', ['-h', '127.0.0.1', '-p', String(PORT), '-U', 't21', db], { quiet: true });
  }
  console.log(`postgres running on 127.0.0.1:${PORT}\nDATABASE_URL=${url()}`);
}

function stop() {
  if (running()) run('pg_ctl', ['-D', DATA, '-m', 'fast', 'stop'], { quiet: true });
  console.log('postgres stopped');
}

const cmd = process.argv[2] ?? 'status';
if (cmd === 'start') start();
else if (cmd === 'stop') stop();
else if (cmd === 'reset') {
  stop();
  rmSync(DATA, { recursive: true, force: true });
  start();
} else if (cmd === 'url') console.log(url(process.argv[3]));
else console.log(running() ? `running on ${PORT}` : 'stopped');
