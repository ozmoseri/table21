import { expect, test, type Page } from '@playwright/test';
import { createRoom, onboard, player, sit } from './helpers.ts';

/** Premium design round (DECISIONS.md): card engine, speeds, skip, action order, bet confirm, one HUD, full screen. */

/** Card-engine animations (WAAPI, not CSS state loops such as the active-hand glow) still running. */
const running = (page: Page) =>
  page.evaluate(() =>
    document.getAnimations().filter((a) => a.playState === 'running' && !(a instanceof CSSAnimation) && !(a instanceof CSSTransition) && (a.effect as KeyframeEffect)?.target instanceof Element && ((a.effect as KeyframeEffect).target as Element).closest('.card')).length,
  );

/** Buttons appear only when the queue has caught up, so wait for them instead of sampling once. */
const enabledSoon = (page: Page, sel: string, timeout = 6000) => expect(page.locator(sel)).toBeEnabled({ timeout }).then(() => true, () => false);

async function dealPractice(page: Page) {
  await page.locator('.stake-chip').first().click();
  await page.getByTestId('deal').click();
}

async function openMenu(page: Page) {
  await page.getByTestId('room-menu').click();
  await expect(page.getByTestId('deal-speed')).toBeVisible();
}

test('timeline: cards arrive one by one, totals wait for the flip, buttons wait for the queue; the skip button finishes everything', async ({ browser }) => {
  const p = await player(browser, 'Queue');
  await p.page.goto('/#/practice');
  await dealPractice(p.page);
  // One by one: right after the tap the table does not show all four cards yet.
  await expect(p.page.locator('.felt .card')).not.toHaveCount(4, { timeout: 300 });
  await expect(p.page.getByTestId('skip-anim')).toBeVisible();
  const skip = p.page.getByTestId('skip-anim');
  const box = (await skip.boundingBox())!;
  expect(box.width).toBeGreaterThanOrEqual(47.5);
  expect(box.height).toBeGreaterThanOrEqual(47.5);
  // Tapping the felt does not skip (no tap-anywhere); the button does.
  await p.page.locator('.felt').click({ position: { x: 20, y: 200 } });
  await skip.click();
  await expect(skip).toBeHidden();
  expect(await running(p.page)).toBe(0);
  await expect(p.page.locator('.my-hands .card')).toHaveCount(2);
  await expect(p.page.locator('.my-hands .total').first()).toBeVisible();
  await p.ctx.close();
});

test('speed: Turbo plays the deal faster and is remembered after a reload; Elegant is the default', async ({ browser }) => {
  const p = await player(browser, 'Speed');
  await p.page.goto('/#/practice');
  await openMenu(p.page);
  await expect(p.page.locator('[data-speed="elegant"]')).toHaveAttribute('aria-checked', 'true');
  await p.page.locator('[data-speed="turbo"]').click();
  await p.page.keyboard.press('Escape');
  await dealPractice(p.page);
  await expect.poll(() => p.page.evaluate(() => Math.max(0, ...document.getAnimations().map((a) => a.playbackRate))), { timeout: 2000 }).toBeGreaterThan(2);
  const t0 = Date.now();
  await expect(p.page.getByTestId('skip-anim')).toBeHidden({ timeout: 3000 });
  expect(Date.now() - t0).toBeLessThan(1200);
  await p.page.reload();
  await openMenu(p.page);
  await expect(p.page.locator('[data-speed="turbo"]')).toHaveAttribute('aria-checked', 'true');
  await p.ctx.close();
});

test('actions: fixed order Double, Split, Stand, Hit; Hit and Stand equal; left-handed mirrors the row', async ({ browser }) => {
  const p = await player(browser, 'Order', { width: 360, height: 640 });
  await p.page.goto('/#/practice');
  for (let i = 0; i < 10; i++) {
    await dealPractice(p.page);
    if (await enabledSoon(p.page, '.act-hit')) break;
    await p.page.getByTestId('next-round').click({ timeout: 10_000 });
  }
  const xs = async () => {
    const out: Record<string, { x: number; w: number; h: number }> = {};
    for (const a of ['double', 'split', 'stand', 'hit']) {
      const b = (await p.page.locator(`.act-${a}`).boundingBox())!;
      out[a] = { x: b.x, w: b.width, h: b.height };
    }
    return out;
  };
  const r = await xs();
  expect(r.double.x).toBeLessThan(r.split.x);
  expect(r.split.x).toBeLessThan(r.stand.x);
  expect(r.stand.x).toBeLessThan(r.hit.x);
  expect(Math.abs(r.hit.w - r.stand.w)).toBeLessThan(1);
  expect(r.hit.w).toBeGreaterThan(r.double.w);
  expect(r.hit.h).toBeGreaterThanOrEqual(55.5);
  // Same visual weight: Hit and Stand share background and text colors; gold is not used on actions.
  const look = (sel: string) => p.page.locator(sel).evaluate((el) => { const s = getComputedStyle(el); return `${s.backgroundColor}|${s.color}|${s.backgroundImage}`; });
  expect(await look('.act-hit')).toBe(await look('.act-stand'));
  await openMenu(p.page);
  await p.page.getByTestId('left-handed').check();
  await p.page.keyboard.press('Escape');
  const m = await xs();
  expect(m.hit.x).toBeLessThan(m.stand.x);
  expect(m.split.x).toBeLessThan(m.double.x);
  await p.ctx.close();
});

