# TABLE21 - development conventions

Social blackjack for Oz and friends. Fictional coins only: no purchases, cash value, redemption or transfers.

## Commands
```bash
pnpm install
node scripts/db.mjs start        # isolated Postgres in .data/pg, port 55432
pnpm migrate                     # needs DATABASE_URL, else embedded PGlite
pnpm dev                         # server :3021 (tsx watch) + Vite :5173 (proxies /api, /socket.io)
pnpm build && pnpm start         # one port :3021 serves API, realtime and built client
pnpm lan                         # LAN host, 0.0.0.0:3021, embedded DB in .data/lan
pnpm test:unit                   # engine rules (vitest)
pnpm test:integration            # needs local Postgres (table21_test)
pnpm test:e2e                    # Playwright, Chromium only
pnpm export <label>              # sanitized tar.gz + git bundle + SHA-256 in exports/
pnpm db:backup export|restore|verify <DATABASE_URL> <file.json.gz>   # restore only into an empty DB
pnpm perf <baseUrl> <label> [out.json]   # page weight + LCP (needs a VITE_LAB=1 build for the table page)
```

## Layout
- `packages/game-engine` pure rules and state machine. No React, DB or network. RNG injected.
- `packages/protocol` zod command schemas, snapshot types, `toPublicRound` redaction.
- `apps/server` Fastify + Socket.IO, `RoomManager` (rooms.ts), wallet ledger, social, SQL migrations.
- `apps/web` React 19 + Vite 8 PWA, hash routes, local solo and pass-and-play.
- `tests/unit`, `tests/integration`, `tests/e2e`; `scripts/`; `docs/`.

## Authority boundaries (do not break)
- The server owns cards, shoe, shuffle, turns, timers, rule checks, balances, grants and settlement.
  Clients send intentions only.
- Never send the shoe, physical card `uid`s or the unrevealed hole card to any client, spectator,
  presenter dealer or replay. Client views are built only by explicit allowlists (`toPublicRound`,
  `RoomManager.snapshots`). Never spread engine state into a response.
- Money is integer half-coin units (2 units = 1 coin). No floats in wallet math.
- Every command carries `commandId` (idempotent via the `commands` table) and `expectedVersion`.
  Turn-sensitive commands (`action`, `dealer_step`, `deal`) require an exact version match.
- Wallet changes lock the wallet row (`select ... for update`) inside the same transaction as the
  rule check. Settlement and voids are exactly once (`finished_at` guard + ledger `idem_key`).
- Emit only after commit. Clients recover with a full snapshot.
- Shoe factories / seeded RNG are test-only. No debug seed, fixed deck or admin wallet route in production.
- A presenter dealer only triggers mandatory steps; payouts use the system bank.

## Boundaries with Oz
- Reply to Oz in Hebrew. Never use the em dash character; plain hyphen only when needed.
- No paid generation (Higgsfield/Figma/Lovable MCP budget is zero). Art is original SVG/CSS.
- No deployments, external accounts/projects, repo creation or changes to existing services
  (including any Adeline project or the `adeline-returns` Supabase project) without Oz's explicit instruction.
- Never ask for or print secrets. `.env.example` holds names only.
- Physical iPhone/Android/Wi-Fi tests are NOT_RUN unless actually performed on devices.
