# P0 acceptance gate: QA report

> **סיכום לעוז:**
> - **מה נבדק:** החוקים שקובעים כסף, עמידות בקריסה של השרת באמצע יד, ואבטחה בצד השרת. הכול עבר.
> - **מה נמצא ותוקן:**
>   - ביד בלאקג׳ק טבעי הופיעו שתי תוויות, ובכתיב שונה.
>   - בדיקת "חיבור ספק" הייתה תלויה בתזמון, כי האפליקציה נטענה מחדש אחרי החיבור. עכשיו המצב מתעדכן במקום, בלי טעינה.
> - **מה לא נבדק:** טלפון אמיתי, האזנה לצלילים, ועדכון PWA באמצע יד.

Date: 2026-11-01. Environment: Claude's cloud workspace (Node 22.23, PostgreSQL 16.15, Chromium 153 emulation).
Commit: see the gate line in the final message (`#TABLE21_P0_GATE`).

Status legend: PASS (automated test passed on this commit), FAIL (found; fixed or documented), NOT RUN (not possible
here, with the reason).

## Suites on this commit

| Suite | Command | Result |
|---|---|---|
| Typecheck (4 packages) | `pnpm typecheck` | PASS |
| Unit (engine rules) | `pnpm test:unit` | PASS 32/32 |
| Integration (real PostgreSQL) | `pnpm test:integration` | PASS 41/41 |
| E2E (Chromium, separate browser contexts) | `pnpm test:e2e` | PASS 25/25 |
| Deployment rehearsal (production start behind HTTPS/WSS, real process kills) | `node scripts/deploy-check.mjs ...` | PASS 13/13 |
| Turn layout checker (4 screen sizes x 6 situations) | `node scripts/check-turn-layout.mjs` | PASS 24/24 (run in the previous task, layout unchanged) |

## 1. Rules that decide money

