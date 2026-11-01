# Test report

Run date: 1 November 2026, in Claude's cloud workspace (Ubuntu 24.04, Node 22.23, PostgreSQL 16.15,
Playwright 1.63 with Chromium 153). All counts below are from actual runs; nothing is estimated.

| Suite | Command | Result |
|---|---|---|
| Unit (engine rules, payouts, property tests) | `pnpm test:unit` | PASS 24/24 |
| Integration (real PostgreSQL: wallet, rooms, recovery) | `pnpm test:integration` | PASS 13/13 |
| E2E (Chromium, separate browser contexts) | `pnpm test:e2e` | PASS 6/6 (after fixes below) |
| Typecheck (4 packages) | `pnpm typecheck` | PASS |

## Engine (tests/unit/engine.test.ts)
Six-deck shoe with 312 unique physical ids and no jokers, unbiased crypto RNG range, Fisher-Yates
permutation property, multiple aces and soft/hard totals, 3:2 natural (100 -> 250 gross), push/win/lose
gross returns, both naturals push, dealer natural at the peek (ace and ten upcards), hole card stays
hidden after a negative peek, natural beats a dealer multi-card 21, multi-card 21 pays 1:1, dealer stands
on soft 17, dealer hits 16 and busts while a busted player still loses, equal totals push, double
(one card, stands, needs funds, not after a hit), split identical ranks only (K+K yes, K+Q no) and only
when funded, double after split, stable split order, resplit up to four hands, split aces one card each
paying 1:1, timeout stand, presenter dealer mandatory step order, shoe exhaustion voids the round
(at deal and mid-hand), odd-unit stake rejection, and 300 random multi-seat rounds with no duplicate
physical card and bounded returns.

## Money and realtime (tests/integration/rooms.test.ts, PostgreSQL)
Three players with exact payouts and ledger consistency; wrong player and stale version rejected;
duplicate command id applied once (concurrent); five concurrent bets keep `available + reserved`
constant; invalid stake; one wagering seat per player across rooms (cross-room double spend);
insufficient funds for bet and double; redaction (no hole card, shoe or uid in snapshots); turn
timeout auto-stand; leaving mid-round keeps the stake and pays the result; process crash after commit
before emit, then restart recovery resumes the identical hand and settles exactly once; stale timer
tick cannot settle twice; shoe exhaustion voids and refunds every stake exactly once and reshuffles;
presenter dealer cannot sit or peek, only the presenter triggers steps, automatic dealer takes over on
disconnect with the same draws, presenter coins never at risk; equal-stack match (locked betting before
start, late joiner locked out, separate stacks, finishes after N rounds, casual wallet untouched);
reconnect window releases a seat only after the grace period; daily grant once per Jerusalem day
under concurrency; rescue only below the minimum stake and once per 6 hours under concurrency; weekly
group ranking equals settled casual hand net only, enforces minimum hands and membership.
Every money test ends with `assertLedgerConsistent`: each wallet equals the sum of its ledger rows
and never goes negative.

## Browser (tests/e2e, Chromium device emulation, NOT real phones)
1. Three isolated browser contexts (three server identities): create room, join by code, sit, bet,
   play real turns (hit and stand), automatic dealer, settlement. All three received the same dealer
   cards; each `/api/me` balance equals 2,000 - stakes + gross returns from the round; reserved is 0.
   Every socket frame was inspected: no `shoe`, no `uid`, hole card has no rank/suit while hidden.
2. Network drop (context offline) and page refresh mid-hand: reconnecting banner, other player sees
   the seat as offline, reconnect returns to the same round id and the hand finishes.
3. Friend as presenter dealer: cannot sit, never receives the hole card, triggers reveal, then
   disconnects; the automatic dealer finishes the round and stakes are settled.
4. Offline: built app with an activated service worker; network off; solo practice round and
   pass-and-play round (with the "pass the phone" handoff) both complete; zero requests to any
   external origin during the whole test.
