# Next steps (living checkpoint log)

## Completed
- M1: game engine (packages/game-engine) with 24 rule/payout/property tests.
- M2: authoritative server (apps/server): Postgres schema + migrations, guest sessions, wallet ledger with
  available/reserved funds, idempotent commands, rooms with auto and presenter dealer, timeouts, settlement,
  voids, equal-stack matches, grants, groups, leaderboards, restart recovery. 13 integration tests on PostgreSQL 16.

## In progress
- M3: web client (apps/web).

## Commands
```bash
pnpm install
node scripts/db.mjs start
pnpm test:unit
pnpm test:integration
```

## Next small step
Build apps/web: onboarding, home, solo table using the engine locally, then online rooms over Socket.IO.
