import { expect, test, type Page } from '@playwright/test';
import { createRoom, onboard, player, sit } from './helpers.ts';

/** Experience round (2026-11-02): version diagnostics, entry, lobby order, stable anchors, round staging, audio headroom. */

const anchors = (page: Page) =>
  page.evaluate(() => {
    const r = (s: string) => {
      const e = document.querySelector(s);
      if (!e) return null;
      const b = e.getBoundingClientRect();
      return { top: Math.round(b.top), bottom: Math.round(b.bottom) };
    };
    return { hand: r('.me-zone .my-hands, .me-zone .bet-spot'), ctl: r('.room > .controls') };
  });

test('About and diagnostics: client and server commit, build time, protocol, origin; the versions match', async ({ browser }) => {
  const p = await player(browser, 'Diag');
  await onboard(p, 0);
  const cfg = await p.page.evaluate(() => fetch('/api/config').then((r) => r.json()));
  expect(cfg.commit).toBeTruthy();
  expect(cfg.builtAt).toMatch(/^\d{4}-\d\d-\d\dT/);
  expect(cfg.protocol).toBe(1);
  await p.page.goto('/#/settings');
  const about = p.page.getByTestId('about');
  await about.scrollIntoViewIfNeeded();
  await expect(about).toContainText(cfg.commit);
  await expect(about).toContainText(cfg.build);
  await expect(about).toContainText('127.0.0.1:3121');
  await expect(p.page.getByTestId('about-match')).toHaveClass(/ok/);
  await p.ctx.close();
});

test('entry: the first HTML paints a branded splash (no white page); a client that cannot load gets a short message and a retry', async ({ browser }) => {
  const p = await player(browser, 'Boot');
  const html = await p.page.request.get('/').then((r) => r.text());
  expect(html).toContain('data-testid="splash"');
  expect(html.replace(/\s+/g, '')).toContain('background:#0b1218');
  // The status says what happens; no invented loading percentage.
  expect(html).toContain('טוען את המשחק');
  expect(/<p class="splash-status"[^>]*>([^<]*)</.exec(html)![1]).not.toMatch(/\d/);
  await p.page.goto('/#/practice');
  await expect(p.page.getByTestId('splash')).toHaveCount(0); // the app replaced it
  // A phone that cannot fetch the game bundle:
  const ctx = await browser.newContext({ serviceWorkers: 'block' });
  const page = await ctx.newPage();
  await page.route('**/assets/*.js', (r) => r.abort('failed'));
  await page.goto('/');
  await expect(page.getByTestId('splash')).toBeVisible();
  await expect(page.locator('#splash-retry')).toBeVisible({ timeout: 15_000 });
  await expect(page.locator('#splash-status')).toContainText('נסו שוב');
  await ctx.close();
  await p.ctx.close();
});

test('lobby order: resume, play with friends, room code, practice, then the rest (account and install below)', async ({ browser }) => {
  const p = await player(browser, 'Order');
  await onboard(p, 1);
  await createRoom(p);
  await sit(p);
  await p.page.goto('/#/home');
  await p.page.reload();
  await expect(p.page.getByTestId('resume')).toBeVisible();
  const y = async (id: string) => (await p.page.getByTestId(id).boundingBox())!.y;
  const order = ['resume', 'play-friends', 'join-code', 'practice', 'friends-night', 'home-save'];
  const ys = [];
  for (const id of order) ys.push(await y(id));
  for (let i = 1; i < ys.length; i++) expect(ys[i], `${order[i]} after ${order[i - 1]}`).toBeGreaterThan(ys[i - 1]);
  await p.ctx.close();
});

for (const vp of [
  { width: 390, height: 844 },
  { width: 360, height: 640 },
  { width: 844, height: 390 },
]) {
  test(`stable anchors ${vp.width}x${vp.height}: my hand and the controls keep their place through bet, deal, turn and result`, async ({ browser }) => {
    const p = await player(browser, 'Anchor', vp);
    await p.page.goto('/#/practice');
    await p.page.locator('.stake-chip').first().waitFor();
    const seen: { phase: string; a: Awaited<ReturnType<typeof anchors>> }[] = [];
    seen.push({ phase: 'bet', a: await anchors(p.page) });
    for (let i = 0; i < 12; i++) {
      await p.page.locator('.stake-chip').first().click();
      await p.page.getByTestId('deal').click();
      await p.page.waitForTimeout(250);
      seen.push({ phase: 'deal', a: await anchors(p.page) });
      if (await p.page.locator('.act-stand:not([disabled])').waitFor({ timeout: 5000 }).then(() => true, () => false)) break;
      await p.page.getByTestId('next-round').click({ timeout: 10_000 });
    }
    seen.push({ phase: 'turn', a: await anchors(p.page) });
    await p.page.locator('.act-stand').click();
    await p.page.getByTestId('result-panel').waitFor();
    await p.page.waitForTimeout(800);
    seen.push({ phase: 'result', a: await anchors(p.page) });
    const ref = seen[0].a;
    for (const s of seen) {
      expect(Math.abs(s.a.hand!.bottom - ref.hand!.bottom), `${s.phase}: my hand bottom`).toBeLessThanOrEqual(2);
      expect(Math.abs(s.a.ctl!.bottom - ref.ctl!.bottom), `${s.phase}: controls bottom`).toBeLessThanOrEqual(2);
      if (vp.width < vp.height) expect(Math.abs(s.a.ctl!.top - ref.ctl!.top), `${s.phase}: controls top`).toBeLessThanOrEqual(2);
    }
    await p.ctx.close();
  });
}

