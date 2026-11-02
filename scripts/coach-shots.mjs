// Coach screenshots: practice turn with the tip strip, the revealed tip, the "why" sheet, the verdict, guide, settings.
// Usage: node scripts/coach-shots.mjs <baseUrl> <outDir>
import { mkdirSync } from 'node:fs';
import { chromium } from '@playwright/test';
const [base = 'http://127.0.0.1:3131', out = 'docs/screenshots/coach'] = process.argv.slice(2);
mkdirSync(out, { recursive: true });
const browser = await chromium.launch();
for (const vp of [{ width: 390, height: 844 }, { width: 360, height: 640 }, { width: 844, height: 390 }]) {
  const tag = `${vp.width}x${vp.height}`;
  const ctx = await browser.newContext({ viewport: vp, isMobile: true, hasTouch: true, deviceScaleFactor: 2, locale: 'he-IL' });
  await ctx.addInitScript(() => localStorage.setItem('t21:age-ok', '1'));
  const page = await ctx.newPage();
  await page.goto(base + '/#/practice');
  await page.locator('.stake-chip').first().waitFor();
  for (let i = 0; i < 15; i++) {
    await page.locator('.stake-chip').first().click();
    await page.getByTestId('deal').click();
    if (await page.getByTestId('coach-bar').waitFor({ timeout: 5000 }).then(() => true, () => false)) break;
    await page.getByTestId('next-round').click({ timeout: 10_000 });
  }
  await page.waitForTimeout(900);
  await page.screenshot({ path: `${out}/${tag}-1-turn.png` });
  await page.getByTestId('coach-tip').click();
  await page.waitForTimeout(300);
  await page.screenshot({ path: `${out}/${tag}-2-tip.png` });
  await page.getByTestId('coach-tip').click();
  await page.getByTestId('coach-sheet').waitFor();
  await page.waitForTimeout(350);
  await page.screenshot({ path: `${out}/${tag}-3-why.png` });
  await page.getByRole('button', { name: 'סגירה' }).click();
  await page.locator('.act[data-coach-pick]').click();
  await page.waitForTimeout(450);
  await page.screenshot({ path: `${out}/${tag}-4-verdict.png` });
  if (vp.width === 390) {
    await page.goto(base + '/#/guide');
    await page.getByTestId('guide-hard').waitFor();
    await page.screenshot({ path: `${out}/${tag}-5-guide.png`, fullPage: true });
    await page.goto(base + '/#/settings');
    await page.getByTestId('coach-settings').scrollIntoViewIfNeeded();
    await page.screenshot({ path: `${out}/${tag}-6-settings.png` });
  }
  await ctx.close();
}
await browser.close();
