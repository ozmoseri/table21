import { expect, test, type Page } from '@playwright/test';
import { SHOTS, createRoom, onboard, pickAndConfirm, player, sit } from './helpers.ts';

type Box = { x: number; y: number; width: number; height: number };
const ready = async (l: ReturnType<Page['locator']>) => (await l.isVisible().catch(() => false)) && (await l.isEnabled({ timeout: 300 }).catch(() => false));
const overlap = (a: Box, b: Box) => a.x < b.x + b.width - 1 && b.x < a.x + a.width - 1 && a.y < b.y + b.height - 1 && b.y < a.y + a.height - 1;

/** Cards, totals and every action button are inside the viewport, at least 48x48, and nothing covers my hand. */
async function assertTurnFits(page: Page, label: string) {
  const vp = page.viewportSize()!;
  const hand = (await page.locator('.my-hands, .split').first().boundingBox())!;
  const total = (await page.locator('.me-zone .total').first().boundingBox())!;
  expect(hand, `${label}: hand`).toBeTruthy();
  for (const [n, b] of [['hand', hand], ['total', total]] as const) {
    expect(b.y, `${label}: ${n} top`).toBeGreaterThanOrEqual(-1);
    expect(b.y + b.height, `${label}: ${n} bottom`).toBeLessThanOrEqual(vp.height + 1);
  }
  const acts = await page.locator('.act').all();
  expect(acts.length, `${label}: four action slots`).toBe(4);
  for (const a of acts) {
    const b = (await a.boundingBox())!;
    expect(b.y + b.height, `${label}: action inside the screen`).toBeLessThanOrEqual(vp.height + 1);
    expect(Math.min(b.width, b.height), `${label}: action at least 48 px`).toBeGreaterThanOrEqual(47.5);
    expect(overlap(b, hand), `${label}: action over hand`).toBe(false);
  }
  for (const s of await page.locator('.others .seat').all()) expect(overlap((await s.boundingBox())!, hand), `${label}: seat over hand`).toBe(false);
}

test('one screen per turn at 360x640 and 844x390: lab 1, 3, 6 players and four split hands, Hebrew RTL and 125% text', async ({ browser }) => {
  for (const [w, h] of [
    [360, 640],
    [844, 390],
  ]) {
    const ctx = await browser.newContext({ viewport: { width: w, height: h }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 });
    const page = await ctx.newPage();
    for (const kind of ['solo', 'three', 'six', 'split']) {
      await page.goto(`/#/lab/${kind}`);
      await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');
      await assertTurnFits(page, `${kind} ${w}x${h}`);
      expect(await page.evaluate(() => document.documentElement.scrollHeight - innerHeight), `${kind} ${w}x${h}: no scroll`).toBeLessThanOrEqual(1);
      if (kind === 'split') {
        await expect(page.getByTestId('hand-label')).toContainText('משחקת עכשיו');
        await expect(page.getByTestId('status')).toContainText('יד 3 מתוך 4');
      }
      await page.screenshot({ path: `${SHOTS}/p0-${kind}-${w}x${h}.png` });
    }
    await page.goto('/#/lab/six');
    await page.addStyleTag({ content: 'html { font-size: 125% !important; } body { font-size: 20px !important; }' });
    await assertTurnFits(page, `six ${w}x${h} text 125%`);
    await ctx.close();
  }
});

