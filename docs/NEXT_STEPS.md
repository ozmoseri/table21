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
