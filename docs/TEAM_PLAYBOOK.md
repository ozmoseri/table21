# TABLE21 team playbook

> **סיכום לעוז:**
> - **מה זה:** שיטת עבודה של צוות סוכנים. מנהל אינטגרציה אחד (הסשן הראשי) ומומחים לפי צורך, עד 3 שכותבים קוד במקביל.
> - **איך עובדים:** כל מומחה עובד בענף נפרד, מוסר "handoff" עם ראיות, ורק המנהל משלב ל-main.
> - **מי מאשר:** QA עצמאי בודק את הגרסה המשולבת, לא את הענפים.
> - **בפרויקט הבא:** מעתיקים את `.claude/agents`, את המסמך הזה ואת `docs/handoffs`, ומחליפים את מקורות האמת.

## 1. Roles and ownership

| Role | Agent file | Owns | Never touches |
|---|---|---|---|
| Integration manager | main session | plan, task list, contracts, merges to `main`, acceptance | - |
| Art director | `.claude/agents/art-director.md` | design decisions, tokens proposals | code (read-only) |
| Asset processor | `asset-processor.md` | `assets/manifest.json`, `apps/web/public/art/**`, asset scripts | UI code, engine |
| Frontend / UX | `frontend-ux.md` | `apps/web/src/screens/**`, `components/**`, layout CSS, i18n strings | engine, server, protocol |
| Game feel / audio | `game-feel-audio.md` | `apps/web/src/feel.ts`, `anim/**`, `presentation.ts`, `fx/**`, `sound.ts`, `haptics.ts` | rules, odds, settlement |
| Backend / reliability | `backend-reliability.md` | `apps/server/**`, `packages/protocol/**` (contract changes via the manager) | presentation |
| Product / economy | `product-economy.md` | journeys, economy map, prioritized backlog (docs) | code (read-only) |
| QA (independent) | `qa-independent.md` | acceptance report on the integrated commit | code fixes (returns bugs to owners) |

Shared files that need the manager's coordination: `apps/web/src/i18n.ts`, `apps/web/src/theme/premium.css`,
`packages/protocol/src/index.ts`, `assets/manifest.json`, `CLAUDE.md`, `docs/QA_REPORT.md`. One writer at a time.

## 2. Models and parallelism (checked 2026-11-03)

The Agent tool in this environment offers `opus`, `sonnet`, `haiku` and `fable`.
- **Integration, contracts, hard bugs:** `opus`, the main session.
- **Defined implementation and review tasks:** `sonnet`.
- **Mapping, extraction, summaries:** `haiku`.
- **`fable`:** not used by default.
- **Parallelism:** at most 3 code-writing agents at once, each in its own git worktree (`isolation: worktree`).
  Read-only research and review run separately.

## 3. Sources of truth (one per domain)

| Domain | Source | Check |
|---|---|---|
| Client-server messages, snapshots, redaction, `PROTOCOL_VERSION` | `packages/protocol/src/index.ts` (zod + types) | integration tests, `toPublicRound` allowlist |
| Reaction and gift ids | `REACTIONS`, `GIFTS` in `packages/protocol` | `tests/unit/contracts.test.ts`: every id has he/en text and art, no extras |
| Assets | `assets/manifest.json` | contracts test: file exists, bytes/dimensions/alpha match, no orphan files, no duplicate ids |
| Feel (motion timings, celebration, voices, volumes, haptics) | `apps/web/src/feel.ts` | unit tests pin values; rules live only in `packages/game-engine` |
| Design tokens | `:root` in `apps/web/src/theme/tokens.css`, described in `docs/DESIGN_SYSTEM.md` | art director review |
| Approved design decisions | `C:\Users\user\table21_design\DECISIONS.md` (Oz's PC) | appended, never rewritten |
| Strategy advice | `apps/web/src/coach.ts` (guide charts are generated from it) | `tests/unit/coach.test.ts` |
| Store catalog | not started. `store-contract.json` is created only when store work starts; no invented product ids | - |

Rules:
- No shared id outside its source.
- No hand-copied enums.
- Contract changes go through the manager, with types, tests and every consumer updated together.
- No secrets in contracts.

## 4. A task, end to end

1. **Brief:** the manager creates the task in the built-in task list (the one status board) with one goal; inputs and
   decisions; dependencies; owned files; files that need coordination; acceptance criteria; required tests; the
   output for the next agent.
2. **Spawn:** the agent runs with `isolation: worktree`, `base_commit` = current `main`.
   - **e2e port and database:** each parallel agent gets its own, `T21_E2E_PORT` (3122, 3123, 3124) and
     `T21_E2E_DATABASE_URL` (`table21_e2e_b`, `_c`, `_d`).
   - **Integration tests:** they share `table21_test`, so they run only on `main` by the manager.
3. **Handoff:** the agent commits in its branch, writes `docs/handoffs/<task_id>.json`
   (format: `docs/handoffs/README.md`) and returns the JSON. Status `ready_for_review`.
4. **Integrate:** the manager merges into `main`, resolves conflicts, runs typecheck + unit + the touched e2e, and
   sets status `accepted` or sends it back.
5. **QA:** an independent pass on the integrated commit, with evidence classes: automated / emulated / physical /
   listened / NOT RUN.
6. **Delivery:** commit + build id, how to open it on the phone (`docs/OPEN_TESTED_VERSION.md`), screenshots,
   video with sound, test results, what was not tested, real blockers only.

## 5. Assets

- **Pipeline:** brief -> generation -> visual review -> processing -> file check -> in-game check.
- **Higgsfield:** Oz runs it manually in the web UI with Unlimited. Any MCP generation or credit spend needs a list of
  assets, count, cost and cap approved first. Independent work continues meanwhile.
- **Per asset:** id, usage, source/license, version, dimensions, bytes, format, alpha, anchor, fallback, status.
- **Checks:** real alpha, edges on dark and light, halos, detail at display size, weight, no layout shift.
- **No game text in images:** no UI text, balances, buttons or names baked in. Ranks and suits are code.
- **OCR:** may flag an asset for review but never rejects it automatically.

## 6. Feel tests (test environment only)

`tests/e2e/feel-bot.spec.ts` runs:
- fast and slow players;
- double taps;
- rotation mid-deal;
- background and return;
- disconnect and reconnect;
- 6 players and 4 split hands;
- long round sequences without leftover nodes, voices or timers.

Random delays use a logged seed. The bot measures order, responsiveness, overlap, stability and lost input. It does
not measure fun or sound quality, never tunes rules, odds or payouts, and never joins real rooms as a fake friend.
Listening and play on a physical phone are separate checks, marked NOT RUN until a person does them.

## 7. Next project

- **Copy:** `.claude/agents/*`, this playbook and `docs/handoffs/` (README + schema).
- **Rewrite:** section 3 with the new project's sources of truth, and the "never touches" column.
