#!/usr/bin/env node
// LAN host: one computer serves the complete game to phones on the same Wi-Fi. No internet or cloud needed.
// Usage: pnpm lan [--rebuild]    Optional HTTPS: T21_TLS_CERT=... T21_TLS_KEY=... pnpm lan
import { spawn, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync } from 'node:fs';
import { networkInterfaces } from 'node:os';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(join(root, 'apps/server/package.json'));
const QRCode = require('qrcode');
const port = Number(process.env.PORT ?? 3021);
const https = !!(process.env.T21_TLS_CERT && process.env.T21_TLS_KEY);

if (process.argv.includes('--rebuild') || !existsSync(join(root, 'apps/web/dist/index.html'))) {
  console.log('Building the web client...');
  const r = spawnSync('pnpm', ['--filter', '@table21/web', 'build'], { cwd: root, stdio: 'inherit' });
  if (r.status !== 0) process.exit(r.status ?? 1);
}
const dataDir = process.env.T21_DATA_DIR ?? join(root, '.data', 'lan');
mkdirSync(dataDir, { recursive: true });

const server = spawn('pnpm', ['--filter', '@table21/server', 'start'], {
  cwd: root,
  stdio: ['inherit', 'pipe', 'inherit'],
  env: { ...process.env, T21_DEPLOYMENT: 'lan', HOST: process.env.HOST ?? '0.0.0.0', PORT: String(port), T21_DATA_DIR: dataDir },
});
let shown = false;
server.stdout.on('data', async (buf) => {
  process.stdout.write(buf);
  if (shown || !String(buf).includes('server on')) return;
  shown = true;
  const addrs = Object.values(networkInterfaces()).flat().filter((i) => i && i.family === 'IPv4' && !i.internal).map((i) => i.address);
  if (!addrs.length) console.log('\nNo LAN address found. Connect this computer to the Wi-Fi network first.');
  for (const a of addrs) {
    const url = `${https ? 'https' : 'http'}://${a}:${port}/`;
    console.log(`\nPhones on the same Wi-Fi open: ${url}`);
    console.log(await QRCode.toString(url, { type: 'terminal', small: true }));
  }
  console.log('If a phone cannot connect: allow Node in the firewall, and avoid guest networks with client isolation. See docs/LAN_SETUP.md.');
  if (!https) console.log('Plain http: play works, but phones cannot install the app or use offline mode. See docs/LAN_SETUP.md for HTTPS.');
});
const stop = () => server.kill('SIGTERM');
process.on('SIGINT', stop);
process.on('SIGTERM', stop);
server.on('exit', (c) => process.exit(c ?? 0));
