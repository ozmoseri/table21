import { expect, test, type Browser, type BrowserContext, type Page } from '@playwright/test';
import { mkdirSync, writeFileSync } from 'node:fs';

/*
 * T08 independent QA probes (emulated browser, Chromium). Not part of the product suite: measures and screenshots only.
 * Findings are collected in qa-results.json (scratch) and summarised by hand in docs/qa/ACCEPTANCE_2026-11-03.md.
 */
const DIR = 'docs/screenshots/qa-T08';
mkdirSync(DIR, { recursive: true });
const OUT = process.env.QA_OUT ?? '/tmp/claude-0/qa-results.json';
const results: { area: string; check: string; value: unknown }[] = [];
const note = (area: string, check: string, value: unknown) => results.push({ area, check, value });
test.afterAll(() => writeFileSync(OUT, JSON.stringify(results, null, 1)));

const VPS = [
  { w: 360, h: 640 },
  { w: 390, h: 844 },
  { w: 844, h: 390 },
] as const;

interface P {
  ctx: BrowserContext;
  page: Page;
  errors: string[];
}
async function mk(browser: Browser, vp = { w: 390, h: 844 }, opts: { reducedMotion?: 'reduce'; locale?: string; sw?: boolean } = {}): Promise<P> {
  const ctx = await browser.newContext({
    viewport: { width: vp.w, height: vp.h },
    isMobile: true,
    hasTouch: true,
    deviceScaleFactor: 1,
    locale: opts.locale ?? 'he-IL',
    reducedMotion: opts.reducedMotion,
    serviceWorkers: opts.sw ? 'allow' : 'block',
  });
  await ctx.addInitScript(() => localStorage.setItem('t21:age-ok', '1'));
  const page = await ctx.newPage();
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push('console: ' + m.text().slice(0, 200));
  });
  return { ctx, page, errors };
}
const shot = (page: Page, name: string) => page.screenshot({ path: `${DIR}/${name}.jpg`, type: 'jpeg', quality: 50 });

async function onboard(p: P, name: string, avatar = 0) {
  await p.page.goto('/');
  await p.page.getByPlaceholder(/שם תצוגה|Display name/).fill(name);
  await p.page.locator('.avatar-pick').nth(avatar).click();
  await p.page.getByRole('button', { name: /שמירה וכניסה|Save and enter/ }).click();
  await expect(p.page.getByTestId('play-friends')).toBeEnabled({ timeout: 15_000 });
}
const overflow = (page: Page) => page.evaluate(() => document.documentElement.scrollWidth - innerWidth);
const hebrew = (page: Page) => page.evaluate(() => (document.body.innerText.match(/[֐-׿]+/g) ?? []).slice(0, 12));
const text = (page: Page) => page.evaluate(() => document.body.innerText.replace(/\s+/g, ' ').trim().slice(0, 600));
const rect = (page: Page, sel: string) =>
  page.evaluate((s) => {
    const e = document.querySelector(s);
    if (!e) return null;
    const b = e.getBoundingClientRect();
    return { l: Math.round(b.left), t: Math.round(b.top), r: Math.round(b.right), b: Math.round(b.bottom), w: Math.round(b.width), h: Math.round(b.height) };
  }, sel);

async function practiceTurn(page: Page, hash = '/#/practice') {
  await page.goto(hash);
  await page.locator('.stake-chip').first().waitFor();
  for (let i = 0; i < 20; i++) {
    await page.locator('.stake-chip').first().click();
    await page.getByTestId('deal').click();
    if (await page.locator('.act-stand:not([disabled])').waitFor({ timeout: 6000 }).then(() => true, () => false)) return;
    await page.getByTestId('next-round').click({ timeout: 10_000 });
  }
  throw new Error('no turn in 20 deals');
}
async function finishHand(page: Page) {
  for (let i = 0; i < 30; i++) {
    if (await page.getByTestId('result-panel').isVisible().catch(() => false)) return;
    const stand = page.locator('.act-stand:not([disabled])');
    if (await stand.isVisible().catch(() => false)) await stand.click().catch(() => {});
    await page.waitForTimeout(250);
  }
  await expect(page.getByTestId('result-panel')).toBeVisible();
}

