// Deployment rehearsal (docs/DEPLOY.md): runs the production start command the way the free host does, behind an
// HTTPS/WSS proxy, then checks secure cookies, WSS, a hard restart in the middle of a hand, and a wiped data directory.
//
// Usage: node scripts/deploy-check.mjs <appDir> <databaseUrl> <certPem> <keyPem> <shotsDir>
// <appDir> is a built copy of the repository (after the host's build command).
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from '@playwright/test';

const [appDir, dbUrl, cert, key, shots] = process.argv.slice(2);
const here = dirname(fileURLToPath(import.meta.url));
const results = [];
const check = (name, ok, detail = '') => {
  results.push({ name, ok, detail });
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${detail ? ` (${detail})` : ''}`);
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function startServer(env) {
  const p = spawn(process.execPath, ['--import', 'tsx', 'src/main.ts'], {
    cwd: join(appDir, 'apps/server'),
    env: { PATH: process.env.PATH, HOME: process.env.HOME, RENDER: 'true', RENDER_EXTERNAL_URL: 'https://localhost:8443', PORT: '10000', NODE_ENV: 'production', T21_DEPLOYMENT: 'online', T21_FAST: '1', ...env },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let out = '';
  p.stdout.on('data', (d) => (out += d));
  p.stderr.on('data', (d) => (out += d));
  p.log = () => out;
  return p;
}
async function waitHealthy(ms = 30_000) {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    try {
      const r = await fetch('http://127.0.0.1:10000/api/health');
      if (r.ok) return Date.now();
    } catch {}
    await sleep(200);
  }
  throw new Error('server did not become healthy');
}

const proxy = spawn(process.execPath, [join(here, 'tls-proxy.mjs'), '8443', '10000', cert, key], { stdio: 'ignore' });
const browser = await chromium.launch();
try {
  /* ---------------- Postgres-backed service: restart in the middle of a hand ---------------- */
  let t0 = Date.now();
  let server = startServer({ DATABASE_URL: dbUrl });
  await waitHealthy();
  check('cold start to healthy (Postgres, includes migrations)', true, `${Date.now() - t0} ms`);
  const health = await (await fetch('http://127.0.0.1:10000/api/health')).json();
  check('health check /api/health', health.ok === true && health.db === 'postgres', JSON.stringify(health));
  check('listens on all interfaces on the platform', /0\.0\.0\.0:10000/.test(server.log()), server.log().split('\n').find((l) => l.includes('server on')) ?? '');

  const ctx = await browser.newContext({ ignoreHTTPSErrors: true, viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 });
  const page = await ctx.newPage();
  const sockets = [];
  page.on('websocket', (ws) => sockets.push(ws.url()));
  await page.goto('https://localhost:8443/');
  await page.getByPlaceholder('שם תצוגה').fill('עוז');
  await page.locator('.avatar-pick').first().click();
  await page.getByRole('button', { name: 'שמירה וכניסה' }).click();
  await page.getByTestId('play-friends').waitFor();
  const cookie = (await ctx.cookies()).find((c) => c.name === 't21s');
  check('session cookie is Secure, HttpOnly, SameSite=Lax behind the proxy', !!cookie && cookie.secure && cookie.httpOnly && cookie.sameSite === 'Lax');
  const csp = (await page.request.get('https://localhost:8443/api/config')).headers()['content-security-policy'] ?? '';
  check('CSP allows only this origin and wss', csp.includes("connect-src 'self' ws: wss:"));

  await page.getByTestId('play-friends').click();
  await page.getByTestId('create-room').click();
  await page.getByTestId('room').waitFor();
  check('realtime runs over WSS through the proxy', sockets.some((u) => u.startsWith('wss://localhost:8443/socket.io/')), sockets[0] ?? 'no socket');
  await page.getByTestId('sit').click();
  let dealt = false;
  for (let i = 0; i < 30 && !dealt; i++) {
    if (await page.locator('.act-stand').isVisible().catch(() => false)) dealt = true;
    else {
      if (await page.locator('.stake-chip').first().isVisible().catch(() => false) && !(await page.locator('.bet-spot.has-bet').isVisible().catch(() => false)))
        await page.locator('.stake-chip').first().click();
      await sleep(500);
    }
  }
  check('a hand reaches my turn', dealt);
  const before = await page.locator('.my-hands .card').evaluateAll((els) => els.map((e) => e.getAttribute('aria-label')).join(','));
  await page.screenshot({ path: join(shots, 'deploy-portrait-turn.png') });

  server.kill('SIGKILL');
  await sleep(1500);
  t0 = Date.now();
  server = startServer({ DATABASE_URL: dbUrl });
  await waitHealthy();
  check('hard restart in the middle of a hand: back up', true, `${Date.now() - t0} ms`);
  let same = '';
  for (let i = 0; i < 40; i++) {
    same = await page.locator('.my-hands .card').evaluateAll((els) => els.map((e) => e.getAttribute('aria-label')).join(','));
    if (same === before && (await page.locator('.act-stand').isEnabled({ timeout: 200 }).catch(() => false))) break;
    await sleep(500);
  }
  check('after the restart the player gets the same hand back (resync) and can act', same === before, `${before} -> ${same}`);
  await page.locator('.act-stand').click().catch(() => {});
  const settled = await page.getByTestId('result-panel').waitFor({ timeout: 30_000 }).then(() => true, () => false);
  check('the interrupted hand settles normally', settled);
  await page.setViewportSize({ width: 844, height: 390 });
  await sleep(600);
  await page.screenshot({ path: join(shots, 'deploy-landscape-result.png') });
  await ctx.close();
  server.kill('SIGTERM');
  await sleep(1000);

  /* ---------------- No database: ephemeral data directory wiped on restart ---------------- */
  const data = mkdtempSync(join(tmpdir(), 't21-eph-'));
  server = startServer({ T21_DATA_DIR: data });
  await waitHealthy();
  const ctx2 = await browser.newContext({ ignoreHTTPSErrors: true, viewport: { width: 390, height: 844 } });
  const p2 = await ctx2.newPage();
  const errors = [];
  p2.on('pageerror', (e) => errors.push(String(e)));
  await p2.goto('https://localhost:8443/');
  await p2.getByPlaceholder('שם תצוגה').fill('Guest');
  await p2.getByRole('button', { name: 'שמירה וכניסה' }).click();
  await p2.getByTestId('play-friends').waitFor();
  server.kill('SIGKILL');
  rmSync(data, { recursive: true, force: true });
  await sleep(500);
  server = startServer({ T21_DATA_DIR: mkdtempSync(join(tmpdir(), 't21-eph-')) });
  await waitHealthy();
  await p2.reload();
  const onboard = await p2.getByPlaceholder('שם תצוגה').waitFor({ timeout: 15_000 }).then(() => true, () => false);
  check('without a database a restart forgets accounts; the app falls back to a clean start', onboard && errors.length === 0, errors.join('; '));
  await ctx2.close();
  server.kill('SIGTERM');

  /* ---------------- Server asleep: the app keeps offline play and reconnects by itself ---------------- */
  const ctx3 = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const p3 = await ctx3.newPage();
  server = startServer({ DATABASE_URL: dbUrl });
  await waitHealthy();
  // Service workers refuse self-signed certificates, so this part talks to the server directly on http://localhost
  // (a secure context too). First visit installs the service worker.
  await p3.goto('http://localhost:10000/');
  await p3.waitForFunction(() => navigator.serviceWorker?.controller != null || navigator.serviceWorker?.ready.then(() => true), null, { timeout: 15_000 }).catch(() => {});
  await p3.reload();
  await p3.waitForTimeout(1000);
  server.kill('SIGKILL');
  await sleep(800);
  await p3.reload();
  const offline = await p3.getByTestId('offline-note').waitFor({ timeout: 15_000 }).then(() => true, () => false);
  check('while the server sleeps the page loads from cache and offers offline play', offline);
  server = startServer({ DATABASE_URL: dbUrl });
  await waitHealthy();
  const back = await p3.getByRole('button', { name: 'שמירה וכניסה' }).waitFor({ timeout: 20_000 }).then(() => true, () => false);
  check('when the server wakes the online start appears without a reload', back);
  await ctx3.close();
  server.kill('SIGTERM');
} finally {
  await browser.close();
  proxy.kill();
}
const failed = results.filter((r) => !r.ok).length;
console.log(`\n${results.length - failed}/${results.length} PASS`);
process.exit(failed ? 1 : 0);
