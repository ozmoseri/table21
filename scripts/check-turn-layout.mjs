// Dev check: during a turn, are my cards, totals and actions visible without scrolling and without overlap?
// Usage: node scripts/check-turn-layout.mjs <baseUrl>
import { chromium } from '@playwright/test';
const base = process.argv[2] ?? 'http://127.0.0.1:3131';
const sizes = [[360, 640], [390, 844], [844, 390], [640, 360]];
const kinds = ['solo', 'three', 'six', 'split', 'practice', 'practice-big-text'];
const b = await chromium.launch();
let bad = 0;
for (const [w, h] of sizes) {
  const ctx = await b.newContext({ viewport: { width: w, height: h }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 });
  const p = await ctx.newPage();
  for (const k of kinds) {
    if (k.startsWith('practice')) {
      await p.goto(`${base}/#/practice`);
      if (k.endsWith('big-text')) await p.addStyleTag({ content: 'html { font-size: 125% !important; } body { font-size: 20px !important; }' });
      for (let i = 0; i < 6; i++) {
        if (await p.locator('.act-stand').isVisible().catch(() => false)) break;
        if (await p.getByTestId('next-round').isVisible().catch(() => false)) await p.getByTestId('next-round').click();
        if (await p.getByTestId('deal').isVisible().catch(() => false)) {
          await p.locator('.stake-chip').first().click();
          await p.getByTestId('deal').click();
        }
        await p.waitForTimeout(1200);
      }
    } else await p.goto(`${base}/#/lab/${k}`);
    await p.waitForTimeout(350);
    const r = await p.evaluate(() => {
      const box = (el) => { if (!el) return null; const x = el.getBoundingClientRect(); return { t: x.top, b: x.bottom, l: x.left, r: x.right, w: x.width, h: x.height }; };
      const ov = (a, c) => a && c && a.l < c.r - 1 && c.l < a.r - 1 && a.t < c.b - 1 && c.t < a.b - 1;
      const hand = box(document.querySelector('.my-hands, .split-hands, .me-zone .hand'));
      const total = box(document.querySelector('.me-zone .total'));
      const acts = [...document.querySelectorAll('.act')].map(box);
      const seats = [...document.querySelectorAll('.others .seat')].map(box);
      const vh = innerHeight, vw = innerWidth;
      const issues = [];
      if (document.documentElement.scrollHeight > vh + 1) issues.push(`page scrolls ${document.documentElement.scrollHeight - vh}px`);
      if (document.documentElement.scrollWidth > vw + 1) issues.push('horizontal overflow');
      for (const [n, x] of [['hand', hand], ['total', total], ...acts.map((a, i) => [`act${i}`, a])]) if (!x || x.b > vh + 1 || x.t < -1) issues.push(`${n} outside view`);
      for (const a of acts) if (a && (a.h < 47.5 || a.w < 47.5)) issues.push(`small act ${Math.round(a.w)}x${Math.round(a.h)}`);
      seats.forEach((s, i) => { if (ov(hand, s)) issues.push(`hand over seat ${i}`); });
      acts.forEach((a, i) => { if (ov(hand, a)) issues.push(`hand over act ${i}`); seats.forEach((s, j) => ov(a, s) && issues.push(`act ${i} over seat ${j}`)); });
      return issues;
    });
    if (r.length) bad++;
    console.log(`${w}x${h} ${k}: ${r.length ? r.join('; ') : 'OK'}`);
  }
  await ctx.close();
}
await b.close();
process.exit(bad ? 1 : 0);
