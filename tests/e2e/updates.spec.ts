import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { brotliCompressSync, gzipSync } from 'node:zlib';
import { createRequire } from 'node:module';
import { expect, test, type Page } from '@playwright/test';
import { SHOTS, createRoom, onboard, player } from './helpers.ts';

const { PNG } = createRequire(import.meta.url)('pngjs');
/**
 * Safe PWA updates in a real browser with the real service worker:
 * - a release that lands in the middle of a hand waits until the hand is over;
 * - nothing reloads until the player taps "refresh";
 * - an outdated client is refused by the server without touching coins;
 * - background images that fail to load fall back to CSS without moving anything.
 */
const DIST = 'apps/web/dist';

/**
 * Simulates a deploy while the page is open: a new build id in the client bundle (and its .br/.gz copies), a
 * byte-different service worker, and the server's version.json, exactly what a real release changes.
 */
function deployRelease(tag: string) {
  const swPath = `${DIST}/sw.js`;
  const sw = readFileSync(swPath, 'utf8');
  const old = /const VERSION = '([^']+)'/.exec(sw)![1];
  const next = `${old}-${tag}`;
  const files = [swPath, `${DIST}/version.json`, ...readdirSync(`${DIST}/assets`).filter((f) => f.endsWith('.js')).map((f) => `${DIST}/assets/${f}`)];
  const saved = new Map<string, Buffer>();
  for (const f of files) {
    const text = readFileSync(f, 'utf8');
    if (!text.includes(old)) continue;
    const changed = text.split(old).join(next);
    for (const extra of [f, `${f}.br`, `${f}.gz`]) {
      try {
        saved.set(extra, readFileSync(extra));
      } catch {}
    }
    writeFileSync(f, changed);
    if (saved.has(`${f}.br`)) writeFileSync(`${f}.br`, brotliCompressSync(Buffer.from(changed)));
    if (saved.has(`${f}.gz`)) writeFileSync(`${f}.gz`, gzipSync(Buffer.from(changed)));
  }
  return { old, next, restore: () => saved.forEach((buf, f) => writeFileSync(f, buf)) };
}

const controllerVersion = (page: Page) =>
  page.evaluate(
    () =>
      new Promise<string>((res) => {
        const ch = new MessageChannel();
        ch.port1.onmessage = (e) => res(e.data);
        navigator.serviceWorker.controller!.postMessage({ type: 'GET_VERSION' }, [ch.port2]);
      }),
  );

async function startLocalHand(page: Page) {
  for (let i = 0; i < 6; i++) {
    if (await page.getByTestId('next-round').isVisible().catch(() => false)) await page.getByTestId('next-round').click();
    await page.locator('.stake-chip').nth(1).click();
    await page.getByTestId('deal').click();
    await page.waitForTimeout(400);
    const phase = await page.getByTestId('local-game').getAttribute('data-phase');
    if (phase === 'player_turns') return;
    await expect(page.getByTestId('next-round')).toBeVisible({ timeout: 10_000 }); // a natural ended it at once: deal again
  }
  throw new Error('could not start a hand');
}
async function finishLocalHand(page: Page) {
  const end = Date.now() + 30_000;
  while (Date.now() < end) {
    if (await page.getByTestId('next-round').isVisible().catch(() => false)) return;
    const stand = page.locator('.act-stand');
    if ((await stand.isVisible().catch(() => false)) && (await stand.isEnabled({ timeout: 500 }).catch(() => false))) await stand.click({ timeout: 1000 }).catch(() => {});
    await page.waitForTimeout(150);
  }
  throw new Error('hand did not finish');
}

