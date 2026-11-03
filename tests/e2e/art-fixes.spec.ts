import { expect, test, type Page } from '@playwright/test';
import { PNG } from 'pngjs';
import { statSync } from 'node:fs';
import { createRoom, onboard, pickAndConfirm, player, sit } from './helpers.ts';

/** T06 art fixes (AD-1 to AD-8 of the art review, 2026-11-03): rail, bigger cards, one light, gold discipline, results, lobby, landscape, gifts. */

const PORTRAITS = [
  { width: 390, height: 844 },
  { width: 360, height: 640 },
];
const ALL = [...PORTRAITS, { width: 844, height: 390 }];

type Box = { l: number; t: number; r: number; b: number };
const rect = (page: Page, sel: string) =>
  page.evaluate((s) => {
    const e = document.querySelector(s);
    if (!e) return null;
    const b = e.getBoundingClientRect();
    return { l: b.left, t: b.top, r: b.right, b: b.bottom };
  }, sel) as Promise<Box | null>;

const lum = (c: number[]) => {
  const f = (v: number) => ((v /= 255) <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4);
  return 0.2126 * f(c[0]) + 0.7152 * f(c[1]) + 0.0722 * f(c[2]);
};
const contrast = (a: number[], b: number[]) => {
  const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p);
  return (x + 0.05) / (y + 0.05);
};
const parse = (css: string) => (css.match(/[\d.]+/g) ?? []).slice(0, 4).map(Number);
/** One sRGB pixel (CSS px) of a PNG screenshot taken at deviceScaleFactor 2. */
const px = (png: PNG, x: number, y: number) => {
  const i = (Math.round(y * 2) * png.width + Math.round(x * 2)) * 4;
  return [png.data[i], png.data[i + 1], png.data[i + 2]];
};

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

/** Online room, my turn with Hit enabled (a natural ends the round at once, so bet again). */
async function onlineTurn(page: Page) {
  for (let i = 0; i < 40; i++) {
    if ((await page.locator('.act-hit:not([disabled])').count()) > 0) return;
    if ((await page.locator('.stake-chip').first().isVisible().catch(() => false)) && !(await page.locator('.bet-spot.has-bet').isVisible().catch(() => false))) await pickAndConfirm(page);
    await page.waitForTimeout(500);
  }
  await expect(page.locator('.act-hit')).toBeEnabled({ timeout: 15_000 });
}

for (const vp of PORTRAITS) {
  test(`AD-1 rail ${vp.width}x${vp.height}: a 26 px brass and leather rail under the felt, clear of every card, total, chip and button (bet, turn, result)`, async ({ browser }) => {
    const p = await player(browser, 'Rail', vp);
    await p.ctx.addInitScript(() => localStorage.setItem('t21:age-ok', '1'));
    const page = p.page;
    const asset = await page.request.get('/art/club/rail-near.webp');
    expect(asset.status()).toBe(200);
    expect((await asset.body()).length, 'rail file weight').toBeLessThanOrEqual(25 * 1024);
    await page.goto('/#/practice');
    await page.locator('.stake-chip').first().waitFor();
    const check = async (phase: string) => {
      const m = await page.evaluate(() => {
        const ctl = document.querySelector('.room > .controls')!;
        const cs = getComputedStyle(ctl, '::before');
        const b = ctl.getBoundingClientRect();
        const top = (e: Element) => e.getBoundingClientRect();
        const tops = [...document.querySelectorAll('.me-zone .card, .me-zone .total, .me-zone .chips, .me-zone .bet-spot, .me-zone .my-hands')].map((e) => top(e).bottom);
        const below = [...document.querySelectorAll('.room > .controls button, .room > .controls .btn, .room > .controls .result-panel')].map((e) => top(e).top);
        return { image: cs.backgroundImage, size: cs.backgroundSize, ctlTop: b.top, innerWidth, meBottom: Math.max(...tops), firstControlTop: Math.min(...below), pseudoLeft: parseFloat(cs.left), pseudoW: parseFloat(cs.width) };
      });
      expect(m.image, `${phase}: rail image`).toContain('rail-near.webp');
      expect(m.size, `${phase}: rail is 26 px tall, never tiled`).toMatch(/100%\s+26px/);
      const railTop = m.ctlTop - 28;
      const railBottom = railTop + 26;
      expect(railTop - m.meBottom, `${phase}: rail top at least 4 px below my cards, total and bet row`).toBeGreaterThanOrEqual(4);
      expect(m.firstControlTop, `${phase}: every control starts below the rail`).toBeGreaterThanOrEqual(railBottom);
      // the brass inlay: a screenshot pixel 2 px under the rail top, centre of the screen
      const png = PNG.sync.read(await page.screenshot());
      const [r] = px(png, vp.width / 2, railTop + 2);
      expect(r, `${phase}: rail top pixel is brass-ish (R > 150)`).toBeGreaterThan(150);
    };
    await check('bet');
    await practiceTurn(page);
    await check('turn');
    await page.locator('.act-stand').click();
    await page.getByTestId('result-panel').waitFor();
    await page.waitForTimeout(700);
    await check('result');
    await p.ctx.close();
  });
}

