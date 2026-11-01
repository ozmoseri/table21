// Art-director review set (F1-F5) and stage 4-6 shots, run before and after a change for side-by-side review.
// Usage: node scripts/premium2-shots.mjs <baseUrl> <outDir>
// Shots (portrait 390x844 and landscape 844x390):
//   home-*            F4 lobby above the fold
//   table2-*          F1 felt and HUD, F2 two-player composition and turn ring, F3 card back and felt print
//   practice-turn-*   F2 my card size (landscape target about 76x108 CSS px)
//   celebrate-*       F5 the result banner caught mid-celebration on a winning hand (net > 0)
//   results-*         F5 the settled result panel
import { mkdirSync } from 'node:fs';
import { chromium } from '@playwright/test';

const [base = 'http://127.0.0.1:3131', out = 'docs/screenshots/premium2/after'] = process.argv.slice(2);
mkdirSync(out, { recursive: true });
const browser = await chromium.launch();
const files = [];
const shot = async (page, file, opts = {}) => {
  await page.screenshot({ path: `${out}/${file}`, ...opts });
  files.push(`${out}/${file}`);
};
const mk = async (viewport) => {
  const ctx = await browser.newContext({ viewport, isMobile: true, hasTouch: true, deviceScaleFactor: 2, locale: 'he-IL' });
  // Adults-only confirmation and the one-time cards are answered the way a returning player has them.
  await ctx.addInitScript(() => {
    try {
      localStorage.setItem('t21:age-ok', '1');
    } catch {}
  });
  return { ctx, page: await ctx.newPage() };
};
const enabled = (page, sel, timeout = 10_000) => page.locator(`${sel}:not([disabled])`).waitFor({ timeout }).then(() => true, () => false);
async function onboard(page, name, avatar) {
  await page.goto(base + '/');
  const age = page.getByTestId('age-confirm');
  if (await age.isVisible({ timeout: 1500 }).catch(() => false)) await age.click();
  await page.getByPlaceholder('שם תצוגה').fill(name);
  await page.locator('.avatar-pick').nth(avatar).click();
  await page.getByRole('button', { name: 'שמירה וכניסה' }).click();
  await page.getByTestId('play-friends').waitFor();
}
async function pick(page, coins) {
  await page.locator('.stake-chip').first().waitFor({ timeout: 20_000 });
  const chip = page.locator('.stake-chip', { hasText: new RegExp(`^${coins}$`) });
  if (!(await chip.isVisible().catch(() => false))) await page.getByTestId('stake-more').click();
  await chip.click();
}
const skip = (page) => page.getByTestId('skip-anim').click({ timeout: 500 }).catch(() => {});

for (const s of [
  { name: 'portrait-390x844', viewport: { width: 390, height: 844 } },
  { name: 'landscape-844x390', viewport: { width: 844, height: 390 } },
]) {
  const host = await mk(s.viewport);
  const friend = await mk({ width: 390, height: 844 });
  await onboard(host.page, 'עוז', 0);
  await onboard(friend.page, 'דניאל', 1);
  await host.page.waitForTimeout(600);
  await shot(host.page, `home-${s.name}.png`);

  await host.page.getByTestId('play-friends').click();
  await host.page.getByTestId('create-room').click();
  await host.page.getByTestId('room').waitFor();
  const code = host.page.url().split('#/r/')[1];
  await friend.page.goto(`${base}/#/r/${code}`);
  await friend.page.getByTestId('room').waitFor();
  for (const p of [host.page, friend.page]) await p.getByTestId('sit').click();
  for (let i = 0; ; i++) {
    await pick(friend.page, 25);
    await friend.page.getByTestId('bet-confirm').click();
    await pick(host.page, 50);
    await host.page.getByTestId('bet-confirm').click();
    const fturn = await enabled(friend.page, '.act-stand', 12_000);
    if (fturn) await friend.page.locator('.act-stand').click();
    if (await enabled(host.page, '.act-stand', 12_000)) break;
    if (i > 6) throw new Error('no playable hand after 7 deals');
    await host.page.waitForFunction(() => /waiting|betting/.test(document.querySelector('[data-testid=room]')?.getAttribute('data-phase') ?? ''), null, { timeout: 30_000 });
  }
  await host.page.waitForTimeout(500);
  await shot(host.page, `table2-${s.name}.png`);
  await host.ctx.close();
  await friend.ctx.close();

  // Practice: my card size, then play until a winning hand to catch the celebration banner.
  const solo = await mk(s.viewport);
  // Review shots only (lab build): the banner runs 4x longer (Table.tsx reviewSlow), with the same keyframes, so a 2x screenshot can land
  // inside its hold. Timings are tested at real speed in tests/e2e/premium2.spec.ts.
  await solo.ctx.addInitScript(() => sessionStorage.setItem('t21:fx-slow', '4'));
  await solo.page.goto(base + '/#/practice');
  const age = solo.page.getByTestId('age-confirm');
  if (await age.isVisible({ timeout: 1500 }).catch(() => false)) await age.click();
  let turnShot = false;
  let won = false;
  for (let i = 0; i < 40 && !won; i++) {
    await pick(solo.page, 25);
    // Watch for the banner from the moment the hand starts (it lives 500 ms, 900 ms for a natural).
    // The picture is taken by the watcher itself, inside the hold (22% to 78% of the banner's life).
    const banner = solo.page
      .waitForFunction(() => document.querySelector('[data-testid=celebration]'), null, { polling: 'raf', timeout: 20_000 })
      .then(async () => {
        await solo.page.waitForTimeout(800); // 40% of the slowed 2 s banner: fully shown
        await solo.page.screenshot({ path: `${out}/celebrate-${s.name}.png` });
        return true;
      }, () => false);
    await solo.page.getByTestId('deal').click();
    if (await enabled(solo.page, '.act-stand', 6000)) {
      if (!turnShot) {
        await solo.page.waitForTimeout(300);
        await shot(solo.page, `practice-turn-${s.name}.png`);
        turnShot = true;
      }
      await solo.page.locator('.act-stand').click();
    }
    await solo.page.getByTestId('result-panel').waitFor({ timeout: 15_000 });
    const net = Number((await solo.page.getByTestId('result-panel').getAttribute('data-net')) ?? 0);
    if (net > 0) {
      if (!(await banner)) throw new Error('winning hand without a banner');
      files.push(`${out}/celebrate-${s.name}.png`);
      await solo.page.waitForTimeout(4000);
      await shot(solo.page, `results-${s.name}.png`);
      won = true;
      break;
    }
    await solo.page.getByTestId('next-round').click();
  }
  await solo.ctx.close();
}
await browser.close();
console.log(files.join('\n'));
