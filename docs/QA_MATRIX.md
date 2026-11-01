# QA matrix

> **סיכום לעוז:** זו טבלת בדיקות הקבלה המחייבות, בחלוקה ל-12 תחומים.
> PASS מסומן רק כשיש בדיקה קיימת שעוברת, נכון ל-commit `f621e4e`, עם קישור לבדיקה.
> כל מה שחדש או שדורש מכשירים אמיתיים מסומן NOT_RUN.
> הטבלה תעודכן אחרי כל שלב.

Baseline commit: `f621e4e` (main). Evidence refers to test names in `tests/unit/engine.test.ts` (U),
`tests/integration/rooms.test.ts` (I), `tests/e2e/multiplayer.spec.ts` and `tests/e2e/offline-layout.spec.ts` (E).
Chromium emulation is not a real-device test. Last full run: docs/TEST_REPORT.md (24 U, 13 I, 6 E passing).

| # | Area | Check | Status | Evidence |
|---|---|---|---|---|
| 1 | Rules | Ordinary hand, blackjack 3:2, push, bust | PASS | U: "player natural vs dealer non-natural pays 3:2", "equal totals push", "dealer hits 16 and busts; busted player still loses" |
| 1 | Rules | Double (funding, one card, not after hit) | PASS | U: "double adds one stake..."; I: "insufficient funds blocks bets and doubles" |
| 1 | Rules | Four split hands, split aces | PASS | U: "resplit up to four hands", "split aces get one card each..." |
| 1 | Rules | Balances and rules unchanged by cosmetics | NOT_RUN | no test yet (cosmetics only change CSS today) |
| 1 | UI | 4-hand split display readable on phone | NOT_RUN | Stage A layout work in this branch |
| 2 | Motion | 12/14-card deal never disappears (no skip threshold) | NOT_RUN | old Card.tsx skipped batches over 10; replaced by TablePresentationController in this branch |
| 2 | Motion | Refresh/disconnect does not replay old animations | NOT_RUN | |
| 2 | Motion | New local session does not inherit previous "seen" cards | NOT_RUN | old local round ids restarted at local1 |
| 3 | Layout | Six players, long Hebrew names | NOT_RUN | E layouts test covers one long name, not six seats |
| 3 | Layout | 360/390 px, landscape, no horizontal overflow | PASS | E: "layouts: no horizontal overflow across phones, tablet, desktop, landscape, Hebrew and English, long names" (360, 430, 820, 1280, 844x390) |
| 3 | Layout | 320 px width | NOT_RUN | not in the viewport list |
| 3 | Layout | Enlarged text, Safari toolbars, on-screen keyboard | NOT_RUN | needs real iPhone |
| 4 | Lifecycle | Background/resume near end of turn, fast snapshots | NOT_RUN | |
| 4 | Lifecycle | Reduced motion changed mid-animation | NOT_RUN | E covers reduced motion at load only ("reduced motion and keyboard access") |
| 4 | Lifecycle | No double actions (duplicate command ids) | PASS | I: "duplicate command ids apply once; concurrent bets keep the ledger consistent" |
| 4 | Lifecycle | Network drop and refresh mid-hand | PASS | E: "network drop and page refresh: player reconnects to the same hand and finishes it" |
| 5 | Gifts | Mute, rate limit, duplicate event, departed user, disconnect, expiry | NOT_RUN | Stage B in this branch |
| 5 | Gifts | Atomic charge once | NOT_RUN | gifts are free in Stage B; applies when gifts cost coins |
| 5 | Gifts | No asset hides an essential action | NOT_RUN | |
| 6 | Wheel/scratch | Concurrent claims, two devices, local clock change, disconnect after save, prize table version change | NOT_RUN | Stage D (not built). Related existing guarantee: I: "daily grant once per Jerusalem day; rescue only below min stake and once per 6h (concurrent claims)" PASS |
| 7 | Missions | Duplicate game events, day/season change, guest data, no XP duplication | NOT_RUN | Stage D (not built) |
| 8 | Identity | Linking, same email different sub, deletion, session renewal, bad token, no local wallet import | NOT_RUN | Stage C (not built) |
| 9 | Purchases | Sandbox pending/cancel, duplicate/late callbacks, app closed after pay, wrong product, refund after use, restore | NOT_RUN | Stage E (not built, needs sandbox accounts) |
| 10 | Devices | Real iPhone Safari, real Android | NOT_RUN | Oz reported that play works well on his iPhone over LAN, but no structured device run was recorded |
| 10 | Devices | Two phones in the same room | NOT_RUN | |
| 10 | Devices | Router internet disconnected, LAN keeps working | NOT_RUN | |
| 11 | Security | No secrets in client or Git | PASS | scripts/export.mjs secret scan runs on every checkpoint; CSP 'self' only |
| 11 | Security | Hole card, shoe and physical ids never sent | PASS | I: "never sends the hole card, shoe or physical ids to clients"; E: frame inspection in "three separate browsers..." |
| 11 | Security | Client cannot change balances; per-user authorization | PASS | I: "three players...", "insufficient funds...", wrong user/stale version checks in "three players..." |
| 11 | Security | Restart recovery, exactly-once settlement | PASS | I: "restart recovery resumes the same hand and settles exactly once; emit failures do not lose state" |
| 11 | Ops | Backups and restore of production data, error alerts, budget limits | NOT_RUN | no production deployment |
| 12 | Performance | 60 fps and about 100 ms visual response on target devices | NOT_RUN | only headless Chromium figures exist (58.5 fps average, 78-82 ms localhost round trip), not target devices |

