# QA report: release candidate (P0 gate, Club art, free-tier risks, safe updates, idempotency)

> **סיכום לעוז (העדכון האחרון: נעילת Idempotency וקבלה סופית):**
> - **מה נבנה:** לכל פעולה שמזיזה קוינס יש עכשיו מפתח חד-פעמי: הימור, דאבל, ספליט, יציאה מהכיסא, מתנה, מענק יומי, מענק חילוץ ותשלום בסוף יד.
> - **אותה בקשה פעמיים:** מחזירה את אותה תשובה בלי לחייב שוב. נבדק גם כשהבקשות נשלחות במקביל, וגם כששני שרתים מקבלים אותה ברגע זהה.
> - **אותו מפתח עם בקשה אחרת:** נדחה, ושום דבר לא משתנה.
> - **רישום המפתח והתנועה בקוינס:** נשמרים יחד. ניתוק באמצע משאיר את שניהם לא שמורים, ובניסיון החוזר הפעולה מתבצעת פעם אחת.
> - **קבלה סופית:** כל חבילת הבדיקות רצה מחדש על אותו קוד, והכול עבר. בשתי בדיקות דפדפן הנחת היסוד לא התאימה לבלאקג׳ק טבעי (כאשר יד נגמרת מיד), ותיקנתי אותן.
> - **מועמד לפריסה:** הקומיט שמכיל את הדוח הזה. מספר הקומיט מופיע בהודעת הסיום, ומזהי הקוד שנבדק מופיעים בסעיף "מועמד לפריסה".
> - **מה לא נבדק:** טלפונים אמיתיים, Render עצמו, והתחברות עם Google ו-Facebook.

Date: 2026-11-01. Environment: Claude's cloud workspace (Node 22.23, PostgreSQL 16.15, Chromium 153 emulation).
Commit: the release candidate is the commit that contains this report (child of 1c45b54); see "Release candidate"
at the end. The P0 gate itself was d20daa4.

Status legend: PASS (automated test passed on this commit), FAIL (found; fixed or documented), NOT RUN (not possible
here, with the reason).

## Suites on this commit (final acceptance run, all on the same code)

| Suite | Command | Result |
|---|---|---|
| Typecheck (4 packages) | `pnpm typecheck` | PASS |
| Engine rules (unit) | `pnpm test:unit` | PASS 32/32 |
| Server and integration (real PostgreSQL 16) | `pnpm test:integration` | PASS 67/67 (56 earlier + 11 new in `idempotency.test.ts`) |
| E2E (Chromium, separate browser contexts, real service worker), including updates with a stale cached client and image failure | `pnpm test:e2e` | PASS 33/33 |
| Turn layout checker (4 screen sizes x 6 situations) | `node scripts/check-turn-layout.mjs` | PASS 24/24 |
| Deployment rehearsal (Render build command in a clean copy, production start behind HTTPS/WSS, real process kills, sleeping server) | `node scripts/deploy-check.mjs ...` | PASS 13/13 (`docs/deploy-check-2026-11-01.txt`) |
| Backup CLI on the rehearsal database (export, restore into an empty database, verify, refuse a second restore) | `pnpm db:backup ...` | PASS (`docs/backup-restore-2026-11-01.txt`) |
| Page weight and LCP | `node scripts/perf-measure.mjs` | measured in the Club art task (section 5); not re-measured (no client asset change since) |

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

## 7. Safe PWA updates