// ---------------------------------------------------------------- 1. core journey (two contexts, online)
test('1 core journey: lobby, create, join valid and invalid, bet, deal, decide, result, next round, reload mid-round', async ({ browser }) => {
  const a = await mk(browser, { w: 390, h: 844 });
  const b = await mk(browser, { w: 360, h: 640 });
  await a.page.goto('/');
  await shot(a.page, '1-00-onboarding-390');
  note('1', 'onboarding text', await text(a.page));
  await onboard(a, 'עוז');
  await shot(a.page, '1-01-lobby-host-390');
  note('1', 'lobby text host', await text(a.page));
  await onboard(b, 'Maya', 3);
  await a.page.getByTestId('play-friends').click();
  await shot(a.page, '1-02-create-sheet-390');
  note('1', 'create sheet text', await text(a.page));
  await a.page.getByTestId('create-room').click();
  await expect(a.page.getByTestId('room')).toBeVisible();
  const code = a.page.url().split('#/r/')[1];
  note('1', 'room code', code);
  await a.page.waitForTimeout(700);
  await shot(a.page, '1-03-room-empty-host-390');
  note('1', 'empty room text', await text(a.page));

  // invalid code
  await b.page.getByTestId('join-code').fill('ZZZZZZ');
  await b.page.getByTestId('join-go').click();
  await expect(b.page.getByTestId('join-error')).toBeVisible({ timeout: 10_000 });
  note('1', 'invalid code error text', await b.page.getByTestId('join-error').innerText());
  note('1', 'invalid code field kept/focused', { value: await b.page.getByTestId('join-code').inputValue(), focused: await b.page.getByTestId('join-code').evaluate((e) => document.activeElement === e) });
  await shot(b.page, '1-04-join-invalid-360');
  // valid code
  await b.page.getByTestId('join-code').fill(code.toLowerCase());
  await b.page.getByTestId('join-go').click();
  await expect(b.page.getByTestId('room')).toBeVisible({ timeout: 10_000 });
  await b.page.waitForTimeout(600);
  await shot(b.page, '1-05-room-guest-360');

  // sit + bet
  for (const p of [a, b]) {
    await p.page.getByTestId('sit').click();
    await p.page.locator('.stake-chip').first().waitFor();
  }
  await shot(a.page, '1-06-betting-host-390');
  await shot(b.page, '1-07-betting-guest-360');
  note('1', 'betting text host', await text(a.page));
  for (const p of [a, b]) {
    await p.page.locator('.stake-chip').first().click();
    await shot(p.page, p === a ? '1-08-chip-picked-host-390' : '1-08b-chip-picked-guest-360').catch(() => {});
    await p.page.getByTestId('bet-confirm').click();
  }
  await expect(a.page.locator('.dealer-cards .card')).toHaveCount(2, { timeout: 10_000 });
  await a.page.waitForTimeout(1200);
  const roundBefore = await a.page.getByTestId('room').getAttribute('data-round').catch(() => null);

  // reload guest mid-round (before anyone acted if possible)
  const myCardsBefore = await b.page.locator('.my-hands .card').count();
  await shot(b.page, '1-09-dealt-guest-360');
  await b.page.reload();
  await expect(b.page.getByTestId('room')).toBeVisible({ timeout: 15_000 });
  await b.page.waitForTimeout(1500);
  const myCardsAfter = await b.page.locator('.my-hands .card').count();
  note('1', 'guest reload mid-round: my cards before/after', { myCardsBefore, myCardsAfter, url: b.page.url().endsWith(code) });
  await shot(b.page, '1-10-after-reload-guest-360');

  // decide
  let turnShot = false;
  const deadline = Date.now() + 60_000;
  while (Date.now() < deadline) {
    const done = await Promise.all([a, b].map((p) => p.page.getByTestId('result-panel').isVisible().catch(() => false)));
    if (done.every(Boolean)) break;
    for (const p of [a, b]) {
      const stand = p.page.locator('.act-stand:not([disabled])');
      if (await stand.isVisible().catch(() => false)) {
        if (!turnShot && p === a) {
          await shot(a.page, '1-11-my-turn-host-390');
          note('1', 'my turn text host', await text(a.page));
          turnShot = true;
        }
        await stand.click().catch(() => {});
      }
    }
    await a.page.waitForTimeout(200);
  }
  await expect(a.page.getByTestId('result-panel')).toBeVisible({ timeout: 20_000 });
  await a.page.waitForTimeout(900);
  await shot(a.page, '1-12-result-host-390');
  await shot(b.page, '1-13-result-guest-360');
  note('1', 'result text host', await a.page.getByTestId('result-panel').innerText());
  note('1', 'result text guest', await b.page.getByTestId('result-panel').innerText());
  note('1', 'result vs balance chip (host)', { net: await a.page.getByTestId('result-panel').getAttribute('data-net'), bal: await text(a.page) });

  // next round
  const nr = a.page.getByTestId('next-round');
  note('1', 'next-round button visible after result', await nr.isVisible().catch(() => false));
  await a.page.waitForTimeout(3000);
  await shot(a.page, '1-14-after-result-3s-host-390');
  note('1', 'after result 3s text host', await text(a.page));
  const chips = await a.page.locator('.stake-chip').first().isVisible().catch(() => false);
  note('1', 'next round bet bar returned on its own (host)', chips);
  if (await nr.isVisible().catch(() => false)) await nr.click();
  await a.page.waitForTimeout(1500);
  await shot(a.page, '1-15-next-round-host-390');
  note('1', 'next round text host', await text(a.page));
  note('1', 'errors host', a.errors);
  note('1', 'errors guest', b.errors);
  await a.ctx.close();
  await b.ctx.close();
});