Status values: PASS (a test exists and passed in the last run), FAIL, NOT_RUN (no test, not built, or needs hardware or
accounts that are not available).

## Update after Stage A/B (branch upgrade/social-club, 2026-11-01)

Runs in Claude's cloud workspace: unit 24/24 PASS, integration 16/16 PASS (PostgreSQL 16), e2e 10/10 PASS (Chromium
emulation). Rows below override the matching NOT_RUN entries above.

| Area | Check | Status | Evidence |
|---|---|---|---|
| 1 | Normal hand, blackjack, push, bust, double, four-hand split rules and payouts | PASS | tests/unit/engine.test.ts (unchanged engine) |
| 1 | Cosmetics never change balances or rules | PASS | gifts.test.ts asserts gifts write no ledger rows; cosmetics only change `users.card_back/table_theme` |
| 2 | New deal of any size animates (no >10 skip) | PASS | social.spec.ts "presentation" (running card animations after deal) |
| 2 | Reload or reconnect does not replay old animations | PASS | social.spec.ts "online reload mid-round hydrates" (0 running animations after reload) |
| 2 | New local game does not inherit seen cards | PASS | social.spec.ts "presentation" (pass-and-play after practice animates) |
| 3 | 6 players, long Hebrew names, 320/360/390/430 px, landscape, text at 125% | PASS (emulation) | social.spec.ts "lab layouts" |
| 3 | Real Safari toolbars, keyboard, safe areas on iPhone | NOT_RUN | needs a physical iPhone |
| 4 | Reduced-motion switch mid-animation | PASS | social.spec.ts "presentation" (emulateMedia reduce, 0 running animations) |
| 4 | Background/resume near turn end, rapid snapshots | PARTIAL | visibilitychange triggers hydrate in code; not covered by an automated test |
| 5 | Gift once per event id under concurrent retries | PASS | tests/integration/gifts.test.ts |
| 5 | Gift rate limit (1 per 6 s, 30 per hour), no self gift | PASS | gifts.test.ts, social.spec.ts toast check |
| 5 | Per-person mute, gift kept on reload without replay | PASS | social.spec.ts "gifts and reactions" |
| 5 | Gift never hides cards, totals, buttons or timer | PASS (visual review) | docs/screenshots/after-*.png |
| 5 | Sender left the room, expiry while disconnected | PARTIAL | expiry covered (gifts.test.ts); sender-left not automated |
| 6 to 9 | Wheel, scratch, missions, identity, purchases | NOT_RUN | not built (Stage C to E) |
| 10 | Real iPhone and Android, two devices in one room, router WAN off | NOT_RUN | Oz reported the LAN host working with an iPhone on 2026-11-01 (not verified by Claude) |
| 12 | 60 fps and 100 ms visual response on target devices | NOT_RUN | headless Chromium only: 58.5 fps average during a deal, 78 to 82 ms local command round trip |