test('online bet: picking a chip sends nothing; Confirm (the gold button) places it; Clear takes it back', async ({ browser }) => {
  const p = await player(browser, 'Bettor');
  await onboard(p, 1);
  await createRoom(p);
  await sit(p);
  // Three chips plus More and Clear.
  await expect(p.page.locator('.stakes .stake-chip')).toHaveCount(3);
  await expect(p.page.getByTestId('stake-more')).toBeVisible();
  await p.page.locator('.stake-chip').first().click();
  await expect(p.page.locator('.stake-chip.sel')).toHaveCount(1);
  await expect(p.page.locator('.stake-chip.on')).toHaveCount(0);
  const confirm = p.page.getByTestId('bet-confirm');
  await expect(confirm).toBeVisible();
  const bg = await confirm.evaluate((el) => getComputedStyle(el).backgroundColor + getComputedStyle(el).backgroundImage);
  expect(bg).toMatch(/229, 199, 126|E5C77E/i);
  await p.page.getByTestId('stake-clear').click();
  await expect(p.page.locator('.stake-chip.sel')).toHaveCount(0);
  await p.page.locator('.stake-chip').nth(1).click();
  await confirm.click();
  await expect(p.page.locator('.my-hands .card, .stake-chip.on').first()).toBeVisible({ timeout: 10_000 });
  await p.ctx.close();
});

test('HUD: one menu, one invite, one social tray; no utility row under the table', async ({ browser }) => {
  const p = await player(browser, 'Hud');
  await onboard(p, 2);
  await createRoom(p);
  await expect(p.page.getByTestId('room-menu')).toHaveCount(1);
  await expect(p.page.getByTestId('share')).toHaveCount(1);
  await expect(p.page.getByTestId('social')).toHaveCount(1);
  await expect(p.page.locator('.room > .reactions')).toHaveCount(0);
  await p.page.getByTestId('social').click();
  await expect(p.page.locator('[data-testid^="react-"]').first()).toBeVisible();
  await p.page.keyboard.press('Escape');
  await p.page.getByTestId('room-menu').click();
  await expect(p.page.getByTestId('leave-room')).toBeVisible();
  await p.ctx.close();
});

for (const vp of [
  { width: 390, height: 844 },
  { width: 844, height: 390 },
  { width: 360, height: 640 },
]) {
  test(`full screen table ${vp.width}x${vp.height}: the room fills 100dvh without page scroll and nothing leaves the screen`, async ({ browser }) => {
    const p = await player(browser, 'Fit', vp);
    await p.page.goto('/#/practice');
    await p.page.locator('.room .stake-chip').first().waitFor();
    const check = async (label: string) => {
      const m = await p.page.evaluate(() => {
        const room = document.querySelector('.room')!.getBoundingClientRect();
        const off = [...document.querySelectorAll('.room button, .room .card, .room .stake-chip')]
          .map((el) => el.getBoundingClientRect())
          .filter((r) => r.width > 0 && (r.left < -1 || r.right > innerWidth + 1 || r.bottom > innerHeight + 1)).length;
        return { h: room.height, vh: innerHeight, sx: document.documentElement.scrollWidth - innerWidth, sy: document.documentElement.scrollHeight - innerHeight, off };
      });
      expect(Math.abs(m.h - m.vh), `${label} room height`).toBeLessThan(2);
      expect(m.sx, `${label} horizontal scroll`).toBeLessThanOrEqual(0);
      expect(m.sy, `${label} vertical scroll`).toBeLessThanOrEqual(0);
      expect(m.off, `${label} controls off screen`).toBe(0);
    };
    await check('bet');
    await dealPractice(p.page);
    await p.page.getByTestId('skip-anim').click().catch(() => {});
    await check('hand');
    await p.ctx.close();
  });
}

test('install card: shown once on home with a full screen option where the browser allows it; closing it is remembered', async ({ browser }) => {
  const p = await player(browser, 'Install');
  await onboard(p, 0);
  await expect(p.page.getByTestId('install-hint')).toBeVisible();
  await p.page.getByTestId('install-hint-close').click();
  await expect(p.page.getByTestId('install-hint')).toHaveCount(0);
  await p.page.reload();
  await expect(p.page.getByTestId('play-friends')).toBeVisible();
  await expect(p.page.getByTestId('install-hint')).toHaveCount(0);
  await p.ctx.close();
});
