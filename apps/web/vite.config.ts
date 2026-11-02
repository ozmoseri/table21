import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import { readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { brotliCompressSync, constants, gzipSync } from 'node:zlib';
import { randomBytes } from 'node:crypto';
import { execSync } from 'node:child_process';

/**
 * One id per build, shared by the client bundle (__T21_BUILD__), the service worker and dist/version.json (read by the
 * server and returned from /api/config). An open client that sees a different id knows a newer version is deployed.
 */
const BUILD = process.env.T21_BUILD ?? `${new Date().toISOString().slice(0, 10).replace(/-/g, '')}-${randomBytes(4).toString('hex')}`;

/**
 * Which source a build was made from, for the About / diagnostics screen: the git commit (with "-dirty" when the working
 * tree had local changes) and the build time. Outside a git checkout it says "unknown" instead of guessing.
 */
function gitCommit(): string {
  if (process.env.T21_COMMIT) return process.env.T21_COMMIT;
  try {
    const sha = execSync('git rev-parse --short HEAD', { cwd: import.meta.dirname, stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim();
    const dirty = execSync('git status --porcelain -- . ../../packages', { cwd: import.meta.dirname, stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim();
    return dirty ? `${sha}-dirty` : sha;
  } catch {
    return 'unknown';
  }
}
const COMMIT = gitCommit();
const BUILT_AT = new Date().toISOString();

/**
 * Writes .br and .gz next to every text file in dist (scripts, styles, HTML, SVG, manifest, sw.js). The server serves
 * them with @fastify/static preCompressed, so a phone on a slow network downloads about a third of the bytes.
 * Images (WebP, PNG) are already compressed and are left alone.
 */
function precompress(): Plugin {
  let outDir = '';
  return {
    name: 'table21-precompress',
    apply: 'build',
    configResolved(c) {
      outDir = join(c.root, c.build.outDir);
    },
    closeBundle() {
      const walk = (d: string): string[] => readdirSync(d).flatMap((f) => (statSync(join(d, f)).isDirectory() ? walk(join(d, f)) : [join(d, f)]));
      for (const f of walk(outDir)) {
        if (!/\.(js|css|html|svg|webmanifest|json)$/.test(f)) continue;
        if (/(^|[\\/])(sw\.js|version\.json)$/.test(f)) continue; // tiny, and always fetched fresh
        const buf = readFileSync(f);
        if (buf.length < 1024) continue;
        writeFileSync(f + '.br', brotliCompressSync(buf, { params: { [constants.BROTLI_PARAM_QUALITY]: 11 } }));
        writeFileSync(f + '.gz', gzipSync(buf, { level: 9 }));
      }
    },
  };
}

/**
 * Generates /sw.js at build time with a precache list of every emitted file plus public assets,
 * so solo and pass-and-play keep working offline after the first visit. No third-party workbox needed.
 */
function serviceWorker(): Plugin {
  return {
    name: 'table21-sw',
    apply: 'build',
    generateBundle(_opts, bundle) {
      const publicDir = join(import.meta.dirname, 'public');
      const walk = (d: string): string[] =>
        readdirSync(d).flatMap((f) => (statSync(join(d, f)).isDirectory() ? walk(join(d, f)) : [relative(publicDir, join(d, f))]));
      this.emitFile({ type: 'asset', fileName: 'version.json', source: JSON.stringify({ build: BUILD, commit: COMMIT, builtAt: BUILT_AT }) });
      const files = ['./', 'index.html', ...Object.keys(bundle), ...walk(publicDir)].filter((f) => f !== 'sw.js' && f !== 'version.json' && !f.endsWith('.map'));
      const version = BUILD;
      const source = `/* TABLE21 service worker ${version} */
const VERSION = '${version}';
const CACHE = 't21-${version}';
const PRECACHE = ${JSON.stringify(files.map((f) => (f.startsWith('./') ? f : './' + f)))};
// A new version installs in the background and then WAITS: it never takes over a page in the middle of a hand.
// The page asks it to take over (SKIP_WAITING) only at a safe point, after the player taps "refresh"
// (apps/web/src/update.ts). With no page open, it simply takes over on the next launch.
// no-cache: revalidate each file with the server (a 304 is cheap) so a release never precaches a stale copy.
self.addEventListener('install', (e) => { e.waitUntil(caches.open(CACHE).then((c) => c.addAll(PRECACHE.map((u) => new Request(u, { cache: 'no-cache' }))))); });
self.addEventListener('message', (e) => {
  if (e.data && e.data.type === 'SKIP_WAITING') self.skipWaiting();
  if (e.data && e.data.type === 'GET_VERSION' && e.ports[0]) e.ports[0].postMessage(VERSION);
});
self.addEventListener('activate', (e) => { e.waitUntil(caches.keys().then((ks) => Promise.all(ks.filter((k) => k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim())); });
self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET' || url.origin !== location.origin) return;
  if (url.pathname.startsWith('/api/') || url.pathname.startsWith('/socket.io/')) return;
  if (e.request.mode === 'navigate') {
    // Network first; if the server is down or answers with a 5xx (asleep, restarting), use the cached app shell.
    // A sleeping free host can hold the request for about a minute: after 4 s the cached shell answers instead and the
    // app shows its own "waking up" screen while it retries.
    const shell = () => caches.match('./index.html', { ignoreSearch: true });
    const net = fetch(e.request).then((r) => (r.status >= 500 ? shell().then((c) => c || r) : r));
    const slow = new Promise((res) => setTimeout(res, 4000)).then(shell).then((c) => c || net);
    e.respondWith(Promise.race([net, slow]).catch(shell));
    return;
  }
  e.respondWith(caches.match(e.request, { ignoreSearch: true }).then((hit) => hit || fetch(e.request)));
});
`;
      this.emitFile({ type: 'asset', fileName: 'sw.js', source });
    },
  };
}

export default defineConfig({
  plugins: [react(), serviceWorker(), precompress()],
  define: { __T21_BUILD__: JSON.stringify(BUILD), __T21_COMMIT__: JSON.stringify(COMMIT), __T21_BUILT_AT__: JSON.stringify(BUILT_AT) },
  base: '/',
  build: { target: 'es2022', sourcemap: false, assetsInlineLimit: 0 },
  server: {
    port: 5173,
    proxy: {
      '/api': 'http://127.0.0.1:3021',
      '/socket.io': { target: 'http://127.0.0.1:3021', ws: true },
    },
  },
});
