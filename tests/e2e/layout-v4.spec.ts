import { expect, test, type Page } from '@playwright/test';
import { SHOTS, onboard, player } from './helpers.ts';

const box = async (page: Page, sel: string) => (await page.locator(sel).first().boundingBox())!;
const overlap = (a: { x: number; y: number; width: number; height: number }, b: typeof a) =>
  a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;

test('landscape phone: dedicated layouts (nav rail, two-column home and profile, felt fills the height, nothing overlaps)', async ({ browser }) => {
  const p = await player(browser, 'עוז מוסרי', { width: 844, height: 390 });
  await onboard(p, 0);
  const vw = 844;
  const vh = 390;
  const nav = await box(p.page, '.tabbar');
  expect(nav.width).toBeLessThan(130);
  expect(nav.height).toBeGreaterThan(vh * 0.9);
  const main = await box(p.page, '.home-main');
  const side = await box(p.page, '.home-side');
  expect(Math.abs(main.y - side.y)).toBeLessThan(40); // side by side, not stacked
  await p.page.screenshot({ path: `${SHOTS}/v4-landscape-home.png` });

  await p.page.goto('/#/practice');
  await p.page.locator('.stake-chip').nth(2).click();
  await expect(p.page.getByTestId('bet-spot')).toHaveClass(/has-bet/);
  await p.page.getByTestId('deal').click();
  await expect(p.page.locator('.my-hands .card')).toHaveCount(2);
  const felt = await box(p.page, '.room > .felt');
  expect(felt.height).toBeGreaterThan(vh * 0.85);
  expect(felt.width).toBeGreaterThan(vw * 0.55);
  const ctl = await box(p.page, '.controls');
  expect(ctl.y + ctl.height).toBeLessThanOrEqual(vh + 1);
  await p.page.waitForTimeout(900);
  await p.page.screenshot({ path: `${SHOTS}/v4-landscape-practice.png` });

  for (const kind of ['three', 'six']) {
    await p.page.goto(`/#/lab/${kind}`);
    const hand = await box(p.page, '.my-hands');
    for (const seat of await p.page.locator('.others .seat').all()) expect(overlap(hand, (await seat.boundingBox())!), `${kind}: hand over a seat`).toBe(false);
    const f = await box(p.page, '.room > .felt');
    expect(hand.y + hand.height).toBeLessThanOrEqual(f.y + f.height + 1);
    await p.page.screenshot({ path: `${SHOTS}/v4-landscape-${kind}.png` });
  }
  await p.ctx.close();
});

test('portrait phone: the table fills the height and the actions sit in the thumb zone; result wording and bet spot', async ({ browser }) => {
  const p = await player(browser, 'Portrait');
  await p.page.goto('/#/practice');
  await expect(p.page.getByTestId('bet-spot')).toContainText('בחרו צ׳יפ');
  await p.page.locator('.stake-chip').first().click();
  await expect(p.page.getByTestId('bet-spot')).toHaveClass(/has-bet/);
  await p.page.screenshot({ path: `${SHOTS}/v4-portrait-bet.png` });
  await p.page.getByTestId('deal').click();
  await expect(p.page.locator('.my-hands .card')).toHaveCount(2);
  const ctl = await box(p.page, '.controls');
  expect(ctl.y).toBeGreaterThan(844 * 0.7);
  await p.page.waitForTimeout(900);
  await p.page.screenshot({ path: `${SHOTS}/v4-portrait-turn.png` });

  await p.page.goto('/#/lab/result');
  await expect(p.page.getByTestId('result-panel')).toContainText('החזר כולל');
  await expect(p.page.getByTestId('result-panel')).toContainText('רווח/הפסד נטו');
  await p.page.goto('/#/settings');
  await expect(p.page.getByTestId('sound-test').getByRole('button')).toHaveCount(12);
  await p.ctx.close();
});