for (const vp of [
  { name: 'portrait', viewport: { width: 390, height: 844 } },
  { name: 'landscape', viewport: { width: 844, height: 390 } },
]) {
  test(`a release that lands mid-hand waits for the end of the hand, then asks; nothing reloads without a tap (${vp.name})`, async ({ browser }) => {
    const p = await player(browser, 'Update', vp.viewport);
    const page = p.page;
    await page.goto('/');
    await page.waitForFunction(() => !!navigator.serviceWorker.controller, null, { timeout: 20_000 });
    await page.goto('/#/practice');
    await expect(page.getByTestId('local-game')).toBeVisible();
    await startLocalHand(page);
    await page.evaluate(() => ((window as any).__samePage = true));

    const release = deployRelease(`${vp.name}-${Date.now().toString(36)}`);
    try {
      // The open page notices the release (on focus, every 15 minutes, or here: an explicit check).
      await page.evaluate(() => document.dispatchEvent(new Event('visibilitychange')));
      await page.evaluate(() => navigator.serviceWorker.getRegistration().then((r) => r?.update()));
      await page.waitForFunction(() => navigator.serviceWorker.getRegistration().then((r) => !!r?.waiting), null, { timeout: 20_000 });

      // Mid-hand: the new version is installed and waiting, but it has not taken over and nothing is shown.
      await page.waitForTimeout(1500);
      await expect(page.getByTestId('update-banner')).toHaveCount(0);
      expect(await page.getByTestId('local-game').getAttribute('data-phase')).toMatch(/player_turns|dealer_turn/);
      expect(await controllerVersion(page)).toBe(release.old);
      expect(await page.evaluate(() => (window as any).__samePage)).toBe(true);

      // End of the hand = safe point: the offer appears; still no reload and still the old worker until the tap.
      await finishLocalHand(page);
      const banner = page.getByTestId('update-banner');
      await expect(banner).toBeVisible({ timeout: 5000 });
      await expect(banner).toContainText('גרסה חדשה');
      const btn = (await page.getByTestId('update-apply').boundingBox())!;
      expect(btn.height).toBeGreaterThanOrEqual(47.5); // 48 px, subpixel rounding
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
      await page.waitForTimeout(400);
      await page.screenshot({ path: `${SHOTS}/update-ready-${vp.name}.png` });
      expect(await controllerVersion(page)).toBe(release.old);
      expect(await page.evaluate(() => (window as any).__samePage)).toBe(true);

      if (vp.name === 'portrait') {
        // "Later" hides it; the next hand keeps it hidden; it comes back after that hand.
        await page.getByTestId('update-later').click();
        await expect(banner).toHaveCount(0);
        await startLocalHand(page);
        await page.waitForTimeout(800);
        await expect(banner).toHaveCount(0);
        await finishLocalHand(page);
        await expect(banner).toBeVisible({ timeout: 5000 });
      }

      // The tap: the waiting worker takes over and the page reloads into the new version.
      await Promise.all([page.waitForEvent('load', { timeout: 15_000 }), page.getByTestId('update-apply').click()]);
      await page.waitForFunction(() => !!navigator.serviceWorker.controller, null, { timeout: 10_000 });
      expect(await page.evaluate(() => (window as any).__samePage)).toBeUndefined();
      expect(await controllerVersion(page)).toBe(release.next);
      await expect(page.getByTestId('update-banner')).toHaveCount(0);
    } finally {
      release.restore();
      await p.ctx.close();
    }
  });
}

for (const vp of [
  { name: 'portrait', viewport: { width: 390, height: 844 } },
  { name: 'landscape', viewport: { width: 844, height: 390 } },
]) {
  test(`version mismatch in the middle of an online hand: actions refused, coins untouched, refresh returns to the same hand (${vp.name})`, async ({ browser }) => {
    const p = await player(browser, 'Stale', vp.viewport);
    const page = p.page;
    await onboard(p, 2);
    await createRoom(p);
    await page.getByTestId('sit').click();
    // Random shoe: a natural ends the round with no turn; then play the next one until there is a hand to act on.
    for (let i = 0; ; i++) {
      await page.locator('.stake-chip', { hasText: /^25$/ }).click();
      const deal = page.getByTestId('deal');
      if (await deal.isVisible({ timeout: 3000 }).catch(() => false)) await deal.click().catch(() => {});
      await expect(page.getByTestId('room')).toHaveAttribute('data-phase', /player_turns|results/, { timeout: 15_000 });
      if ((await page.getByTestId('room').getAttribute('data-phase')) === 'player_turns') break;
      expect(i, 'a hand to act on within 5 deals').toBeLessThan(5);
      await expect(page.getByTestId('room')).toHaveAttribute('data-phase', /waiting|betting/, { timeout: 30_000 });
    }
    const me = () => page.evaluate(() => fetch('/api/me').then((r) => r.json()));
    const sync = () => page.evaluate(() => fetch('/api/me').then((r) => r.json()).then((m) => m.wallet));
    const before = await sync();
    const roundBefore = await page.getByTestId('room').getAttribute('data-phase');

    // This tab now behaves like one built before a protocol change (test builds only; simulated mismatch).
    await page.evaluate(() => sessionStorage.setItem('t21:lab-protocol', '2'));
    await page.reload();
    const notice = page.getByTestId('outdated-notice');
    await expect(notice).toBeVisible({ timeout: 10_000 });
    await expect(notice).toContainText('קוינס');
    const stand = page.locator('.act-stand');
    if (await stand.isEnabled({ timeout: 2000 }).catch(() => false)) {
      await stand.click();
      await expect(page.getByText('צריך לרענן לגרסה החדשה')).toBeVisible({ timeout: 5000 });
    }
    expect(await sync()).toEqual(before);
    expect(await page.getByTestId('room').getAttribute('data-phase')).toBe(roundBefore);
    await page.screenshot({ path: `${SHOTS}/update-outdated-${vp.name}.png` });

    // The tap: same room, same hand, same coins, and the actions work again.
    await Promise.all([page.waitForEvent('load', { timeout: 15_000 }), page.getByTestId('outdated-apply').click()]);
    await expect(page.getByTestId('room')).toBeVisible({ timeout: 10_000 });
    await expect(notice).toHaveCount(0);
    expect(await sync()).toEqual(before);
    const end = Date.now() + 20_000;
    while (Date.now() < end && (await page.getByTestId('room').getAttribute('data-phase')) !== 'results') {
      if (await stand.isEnabled({ timeout: 300 }).catch(() => false)) await stand.click().catch(() => {});
      await page.waitForTimeout(200);
    }
    await expect(page.getByTestId('room')).toHaveAttribute('data-phase', 'results');
    const after = (await me()).wallet;
    expect(after.reservedUnits).toBe(0);
    await p.ctx.close();
  });
}