| # | Check | Status | Evidence |
|---|---|---|---|
| 1.1 | K,K split, both hands A = 21 vs dealer 20: each hand wins 1:1, not 3:2 | PASS | tests/unit/p0-gate.test.ts |
| 1.2 | Split 21 vs dealer three-card 21: both hands push | PASS | p0-gate.test.ts |
| 1.3 | Split vs dealer natural (A up or 10 up): the peek ends the round before any split; only the first stake is lost | PASS | p0-gate.test.ts |
| 1.4 | Split aces A+Q vs dealer 6+5+10: push, labeled "21 after split" (Oz's screenshot) | PASS | engine.test.ts regression, gate.spec.ts |
| 1.5 | Natural vs dealer three-card 21: natural wins 3:2 | PASS | p0-gate.test.ts, engine.test.ts |
| 1.6 | Natural vs dealer natural: push, stake back, net 0 | PASS | p0-gate.test.ts |
| 1.7 | 3:2 exact for odd amounts (1, 3, 5, 7, 25, 99, 1001 coins); 1 coin returns 2.5; 25 coins returns 62.5 | PASS | p0-gate.test.ts (integer half-coin units, no rounding) |
| 1.8 | Labels: Stake, Total returned, Net win/loss; natural shown once as "Natural blackjack"; split shows a row per hand; push reads "Stake returned" | PASS after fix | gate.spec.ts (portrait and landscape) |
| 1.9 | FOUND: a natural hand showed two badges ("בלאק ג׳ק" and "בלאקג׳ק טבעי") with different spelling | FAIL, fixed | HandView skips the outcome badge for a natural; spelling unified; gate.spec.ts asserts one label |

## 2. Resilience

| # | Check | Status | Evidence |
|---|---|---|---|
| 2.1 | Crash after bets, before the deal; restart after the betting deadline: deals from the reserved stakes, settles once | PASS | tests/integration/p0-gate.test.ts |
| 2.2 | Crash in the middle of the turns: same hand resumes, settles once | PASS | p0-gate.test.ts, rooms.test.ts |
| 2.3 | Crash during the dealer turn: dealer finishes, settles once | PASS | p0-gate.test.ts |
| 2.4 | Two redeploys in a row plus a stale timer: no second settlement | PASS | p0-gate.test.ts |
| 2.5 | Coins accounted after every crash: all wallets = grants - stakes + returns; ledger matches wallets; nothing reserved left | PASS | p0-gate.test.ts (`assertCoinsAccounted`) |
| 2.6 | A command retried after a restart with the same commandId is applied once | PASS | p0-gate.test.ts |
| 2.7 | Data survives a redeploy with Postgres: same session cookie, wallet, daily grant state | PASS | p0-gate.test.ts |
| 2.8 | Real process: SIGKILL in the middle of my turn behind HTTPS/WSS, restart: the browser resyncs to the same hand and finishes it | PASS | scripts/deploy-check.mjs (13/13) |
| 2.9 | Without a database a restart forgets accounts; the app starts clean without errors | PASS (documented limitation) | deploy-check.mjs, docs/DEPLOY.md |
| 2.10 | Shoe exhaustion voids the round and refunds every stake once | PASS | rooms.test.ts |
| 2.11 | On Render itself (its restarts, spin-down, Postgres) | NOT RUN | no Render account yet (Oz signs up; docs/DEPLOY.md) |

## 3. Security on the server

| # | Check | Status | Evidence |
|---|---|---|---|
| 3.1 | No socket without a session cookie | PASS | p0-gate.test.ts (connect rejected: unauthorized) |
| 3.2 | No impersonation: the acting player is always the session's user; a payload naming another player is ignored; B cannot act on A's turn | PASS | p0-gate.test.ts (not_your_turn), rooms.test.ts |
| 3.3 | Commands only for the room this socket joined | PASS | p0-gate.test.ts (forbidden) |
| 3.4 | Blocked actions are refused server side: acting before the deal (wrong_phase), illegal split, double after a hit, stale version | PASS | p0-gate.test.ts |
| 3.5 | Hole card never sent before the reveal; no shoe and no physical card ids in any frame | PASS | p0-gate.test.ts (socket frames), rooms.test.ts, multiplayer.spec.ts |
| 3.6 | Recovery codes rate limited: 10 attempts per 15 minutes per client, then 429 even for a correct code | PASS | p0-gate.test.ts |
| 3.7 | Recovery codes revocable: new set invalidates the old; sign out other devices ends a stolen session (HTTP and socket) | PASS | p0-gate.test.ts, identity.test.ts, friends.test.ts |
| 3.8 | Practice wallet separate from the online wallet: no endpoint accepts practice coins; extra fields ignored; ledger unchanged | PASS | p0-gate.test.ts, identity.test.ts, account.spec.ts |
| 3.9 | Provider tokens: aud, iss, exp, signature, alg, kid, nonce, replay | PASS | identity.test.ts |
| 3.10 | Test sign-in provider refused in production, LAN and with a public origin | PASS | identity.test.ts |
| 3.11 | Session cookie Secure, HttpOnly, SameSite=Lax behind the HTTPS proxy; realtime over WSS | PASS | deploy-check.mjs |

## 4. Layout, flow, PWA (from the earlier gates, re-run on this commit)

| # | Check | Status | Evidence |
|---|---|---|---|
| 4.1 | One-screen turn at 360x640 and 844x390, 1/3/6 players, 4 split hands, RTL, 125% text | PASS | turn-fit.spec.ts |
| 4.2 | Double tap sends one decision; buttons keep their places | PASS | turn-fit.spec.ts |
| 4.3 | Round timings in the browser (card 280 ms, 90 to 120 ms apart, flip 260 ms, win 600 ms, natural 950 ms) | PASS | turn-fit.spec.ts |
| 4.4 | Reload after a result does not celebrate again | PASS | turn-fit.spec.ts |
| 4.5 | PWA manifest, icons, service worker | PASS | pwa.spec.ts |
| 4.6 | Server asleep: cached app, offline play, reconnects by itself | PASS | deploy-check.mjs |
| 4.7 | FOUND: the provider link test could race with a page reload after linking | FAIL, fixed | linking now refreshes the account in place; account.spec.ts waits for the linked state |

## 5. NOT RUN (needs a person or a device)

| # | Check | Why |
|---|---|---|
| 5.1 | Physical iPhone and Android: Safari toolbars, safe areas, real rotation, touch timing, 60 fps | needs Oz's phones |
| 5.2 | Listening to the sounds (balance, annoyance over ten rounds) | Claude cannot listen; ten rounds were instrumented (no errors, sound budget held) and a demo file was delivered |
| 5.3 | PWA update while a hand is in progress (new version must not interrupt a hand) | needs a deployed server and two releases; by design the service worker only caches files and the page keeps running until the next launch, but this was not exercised |
| 5.4 | PWA install from the home screen on iPhone and Android | needs devices; guide in docs/PWA_INSTALL.md |
| 5.5 | Real Render deployment and public URL | needs Oz's Render account |
| 5.6 | Real Google and Facebook sign-in | needs a public HTTPS domain and provider apps (docs/PROVIDER_SETUP.md) |

## Screenshots

`docs/screenshots/gate-natural-{portrait,landscape}.png`, `gate-split21-{portrait,landscape}.png`,
`gate-split-turn-{portrait,landscape}.png`.
