import { expect, test, type Page } from '@playwright/test';
import { SHOTS, createRoom, joinRoom, onboard, pickAndConfirm, player, sit } from './helpers.ts';

const runningCardAnimations = (page: Page) =>
  page.evaluate(() => [...document.querySelectorAll('.card')].reduce((n, el) => n + el.getAnimations().filter((a) => a.playState === 'running').length, 0));

test('gifts and reactions between friends: delivered once, rate limited, muteable, kept on reload without replay', async ({ browser }) => {
  const a = await player(browser, 'עוז');
  const b = await player(browser, 'Noa');
  await onboard(a, 0);
  await onboard(b, 3);
  const code = await createRoom(a);
  await joinRoom(b, code);
  await sit(a);
  await sit(b);

  // a taps b's seat and sends a coffee.
  await a.page.locator('.others .seat').first().click();
  await expect(a.page.getByTestId('seat-tray')).toBeVisible();
  await a.page.getByTestId('gift-coffee').click();
  await expect(b.page.locator('.gift-anchor .gift-badge')).toHaveCount(1, { timeout: 5000 });
  await expect(a.page.locator('.others .seat .gift-badge')).toHaveCount(1);
  await a.page.screenshot({ path: `${SHOTS}/after-gift-sent.png` });

  // A second gift right away is rate limited (server side), with a clear message.
  await a.page.locator('.others .seat').first().click();
  await a.page.getByTestId('gift-rose').click();
  await expect(a.page.locator('.toast')).toContainText('לאט לאט');
  await a.page.keyboard.press('Escape');

  // Reaction bubble appears at the sender's seat for the other player.
  // Reactions live in the one social tray (HUD), not in a row under the table.
  await b.page.getByTestId('social').click();
  await b.page.getByTestId('react-card').click();
  await expect(a.page.locator('.others .seat .react-bubble')).toContainText('איזה קלף!');
  await a.page.screenshot({ path: `${SHOTS}/after-reaction.png` });

  // Per-person mute hides b's next reaction for a only.
  await a.page.locator('.others .seat').first().click();
  await a.page.getByRole('button', { name: /השתקת מתנות ותגובות/ }).click();
  await a.page.keyboard.press('Escape');
  await b.page.waitForTimeout(2700);
  await b.page.getByTestId('social').click();
  await b.page.getByTestId('react-wow').click();
  await expect(b.page.locator('.me-zone .react-bubble')).toContainText('וואו');
  await a.page.waitForTimeout(600);
  await expect(a.page.locator('.others .seat .react-bubble')).toHaveCount(0);

  // Reload: the unexpired gift is still shown at b's seat, without flying again.
  await b.page.reload();
  await expect(b.page.locator('.gift-anchor .gift-badge')).toHaveCount(1, { timeout: 8000 });
  await expect(b.page.locator('.gift-flight')).toHaveCount(0);
  await a.ctx.close();
  await b.ctx.close();
});

test('presentation: every new local session animates its deal; reload hydrates without replay; reduced motion stops motion live', async ({ browser }) => {
  const p = await player(browser, 'Motion');
  await p.page.goto('/#/practice');
  await p.page.locator('.stake-chip').first().click();
  await p.page.getByTestId('deal').click();
  await expect.poll(() => runningCardAnimations(p.page), { timeout: 2000 }).toBeGreaterThan(0);

  // A new local session (pass-and-play) must not inherit "seen" cards from the previous one.
  await p.page.goto('/#/pass');
  await p.page.getByTestId('pp-name-0').fill('א');
  await p.page.getByTestId('pp-name-1').fill('ב');
  await p.page.getByTestId('pp-start').click();
  await p.page.locator('.bet-row').nth(0).locator('.stake-chip').first().click();
  await p.page.locator('.bet-row').nth(1).locator('.stake-chip').first().click();
  await p.page.getByTestId('deal').click();
  await expect.poll(() => runningCardAnimations(p.page), { timeout: 2000 }).toBeGreaterThan(0);

  // Switching the OS to reduced motion mid-game finishes motion immediately.
  await p.page.goto('/#/practice');
  await p.page.locator('.stake-chip').first().click();
  await p.page.getByTestId('deal').click();
  await p.page.emulateMedia({ reducedMotion: 'reduce' });
  await expect(p.page.locator('html')).toHaveAttribute('data-motion', 'reduced');
  await expect.poll(() => runningCardAnimations(p.page), { timeout: 1500 }).toBe(0);
  await p.page.emulateMedia({ reducedMotion: 'no-preference' });
  await p.ctx.close();
});

test('online reload mid-round hydrates the table without replaying the deal', async ({ browser }) => {
  const a = await player(browser, 'Host');
  await onboard(a, 1);
  await createRoom(a);
  await sit(a);
  await pickAndConfirm(a.page);
  await expect(a.page.locator('.my-hands .card')).toHaveCount(2, { timeout: 10_000 });
  await a.page.reload();
  await expect(a.page.locator('.my-hands .card, .result-panel')).not.toHaveCount(0, { timeout: 10_000 });
  expect(await runningCardAnimations(a.page)).toBe(0);
  await a.ctx.close();
});

const WIDTHS = [320, 360, 390, 430];

test('lab layouts: 1, 3 and 6 players, four split hands and results fit 320 to 430 px and landscape', async ({ browser }) => {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
  const page = await ctx.newPage();
  const overflow = () => page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  for (const kind of ['solo', 'three', 'six', 'split', 'result']) {
    for (const w of WIDTHS) {
      await page.setViewportSize({ width: w, height: 800 });
      await page.goto(`/#/lab/${kind}`);
      await expect(page.getByTestId(`lab-${kind}`)).toBeVisible();
      expect(await overflow(), `${kind} @${w}`).toBeLessThanOrEqual(1);
      for (const b of await page.locator('.act').all()) expect((await b.boundingBox())!.height).toBeGreaterThanOrEqual(48);
      for (const b of await page.locator('.hand-chip').all()) expect((await b.boundingBox())!.height).toBeGreaterThanOrEqual(44);
      if (w === 390) await page.screenshot({ path: `${SHOTS}/after-lab-${kind}.png` });
    }
    // Larger text (125%) still fits at 360 px.
    await page.setViewportSize({ width: 360, height: 800 });
    await page.goto(`/#/lab/${kind}`);
    await page.addStyleTag({ content: 'html { font-size: 125% !important; } body { font-size: 20px !important; }' });
    expect(await overflow(), `${kind} text 125%`).toBeLessThanOrEqual(1);
  }
  await page.setViewportSize({ width: 844, height: 390 });
  await page.goto('/#/lab/six');
  expect(await overflow()).toBeLessThanOrEqual(1);
  await page.screenshot({ path: `${SHOTS}/after-lab-six-landscape.png` });
  await ctx.close();
});
