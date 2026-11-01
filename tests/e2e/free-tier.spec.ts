import { expect, test } from '@playwright/test';
import pg from 'pg';
import { SHOTS, onboard, player } from './helpers.ts';

/** Render free tier in the browser: cold start screen, and a create whose answer is lost is applied once. */
const DB = process.env.T21_E2E_DATABASE_URL ?? 'postgres://t21@127.0.0.1:55432/table21_e2e';
async function sql<T = any>(text: string, params: unknown[] = []): Promise<T[]> {
  const c = new pg.Client({ connectionString: DB });
  await c.connect();
  try {
    return (await c.query(text, params as any[])).rows;
  } finally {
    await c.end();
  }
}

const sizes = [
  { name: 'portrait-360x640', viewport: { width: 360, height: 640 } },
  { name: 'portrait-390x844', viewport: { width: 390, height: 844 } },
  { name: 'landscape-844x390', viewport: { width: 844, height: 390 } },
];

test('cold start: "server is waking up" screen, offline practice one tap away, continues by itself when the server answers', async ({ browser }) => {
  for (const s of sizes) {
    const p = await player(browser, 'Wake', s.viewport);
    let asleep = true;
    // While the host spins up it answers 503 (or holds the request); here: 503 until the server "wakes".
    await p.page.route('**/api/me', (r) => (asleep ? r.fulfill({ status: 503, contentType: 'text/html', body: 'waking' }) : r.continue()));
    await p.page.goto('/');
    const w = p.page.getByTestId('waking');
    await expect(w).toBeVisible({ timeout: 10_000 });
    await expect(w).toContainText('השרת מתעורר');
    await expect(p.page.getByTestId('waking-practice')).toBeVisible();
    // Nothing overflows and the buttons are real tap targets.
    expect(await p.page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    for (const id of ['waking-retry', 'waking-practice']) {
      const box = (await p.page.getByTestId(id).boundingBox())!;
      expect(box.height).toBeGreaterThanOrEqual(48);
      expect(box.y + box.height).toBeLessThanOrEqual(s.viewport.height);
    }
    await p.page.waitForTimeout(1200); // let the elapsed counter tick once for the screenshot
    await p.page.screenshot({ path: `${SHOTS}/waking-${s.name}.png` });
    asleep = false;
    await p.page.getByTestId('waking-retry').click();
    await expect(p.page.getByPlaceholder('שם תצוגה')).toBeVisible({ timeout: 10_000 });
    await expect(w).toHaveCount(0);
    await p.ctx.close();
  }
});

test('cold start: guest creation whose answer is lost is retried with the same key and creates one account', async ({ browser }) => {
  const p = await player(browser, 'Lost answer');
  const name = `Lost ${Date.now() % 100000}`;
  const keys: string[] = [];
  let first = true;
  await p.page.route('**/api/session', async (r) => {
    keys.push(r.request().headers()['idempotency-key']);
    if (first) {
      first = false;
      await r.fetch(); // the server receives it and creates the account...
      await new Promise((res) => setTimeout(res, 300));
      return r.abort('connectionreset'); // ...but the phone never gets the answer (proxy cut while waking)
    }
    return r.continue();
  });
  await p.page.goto('/');
  await p.page.getByPlaceholder('שם תצוגה').fill(name);
  await p.page.getByRole('button', { name: 'שמירה וכניסה' }).click();
  await expect(p.page.getByTestId('pending-create')).toBeVisible();
  await expect(p.page.getByTestId('play-friends')).toBeEnabled({ timeout: 15_000 });
  expect(keys.length).toBe(2);
  expect(keys[0]).toMatch(/^[0-9a-f]{32}$/);
  expect(keys[1]).toBe(keys[0]);
  const users = await sql(`select id from users where name = $1`, [name]);
  expect(users).toHaveLength(1);
  const grants = await sql(`select count(*)::int as n from ledger l join wallets w on w.id = l.wallet_id where w.user_id = $1 and l.kind = 'grant_welcome'`, [users[0].id]);
  expect(grants[0].n).toBe(1);
  await p.ctx.close();
});

test('cold start: a room whose answer is lost opens once', async ({ browser }) => {
  const p = await player(browser, 'Room once');
  await onboard(p, 1);
  const me = await p.page.evaluate(() => fetch('/api/me').then((r) => r.json()));
  let first = true;
  await p.page.route('**/api/rooms', async (r) => {
    if (r.request().method() !== 'POST') return r.continue();
    if (first) {
      first = false;
      await r.fetch();
      return r.abort('connectionreset');
    }
    return r.continue();
  });
  await p.page.getByTestId('play-friends').click();
  await p.page.getByTestId('create-room').click();
  await expect(p.page.getByTestId('room')).toBeVisible({ timeout: 15_000 });
  const rooms = await sql(`select id, code from rooms where owner_id = $1`, [me.userId]);
  expect(rooms).toHaveLength(1);
  expect(p.page.url()).toContain(`#/r/${rooms[0].code}`);
  await p.ctx.close();
});
