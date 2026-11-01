# Next steps (living checkpoint log)

## Source of truth and sync
- GitHub `ozmoseri/table21` (private), branch `main`, is the source of truth.
- Active development happens in Claude's cloud workspace (it has PostgreSQL and Playwright) and is pushed.
- Oz's computer copy lives at `C:\Users\user\table21` and is only updated with `git pull`. Do not edit it.

## Completed
- M1: game engine with 24 unit tests.
- M2: authoritative server on PostgreSQL with 13 integration tests.
- M3: web client (all screens, original SVG art, motion, sound, PWA service worker), 6 Chromium e2e tests,
  LAN host script (`pnpm lan`, `scripts/start-lan-windows.ps1`), docs set, asset request manifest.
  See docs/TEST_REPORT.md.

## Commands
```bash
pnpm install
node scripts/db.mjs start          # local PostgreSQL for tests/dev
pnpm test:unit && pnpm test:integration && pnpm test:e2e
pnpm build && pnpm start           # http://127.0.0.1:3021
pnpm lan                           # phones on the same Wi-Fi
```

## Open items
1. Physical device checks (docs/TEST_REPORT.md, "Not run").
2. Choose an online host for friends on different networks (docs/DEPLOYMENT.md). Needs Oz's approval.
3. Optional: labeled practice bots; account linking for cross-device recovery; free-text chat.
4. Phone-only LAN: native spike per docs/PHONE_LAN_RESEARCH.md (needs Mac + Xcode + devices).
5. Manual Higgsfield assets per assets/higgsfield-requests.json (budget 0 via MCP).

## Next small step
Oz runs the LAN host on Windows and plays one round with two phones; fix whatever the phones reveal.

## Blockers and decisions waiting for Oz (2026-11-01)

1. Art direction: A (Club Lounge) is implemented as the working direction. Confirm A, or pick B or C on the canvas.
2. Higgsfield: the direct connection has no Unlimited (every generation costs credits; 2 credits per Nano Banana 2.1
   image in the account history). Either sign in to Higgsfield yourself in the Claude browser pane on the PC so included
   generation can be checked there, or approve a credit package (trial kit: table, card back, chips, coffee gift).
   Spent so far: 0 credits.
3. Listen to `table21-sound-demo.m4a` and Settings > Sound check on the phone; report anything too loud, quiet or annoying.
4. Phone checks: portrait and landscape table, rotation during a deal, Safari toolbars, background and return.
5. Google/Facebook sign-in need a public HTTPS domain and provider apps (docs/PROVIDER_SETUP.md).
6. The GitHub repository is public.

## Open from the premium round (stage 6, needs Oz's decision: these change server data or rules)

- Play Now: auto-seat at a table with other players (today every table is private, friends only).
- Table tiers (Club 10 / Lounge 100 / Salon 1K / Private 10K) with min and max stakes.
- Progression: XP per hand played (never per coin wagered), levels unlocking cosmetics only.
- Daily challenges (3 per day) and a friends-only weekly leaderboard.
- Chip payout flights at settlement (client only, left out of stage 5 to keep the result readable in 500 ms).
- Recorded CC0 sounds (Kenney casino pack) to replace the synthesized set: needs the files attached, the workspace cannot download them.
