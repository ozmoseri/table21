// Same-state screenshots of the core journey, for before/after comparison.
// Usage: node scripts/journey-shots.mjs <baseUrl> <outDir>
// States: unreachable server, lobby, join with a wrong code, bet, my turn, result. Sizes: 360x640, 390x844, 844x390.
import { mkdirSync } from 'node:fs';
import { chromium } from '@playwright/test';
const [base = 'http://127.0.0.1:3131', out = 'docs/screenshots/journey/after'] = process.argv.slice(2);
mkdirSync(out, { recursive: true });
const browser = await chromium.launch();
const sizes = [{ width: 360, height: 640 }, { width: 390, height: 844 }, { width: 844, height: 390 }];
const shot = (page, tag, name) => page.screenshot({ path: `${out}/${tag}-${name}.jpg`, type: 'jpeg', quality: 80 });
for (const vp of sizes) {
  const tag = `${vp.width}x${vp.height}`;
  const ctx = await browser.newContext({ viewport: vp, isMobile: true, hasTouch: true, deviceScaleFactor: 2, locale: 'he-IL' });
  await ctx.addInitScript(() => localStorage.setItem('t21:age-ok', '1'));
  const page = await ctx.newPage();
  // a device that has seen this LAN host before, then the host stops answering
  await page.goto(base + '/');
  await page.getByPlaceholder('שם תצוגה').fill('עוז הבודק עם שם ארוך');
  await page.locator('.avatar-pick').nth(1).click();
  await page.getByRole('button', { name: 'שמירה וכניסה' }).click();
  await page.getByTestId('play-friends').waitFor();
  await page.waitForTimeout(600);
  await shot(page, tag, '2-lobby');
  // join with a wrong code
  const join = page.getByTestId('join-code');
  await join.click();
  const input = page.locator('input[inputmode], input[name*=code], input[placeholder]').filter({ hasNot: page.locator('[type=checkbox]') }).last();
  await input.fill('ZZZZ').catch(() => {});
  await page.keyboard.press('Enter').catch(() => {});
  await page.waitForTimeout(900);
  await shot(page, tag, '3-join-wrong-code');
  // room: create, sit, bet, deal until my turn, result
  await page.goto(base + '/#/home');
  await page.getByTestId('play-friends').click();
  await page.getByTestId('create-room').click();
  await page.getByTestId('room').waitFor();
  await page.getByTestId('sit').click();
  await page.locator('.stake-chip').first().waitFor();
  await page.locator('.stake-chip').first().click();
  await page.waitForTimeout(400);
  await shot(page, tag, '4-bet');
  let turn = false;
  for (let i = 0; i < 8 && !turn; i++) {
    if (i > 0) {
      await page.waitForFunction(() => /waiting|betting/.test(document.querySelector('[data-testid=room]')?.getAttribute('data-phase') ?? ''), null, { timeout: 30_000 });
      await page.locator('.stake-chip').first().click();
    }
    await page.getByTestId('bet-confirm').click();
    const deal = page.getByTestId('deal');
    if (await deal.isEnabled({ timeout: 2500 }).catch(() => false)) await deal.click().catch(() => {});
    turn = await page.locator('.act-stand:not([disabled])').waitFor({ timeout: 15_000 }).then(() => true, () => false);
  }
  await page.waitForTimeout(900);
  await shot(page, tag, '5-my-turn');
  if (turn) await page.locator('.act-stand').click();
  await page.getByTestId('result-panel').waitFor({ timeout: 20_000 }).catch(() => {});
  await page.waitForTimeout(1200);
  await shot(page, tag, '6-result');
  // the host stops answering. Service workers are blocked here: Playwright routes do not see requests a service
  // worker makes, so with one active the page would still reach the server.
  const off = await browser.newContext({ viewport: vp, isMobile: true, hasTouch: true, deviceScaleFactor: 2, locale: 'he-IL', serviceWorkers: 'block' });
  await off.addInitScript(() => localStorage.setItem('t21:age-ok', '1'));
  const op = await off.newPage();
  await op.goto(base + '/');
  await op.waitForTimeout(1500); // the app learns this host's deployment from /api/config
  await op.route('**/api/**', (r) => r.abort('failed'));
  await op.route('**/socket.io/**', (r) => r.abort('failed'));
  await op.reload();
  await op.waitForTimeout(6000);
  await shot(op, tag, '1-host-unreachable');
  await off.close();
  await ctx.close();
}
await browser.close();
