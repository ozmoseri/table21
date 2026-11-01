# Free test server (Render)

> **סיכום לעוז:**
> - **השרת שבחרתי:** Render. זה המסלול החינמי היחיד מתוך שלושת המועמדים שלא דורש כרטיס אשראי. Koyeb דורש כרטיס, ו-Fly לא מציע מסלול חינמי ללקוחות חדשים.
> - **מה מוכן בקוד:** קובץ הגדרות (`render.yaml`), חזרה לאותה יד אחרי הפעלה מחדש, מסך "השרת מתעורר", ו-PWA.
> - **למה לא פרסתי בפועל:** אסור לי לפתוח חשבונות בשמך. פתיחת החשבון לוקחת לך כ-5 דקות, והצעדים המדויקים כתובים למטה.
> - **תוקף הנתונים:** בסיס הנתונים החינמי פג אחרי 30 יום. בהגדרות של האפליקציה יופיע לך (ורק לך) כרטיס עם התאריך המדויק וכפתור "הורדת גיבוי מלא".
> - **גיבוי ושחזור:** יש סקריפט גיבוי ושחזור, ושחזור נבדק בפועל על בסיס נתונים ריק: כל השורות וכל הקוינס תאמו.
> - **שרת נרדם:** אם השרת נרדם באמצע פעולה, ניסיון חוזר לא יוצר חשבון, חדר או חיוב כפול.
> - **ניתוק בסיס הנתונים באמצע תשלום:** השולחן ממתין, ואחרי החזרה התשלום מתבצע פעם אחת בלבד. זה נבדק עם ניתוק חיבור אמיתי.

Status: prepared and rehearsed locally, NOT deployed. No account, project or payment method was created or entered.

## 1. Host choice (checked 2026-11-01)

| Host | Free tier | Card needed | Verdict | Source |
|---|---|---|---|---|
| Render | Free web service, 750 instance hours per workspace per month; free Postgres (1 GB, expires 30 days after creation) | No: Render's own article says "No credit card is required"; the free docs mention a payment method only for bandwidth overages | **Chosen** | render.com/docs/free, render.com/articles/platforms-with-a-real-free-tier-for-developers-in-2026 |
| Koyeb | One free web service (512 MB, 0.1 vCPU) | Yes: "We require a credit card to prevent fraud and abuse", with a $29 pre-authorization | Rejected (card) | koyeb.com/docs/faqs/pricing |
| Fly.io | Free plans listed as discontinued for new organizations | Card expected; Fly's page could not be fetched in this session (UNVERIFIED) | Not considered further | docs.fly.io/about/discontinued-plans (not fetched) |

Render free limits that matter for TABLE21 (from render.com/docs/free):
- Spins down after 15 minutes with no inbound traffic; since 2026-02-24 WebSocket messages on an open connection also
  count as traffic, so an active table stays awake. Waking takes about a minute.
- Ephemeral filesystem: local files are lost on redeploy, restart and spin-down. "Render might restart a Free web
  service at any time." Persistent disks are not available on free.
- One free Postgres per workspace; it expires 30 days after creation, then 14 days of grace before deletion.

## 2. What is in the repository

- `render.yaml` (Blueprint): one free Node web service `table21` in Frankfurt (single instance) plus one free Postgres
  `table21-db`, wired through `DATABASE_URL`.
  - Build: `npx --yes pnpm@10.28.0 install --frozen-lockfile && npx --yes pnpm@10.28.0 --filter @table21/web build`
  - Start: `cd apps/server && node --import tsx src/main.ts` (migrations run on start)
  - Health check: `/api/health` (returns `{ ok, db, deployment }`)
  - Env: `NODE_VERSION=22`, `NODE_ENV=production`, `HOST=0.0.0.0`, `T21_DEPLOYMENT=online`, `T21_DATA_DIR=/tmp/table21-data`.
    `PORT` and `RENDER_EXTERNAL_URL` come from Render; the server listens on `$PORT` and uses the external URL as its
    public origin.
