// Dev helper: screenshots of key screens in portrait and landscape phone sizes against a running server.
// Usage: node scripts/shots.mjs <baseUrl> <outDir> <label>
import { chromium } from '@playwright/test';
const [base = 'http://127.0.0.1:3131', out = 'shots', label = 'now'] = process.argv.slice(2);
const sizes = [
  { name: 'small', viewport: { width: 360, height: 640 } },
  { name: 'portrait', viewport: { width: 390, height: 844 } },
  { name: 'landscape', viewport: { width: 844, height: 390 } },
];
const browser = await chromium.launch();
for (const s of sizes) {
  const ctx = await browser.newContext({ viewport: s.viewport, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
  const page = await ctx.newPage();
  const shot = async (n) => page.screenshot({ path: `${out}/${label}-${s.name}-${n}.png` });
  await page.goto(base + '/');
  await page.getByPlaceholder('שם תצוגה').fill('עוז מוסרי');
  await page.locator('.avatar-pick').first().click();
  await page.getByRole('button', { name: 'שמירה וכניסה' }).click();
  await page.getByTestId('play-friends').waitFor();
  await page.waitForTimeout(300);
  await shot('home');
  await page.goto(base + '/#/profile'); await page.waitForTimeout(500); await shot('profile');
  await page.goto(base + '/#/club'); await page.waitForTimeout(400); await shot('club');
  await page.goto(base + '/#/practice'); await page.waitForTimeout(400); await shot('practice-bet');
  await page.locator('.stake-chip').nth(2).click();
  await page.getByTestId('deal').click();
  await page.waitForTimeout(1600); await shot('practice-turn');
  for (const k of ['three', 'six', 'split21']) { await page.goto(`${base}/#/lab/${k}`); await page.waitForTimeout(500); await shot(`lab-${k}`); }
  await ctx.close();
}
await browser.close();
