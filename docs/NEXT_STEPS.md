# Next steps (living checkpoint log)

## Completed
- M1: game engine (packages/game-engine), 24 unit tests passing.
- M2: authoritative server (apps/server) on PostgreSQL 16: ledger, idempotent commands, rooms, auto and
  presenter dealer, timeouts, settlement, voids, matches, grants, groups, leaderboards, restart recovery.
  13 integration tests passing.
- M3 (in progress): web client (apps/web) builds and runs: onboarding, home, online room, solo practice,
  pass-and-play, friends/groups, leaderboard, profile, rewards, settings/help, LAN page. Original SVG art,
  Higgsfield request manifest, docs set, LAN and dev scripts.

## Not yet verified
- tests/e2e (Playwright, 3 browser contexts) written; first full run was interrupted. Rerun:
  `node scripts/db.mjs start && pnpm test:e2e`.
- Offline (service worker) e2e and viewport sweep not written yet.

## Next small step
Run the e2e suite, fix failures, add offline + viewport checks, write docs/TEST_REPORT.md.
