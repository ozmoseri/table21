#!/usr/bin/env node
// LAN host: one computer serves the complete game to phones on the same Wi-Fi. No internet, cloud or
// PostgreSQL install needed: data lives in an embedded database under .data/lan.
//
// Usage:  node scripts/lan.mjs [--rebuild] [--postgres]
//   --rebuild   rebuild the web client even if apps/web/dist exists
//   --postgres  use DATABASE_URL instead of the embedded database (off by default, so a DATABASE_URL
//               from another project on this computer is never touched)
// Env: PORT (default 3021), T21_DATA_DIR, T21_TLS_CERT + T21_TLS_KEY (optional HTTPS)
import { existsSync, mkdirSync, readdirSync, statSync } from 'node:fs';
import { networkInterfaces } from 'node:os';
import { join } from 'node:path';
import { createRequire } from 'node:module';
import { checkNode, fail, pkgFile, root, runNode, runNodeSync, serverDir, webDir } from './lib/proc.mjs';

checkNode();
const args = process.argv.slice(2);
const port = Number(process.env.PORT ?? 3021);
if (!Number.isInteger(port) || port < 1 || port > 65535) fail(`PORT "${process.env.PORT}" is not a valid port number.`);
const https = !!(process.env.T21_TLS_CERT && process.env.T21_TLS_KEY);

// 1. Build the web client when needed (vite runs through this same Node binary).
// Rebuild when the client sources are newer than the last build (for example after `git pull`).
function newestMtime(p) {
  if (!existsSync(p)) return 0;
  const st = statSync(p);
  if (!st.isDirectory()) return st.mtimeMs;
  return Math.max(0, ...readdirSync(p).map((f) => newestMtime(join(p, f))));
}
const builtAt = newestMtime(join(webDir, 'dist', 'index.html'));
const sourcesAt = Math.max(
  ...['src', 'public', 'index.html', 'vite.config.ts', 'package.json'].map((f) => newestMtime(join(webDir, f))),
  ...['game-engine', 'protocol'].map((pk) => newestMtime(join(root, 'packages', pk, 'src'))),
);
if (args.includes('--rebuild') || !builtAt || sourcesAt > builtAt) {
  console.log('[TABLE21] Building the web client...');
  runNodeSync([pkgFile(webDir, 'vite', 'bin/vite.js'), 'build'], { cwd: webDir, env: process.env, label: 'Web build' });
}

// 2. Start the server with the embedded database.
const dataDir = process.env.T21_DATA_DIR ?? join(root, '.data', 'lan');
try {
  mkdirSync(dataDir, { recursive: true });
} catch (e) {
  fail(`Cannot create the data folder ${dataDir}: ${e.message}`);
}
const env = { ...process.env, T21_DEPLOYMENT: 'lan', HOST: process.env.HOST ?? '0.0.0.0', PORT: String(port), T21_DATA_DIR: dataDir };
if (!args.includes('--postgres')) delete env.DATABASE_URL;
pkgFile(serverDir, 'tsx', 'package.json'); // clear message if dependencies are missing

const server = runNode(['--import', 'tsx', join('src', 'main.ts')], { cwd: serverDir, env, label: 'Server', stdio: ['inherit', 'pipe', 'inherit'] });

const QRCode = createRequire(join(serverDir, 'package.json'))('qrcode');
const VIRTUAL = /vEthernet|VirtualBox|VMware|WSL|Hyper-V|Loopback|docker|br-|veth|utun|tailscale|zerotier/i;
let shown = false;
server.stdout.on('data', async (buf) => {
  process.stdout.write(buf);
  if (shown || !String(buf).includes('server on')) return;
  shown = true;
  const all = Object.entries(networkInterfaces()).flatMap(([name, list]) =>
    (list ?? []).filter((i) => i.family === 'IPv4' && !i.internal).map((i) => ({ name, address: i.address })),
  );
  const likely = all.filter((i) => !VIRTUAL.test(i.name));
  const other = all.filter((i) => VIRTUAL.test(i.name));
  const scheme = https ? 'https' : 'http';
  if (!likely.length && !other.length) {
    console.log('\n[TABLE21] No network address found. Connect this computer to the Wi-Fi first.');
  }
  for (const i of likely) {
    const url = `${scheme}://${i.address}:${port}/`;
    console.log(`\n  Phones on the same Wi-Fi open:  ${url}    (adapter: ${i.name})`);
    console.log(await QRCode.toString(url, { type: 'terminal', small: true }));
  }
  if (other.length) console.log(`  Ignore these virtual adapters: ${other.map((i) => `${i.address} (${i.name})`).join(', ')}`);
  console.log(`  QR on this computer's screen: ${scheme}://localhost:${port}/#/lan`);
  console.log('  Phone cannot connect? Allow Node.js on Private networks in the firewall, and avoid guest Wi-Fi.');
  if (!https) console.log('  Plain http: play works; installing to the home screen and offline mode need HTTPS (docs/LAN_SETUP.md).');
  console.log('  Stop the host with Ctrl+C.\n');
});
server.on('exit', (code) => {
  if (code && code !== 0) console.error(`\n[TABLE21] The server stopped with exit code ${code}. See the messages above.`);
  process.exit(code ?? 0);
});
