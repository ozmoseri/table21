import { expect, test, type Browser, type Page } from '@playwright/test';
import { createRoom, onboard, pickAndConfirm, player, playRound, sit, type Player } from './helpers.ts';

/*
 * T03 entry honesty: what the app says when the server cannot be reached (and that it is not the asset-loading
 * splash), what a wrong or expired room code does, and that the longest names and biggest balances stay inside the
 * screen. The "keyboard" is an emulation: shrinking the viewport height, as an on-screen keyboard does to the
 * visual viewport. It is not a physical keyboard on a phone.
 */

const SHOT_DIR = 'docs/screenshots/entry';
const VIEWPORTS = [
  { width: 360, height: 640 },
  { width: 390, height: 844 },
  { width: 844, height: 390 },
] as const;

const CONFIG = (deployment: 'lan' | 'online') => ({ deployment, ads: { enabled: false }, avatars: [], leaderboardMinHands: 20, build: 'test', commit: null, builtAt: null, protocol: 1 });

/** A context whose /api can be switched off; /api/config can answer as a LAN host or as the cloud pilot. */
async function reachability(browser: Browser, viewport: { width: number; height: number }, deployment: 'lan' | 'online' | null) {
  const ctx = await browser.newContext({ viewport, isMobile: true, hasTouch: true, deviceScaleFactor: 2, serviceWorkers: 'block' });
  const page = await ctx.newPage();
  const state = { down: false };
  await ctx.route('**/api/**', (route) => {
    if (state.down) return route.abort('connectionrefused');
    if (deployment && new URL(route.request().url()).pathname === '/api/config') return route.fulfill({ json: CONFIG(deployment) });
    return route.continue();
  });
  return { ctx, page, state };
}

async function noSideScroll(page: Page, label: string) {
  const over = await page.evaluate(() => document.documentElement.scrollWidth - innerWidth);
  expect(over, `${label}: no horizontal scroll`).toBeLessThanOrEqual(1);
}

async function insideScreen(page: Page, selector: string, label: string) {
  const vp = page.viewportSize()!;
  for (const el of await page.locator(selector).all()) {
    if (!(await el.isVisible())) continue;
    const b = (await el.boundingBox())!;
    expect(b.x, `${label}: ${selector} left`).toBeGreaterThanOrEqual(-1);
    expect(b.x + b.width, `${label}: ${selector} right`).toBeLessThanOrEqual(vp.width + 1);
    expect(b.y, `${label}: ${selector} top`).toBeGreaterThanOrEqual(-1);
    expect(b.y + b.height, `${label}: ${selector} bottom`).toBeLessThanOrEqual(vp.height + 1);
  }
}