// ---------------------------------------------------------------- 2. sizes: lobby, my turn, result, coach strip
for (const vp of VPS) {
  test(`2 sizes ${vp.w}x${vp.h}: lobby, my turn with coach strip, tip, result`, async ({ browser }) => {
    const p = await mk(browser, vp);
    await onboard(p, 'עוז מוסרי');
    await p.page.waitForTimeout(500);
    await shot(p.page, `2-lobby-${vp.w}x${vp.h}`);
    note('2', `lobby overflow ${vp.w}x${vp.h}`, await overflow(p.page));
    const lobbyBtns = await p.page.evaluate(() => [...document.querySelectorAll('button,a')].filter((e) => e.getBoundingClientRect().width > 0).map((e) => ({ t: (e.textContent ?? '').trim().slice(0, 18), b: Math.round(e.getBoundingClientRect().bottom), r: Math.round(e.getBoundingClientRect().right) })).filter((x) => x.r > innerWidth + 1));
    note('2', `lobby controls beyond right edge ${vp.w}x${vp.h}`, lobbyBtns);
    await practiceTurn(p.page);
    await p.page.waitForTimeout(1200);
    await shot(p.page, `2-myturn-coach-${vp.w}x${vp.h}`);
    const r = {
      overflow: await overflow(p.page),
      hand: await rect(p.page, '.me-zone .my-hands'),
      controls: await rect(p.page, '.room > .controls'),
      bar: await rect(p.page, '.coach-bar'),
      acts: await rect(p.page, '.actions'),
      myCard: await rect(p.page, '.my-hands .card'),
      dealerCard: await rect(p.page, '.dealer-cards .card'),
    };
    note('2', `my turn geometry ${vp.w}x${vp.h}`, r);
    const bad: string[] = [];
    if (r.overflow > 1) bad.push('h-scroll');
    if (r.hand && r.controls && r.hand.b > r.controls.t + 1) bad.push('hand overlaps controls');
    if (r.bar && r.acts && r.bar.b > r.acts.t + 1) bad.push('coach bar overlaps actions');
    if (r.controls && r.controls.b > vp.h + 1) bad.push('controls below viewport');
    note('2', `my turn problems ${vp.w}x${vp.h}`, bad);
    await p.page.getByTestId('coach-tip').click();
    await p.page.waitForTimeout(300);
    await shot(p.page, `2-coach-tip-${vp.w}x${vp.h}`);
    note('2', `coach tip text ${vp.w}x${vp.h}`, await p.page.getByTestId('coach-bar').innerText());
    const pick = p.page.locator('.act[data-coach-pick]');
    await p.page.getByTestId('coach-tip').click();
    if (await p.page.getByTestId('coach-sheet').isVisible().catch(() => false)) {
      await shot(p.page, `2-coach-why-${vp.w}x${vp.h}`);
      note('2', `coach why sheet ${vp.w}x${vp.h}`, { text: await p.page.getByTestId('coach-sheet').innerText(), rect: await rect(p.page, '[data-testid=coach-sheet]'), hand: r.hand });
      await p.page.getByRole('button', { name: /סגירה|Close/ }).click();
    }
    // follow the tip -> verdict; verdict must not cover hand
    if ((await pick.count()) === 1 && (await pick.isEnabled())) {
      await pick.click();
      await p.page.waitForTimeout(500);
      const v = await rect(p.page, '[data-testid=coach-verdict]');
      const h = await rect(p.page, '.me-zone .my-hands');
      note('2', `verdict vs hand ${vp.w}x${vp.h}`, { verdict: v, hand: h, covers: v && h ? !(v.b <= h.t || v.t >= h.b || v.r <= h.l || v.l >= h.r) : null });
      await shot(p.page, `2-verdict-${vp.w}x${vp.h}`);
    }
    await finishHand(p.page);
    await p.page.waitForTimeout(900);
    await shot(p.page, `2-result-${vp.w}x${vp.h}`);
    const res = await rect(p.page, '[data-testid=result-panel]');
    note('2', `result panel ${vp.w}x${vp.h}`, { res, fits: res ? res.b <= vp.h + 1 && res.r <= vp.w + 1 : null, overflow: await overflow(p.page), text: await p.page.getByTestId('result-panel').innerText() });
    note('2', `errors ${vp.w}x${vp.h}`, p.errors);
    await p.ctx.close();
  });
}

