# Free test server (Render)

> **סיכום לעוז:**
> - **השרת שבחרתי:** Render. זה המסלול החינמי היחיד מתוך שלושת המועמדים שלא דורש כרטיס אשראי. Koyeb דורש כרטיס, ו-Fly לא מציע מסלול חינמי ללקוחות חדשים.
> - **מה מוכן בקוד:** קובץ הגדרות (`render.yaml`), חזרה של השחקן לאותה יד אחרי הפעלה מחדש של השרת, התנהגות סבירה כשהשרת נרדם, ו-PWA.
> - **למה לא פרסתי בפועל:** אסור לי לפתוח חשבונות בשמך. פתיחת החשבון לוקחת לך כ-5 דקות, והצעדים המדויקים כתובים למטה.
> - **שמירת נתונים:** בסיס הנתונים החינמי שומר משתמשים וקוינס במשך 30 יום. אחרי 30 יום חייבים להחליט אם לשדרג אותו או למחוק אותו.

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
- Client cold start: if the server does not answer, the app opens from the service-worker cache, keeps solo and
  pass-and-play available, shows "the server may be waking up", retries every 4 s for up to 2.5 minutes and switches
  to online by itself when the server answers.
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

When the free database expires: either upgrade it in Render (paid, needs Oz's approval), or delete the database and the
`DATABASE_URL` env var to run without persistence, or create a new free database (data starts over).

## 4. Steps for Oz (about 5 minutes, no card)

1. Go to https://dashboard.render.com/register and sign up with GitHub (or email). Do not add a payment method.
2. In the dashboard choose **New** > **Blueprint**.
3. Connect the GitHub account and pick `ozmoseri/table21` (Render asks for access to the repository; giving access to
   only this repository is enough). Branch `main`.
4. Render reads `render.yaml` and shows two free resources: web service `table21` and database `table21-db`. Click
   **Apply** (or **Deploy Blueprint**).
5. Wait for the first build (about 3 to 5 minutes). Open the service; the HTTPS address looks like
   `https://table21-xxxx.onrender.com`. Check `https://<address>/api/health` shows `"ok":true,"db":"postgres"`.
6. Send the address to Claude for a live check and to friends to play.

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