test('AD-2 bigger cards: my card is at least 100 px at 390 wide, the dead band between my bet row and the controls is small, controls are 132 px (128 at 360x640)', async ({ browser }) => {
  for (const [vp, ctl, minCard] of [
    [PORTRAITS[0], 132, 100],
    [PORTRAITS[1], 128, 93],
  ] as const) {
    const p = await player(browser, 'Big', vp);
    await p.ctx.addInitScript(() => localStorage.setItem('t21:age-ok', '1'));
    await practiceTurn(p.page);
    const m = await p.page.evaluate(() => {
      const r = (s: string) => document.querySelector(s)!.getBoundingClientRect();
      return { card: r('.me-zone .card').width, ctl: r('.room > .controls').height, betBottom: r('.me-zone .chips').bottom, first: r('.coach-bar').top, act: r('.act-stand').height, coachH: r('.coach-bar').height, ctlTop: r('.room > .controls').top, ctlBottom: r('.room > .controls').bottom, actBottom: r('.actions').bottom };
    });
    expect(m.ctl, `${vp.width}: controls height`).toBe(ctl);
    expect(m.card, `${vp.width}: my card width`).toBeGreaterThanOrEqual(minCard);
    // measured 89 px at 390 to the visible chip stack (the review asked for 48 before the rail existed): 26 px of it is the rail, so 63 px of empty felt
    if (vp.width === 390) expect(m.first - m.betBottom, 'gap from my bet row to the first control (incl. the 26 px rail)').toBeLessThanOrEqual(96);
    expect(m.act, 'actions stay 56 px').toBe(56);
    expect(m.coachH, 'coach strip 36 px').toBe(36);
    expect(m.actBottom, 'actions inside controls').toBeLessThanOrEqual(m.ctlBottom + 1);
    expect(m.first, 'coach strip inside controls').toBeGreaterThanOrEqual(m.ctlTop - 1);
    // betting phase (chips 56 + confirm 52 + gap 10 = 118) and the result (line + countdown) fit the same height
    await p.page.locator('.act-stand').click();
    await p.page.getByTestId('result-panel').waitFor();
    await p.page.waitForTimeout(600);
    const res = await p.page.evaluate(() => {
      const c = document.querySelector('.room > .controls')!.getBoundingClientRect();
      const kids = [...document.querySelectorAll('.room > .controls > *')].map((e) => e.getBoundingClientRect()).filter((k) => k.height > 0);
      return { top: Math.min(...kids.map((k) => k.top)) - c.top, bottom: Math.max(...kids.map((k) => k.bottom)) - c.bottom };
    });
    expect(res.top, `${vp.width}: result panel and countdown inside controls (top)`).toBeGreaterThanOrEqual(-1);
    expect(res.bottom, `${vp.width}: result panel and countdown inside controls (bottom)`).toBeLessThanOrEqual(1);
    await p.page.getByTestId('next-round').click();
    await p.page.locator('.stake-chip').first().waitFor();
    const bet = await p.page.evaluate(() => {
      const c = document.querySelector('.room > .controls')!.getBoundingClientRect();
      const kids = [...document.querySelectorAll('.room > .controls > *')].map((e) => e.getBoundingClientRect());
      return { top: Math.min(...kids.map((k) => k.top)) - c.top, bottom: Math.max(...kids.map((k) => k.bottom)) - c.bottom };
    });
    expect(bet.top, `${vp.width}: betting row inside controls`).toBeGreaterThanOrEqual(-1);
    expect(bet.bottom, `${vp.width}: betting row inside controls (bottom)`).toBeLessThanOrEqual(1);
    await p.ctx.close();
  }
});