// ---------------------------------------------------------------- 3. English
test('3 english locale: lobby, practice table, coach sheet, result, guide, settings, unreachable-server screen', async ({ browser }) => {
  const p = await mk(browser, { w: 390, h: 844 }, { locale: 'en-US' });
  await onboard(p, 'Maya Cohen');
  await p.page.goto('/#/settings');
  await p.page.getByRole('button', { name: 'English' }).click();
  await p.page.waitForTimeout(400);
  await shot(p.page, '3-settings-en');
  note('3', 'settings he-chars', await hebrew(p.page));
  await p.page.goto('/#/home');
  await p.page.waitForTimeout(500);
  await shot(p.page, '3-lobby-en');
  note('3', 'lobby he-chars', await hebrew(p.page));
  note('3', 'lobby text', await text(p.page));
  note('3', 'lobby dir/lang', await p.page.evaluate(() => ({ dir: document.documentElement.dir, lang: document.documentElement.lang })));
  note('3', 'lobby overflow', await overflow(p.page));
  await p.page.getByTestId('play-friends').click();
  await p.page.waitForTimeout(300);
  await shot(p.page, '3-create-sheet-en');
  note('3', 'create sheet he-chars', await hebrew(p.page));
  await p.page.keyboard.press('Escape');
  await practiceTurn(p.page);
  await p.page.waitForTimeout(1200);
  await shot(p.page, '3-table-myturn-en');
  note('3', 'table he-chars', await hebrew(p.page));
  note('3', 'table text', await text(p.page));
  note('3', 'table overflow', await overflow(p.page));
  await p.page.getByTestId('coach-tip').click();
  await p.page.getByTestId('coach-tip').click();
  await p.page.waitForTimeout(300);
  await shot(p.page, '3-coach-sheet-en');
  note('3', 'coach sheet he-chars', await hebrew(p.page));
  note('3', 'coach text', await p.page.getByTestId('coach-bar').innerText());
  await p.page.getByRole('button', { name: /Close/ }).click().catch(() => {});
  await finishHand(p.page);
  await p.page.waitForTimeout(900);
  await shot(p.page, '3-result-en');
  note('3', 'result he-chars', await hebrew(p.page));
  note('3', 'result text', await p.page.getByTestId('result-panel').innerText());
  await p.page.goto('/#/guide');
  await p.page.waitForTimeout(500);
  await shot(p.page, '3-guide-en');
  note('3', 'guide he-chars', await hebrew(p.page));
  note('3', 'guide overflow', await overflow(p.page));
  await p.page.screenshot({ path: `${DIR}/3-guide-en-full.jpg`, type: 'jpeg', quality: 40, fullPage: true });
  // unreachable (unknown server kind, then online/lan)
  for (const kind of ['unknown', 'online', 'lan'] as const) {
    const q = await mk(browser, { w: 390, h: 844 }, { locale: 'en-US' });
    await q.page.addInitScript(() => localStorage.setItem('t21:prefs', JSON.stringify({ locale: 'en' })));
    let down = false;
    await q.ctx.route('**/api/**', (route) => {
      if (down) return route.abort('connectionrefused');
      if (kind !== 'unknown' && new URL(route.request().url()).pathname === '/api/config') return route.fulfill({ json: { deployment: kind, ads: { enabled: false }, avatars: [], leaderboardMinHands: 20, build: 'test', commit: null, builtAt: null, protocol: 1 } });
      return route.continue();
    });
    if (kind !== 'unknown') {
      await q.page.goto('/');
      await q.page.waitForTimeout(800);
    }
    down = true;
    await q.page.goto('/');
    await expect(q.page.getByTestId('waking')).toBeVisible({ timeout: 15_000 });
    await q.page.waitForTimeout(1500);
    await shot(q.page, `3-unreachable-${kind}-en`);
    const t = await q.page.getByTestId('waking').innerText();
    note('3', `unreachable ${kind} (locale from prefs) text`, { t, hebrew: await hebrew(q.page), pct: /%|percent/i.test(t), kindAttr: await q.page.getByTestId('waking').getAttribute('data-kind'), overflow: await overflow(q.page) });
    await q.ctx.close();
  }
  note('3', 'errors', p.errors);
  await p.ctx.close();
});

