import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import { createHash } from 'node:crypto';
import { readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { brotliCompressSync, constants, gzipSync } from 'node:zlib';

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
      const files = ['./', 'index.html', ...Object.keys(bundle), ...walk(publicDir)].filter((f) => f !== 'sw.js' && !f.endsWith('.map'));
      const version = createHash('sha256').update(files.join('|') + Date.now()).digest('hex').slice(0, 12);
      const source = `/* TABLE21 service worker ${version} */
const CACHE = 't21-${version}';
const PRECACHE = ${JSON.stringify(files.map((f) => (f.startsWith('./') ? f : './' + f)))};
self.addEventListener('install', (e) => { e.waitUntil(caches.open(CACHE).then((c) => c.addAll(PRECACHE)).then(() => self.skipWaiting())); });
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
