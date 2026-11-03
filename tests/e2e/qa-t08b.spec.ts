import { expect, test } from '@playwright/test';
import { mkdirSync, writeFileSync } from 'node:fs';

/* T08 probe 3b: English "unreachable server" screens with the language really saved from Settings (prefs live in IndexedDB). */
const DIR = 'docs/screenshots/qa-T08';
mkdirSync(DIR, { recursive: true });
const out: unknown[] = [];
test.afterAll(() => writeFileSync(process.env.QA_OUT ?? '/tmp/claude-0/qa-3b.json', JSON.stringify(out, null, 1)));

for (const kind of ['unknown', 'online', 'lan'] as const) {
  test(`3b english unreachable ${kind}`, async ({ browser }) => {
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, serviceWorkers: 'block', locale: 'he-IL' });
    await ctx.addInitScript(() => localStorage.setItem('t21:age-ok', '1'));
    let down = false;
    await ctx.route('**/api/**', (route) => {
      if (down) return route.abort('connectionrefused');
      if (kind !== 'unknown' && new URL(route.request().url()).pathname === '/api/config')
        return route.fulfill({ json: { deployment: kind, ads: { enabled: false }, avatars: [], leaderboardMinHands: 20, build: 'test', commit: null, builtAt: null, protocol: 1 } });
      return route.continue();
    });
    const page = await ctx.newPage();
    await page.goto('/');
    await page.getByPlaceholder(/שם תצוגה/).fill('Maya');
    await page.locator('.avatar-pick').nth(0).click();
    await page.getByRole('button', { name: /שמירה וכניסה/ }).click();
    await expect(page.getByTestId('play-friends')).toBeEnabled({ timeout: 15_000 });
    await page.goto('/#/settings');
    await page.getByRole('button', { name: 'English' }).click();
    await page.waitForTimeout(700);
    down = true;
    await page.goto('/');
    await page.reload();
    await expect(page.getByTestId('waking')).toBeVisible({ timeout: 15_000 });
    await page.waitForTimeout(1500);
    await page.screenshot({ path: `${DIR}/3b-unreachable-${kind}-en.jpg`, type: 'jpeg', quality: 50 });
    const t = await page.getByTestId('waking').innerText();
    out.push({ kind, t, hebrew: await page.evaluate(() => (document.body.innerText.match(/[֐-׿]+/g) ?? []).slice(0, 10)), pct: /%|percent/i.test(t), overflow: await page.evaluate(() => document.documentElement.scrollWidth - innerWidth), dataKind: await page.getByTestId('waking').getAttribute('data-kind') });
    await ctx.close();
  });
}