// ---------------------------------------------------------------- 4. mute + reduced motion
async function soundLog(page: Page) {
  return page.evaluate(() => [...(((window as any).__t21soundLog as { s: string }[]) ?? [])].map((e) => e.s));
}
async function animStats(page: Page, ms: number) {
  return page.evaluate(
    (dur) =>
      new Promise<{ maxEnd: number; count: number; infinite: number; names: string[] }>((res) => {
        let maxEnd = 0;
        let count = 0;
        let infinite = 0;
        const seen = new Set<Animation>();
        const names = new Set<string>();
        const t0 = performance.now();
        const tick = () => {
          for (const a of document.getAnimations()) {
            if (seen.has(a)) continue;
            seen.add(a);
            const t = a.effect?.getComputedTiming();
            count++;
            if (t && t.endTime === Infinity) infinite++;
            else if (t) maxEnd = Math.max(maxEnd, Number(t.endTime));
            names.add((a as CSSAnimation).animationName ?? (a as CSSTransition).transitionProperty ?? 'waapi');
          }
          if (performance.now() - t0 < dur) requestAnimationFrame(tick);
          else res({ maxEnd, count, infinite, names: [...names].slice(0, 12) });
        };
        tick();
      }),
    ms,
  );
}
test('4 mute and reduced motion: still playable, no sound events when muted, shorter animations when reduced', async ({ browser }) => {
  // baseline: sound on
  const on = await mk(browser);
  await onboard(on, 'Sound');
  await practiceTurn(on.page);
  await finishHand(on.page);
  await on.page.waitForTimeout(500);
  const logOn = await soundLog(on.page);
  note('4', 'baseline sound-on events in one hand', logOn);
  await on.ctx.close();

  // muted via Settings
  const m = await mk(browser);
  await onboard(m, 'Muted');
  await m.page.goto('/#/settings');
  const sound = m.page.locator('label.check', { hasText: /צליל|Sound/ }).first().locator('input');
  await sound.uncheck();
  await shot(m.page, '4-settings-muted');
  note('4', 'sound checkbox after uncheck', await sound.isChecked());
  await practiceTurn(m.page);
  await finishHand(m.page);
  await m.page.getByTestId('next-round').click();
  await m.page.waitForTimeout(600);
  const logMuted = await soundLog(m.page);
  note('4', 'muted: sound events after a hand + next round', logMuted);
  await shot(m.page, '4-muted-table');
  note('4', 'muted errors', m.errors);
  // online room mute-all button exists
  await m.ctx.close();

  // reduced motion via emulation (system)
  const r = await mk(browser, { w: 390, h: 844 }, { reducedMotion: 'reduce' });
  await onboard(r, 'Reduced');
  await r.page.goto('/#/practice');
  await r.page.locator('.stake-chip').first().waitFor();
  await r.page.locator('.stake-chip').first().click();
  const statsPromise = animStats(r.page, 3500);
  await r.page.getByTestId('deal').click();
  const rs = await statsPromise;
  note('4', 'prefers-reduced-motion (emulated): animations seen during deal', rs);
  note('4', 'reduced: html data-motion', await r.page.evaluate(() => document.documentElement.dataset.motion));
  await expect(r.page.locator('.my-hands .card')).toHaveCount(2);
  await shot(r.page, '4-reduced-emulated-dealt');
  await finishHand(r.page);
  await shot(r.page, '4-reduced-emulated-result');
  note('4', 'reduced emulated errors', r.errors);
  await r.ctx.close();

  // full motion baseline
  const f = await mk(browser);
  await onboard(f, 'Full');
  await f.page.goto('/#/practice');
  await f.page.locator('.stake-chip').first().waitFor();
  await f.page.locator('.stake-chip').first().click();
  const fp = animStats(f.page, 3500);
  await f.page.getByTestId('deal').click();
  const fs = await fp;
  note('4', 'full motion: animations seen during deal', fs);
  note('4', 'full: html data-motion', await f.page.evaluate(() => document.documentElement.dataset.motion));
  await f.ctx.close();

  // in-app setting
  const s = await mk(browser);
  await onboard(s, 'InApp');
  await s.page.goto('/#/settings');
  await s.page.locator('.segmented button', { hasText: /מופחת|צמצום|Reduced/ }).first().click();
  await shot(s.page, '4-settings-reduced');
  note('4', 'in-app reduced: html data-motion', await s.page.evaluate(() => document.documentElement.dataset.motion));
  await s.page.goto('/#/practice');
  await s.page.locator('.stake-chip').first().waitFor();
  await s.page.locator('.stake-chip').first().click();
  const sp = animStats(s.page, 3500);
  await s.page.getByTestId('deal').click();
  note('4', 'in-app reduced: animations seen during deal', await sp);
  await finishHand(s.page);
  note('4', 'in-app reduced errors', s.errors);
  await s.ctx.close();
});