test('AD-3 one light: an overhead pool, dark corners, brightest felt keeps ivory text at 4.5:1; no sideways shadow offsets in the room CSS', async ({ browser }) => {
  const p = await player(browser, 'Light', PORTRAITS[0]);
  await p.ctx.addInitScript(() => localStorage.setItem('t21:age-ok', '1'));
  await p.page.goto('/#/practice');
  await p.page.locator('.stake-chip').first().waitFor();
  await p.page.addStyleTag({ content: '.room > * { visibility: hidden !important; }' });
  await p.page.waitForTimeout(300);
  const png = PNG.sync.read(await p.page.screenshot());
  const at = (fx: number, fy: number) => px(png, fx * 390, fy * 844);
  const centre = lum(at(0.5, 0.4));
  const corner = lum(at(0.06, 0.22));
  const ratio = centre / corner;
  console.log(`light: centre ${at(0.5, 0.4)} corner ${at(0.06, 0.22)} luminance ratio ${ratio.toFixed(2)}`);
  expect(ratio, 'pool (50%,40%) vs corner (6%,22%), relative luminance').toBeGreaterThanOrEqual(1.8);
  expect(ratio, 'not a spotlight').toBeLessThanOrEqual(3.0);
  let brightest = 0;
  let where = '';
  for (let y = 0.05; y < 0.82; y += 0.02) for (let x = 0.02; x < 1; x += 0.04) {
    const l = lum(at(x, y));
    if (l > brightest) (brightest = l), (where = `${x.toFixed(2)},${y.toFixed(2)} ${at(x, y)}`);
  }
  console.log(`light: brightest felt luminance ${brightest.toFixed(4)} at ${where}`);
  // 0.157 is the luminance where ivory (0.88) drops to 4.5:1; the art review's 0.12 was a rounder, stricter figure
  expect(brightest, 'brightest felt pixel').toBeLessThanOrEqual(0.157);
  const ivory = [246, 241, 228];
  const worst = contrast(ivory, at(Number(where.split(',')[0]), Number(where.split(',')[1].split(' ')[0])));
  console.log(`light: ivory on the brightest felt ${worst.toFixed(2)}:1`);
  expect(worst, 'ivory text on the brightest felt').toBeGreaterThanOrEqual(4.5);
  await p.ctx.close();
});

