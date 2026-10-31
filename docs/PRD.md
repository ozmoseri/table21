# TABLE21 product requirements (v1)

Working name TABLE21. Hebrew descriptor: "בלאק ג׳ק עם החבר׳ה".

## Goal
A polished social blackjack table for Oz and his friends, on iPhone first, plus Android and desktop browsers. Everyone at a table plays their own hands against one dealer; friends compete through session results and private group leaderboards.

## Boundaries
- Fictional coins only. No real-money purchase, deposit, withdrawal, cash value, crypto, prize, redemption or user-to-user transfer. No payment provider.
- Private groups only. No public rooms, no fake players. Optional bots must be labeled.
- No forced ads, spending prompts or penalties for missed days. Rewarded ads are a disabled adapter until a real provider is configured (`apps/server/src/ads.ts`).

## Economy defaults (configurable)
| Item | Default |
|---|---|
| Welcome grant | 2,000 coins once per server identity |
| Daily grant | 300 coins per Asia/Jerusalem calendar day (UTC stored) |
| Rescue refill | 500 coins when balance is below the minimum stake, once per 6 h (server time) |
| Table stakes | 10 / 25 / 50 / 100 / 250 |
| Seats | 1 to 6 players plus a dealer position |
| Turn time | 25 s |

## Modes
| Mode | v1 status target |
|---|---|
| A. Online private rooms (code, link, QR, ready, stake, synchronized play) | Required |
| B. Solo practice and same-device pass-and-play (offline after caching, separate practice coins) | Required |
| C. LAN with a computer host (phones on same Wi-Fi, no internet) | Second milestone, same server and client |
| D. Phone-only LAN (no computer, no internet) | Research only, see PHONE_LAN_RESEARCH.md |
| E. "ערב חברים" equal-stack match (10 rounds, same separate stack, no top-ups) | Required |

## Dealer modes
- Automatic dealer: server deals and plays by fixed rules.
- Friend dealer (presenter): starts the deal and triggers reveal/draw steps. Cannot play a hand at the same table, cannot choose or see cards early, and never risks personal coins. Optional rotation every 5 completed rounds. Disconnect or timeout hands over to the automatic dealer without changing the outcome.

## Screens
Home, onboarding (name + avatar), create/join room, table, round result, session (match) result, friends/groups, profile (stats and cosmetic unlocks), leaderboard (weekly gameplay or balance, group scoped), rewards, settings/help, LAN host info.
States: loading, empty, rejected invite, full room, insufficient coins, wrong turn, joining mid-round, duplicate tab, reconnecting, host or dealer disconnect, server restart, session ended.

## Fair competition
- Weekly group ranking: settled online casual hand profit/loss only (grants, rescue, ads and adjustments excluded), since Monday 00:00 Asia/Jerusalem, with a minimum number of hands (default 20) and visible sample size.
- Balance board is labeled as a balance comparison, not skill.
- The equal-stack match is the preferred friendly competition.

## Identity
Server-created guest sessions (httpOnly cookie). Cross-device recovery is not available in v1 and is labeled as such. No fake account provider.

## Non-goals for v1
Free-text or voice chat, insurance/surrender/side bets, financially exposed friend bank, native store builds, real ads.
