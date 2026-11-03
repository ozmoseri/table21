import { expect, test } from '@playwright/test';

/** QA T08 B1: with every /art/** file failing, card backs still read as backs and avatars show a drawn fallback. */
test('all art blocked: card backs keep a CSS pattern, avatars fall back to an inline figure, the hand still plays', async ({ browser }) => {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, serviceWorkers: 'block' });
  const page = await ctx.newPage();
  await page.route('**/art/**', (r) => r.abort('failed'));
  await page.goto('/#/practice');
  await page.locator('.stake-chip').first().click();
  await page.getByTestId('deal').click();
  const back = page.locator('.dealer-cards .card-back').first();
  await expect(back).toBeAttached({ timeout: 8000 });
  expect(await back.evaluate((e) => getComputedStyle(e).backgroundImage)).toContain('repeating-linear-gradient');
  // every avatar on screen ends on the inline fallback, none on a broken image
  await expect
    .poll(() => page.evaluate(() => [...document.querySelectorAll<HTMLImageElement>('img.avatar')].every((i) => i.src.startsWith('data:image/svg+xml') && i.naturalWidth > 0)), { timeout: 8000 })
    .toBe(true);
  const stand = page.locator('.act-stand');
  if (await expect(stand).toBeEnabled({ timeout: 6000 }).then(() => true, () => false)) await stand.click();
  await expect(page.getByTestId('result-panel')).toBeVisible({ timeout: 15_000 });
  await ctx.close();
});

/** QA T08 B2: the lobby header chip keeps its gutter with a long name at 360 wide. */
test('lobby header: a 20-character name stays inside the screen at 360x640', async ({ browser }) => {
  const ctx = await browser.newContext({ viewport: { width: 360, height: 640 }, isMobile: true, hasTouch: true });
  const page = await ctx.newPage();
  await page.goto('/');
  await page.getByPlaceholder('שם תצוגה').fill('מ'.repeat(20));
  await page.locator('.avatar-pick').nth(0).click();
  await page.getByRole('button', { name: 'שמירה וכניסה' }).click();
  const chip = await page.locator('.me-chip').boundingBox();
  expect(chip!.x).toBeGreaterThanOrEqual(8);
  expect(chip!.x + chip!.width).toBeLessThanOrEqual(360 - 8);
  await ctx.close();
});
