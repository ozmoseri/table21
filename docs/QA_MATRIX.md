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
