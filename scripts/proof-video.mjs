// Continuous proof video with sound: opening -> lobby -> table -> bet -> deal -> decision -> result.
// Usage: node scripts/proof-video.mjs <baseUrl> <outDir>      (needs a VITE_LAB=1 build: the sound log is lab-only)
//
// Picture: Playwright recordVideo of a fresh device (no saved data), portrait 390x844, plus a landscape 844x390 hand.
// Sound:   Playwright cannot record audio. Every sound the game plays is logged with its scheduled time; the log is
//          rendered offline through the game's own synthesis, voice limit and limiter, aligned to the video clock and
//          muxed with ffmpeg. It is the game's real sound engine, not a microphone recording of a device.
import { mkdirSync, readdirSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { chromium } from '@playwright/test';

const [base = 'http://127.0.0.1:3131', out = 'docs/proof'] = process.argv.slice(2);
mkdirSync(out, { recursive: true });
const browser = await chromium.launch();
const pause = (page, ms) => page.waitForTimeout(ms);

async function record(name, viewport, scenario) {
  const dir = `${out}/tmp-${name}`;
  rmSync(dir, { recursive: true, force: true });
  const ctx = await browser.newContext({ viewport, isMobile: true, hasTouch: true, deviceScaleFactor: 1, locale: 'he-IL', recordVideo: { dir, size: viewport } });
  const videoStart = Date.now();
  const page = await ctx.newPage();
  await scenario(page);
  const log = await page.evaluate(() => ({ origin: performance.timeOrigin, events: globalThis.__t21soundLog ?? [] }));
  await ctx.close();
  const webm = readdirSync(dir).find((f) => f.endsWith('.webm'));
  const seconds = Number(execFileSync('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', `${dir}/${webm}`]).toString().trim());
  // Map each sound to the video clock: the page clock (timeOrigin + t) minus the moment recording started.
  const events = log.events.map((e) => ({ s: e.s, t: (log.origin + e.t - videoStart) / 1000 })).filter((e) => e.t >= 0 && e.t < seconds);
  const r = await renderAudio(events, seconds + 0.5);
  writeFileSync(`${dir}/audio.wav`, Buffer.from(r.wav, 'base64'));
  execFileSync('ffmpeg', ['-y', '-v', 'error', '-i', `${dir}/${webm}`, '-i', `${dir}/audio.wav`, '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '24', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-b:a', '128k', '-shortest', `${out}/${name}.mp4`]);
  writeFileSync(`${out}/${name}-sounds.json`, JSON.stringify({ note: 'rendered from the game sound engine and its event log; not a microphone recording', seconds, peak: r.peak, events }, null, 1));
  rmSync(dir, { recursive: true, force: true });
  console.log(`${out}/${name}.mp4  ${seconds.toFixed(1)} s, ${events.length} sounds, peak ${r.peak.toFixed(2)}`);
}

let renderPage = null;
async function renderAudio(events, seconds) {
  if (!renderPage) {
    renderPage = await (await browser.newContext()).newPage();
    await renderPage.addInitScript(() => localStorage.setItem('t21:age-ok', '1'));
    await renderPage.goto(base + '/#/lab/three');
    await renderPage.waitForFunction(() => typeof globalThis.__t21RenderEvents === 'function');
  }
  return renderPage.evaluate(([ev, s]) => globalThis.__t21RenderEvents(ev, s), [events, seconds]);
}

// 1. Portrait: a new device from the first screen to a result, online room, one continuous take.
await record('table21-full-flow-390x844', { width: 390, height: 844 }, async (page) => {
  await page.goto(base + '/');
  await pause(page, 900); // splash -> app
  await page.getByTestId('age-gate').waitFor();
  await pause(page, 1200);
  await page.getByTestId('age-confirm').click();
  await page.getByPlaceholder('שם תצוגה').waitFor();
  await pause(page, 500);
  await page.getByPlaceholder('שם תצוגה').fill('עוז');
  await page.locator('.avatar-pick').nth(0).click();
  await pause(page, 400);
  await page.getByRole('button', { name: 'שמירה וכניסה' }).click();
  await page.getByTestId('play-friends').waitFor();
  await pause(page, 1800); // lobby
  await page.getByTestId('play-friends').click();
  await pause(page, 900);
  await page.getByTestId('create-room').click();
  await page.getByTestId('room').waitFor();
  await pause(page, 1200);
  await page.getByTestId('sit').click();
  for (let i = 0; i < 6; i++) {
    await page.locator('.stake-chip').first().waitFor();
    await pause(page, 700);
    await page.locator('.stake-chip', { hasText: /^25$/ }).click();
    await pause(page, 600);
    await page.getByTestId('bet-confirm').click();
    const deal = page.getByTestId('deal');
    if (await deal.isEnabled({ timeout: 2500 }).catch(() => false)) await deal.click().catch(() => {});
    const turn = await page.locator('.act-stand:not([disabled])').waitFor({ timeout: 15_000 }).then(() => true, () => false);
    if (turn) {
      await pause(page, 1300); // the decision
      const total = Number((await page.locator('.my-hands .total').first().textContent())?.split('/').pop()?.trim() ?? 0);
      if (total <= 11) {
        await page.locator('.act-hit').click();
        await page.locator('.act-stand:not([disabled])').waitFor({ timeout: 8000 }).catch(() => {});
        await pause(page, 900);
      }
      if (await page.locator('.act-stand:not([disabled])').isVisible().catch(() => false)) await page.locator('.act-stand').click();
      await page.getByTestId('result-panel').waitFor({ timeout: 20_000 });
      await pause(page, 3200); // result, banner, payout
      break;
    }
    await page.getByTestId('result-panel').waitFor({ timeout: 20_000 }).catch(() => {});
    await pause(page, 2500);
    await page.waitForFunction(() => /waiting|betting/.test(document.querySelector('[data-testid=room]')?.getAttribute('data-phase') ?? ''), null, { timeout: 30_000 });
  }
});

// 2. Landscape: practice on a returning device, dealt until a winning hand (banner, payout chips, rolling balance).
await record('table21-hand-844x390', { width: 844, height: 390 }, async (page) => {
  await page.addInitScript(() => localStorage.setItem('t21:age-ok', '1'));
  await page.goto(base + '/#/practice');
  await page.locator('.stake-chip').first().waitFor();
  await pause(page, 1200);
  for (let i = 0; i < 12; i++) {
    await page.locator('.stake-chip').nth(1).click();
    await pause(page, 600);
    await page.getByTestId('deal').click();
    const turn = await page.locator('.act-stand:not([disabled])').waitFor({ timeout: 6000 }).then(() => true, () => false);
    if (turn) {
      await pause(page, 1200);
      await page.locator('.act-stand').click();
    }
    await page.getByTestId('result-panel').waitFor({ timeout: 15_000 });
    const net = Number(await page.getByTestId('result-panel').getAttribute('data-net'));
    await pause(page, net > 0 ? 3200 : 1500);
    if (net > 0) break;
    await page.getByTestId('next-round').click({ timeout: 15_000 });
    await pause(page, 700);
  }
});

await browser.close();
