import { expect, test, type Page } from '@playwright/test';
import { SHOTS, onboard, player } from './helpers.ts';

async function finishLocalRound(page: Page) {
  const end = Date.now() + 30_000;
  while (Date.now() < end) {
    if (await page.getByTestId('next-round').isVisible().catch(() => false)) return;
    const hand = page.getByTestId('handoff').getByRole('button');
    if (await hand.isVisible().catch(() => false)) await hand.click();
    const stand = page.locator('.act-stand');
    if ((await stand.isVisible().catch(() => false)) && (await stand.isEnabled({ timeout: 500 }).catch(() => false))) await stand.click({ timeout: 1000 }).catch(() => {});
    await page.waitForTimeout(150);
  }
  throw new Error('local round did not finish');
}

test('installed app: solo and pass-and-play work with the network off, no external requests', async ({ browser }) => {
  const p = await player(browser, 'Offline');
  const external: string[] = [];
  p.page.on('request', (r) => {
    if (!r.url().startsWith('http://127.0.0.1:3121') && !r.url().startsWith('data:') && !r.url().startsWith('blob:')) external.push(r.url());
  });
  await onboard(p, 1);
  // Built app + activated service worker (secure context: localhost).
  const ready = await p.page.evaluate(async () => {
    const reg = await navigator.serviceWorker.ready;
    return !!reg.active;
  });
  expect(ready).toBe(true);
  await p.page.reload();
  await p.page.waitForFunction(() => !!navigator.serviceWorker.controller);

  await p.ctx.setOffline(true);
  await p.page.goto('/#/practice');
  await expect(p.page.getByTestId('local-game')).toBeVisible();
  await p.page.locator('.stake-chip').nth(2).click();
  await p.page.getByTestId('deal').click();
  await finishLocalRound(p.page);
  await p.page.screenshot({ path: `${SHOTS}/offline-practice-result.png` });

  await p.page.goto('/#/pass');
  await p.page.getByTestId('pp-name-0').fill('נועם');
  await p.page.getByTestId('pp-name-1').fill('Lior');
  await p.page.getByTestId('pp-start').click();
  await p.page.locator('.bet-row').nth(0).locator('.stake-chip').nth(1).click();
  await p.page.locator('.bet-row').nth(1).locator('.stake-chip').nth(0).click();
  await p.page.getByTestId('deal').click();
  // Unless the first player has a natural, the handoff screen guards turn ownership.
  const handoff = p.page.getByTestId('handoff');
  if (await handoff.isVisible({ timeout: 3000 }).catch(() => false)) {
    await expect(handoff).toContainText('העבר את הטלפון ל');
    await p.page.screenshot({ path: `${SHOTS}/pass-and-play-handoff.png` });
  }
  await finishLocalRound(p.page);
  await p.ctx.setOffline(false);
  expect(external).toEqual([]);
  await p.ctx.close();
});

const VIEWPORTS = [
  { name: 'small-phone', width: 360, height: 640 },
  { name: 'large-phone', width: 430, height: 932 },
  { name: 'tablet', width: 820, height: 1180 },
  { name: 'desktop', width: 1280, height: 800 },
  { name: 'phone-landscape', width: 844, height: 390 },
];

test('layouts: no horizontal overflow across phones, tablet, desktop, landscape, Hebrew and English, long names', async ({ browser }) => {
  const p = await player(browser, 'שם ארוך מאוד לבדיקה1');
  await onboard(p, 7);
  const overflow = () => p.page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  for (const lang of ['he', 'en'] as const) {
    if (lang === 'en') {
      await p.page.goto('/#/settings');
      await p.page.getByRole('button', { name: 'English' }).click();
      await expect(p.page.locator('html')).toHaveAttribute('dir', 'ltr');
    }
    for (const v of VIEWPORTS) {
      await p.page.setViewportSize({ width: v.width, height: v.height });
      for (const route of ['home', 'profile', 'leaderboard', 'settings', 'friends']) {
        await p.page.goto(`/#/${route}`);
        await p.page.waitForTimeout(250);
        expect(await overflow(), `${lang} ${v.name} ${route}`).toBeLessThanOrEqual(1);
      }
      await p.page.goto('/#/practice');
      await p.page.locator('.stake-chip').first().click();
      await p.page.getByTestId('deal').click();
      await p.page.waitForTimeout(1200);
      expect(await overflow(), `${lang} ${v.name} table`).toBeLessThanOrEqual(1);
      // Action targets stay at least 48px tall.
      const act = p.page.locator('.act').first();
      if (await act.isVisible().catch(() => false)) expect((await act.boundingBox())!.height).toBeGreaterThanOrEqual(48);
      if (lang === 'he') await p.page.screenshot({ path: `${SHOTS}/table-${v.name}.png` });
    }
  }
  await p.ctx.close();
});

test('reduced motion and keyboard access', async ({ browser }) => {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, reducedMotion: 'reduce' });
  const page = await ctx.newPage();
  await page.goto('/#/practice');
  await expect(page.locator('html')).toHaveAttribute('data-motion', 'reduced');
  await page.locator('.stake-chip').first().focus();
  await page.keyboard.press('Enter');
  await page.getByTestId('deal').focus();
  await page.keyboard.press('Enter');
  const stand = page.locator('.act-stand');
  if (await stand.isVisible({ timeout: 3000 }).catch(() => false)) {
    await page.keyboard.press('s'); // keyboard shortcut: stand
  }
  await expect(page.getByTestId('next-round')).toBeVisible({ timeout: 15_000 });
  await ctx.close();
});