test('online room at 360x640: the turn fits, the buttons keep their places, a double tap sends one decision', async ({ browser }) => {
  const a = await player(browser, 'רוני אלמוג-כהן', { width: 360, height: 640 });
  await onboard(a, 2);
  await createRoom(a);
  await sit(a);
  // Bet until a hand where hitting is possible (a natural or a dealer blackjack ends the round at once).
  for (let i = 0; i < 40; i++) {
    if (await ready(a.page.locator('.act-hit'))) break;
    if ((await ready(a.page.locator('.stake-chip').first())) && !(await a.page.locator('.bet-spot.has-bet').isVisible().catch(() => false))) await pickAndConfirm(a.page);
    await a.page.waitForTimeout(500);
  }
  await expect(a.page.locator('.act-hit')).toBeEnabled({ timeout: 15_000 });
  await assertTurnFits(a.page, 'room 360x640');
  await expect(a.page.getByTestId('status')).toContainText('תורך');
  await a.page.screenshot({ path: `${SHOTS}/p0-room-360x640.png` });
  const before = (await a.page.locator('.act-stand').boundingBox())!;
  const cards = await a.page.locator('.my-hands .card').count();
  await a.page.locator('.act-hit').dblclick();
  await expect(a.page.locator('.my-hands .card')).toHaveCount(cards + 1, { timeout: 5000 });
  await a.page.waitForTimeout(1200);
  await expect(a.page.locator('.my-hands .card')).toHaveCount(cards + 1);
  if (await ready(a.page.locator('.act-stand'))) {
    const after = (await a.page.locator('.act-stand').boundingBox())!;
    expect(Math.abs(after.x - before.x) + Math.abs(after.y - before.y)).toBeLessThan(1);
    await a.page.locator('.act-stand').click();
  }
  await expect(a.page.getByTestId('result-panel')).toBeVisible({ timeout: 15_000 });
  await expect(a.page.getByTestId('result-panel')).toContainText('החזר כולל');
  // A reload after the result shows it without celebrating again.
  await a.page.reload();
  await expect(a.page.getByTestId('result-panel').or(a.page.locator('.bet-spot'))).toBeVisible({ timeout: 10_000 });
  expect(await a.page.locator('.felt[class*="celebrate-"]').count()).toBe(0);
  await a.ctx.close();
});

test('rotation in the middle of a deal keeps the same cards and the turn on one screen', async ({ browser }) => {
  const p = await player(browser, 'Rotate', { width: 390, height: 844 });
  await p.page.goto('/#/practice');
  await p.page.locator('.stake-chip').nth(1).click();
  await p.page.getByTestId('deal').click();
  await p.page.waitForTimeout(150);
  await p.page.setViewportSize({ width: 844, height: 390 });
  await expect(p.page.locator('.my-hands .card')).toHaveCount(2);
  await p.page.waitForTimeout(1200);
  if (await p.page.locator('.act-stand').isVisible().catch(() => false)) await assertTurnFits(p.page, 'after rotation');
  await p.page.setViewportSize({ width: 390, height: 844 });
  await expect(p.page.locator('.my-hands .card')).toHaveCount(2);
  await p.ctx.close();
});

test('ten rounds in a row with sound on: sounds stay within the voice budget and nothing throws', async ({ browser }) => {
  const p = await player(browser, 'Sound');
  // Count every scheduled oscillator/buffer start (what the speaker would play) without listening.
  await p.ctx.addInitScript(() => {
    const log: number[] = [];
    (window as any).__sfx = log;
    for (const proto of [OscillatorNode.prototype, AudioBufferSourceNode.prototype]) {
      const start = proto.start;
      proto.start = function (this: AudioScheduledSourceNode, when?: number) {
        log.push(when ?? this.context.currentTime);
        return start.call(this, when as number);
      };
    }
  });
  const errors: string[] = [];
  p.page.on('pageerror', (e) => errors.push(String(e)));
  await p.page.goto('/#/practice');
  let rounds = 0;
  const deadline = Date.now() + 120_000;
  while (rounds < 10 && Date.now() < deadline) {
    if (await p.page.getByTestId('next-round').isVisible().catch(() => false)) {
      rounds++;
      if (rounds < 10) {
        await p.page.getByTestId('next-round').click();
        await expect(p.page.getByTestId('next-round')).toBeHidden();
      }
      continue;
    }
    if (await p.page.getByTestId('deal').isVisible().catch(() => false)) {
      await p.page.locator('.stake-chip').first().click();
      await p.page.getByTestId('deal').click();
    }
    const stand = p.page.locator('.act-stand');
    if (await ready(stand)) await stand.click({ timeout: 1000 }).catch(() => {});
    await p.page.waitForTimeout(200);
  }
  expect(rounds).toBe(10);
  const starts: number[] = await p.page.evaluate(() => (window as any).__sfx);
  expect(starts.length).toBeGreaterThan(40);
  // Sources that start within 50 ms of each other belong to one sound; count distinct sounds per 400 ms window.
  const sounds = starts.sort((x, y) => x - y).filter((t, i, a) => i === 0 || t - a[i - 1] > 0.05);
  let worst = 0;
  for (const t of sounds) worst = Math.max(worst, sounds.filter((u) => u >= t && u < t + 0.4).length);
  expect(worst).toBeLessThanOrEqual(5);
  expect(errors).toEqual([]);
  await p.ctx.close();
});

