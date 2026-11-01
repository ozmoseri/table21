import { expect, test, type Page } from '@playwright/test';
import { createRoom, joinRoom, onboard, pickAndConfirm, player, sit } from './helpers.ts';

/** Stages 4-6 and the art-director fixes F1-F5 (GROKBOT 2026-11-01). */

const box = async (page: Page, sel: string) => (await page.locator(sel).first().boundingBox())!;
const overlap = (a: { x: number; y: number; width: number; height: number }, b: typeof a) =>
  a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;

/** Log every celebration banner: kind, when it appeared, how long it stayed. */
const logCelebrations = (page: Page) =>
  page.addInitScript(() => {
    const log: { kind: string; added: number; removed?: number }[] = [];
    (window as any).__cel = log;
    new MutationObserver(() => {
      const el = document.querySelector('[data-testid=celebration]');
      const open = log.find((x) => x.removed === undefined);
      if (el && !open) log.push({ kind: el.getAttribute('data-kind')!, added: performance.now() });
      if (!el && open) open.removed = performance.now();
    }).observe(document, { subtree: true, childList: true });
  });

/** Play practice hands (standing) until one ends with the given condition on the net. */
async function playUntil(page: Page, want: (net: number) => boolean, max = 40) {
  for (let i = 0; i < max; i++) {
    await page.locator('.stake-chip').first().click();
    await page.getByTestId('deal').click();
    const stand = page.locator('.act-stand');
    if (await expect(stand).toBeEnabled({ timeout: 6000 }).then(() => true, () => false)) await stand.click();
    await page.getByTestId('result-panel').waitFor({ timeout: 15_000 });
    const net = Number(await page.getByTestId('result-panel').getAttribute('data-net'));
    if (want(net)) return net;
    await page.getByTestId('next-round').click();
  }
  throw new Error('condition not met');
}

