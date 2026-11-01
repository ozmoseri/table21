// Premium design round: screenshots (portrait 390x844, landscape 844x390), a frame series and a video of one full hand.
// Usage: node scripts/premium-shots.mjs <baseUrl> <outDir>   (against a running build, e.g. pnpm build && pnpm start)
// Two real players (separate browser contexts) for the online shots; the full-hand video is a practice hand at Elegant
// speed, recorded with Playwright recordVideo at 390x844, plus a frame every 100 ms for review without a video player.
import { mkdirSync, readdirSync, renameSync, rmSync } from 'node:fs';
import { chromium } from '@playwright/test';

const [base = 'http://127.0.0.1:3131', out = 'docs/screenshots/premium'] = process.argv.slice(2);
mkdirSync(out, { recursive: true });
const browser = await chromium.launch();
const files = [];
const shot = async (page, file) => {
  await page.screenshot({ path: `${out}/${file}` });
  files.push(`${out}/${file}`);
};
const usable = async (l) => (await l.isVisible().catch(() => false)) && (await l.isEnabled({ timeout: 300 }).catch(() => false));
const mk = async (viewport, extra = {}) => {
  const ctx = await browser.newContext({ viewport, isMobile: true, hasTouch: true, deviceScaleFactor: 2, locale: 'he-IL', ...extra });
  return { ctx, page: await ctx.newPage() };
};
async function onboard(page, name, avatar) {
  await page.goto(base + '/');
  await page.getByPlaceholder('שם תצוגה').fill(name);
  await page.locator('.avatar-pick').nth(avatar).click();
  await page.getByRole('button', { name: 'שמירה וכניסה' }).click();
  await page.getByTestId('play-friends').waitFor();
}
async function pick(page, coins) {
  // The bet bar comes back once the previous hand's animation queue has finished.
  await page.locator('.stake-chip').first().waitFor({ timeout: 20_000 });
  const chip = page.locator('.stake-chip', { hasText: new RegExp(`^${coins}$`) });
  if (!(await chip.isVisible().catch(() => false))) await page.getByTestId('stake-more').click();
  await chip.click();
}

for (const s of [
  { name: 'portrait-390x844', viewport: { width: 390, height: 844 } },
  { name: 'landscape-844x390', viewport: { width: 844, height: 390 } },
]) {
  const host = await mk(s.viewport);
  const friend = await mk({ width: 390, height: 844 });
  await onboard(host.page, 'עוז', 0);
  await onboard(friend.page, 'דניאל', 1);
  await host.page.waitForTimeout(600);
  await shot(host.page, `home-${s.name}.png`);

  await host.page.getByTestId('play-friends').click();
  await host.page.getByTestId('create-room').click();
  await host.page.getByTestId('room').waitFor();
  const code = host.page.url().split('#/r/')[1];
  await friend.page.goto(`${base}/#/r/${code}`);
  await friend.page.getByTestId('room').waitFor();
  for (const p of [host.page, friend.page]) await p.getByTestId('sit').click();

  let first = true;
  for (let i = 0; ; i++) {
    await pick(friend.page, 25);
    await friend.page.getByTestId('bet-confirm').click();
    await pick(host.page, 50);
    if (first) {
      await host.page.waitForTimeout(300);
      await shot(host.page, `betting-${s.name}.png`);
      first = false;
    }
    await host.page.getByTestId('bet-confirm').click();
    if (i === 0) {
      // The room deals after its short countdown; catch the first cards in the air.
      await host.page.locator('.felt .card').nth(1).waitFor({ timeout: 30_000 });
      await host.page.waitForTimeout(60);
      await shot(host.page, `dealing-${s.name}.png`);
    }
    const turn = await host.page.locator('.act-stand').waitFor({ state: 'visible', timeout: 15_000 }).then(() => true, () => false);
    if (turn && (await host.page.locator('.act-stand:not([disabled])').waitFor({ timeout: 10_000 }).then(() => true, () => false))) break;
    if (turn) {
      const fs = friend.page.locator('.act-stand');
      if (await friend.page.locator('.act-stand:not([disabled])').waitFor({ timeout: 10_000 }).then(() => true, () => false)) await fs.click();
      if (await host.page.locator('.act-stand:not([disabled])').waitFor({ timeout: 10_000 }).then(() => true, () => false)) break;
    }
    if (i > 6) throw new Error('no playable hand after 7 deals');
    await host.page.waitForFunction(() => /waiting|betting/.test(document.querySelector('[data-testid=room]')?.getAttribute('data-phase') ?? ''), null, { timeout: 30_000 });
  }
  await host.page.waitForTimeout(400);
  await shot(host.page, `turn-${s.name}.png`);

  // Everyone stands; catch the hole card in its lift and pause, then the results.
  const until = Date.now() + 25_000;
  let caught = false;
  while (Date.now() < until && !caught) {
    for (const p of [host.page, friend.page]) {
      const b = p.locator('.act-stand');
      if (await usable(b)) await b.click().catch(() => {});
    }
    caught = await host.page.locator('.is-revealing').waitFor({ timeout: 400 }).then(() => true, () => false);
  }
  await host.page.waitForTimeout(120); // in the pause between lift and flip
  await shot(host.page, `reveal-${s.name}.png`);
  await host.page.getByTestId('result-panel').waitFor({ timeout: 20_000 });
  await host.page.waitForTimeout(1500);
  await shot(host.page, `results-${s.name}.png`);
  // The one social tray and the menu (speed, left hand, leave).
  await host.page.getByTestId('room-menu').click();
  await host.page.waitForTimeout(400);
  await shot(host.page, `menu-${s.name}.png`);
  await host.ctx.close();
  await friend.ctx.close();
}