// ---------------------------------------------------------------- 5. failing asset load
test('5 failing assets: block /art/** and fonts; table stays usable, no blank cards or invisible buttons', async ({ browser }) => {
  for (const vp of [{ w: 390, h: 844 }, { w: 844, h: 390 }]) {
    const p = await mk(browser, vp);
    const blocked: string[] = [];
    await p.ctx.route(/\/art\/|\.(woff2?|ttf|otf)(\?|$)|fonts\.(googleapis|gstatic)\.com/, (r) => (blocked.push(new URL(r.request().url()).pathname), r.abort('failed')));
    await onboard(p, 'Assets');
    await p.page.waitForTimeout(500);
    await shot(p.page, `5-lobby-blocked-${vp.w}x${vp.h}`);
    await practiceTurn(p.page);
    await p.page.waitForTimeout(1200);
    await shot(p.page, `5-myturn-blocked-${vp.w}x${vp.h}`);
    const probe = await p.page.evaluate(() => {
      const vis = (e: Element) => {
        const b = e.getBoundingClientRect();
        const cs = getComputedStyle(e);
        return b.width > 4 && b.height > 4 && cs.visibility !== 'hidden' && cs.opacity !== '0';
      };
      const cards = [...document.querySelectorAll('.my-hands .card, .dealer-cards .card')].filter(vis);
      const faceCards = cards.filter((c) => !c.classList.contains('card-back') && !c.querySelector('.card-back') && !/hidden|back/.test(c.className));
      const blank = faceCards.filter((c) => (c.textContent ?? '').trim().length === 0 && !c.querySelector('svg,img'));
      const acts = [...document.querySelectorAll('.actions .act')].map((e) => {
        const cs = getComputedStyle(e);
        const b = e.getBoundingClientRect();
        return { t: (e.textContent ?? '').trim(), w: Math.round(b.width), h: Math.round(b.height), color: cs.color, bg: cs.backgroundColor, bgImg: cs.backgroundImage.slice(0, 40), op: cs.opacity };
      });
      return { cards: cards.length, faceCards: faceCards.length, blank: blank.length, acts, font: getComputedStyle(document.body).fontFamily.slice(0, 80) };
    });
    note('5', `blocked ${vp.w}x${vp.h} probe`, probe);
    note('5', `blocked ${vp.w}x${vp.h} requests aborted (count, sample)`, { n: blocked.length, sample: [...new Set(blocked)].slice(0, 8) });
    await finishHand(p.page);
    await shot(p.page, `5-result-blocked-${vp.w}x${vp.h}`);
    note('5', `blocked ${vp.w}x${vp.h} overflow`, await overflow(p.page));
    note('5', `blocked ${vp.w}x${vp.h} errors`, p.errors.slice(0, 6));
    await p.ctx.close();
  }
});

