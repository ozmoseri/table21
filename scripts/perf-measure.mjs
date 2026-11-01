// Measures initial page weight and LCP on a cold browser (no HTTP cache, no service worker yet), mobile emulation,
// with and without a throttled network (Lighthouse "slow 4G": 1.6 Mbps down, 750 Kbps up, 150 ms RTT, 4x CPU).
// Usage: node scripts/perf-measure.mjs <baseUrl> <label> [out.json]
// The table page needs a client built with VITE_LAB=1 (as in e2e) so /#/lab/three exists.
import { chromium } from '@playwright/test';
import { writeFileSync } from 'node:fs';

const [base = 'http://127.0.0.1:3131', label = 'now', out] = process.argv.slice(2);
const pages = [
  { name: 'first-visit', path: '/' },
  { name: 'table', path: '/#/lab/three' },
];
const viewports = [
  { name: 'portrait-390x844', width: 390, height: 844 },
  { name: 'landscape-844x390', width: 844, height: 390 },
];
const networks = [
  { name: 'unthrottled', throttle: null },
  { name: 'slow-4g', throttle: { latency: 150, downloadThroughput: (1.6 * 1024 * 1024) / 8, uploadThroughput: (750 * 1024) / 8, cpu: 4 } },
];

const browser = await chromium.launch();
const rows = [];
for (const net of networks) {
  for (const vp of viewports) {
    for (const pg of pages) {
      const ctx = await browser.newContext({ viewport: { width: vp.width, height: vp.height }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, serviceWorkers: 'block' });
      const page = await ctx.newPage();
      const cdp = await ctx.newCDPSession(page);
      await cdp.send('Network.enable');
      await cdp.send('Network.setCacheDisabled', { cacheDisabled: true });
      if (net.throttle) {
        await cdp.send('Network.emulateNetworkConditions', { offline: false, latency: net.throttle.latency, downloadThroughput: net.throttle.downloadThroughput, uploadThroughput: net.throttle.uploadThroughput });
        await cdp.send('Emulation.setCPUThrottlingRate', { rate: net.throttle.cpu });
      }
      let bytes = 0;
      const byType = {};
      cdp.on('Network.loadingFinished', (e) => (bytes += e.encodedDataLength));
      const types = new Map();
      cdp.on('Network.responseReceived', (e) => types.set(e.requestId, { type: e.type, url: e.response.url }));
      cdp.on('Network.loadingFinished', (e) => {
        const t = types.get(e.requestId);
        if (!t) return;
        byType[t.type] = (byType[t.type] ?? 0) + e.encodedDataLength;
      });
      await page.addInitScript(() => {
        window.__lcp = [];
        new PerformanceObserver((l) => {
          for (const e of l.getEntries()) window.__lcp.push({ t: e.startTime, size: e.size, el: e.element ? e.element.tagName + '.' + String(e.element.className).slice(0, 40) : '', url: e.url });
        }).observe({ type: 'largest-contentful-paint', buffered: true });
      });
      await page.goto(base + pg.path, { waitUntil: 'load' });
      await page.waitForLoadState('networkidle');
      await page.waitForTimeout(800);
      // LCP is finalized on the first input; a tap-free way is to read the last entry after the page settles.
      const lcp = await page.evaluate(() => window.__lcp.at(-1) ?? null);
      const fcp = await page.evaluate(() => performance.getEntriesByName('first-contentful-paint')[0]?.startTime ?? null);
      rows.push({ label, network: net.name, viewport: vp.name, page: pg.name, kb: Math.round(bytes / 1024), byTypeKb: Object.fromEntries(Object.entries(byType).map(([k, v]) => [k, Math.round(v / 1024)])), fcpMs: fcp && Math.round(fcp), lcpMs: lcp && Math.round(lcp.t), lcpElement: lcp?.el, lcpUrl: lcp?.url?.replace(base, '') });
      await ctx.close();
    }
  }
}
await browser.close();
for (const r of rows) console.log(`${r.label}\t${r.network}\t${r.viewport}\t${r.page}\t${r.kb} KB\tFCP ${r.fcpMs} ms\tLCP ${r.lcpMs} ms\t${r.lcpElement} ${r.lcpUrl || ''}\t${JSON.stringify(r.byTypeKb)}`);
if (out) writeFileSync(out, JSON.stringify(rows, null, 2));
