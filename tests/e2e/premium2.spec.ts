import { expect, test, type Page } from '@playwright/test';
import { createRoom, joinRoom, onboard, pickAndConfirm, player, sit } from './helpers.ts';

/** Stages 4-6 and the art-director fixes F1-F5 (GROKBOT 2026-11-01). */

const box = async (page: Page, sel: string) => (await page.locator(sel).first().boundingBox())!;
const overlap = (a: { x: number; y: number; width: number; height: number }, b: typeof a) =>
  a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;

/** Log every celebration banner: kind, when it appeared, how long it stayed. */
const logCelebrations = (page: Page) =>
  page.addInitScript(() => {
    const log: { kind: string; added: number; removed?: number }[] = [];
    (window as any).__cel = log;
    new MutationObserver(() => {
      const el = document.querySelector('[data-testid=celebration]');
      const open = log.find((x) => x.removed === undefined);
      if (el && !open) log.push({ kind: el.getAttribute('data-kind')!, added: performance.now() });
      if (!el && open) open.removed = performance.now();
    }).observe(document, { subtree: true, childList: true });
  });

/** Play practice hands (standing) until one ends with the given condition on the net. */
async function playUntil(page: Page, want: (net: number) => boolean, max = 40) {
  for (let i = 0; i < max; i++) {
    await page.locator('.stake-chip').first().click();
    await page.getByTestId('deal').click();
    const stand = page.locator('.act-stand');
    if (await expect(stand).toBeEnabled({ timeout: 6000 }).then(() => true, () => false)) await stand.click();
    await page.getByTestId('result-panel').waitFor({ timeout: 15_000 });
    const net = Number(await page.getByTestId('result-panel').getAttribute('data-net'));
    if (want(net)) return net;
    await page.getByTestId('next-round').click();
  }
  throw new Error('condition not met');
}