async function boxes(page: Page, sel: string[]) {
  return page.evaluate((s) => s.map((q) => [...document.querySelectorAll(q)].slice(0, 6).map((e) => {
    const r = e.getBoundingClientRect();
    return [q, Math.round(r.x), Math.round(r.y), Math.round(r.width), Math.round(r.height)].join(':');
  })).flat(), sel);
}
const LAYOUT = ['.felt', '.room-head', '.status-line', '.card', '.seat', '.actions .act', '.stake-chip', '.dealer-cards', '.gift-icon'];

test('background images that fail to load fall back to CSS without moving anything (portrait and landscape)', async ({ browser }) => {
  for (const viewport of [{ width: 390, height: 844 }, { width: 844, height: 390 }]) {
    const shots: Record<string, string[]> = {};
    for (const mode of ['images', 'blocked'] as const) {
      const ctx = await browser.newContext({ viewport, isMobile: true, hasTouch: true, deviceScaleFactor: 2, serviceWorkers: 'block' });
      const page = await ctx.newPage();
      const failed: string[] = [];
      if (mode === 'blocked') await page.route('**/art/club/**', (r) => (failed.push(r.request().url()), r.abort('failed')));
      for (const path of ['/#/lab/three', '/#/practice']) {
        await page.goto(path);
        await page.waitForLoadState('networkidle');
        await page.waitForTimeout(600);
        shots[`${mode}${path}`] = await boxes(page, LAYOUT);
        expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
        if (mode === 'blocked') {
          // The cloth is still a green table: sample the middle of the felt in a real screenshot.
          const png = PNG.sync.read(await page.locator('.felt').screenshot());
          const at = (x: number, y: number) => {
            const i = (png.width * Math.round(y) + Math.round(x)) * 4;
            return [png.data[i], png.data[i + 1], png.data[i + 2]];
          };
          for (const [fx, fy] of [[0.5, 0.45], [0.2, 0.6], [0.8, 0.3]]) {
            const [r, g, b] = at(png.width * fx, png.height * fy);
            expect(g, `felt pixel ${fx},${fy} = ${r},${g},${b}`).toBeGreaterThan(r + 15);
            expect(g).toBeGreaterThan(b);
          }
          // The room behind is the CSS gradient, not white or empty.
          const body = PNG.sync.read(await page.screenshot({ clip: { x: 1, y: Math.round(viewport.height / 2), width: 4, height: 4 } }));
          expect(body.data[0] + body.data[1] + body.data[2]).toBeLessThan(200);
          if (path === '/#/lab/three') {
            await expect(page.locator('svg.gift-icon').first()).toBeVisible(); // coffee falls back to its SVG icon
            await expect(page.locator('img.gift-art')).toHaveCount(0);
            const back = await page.locator('.card-back').first().evaluate((e) => getComputedStyle(e).backgroundImage);
            expect(back).toContain('/art/backs/classic.svg');
          }
          await page.screenshot({ path: `${SHOTS}/image-fallback-${viewport.width}x${viewport.height}-${path.includes('lab') ? 'table' : 'practice'}.png` });
        }
      }
      if (mode === 'blocked') expect(failed.length).toBeGreaterThan(3);
      await ctx.close();
    }
    for (const path of ['/#/lab/three', '/#/practice']) expect(shots[`blocked${path}`], `${viewport.width}x${viewport.height} ${path}`).toEqual(shots[`images${path}`]);
  }
});