| # | Check | Status | Evidence |
|---|---|---|---|
| 7.1 | A release that lands in the middle of a hand: the new service worker installs and waits; the page keeps the old worker; no message, no reload | PASS | updates.spec.ts (real service worker; the release changes the client bundle, sw.js and version.json, as a deploy does), portrait and landscape |
| 7.2 | At the end of the hand (safe point) "A new version of TABLE21 is available" appears; still the old worker and the same page until the tap; 48 px buttons, no overflow | PASS | updates.spec.ts; `docs/screenshots/update-ready-{portrait,landscape}.png` |
| 7.3 | "Later" hides it; the next hand shows nothing; it comes back after that hand | PASS | updates.spec.ts (portrait) |
| 7.4 | The tap: the waiting worker takes over and the page reloads into the new version (new worker version confirmed) | PASS | updates.spec.ts |
| 7.5 | Busy = my bet is down, or I am in the round being played (online), or a local hand from the first bet to the result (practice, pass-and-play) | PASS (by construction, exercised by 7.1) | `useHandBusy` in Room.tsx and LocalPlay.tsx |
| 7.6 | Version mismatch, HTTP: a write from another protocol (or none, against a newer server) gets 426 `client_outdated` before any handler runs; no account, grant or ledger row created; the same call from the current version works | PASS | updates.test.ts |
| 7.7 | Version mismatch, socket, in the middle of a hand: the outdated tab can join and see its hand, but bet, act, leave and gifts are refused; wallets, ledger, room version and round unchanged; after the refresh the same player finishes the same hand, 2 settlements, consistent ledger | PASS | updates.test.ts |
| 7.8 | Version mismatch in the browser, online hand: "Switch to the new version" notice with the reason (coins untouched); a stand is refused with a clear message; wallet unchanged; refresh returns to the same room and hand, and the hand completes with nothing left reserved | PASS (simulated mismatch: test builds can pretend to be another protocol; production builds cannot) | updates.spec.ts; `docs/screenshots/update-outdated-{portrait,landscape}.png` |
| 7.9 | Background images that fail to load: every `/art/club/` request aborted; the cloth is still green (pixels sampled in 3 places), the room behind is still dark, coffee falls back to its SVG icon, the card back to `classic.svg`; every key element (felt, header, status, cards, seats, actions, stake chips, gift icons) has the same position and size as with images; no overflow; portrait and landscape | PASS | updates.spec.ts; `docs/screenshots/image-fallback-*.png` |
| 7.10 | One-off e2e failures seen in the previous task | (a) NOTED, (b) FIXED in the idempotency task (8.11) | (a) account.spec "guest saves the account..." failed once as the first test of a run. It was not seen again in four later full runs or 20 repeats; the error detail was not kept. (b) multiplayer.spec "saw a hidden hole card" assumed no dealer natural: test assumption, not a leak |
| 7.11 | FOUND: the previous service worker called `skipWaiting()` on install and `clients.claim()`, so a release took over an open page at once (mid-hand included) and deleted the cache that page was using | FAIL, fixed | install no longer skips waiting; takeover only on the player's tap |
| 7.12 | FOUND: precaching used the HTTP cache, so a file changed under the same name could be cached stale by the new worker | FAIL, fixed | precache requests use `cache: 'no-cache'` (revalidate; 304 when unchanged) |

## 8. Idempotency for every coin movement

Keys:
- **Socket commands:** the `commandId` (bet, double, split, leave seat). It is claimed first in the command's
  transaction.
- **Gifts:** the client event id.
- **HTTP:** the `Idempotency-Key` header (guest, room, club, daily grant, rescue grant).
- **Movements inside the server:** the ledger `idem_key`. This covers settlement, voids, grants, match stacks, and now
  every command movement too.

Each key stores a fingerprint of its request:
- same key and same request: the first result, nothing applied twice;
- same key and a different request: `idempotency_conflict` (HTTP 409), nothing changed.