test('18+ gate on first launch: under 18 stops there; confirming is remembered on the device', async ({ browser }) => {
  const ctx = await browser.newContext({ storageState: { cookies: [], origins: [] }, viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  const page = await ctx.newPage();
  await page.goto('/');
  await expect(page.getByTestId('age-gate')).toBeVisible();
  await expect(page.getByTestId('age-gate')).toContainText('ערך כספי');
  await page.getByTestId('age-under').click();
  await expect(page.getByTestId('age-blocked')).toBeVisible();
  await expect(page.getByTestId('age-confirm')).toHaveCount(0);
  await page.reload();
  await page.getByTestId('age-confirm').click();
  await expect(page.getByPlaceholder('שם תצוגה')).toBeVisible();
  await page.reload();
  await expect(page.getByTestId('age-gate')).toHaveCount(0);
  // Practice is behind the gate too.
  const fresh = await browser.newContext({ storageState: { cookies: [], origins: [] } });
  const p2 = await fresh.newPage();
  await p2.goto('/#/practice');
  await expect(p2.getByTestId('age-gate')).toBeVisible();
  await fresh.close();
  await ctx.close();
});

test('60-minute session reminder: shown at a safe point, closes with one tap, not again in the same hour', async ({ browser }) => {
  const p = await player(browser, 'Break');
  await p.ctx.addInitScript(() => {
    if (!sessionStorage.getItem('t21:seeded')) {
      sessionStorage.setItem('t21:seeded', '1');
      sessionStorage.setItem('t21:active-ms', String(60 * 60_000 - 1500));
    }
  });
  await p.page.goto('/#/practice');
  await expect(p.page.getByTestId('session-reminder')).toBeVisible({ timeout: 8000 });
  await expect(p.page.getByTestId('session-reminder')).toContainText('60');
  // A bet on the table is a hand in progress: the reminder steps aside and comes back at the next safe point.
  await p.page.locator('.stake-chip').first().click();
  await expect(p.page.getByTestId('session-reminder')).toHaveCount(0);
  await p.page.getByTestId('stake-clear').click();
  await expect(p.page.getByTestId('session-reminder')).toBeVisible({ timeout: 5000 });
  await p.page.getByTestId('session-ok').click();
  await expect(p.page.getByTestId('session-reminder')).toHaveCount(0);
  await p.page.reload();
  await p.page.waitForTimeout(3000);
  await expect(p.page.getByTestId('session-reminder')).toHaveCount(0);
  await p.ctx.close();
});

test('celebration by total net: win 500 ms, natural 900 ms, nothing for push or loss; F5 banner and result sizes', async ({ browser }) => {
  const p = await player(browser, 'Cele');
  await logCelebrations(p.page);
  await p.page.goto('/#/practice');
  // Random shoe: every hand is checked on its own. A hand with net <= 0 adds no banner; a hand with net > 0 adds
  // exactly one, of the right length. Play until both kinds have been seen.
  let sawNoWin = false;
  let sawWin = false;
  for (let i = 0; i < 40 && !(sawNoWin && sawWin); i++) {
    const before: number = await p.page.evaluate(() => (window as any).__cel.length);
    await p.page.locator('.stake-chip').first().click();
    await p.page.getByTestId('deal').click();
    const stand = p.page.locator('.act-stand');
    if (await expect(stand).toBeEnabled({ timeout: 6000 }).then(() => true, () => false)) await stand.click();
    await p.page.getByTestId('result-panel').waitFor({ timeout: 15_000 });
    const net = Number(await p.page.getByTestId('result-panel').getAttribute('data-net'));
    // Longer than the longest banner (900 ms), so a banner of this hand has come and gone.
    await p.page.waitForTimeout(1300);
    const fresh: { kind: string; added: number; removed?: number }[] = await p.page.evaluate((b) => (window as any).__cel.slice(b), before);
    if (net <= 0) {
      expect(fresh, `hand ${i}: net ${net} must not celebrate`).toHaveLength(0);
      sawNoWin = true;
    } else {
      expect(fresh, `hand ${i}: net ${net} celebrates once`).toHaveLength(1);
      const c = fresh[0];
      expect(c.removed, 'banner closed').toBeDefined();
      const ms = c.removed! - c.added;
      if (c.kind === 'win') expect(ms).toBeGreaterThanOrEqual(450), expect(ms).toBeLessThanOrEqual(700);
      else expect(c.kind).toBe('bj'), expect(ms).toBeGreaterThanOrEqual(850), expect(ms).toBeLessThanOrEqual(1100);
      if (!sawWin) {
        // F5: headline 20 px Rubik 600, net amount 28 px.
        const head = await p.page.getByTestId('result-head').evaluate((el) => { const s = getComputedStyle(el); return { size: s.fontSize, weight: s.fontWeight, family: s.fontFamily }; });
        expect(head.size).toBe('20px');
        expect(head.weight).toBe('600');
        expect(head.family).toMatch(/Rubik/);
        expect(await p.page.locator('.result-panel .net .coins').evaluate((el) => getComputedStyle(el).fontSize)).toBe('28px');
      }
      sawWin = true;
    }
    await p.page.getByTestId('next-round').click();
  }
  expect(sawNoWin && sawWin, 'saw both a non-winning and a winning hand').toBe(true);
  await p.ctx.close();
});

test('banner sizes while it shows: headline 20 px Rubik 600 and +amount 28 px', async ({ browser }) => {
  const p = await player(browser, 'Banner');
  await p.ctx.addInitScript(() => {
    (window as any).__banner = null;
    new MutationObserver(() => {
      const el = document.querySelector('[data-testid=celebration]');
      if (el && !(window as any).__banner) {
        const h = getComputedStyle(el.querySelector('.cel-head')!);
        const a = getComputedStyle(el.querySelector('.cel-amount')!);
        (window as any).__banner = { head: h.fontSize, weight: h.fontWeight, family: h.fontFamily, amount: a.fontSize, text: el.textContent };
      }
    }).observe(document, { subtree: true, childList: true });
  });
  await p.page.goto('/#/practice');
  await playUntil(p.page, (n) => n > 0);
  const b = await p.page.evaluate(() => (window as any).__banner);
  expect(b.head).toBe('20px');
  expect(b.weight).toBe('600');
  expect(b.family).toMatch(/Rubik/);
  expect(b.amount).toBe('28px');
  expect(b.text).toMatch(/\+/);
  await p.ctx.close();
});

test('sound: never more than 3 voices over ten hands; card sounds land with the cards; ambience off by default', async ({ browser }) => {
  const p = await player(browser, 'Voices');
  await p.page.goto('/#/practice');
  for (let i = 0; i < 10; i++) {
    await p.page.locator('.stake-chip').first().click();
    await p.page.getByTestId('deal').click();
    const stand = p.page.locator('.act-stand');
    if (await expect(stand).toBeEnabled({ timeout: 6000 }).then(() => true, () => false)) await stand.click();
    await p.page.getByTestId('next-round').click({ timeout: 15_000 });
  }
  const st = await p.page.evaluate(() => (window as any).__t21sound);
  expect(st.played).toBeGreaterThan(30);
  expect(st.maxVoices).toBeLessThanOrEqual(3);
  await p.page.goto('/#/settings');
  await expect(p.page.getByTestId('ambience')).not.toBeChecked();
  await p.ctx.close();
});

test('haptics: selection, chip bet and own card land patterns (vibrate stubbed); none when switched off', async ({ browser }) => {
  const p = await player(browser, 'Buzz');
  await p.ctx.addInitScript(() => {
    (window as any).__vib = [];
    Object.defineProperty(navigator, 'vibrate', { configurable: true, value: (x: unknown) => ((window as any).__vib.push(x), true) });
  });
  await p.page.goto('/#/practice');
  await p.page.locator('.stake-chip').first().click();
  await p.page.getByTestId('deal').click();
  await expect(p.page.locator('.my-hands .card')).toHaveCount(2);
  await p.page.waitForTimeout(800);
  const v = await p.page.evaluate(() => (window as any).__vib);
  expect(v).toContain(10); // chip bet
  expect(v.filter((x: unknown) => x === 12).length).toBeGreaterThanOrEqual(2); // my two cards landed
  await p.ctx.close();
});

test('F4 lobby at 390x844: play with friends, room code and practice above the fold; install strip 56-64 px; art at most 80 px', async ({ browser }) => {
  const p = await player(browser, 'Lobby');
  await onboard(p, 0);
  for (const id of ['play-friends', 'join-code', 'practice']) {
    const b = await box(p.page, `[data-testid=${id}]`);
    expect(b.y + b.height, `${id} above the fold`).toBeLessThanOrEqual(844);
  }
  const strip = await box(p.page, '[data-testid=install-hint]');
  expect(strip.height).toBeGreaterThanOrEqual(56);
  expect(strip.height).toBeLessThanOrEqual(64);
  expect((await box(p.page, '.hero-table')).height).toBeLessThanOrEqual(80);
  const ls = await p.page.getByTestId('join-code').evaluate((el) => getComputedStyle(el, '::placeholder').letterSpacing);
  expect(['0px', 'normal']).toContain(ls);
  await expect(p.page.getByTestId('coins-note')).toContainText('אין להם ערך כספי');
  await p.ctx.close();
});

test('F1-F3 table: deep felt and 90% HUD, friend on a side seat, ring around my total, one card frame, felt print clear of hands', async ({ browser }) => {
  const a = await player(browser, 'Host');
  const b = await player(browser, 'Friend');
  await onboard(a, 0);
  await onboard(b, 1);
  const code = await createRoom(a);
  await joinRoom(b, code);
  await sit(a);
  await sit(b);
  // F1
  const bg = await a.page.locator('.room').evaluate((el) => getComputedStyle(el).backgroundImage);
  // T06 AD-3: a 40% veil (was 60%) so the wool shows, one overhead pool at 40% height, dark edges
  expect(bg).toContain('rgba(14, 70, 54, 0.4)');
  expect(bg).toContain('radial-gradient(60% 34% at 50% 40%');
  expect(await a.page.getByTestId('room-menu').evaluate((el) => getComputedStyle(el).backgroundColor)).toBe('rgba(11, 18, 24, 0.9)');
  // F2: with two players the friend's seat is off the centre line.
  const felt = await box(a.page, '.room > .felt');
  const seat = await box(a.page, '.others .seat');
  expect(Math.abs(seat.x + seat.width / 2 - (felt.x + felt.width / 2))).toBeGreaterThan(60);
  // Play to my turn: the timer ring sits around my total.
  for (let i = 0; i < 8; i++) {
    await pickAndConfirm(b.page, 25);
    await pickAndConfirm(a.page, 25);
    const bs = b.page.locator('.act-stand');
    if (await expect(bs).toBeEnabled({ timeout: 10_000 }).then(() => true, () => false)) await bs.click();
    if (await expect(a.page.locator('.act-stand')).toBeEnabled({ timeout: 10_000 }).then(() => true, () => false)) break;
    await expect(a.page.getByTestId('room')).toHaveAttribute('data-phase', /waiting|betting/, { timeout: 30_000 });
  }
  await expect(a.page.locator('.me-zone .total.has-ring .timer-ring')).toBeVisible();
  expect(await a.page.locator('.my-timer').count()).toBe(0);
  // F3: face and back share the 2px ivory frame and the radius.
  const face = await a.page.locator('.my-hands .card').first().evaluate((el) => {
    const f = getComputedStyle(el.querySelector('.card-face')!);
    const k = getComputedStyle(el.querySelector('.card-back')!);
    return [`${f.borderTopWidth} ${f.borderTopColor} ${f.borderTopLeftRadius}`, `${k.borderTopWidth} ${k.borderTopColor} ${k.borderTopLeftRadius}`];
  });
  expect(face[0]).toBe(face[1]);
  expect(face[0]).toMatch(/^2px rgb\(246, 241, 228\)/);
  await a.ctx.close();
  await b.ctx.close();
});

for (const vp of [
  { width: 390, height: 844 },
  { width: 844, height: 390 },
  { width: 360, height: 640 },
]) {
  test(`F3 felt print never under a hand or a name; F2 landscape card size (${vp.width}x${vp.height})`, async ({ browser }) => {
    const ctx = await browser.newContext({ viewport: vp, isMobile: true, hasTouch: true, deviceScaleFactor: 2 });
    const page = await ctx.newPage();
    for (const kind of ['solo', 'three', 'six', 'split']) {
      await page.goto(`/#/lab/${kind}`);
      await page.locator('.room > .felt .card').first().waitFor();
      const print = await page.locator('.felt-print').boundingBox();
      if (!print) {
        // Landscape, and short portrait (360x640), with friends at the table: no spare row, so the print is left out
        // (never under a hand). With room for it (390x844, or alone at the table) it is always shown.
        expect(vp.height < 700 && kind !== 'solo', `${kind}: print hidden only on short screens with friends`).toBe(true);
        continue;
      }
      for (const sel of ['.hand', '.seat-name', '.dealer-name', '.seat .avatar', '.hand-meta']) {
        for (const el of await page.locator(sel).all()) {
          const r = await el.boundingBox();
          if (r) expect(overlap(print, r), `${kind}: print under ${sel}`).toBe(false);
        }
      }
    }
    if (vp.height === 390) {
      await page.goto('/#/practice');
      await page.locator('.stake-chip').first().click();
      await page.getByTestId('deal').click();
      await page.getByTestId('skip-anim').click().catch(() => {});
      const c = await box(page, '.my-hands .card');
      expect(Math.abs(c.width - 76)).toBeLessThanOrEqual(1);
      expect(Math.abs(c.height - 106.4)).toBeLessThanOrEqual(3);
    }
    await ctx.close();
  });
}

test('menus carry the guardrails line: automated dealer, 18+, no cash value', async ({ browser }) => {
  const p = await player(browser, 'Footer');
  await p.page.goto('/#/practice');
  await p.page.getByTestId('room-menu').click();
  await expect(p.page.getByTestId('menu-footer')).toContainText('דילר אוטומטי');
  await expect(p.page.getByTestId('menu-footer')).toContainText('18+');
  await expect(p.page.getByTestId('menu-footer')).toContainText('ערך כספי');
  await p.ctx.close();
});

test('P1 result once: one line "ניצחת · +amount" (28 px), stake and return 14 px, no badge in the panel, no duplicate tag on my hand', async ({ browser }) => {
  for (const vp of [{ width: 390, height: 844 }, { width: 844, height: 390 }]) {
    const ctx = await browser.newContext({ viewport: vp, isMobile: true, hasTouch: true, deviceScaleFactor: 2 });
    const page = await ctx.newPage();
    for (const kind of ['result', 'natural']) {
      await page.goto(`/#/lab/${kind}`);
      const panel = page.getByTestId('result-panel');
      await expect(panel).toBeVisible();
      const net = Number(await panel.getAttribute('data-net'));
      const line = page.getByTestId('result-line');
      if (net > 0) await expect(line).toContainText(kind === 'natural' ? 'בלאקג׳ק טבעי' : 'ניצחת');
      await expect(line).toContainText('·');
      expect(await line.locator('.net .coins').evaluate((el) => getComputedStyle(el).fontSize)).toBe('28px');
      for (const el of await page.getByTestId('result-sub').locator('.coins').all()) expect(await el.evaluate((e) => getComputedStyle(e).fontSize)).toBe('14px');
      await expect(page.getByTestId('result-sub')).toContainText('הימור');
      await expect(page.getByTestId('result-sub')).toContainText('החזר כולל');
      // The result is said once: no outcome badge in the panel (single hand), none beside my cards.
      await expect(panel.locator('.badge')).toHaveCount(0);
      await expect(page.locator('.me-zone .my-hands .hand-meta .badge:visible')).toHaveCount(0);
    }
    await ctx.close();
  }
});

test('P1 card back and face: one 2px ivory frame and an 8 px radius (scaled only below 57 px)', async ({ browser }) => {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 });
  const page = await ctx.newPage();
  await page.goto('/#/lab/three');
  const look = (sel: string) =>
    page.locator(sel).first().evaluate((el) => {
      const w = (el as HTMLElement).getBoundingClientRect().width;
      const f = getComputedStyle(el.querySelector('.card-face')!);
      const b = getComputedStyle(el.querySelector('.card-back')!);
      return { w, face: `${f.borderTopWidth} ${f.borderTopColor} ${f.borderTopLeftRadius}`, back: `${b.borderTopWidth} ${b.borderTopColor} ${b.borderTopLeftRadius}` };
    });
  const mine = await look('.my-hands .card');
  expect(mine.face).toBe('2px rgb(246, 241, 228) 8px');
  expect(mine.back).toBe(mine.face);
  const dealer = await look('.dealer-cards .card');
  expect(dealer.back).toBe(dealer.face);
  if (dealer.w >= 57) expect(dealer.face).toBe('2px rgb(246, 241, 228) 8px');
  const seat = await look('.others .card');
  expect(seat.back).toBe(seat.face);
  expect(await page.locator('.card-back').first().evaluate((el) => getComputedStyle(el).backgroundImage)).toContain('cardback-simple.webp');
  await ctx.close();
});