- Proxy readiness: Fastify `trustProxy` makes `req.protocol` https behind the platform's TLS, so the session cookie
  is `Secure; HttpOnly; SameSite=Lax`; Socket.IO and CSRF origin checks compare against the forwarded host; the CSP
  allows only this origin and `wss:`.
- Client cold start (section 9): if the server does not answer, the app opens from the service-worker cache (after 4 s
  at most), shows the "server is waking up" screen with offline practice one tap away, retries every 4 s for up to
  2.5 minutes and continues online by itself when the server answers. Creates retry with an Idempotency-Key.
- Text files are pre-compressed at build time (`.br`, `.gz`) and served compressed: first visit 254 KB instead of
  646 KB (docs/ASSETS_CLUB.md).
- `scripts/deploy-check.mjs` + `scripts/tls-proxy.mjs`: rehearsal of the production start behind an HTTPS/WSS proxy
  (results below).
- No Dockerfile: Docker Hub is blocked from the build workspace, so an image could not be built or tested here; the
  native Node runtime above was rehearsed instead.

## 3. Data on the free plan

| With the free Postgres (default in render.yaml) | Kept across restarts and spin-downs | Lost |
|---|---|---|
| Accounts, sessions, recovery codes, wallets, ledger, friends, clubs, rooms, rounds in progress | yes, for 30 days | when the free database expires (day 30, deleted after day 44) |
| Practice coins | stay on each phone, never on the server | |

| Without a database (remove `DATABASE_URL`) | Kept | Lost |
|---|---|---|
| Everything online | only while the instance runs | on every restart, redeploy and spin-down (embedded database in /tmp) |

Restart in the middle of a hand (rehearsed): rounds are stored per transaction; on start the server resumes open rooms
(`recover()`), sockets reconnect by themselves and each player receives a full snapshot (resync) with the same cards;
timers continue from the stored deadlines. Without a database, a restart forgets accounts and the app starts clean
(new guest) without errors.

When the free database expires: either upgrade it in Render (paid, needs Oz's approval), or create a new free database
and restore the last backup into it (section 7; free, keeps every account and coin), or delete the database and the
`DATABASE_URL` env var to run without persistence.

## 4. Steps for Oz (about 5 minutes, no card)

1. Go to https://dashboard.render.com/register and sign up with GitHub (or email). Do not add a payment method.
2. In the dashboard choose **New** > **Blueprint**.
3. Connect the GitHub account and pick `ozmoseri/table21` (Render asks for access to the repository; giving access to
   only this repository is enough). Branch `main`.
4. Render reads `render.yaml` and shows two free resources: web service `table21` and database `table21-db`. Click
   **Apply** (or **Deploy Blueprint**).
5. Wait for the first build (about 3 to 5 minutes). Open the service; the HTTPS address looks like
   `https://table21-xxxx.onrender.com`. Check `https://<address>/api/health` shows `"ok":true,"db":"postgres"`.
6. Open the address yourself first and create your player: the first account created on a server is its operator
   (sees the pilot card in Settings and can download backups). If someone else got there first, copy your user id from
   the Account screen into the service's `T21_ADMIN_USER_IDS` env var (Render redeploys by itself).
7. Optional: put the database's creation date from the Render dashboard into `T21_PILOT_DB_CREATED` (for example
   `2026-11-02`). Without it the app counts from the day it first migrated the database, which is the same day when the
   Blueprint creates both.
8. Send the address to Claude for a live check and to friends to play.

Nothing in these steps changes the repository's public or private setting.

Every push to `main` deploys again automatically (`autoDeployTrigger: commit`). To stop: Render dashboard > the
service > Settings > Suspend, or delete the Blueprint.

## 5. Rehearsal results (2026-11-01, Claude's cloud workspace)

Build: the Render build command in a clean copy of the repository, exit 0. Then `scripts/deploy-check.mjs` with
`RENDER=true`, `PORT=10000`, `NODE_ENV=production`, local PostgreSQL 16, behind `scripts/tls-proxy.mjs`
(HTTPS + WSS, self-signed certificate):