| # | Check | Status | Evidence |
|---|---|---|---|
| 8.1 | Bet sent again, sequentially and 6 at once: charged once, every answer is the first result (`duplicate`) | PASS | idempotency.test.ts |
| 8.2 | The same bet received by two server instances at the same moment: charged once, one commands row (the key is claimed in the database, not only in memory) | PASS | idempotency.test.ts |
| 8.3 | Same commandId with a different body (other stake, other command type, other version): refused; wallet, ledger, seats, round, room version and the stored command row unchanged | PASS | idempotency.test.ts |
| 8.4 | Double and split, 5 concurrent sends: the extra stake is reserved once; the same key for another action is refused with no change; a later replay still answers "duplicate" | PASS | idempotency.test.ts (2 tests) |
| 8.5 | Gift: 5 concurrent sends with one event id record one gift; the same id for another gift, recipient or room is refused and records nothing | PASS | idempotency.test.ts |
| 8.6 | Daily grant: 5 concurrent requests with one key pay once and all answer `{ ok: true }`; a later replay answers the same (not "already claimed"); the key row exists once | PASS | idempotency.test.ts |
| 8.7 | HTTP same key, different body: guest, room, club and grant answer 409 `idempotency_conflict` and create nothing | PASS | idempotency.test.ts |
| 8.8 | Key and coins in one transaction: the connection is killed (`pg_terminate_backend`) after the bet's coins moved but before commit; afterwards there is no command row, no ledger row and the wallet is untouched; the retry with the same key applies once, and a further retry replays | PASS | idempotency.test.ts |
| 8.9 | Ledger key: the same key with the same movement is a no-op; the same key with another amount or kind is refused (`IdempotencyConflict`) and nothing changes | PASS | idempotency.test.ts |
| 8.10 | A whole round with retries everywhere (bet twice, stand twice at once, stale timer): every ledger row has a key, one settlement, wallet = start - stake + return, nothing reserved | PASS | idempotency.test.ts |
| 8.11 | FOUND: two e2e tests assumed a random shoe never deals a natural. The presenter-dealer test failed once (no turn), and the multiplayer test failed once (no hidden-card frame) | FAIL, fixed (test) | the tests now deal again after a natural (presenter, version mismatch) or accept a revealed dealer natural; multiplayer.spec 9/9 with `--repeat-each 3` |
| 8.12 | Behaviour change: the same commandId sent with a different body used to replay the first result silently; it is now refused. The client always reuses the exact same command on a retry, so nothing it sends is affected | PASS | net.ts `send` (one command object per intent) |

## 9. NOT RUN (needs a person or a device)

| # | Check | Why |
|---|---|---|
| 9.1 | Physical iPhone and Android: Safari toolbars, safe areas, real rotation, touch timing, 60 fps | needs Oz's phones |
| 9.2 | Listening to the sounds (balance, annoyance over ten rounds) | Claude cannot listen; ten rounds were instrumented (no errors, sound budget held) and a demo file was delivered |
| 9.3 | PWA update on a real phone and on Render with two real releases (iOS Safari service worker timing, Android Chrome) | automated in Chromium with the real service worker (section 7); devices and Render not available |
| 9.4 | PWA install from the home screen on iPhone and Android | needs devices; guide in docs/PWA_INSTALL.md |
| 9.5 | Real Render deployment, its wake-up time, its proxy behaviour while waking (hold vs 502/503), and the pilot card against Render's real database dates | needs Oz's Render account |
| 9.6 | Real Google and Facebook sign-in | needs a public HTTPS domain and provider apps (docs/PROVIDER_SETUP.md) |
| 9.7 | The new art on real screens (OLED/LCD brightness, outdoor light), and the fixed room layer in iOS Safari | emulated in Chromium only |
| 9.8 | Backup download and CLI against Render's own database | needs the deployment; tested against local PostgreSQL 16 |

## Screenshots

`docs/screenshots/gate-natural-{portrait,landscape}.png`, `gate-split21-{portrait,landscape}.png`,
`gate-split-turn-{portrait,landscape}.png`.
Club art: `docs/screenshots/club-art-{portrait-360x640,portrait-390x844,landscape-844x390}-{home,practice-bet,practice-turn,lab-three,lab-six}.png`.
Waking up: `docs/screenshots/waking-{portrait-360x640,portrait-390x844,landscape-844x390}.png`, `deploy-waking.png`.
Safe updates: `docs/screenshots/update-ready-{portrait,landscape}.png`, `update-outdated-{portrait,landscape}.png`, `image-fallback-{390x844,844x390}-{table,practice}.png`.

## Release candidate

**Candidate for deployment: the commit that adds this section.** Its parent is 1c45b54; its hash is given in the
final message, and `git log -1 -- docs/QA_REPORT.md` shows it. Every suite in "Suites on this commit" ran on this exact
code. After the runs, only documentation changed (this report, DEPLOY.md, CLAUDE.md, logs and screenshots written by
the runs).

Check that a deployed commit carries the tested code (these must print the same ids):

```bash
git rev-parse <commit>:apps      # 2125b08dbb66466ed3587af2bec1b47039990586
git rev-parse <commit>:packages  # 02e5c9b4255178c40a6a302532db5316a83d3e42
git rev-parse <commit>:tests     # ff5644727f626d7f12670e8aded2f4ef90534cbf
git rev-parse <commit>:scripts   # 9a04245a747001b495525a70e0ce708eccd01cd3
```

Not part of this candidate's checks (section 9): physical phones, the real Render service, and Google and Facebook
sign-in.
