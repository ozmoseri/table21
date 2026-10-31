# Capability audit (1 November 2026)

Read-only audit of the Claude cloud workspace, then rechecked only where the build needed it.
Statuses: VERIFIED_AVAILABLE, PRESENT_UNTESTED, MISSING, BLOCKED, NOT_NEEDED_YET.

| Area | Status | Evidence |
|---|---|---|
| OS / tools | VERIFIED_AVAILABLE | Ubuntu 24.04, 2 vCPU, 7.8 GB RAM, Node 22.23, pnpm 10.28, Bun 1.4, Python 3.13, Git 2.43, ffmpeg, sudo |
| Workspace persistence | BLOCKED | Ephemeral cloud container; code must leave via downloadable checkpoints or an approved repo |
| Existing project | MISSING (at audit) | Empty workspace, no repo or CLAUDE.md; no table21 repo found on GitHub, no Vercel projects |
| PostgreSQL 16.15 | VERIFIED_AVAILABLE | Temporary cluster started and queried; build uses `scripts/db.mjs` |
| Redis 7 | VERIFIED_AVAILABLE / NOT_NEEDED_YET | Single-process authority does not need it |
| Docker | BLOCKED | CLI present, daemon not running; not required |
| Playwright 1.63 + Chromium 153 | VERIFIED_AVAILABLE | 3 isolated mobile contexts, local WebSocket round trip, offline simulation, screenshots |
| WebKit / Firefox | MISSING | Not installed; iPhone behavior only via Chromium emulation |
| Inbound access from phones / Wi-Fi | BLOCKED | Container has no inbound network |
| Linked computer | BLOCKED (at audit) | Bridge tools present, computer offline, OS unknown |
| macOS / Xcode | MISSING | Linux only |
| Android SDK / emulator | MISSING | Java 21 and Gradle 8.14 present; no SDK, no /dev/kvm |
| mkcert / cloudflared / ngrok | MISSING | Not installed |
| GitHub | PRESENT_UNTESTED | Connector lists repos; gh CLI token invalid; no write tested |
| Supabase connector | VERIFIED_AVAILABLE | Existing projects are unrelated (adeline-returns etc.) and must not be reused |
| Vercel connector | VERIFIED_AVAILABLE (read) | Team visible, no projects; nothing deployed |
| Higgsfield connector | VERIFIED_AVAILABLE | Credits and models readable; MCP unlimited not available; build budget is zero |
| Lovable | VERIFIED_AVAILABLE | Not used (credit-consuming, not suited) |
| Skills | PRESENT | frontend-design (read and applied), web-artifacts-builder, cinematic-3d-web, theme-factory, canvas-design, algorithmic-art, hyperframes, video-making |

## Rechecked during the build
- npm registry reachable; pinned versions: React 19.3, Vite 8.3, Fastify 5.12, Socket.IO 4.8, zod 4.6, pg 8.23, PGlite 0.5.14, Vitest 5.0, TypeScript 5.9.3, @playwright/test 1.63.0 (matches the installed Chromium).
- Local Postgres cluster in `.data/pg` (port 55432) used for migrations and integration tests.
- Embedded PGlite smoke-tested in Node 22 (transactions with `for update`).
- No `/dev/kvm`, so no Android emulator.

## Corrections from Oz's brief v2
- Vercel: per the brief, WebSockets in Vercel Functions became generally available on 20 Oct 2026. This is after Claude's knowledge and was not independently verified here. It does not make a process-local room authority portable; see DEPLOYMENT.md.
- Apple: a free Personal Team can build to personal devices with limits; paid membership is needed for TestFlight and distribution.