| Check | Result |
|---|---|
| Cold start to healthy, migrations included | PASS (about 1.5 s locally; Render wake-up is about a minute) |
| `/api/health` | PASS |
| Listens on 0.0.0.0:$PORT on the platform | PASS |
| Session cookie Secure, HttpOnly, SameSite=Lax behind the proxy | PASS |
| CSP: this origin and wss only | PASS |
| Realtime over WSS through the proxy | PASS |
| Hard kill (SIGKILL) in the middle of my turn, restart: same hand back and playable | PASS |
| Interrupted hand settles normally | PASS |
| No database: restart forgets accounts, app starts clean without errors | PASS |
| Server down: page loads from cache, offline play offered | PASS (over http://localhost; service workers refuse self-signed certificates) |
| Server back: online start appears without reload | PASS |

NOT RUN: a real Render deployment, Render's own TLS and wake-up time, phones on mobile data against the public URL.

## 6. Pilot end date (operator only)

The operator sees a "Free server pilot" card at the top of Settings, and on Home once 7 days or fewer are left:
- the date the free database expires (creation date + 30 days) and the days left;
- after that date, the date it is deleted (+14 days of grace);
- the free quotas and how much of the 1 GB the database uses now (`pg_database_size`);
- a "Download a full backup" button.

How it decides:
- **Card shown:** `T21_PILOT_PLAN=render-free` (set in `render.yaml`; on Render it is the default because Render
  sets `RENDER`).
- **Creation date:** `T21_PILOT_DB_CREATED` if set, otherwise the time of the first migration on that database.
- **Operator:** `T21_ADMIN_USER_IDS` if set, otherwise the first account ever created on the server. If that account
  is deleted, nobody is operator until the env var is set.
- Other players never see the card. `/api/admin/*` answers 403 for them (tested).

## 7. Backup and restore

The backup is one file: every table as JSON, taken in a single read-only, repeatable-read transaction, so wallets,
ledger and settlements agree with each other. It contains every account (names, hashed session and recovery
tokens). Keep it private and never commit it (`*.json.gz` and `backups/` are in .gitignore).

**Download (no database access needed):** Settings > pilot card > "Download a full backup". The file is
`table21-backup-YYYY-MM-DD.json.gz`. Do this before the expiry date, and before any risky change.

**From a computer (CLI):** the free database refuses outside connections (`ipAllowList: []` in render.yaml). For a
CLI backup, add your own IP in the database's Access Control for a few minutes, use the External Database URL, then
remove the IP.

```bash
pnpm db:backup export  "<External Database URL>" table21-backup.json.gz
pnpm db:backup verify  "<External Database URL>" table21-backup.json.gz   # row counts and coin totals match the file
```

**Restore (into a new, empty database, for example a new free one after expiry):**

```bash
pnpm db:backup restore "<URL of the new empty database>" table21-backup.json.gz
```

1. Migrates the empty database to the backup's schema version.
2. Loads every row, parent tables first.
3. Resets the id counters.
4. Applies any newer migrations.
5. Verifies row counts, wallet total and ledger total.

It refuses a database that is not empty, so nothing is ever overwritten. Then point the service's `DATABASE_URL` at the
new database (Render: the service > Environment) and redeploy. Players keep their sessions, coins and friends.

Tested for real on 2026-11-01:
- **Rehearsal database:** export, restore into a fresh database, verify, and a second restore refused.
  Log: `docs/backup-restore-2026-11-01.txt`.
- **Integration test:** a backup downloaded through the app restored into an empty database. Every table matched
  (`fingerprint`), the ledger was consistent, the id counters continued, and the old session cookie signed in to the
  same account with the same coins (`tests/integration/free-tier.test.ts`).

Render's free Postgres has no backups of its own (render.com/docs/free: "Free Render Postgres databases don't support
any form of backups"), so this file is the only backup.

## 8. Free quotas (Render, checked 2026-11-01, render.com/docs/free)

| Quota | Free plan | What it means for TABLE21 |
|---|---|---|
| Instance hours | 750 per workspace per month, shared by all free web services in the workspace | One always-awake service uses up to 744 h in a 31-day month, so keep this the only free service in the workspace. Asleep time does not count. When the hours run out, free services stay suspended until the next month |
| Spin-down | after 15 minutes without traffic; waking takes about a minute | handled by the waking screen and idempotent retries (section 9) |
| Postgres size | 1 GB | the pilot card shows the current size. A test club uses a few MB: each settled hand writes a handful of rows |
| Postgres lifetime | expires 30 days after creation, deleted 14 days later unless upgraded | pilot card date, backup and restore (sections 6 and 7) |
| Disk | ephemeral, wiped on restart, redeploy and spin-down | nothing important is stored on disk when `DATABASE_URL` is set |

## 9. Cold start and retries

What happens while the server is asleep:
- **Opening the app:** the service worker serves the cached app after 4 s at most, instead of waiting for the
  sleeping host. The app shows "the server is waking up" with:
  - the seconds elapsed;
  - "Try now";
  - "Practice meanwhile";
  - the promise that a retry never creates a second account, room or charge.

  It retries every 4 s for up to 2.5 minutes and continues by itself.
- **Creating something while it wakes** (guest account, room, club): the request carries an `Idempotency-Key` that
  stays the same on every retry. The server stores the key in the same transaction as the thing it creates
  (`idempotency_keys`, kept 24 h). A retry either replays the first result, or (if the first attempt rolled back)
  creates it once. A guest replay gives this device a fresh session for the same account.
- **Money:**
  - **Bets and actions** were already idempotent through `commandId`.
  - **Grants** are once per period.
  - **Settlement** is exactly once (`finished_at` guard + ledger `idem_key`).
- **Database lost in the middle of a payout** (or any timed step):
  - The whole transaction rolls back, so nothing is half paid.
  - The room stays paused on its last committed state, and the server retries the same step with backoff (0.5 s up
    to 10 s) until the database answers. A second server instance started during the outage does not pay twice.
  - Before this change, a database error in a timed step left the room stuck until the next command or restart.
  - A connection dropped while checked out crashed the process (an unhandled `error` event in `pg`). Both are fixed
    and tested with a real connection kill (`pg_terminate_backend`).

## 10. Releasing while people play (safe updates)

Every push to `main` redeploys. A player who has the app open gets the new version like this:

1. **The new service worker installs in the background and waits.** It has no `skipWaiting` on install, so it never
   takes over a page by itself. It precaches with `cache: 'no-cache'` (a 304 when unchanged), so it never stores a
   stale copy.
2. **The page notices the release.**
   - When: on focus, every 15 minutes, and at start.
   - How: `/api/config` returns the server's `build` (read from `dist/version.json` on each request). If it differs
     from the page's `__T21_BUILD__`, the page knows it is behind.
3. **"New version available" appears only at a safe point:** in the lobby, or in a room before your bet or after
   the result. It never appears while you have a bet down or a hand in play, online or in local practice or
   pass-and-play. "Later" hides it until the next hand ends.
4. **Nothing reloads until the player taps "Refresh".** Then the waiting worker takes over (`SKIP_WAITING`) and the
   page reloads into the new version. Without a tap, the new version starts on the next launch.

**Protocol changes (`PROTOCOL_VERSION` in `packages/protocol`):**
- Bump it only when an older client would send or read something the new server does not understand. A normal
  release does not bump it.
- When it differs, the server refuses that client's writes before any handler runs:
  - HTTP writes get `426 client_outdated`;
  - socket `cmd` and `gift` get `client_outdated`;
  - reactions are ignored.

  No state and no wallet changes. Clients built before this field existed send nothing and count as protocol 1.
- The outdated client can still watch and resync its hand. It shows "Switch to the new version" with "Refresh";
  in an online hand the notice appears even mid-hand, because its actions are blocked anyway. Reloading is safe
  there: the server holds the hand and the coins, and the page comes back to the same hand.
- Local practice never talks to the server, so it is never blocked or reloaded.
