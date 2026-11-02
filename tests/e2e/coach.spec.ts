import { expect, test, type Page } from '@playwright/test';
import { createRoom, onboard, pickAndConfirm, player, sit } from './helpers.ts';

/** Coach (beginner tips): tip button, hot/cold meter, closable "why" sheet, verdicts, settings, guide. */

async function practiceTurn(page: Page) {
  await page.goto('/#/practice');
  await page.locator('.stake-chip').first().waitFor();
  for (let i = 0; i < 15; i++) {
    await page.locator('.stake-chip').first().click();
    await page.getByTestId('deal').click();
    if (await page.locator('.act-stand:not([disabled])').waitFor({ timeout: 6000 }).then(() => true, () => false)) return;
    await page.getByTestId('next-round').click({ timeout: 10_000 });
  }
  throw new Error('no turn in 15 deals');
}

test('practice: the coach is on by default; tip names one legal move, the why sheet closes, a verdict follows the move', async ({ browser }) => {
  const p = await player(browser, 'Coach');
  await p.ctx.addInitScript(() => localStorage.setItem('t21:age-ok', '1'));
  await practiceTurn(p.page);
  const bar = p.page.getByTestId('coach-bar');
  await expect(bar).toBeVisible();
  // the meter states a risk from 0 to 100%, before any tip is asked for
  const risk = Number(await p.page.getByTestId('coach-meter').getAttribute('data-risk'));
  expect(risk).toBeGreaterThanOrEqual(0);
  expect(risk).toBeLessThanOrEqual(100);
  await expect(p.page.locator('.act[data-coach-pick]')).toHaveCount(0); // nothing given away before the tap
  await p.page.getByTestId('coach-tip').click();
  const pick = p.page.locator('.act[data-coach-pick]');
  await expect(pick).toHaveCount(1);
  await expect(pick).toBeEnabled();
  await p.page.getByTestId('coach-tip').click();
  await expect(p.page.getByTestId('coach-sheet')).toBeVisible();
  await p.page.getByRole('button', { name: 'סגירה' }).click();
  await expect(p.page.getByTestId('coach-sheet')).toHaveCount(0);
  await pick.click();
  await expect(p.page.getByTestId('coach-verdict')).toContainText('מהלך נכון');
  await p.ctx.close();
});

test('the coach never moves the table: the strip fits inside the fixed controls at 360x640', async ({ browser }) => {
  const p = await player(browser, 'Fit', { width: 360, height: 640 });
  await p.ctx.addInitScript(() => localStorage.setItem('t21:age-ok', '1'));
  await practiceTurn(p.page);
  const box = await p.page.evaluate(() => {
    const r = (s: string) => document.querySelector(s)!.getBoundingClientRect();
    return { ctl: r('.room > .controls'), bar: r('.coach-bar'), acts: r('.actions'), hand: r('.me-zone .my-hands') };
  });
  expect(box.bar.top).toBeGreaterThanOrEqual(box.ctl.top - 1);
  expect(box.acts.bottom).toBeLessThanOrEqual(box.ctl.bottom + 1);
  expect(box.bar.bottom).toBeLessThanOrEqual(box.acts.top);
  expect(box.hand.bottom).toBeLessThanOrEqual(box.ctl.top + 1);
  await p.ctx.close();
});

test('settings: tips off in practice gives the plain action row; rooms are off by default and can be turned on', async ({ browser }) => {
  const p = await player(browser, 'Toggle');
  await onboard(p, 2);
  await p.page.goto('/#/settings');
  await expect(p.page.getByTestId('coach-practice')).toBeChecked();
  await expect(p.page.getByTestId('coach-rooms')).not.toBeChecked();
  await p.page.getByTestId('coach-practice').uncheck();
  await practiceTurn(p.page);
  await expect(p.page.locator('.actions')).toBeVisible();
  await expect(p.page.getByTestId('coach-bar')).toHaveCount(0);

  // a room: no tips by default
  await p.page.goto('/#/home');
  const code = await createRoom(p);
  await sit(p);
  const roomTurn = async () => {
    for (let i = 0; i < 8; i++) {
      await pickAndConfirm(p.page);
      const deal = p.page.getByTestId('deal');
      if (await deal.isVisible().catch(() => false)) await deal.click();
      if (await p.page.locator('.act-stand:not([disabled])').waitFor({ timeout: 10_000 }).then(() => true, () => false)) return;
      await expect(p.page.getByTestId('room')).toHaveAttribute('data-phase', /waiting|betting/, { timeout: 30_000 });
    }
    throw new Error('no turn in the room');
  };
  await roomTurn();
  await expect(p.page.getByTestId('coach-bar')).toHaveCount(0);
  await p.page.locator('.act-stand').click();
  await expect(p.page.getByTestId('room')).toHaveAttribute('data-phase', /waiting|betting/, { timeout: 30_000 });

  // turned on for rooms: the strip appears on the next turn (only on this device)
  await p.page.goto('/#/settings');
  await p.page.getByTestId('coach-rooms').check();
  await p.page.goto(`/#/r/${code}`);
  await expect(p.page.getByTestId('room')).toBeVisible();
  await roomTurn();
  await expect(p.page.getByTestId('coach-bar')).toBeVisible();
  await p.ctx.close();
});

test('guide: the strategy chart comes from the same advice as the coach', async ({ browser }) => {
  const p = await player(browser, 'Guide');
  await p.ctx.addInitScript(() => localStorage.setItem('t21:age-ok', '1'));
  await p.page.goto('/#/guide');
  const hard = p.page.getByTestId('guide-hard');
  await expect(hard.locator('tbody tr')).toHaveCount(10);
  await expect(p.page.getByTestId('guide-soft').locator('tbody tr')).toHaveCount(8);
  await expect(p.page.getByTestId('guide-pairs').locator('tbody tr')).toHaveCount(10);
  // 16 against 10: hit. 11 against an ace: hit (the dealer stands on soft 17). 12 against 4: stand.
  const cell = (row: string, col: number) => hard.locator('tbody tr', { has: p.page.locator('th', { hasText: new RegExp(`^${row}$`) }) }).locator('td').nth(col);
  await expect(cell('16', 8)).toHaveText('ק');
  await expect(cell('11', 9)).toHaveText('ק');
  await expect(cell('11', 0)).toHaveText('כ');
  await expect(cell('12', 2)).toHaveText('ע');
  // row labels are on screen (not scrolled away in RTL)
  const label = await hard.locator('tbody th').first().boundingBox();
  expect(label!.x).toBeGreaterThanOrEqual(0);
  await p.ctx.close();
});