// Full hand, video + frames, practice at Elegant: deal (arc from the shoe), peek if any, hit, stand, reveal, dealer draws.
const vidDir = `${out}/video-tmp`;
rmSync(vidDir, { recursive: true, force: true });
const v = await mk({ width: 390, height: 844 }, { recordVideo: { dir: vidDir, size: { width: 390, height: 844 } } });
const frames = `${out}/frames`;
rmSync(frames, { recursive: true, force: true });
mkdirSync(frames, { recursive: true });
let n = 0;
let filming = false;
const film = async () => {
  while (filming) {
    await v.page.screenshot({ path: `${frames}/f${String(n++).padStart(3, '0')}.jpg`, scale: 'css', type: 'jpeg', quality: 62 }).catch(() => {});
    await v.page.waitForTimeout(60);
  }
};
await v.page.goto(base + '/#/practice');
await v.page.waitForTimeout(800);
for (let i = 0; i < 12; i++) {
  await pick(v.page, 25);
  filming = true;
  const filmer = film();
  await v.page.getByTestId('deal').click();
  const playable = await v.page.locator('.act-hit:not([disabled])').waitFor({ timeout: 5000 }).then(() => true, () => false);
  if (playable) {
    // Hit once when it is safe-looking (11 or less), so the video has a hit; then stand.
    const total = Number((await v.page.locator('.my-hands .total').first().textContent())?.split('/').pop()?.trim() ?? 0);
    if (total <= 11) {
      await v.page.waitForTimeout(700);
      await v.page.locator('.act-hit').click();
      await v.page.locator('.act-stand:not([disabled])').waitFor({ timeout: 4000 }).then(() => true, () => false);
    }
    await v.page.waitForTimeout(700);
    if (await usable(v.page.locator('.act-stand'))) await v.page.locator('.act-stand').click();
    await v.page.getByTestId('next-round').waitFor({ timeout: 15_000 });
    await v.page.waitForTimeout(1800);
    filming = false;
    await filmer;
    break;
  }
  filming = false;
  await filmer;
  rmSync(frames, { recursive: true, force: true });
  mkdirSync(frames, { recursive: true });
  n = 0;
  await v.page.getByTestId('next-round').click({ timeout: 15_000 });
}
await v.ctx.close();
const webm = readdirSync(vidDir).find((f) => f.endsWith('.webm'));
if (webm) {
  renameSync(`${vidDir}/${webm}`, `${out}/full-hand-390x844.webm`);
  files.push(`${out}/full-hand-390x844.webm`);
}
rmSync(vidDir, { recursive: true, force: true });
files.push(`${frames}/ (${n} frames)`);
await browser.close();
console.log(files.join('\n'));