test('round staging: a win pays chips from the dealer, a loss gets none; the next round sweeps the old cards away without waiting', async ({ browser }) => {
  const p = await player(browser, 'Stage');
  await p.ctx.addInitScript(() => {
    (window as any).__fx = { payout: 0, sweep: 0 };
    new MutationObserver((ms) => {
      for (const m of ms)
        for (const n of m.addedNodes) {
          if (!(n instanceof HTMLElement)) continue;
          if (n.classList.contains('payout-chip')) (window as any).__fx.payout++;
          if (n.classList.contains('sweep-layer')) (window as any).__fx.sweep++;
        }
    }).observe(document, { childList: true, subtree: true });
  });
  await p.page.goto('/#/practice');
  let sawWin = false;
  let sawLoss = false;
  for (let i = 0; i < 40 && !(sawWin && sawLoss); i++) {
    await p.page.evaluate(() => ((window as any).__fx.payout = 0));
    await p.page.locator('.stake-chip').first().click();
    await p.page.getByTestId('deal').click();
    const stand = p.page.locator('.act-stand');
    if (await expect(stand).toBeEnabled({ timeout: 6000 }).then(() => true, () => false)) await stand.click();
    await p.page.getByTestId('result-panel').waitFor({ timeout: 15_000 });
    await p.page.waitForTimeout(900);
    const net = Number(await p.page.getByTestId('result-panel').getAttribute('data-net'));
    const payout = await p.page.evaluate(() => (window as any).__fx.payout);
    if (net > 0) expect(payout, 'win pays chips').toBeGreaterThanOrEqual(3), (sawWin = true);
    if (net < 0) expect(payout, 'no chips on a loss').toBe(0), (sawLoss = true);
    const before = await p.page.evaluate(() => (window as any).__fx.sweep);
    const t0 = Date.now();
    await p.page.getByTestId('next-round').click();
    // The cleared table is ready at once (bet bar back within a frame or two), the sweep runs on copies.
    await p.page.locator('.stake-chip').first().waitFor();
    expect(Date.now() - t0).toBeLessThan(600);
    expect(await p.page.evaluate(() => (window as any).__fx.sweep)).toBe(before + 1);
    await expect(p.page.locator('.sweep-layer')).toHaveCount(0, { timeout: 1500 });
  }
  expect(sawWin && sawLoss).toBe(true);
  await p.ctx.close();
});

test('audio: overlapping events never clip after the limiter (worst case: stingers over card and chip sounds); events are logged for review', async ({ browser }) => {
  const p = await player(browser, 'Mix');
  await p.page.goto('/#/lab/three');
  await p.page.waitForFunction(() => typeof (window as any).__t21RenderEvents === 'function');
  const worst = [
    ...['deal', 'flip', 'chip', 'bet', 'deal'].map((s, i) => ({ s, t: 0.2 + i * 0.03 })),
    { s: 'win', t: 0.25 },
    { s: 'blackjack', t: 0.26 },
    { s: 'payout', t: 0.3 },
  ];
  const r = await p.page.evaluate(([ev]) => (window as any).__t21RenderEvents(ev, 2), [worst] as const);
  expect(r.played).toBeGreaterThan(0);
  expect(r.peak).toBeGreaterThan(0.05);
  expect(r.peak).toBeLessThan(1);
  // A real hand logs what was played, with times, for the proof video's audio track.
  await p.page.goto('/#/practice');
  await p.page.locator('.stake-chip').first().click();
  await p.page.getByTestId('deal').click();
  await expect.poll(() => p.page.evaluate(() => (window as any).__t21soundLog.length), { timeout: 4000 }).toBeGreaterThanOrEqual(4);
  await p.ctx.close();
});