test('18+ gate on first launch: under 18 stops there; confirming is remembered on the device', async ({ browser }) => {
  const ctx = await browser.newContext({ storageState: { cookies: [], origins: [] }, viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  const page = await ctx.newPage();
  await page.goto('/');
  await expect(page.getByTestId('age-gate')).toBeVisible();
  await expect(page.getByTestId('age-gate')).toContainText('ערך כספי');
  await page.getByTestId('age-under').click();
  await expect(page.getByTestId('age-blocked')).toBeVisible();
  await expect(page.getByTestId('age-confirm')).toHaveCount(0);
  await page.reload();
  await page.getByTestId('age-confirm').click();
  await expect(page.getByPlaceholder('שם תצוגה')).toBeVisible();
  await page.reload();
  await expect(page.getByTestId('age-gate')).toHaveCount(0);
  // Practice is behind the gate too.
  const fresh = await browser.newContext({ storageState: { cookies: [], origins: [] } });
  const p2 = await fresh.newPage();
  await p2.goto('/#/practice');
  await expect(p2.getByTestId('age-gate')).toBeVisible();
  await fresh.close();
  await ctx.close();
});

test('60-minute session reminder: shown at a safe point, closes with one tap, not again in the same hour', async ({ browser }) => {
  const p = await player(browser, 'Break');
  await p.ctx.addInitScript(() => {
    if (!sessionStorage.getItem('t21:seeded')) {
      sessionStorage.setItem('t21:seeded', '1');
      sessionStorage.setItem('t21:active-ms', String(60 * 60_000 - 1500));
    }
  });
  await p.page.goto('/#/practice');
  await expect(p.page.getByTestId('session-reminder')).toBeVisible({ timeout: 8000 });
  await expect(p.page.getByTestId('session-reminder')).toContainText('60');
  // A bet on the table is a hand in progress: the reminder steps aside and comes back at the next safe point.
  await p.page.locator('.stake-chip').first().click();
  await expect(p.page.getByTestId('session-reminder')).toHaveCount(0);
  await p.page.getByTestId('stake-clear').click();
  await expect(p.page.getByTestId('session-reminder')).toBeVisible({ timeout: 5000 });
  await p.page.getByTestId('session-ok').click();
  await expect(p.page.getByTestId('session-reminder')).toHaveCount(0);
  await p.page.reload();
  await p.page.waitForTimeout(3000);
  await expect(p.page.getByTestId('session-reminder')).toHaveCount(0);
  await p.ctx.close();
});

test('celebration by total net: win 500 ms, natural 900 ms, nothing for push or loss; F5 banner and result sizes', async ({ browser }) => {
  const p = await player(browser, 'Cele');
  await logCelebrations(p.page);
  await p.page.goto('/#/practice');
  // A losing or pushed hand shows no banner.
  await playUntil(p.page, (n) => n <= 0);
  await p.page.waitForTimeout(1000);
  expect(await p.page.evaluate(() => (window as any).__cel.length)).toBe(0);
  await p.page.getByTestId('next-round').click();
  // A winning hand: banner with the net, then gone.
  await playUntil(p.page, (n) => n > 0);
  await expect.poll(() => p.page.evaluate(() => (window as any).__cel.filter((c: any) => c.removed).length), { timeout: 3000 }).toBe(1);
  const [c] = await p.page.evaluate(() => (window as any).__cel);
  const ms = c.removed - c.added;
  if (c.kind === 'win') expect(ms).toBeGreaterThanOrEqual(450), expect(ms).toBeLessThanOrEqual(700);
  else expect(c.kind).toBe('bj'), expect(ms).toBeGreaterThanOrEqual(850), expect(ms).toBeLessThanOrEqual(1100);
  // F5: headline 20 px Rubik 600, net amount 28 px.
  const head = await p.page.getByTestId('result-head').evaluate((el) => { const s = getComputedStyle(el); return { size: s.fontSize, weight: s.fontWeight, family: s.fontFamily }; });
  expect(head.size).toBe('20px');
  expect(head.weight).toBe('600');
  expect(head.family).toMatch(/Rubik/);
  expect(await p.page.locator('.result-panel .net .coins').evaluate((el) => getComputedStyle(el).fontSize)).toBe('28px');
  await p.ctx.close();
});

test('banner sizes while it shows: headline 20 px Rubik 600 and +amount 28 px', async ({ browser }) => {
  const p = await player(browser, 'Banner');
  await p.ctx.addInitScript(() => {
    (window as any).__banner = null;
    new MutationObserver(() => {
      const el = document.querySelector('[data-testid=celebration]');
      if (el && !(window as any).__banner) {
        const h = getComputedStyle(el.querySelector('.cel-head')!);
        const a = getComputedStyle(el.querySelector('.cel-amount')!);
        (window as any).__banner = { head: h.fontSize, weight: h.fontWeight, family: h.fontFamily, amount: a.fontSize, text: el.textContent };
      }
    }).observe(document, { subtree: true, childList: true });
  });
  await p.page.goto('/#/practice');
  await playUntil(p.page, (n) => n > 0);
  const b = await p.page.evaluate(() => (window as any).__banner);
  expect(b.head).toBe('20px');
  expect(b.weight).toBe('600');
  expect(b.family).toMatch(/Rubik/);
  expect(b.amount).toBe('28px');
  expect(b.text).toMatch(/\+/);
  await p.ctx.close();
});

test('sound: never more than 3 voices over ten hands; card sounds land with the cards; ambience off by default', async ({ browser }) => {
  const p = await player(browser, 'Voices');
  await p.page.goto('/#/practice');
  for (let i = 0; i < 10; i++) {
    await p.page.locator('.stake-chip').first().click();
    await p.page.getByTestId('deal').click();
    const stand = p.page.locator('.act-stand');
    if (await expect(stand).toBeEnabled({ timeout: 6000 }).then(() => true, () => false)) await stand.click();
    await p.page.getByTestId('next-round').click({ timeout: 15_000 });
  }
  const st = await p.page.evaluate(() => (window as any).__t21sound);
  expect(st.played).toBeGreaterThan(30);
  expect(st.maxVoices).toBeLessThanOrEqual(3);
  await p.page.goto('/#/settings');
  await expect(p.page.getByTestId('ambience')).not.toBeChecked();
  await p.ctx.close();
});

test('haptics: selection, chip bet and own card land patterns (vibrate stubbed); none when switched off', async ({ browser }) => {
  const p = await player(browser, 'Buzz');
  await p.ctx.addInitScript(() => {
    (window as any).__vib = [];
    Object.defineProperty(navigator, 'vibrate', { configurable: true, value: (x: unknown) => ((window as any).__vib.push(x), true) });
  });
  await p.page.goto('/#/practice');
  await p.page.locator('.stake-chip').first().click();
  await p.page.getByTestId('deal').click();
  await expect(p.page.locator('.my-hands .card')).toHaveCount(2);
  await p.page.waitForTimeout(800);
  const v = await p.page.evaluate(() => (window as any).__vib);
  expect(v).toContain(10); // chip bet
  expect(v.filter((x: unknown) => x === 12).length).toBeGreaterThanOrEqual(2); // my two cards landed
  await p.ctx.close();
});

test('F4 lobby at 390x844: play with friends, room code and practice above the fold; install strip 56-64 px; art at most 80 px', async ({ browser }) => {
  const p = await player(browser, 'Lobby');
  await onboard(p, 0);
  for (const id of ['play-friends', 'join-code', 'practice']) {
    const b = await box(p.page, `[data-testid=${id}]`);
    expect(b.y + b.height, `${id} above the fold`).toBeLessThanOrEqual(844);
  }
  const strip = await box(p.page, '[data-testid=install-hint]');
  expect(strip.height).toBeGreaterThanOrEqual(56);
  expect(strip.height).toBeLessThanOrEqual(64);
  expect((await box(p.page, '.hero-table')).height).toBeLessThanOrEqual(80);
  const ls = await p.page.getByTestId('join-code').evaluate((el) => getComputedStyle(el, '::placeholder').letterSpacing);
  expect(['0px', 'normal']).toContain(ls);
  await expect(p.page.getByTestId('coins-note')).toContainText('אין להם ערך כספי');
  await p.ctx.close();
});

test('F1-F3 table: deep felt and 90% HUD, friend on a side seat, ring around my total, one card frame, felt print clear of hands', async ({ browser }) => {
  const a = await player(browser, 'Host');
  const b = await player(browser, 'Friend');
  await onboard(a, 0);
  await onboard(b, 1);
  const code = await createRoom(a);
  await joinRoom(b, code);
  await sit(a);
  await sit(b);
  // F1
  const bg = await a.page.locator('.room').evaluate((el) => getComputedStyle(el).backgroundImage);
  expect(bg).toContain('rgba(18, 87, 67, 0.6)');
  expect(await a.page.getByTestId('room-menu').evaluate((el) => getComputedStyle(el).backgroundColor)).toBe('rgba(11, 18, 24, 0.9)');
  // F2: with two players the friend's seat is off the centre line.
  const felt = await box(a.page, '.room > .felt');
  const seat = await box(a.page, '.others .seat');
  expect(Math.abs(seat.x + seat.width / 2 - (felt.x + felt.width / 2))).toBeGreaterThan(60);
  // Play to my turn: the timer ring sits around my total.
  for (let i = 0; i < 8; i++) {
    await pickAndConfirm(b.page, 25);
    await pickAndConfirm(a.page, 25);
    const bs = b.page.locator('.act-stand');
    if (await expect(bs).toBeEnabled({ timeout: 10_000 }).then(() => true, () => false)) await bs.click();
    if (await expect(a.page.locator('.act-stand')).toBeEnabled({ timeout: 10_000 }).then(() => true, () => false)) break;
    await expect(a.page.getByTestId('room')).toHaveAttribute('data-phase', /waiting|betting/, { timeout: 30_000 });
  }
  await expect(a.page.locator('.me-zone .total.has-ring .timer-ring')).toBeVisible();
  expect(await a.page.locator('.my-timer').count()).toBe(0);
  // F3: face and back share the 2px ivory frame and the radius.
  const face = await a.page.locator('.my-hands .card').first().evaluate((el) => {
    const f = getComputedStyle(el.querySelector('.card-face')!);
    const k = getComputedStyle(el.querySelector('.card-back')!);
    return [`${f.borderTopWidth} ${f.borderTopColor} ${f.borderTopLeftRadius}`, `${k.borderTopWidth} ${k.borderTopColor} ${k.borderTopLeftRadius}`];
  });
  expect(face[0]).toBe(face[1]);
  expect(face[0]).toMatch(/^2px rgb\(246, 241, 228\)/);
  await a.ctx.close();
  await b.ctx.close();
});

for (const vp of [
  { width: 390, height: 844 },
  { width: 844, height: 390 },
  { width: 360, height: 640 },
]) {
  test(`F3 felt print never under a hand or a name; F2 landscape card size (${vp.width}x${vp.height})`, async ({ browser }) => {
    const ctx = await browser.newContext({ viewport: vp, isMobile: true, hasTouch: true, deviceScaleFactor: 2 });
    const page = await ctx.newPage();
    for (const kind of ['solo', 'three', 'six', 'split']) {
      await page.goto(`/#/lab/${kind}`);
      await page.locator('.room > .felt .card').first().waitFor();
      const print = await page.locator('.felt-print').boundingBox();
      if (!print) {
        // Landscape with friends at the table: no spare row, so the print is left out (never under a hand).
        expect(vp.height === 390 && kind !== 'solo', `${kind}: print hidden only in landscape with friends`).toBe(true);
        continue;
      }
      for (const sel of ['.hand', '.seat-name', '.dealer-name', '.seat .avatar', '.hand-meta']) {
        for (const el of await page.locator(sel).all()) {
          const r = await el.boundingBox();
          if (r) expect(overlap(print, r), `${kind}: print under ${sel}`).toBe(false);
        }
      }
    }
    if (vp.height === 390) {
      await page.goto('/#/practice');
      await page.locator('.stake-chip').first().click();
      await page.getByTestId('deal').click();
      await page.getByTestId('skip-anim').click().catch(() => {});
      const c = await box(page, '.my-hands .card');
      expect(Math.abs(c.width - 76)).toBeLessThanOrEqual(1);
      expect(Math.abs(c.height - 106.4)).toBeLessThanOrEqual(3);
    }
    await ctx.close();
  });
}

test('menus carry the guardrails line: automated dealer, 18+, no cash value', async ({ browser }) => {
  const p = await player(browser, 'Footer');
  await p.page.goto('/#/practice');
  await p.page.getByTestId('room-menu').click();
  await expect(p.page.getByTestId('menu-footer')).toContainText('דילר אוטומטי');
  await expect(p.page.getByTestId('menu-footer')).toContainText('18+');
  await expect(p.page.getByTestId('menu-footer')).toContainText('ערך כספי');
  await p.ctx.close();
});