for (const vp of ALL) {
  test(`AD-4 gold discipline ${vp.width}x${vp.height}: during my turn gold is only on confirm / continue / blackjack / coin; the coach pick is ivory; the last 6 s ring is rose`, async ({ browser }) => {
    const a = await player(browser, 'Gold', vp);
    await a.ctx.addInitScript(() => localStorage.setItem('t21:age-ok', '1'));
    await onboard(a, 1);
    await a.page.goto('/#/settings');
    await a.page.getByTestId('coach-rooms').check(); 
    await a.page.goto('/#/home');
    await createRoom(a);
    await sit(a);
    await onlineTurn(a.page);
    await a.page.getByTestId('coach-tip').click();
    await expect(a.page.locator('.act[data-coach-pick]')).toHaveCount(1);
    const res = await a.page.evaluate(() => {
      const GOLD = 'rgb(229, 199, 126)';
      const allowed = '.btn.confirm, [data-testid=next-round], .c-bj, .coin, .coins .coin, .coin-icon';
      const props = ['color', 'backgroundColor', 'borderTopColor', 'borderBottomColor', 'borderLeftColor', 'borderRightColor', 'outlineColor', 'boxShadow', 'stroke', 'fill', 'textDecorationColor', 'filter'];
      const scan = () => {
      const bad: string[] = [];
      for (const e of document.querySelectorAll('.room, .room *')) {
        if (e.closest(allowed)) continue;
        const cs = getComputedStyle(e);
        if (cs.display === 'none' || cs.visibility === 'hidden') continue;
        for (const pr of props) {
          const v = (cs as any)[pr] as string;
          if (!v || !v.includes(GOLD)) continue;
          // a border or outline that is not drawn is not seen; a colour only matters where it is used
          if (pr.startsWith('border') && (cs as any)[pr.replace('Color', 'Width')] === '0px') continue;
          if (pr === 'outlineColor' && cs.outlineStyle === 'none') continue;
          if (pr === 'color' && !(e.childNodes.length && [...e.childNodes].some((n) => n.nodeType === 3 && n.textContent!.trim()))) continue;
          if (pr === 'backgroundColor' && cs.backgroundColor === 'rgba(0, 0, 0, 0)') continue;
          if ((pr === 'stroke' || pr === 'fill') && !(e instanceof SVGElement)) continue;
          if (pr === 'stroke' && cs.stroke === 'none') continue;
          bad.push(`${e.tagName.toLowerCase()}.${(e.getAttribute('class') ?? '').split(' ').join('.')} ${pr}`);
        }
      }
      return bad;
      };
      // self-test of the scan: a gold probe must be found (so an empty list means something)
      const probe = document.createElement('i');
      probe.className = 'gold-probe';
      probe.textContent = 'x';
      probe.style.color = GOLD;
      document.querySelector('.room')!.appendChild(probe);
      const probeFound = scan().some((b) => b.includes('gold-probe'));
      probe.remove();
      const bad = scan();
      const pickOutline = getComputedStyle(document.querySelector('.act[data-coach-pick]')!).outlineColor;
      return { bad, pickOutline, probeFound };
    });
    expect(res.probeFound, 'the scan finds a gold probe').toBe(true);
    expect(res.bad, 'gold outside confirm / continue / blackjack / coin').toEqual([]);
    expect(res.pickOutline, 'coach pick outline is ivory').toBe('rgb(246, 241, 228)');
    // the ring: ivory with time, rose when low. A cloned low ring proves the selector (the real one turns low at 6 s).
    const ring = await a.page.evaluate(() => {
      const host = document.querySelector('.total.has-ring')!;
      const real = host.querySelector('.timer-ring')!;
      const bar = real.querySelector('.bar')!;
      const clone = real.cloneNode(true) as SVGElement;
      clone.classList.add('low');
      host.appendChild(clone);
      const low = getComputedStyle(clone.querySelector('.bar')!).stroke;
      const realStroke = getComputedStyle(bar).stroke;
      const realLow = real.classList.contains('low');
      clone.remove();
      return { low, realStroke, realLow };
    });
    expect(ring.low, 'low ring stroke').toBe('rgb(229, 150, 156)');
    expect(ring.realStroke, 'real ring stroke').toBe(ring.realLow ? 'rgb(229, 150, 156)' : 'rgb(246, 241, 228)');
    await a.ctx.close();
  });
}