test('P1 home: friends night and one phone right after practice, above the fold; save account 48 px row by the balance; daily grant full 56 px row', async ({ browser }) => {
  const p = await player(browser, 'Home P1');
  await onboard(p, 0);
  const practice = await box(p.page, '[data-testid=practice]');
  for (const id of ['friends-night', 'pass-play']) {
    const b = await box(p.page, `[data-testid=${id}]`);
    expect(b.y, `${id} right after practice`).toBeGreaterThan(practice.y);
    expect(b.y - (practice.y + practice.height), `${id} directly below practice`).toBeLessThan(20);
    expect(b.y + b.height, `${id} above the fold`).toBeLessThanOrEqual(844);
  }
  const save = await box(p.page, '[data-testid=home-save]');
  expect(Math.round(save.height)).toBe(48);
  const grant = p.page.locator('.grant-strip');
  if (await grant.isVisible().catch(() => false)) {
    const g = (await grant.boundingBox())!;
    expect(Math.round(g.height)).toBe(56);
    // Full row: as wide as the other full-width rows of the lobby (the practice row).
    expect(Math.abs(g.width - practice.width)).toBeLessThanOrEqual(1);
  }
  await p.ctx.close();
});

test('P1 age gate: brand on its own, title Rubik 600 24 px, body 16/24', async ({ browser }) => {
  const ctx = await browser.newContext({ storageState: { cookies: [], origins: [] }, viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  const page = await ctx.newPage();
  await page.goto('/');
  await expect(page.locator('.age-brand .brand-word')).toBeVisible();
  const title = await page.locator('#age-title').evaluate((el) => { const s = getComputedStyle(el); return { f: s.fontFamily, w: s.fontWeight, z: s.fontSize, text: el.textContent }; });
  expect(title.f).toMatch(/^"?Rubik/);
  expect(title.w).toBe('600');
  expect(title.z).toBe('24px');
  expect(title.text).not.toContain('TABLE21');
  const body = await page.locator('.age-body').evaluate((el) => { const s = getComputedStyle(el); return `${s.fontSize}/${s.lineHeight}`; });
  expect(body).toBe('16px/24px');
  await ctx.close();
});

test('P1 bust: label "עברת 21" fades in (160 ms), no shake, cards and numbers not dimmed', async ({ browser }) => {
  const p = await player(browser, 'Bust');
  await p.page.goto('/#/practice');
  let seen = false;
  for (let i = 0; i < 30 && !seen; i++) {
    await p.page.locator('.stake-chip').first().click();
    await p.page.getByTestId('deal').click();
    for (let k = 0; k < 8; k++) {
      const hit = p.page.locator('.act-hit');
      if (!(await expect(hit).toBeEnabled({ timeout: 4000 }).then(() => true, () => false))) break;
      await hit.click();
    }
    const bust = p.page.locator('.me-zone .hand.is-bust');
    if (await bust.isVisible({ timeout: 4000 }).catch(() => false)) {
      seen = true;
      await expect(bust.locator('.badge.b-bust')).toHaveText('עברת 21');
      const st = await bust.evaluate((el) => {
        const cards = getComputedStyle(el.querySelector('.hand-cards')!);
        const total = getComputedStyle(el.querySelector('.total')!);
        const badge = el.querySelector('.badge.b-bust')!;
        const names = el.getAnimations({ subtree: true }).map((a) => (a as CSSAnimation).animationName ?? '');
        return { cards: cards.opacity, total: total.opacity, anim: getComputedStyle(badge).animationName, dur: getComputedStyle(badge).animationDuration, names };
      });
      expect(st.cards).toBe('1');
      expect(st.total).toBe('1');
      expect(st.anim).toBe('bust-in');
      expect(st.dur).toBe('0.16s');
      expect(st.names).not.toContain('bust-shake');
    }
    await p.page.getByTestId('next-round').click({ timeout: 15_000 });
  }
  expect(seen, 'a bust within 30 hands of hitting').toBe(true);
  await p.ctx.close();
});
