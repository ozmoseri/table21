# QA report: P0 gate, Club art and free-tier risks

> **סיכום לעוז (העדכון האחרון):**
> - **מה נבדק:** הנכסים החדשים (חדר, שולחן, גב קלף, צ׳יפים, קפה) ב-3 גדלי מסך. מסך "השרת מתעורר". ניסיון חוזר אחרי שהשרת התעורר: אין חשבון, חדר או מועדון כפולים. ניתוק בסיס הנתונים באמצע תשלום: התשלום מתבצע פעם אחת בלבד. גיבוי ושחזור. כרטיס תאריך הסיום של הפיילוט.
> - **מה נמצא ותוקן:**
>   - שגיאה בבסיס הנתונים באמצע שלב מתוזמן (תשלום, דילר) השאירה את השולחן תקוע.
>   - ניתוק חיבור בזמן פעולה הפיל את כל השרת.
>   - השרת שלח את קבצי האפליקציה בלי דחיסה.
>   - הנכסים לבדם האטו את טעינת השולחן.
>
>   כל אלה תוקנו ויש להם בדיקות.
> - **כל הבדיקות עברו:** 32 בדיקות כללים, 52 בדיקות אינטגרציה, 28 בדיקות דפדפן, 13 בדיקות חזרה לפריסה, ו-24 בדיקות פריסת מסך.
> - **מה לא נבדק:** טלפון אמיתי, האזנה לצלילים, ו-Render עצמו (עוד אין חשבון).

Date: 2026-11-01. Environment: Claude's cloud workspace (Node 22.23, PostgreSQL 16.15, Chromium 153 emulation).
Commit: see the final message (`TASK DONE <hash>`); the P0 gate itself was d20daa4.

Status legend: PASS (automated test passed on this commit), FAIL (found; fixed or documented), NOT RUN (not possible
here, with the reason).

## Suites on this commit

| Suite | Command | Result |
|---|---|---|
| Typecheck (4 packages) | `pnpm typecheck` | PASS |
| Unit (engine rules) | `pnpm test:unit` | PASS 32/32 |
| Integration (real PostgreSQL) | `pnpm test:integration` | PASS 52/52 (41 earlier + 11 new in `free-tier.test.ts`) |
| E2E (Chromium, separate browser contexts) | `pnpm test:e2e` | PASS 28/28 (25 earlier + 3 new in `free-tier.spec.ts`) |
| Deployment rehearsal (Render build command in a clean copy, production start behind HTTPS/WSS, real process kills) | `node scripts/deploy-check.mjs ...` | PASS 13/13 (`docs/deploy-check-2026-11-01.txt`) |
| Turn layout checker (4 screen sizes x 6 situations) | `node scripts/check-turn-layout.mjs` | PASS 24/24 (re-run with the new art) |
| Backup CLI on the rehearsal database (export, restore into an empty database, verify, refuse a second restore) | `pnpm db:backup ...` | PASS (`docs/backup-restore-2026-11-01.txt`) |
| Page weight and LCP, before and after | `node scripts/perf-measure.mjs` | measured (section 5) |

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

## 5. Club art (Higgsfield trial kit 1, direction A)

| # | Check | Status | Evidence |
|---|---|---|---|
| 5.1 | Every converted asset is 300 KB or less (largest 70.2 KB, total 248 KB, 11 WebP files) | PASS | `scripts/art/convert-club.py` asserts the budget; docs/ASSETS_CLUB.md |
| 5.2 | Room, cloth, card back, chips and coffee gift appear at 360x640, 390x844 and 844x390 | PASS | `docs/screenshots/club-art-*` (15 files) |
| 5.3 | Every image has a CSS or SVG fallback underneath (room and cloth gradients, `classic.svg`, tier colours, SVG coffee) | PASS (by construction) | `apps/web/src/art.ts`, styles.css "Club art"; previews swap to the SVG on error |
| 5.4 | Text on the cloth: median contrast near the dealer label 6.0:1 (before 4.6:1), weakest spot unchanged (2.3:1 at the lamp centre); labels on the cloth get a text shadow | PASS | measured on the 390x844 screenshots |
| 5.5 | 48 px tap targets, one-screen turn, no overlap, at 360x640 and 844x390 | PASS | turn-fit.spec.ts, layout-v4.spec.ts, check-turn-layout 24/24 |
| 5.6 | Page weight and LCP, slow 4G, table page portrait: before 671 KB / 3.70 s; art only 825 KB / 5.00 s; art + compression 401 KB / 2.96 s. First visit: 646 KB / 3.58 s, then 254 KB / 1.86 s | PASS after fix | `docs/perf-before-2026-11-01.json`, `docs/perf-after-2026-11-01.json`, docs/ASSETS_CLUB.md |
| 5.7 | FOUND: the art alone made the table page 1.3 s slower on slow 4G; the server sent scripts uncompressed (511 KB) | FAIL, fixed | build-time `.br`/`.gz` + `preCompressed`; script 136 KB on the wire |

