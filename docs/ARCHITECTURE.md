# TABLE21 architecture

## Overview
```
apps/web (React 19 + Vite 8 PWA) --HTTP /api + Socket.IO--> apps/server (Fastify 5 + Socket.IO 4)
                                                             |-- RoomManager (single authoritative process)
                                                             |-- Social (groups, friends, grants, leaderboards)
                                                             '-- Db adapter: PostgreSQL (pg) or embedded PGlite
packages/game-engine  pure rules, used by server and by the browser for local modes
packages/protocol     zod schemas, snapshot types, toPublicRound redaction
```
One Node process serves the API, realtime and the built client on one port (3021). In development Vite (5173) proxies `/api` and `/socket.io`.

## Packages
- `game-engine`: `cards.ts` (shoe, `cryptoRng`, Fisher-Yates, totals), `round.ts` (`startRound`, `legalActions`, `requiredStake`, `applyAction`, `timeoutStand`, `nextDealerStep`, `dealerStep`, `playDealer`, settlement). Immutable transitions via `structuredClone`. RNG injected; seeded RNG lives only in `tests/`.
- `protocol`: `Command` discriminated union (`sit`, `leave_seat`, `bet`, `clear_bet`, `deal`, `action`, `dealer_step`, `claim_dealer`, `release_dealer`, `settings`, `start_match`), `RoomSnapshot`, `PublicRound`, `toPublicRound`.

## Server modules (`apps/server/src`)
| File | Role |
|---|---|
| `app.ts` | `buildApp`: routes, CSRF guard, rate limits, CSP, static client, Socket.IO handlers |
| `rooms.ts` | `RoomManager`: per-room serialized queue, transactions, phases, timers, settlement, voids, recovery, snapshots |
| `wallet.ts` | `lockWallet`, `move` (ledger entry + balance update, idempotency key, no negatives) |
| `auth.ts` | guest creation with welcome grant, session token lookup (sha256 hash stored) |
| `social.ts` | daily/rescue grants, stats, history, profile, groups, friends, leaderboards |
| `db.ts` | `postgresDb`, `embeddedDb` (PGlite, serialized), `migrate` |
| `ads.ts` | disabled rewarded-ad adapter boundary |
| `main.ts` | env config, migrations, `recover()`, listen, graceful shutdown |

## Data layer decision
Plain SQL migrations (`apps/server/migrations/*.sql`) plus `pg` with explicit `select ... for update` transactions, instead of Drizzle. Reason: room and wallet serialization depends on explicit row locks and ordered locking; the schema is small, and typing is done with TS interfaces. The embedded PGlite adapter provides a zero-install database for local and LAN hosting with the same SQL.

Tables: `users`, `sessions`, `wallets` (scope `casual` or `match:<id>`), `ledger`, `grant_claims`, `groups`, `group_members`, `friendships`, `rooms` (incl. server-only `shoe`), `seats` (unique per user: one wagering seat across rooms), `rounds` (server-only engine state + meta), `settlements`, `hand_results`, `commands` (idempotency), `matches`, `match_entries`.

## Command flow
1. Socket `cmd` is rate limited, parsed with zod, and must target the room the socket joined. Actor identity comes from the session cookie, never from the payload.
2. `RoomManager.command` runs in the room's serial queue and one DB transaction: duplicate check (`commands` PK) -> `select ... for update` on the room -> version check -> handler (wallet row locks for money) -> save room (`version + 1`) -> record result.
3. After commit: reschedule the room timer and emit per-user snapshots. Emission failures never lose state; clients resync with `room:sync`.

## Integrity rules
- Stakes are reserved (available -> reserved) when placing a bet, double or split, in the same transaction as the funds check.
- Settlement: `rounds.finished_at` guard plus ledger `idem_key` (`settle:<round>:<user>`) make it exactly once. Voids use `void:<round>:<user>`.
- Timers are fenced by room version: a stale timer is a no-op.
- Restart: `recover()` reloads committed rooms and resumes deadlines. A started hand is never re-dealt; its shoe is in the stored round state.
- Disconnect: 60 s seat reservation between rounds; turn timers still apply; leaving mid-round does not undo the stake. A disconnected presenter is replaced by the automatic dealer.
- Snapshots are explicit allowlists. The hole card is `{ id, hidden: true }` until revealed. Public card ids are `<roundId>:<drawSlot>`, which reveal nothing about the shoe.

## Web client
Hash routes (`#/`, `#/onboard`, `#/practice`, `#/pass`, `#/create`, `#/join`, `#/r/CODE`, `#/friends`, `#/profile`, `#/leaderboard`, `#/rewards`, `#/settings`, `#/help`, `#/lan`). Socket.IO client; animation via Motion driven by snapshot diffs with stable card ids (correctness never depends on animation callbacks). Local fonts via @fontsource (Heebo UI, Libre Bodoni card indices, Inter tabular numerals). IndexedDB (idb-keyval) only for settings and offline practice coins, never online balances. Custom service worker generated at build, registered only in secure contexts.

## Security
CSP `default-src 'self'` (no CDNs), httpOnly SameSite=Lax cookie, CSRF header (`x-t21: 1`) plus Origin check on writes and on the Socket.IO handshake, request rate limits, command token bucket, reaction cooldown, display-name sanitization, 16 KB body limit.