test('round timings in the browser (DECISIONS 1-2): arc flight 260 ms, 200 ms apart, total after the flip, hole reveal about 770 ms', async ({ browser }) => {
  const p = await player(browser, 'Timing');
  // Log every card animation as it starts: which card, how long, when.
  await p.ctx.addInitScript(() => {
    const log: { id: string; inner: boolean; d: number; t: number }[] = [];
    (window as any).__anims = log;
    const animate = Element.prototype.animate;
    Element.prototype.animate = function (this: Element, k: any, o: any) {
      const card = this.closest('[data-card-id]');
      if (card) log.push({ id: card.getAttribute('data-card-id')!, inner: this !== card, d: typeof o === 'number' ? o : Number(o?.duration), t: performance.now() });
      return animate.call(this, k, o);
    };
  });
  await p.page.goto('/#/practice');
  for (let round = 0; round < 8; round++) {
    await p.page.locator('.stake-chip').first().click();
    await p.page.getByTestId('deal').click();
    // While the opening deal is in the air, the player's total is not shown yet.
    await expect(p.page.locator('.my-hands .card')).toHaveCount(1, { timeout: 2000 });
    expect(await p.page.locator('.my-hands .total').count()).toBe(0);
    await expect(p.page.getByTestId('skip-anim')).toBeVisible();
    await expect.poll(() => p.page.evaluate(() => (window as any).__anims.filter((a: any) => !a.inner).length), { timeout: 5000 }).toBeGreaterThanOrEqual(4);
    const flights = await p.page.evaluate(() => (window as any).__anims.filter((a: any) => !a.inner).slice(0, 4));
    for (const f of flights) expect(f.d).toBe(260);
    // Each card leaves the shoe on the 200 ms beat. A single gap can shift by a frame or a React commit, so the
    // average carries the contract and each gap only has to stay clearly overlapping and clearly sequential.
    const avg = (flights[3].t - flights[0].t) / 3;
    expect(avg).toBeGreaterThanOrEqual(175);
    expect(avg).toBeLessThanOrEqual(240);
    for (let k = 1; k < 4; k++) {
      const gap = flights[k].t - flights[k - 1].t;
      expect(gap).toBeGreaterThanOrEqual(110);
      expect(gap).toBeLessThanOrEqual(300);
    }
    // Stand on the first hand that has a turn; then the dealer lifts, holds and turns the hole card.
    const stand = p.page.locator('.act-stand');
    if (await expect(stand).toBeEnabled({ timeout: 6000 }).then(() => true, () => false)) {
      await p.page.evaluate(() => ((window as any).__anims.length = 0));
      await stand.click();
      await expect.poll(() => p.page.evaluate(() => (window as any).__anims.filter((a: any) => !a.inner && a.d > 600).length), { timeout: 5000 }).toBe(1);
      const reveal = await p.page.evaluate(() => (window as any).__anims.find((a: any) => !a.inner && a.d > 600));
      expect(reveal.d).toBe(770);
      break;
    }
    await p.page.getByTestId('next-round').click({ timeout: 10_000 });
    await p.page.evaluate(() => ((window as any).__anims.length = 0));
  }
  const css = await p.page.evaluate(() => {
    const s = getComputedStyle(document.documentElement);
    const ms = (v: string) => parseFloat(v) * (v.trim().endsWith('ms') ? 1 : 1000);
    return { flip: ms(s.getPropertyValue('--dur-flip')), win: ms(s.getPropertyValue('--dur-win')), bj: ms(s.getPropertyValue('--dur-celebrate')) };
  });
  expect(css.flip).toBeGreaterThanOrEqual(220);
  expect(css.flip).toBeLessThanOrEqual(320);
  expect(css.win).toBeGreaterThanOrEqual(450);
  expect(css.win).toBeLessThanOrEqual(700);
  expect(css.bj).toBeGreaterThanOrEqual(800);
  expect(css.bj).toBeLessThanOrEqual(1100);
  await p.ctx.close();
});