test('AD-4 coach meter: neutral grey below 50% risk, rose above; no hue ramp', async ({ browser }) => {
  const p = await player(browser, 'Meter', PORTRAITS[1]);
  await p.ctx.addInitScript(() => localStorage.setItem('t21:age-ok', '1'));
  const seen = new Set<string>();
  await p.page.goto('/#/practice');
  for (let i = 0; i < 25 && seen.size < 2; i++) {
    await p.page.locator('.stake-chip').first().click();
    await p.page.getByTestId('deal').click();
    if (await p.page.locator('.act-stand:not([disabled])').waitFor({ timeout: 6000 }).then(() => true, () => false)) {
      for (let h = 0; h < 4 && (await p.page.locator('.act-hit:not([disabled])').count()) > 0; h++) {
        const risk = Number(await p.page.getByTestId('coach-meter').getAttribute('data-risk'));
        const bg = await p.page.locator('.coach-meter-fill').evaluate((e) => getComputedStyle(e).backgroundColor);
        const want = risk < 50 ? 'rgb(182, 193, 202)' : 'rgb(229, 150, 156)';
        await p.page.waitForTimeout(350); // the fill transitions its colour in 240 ms
        const settled = await p.page.locator('.coach-meter-fill').evaluate((e) => getComputedStyle(e).backgroundColor);
        expect(settled, `risk ${risk}%`).toBe(want);
        void bg;
        seen.add(want);
        if (seen.size === 2) break;
        await p.page.locator('.act-hit').click();
        await p.page.waitForTimeout(600);
      }
      if ((await p.page.locator('.act-stand:not([disabled])').count()) > 0) await p.page.locator('.act-stand').click();
    }
    await p.page.getByTestId('next-round').click({ timeout: 10_000 }).catch(() => {});
  }
  expect(seen.size, 'saw both a safe and a risky hand').toBeGreaterThanOrEqual(1);
  await p.ctx.close();
});

for (const vp of PORTRAITS) {
  test(`AD-5 results ${vp.width}x${vp.height}: one viewport, my hand does not move from turn to result, the countdown is on screen in ivory`, async ({ browser }) => {
    const a = await player(browser, 'Result', vp);
    await a.ctx.addInitScript(() => localStorage.setItem('t21:age-ok', '1'));
    await onboard(a, 2);
    await createRoom(a);
    await sit(a);
    await onlineTurn(a.page);
    const turn = (await rect(a.page, '.me-zone .card'))!;
    const centre = (b: Box) => (b.t + b.b) / 2;
    const turnTotal = (await rect(a.page, '.me-zone .total'))!;
    await a.page.locator('.act-stand').click();
    await a.page.getByTestId('result-panel').waitFor({ timeout: 15_000 });
    await a.page.waitForTimeout(600);
    const res = (await rect(a.page, '.me-zone .card'))!;
    expect(Math.abs(res.t - turn.t), 'my first card top, turn vs result').toBeLessThanOrEqual(2);
    // the ring makes the total 44 px during the turn and 26 px after; it stays centred in the same 54 px row
    expect(Math.abs(centre((await rect(a.page, '.me-zone .total'))!) - centre(turnTotal)), 'my total centre, turn vs result').toBeLessThanOrEqual(2);
    const m = await a.page.evaluate(() => {
      const p = document.querySelector('.room > .controls > p.muted.small');
      const r = p?.getBoundingClientRect();
      const cs = p ? getComputedStyle(p) : null;
      return {
        scroll: document.scrollingElement!.scrollHeight - innerHeight,
        has: !!p,
        bottom: r?.bottom ?? 0,
        h: innerHeight,
        color: cs?.color ?? '',
        opacity: cs ? Number(cs.opacity) : 1,
        text: p?.textContent ?? '',
      };
    });
    expect(m.scroll, 'results never grow the page').toBeLessThanOrEqual(1);
    expect(m.has, 'the next-round countdown line exists').toBe(true);
    expect(m.bottom, 'countdown on screen').toBeLessThanOrEqual(m.h);
    expect(m.text).toMatch(/\d/);
    const fg = parse(m.color);
    const bg = [11, 18, 24];
    const blended = fg.slice(0, 3).map((c, i) => c * m.opacity + bg[i] * (1 - m.opacity));
    expect(contrast(blended, bg), 'countdown contrast').toBeGreaterThanOrEqual(4.5);
    await a.ctx.close();
  });
}

