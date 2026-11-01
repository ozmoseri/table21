# Deployment options (nothing deployed)

Update 2026-11-01: the free test server path is prepared and rehearsed for Render: see docs/DEPLOY.md.

No deployment, account or project has been created. Every option below requires Oz's explicit instruction.

## Shape of a deployment
One persistent Node process (`pnpm build && pnpm start`) serving API, Socket.IO and the built client on one port, with a dedicated PostgreSQL (`DATABASE_URL`). The room authority is in-process (`RoomManager`), so run exactly one instance.

Required settings: `DATABASE_URL`, `PORT`, `HOST=0.0.0.0`, `T21_DEPLOYMENT=online`. Serve behind HTTPS (Secure cookie is set automatically for https requests; `trustProxy` is on). Run `pnpm migrate` before start.

## Option 1: Oz's computer + Cloudflare Tunnel
- Cost: free. Friends join from any network through the tunnel URL.
- Limits: works only while the computer is on and awake; home upload speed; computer is the host.
- Steps (after approval): install `cloudflared`, run `pnpm start` locally, `cloudflared tunnel --url http://localhost:3021` (quick tunnel) or a named tunnel on Oz's domain.

## Option 2: Persistent single-instance Node host
- Render, Fly.io or Railway style service with persistent WebSockets, 1 instance, health check `/api/health`.
- Database: a NEW dedicated Postgres, for example a new Supabase project named for TABLE21. Never reuse `adeline-returns` or any other existing project. The browser never connects to the database directly.
- Needs: Oz creates or approves the account/project; secrets set in the host's dashboard, never pasted into chat.

## Option 3: Vercel (caveats)
Oz's brief states that Vercel announced WebSockets in Functions as generally available on 20 Oct 2026 (Claude could not verify this independently; it is after Claude's knowledge). Even so, connections have a maximum lifetime and may land on different instances, so the current process-local authority is not portable unchanged. A Vercel path would need:
- shared durable room state (Postgres is already the source of truth per transaction),
- cross-instance event fanout (for example Postgres LISTEN/NOTIFY or a managed pub/sub),
- one authoritative owner or transactional action path per room,
- fencing so only one instance fires each room timer,
- forced-disconnect and reconnect tests across instances.
The static client alone can be hosted on Vercel, but then origin, cookie, CSRF and TLS settings must be adjusted for split origins.

## Native apps and ads
- iOS: a free Personal Team can install builds on Oz's own devices with limits; TestFlight and App Store need a paid Apple Developer membership. Requires a Mac with Xcode.
- Android: Android Studio/SDK; Play distribution needs a developer account.
- Rewarded ads stay disabled until a real provider, app IDs, SDK and server-side verification are configured.

## Checklist before any deploy
- [ ] Oz chose the option and approved account/project creation.
- [ ] Dedicated database created; `DATABASE_URL` set as a secret.
- [ ] HTTPS confirmed; cookies Secure.
- [ ] Single instance enforced.
- [ ] `pnpm test` and `pnpm test:e2e` pass on the release commit.
