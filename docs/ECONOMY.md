# Economy

> **סיכום לעוז:** יש שלוש קטגוריות נפרדות: קוינס למשחק, XP שלא ניתן לקנות, ומלאי קוסמטיקה.
> הסימולציה מראה שהמענקים והמשימות מכניסים הרבה יותר ממה שהיתרון של הקזינו מוציא, ולכן היתרות יגדלו עם הזמן.
> קוסמטיקה במחיר קוינס היא הדרך העיקרית לאזן את זה. הסיכויים בקלפים לעולם לא תלויים בתשלום.
> כל המספרים כאן הם הנחות לתכנון ולא תחזית.

Status: planning document for Stages D and E. Nothing here is implemented except the existing grants
(welcome, daily, rescue) and the ledger described in docs/ARCHITECTURE.md.

## 1. Three categories, never mixed

| Category | What it is | Can be bought? | Where it lives |
|---|---|---|---|
| Coins | Fictional play currency for stakes. No cash value, no redemption, no transfer between players. | Planned for a future store only after explicit approval (see docs/MONETIZATION_READINESS.md). Not in running code. | `wallets` + `ledger` (integer half-coin units, 2 units = 1 coin) |
| XP | Progress for levels, season tiers and titles. | Never. | Planned `xp_events` / `user_progress` (docs/DATA_MODEL_PLAN.md) |
| Cosmetics | Card backs, chip sets, table themes, frames, titles. Visual only. | Planned: earnable by play and missions; later in fixed-content bundles. | Planned `catalog_items` + `inventory` |

No second "premium" currency in the first store phase. Purchased and granted coins share one displayed
balance, but every ledger row records its source so refunds, support and analytics can tell them apart.

## 2. Rules that do not change

- Card odds, shuffle, dealer rules and payouts never depend on payments, purchase history, balance, level or cosmetics.
- Solo, pass-and-play and LAN use local economies that are never imported into the online wallet.
- Friends night (equal-stack match) uses its own match wallet: purchases, daily rewards and missions never add to it.
- Skill-style rankings use settled hand results only (already true for the weekly group ranking); never total coins bought.
- Every online credit or debit happens on the server, inside a transaction, with an idempotency key, as a ledger row.
- Ledger sources (planned additions to the existing `kind` constraint): `grant_welcome`, `grant_daily`, `grant_rescue`,
  `stake_*`, `refund`, `match_stack`, `adjustment` (existing) plus `mission_reward`, `reward_claim` (wheel/scratch),
  `cosmetic_purchase` (coin sink), `purchase_credit`, `purchase_refund` (Stage E, store), `grant_ad` (exists, unused).
  Gifts in Stage B cost nothing and create no ledger rows.

## 3. Simulator

`node scripts/economy-sim.mjs` runs a deterministic expected-value model (no randomness) for 30 days.

### Assumptions

| Assumption | Value | Why |
|---|---|---|
| Welcome grant | 2,000 coins once | existing server value |
| Daily grant | 300 coins per active day | existing, Asia/Jerusalem date |
| Rescue | 500 coins when available is below 10 coins, max once per 6 h | existing rule |
| House edge | 0.5% and a worse 0.6% | rough figure for 6 decks, S17, 3:2, DAS, resplit to 4, no surrender, basic strategy; friends play worse than basic |
| Action multiplier | 1.12 x initial stake per hand | doubles and splits add wagered amount |
| Per-hand SD | 1.15 initial stakes | commonly cited blackjack variance figure |
| Draft missions | play hands 150, friends night 200, send a reaction 100 coins | drafts; never reward losing or raising stakes |
| Draft cosmetic prices | card back 5,000, chip set 6,000, table theme 8,000 coins | coin sinks; bought only if 50 stakes remain afterwards |
| Profiles | new (15 hands x 10 coins, days 1-5 then 2/week), casual (30 x 25, 4 days/week), heavy (120 x 100, daily) | illustrative |

### Output (actual run, branch upgrade/social-club)

TABLE21 economy simulation, 30 days, deterministic expected values (planning assumptions, not a forecast)

| Profile | Edge | Active days | Hands | Wagered | Game net (EV) | Grants | Rescues | Missions | Cosmetics bought | Coins spent on cosmetics | End balance | Bad day (p05) | XP |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| new | 0.5% | 12 | 180 | 2,016 | -6 | 5,600 | 0 | 1,920 | 0 | 0 | 7,514 | -74 | 312 |
| casual | 0.5% | 17 | 510 | 14,280 | -68 | 7,100 | 0 | 4,080 | 1 | 5,000 | 6,112 | -263 | 782 |
| heavy | 0.5% | 30 | 3,600 | 403,200 | -2,010 | 11,000 | 0 | 10,800 | 2 | 11,000 | 8,790 | -2,139 | 4,320 |
| new | 0.6% | 12 | 180 | 2,016 | -12 | 5,600 | 0 | 1,920 | 0 | 0 | 7,508 | -74 | 312 |
| casual | 0.6% | 17 | 510 | 14,280 | -85 | 7,100 | 0 | 4,080 | 1 | 5,000 | 6,095 | -264 | 782 |
| heavy | 0.6% | 30 | 3,600 | 403,200 | -2,415 | 11,000 | 0 | 10,800 | 2 | 11,000 | 8,385 | -2,153 | 4,320 |

All amounts are coins. Grants = welcome + daily + rescue. Bad day = 5th percentile single-day result at the profile stake.

### What the model says (and does not say)

- Grants plus draft missions bring in far more coins than the expected house edge takes out for every profile.
  Expected balances grow; without sinks the economy inflates and coins lose meaning. The rescue never triggers
  in the expected case.
- Individual experience is dominated by variance, not by the edge: a bad day for the heavy profile is about
  2,100 coins, roughly the same size as a full month of expected loss.
- Cosmetics priced in coins are the healthy sink. A modest daily mission total (300-450 coins) is enough.
- This is a deterministic expectation. It is not a forecast of player behavior, retention or revenue, and it
  says nothing about real-money spending. Before any store, rerun with telemetry from real play (docs/PRODUCT_ROADMAP.md).

### Draft tuning decisions (to revisit with real data)

1. Keep welcome 2,000 and daily 300. Do not raise grants.
2. Missions: 3 per day from a small pool, total 300-450 coins, plus XP. No "lose X" or "bet at least Y" missions.
3. Price cosmetics so a casual friend can earn one item every 2-3 weeks by play.
4. Daily wheel (Stage D): expected value about 150 coins with a visible prize table, replacing part of the daily grant rather than adding to it.
5. Store coin packs (Stage E, if ever approved) should be sized relative to stakes (for example 5,000 coins = 200 stakes at 25), not to grants.