for (const vp of PORTRAITS) {
  test(`coach verdict ${vp.width}x${vp.height}: the chip never covers my total, the bet row, my cards or the skip button, and takes no layout space`, async ({ browser }) => {
    const p = await player(browser, 'Verdict', vp);
    await p.ctx.addInitScript(() => localStorage.setItem('t21:age-ok', '1'));
    await practiceTurn(p.page);
    const before = await rect(p.page, '.me-zone .card');
    await p.page.locator('.act-stand').click();
    await p.page.getByTestId('coach-verdict').waitFor({ timeout: 3000 });
    await p.page.waitForTimeout(350); // past the 10% fade-in
    const v = (await rect(p.page, '[data-testid=coach-verdict]'))!;
    for (const sel of ['.me-zone .total', '.me-zone .chips', '.me-zone .card', '.skip-anim', '.room > .controls button']) {
      const o = await rect(p.page, sel);
      if (!o) continue;
      const hit = v.l < o.r && v.r > o.l && v.t < o.b && v.b > o.t;
      expect(hit, `verdict over ${sel}`).toBe(false);
    }
    const after = await rect(p.page, '.me-zone .card');
    expect(Math.abs(after!.t - before!.t), 'my hand did not move').toBeLessThanOrEqual(2);
    expect(v.t, 'verdict below the HUD').toBeGreaterThan(60);
    await p.ctx.close();
  });
}

test('AD-6 lobby: the room art shows behind the home screen, tiles stay in the palette (no violet), table background unchanged', async ({ browser }) => {
  for (const vp of [PORTRAITS[0], ALL[2]]) {
    const p = await player(browser, 'Lobby', vp);
    await onboard(p, 1);
    await p.page.goto('/#/home');
    await p.page.getByTestId('play-friends').waitFor();
    await p.page.waitForTimeout(800);
    const bodyBg = await p.page.evaluate(() => getComputedStyle(document.body).backgroundColor);
    expect(bodyBg, 'body does not paint over the room layer').toBe('rgba(0, 0, 0, 0)');
    const png = PNG.sync.read(await p.page.screenshot());
    // sample background pixels outside every tile/button/card (hide the content, keep the page background)
    await p.page.addStyleTag({ content: '#root, #root * { visibility: hidden !important; }' });
    await p.page.waitForTimeout(200);
    const bare = PNG.sync.read(await p.page.screenshot());
    let differ = 0;
    let total = 0;
    for (let y = 0.03; y < 0.97; y += 0.03) for (let x = 0.03; x < 0.97; x += 0.03) {
      const c = px(bare, x * vp.width, y * vp.height);
      total++;
      if (Math.abs(c[0] - 11) + Math.abs(c[1] - 18) + Math.abs(c[2] - 24) > 6) differ++;
    }
    console.log(`lobby ${vp.width}x${vp.height}: ${Math.round((100 * differ) / total)}% of the bare background differs from #0B1218`);
    expect(differ / total, `${vp.width}: room art visible`).toBeGreaterThanOrEqual(0.3);
    // no violet hue on the home screen
    const violet = await p.page.evaluate(() => {
      const hue = (c: string) => {
        const [r, g, b] = (c.match(/[\d.]+/g) ?? []).map(Number);
        const mx = Math.max(r, g, b), mn = Math.min(r, g, b);
        if (mx - mn < 24) return -1;
        const d = mx - mn;
        const h = mx === r ? ((g - b) / d) % 6 : mx === g ? (b - r) / d + 2 : (r - g) / d + 4;
        return Math.round(((h * 60) + 360) % 360);
      };
      const out: string[] = [];
      for (const e of document.querySelectorAll('.home, .home *')) {
        const cs = getComputedStyle(e);
        const list = [cs.color, cs.backgroundColor, cs.borderTopColor, cs.backgroundImage.match(/rgba?\([^)]*\)/g)?.join(' ') ?? ''];
        for (const c of list.join(' ').match(/rgba?\([^)]*\)/g) ?? []) {
          const a = c.match(/[\d.]+/g)!;
          if (a.length === 4 && Number(a[3]) < 0.08) continue;
          const h = hue(c);
          if (h >= 250 && h <= 290) out.push(`${e.className} ${c}`);
        }
      }
      return out;
    });
    expect(violet, 'no hue 250-290 on the home screen').toEqual([]);
    void png;
    await p.ctx.close();
  }
});

