// Final screenshot set of a release candidate against a running production build (docs/screenshots/rc/).
// Usage: node scripts/rc-shots.mjs <baseUrl> <outDir>
// Two real players (separate browser contexts) play one online hand: lobby, table in the middle of a hand,
// results with the money breakdown; portrait 390x844 and landscape 844x390.
import { mkdirSync } from 'node:fs';
import { chromium } from '@playwright/test';

const [base = 'http://127.0.0.1:3131', out = 'docs/screenshots/rc'] = process.argv.slice(2);
mkdirSync(out, { recursive: true });
const sizes = [
  { name: 'portrait-390x844', viewport: { width: 390, height: 844 } },
  { name: 'landscape-844x390', viewport: { width: 844, height: 390 } },
];
const browser = await chromium.launch();
const files = [];
const shot = async (page, file) => {
  await page.screenshot({ path: `${out}/${file}` });
  files.push(`${out}/${file}`);
};
async function onboard(page, name, avatar) {
  await page.goto(base + '/');
  // A new device answers the 18+ gate first (builds from 2026-11-01 on).
  const age = page.getByTestId('age-confirm');
  if (await age.isVisible({ timeout: 2500 }).catch(() => false)) await age.click();
  await page.getByPlaceholder('שם תצוגה').fill(name);
  await page.locator('.avatar-pick').nth(avatar).click();
  await page.getByRole('button', { name: 'שמירה וכניסה' }).click();
  await page.getByTestId('play-friends').waitFor();
}
const usable = async (l) => (await l.isVisible().catch(() => false)) && (await l.isEnabled({ timeout: 300 }).catch(() => false));

for (const s of sizes) {
  const mk = async (viewport) => {
    const ctx = await browser.newContext({ viewport, isMobile: true, hasTouch: true, deviceScaleFactor: 2, locale: 'he-IL' });
    return { ctx, page: await ctx.newPage() };
  };
  const host = await mk(s.viewport);
  const friend = await mk({ width: 390, height: 844 });
  await onboard(host.page, 'עוז', 0);
  await onboard(friend.page, 'דניאל', 1);
  await host.page.waitForTimeout(600);
  await shot(host.page, `lobby-${s.name}.png`);

  await host.page.getByTestId('play-friends').click();
  await host.page.getByTestId('create-room').click();
  await host.page.getByTestId('room').waitFor();
  const code = host.page.url().split('#/r/')[1];
  await friend.page.goto(`${base}/#/r/${code}`);
  await friend.page.getByTestId('room').waitFor();
  for (const p of [host.page, friend.page]) await p.getByTestId('sit').click();

  // Bet until a hand with a turn for the host is dealt (a natural ends the round at once).
  for (let i = 0; ; i++) {
    for (const [p, coins] of [[host.page, 50], [friend.page, 25]]) {
      // Pick a chip (it sends nothing), then the gold Confirm places the bet.
      const chip = p.locator('.stake-chip', { hasText: new RegExp(`^${coins}$`) });
      if (!(await chip.isVisible().catch(() => false))) await p.getByTestId('stake-more').click();
      await chip.click();
      await p.getByTestId('bet-confirm').click();
    }
    const turn = await host.page.locator('.act-stand').waitFor({ state: 'visible', timeout: 15_000 }).then(() => true, () => false);
    if (turn && (await usable(host.page.locator('.act-stand')))) break;
    if (turn) {
      // Friend's turn first: let the friend stand, then the host acts.
      const fs = friend.page.locator('.act-stand');
      if (await usable(fs)) await fs.click();
      if (await host.page.locator('.act-stand:not([disabled])').waitFor({ timeout: 10_000 }).then(() => true, () => false)) break;
    }
    if (i > 5) throw new Error('no playable hand after 6 deals');
    await host.page.waitForFunction(() => /waiting|betting/.test(document.querySelector('[data-testid=room]')?.getAttribute('data-phase') ?? ''), null, { timeout: 30_000 });
  }
  await host.page.waitForTimeout(1200); // cards landed
  await shot(host.page, `mid-hand-${s.name}.png`);

  // Finish the hand: everyone stands, the dealer plays, results with stake, total returned and net.
  const end = Date.now() + 40_000;
  while (Date.now() < end && !(await host.page.getByTestId('result-panel').isVisible().catch(() => false))) {
    for (const p of [host.page, friend.page]) {
      const b = p.locator('.act-stand');
      if (await usable(b)) await b.click().catch(() => {});
    }
    await host.page.waitForTimeout(250);
  }
  await host.page.getByTestId('result-panel').waitFor({ timeout: 10_000 });
  await host.page.waitForTimeout(1500); // celebration settled
  await shot(host.page, `results-${s.name}.png`);
  await host.ctx.close();
  await friend.ctx.close();
}
await browser.close();
console.log(files.join('\n'));
