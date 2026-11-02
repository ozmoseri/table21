import { expect, test, type Page } from '@playwright/test';
import { SHOTS, onboard, player } from './helpers.ts';

/** Writes local practice coins straight into this browser's IndexedDB (idb-keyval store), like a practice session would. */
async function setPracticeUnits(page: Page, units: number) {
  await page.evaluate(
    (u) =>
      new Promise<void>((res, rej) => {
        const req = indexedDB.open('keyval-store');
        req.onupgradeneeded = () => req.result.createObjectStore('keyval');
        req.onsuccess = () => {
          const tx = req.result.transaction('keyval', 'readwrite');
          tx.objectStore('keyval').put({ name: 'Local', avatar: 'amber', practiceUnits: u, passPlayers: [] }, 't21:local');
          tx.oncomplete = () => res();
          tx.onerror = () => rej(tx.error);
        };
      }),
    units,
  );
}

test('guest saves the account with recovery codes and restores it on another device; providers not set up are shown as unavailable; practice coins stay local', async ({ browser }) => {
  const a = await player(browser, 'עוז');
  await onboard(a, 0);
  await expect(a.page.getByTestId('home-save')).toBeVisible();
  await a.page.getByTestId('home-save').click();
  await expect(a.page.getByTestId('account-status')).toHaveAttribute('data-kind', 'guest');
  for (const id of ['google', 'facebook']) {
    const row = a.page.getByTestId(`provider-${id}`);
    await expect(row).toHaveAttribute('data-state', 'not_configured');
    await expect(row).toContainText('לא הוגדר בשרת הזה');
    await expect(row.getByRole('button')).toHaveCount(0);
  }
  await expect(a.page.getByTestId('provider-apple')).toContainText('מתוכנן');
  await a.page.getByTestId('create-codes').click();
  // The codes come back from the server: wait for all eight before reading them (reading at once raced the request).
  await expect(a.page.getByTestId('recovery-codes').locator('li')).toHaveCount(8);
  const codes = await a.page.getByTestId('recovery-codes').locator('li').allTextContents();
  expect(codes).toHaveLength(8);
  await a.page.screenshot({ path: `${SHOTS}/stage-c-account-codes.png`, fullPage: true });
  await a.page.getByTestId('codes-saved').check();
  await a.page.getByRole('button', { name: 'סגירה' }).click();
  await expect(a.page.getByTestId('account-status')).toHaveAttribute('data-kind', 'saved');
  const online = await a.page.getByTestId('coins-split').locator('.coins').first().textContent();

  // Second device, never onboarded: practice coins 1,234 locally, then sign in with a code.
  const b = await player(browser, 'B');
  await b.page.goto('/');
  await setPracticeUnits(b.page, 2468);
  await b.page.getByTestId('have-account').click();
  await b.page.getByTestId('signin-code').fill(codes[3].toLowerCase());
  await b.page.getByTestId('signin-go').click();
  await expect(b.page.locator('.me-name')).toHaveText('עוז', { timeout: 10_000 });
  await b.page.goto('/#/account');
  const split = b.page.getByTestId('coins-split').locator('.coins');
  await expect(split.first()).toHaveText(online!);
  await expect(split.nth(1)).toContainText('1,234');
  await b.page.screenshot({ path: `${SHOTS}/stage-c-coins-split.png`, fullPage: true });
  await expect(b.page.getByTestId('devices').locator('li')).toHaveCount(2);
  await a.ctx.close();
  await b.ctx.close();
});

test('connect code moves an account to a device that holds an unsaved guest only after explicit confirmation', async ({ browser }) => {
  const a = await player(browser, 'Maya');
  await onboard(a, 2);
  await a.page.goto('/#/account');
  await a.page.getByTestId('create-pair').click();
  const code = (await a.page.getByTestId('pair-code').textContent())!.trim();

  const c = await player(browser, 'Guest');
  await onboard(c, 4);
  await c.page.goto(`/#/link/${code}`);
  await c.page.getByTestId('signin-go').click();
  await expect(c.page.getByTestId('switch-confirm')).toContainText('Guest');
  await c.page.screenshot({ path: `${SHOTS}/stage-c-switch-confirm.png` });
  await c.page.getByTestId('switch-continue').click();
  await expect(c.page.locator('.me-name')).toHaveText('Maya', { timeout: 10_000 });
  await a.ctx.close();
  await c.ctx.close();
});

test('invite link: a new visitor previews, picks a name, joins as a friend; blocking removes the friendship', async ({ browser }) => {
  const a = await player(browser, 'Host');
  await onboard(a, 1);
  await a.page.goto('/#/friends');
  await a.page.getByTestId('invite-create').click();
  const link = (await a.page.getByTestId('invite-link').textContent())!.trim();
  expect(link).toMatch(/#\/i\/[\w-]{24}$/);

  const d = await player(browser, 'Dana');
  await d.page.goto(link.slice(link.indexOf('/#/')));
  await expect(d.page.getByTestId('invite')).toContainText('Host');
  await d.page.screenshot({ path: `${SHOTS}/stage-c-invite.png` });
  await d.page.getByTestId('invite-onboard').click();
  await d.page.getByPlaceholder('שם תצוגה').fill('Dana');
  await d.page.getByRole('button', { name: 'שמירה וכניסה' }).click();
  await d.page.getByTestId('invite-accept').click();
  await expect(d.page.locator('.member-list').first()).toContainText('Host', { timeout: 10_000 });

  await a.page.reload();
  await expect(a.page.locator('.member-list').first()).toContainText('Dana');
  await a.page.getByTestId('friend-menu').first().click();
  await a.page.getByTestId('friend-block').click();
  await expect(a.page.getByText('חסומים')).toBeVisible();
  await d.page.reload();
  await expect(d.page.getByText('Host')).toHaveCount(0);
  await a.ctx.close();
  await d.ctx.close();
});

test('provider link and sign-in on another device (test provider, automated builds only)', async ({ browser }) => {
  const a = await player(browser, 'Linker');
  await onboard(a, 5);
  await a.page.goto('/#/account');
  const sub = `e2e-${Date.now()}`;
  await a.page.getByTestId('test-sub').fill(sub);
  await a.page.getByTestId('test-go').click();
  await expect(a.page.getByTestId('provider-test')).toHaveAttribute('data-state', 'linked', { timeout: 10_000 });
  await expect(a.page.getByTestId('account-status')).toHaveAttribute('data-kind', 'saved');

  const b = await player(browser, 'Other');
  await b.page.goto('/#/signin');
  await b.page.getByTestId('test-sub').fill(sub);
  await b.page.getByTestId('test-go').click();
  await expect(b.page.locator('.me-name')).toHaveText('Linker', { timeout: 10_000 });
  await a.ctx.close();
  await b.ctx.close();
});

test('split aces A+Q is labeled "21 after split" with an accessible explanation', async ({ browser }) => {
  const p = await player(browser, 'Lab');
  await p.page.goto('/#/lab/split21');
  await expect(p.page.getByTestId('split21').first()).toBeVisible();
  await expect(p.page.getByTestId('split21-note')).toContainText('לפני פיצול');
  await p.page.screenshot({ path: `${SHOTS}/stage-c-split21.png` });
  await p.ctx.close();
});
