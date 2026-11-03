import { expect, test, type Page } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { FEEL } from '../../apps/web/src/feel.ts';
import { createRoom, onboard, pickAndConfirm, player, sit } from './helpers.ts';

/**
 * Feel bot (test environment only, docs/FEEL_TESTS.md). Plays practice rounds and one own room like a very fast, a very
 * slow and a clumsy player, and measures order, responsiveness, overlap, stability and lost input. It does not judge
 * fun or sound quality, never touches rules, odds or payouts, and never joins a real room as a friend.
 *
 * Random pauses come from a seeded PRNG. Re-run a failure with the same seed: T21_BOT_SEED=<seed> pnpm test:e2e feel-bot
 */
const SEED = Number(process.env.T21_BOT_SEED ?? 20261103) >>> 0;
console.log(`[feel-bot] seed ${SEED}`);

function mulberry32(a: number) {
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const hash = (s: string) => [...s].reduce((h, c) => (Math.imul(h ^ c.charCodeAt(0), 16777619) >>> 0), 2166136261);
/** One independent stream per scenario, all derived from the one logged seed. */
function rngFor(name: string) {
  test.info().annotations.push({ type: 'seed', description: String(SEED) });
  return mulberry32((SEED ^ hash(name)) >>> 0);
}
const between = (rng: () => number, lo: number, hi: number) => Math.round(lo + rng() * (hi - lo));
const note = (type: string, description: string) => test.info().annotations.push({ type, description });

/** Init script: toast texts, a wrapper around setTimeout/clearTimeout that counts pending timers, and fx node counters. */
async function instrument(page: Page) {
  await page.context().addInitScript(() => {
    const w = window as any;
    w.__toasts = [];
    w.__fx = { payout: 0, sweep: 0 };
    const pending = new Set<number>();
    const st = window.setTimeout.bind(window);
    const ct = window.clearTimeout.bind(window);
    w.setTimeout = (fn: any, ms?: number, ...args: any[]) => {
      if (typeof fn !== 'function') return st(fn, ms);
      const id: number = st((...a: any[]) => {
        pending.delete(id);
        return fn(...a);
      }, ms, ...args) as unknown as number;
      pending.add(id);
      return id;
    };
    w.clearTimeout = (id: number) => {
      pending.delete(id);
      return ct(id);
    };
    w.__pendingTimers = () => pending.size;
    const start = () =>
      new MutationObserver((ms) => {
        for (const m of ms)
          for (const n of m.addedNodes) {
            if (!(n instanceof HTMLElement)) continue;
            if (n.classList.contains('toast')) w.__toasts.push(n.textContent);
            if (n.classList.contains('payout-chip')) w.__fx.payout++;
            if (n.classList.contains('sweep-layer')) w.__fx.sweep++;
          }
      }).observe(document, { childList: true, subtree: true });
    start();
  });
}

function watchErrors(page: Page) {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  return errors;
}

const toasts = (page: Page): Promise<string[]> => page.evaluate(() => (window as any).__toasts);
const mine = (page: Page) => page.locator('.my-hands .card');
const dealerCards = (page: Page) => page.locator('.dealer-cards .card');
const result = (page: Page) => page.getByTestId('result-panel');
const turnStand = (page: Page) => page.locator('.act-stand:not([disabled])');
const soundLog = (page: Page): Promise<{ s: string; t: number }[]> => page.evaluate(() => [...((window as any).__t21soundLog ?? [])]);

async function openPractice(page: Page) {
  await page.goto('/#/practice');
  await page.locator('.stake-chip').first().waitFor();
}

/** Bet the first chip and deal. */
async function betAndDeal(page: Page) {
  await page.locator('.stake-chip').first().click();
  await expect(page.getByTestId('bet-spot')).toHaveClass(/has-bet/);
  await page.getByTestId('deal').click();
}

/** Waits until it is my turn or the round already ended (natural). */
async function turnOrResult(page: Page, timeout = 20_000): Promise<'turn' | 'result'> {
  await turnStand(page).or(result(page)).first().waitFor({ timeout });
  return (await result(page).isVisible()) ? 'result' : 'turn';
}

/** Plays rounds (stand only) until one has a turn, leaving the page at that turn. */
async function dealUntilTurn(page: Page, tries = 20) {
  for (let i = 0; i < tries; i++) {
    await betAndDeal(page);
    if ((await turnOrResult(page)) === 'turn') return;
    await page.getByTestId('next-round').click();
    await page.locator('.stake-chip').first().waitFor();
  }
  throw new Error(`no turn in ${tries} deals`);
}

async function finishRound(page: Page) {
  if (await turnStand(page).isVisible().catch(() => false)) await turnStand(page).click();
  await result(page).waitFor({ timeout: 20_000 });
}

async function nextRound(page: Page) {
  await page.getByTestId('next-round').click();
  await page.locator('.stake-chip').first().waitFor();
}

/** Every card on the table has a unique id (copies in the sweep layer are not table cards). */
const duplicateCardIds = (page: Page) =>
  page.evaluate(() => {
    const ids = [...document.querySelectorAll('.card[data-card-id]')].filter((e) => !e.closest('.sweep-layer')).map((e) => e.getAttribute('data-card-id'));
    return ids.filter((id, i) => ids.indexOf(id) !== i);
  });

const box = async (page: Page, sel: string) => (await page.locator(sel).first().boundingBox())!;
async function cardsInsideFelt(page: Page, label: string) {
  const felt = await box(page, '.room > .felt');
  for (const sel of ['.my-hands .card', '.dealer-cards .card']) {
    for (const c of await page.locator(sel).all()) {
      const b = (await c.boundingBox())!;
      expect(b.x, `${label}: ${sel} left`).toBeGreaterThanOrEqual(felt.x - 2);
      expect(b.y, `${label}: ${sel} top`).toBeGreaterThanOrEqual(felt.y - 2);
      expect(b.x + b.width, `${label}: ${sel} right`).toBeLessThanOrEqual(felt.x + felt.width + 2);
      expect(b.y + b.height, `${label}: ${sel} bottom`).toBeLessThanOrEqual(felt.y + felt.height + 2);
    }
  }
}
async function controlsVisible(page: Page, label: string) {
  const vp = page.viewportSize()!;
  const ctl = await box(page, '.room > .controls');
  expect(ctl.y, `${label}: controls top`).toBeGreaterThanOrEqual(-1);
  expect(ctl.y + ctl.height, `${label}: controls bottom`).toBeLessThanOrEqual(vp.height + 1);
  expect(ctl.x + ctl.width, `${label}: controls right`).toBeLessThanOrEqual(vp.width + 1);
}

test.describe('feel bot', () => {
  test.beforeEach(({}, info) => {
    info.annotations.push({ type: 'seed', description: String(SEED) });
  });

  test('1 fast player: acts the moment actions enable for 10 rounds; no lost or duplicated input, no error toasts', async ({ browser }) => {
    const rng = rngFor('fast');
    const p = await player(browser, 'FastBot');
    await instrument(p.page);
    const errors = watchErrors(p.page);
    await openPractice(p.page);
    let hits = 0;
    let stands = 0;
    for (let round = 0; round < 10; round++) {
      await betAndDeal(p.page);
      for (let actions = 0; ; actions++) {
        if ((await turnOrResult(p.page)) === 'result') break;
        expect(actions, `round ${round}: a hand needs few actions`).toBeLessThan(8);
        const n = await mine(p.page).count();
        if (actions < 3 && rng() < 0.4) {
          await p.page.locator('.act-hit').click();
          hits++;
          // The click must have an effect (not lost) and exactly one (not duplicated).
          await expect.poll(async () => (await mine(p.page).count()) > n || (await result(p.page).isVisible()), { timeout: 5000, message: `round ${round}: hit lost` }).toBe(true);
          expect(await mine(p.page).count(), `round ${round}: hit added one card`).toBeLessThanOrEqual(n + 1);
        } else {
          await p.page.locator('.act-stand').click();
          stands++;
          await result(p.page).waitFor({ timeout: 20_000 });
          break;
        }
      }
      expect(await duplicateCardIds(p.page), `round ${round}: unique cards`).toEqual([]);
      await nextRound(p.page);
    }
    note('actions', `hits ${hits}, stands ${stands}`);
    expect(await toasts(p.page)).toEqual([]);
    expect(errors).toEqual([]);
    await p.ctx.close();
  });

  test('2 slow player: seeded 1.5-4 s pauses at every step; nothing acts on its own in practice', async ({ browser }) => {
    const rng = rngFor('slow');
    const p = await player(browser, 'SlowBot');
    await instrument(p.page);
    const errors = watchErrors(p.page);
    test.setTimeout(240_000);
    await openPractice(p.page);
    const pauses: number[] = [];
    const pause = async () => {
      const ms = between(rng, 1500, 4000);
      pauses.push(ms);
      await p.page.waitForTimeout(ms);
    };
    let turns = 0;
    for (let round = 0; round < 6 && turns < 3; round++) {
      await p.page.locator('.stake-chip').first().click();
      await pause();
      await expect(p.page.getByTestId('bet-spot'), 'a placed bet stays').toHaveClass(/has-bet/);
      expect(await mine(p.page).count(), 'no cards before Deal').toBe(0);
      await p.page.getByTestId('deal').click();
      if ((await turnOrResult(p.page)) === 'result') {
        await pause();
        await nextRound(p.page);
        continue;
      }
      turns++;
      const my = await mine(p.page).count();
      const dealer = await dealerCards(p.page).count();
      await pause();
      // Still my turn: no automatic hit, stand or timer-out.
      await expect(turnStand(p.page)).toBeVisible();
      await expect(result(p.page)).toHaveCount(0);
      expect(await mine(p.page).count(), 'my hand untouched while thinking').toBe(my);
      expect(await dealerCards(p.page).count(), 'dealer untouched while I think').toBe(dealer);
      await p.page.locator('.act-stand').click();
      await result(p.page).waitFor({ timeout: 20_000 });
      await pause();
      await expect(result(p.page), 'the result waits for me').toBeVisible();
      await nextRound(p.page);
    }
    expect(turns).toBeGreaterThanOrEqual(2);
    note('pauses-ms', pauses.join(','));
    expect(await toasts(p.page)).toEqual([]);
    expect(errors).toEqual([]);
    await p.ctx.close();
  });

  test('3 double tap on Hit and on Stand (two clicks within ~40 ms): exactly one action applied', async ({ browser }) => {
    const rng = rngFor('double');
    void rng;
    const p = await player(browser, 'DoubleBot');
    await instrument(p.page);
    const errors = watchErrors(p.page);
    await openPractice(p.page);
    // Two taps 40 ms apart at the same screen point, run inside the page so the gap is exact. The second tap lands on
    // whatever is under the finger then (the button, or nothing if the action row already left), like a real thumb.
    const twice = (sel: string) =>
      p.page.evaluate(
        async ([s, gap]) => {
          const el = document.querySelector(s) as HTMLButtonElement;
          const r = el.getBoundingClientRect();
          const x = r.x + r.width / 2;
          const y = r.y + r.height / 2;
          const stamps: number[] = [];
          document.addEventListener('click', (e) => stamps.push(performance.now()), { capture: true, once: false });
          el.click();
          await new Promise((res) => setTimeout(res, gap));
          const under = document.elementFromPoint(x, y) as HTMLElement | null;
          (under?.closest('button') ?? under)?.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, view: window }));
          return { gap: stamps.length >= 2 ? stamps[1] - stamps[0] : -1, second: under ? `${under.tagName}.${String(under.className).slice(0, 40)}` : 'none' };
        },
        [sel, 40] as const,
      );

    // Hit: one extra card.
    let hitsTested = 0;
    for (let i = 0; i < 12 && hitsTested < 3; i++) {
      await dealUntilTurn(p.page);
      const n = await mine(p.page).count();
      const tap = await twice('.act-hit');
      note('second-tap-on-hit', tap.second);
      expect(tap.gap, 'two taps 40 ms apart').toBeGreaterThan(30);
      await expect.poll(() => mine(p.page).count(), { timeout: 5000 }).toBeGreaterThan(n);
      await p.page.waitForTimeout(1500);
      expect(await mine(p.page).count(), 'double tap on Hit gave exactly one card').toBe(n + 1);
      expect(await duplicateCardIds(p.page)).toEqual([]);
      hitsTested++;
      await finishRound(p.page);
      await nextRound(p.page);
    }
    expect(hitsTested).toBe(3);

    // Real pointer input: two taps back to back through the browser's input pipeline.
    await dealUntilTurn(p.page);
    const n2 = await mine(p.page).count();
    const b = (await p.page.locator('.act-hit').boundingBox())!;
    await p.page.mouse.click(b.x + b.width / 2, b.y + b.height / 2);
    await p.page.mouse.click(b.x + b.width / 2, b.y + b.height / 2);
    await expect.poll(() => mine(p.page).count(), { timeout: 5000 }).toBeGreaterThan(n2);
    await p.page.waitForTimeout(1500);
    expect(await mine(p.page).count(), 'real double tap on Hit gave exactly one card').toBe(n2 + 1);
    await finishRound(p.page);
    await nextRound(p.page);

    // Stand: one decision, one result, nothing leaks into the next hand.
    for (let i = 0; i < 3; i++) {
      await dealUntilTurn(p.page);
      const my = await mine(p.page).count();
      const tap = await twice('.act-stand');
      note('second-tap-on-stand', tap.second);
      expect(tap.gap, 'two taps 40 ms apart').toBeGreaterThan(30);
      await result(p.page).waitFor({ timeout: 20_000 });
      const net = await result(p.page).getAttribute('data-net', { timeout: 2000 }).catch(() => null);
      const dealerN = await dealerCards(p.page).count();
      await p.page.waitForTimeout(1500);
      expect(await result(p.page).count(), 'one result').toBe(1);
      expect(await result(p.page).getAttribute('data-net'), 'result unchanged by the second tap').toBe(net);
      expect(await mine(p.page).count(), 'stand never adds a card').toBe(my);
      expect(await dealerCards(p.page).count()).toBe(dealerN);
      await nextRound(p.page);
      // the next hand starts clean: no bet, no cards, no stray action
      await expect(p.page.getByTestId('bet-spot')).not.toHaveClass(/has-bet/);
      expect(await mine(p.page).count()).toBe(0);
    }
    expect(await toasts(p.page)).toEqual([]);
    expect(errors).toEqual([]);
    await p.ctx.close();
  });

  test('4 rotation mid-deal (390x844 to 844x390 and back): cards inside the felt, controls visible, actions usable', async ({ browser }) => {
    const rng = rngFor('rotate');
    const p = await player(browser, 'RotateBot', { width: 390, height: 844 });
    await instrument(p.page);
    const errors = watchErrors(p.page);
    await openPractice(p.page);
    const portrait = { width: 390, height: 844 };
    const landscape = { width: 844, height: 390 };

    for (const [from, to] of [
      [portrait, landscape],
      [landscape, portrait],
    ] as const) {
      await p.page.setViewportSize(from);
      await p.page.locator('.stake-chip').first().waitFor();
      await betAndDeal(p.page);
      await p.page.waitForTimeout(between(rng, 80, 200)); // cards are flying
      await p.page.setViewportSize(to);
      await p.page.waitForTimeout(between(rng, 60, 160));
      await p.page.setViewportSize(from); // and back, still mid-deal
      await p.page.waitForTimeout(between(rng, 60, 160));
      await p.page.setViewportSize(to);
      const state = await turnOrResult(p.page);
      await expect(mine(p.page)).toHaveCount(2);
      await expect(dealerCards(p.page)).toHaveCount(2);
      await p.page.waitForTimeout(1500);
      const label = `${from.width}x${from.height} -> ${to.width}x${to.height}`;
      expect(await duplicateCardIds(p.page), label).toEqual([]);
      await cardsInsideFelt(p.page, label);
      await controlsVisible(p.page, label);
      if (state === 'turn') {
        for (const a of await p.page.locator('.actions .act').all()) {
          const b = (await a.boundingBox())!;
          expect(b.y + b.height, `${label}: action inside the screen`).toBeLessThanOrEqual(to.height + 1);
          expect(b.x + b.width, `${label}: action inside the screen`).toBeLessThanOrEqual(to.width + 1);
        }
        await p.page.locator('.act-stand').click(); // usable after the rotation
      }
      await result(p.page).waitFor({ timeout: 20_000 });
      await cardsInsideFelt(p.page, `${label} (result)`);
      await nextRound(p.page);
    }
    expect(await toasts(p.page)).toEqual([]);
    expect(errors).toEqual([]);
    await p.ctx.close();
  });

  test('5 background and return mid-deal: state stays consistent, no duplicated sounds', async ({ browser }) => {
    const rng = rngFor('background');
    const p = await player(browser, 'BackgroundBot');
    await instrument(p.page);
    const errors = watchErrors(p.page);
    await openPractice(p.page);
    await p.page.evaluate(() => {
      (window as any).__setVisibility = (v: 'hidden' | 'visible') => {
        Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => v });
        Object.defineProperty(document, 'hidden', { configurable: true, get: () => v === 'hidden' });
        document.dispatchEvent(new Event('visibilitychange'));
      };
    });
    for (let round = 0; round < 3; round++) {
      const logBefore = (await soundLog(p.page)).length;
      await betAndDeal(p.page);
      await p.page.waitForTimeout(between(rng, 60, 260)); // mid-deal
      await p.page.evaluate(() => (window as any).__setVisibility('hidden'));
      await p.page.waitForTimeout(between(rng, 400, 1200));
      await p.page.evaluate(() => (window as any).__setVisibility('visible'));
      const state = await turnOrResult(p.page);
      await p.page.waitForTimeout(1500);
      const my = await mine(p.page).count();
      const dealer = await dealerCards(p.page).count();
      expect(my, `round ${round}: my cards`).toBeGreaterThanOrEqual(2);
      expect(dealer, `round ${round}: dealer cards`).toBeGreaterThanOrEqual(2);
      expect(await duplicateCardIds(p.page), `round ${round}: unique cards`).toEqual([]);
      if (state === 'turn') {
        await expect(turnStand(p.page)).toBeVisible();
        await p.page.locator('.act-stand').click();
      }
      await result(p.page).waitFor({ timeout: 20_000 });
      await p.page.waitForTimeout(800);
      // one card sound per card that landed in this round, never more (a card that was snapped into place makes none)
      const cards = (await mine(p.page).count()) + (await dealerCards(p.page).count());
      const log = (await soundLog(p.page)).slice(logBefore);
      const count = (s: string) => log.filter((e) => e.s === s).length;
      expect(count('deal'), `round ${round}: card landing sounds <= cards (${cards})`).toBeLessThanOrEqual(cards);
      expect(count('flip'), `round ${round}: flip sounds <= cards`).toBeLessThanOrEqual(cards);
      expect(count('win') + count('blackjack') + count('lose'), `round ${round}: one result sound at most`).toBeLessThanOrEqual(1);
      // sounds respect their minimum gap even across the background switch
      for (const s of new Set(log.map((e) => e.s))) {
        const ts = log.filter((e) => e.s === s).map((e) => e.t);
        for (let i = 1; i < ts.length; i++) expect(ts[i] - ts[i - 1], `${s} spacing`).toBeGreaterThanOrEqual(30);
      }
      note(`sounds-round-${round}`, log.map((e) => e.s).join(' '));
      await nextRound(p.page);
    }
    const stats = await p.page.evaluate(() => (window as any).__t21sound);
    expect(stats.maxVoices).toBeLessThanOrEqual(FEEL.sound.maxVoices);
    expect(await toasts(p.page)).toEqual([]);
    expect(errors).toEqual([]);
    await p.ctx.close();
  });

  test('6 room disconnect and reconnect during a turn: recovers from the snapshot; a shown result does not replay celebration or payout', async ({ browser }) => {
    const rng = rngFor('reconnect');
    test.setTimeout(240_000);
    const p = await player(browser, 'Reconnect');
    await instrument(p.page);
    const errors = watchErrors(p.page);
    await onboard(p, 3);
    await createRoom(p); // my own room with the automatic dealer; no other player
    await sit(p);
    // bet until a hand with a turn (a natural ends the round at once)
    let hasTurn = false;
    for (let i = 0; i < 12 && !hasTurn; i++) {
      await pickAndConfirm(p.page);
      hasTurn = await p.page.locator('.act-stand:not([disabled])').waitFor({ timeout: 12_000 }).then(() => true, () => false);
      if (!hasTurn) await expect(p.page.locator('.stake-chip').first()).toBeVisible({ timeout: 30_000 });
    }
    expect(hasTurn, 'a turn within 12 rounds').toBe(true);
    const my = await mine(p.page).count();
    const dealer = await dealerCards(p.page).count();
    await p.page.waitForTimeout(between(rng, 200, 800));
    await p.ctx.setOffline(true);
    await expect(p.page.getByText('מתחברים מחדש')).toBeVisible({ timeout: 15_000 });
    await p.page.waitForTimeout(between(rng, 500, 1500));
    await p.ctx.setOffline(false);
    await expect(p.page.getByText('מתחברים מחדש')).toBeHidden({ timeout: 20_000 });
    // same hand from the snapshot, still my turn, actions usable
    await expect(mine(p.page)).toHaveCount(my);
    await expect(dealerCards(p.page)).toHaveCount(dealer);
    expect(await duplicateCardIds(p.page)).toEqual([]);
    await expect(p.page.locator('.act-stand')).toBeEnabled({ timeout: 10_000 });
    await p.page.locator('.act-stand').click();
    await result(p.page).waitFor({ timeout: 30_000 });
    await p.page.waitForTimeout(900); // the result's own celebration and payout have started

    // Now a result is on screen. Drop and return again: nothing replays.
    const payoutBefore = await p.page.evaluate(() => (window as any).__fx.payout);
    const log0 = await soundLog(p.page);
    const celebratory = (l: { s: string }[]) => l.filter((e) => ['win', 'blackjack', 'lose', 'payout'].includes(e.s)).length;
    const net = await result(p.page).getAttribute('data-net', { timeout: 2000 }).catch(() => null);
    await p.ctx.setOffline(true);
    await expect(p.page.getByText('מתחברים מחדש')).toBeVisible({ timeout: 15_000 });
    await p.ctx.setOffline(false);
    await expect(p.page.getByText('מתחברים מחדש')).toBeHidden({ timeout: 20_000 });
    await p.page.waitForTimeout(1800);
    // The room may legitimately have moved on to the next betting round while we were offline (fast timers in the test
    // server); then there is no result left to compare, and the no-replay checks below still apply.
    const stillShown = await result(p.page).isVisible();
    note('result-still-shown-after-reconnect', String(stillShown));
    if (stillShown && net !== null) expect(await result(p.page).getAttribute('data-net', { timeout: 2000 }), 'same result after the snapshot').toBe(net);
    expect(await p.page.evaluate(() => (window as any).__fx.payout), 'no new payout chips').toBe(payoutBefore);
    expect(await p.page.locator('.payout-chip').count()).toBe(0);
    expect(await p.page.locator('.felt[class*="celebrate-"]').count(), 'no celebration replay').toBe(0);
    expect(celebratory(await soundLog(p.page)), 'no result or payout sound replayed').toBe(celebratory(log0));
    expect(await toasts(p.page)).toEqual([]);
    expect(errors).toEqual([]);
    await p.ctx.close();
  });

  test('7 six players and four split hands: covered by the layout specs (referenced, not duplicated)', async () => {
    // Already covered, so the bot adds nothing here: lab six / split fit at 360x640 and 844x390 with 125% text
    // (turn-fit.spec.ts), at 320 to 430 px and landscape (social.spec.ts), seats over the hand in landscape (layout-v4.spec.ts),
    // and a double tap in an online room (turn-fit.spec.ts, "a double tap sends one decision").
    const covered: [string, RegExp][] = [
      ['turn-fit.spec.ts', /\['solo', 'three', 'six', 'split'\]/],
      ['social.spec.ts', /lab layouts: 1, 3 and 6 players, four split hands/],
      ['layout-v4.spec.ts', /\['three', 'six'\]/],
      ['turn-fit.spec.ts', /a double tap sends one decision/],
    ];
    for (const [file, re] of covered) expect(readFileSync(new URL(`./${file}`, import.meta.url), 'utf8'), `${file} still covers it`).toMatch(re);
    note('covered-by', covered.map(([f]) => f).join(', '));
  });

  test('8 long practice run (30 rounds): no leftover sweep layers or payout chips, card nodes back to baseline, voices within the cap, timers not growing', async ({ browser }) => {
    const rng = rngFor('long');
    test.setTimeout(420_000);
    const p = await player(browser, 'LongBot');
    await instrument(p.page);
    const errors = watchErrors(p.page);
    await openPractice(p.page);
    const ROUNDS = 30;
    const cardNodes = () => p.page.locator('.card').count();
    const timers = () => p.page.evaluate(() => (window as any).__pendingTimers() as number);
    const samples: { cards: number; timers: number; fx: number }[] = [];
    let baselineCards = -1;
    for (let round = 0; round < ROUNDS; round++) {
      await betAndDeal(p.page);
      if ((await turnOrResult(p.page)) === 'turn') {
        if (rng() < 0.3 && (await p.page.locator('.act-hit').isEnabled())) {
          const n = await mine(p.page).count();
          await p.page.locator('.act-hit').click();
          await expect.poll(async () => (await mine(p.page).count()) > n || (await result(p.page).isVisible()), { timeout: 5000 }).toBe(true);
          if ((await turnOrResult(p.page)) === 'turn') await p.page.locator('.act-stand').click();
        } else {
          await p.page.locator('.act-stand').click();
        }
      }
      await result(p.page).waitFor({ timeout: 20_000 });
      await p.page.waitForTimeout(700); // celebration / payout start
      await nextRound(p.page);
      // wait for the sweep and payout nodes to leave; they are short-lived copies
      await expect(p.page.locator('.sweep-layer'), `round ${round}: sweep layer gone`).toHaveCount(0, { timeout: 2500 });
      await expect(p.page.locator('.payout-chip'), `round ${round}: payout chips gone`).toHaveCount(0, { timeout: 2500 });
      const cards = await cardNodes();
      if (baselineCards < 0) baselineCards = cards;
      expect(cards, `round ${round}: card nodes back to baseline`).toBe(baselineCards);
      samples.push({ cards, timers: await timers(), fx: await p.page.locator('.sweep-layer, .payout-chip, .fly-chip').count() });
    }
    // voices
    const stats = await p.page.evaluate(() => (window as any).__t21sound);
    expect(stats.maxVoices, 'active voices within the cap').toBeLessThanOrEqual(FEEL.sound.maxVoices);
    expect(stats.played).toBeGreaterThan(ROUNDS * 2);
    // pending timers do not grow: the last third never exceeds the first third by more than a small slack
    const t = samples.map((s) => s.timers);
    const third = Math.floor(t.length / 3);
    const firstMax = Math.max(...t.slice(0, third));
    const lastMax = Math.max(...t.slice(-third));
    note('timers', t.join(','));
    note('sound-stats', JSON.stringify(stats));
    expect(lastMax, `pending timers (first third max ${firstMax}, last third max ${lastMax})`).toBeLessThanOrEqual(firstMax + 5);
    expect(await toasts(p.page)).toEqual([]);
    expect(errors).toEqual([]);
    await p.ctx.close();
  });
});
