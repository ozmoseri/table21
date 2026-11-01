#!/usr/bin/env node
// TABLE21 economy simulator (planning tool, not a forecast).
// Deterministic expected-value model over 30 days for three player profiles. No dependencies.
// Run: node scripts/economy-sim.mjs
// All money math is in integer half-coin units (2 units = 1 coin), matching the server ledger.
// Card odds never depend on payments, purchase history or balance; this model only uses fixed rule-level assumptions.

const U = 2; // units per coin
const coins = (units) => units / U;
const fmt = (units) => Math.round(coins(units)).toLocaleString('en-US');

/* ------------------------------ assumptions ------------------------------ */
const A = {
  days: 30,
  welcomeUnits: 2000 * U,
  dailyUnits: 300 * U,
  rescueUnits: 500 * U,
  rescueBelowUnits: 10 * U, // rescue only when available < minimum stake (10 coins)
  rescueCooldownHours: 6,
  // House edge for these rules (6 decks, S17, 3:2, DAS, resplit to 4, no surrender) with basic strategy
  // is roughly 0.4% to 0.5%; friends do not all play basic strategy, so a slightly worse 0.6% is used too.
  houseEdge: 0.005,
  // Average total wagered per hand relative to the initial stake (doubles and splits add action).
  actionMultiplier: 1.12,
  // Per-hand standard deviation of result, in initial stakes (published blackjack figure is about 1.15).
  sdPerHand: 1.15,
  // Draft daily missions (rewards are planning drafts, never tied to losing or raising stakes).
  missions: [
    { id: 'play_hands', rewardUnits: 150 * U, xp: 10 },
    { id: 'friends_night', rewardUnits: 200 * U, xp: 15 },
    { id: 'send_reaction', rewardUnits: 100 * U, xp: 5 },
  ],
  // Draft cosmetic catalog priced in play coins (a coin sink, not real money).
  cosmetics: [
    { id: 'card_back', priceUnits: 5000 * U },
    { id: 'chip_set', priceUnits: 6000 * U },
    { id: 'table_theme', priceUnits: 8000 * U },
  ],
  xpPerHand: 1,
};

const PROFILES = [
  {
    id: 'new',
    label: 'New player (active days 1-5, then 2 days a week)',
    activeDay: (d) => d <= 5 || d % 7 === 0 || d % 7 === 3,
    handsPerDay: 15,
    stakeCoins: 10,
    missionRate: [0.6, 0.1, 0.5],
    buysCosmetics: false,
  },
  {
    id: 'casual',
    label: 'Casual friend (4 days a week, friends night weekly)',
    activeDay: (d) => d % 7 !== 1 && d % 7 !== 4 && d % 7 !== 6,
    handsPerDay: 30,
    stakeCoins: 25,
    missionRate: [0.8, 0.25, 0.7],
    buysCosmetics: true,
  },
  {
    id: 'heavy',
    label: 'Heavy player (daily, long sessions)',
    activeDay: () => true,
    handsPerDay: 120,
    stakeCoins: 100,
    missionRate: [1, 0.6, 0.9],
    buysCosmetics: true,
  },
];

/* --------------------------------- model --------------------------------- */
function simulate(p, edge) {
  let bal = A.welcomeUnits;
  const t = { activeDays: 0, hands: 0, wagered: 0, gameNet: 0, grants: A.welcomeUnits, rescues: 0, missions: 0, cosmetics: 0, bought: 0, xp: 0, p05Day: 0 };
  const owned = new Set();
  for (let d = 1; d <= A.days; d++) {
    if (!p.activeDay(d)) continue;
    t.activeDays++;
    bal += A.dailyUnits;
    t.grants += A.dailyUnits;
    const stake = p.stakeCoins * U;
    // Play in blocks; rescue when the balance cannot cover the minimum stake (cooldown limits it to 4 per day).
    let handsLeft = p.handsPerDay;
    let rescuesToday = 0;
    let evCarry = 0; // fractional expected loss carried between blocks, so rounding never hides the edge
    while (handsLeft > 0) {
      const affordable = Math.floor(bal / stake);
      if (affordable < 1) {
        if (bal < A.rescueBelowUnits && rescuesToday < 24 / A.rescueCooldownHours) {
          bal += A.rescueUnits;
          t.grants += A.rescueUnits;
          t.rescues++;
          rescuesToday++;
          continue;
        }
        break;
      }
      const n = Math.min(handsLeft, affordable, 10);
      const wager = Math.round(n * stake * A.actionMultiplier);
      evCarry += wager * edge;
      const ev = -Math.floor(evCarry);
      evCarry -= Math.floor(evCarry);
      bal += ev;
      t.wagered += wager;
      t.gameNet += ev;
      t.hands += n;
      t.xp += n * A.xpPerHand;
      handsLeft -= n;
    }
    // Missions (expected value: reward x completion rate, rounded to whole units).
    A.missions.forEach((m, i) => {
      const r = Math.round(m.rewardUnits * p.missionRate[i]);
      bal += r;
      t.missions += r;
      t.xp += Math.round(m.xp * p.missionRate[i]);
    });
    // Cosmetic sink: buy the cheapest unowned item when the balance stays above a 50-stake buffer afterwards.
    if (p.buysCosmetics) {
      for (const c of A.cosmetics) {
        if (!owned.has(c.id) && bal - c.priceUnits >= 50 * stake) {
          owned.add(c.id);
          bal -= c.priceUnits;
          t.cosmetics += c.priceUnits;
          t.bought++;
        }
      }
    }
    // A bad (5th percentile) single day: EV - 1.645 standard deviations.
    const sd = A.sdPerHand * stake * Math.sqrt(p.handsPerDay);
    const evDay = -p.handsPerDay * stake * A.actionMultiplier * edge;
    t.p05Day = Math.round(evDay - 1.645 * sd);
  }
  return { ...t, end: bal };
}

const rows = [];
for (const edge of [A.houseEdge, 0.006]) {
  for (const p of PROFILES) rows.push({ p, edge, r: simulate(p, edge) });
}

const out = [];
out.push(`TABLE21 economy simulation, ${A.days} days, deterministic expected values (planning assumptions, not a forecast)`);
out.push('');
out.push('| Profile | Edge | Active days | Hands | Wagered | Game net (EV) | Grants | Rescues | Missions | Cosmetics bought | Coins spent on cosmetics | End balance | Bad day (p05) | XP |');
out.push('|---|---|---|---|---|---|---|---|---|---|---|---|---|---|');
for (const { p, edge, r } of rows) {
  out.push(
    `| ${p.id} | ${(edge * 100).toFixed(1)}% | ${r.activeDays} | ${r.hands.toLocaleString('en-US')} | ${fmt(r.wagered)} | ${fmt(r.gameNet)} | ${fmt(r.grants)} | ${r.rescues} | ${fmt(r.missions)} | ${r.bought} | ${fmt(r.cosmetics)} | ${fmt(r.end)} | ${fmt(r.p05Day)} | ${r.xp.toLocaleString('en-US')} |`,
  );
}
out.push('');
out.push('All amounts are coins. Grants = welcome + daily + rescue. Bad day = 5th percentile single-day result at the profile stake.');
console.log(out.join('\n'));