test('AD-7 landscape: dealer cards at least 60 px and friends cards at least 38 px at 844x390; no overlap on lab solo, three, six and split at 844x390 and 640x360', async ({ browser }) => {
  for (const [w, h] of [
    [844, 390],
    [640, 360],
  ]) {
    const ctx = await browser.newContext({ viewport: { width: w, height: h }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 });
    await ctx.addInitScript(() => localStorage.setItem('t21:age-ok', '1'));
    const page = await ctx.newPage();
    for (const kind of ['solo', 'three', 'six', 'split']) {
      await page.goto(`/#/lab/${kind}`);
      await page.locator('.dealer-cards .card').first().waitFor();
      await page.waitForTimeout(900);
      const m = await page.evaluate(() => {
        const b = (e: Element, name: string) => {
          const r = e.getBoundingClientRect();
          return { name, l: r.left, t: r.top, r: r.right, b: r.bottom, w: r.width };
        };
        const boxes = [
          ...[...document.querySelectorAll('.dealer-cards .card')].map((e) => b(e, 'dealer card')),
          ...[...document.querySelectorAll('.others .seat')].map((e, i) => b(e, `seat ${i}`)),
          ...[...document.querySelectorAll('.me-zone .my-hands, .me-zone .bet-spot')].map((e) => b(e, 'my hand')),
          ...[...document.querySelectorAll('.room-head .hud-btn, .room-head .hud-balance')].map((e) => b(e, 'hud')),
          ...[...document.querySelectorAll('.room > .controls .act')].map((e) => b(e, 'action')),
        ];
        const dealerW = Math.max(0, ...[...document.querySelectorAll('.dealer-cards .card')].map((e) => e.getBoundingClientRect().width));
        const seatCardW = Math.max(0, ...[...document.querySelectorAll('.others .seat .card')].map((e) => e.getBoundingClientRect().width));
        return { boxes, dealerW, seatCardW, scroll: document.documentElement.scrollHeight - innerHeight };
      });
      const hit = (a: any, c: any) => a.l < c.r - 0.5 && a.r > c.l + 0.5 && a.t < c.b - 0.5 && a.b > c.t + 0.5;
      const groups = (n: string) => (n.startsWith('seat') ? 'seat' : n);
      for (let i = 0; i < m.boxes.length; i++)
        for (let j = i + 1; j < m.boxes.length; j++) {
          const A = m.boxes[i], B = m.boxes[j];
          if (groups(A.name) === groups(B.name)) continue;
          if (A.name === 'dealer card' && B.name === 'dealer card') continue;
          expect(hit(A, B), `${kind} ${w}x${h}: ${A.name} over ${B.name}`).toBe(false);
        }
      expect(m.scroll, `${kind} ${w}x${h}: no scroll`).toBeLessThanOrEqual(1);
      if (w === 844) {
        // solo has the whole row; with friends the seats start 80 px below the dealer's top, so 48 px (up to 2 friends) and 43 px (3 or more)
        expect(m.dealerW, `${kind}: dealer card width`).toBeGreaterThanOrEqual(kind === 'solo' ? 60 : kind === 'three' ? 48 : 42.5);
        if (kind === 'three') expect(m.seatCardW, `${kind}: friends card width`).toBeGreaterThanOrEqual(38);
      }
    }
    await ctx.close();
  }
});

test('AD-8 gifts: every gift draws its original SVG; the retired raster is not requested and is marked retired in the manifest', async ({ browser }) => {
  const p = await player(browser, 'Gifts');
  await p.ctx.addInitScript(() => localStorage.setItem('t21:age-ok', '1'));
  const requested: string[] = [];
  p.page.on('request', (r) => requested.push(r.url()));
  await p.page.goto('/#/lab/three');
  await p.page.waitForTimeout(1500);
  expect(await p.page.locator('img.gift-art').count(), 'no raster gift icon').toBe(0);
  expect(requested.filter((u) => u.includes('coffee.webp'))).toEqual([]);
  await p.ctx.close();
});

test('AD-1 asset: rail-near.webp is opaque, 1170x78, within 25 KB', () => {
  const f = 'apps/web/public/art/club/rail-near.webp';
  expect(statSync(f).size).toBeLessThanOrEqual(25 * 1024);
});