// ---------------------------------------------------------------- 7. guest vs account restore
test('7 guest creates recovery codes, second context restores and sees the same balance', async ({ browser }) => {
  const a = await mk(browser);
  await onboard(a, 'עוז');
  await a.page.getByTestId('home-save').click();
  await a.page.getByTestId('create-codes').click();
  await expect(a.page.getByTestId('recovery-codes').locator('li')).toHaveCount(8);
  const codes = await a.page.getByTestId('recovery-codes').locator('li').allTextContents();
  await shot(a.page, '7-codes-guest');
  await a.page.getByTestId('codes-saved').check();
  await a.page.getByRole('button', { name: 'סגירה' }).click();
  const balA = await a.page.evaluate(() => fetch('/api/me').then((r) => r.json()).then((m) => ({ id: m.id ?? m.userId, name: m.name, units: m.wallet.availableUnits })));
  const b = await mk(browser);
  await b.page.goto('/');
  await b.page.getByTestId('have-account').click();
  await shot(b.page, '7-signin-form');
  await b.page.getByTestId('signin-code').fill(codes[0]);
  await b.page.getByTestId('signin-go').click();
  await expect(b.page.locator('.me-name')).toHaveText('עוז', { timeout: 10_000 });
  const balB = await b.page.evaluate(() => fetch('/api/me').then((r) => r.json()).then((m) => ({ id: m.id ?? m.userId, name: m.name, units: m.wallet.availableUnits })));
  note('7', 'balance guest vs restored', { balA, balB, same: JSON.stringify(balA) === JSON.stringify(balB) });
  await shot(b.page, '7-restored-lobby');
  // reuse of the same code in a third context
  const c = await mk(browser);
  await c.page.goto('/');
  await c.page.getByTestId('have-account').click();
  await c.page.getByTestId('signin-code').fill(codes[0]);
  await c.page.getByTestId('signin-go').click();
  await c.page.waitForTimeout(1500);
  note('7', 'reusing a used recovery code: lobby name shown / page text', { name: await c.page.locator('.me-name').textContent({ timeout: 1500 }).catch(() => null), text: await text(c.page) });
  await shot(c.page, '7-code-reuse');
  // wrong code
  const d = await mk(browser);
  await d.page.goto('/');
  await d.page.getByTestId('have-account').click();
  await d.page.getByTestId('signin-code').fill('AAAA-BBBB-CCCC');
  await d.page.getByTestId('signin-go').click();
  await d.page.waitForTimeout(1200);
  note('7', 'wrong recovery code: text', await text(d.page));
  await shot(d.page, '7-code-wrong');
  for (const x of [a, b, c, d]) await x.ctx.close();
});

