import { expect, test } from '@playwright/test';
import { SHOTS } from './helpers.ts';

/** P0 gate screenshots and wording for split and blackjack results, portrait and landscape. */
for (const [w, h, tag] of [
  [390, 844, 'portrait'],
  [844, 390, 'landscape'],
] as const) {
  test(`split and blackjack states read correctly (${tag})`, async ({ browser }) => {
    const ctx = await browser.newContext({ viewport: { width: w, height: h }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 });
    const page = await ctx.newPage();

    await page.goto('/#/lab/natural');
    const nat = page.getByTestId('result-panel');
    await expect(nat).toContainText('בלאקג׳ק טבעי');
    await expect(nat).toContainText('הימור');
    await expect(nat).toContainText('החזר כולל');
    await expect(nat).toContainText('רווח/הפסד נטו');
    await expect(nat).toHaveAttribute('data-net', '75'); // 25 coins staked (50 units), 62.5 back: +37.5 coins
    await expect(nat.locator('.net .coins')).toContainText('37.5');
    await expect(page.getByTestId('natural')).toBeVisible();
    // One natural label on the hand (no second, differently spelled outcome badge).
    await expect(page.locator('.me-zone .hand-meta')).not.toContainText('בלאק ג׳ק');
    await expect(page.locator('.me-zone .hand-meta .badge')).toHaveCount(0);
    await page.screenshot({ path: `${SHOTS}/gate-natural-${tag}.png` });

    await page.goto('/#/lab/split21');
    const sp = page.getByTestId('result-panel');
    await expect(sp.getByTestId('result-table').locator('tbody tr')).toHaveCount(2);
    await expect(sp.getByTestId('result-table')).toContainText('ההימור הוחזר');
    await expect(sp).not.toContainText('בלאקג׳ק טבעי');
    await expect(sp).toHaveAttribute('data-net', '-100');
    await expect(page.getByTestId('split21-note')).toContainText('לפני פיצול');
    await page.screenshot({ path: `${SHOTS}/gate-split21-${tag}.png`, fullPage: true });

    await page.goto('/#/lab/split');
    await expect(page.getByTestId('status')).toContainText('יד 3 מתוך 4');
    await expect(page.getByTestId('hand-label')).toContainText('משחקת עכשיו');
    await page.screenshot({ path: `${SHOTS}/gate-split-turn-${tag}.png` });
    await ctx.close();
  });
}