test.describe('unreachable server', () => {
  for (const [kind, deployment, title, mustHave, mustNot] of [
    ['lan', 'lan', 'המחשב המארח לא עונה', ['דלוק', 'TABLE21', 'הקישור הציבורי'], ['נרדם', 'מתעורר']],
    ['online', 'online', 'השרת מתעורר', ['נרדם אחרי רבע שעה', 'כדקה'], ['המחשב המארח']],
  ] as const) {
    test(`${kind}: says what is true for this setup, no invented percentage, retry and practice stay`, async ({ browser }) => {
      const { ctx, page, state } = await reachability(browser, { width: 390, height: 844 }, deployment);
      await page.goto('/'); // reachable once: the device learns which kind of server this is
      await expect(page.getByPlaceholder('שם תצוגה')).toBeVisible();
      await expect.poll(() => page.evaluate(() => localStorage.getItem('t21:deployment'))).toBe(deployment);

      state.down = true;
      await page.reload();
      const waking = page.getByTestId('waking');
      await expect(waking).toBeVisible({ timeout: 15_000 });
      await expect(waking).toHaveAttribute('data-kind', deployment);
      await expect(page.getByTestId('waking-title')).toHaveText(title);
      const body = (await page.getByTestId('waking-body').textContent())!;
      for (const s of mustHave) expect(body).toContain(s);
      const all = (await waking.textContent())!;
      for (const s of mustNot) expect(all).not.toContain(s);

      // Honest progress: nothing that looks like a percentage, and no progressbar value.
      expect(all).not.toMatch(/%|\d+\s*אחוז/);
      const bar = page.getByRole('progressbar');
      await expect(bar).toHaveCount(1);
      for (const a of ['aria-valuenow', 'aria-valuemin', 'aria-valuemax']) expect(await bar.getAttribute(a)).toBeNull();
      expect(await bar.locator('i').evaluate((el) => (el as HTMLElement).style.width)).toBe('');
      // The only number is real elapsed seconds.
      await expect(page.getByTestId('waking-elapsed')).toContainText(/עברו \d+ שניות/, { timeout: 8000 });
      // This is the "server" state, not the "loading the game" splash: it says the game itself has loaded.
      await expect(page.getByTestId('waking-app-loaded')).toContainText('המשחק עצמו נטען');
      await expect(page.getByTestId('splash')).toHaveCount(0);

      await expect(page.getByTestId('waking-retry')).toBeVisible();
      await expect(page.getByTestId('waking-practice')).toBeVisible();
      await noSideScroll(page, kind);
      await page.screenshot({ path: `${SHOT_DIR}/waking-${kind}-390x844.jpg`, type: 'jpeg', quality: 55 });

      if (kind === 'lan') {
        // Retry while still down keeps the screen; once the host is back the same button gets in. Nothing was created.
        await page.getByTestId('waking-retry').click();
        await expect(waking).toBeVisible();
        state.down = false;
        await page.getByTestId('waking-retry').click();
        await expect(waking).toHaveCount(0, { timeout: 10_000 });
        await expect(page.getByPlaceholder('שם תצוגה')).toBeVisible();
      } else {
        await page.getByTestId('waking-practice').click();
        await expect(page).toHaveURL(/#\/practice/);
      }
      await ctx.close();
    });
  }

  test('unknown server: a generic "no connection" message, at 360x640, 390x844 and 844x390', async ({ browser }) => {
    for (const vp of VIEWPORTS) {
      const { ctx, page, state } = await reachability(browser, vp, null);
      state.down = true; // never reached: nothing is remembered
      await page.goto('/');
      const waking = page.getByTestId('waking');
      await expect(waking).toBeVisible({ timeout: 15_000 });
      await expect(waking).toHaveAttribute('data-kind', 'unknown');
      await expect(page.getByTestId('waking-title')).toHaveText('אין חיבור לשרת');
      const all = (await waking.textContent())!;
      expect(all).not.toMatch(/%|נרדם|המחשב המארח/);
      for (const id of ['waking-retry', 'waking-practice']) await expect(page.getByTestId(id)).toBeVisible();
      await noSideScroll(page, `unknown ${vp.width}x${vp.height}`);
      if (vp.height > 400) await insideScreen(page, '.waking-card', `unknown ${vp.width}x${vp.height}`);
      if (vp.width === 390) await page.screenshot({ path: `${SHOT_DIR}/waking-unknown-390x844.jpg`, type: 'jpeg', quality: 55 });
      if (vp.height === 390) {
        await page.getByTestId('waking-retry').scrollIntoViewIfNeeded();
        await expect(page.getByTestId('waking-retry')).toBeInViewport();
      }
      await ctx.close();
    }
  });
});

test.describe('join by code', () => {
  test('wrong and expired code: inline reason, typed code kept, focus kept; the right code enters; the button clears a keyboard (emulated)', async ({ browser }) => {
    const a = await player(browser, 'Host');
    const b = await player(browser, 'Guest', { width: 360, height: 640 });
    await onboard(a, 0);
    await onboard(b, 1);
    const code = await createRoom(a);

    // Wrong code.
    const input = b.page.getByTestId('join-code');
    await input.fill('ZZZZZZ');
    await b.page.getByTestId('join-go').click();
    const err = b.page.getByTestId('join-error');
    await expect(err).toBeVisible({ timeout: 10_000 });
    await expect(err).toContainText('לא מצאנו חדר עם הקוד הזה');
    await expect(b.page.getByTestId('room')).toHaveCount(0);
    await expect(input).toHaveValue('ZZZZZZ');
    await expect(input).toBeFocused();
    await expect(input).toHaveAttribute('aria-invalid', 'true');
    await expect(b.page.getByTestId('join-go')).toBeEnabled();
    await insideScreen(b.page, '[data-testid=join-error]', 'wrong code');
    await noSideScroll(b.page, 'wrong code');

    // Typing again clears the message.
    await input.press('Backspace');
    await expect(err).toHaveCount(0);

    // Expired code: the owner replaces the code, the old one no longer opens the room.
    await a.page.getByTestId('share').click();
    await a.page.getByRole('button', { name: /קוד חדש/ }).click();
    await expect.poll(async () => (await a.page.locator('.code-chip bdi').textContent())?.trim()).not.toBe(code);
    const fresh = (await a.page.locator('.code-chip bdi').textContent())!.trim();
    await a.page.keyboard.press('Escape');
    await input.fill(code);
    await b.page.getByTestId('join-go').click();
    await expect(err).toBeVisible({ timeout: 10_000 });
    await expect(input).toHaveValue(code);
    await expect(input).toBeFocused();

    // Keyboard proxy: with the field focused, shrink the viewport the way an on-screen keyboard does.
    await b.page.setViewportSize({ width: 360, height: 330 });
    await input.focus();
    await b.page.waitForTimeout(700);
    const vp = b.page.viewportSize()!;
    for (const id of ['join-go', 'join-code', 'join-error']) {
      const box = (await b.page.getByTestId(id).boundingBox())!;
      expect(box.y, `${id} top`).toBeGreaterThanOrEqual(-1);
      expect(box.y + box.height, `${id} stays above the keyboard`).toBeLessThanOrEqual(vp.height + 1);
    }
    await b.page.setViewportSize({ width: 360, height: 640 });

    // The correct code enters the room.
    await input.fill(fresh);
    await b.page.getByTestId('join-go').click();
    await expect(b.page.getByTestId('room')).toBeVisible({ timeout: 10_000 });
    await expect(b.page).toHaveURL(new RegExp(`#/r/${fresh}$`));

    // A shared link with a bad code keeps the plain "no room" page (there is no field to return to).
    await b.page.goto('/#/r/QQQQQQ');
    await expect(b.page.getByText('לא מצאנו חדר עם הקוד הזה. אולי')).toBeVisible({ timeout: 10_000 });
    await a.ctx.close();
    await b.ctx.close();
  });
});

const BIG_UNITS = 9_999_999 * 2; // 9,999,999 coins in half-coin units
const WIDE_HE = 'מ'.repeat(20); // DisplayName max is 20 characters (packages/protocol)
const WIDE_EN = 'W'.repeat(20);

/** Rewrites balances in what the server sends over the socket and /api/me (the real server and rules are untouched). */
async function bigBalances(p: Player) {
  let seen = 0;
  const walk = (v: any): any => {
    if (Array.isArray(v)) return v.map(walk);
    if (v && typeof v === 'object') {
      const o: any = {};
      for (const [k, x] of Object.entries(v)) o[k] = k === 'availableUnits' || k === 'returnedUnits' ? (seen++, BIG_UNITS) : walk(x);
      return o;
    }
    return v;
  };
  await p.page.routeWebSocket(/socket\.io/, (ws) => {
    const server = ws.connectToServer();
    ws.onMessage((m) => server.send(m));
    server.onMessage((m) => {
      const text = typeof m === 'string' ? m : null;
      if (!text || !/^4[23]\d*\[/.test(text)) return ws.send(m);
      const at = text.indexOf('[');
      try {
        ws.send(text.slice(0, at) + JSON.stringify(walk(JSON.parse(text.slice(at)))));
      } catch {
        ws.send(m);
      }
    });
  });
  await p.page.route('**/api/me', async (route) => {
    const res = await route.fetch();
    const j = await res.json();
    if (j?.wallet) j.wallet.availableUnits = BIG_UNITS;
    await route.fulfill({ response: res, json: j });
  });
  return () => seen;
}

/** Text is complete (not clipped by an ancestor) and inside the screen; numbers read left to right. */
async function assertFits(page: Page, label: string) {
  await noSideScroll(page, label);
  const bad = await page.evaluate(() => {
    const out: string[] = [];
    const vw = innerWidth;
    const vh = innerHeight;
    const clipped = (el: Element) => {
      const r = el.getBoundingClientRect();
      for (let p = el.parentElement; p && p !== document.body; p = p.parentElement) {
        const cs = getComputedStyle(p);
        if (cs.overflowX === 'visible' && cs.overflowY === 'visible') continue;
        const pr = p.getBoundingClientRect();
        if (r.left < pr.left - 1 || r.right > pr.right + 1) return `clipped by .${p.className}`;
      }
      return null;
    };
    for (const el of document.querySelectorAll('.coins')) {
      const r = el.getBoundingClientRect();
      if (!r.width) continue;
      if (r.left < -1 || r.right > vw + 1) out.push(`coins outside screen: ${el.textContent} [${Math.round(r.left)},${Math.round(r.right)}]`);
      const c = clipped(el);
      if (c) out.push(`coins ${el.textContent} ${c}`);
      if (getComputedStyle(el).direction !== 'ltr') out.push(`coins not ltr: ${el.textContent}`);
    }
    for (const el of document.querySelectorAll('.seat-name, .me-name, .nm')) {
      const r = el.getBoundingClientRect();
      if (!r.width) continue;
      if (r.left < -1 || r.right > vw + 1) out.push(`name outside screen: ${el.textContent}`);
      const c = clipped(el);
      if (c) out.push(`name ${el.textContent} ${c}`);
    }
    const rects = (sel: string) => [...document.querySelectorAll(sel)].map((e) => ({ e, r: e.getBoundingClientRect() })).filter((x) => x.r.width);
    const overlap = (a: DOMRect, b: DOMRect) => a.left < b.right - 1 && b.left < a.right - 1 && a.top < b.bottom - 1 && b.top < a.bottom - 1;
    const seats = rects('.others .seat');
    for (let i = 0; i < seats.length; i++) for (let j = i + 1; j < seats.length; j++) if (overlap(seats[i].r, seats[j].r)) out.push('seats overlap');
    const hud = rects('.room-head > *');
    for (let i = 0; i < hud.length; i++) for (let j = i + 1; j < hud.length; j++) if (overlap(hud[i].r, hud[j].r)) out.push(`hud items overlap: ${hud[i].e.className} / ${hud[j].e.className}`);
    for (const h of hud) if (h.r.right > vw + 1 || h.r.left < -1) out.push(`hud item outside: ${h.e.className}`);
    for (const s of seats)
      for (const ch of s.e.querySelectorAll('.seat-name, .coins')) {
        const r = ch.getBoundingClientRect();
        if (r.width && (r.left < s.r.left - 1 || r.right > s.r.right + 1)) out.push(`seat content leaves its seat: ${ch.textContent}`);
      }
    const panel = document.querySelector('[data-testid=result-panel]');
    if (panel) {
      const pr = panel.getBoundingClientRect();
      if (pr.left < -1 || pr.right > vw + 1 || pr.bottom > vh + 1) out.push(`result panel outside: ${Math.round(pr.left)},${Math.round(pr.right)},${Math.round(pr.bottom)} of ${vw}x${vh}`);
      for (const ch of panel.querySelectorAll('.coins')) {
        const r = ch.getBoundingClientRect();
        if (r.left < pr.left - 1 || r.right > pr.right + 1) out.push(`result number leaves panel: ${ch.textContent}`);
      }
    }
    return out;
  });
  expect(bad, `${label}: ${bad.join(' | ')}`).toEqual([]);
}

test('longest names and 9,999,999-coin balances fit in Home, the HUD, seats and the result panel (360x640, 390x844, 844x390)', async ({ browser }) => {
  for (const vp of VIEWPORTS) {
    const label = `${vp.width}x${vp.height}`;
    const a = await player(browser, WIDE_HE, vp);
    const b = await player(browser, WIDE_EN, vp);
    const seen = await bigBalances(a);
    await onboard(a, 0);
    await onboard(b, 1);

    await a.page.goto('/');
    await expect(a.page.locator('.me-name')).toContainText(WIDE_HE);
    await expect(a.page.locator('.me-coins')).toContainText('9,999,999');
    await assertFits(a.page, `home ${label}`);

    const code = await createRoom(a);
    await b.page.goto(`/#/r/${code}`);
    await expect(b.page.getByTestId('room')).toBeVisible();
    await sit(a);
    await sit(b);
    await expect(a.page.locator('.hud-balance .coins')).toContainText('9,999,999');
    await expect(a.page.locator('.seat-name').first()).toBeVisible();
    await assertFits(a.page, `lobby ${label}`);
    await pickAndConfirm(a.page, 10);
    await pickAndConfirm(b.page, 10);
    await expect(a.page.locator('.dealer-cards .card')).toHaveCount(2, { timeout: 15_000 });
    await a.page.waitForTimeout(800);
    await assertFits(a.page, `table ${label}`);
    await playRound([a, b]);
    await a.page.waitForTimeout(700);
    await expect(a.page.getByTestId('result-panel')).toBeVisible();
    await assertFits(a.page, `result ${label}`);
    expect(seen(), 'the balance rewrite reached the page').toBeGreaterThan(0);
    if (vp.width === 360) await a.page.screenshot({ path: `${SHOT_DIR}/long-values-${label}.jpg`, type: 'jpeg', quality: 55 });
    await a.ctx.close();
    await b.ctx.close();
  }
});