5. Layouts: 360x640, 430x932, 820x1180, 1280x800 and 844x390 landscape, Hebrew RTL and English LTR,
   20-character name: no horizontal overflow on home, profile, leaderboard, settings, friends and the
   table; action buttons are at least 48px tall.
6. Reduced motion (system preference) and keyboard play (Enter on chips, `s` to stand).

Screenshots from these runs are in `docs/screenshots/`.

## Bugs found by the tests and fixed
- Early auto-deal fired as soon as the first seated player bet while friends were still joining.
  Now the early deal waits while any connected member is only watching.
- The global rate limit counted static files, so several browsers (or friends behind one home IP)
  were blocked with HTTP 429. Limits now apply to `/api/*` only and are keyed per session.
- Navigating from solo practice to pass-and-play reused the solo game. Fixed by remounting per mode.
- `@fastify/static` header setter API change caused HTTP 500 on static files. Fixed.
- Reserved SQL keyword `natural` as a column name. Renamed to `is_natural`.

## Measurements (headless Chromium in the cloud workspace, not a phone)
- Frame pacing during a deal animation: 120 frames, average 58.5 fps, p95 frame 16.8 ms, worst 33.4 ms.
- Command round trip on localhost: sit -> stake picker visible 78 ms; bet click -> confirmed 82 ms.
These are indicative only. Real-phone performance is NOT measured.

## Not run (needs Oz's devices or network)
| Check | Status |
|---|---|
| Real iPhone Safari and installed PWA (home screen, offline) | NOT_RUN |
| Real Android Chrome and installed PWA | NOT_RUN |
| WebKit automation | NOT_RUN (WebKit is not installed in this workspace) |
| Computer-hosted LAN with phones on real Wi-Fi | NOT_RUN |
| LAN with WAN disconnected (router internet unplugged) | NOT_RUN |
| HTTPS LAN with mkcert root CA on phones | NOT_RUN |
| Phone-only LAN (no computer) | NOT_IMPLEMENTED (research only, docs/PHONE_LAN_RESEARCH.md) |
| Native iOS/Android builds | NOT_IMPLEMENTED |
| Rewarded ads | DISABLED (not configured, by design) |
| Public deployment | NOT_DEPLOYED |

## Manual phone checklist for Oz
1. Run the LAN host on the computer (`scripts/start-lan-windows.ps1` or `pnpm lan`), open the printed
   address on two or three phones on the same Wi-Fi.
2. Each phone: choose a name and character. One creates a room and shares the code; the others join.
3. Sit, bet, play a few rounds; check that balances on each phone match the result panel.
4. Lock one phone for 20 seconds mid-hand, unlock: it should return to the same hand.
5. Try the friend-dealer mode and a friends night.
6. Unplug the router's internet (keep Wi-Fi on) and play another round.
7. Note anything that looks wrong on iPhone (safe areas, fonts, sounds, haptics) and send screenshots.


## Stage C run (2026-11-01, branch upgrade/stage-c)

| Suite | Command | Result |
|---|---|---|
| Unit | `pnpm test:unit` | PASS 26/26 (2 new: split-aces regression from Oz's screenshot, natural vs three-card 21) |
| Integration (PostgreSQL 16) | `pnpm test:integration` | PASS 34/34 (new: identity.test.ts 12, friends.test.ts 6) |
| E2E (Chromium, one worker) | `pnpm test:e2e` | PASS 15/15 (new: account.spec.ts 5) |
| Typecheck (4 packages) | `pnpm typecheck` | PASS |

Screenshots: docs/screenshots/stage-c-*.png. Not run: real Google/Facebook, real phones, HTTPS deployment.

## Art direction and layout run (2026-11-01)

| Suite | Result |
|---|---|
| Typecheck | PASS |
| Unit | PASS 26/26 |
| Integration (PostgreSQL 16) | PASS 34/34 |
| E2E (Chromium, one worker) | PASS 17/17 (new: layout-v4.spec.ts 2) |
| Sound demo (offline render) | 108 sounds, 0 dropped, peak -4.1 dBFS, max 1 at a time |

Not run: real iPhone/Android, rotation on a device, listening tests, Higgsfield assets.