## Update after Stage C (branch upgrade/stage-c, 2026-11-01)

Runs in Claude's cloud workspace: unit 26/26 PASS, integration 34/34 PASS (PostgreSQL 16), e2e 15/15 PASS (Chromium
emulation, one worker). Rows below override the "identity" part of the 6 to 9 row above.

| Area | Check | Status | Evidence |
|---|---|---|---|
| 1 | Split aces A+Q vs dealer 6+5+10 is a 21 push, not a natural; totals 100 staked, 50 back (Oz screenshot) | PASS | engine.test.ts regression; label "21 אחרי פיצול" in account.spec.ts and docs/screenshots/stage-c-split21.png |
| 1 | The same A+Q as the original two cards is a natural and beats a three-card dealer 21 at 3:2 | PASS | engine.test.ts |
| 7 | Guest saves the account with recovery codes and restores it on another browser | PASS | identity.test.ts, account.spec.ts |
| 7 | Device pairing code: single use, 10 minutes | PASS | identity.test.ts, account.spec.ts |
| 7 | Leaving an unsaved guest needs explicit confirmation; nothing merged; wallets and ledger unchanged | PASS | identity.test.ts, account.spec.ts |
| 7 | Provider link keeps wallet, rotates session; sign-in on a second device | PASS (test key / test provider) | identity.test.ts (local RSA key as Google), account.spec.ts (test provider) |
| 7 | Token checks: aud, iss, exp, signature, alg, kid, nonce, nonce reuse, nonce bound to the browser | PASS | identity.test.ts |
| 7 | Same email, different subject: no merge; identity owned by another user cannot be linked | PASS | identity.test.ts |
| 7 | Facebook token for another app, expired or invalid is refused; secret never in responses | PASS (stubbed Graph) | identity.test.ts |
| 7 | Unconfigured Google/Facebook shown as "not set up", no active button, no provider host in CSP | PASS | identity.test.ts, account.spec.ts |
| 7 | Test provider refused in production, LAN, public origin | PASS | identity.test.ts |
| 7 | Sign out other devices closes their HTTP session and live socket | PASS | identity.test.ts, friends.test.ts |
| 7 | Account deletion: confirmation, refused while seated, data removed, history kept anonymously | PASS | identity.test.ts |
| 7 | Local practice coins never imported; shown separately from the online wallet | PASS | identity.test.ts (extra field ignored, ledger unchanged), account.spec.ts (IndexedDB value unchanged) |
| 7 | Invite link: preview without session, accept once, max uses under concurrency, expiry, revoke, self | PASS | friends.test.ts, account.spec.ts |
| 7 | Blocks: friend code, invite, gift, reaction, room by code, both directions | PASS | friends.test.ts, account.spec.ts |
| 7 | Migration 003 on an existing embedded (LAN) database keeps sessions valid | PASS | one-off PGlite upgrade check (not part of the suites) |
| 7 | Real Google and Facebook sign-in | NOT_RUN | no provider app, no public HTTPS origin (docs/PROVIDER_SETUP.md) |
| 7 | Recovery and invite flows on real phones, share sheet on iOS/Android | NOT_RUN | needs Oz's devices |