## 6. Render free-tier risks

| # | Check | Status | Evidence |
|---|---|---|---|
| 6.1 | (א) The pilot card shows the database expiry date (created + 30 days), the deletion date (+14) and the days left, only to the operator | PASS | free-tier.test.ts (3 tests: dates, 403 for others, closed without a pilot plan, explicit admin ids) |
| 6.2 | (ב) Backup downloaded through the app restores into an empty database: same rows in every table, consistent ledger, id counters continue, old session signs in with the same coins; a second restore and a wrong schema version are refused | PASS | free-tier.test.ts |
| 6.3 | (ב) Backup CLI for real: export the rehearsal database, restore into a fresh database, verify, second restore refused | PASS | docs/backup-restore-2026-11-01.txt |
| 6.4 | (ג) "Server is waking up" screen at 360x640, 390x844, 844x390: no overflow, 48 px buttons, offline practice link, continues to onboarding when the server answers | PASS | free-tier.spec.ts; `docs/screenshots/waking-*.png` |
| 6.5 | (ג) Guest creation whose answer is lost: the browser retries with the same Idempotency-Key, one account, one welcome grant | PASS | free-tier.spec.ts (real browser, request reached the server, answer cut) |
| 6.6 | (ג) Room creation whose answer is lost: one room | PASS | free-tier.spec.ts |
| 6.7 | (ג) Server side: 5 concurrent retries with one key make one account; room and club retries return the same id; keys are per user; malformed keys ignored; keys expire after 24 h | PASS | free-tier.test.ts |
| 6.8 | (ג) Cached app answers after 4 s at most while the host holds the request; deploy rehearsal shows the waking screen with the server killed | PASS | deploy-check 13/13; `docs/screenshots/deploy-waking.png` |
| 6.9 | (ד) Real connection kill (`pg_terminate_backend`) on the second player's payout: whole payout rolled back, round not finished, stakes still reserved, room still in the dealer turn; a second server instance started during the outage pays nothing; after the database returns: settled exactly once (2 settlements, 2 returns), correct balances, consistent ledger; stale timers pay nothing | PASS | free-tier.test.ts |
| 6.10 | FOUND: a database error in a timed step (payout, dealer draw, deal) left the room stuck until the next command or restart | FAIL, fixed | retry with backoff (0.5 s up to 10 s); the 6.9 test fails without it (verified) |
| 6.11 | FOUND: a connection dropped while a transaction held it crashed the process (unhandled `error` event in `pg`) | FAIL, fixed | listener per checked-out client, broken clients discarded, idle pool errors logged; free-tier.test.ts |
| 6.12 | (ה) Quotas documented: 750 instance hours per workspace per month (suspended until next month when used up), 1 GB database, 30 days + 14 days grace, no backups on free Postgres | PASS (docs) | docs/DEPLOY.md sections 7 and 8 (render.com/docs/free, fetched 2026-11-01) |

## 7. NOT RUN (needs a person or a device)

| # | Check | Why |
|---|---|---|
| 7.1 | Physical iPhone and Android: Safari toolbars, safe areas, real rotation, touch timing, 60 fps | needs Oz's phones |
| 7.2 | Listening to the sounds (balance, annoyance over ten rounds) | Claude cannot listen; ten rounds were instrumented (no errors, sound budget held) and a demo file was delivered |
| 7.3 | PWA update while a hand is in progress (new version must not interrupt a hand) | needs a deployed server and two releases; by design the service worker only caches files and the page keeps running until the next launch, but this was not exercised |
| 7.4 | PWA install from the home screen on iPhone and Android | needs devices; guide in docs/PWA_INSTALL.md |
| 7.5 | Real Render deployment, its wake-up time, its proxy behaviour while waking (hold vs 502/503), and the pilot card against Render's real database dates | needs Oz's Render account |
| 7.6 | Real Google and Facebook sign-in | needs a public HTTPS domain and provider apps (docs/PROVIDER_SETUP.md) |
| 7.7 | The new art on real screens (OLED/LCD brightness, outdoor light), and the fixed room layer in iOS Safari | emulated in Chromium only |
| 7.8 | Backup download and CLI against Render's own database | needs the deployment; tested against local PostgreSQL 16 |

## Screenshots

`docs/screenshots/gate-natural-{portrait,landscape}.png`, `gate-split21-{portrait,landscape}.png`,
`gate-split-turn-{portrait,landscape}.png`.
Club art: `docs/screenshots/club-art-{portrait-360x640,portrait-390x844,landscape-844x390}-{home,practice-bet,practice-turn,lab-three,lab-six}.png`.
Waking up: `docs/screenshots/waking-{portrait-360x640,portrait-390x844,landscape-844x390}.png`, `deploy-waking.png`.