// ---------------------------------------------------------------- 9. new pieces: long names / large balances / gold / lobby / landscape cards
test('9 long names, large balances, gold discipline, landscape card sizes', async ({ browser }) => {
  const wide = 'מ'.repeat(20);
  const wideEn = 'W'.repeat(20);
  for (const vp of VPS) {
    const p = await mk(browser, vp);
    await p.ctx.route('**/api/me', async (route) => {
      const r = await route.fetch();
      if (!r.ok()) return route.fulfill({ response: r });
      const j = await r.json();
      if (j?.wallet) j.wallet.availableUnits = 9_999_999 * 2;
      return route.fulfill({ response: r, json: j });
    });
    await onboard(p, wide);
    await p.page.waitForTimeout(500);
    await shot(p.page, `9-lobby-longname-bigbal-${vp.w}x${vp.h}`);
    note('9', `lobby long he name + 9,999,999 ${vp.w}x${vp.h}`, { overflow: await overflow(p.page), chip: await rect(p.page, '.me-chip'), text: await p.page.locator('.me-chip').innerText() });
    await p.ctx.close();
  }
  // en W*20 + practice with big local balance
  const e = await mk(browser, { w: 360, h: 640 });
  await onboard(e, wideEn);
  await e.page.evaluate(
    (u) =>
      new Promise<void>((res, rej) => {
        const req = indexedDB.open('keyval-store');
        req.onupgradeneeded = () => req.result.createObjectStore('keyval');
        req.onsuccess = () => {
          const tx = req.result.transaction('keyval', 'readwrite');
          tx.objectStore('keyval').put({ name: 'W'.repeat(20), avatar: 'amber', practiceUnits: u, passPlayers: [] }, 't21:local');
          tx.oncomplete = () => res();
          tx.onerror = () => rej(tx.error);
        };
      }),
    9_999_999 * 2,
  );
  await practiceTurn(e.page);
  await e.page.waitForTimeout(1000);
  await shot(e.page, '9-practice-bigbal-360x640');
  note('9', 'practice big balance 360x640', { overflow: await overflow(e.page), head: await e.page.locator('.room-head').innerText().catch(() => null) });
  await e.ctx.close();

  // gold discipline during bet and result (practice, 390x844)
  const g = await mk(browser, { w: 390, h: 844 });
  await onboard(g, 'Gold');
  const goldProbe = (page: Page) =>
    page.evaluate(() => {
      const isGold = (css: string) => {
        const m = css.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)/g) ?? [];
        return m.some((c) => {
          const [r, gg, b] = c.match(/\d+/g)!.slice(0, 3).map(Number);
          return r > 150 && gg > 105 && b < 110 && r > gg && gg > b;
        });
      };
      return [...document.querySelectorAll('button, .btn, a.btn')]
        .filter((e) => e.getBoundingClientRect().width > 0)
        .map((e) => {
          const cs = getComputedStyle(e);
          return { t: (e.textContent ?? '').trim().slice(0, 20), cls: e.className.toString().slice(0, 40), gold: isGold(cs.backgroundColor + ' ' + cs.backgroundImage) };
        })
        .filter((x) => x.gold);
    });
  await g.page.goto('/#/practice');
  await g.page.locator('.stake-chip').first().waitFor();
  note('9', 'gold buttons: bet stage before chip', await goldProbe(g.page));
  await g.page.locator('.stake-chip').first().click();
  note('9', 'gold buttons: bet stage after chip', await goldProbe(g.page));
  await g.page.getByTestId('deal').click();
  await g.page.locator('.act-stand:not([disabled])').waitFor({ timeout: 8000 }).catch(() => {});
  await g.page.waitForTimeout(1200);
  note('9', 'gold buttons: my turn', await goldProbe(g.page));
  await finishHand(g.page);
  await g.page.waitForTimeout(800);
  note('9', 'gold buttons: result', await goldProbe(g.page));
  await g.ctx.close();

  // landscape card sizes
  for (const vp of VPS) {
    const p = await mk(browser, vp);
    await onboard(p, 'Cards');
    await practiceTurn(p.page);
    await p.page.waitForTimeout(1000);
    note('9', `card sizes ${vp.w}x${vp.h}`, { my: await rect(p.page, '.my-hands .card'), dealer: await rect(p.page, '.dealer-cards .card'), felt: await rect(p.page, '.room > .felt'), rail: await rect(p.page, '.rail, .felt-rail, [class*=rail]') });
    await p.ctx.close();
  }
});
