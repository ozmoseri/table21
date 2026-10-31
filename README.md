# TABLE21

Social blackjack for friends ("בלאק ג׳ק עם החבר׳ה"). Phone first, also desktop browsers. Fictional coins only.

## Features
- Solo practice and same-device pass-and-play (offline after the app is cached), separate practice coins.
- Online private rooms: code, link or QR, up to 6 seats, automatic dealer or a friend as presenter dealer.
- "ערב חברים": 10-round equal-stack match with its own ranking.
- Coins: welcome, daily and rescue grants; groups, friends, weekly gameplay leaderboard, profile stats and cosmetic unlocks.
- Computer-hosted LAN mode for play without internet.

## Quick start
Requirements: Node.js 22.12+, pnpm 10. PostgreSQL optional.
```bash
pnpm install
pnpm build
pnpm start            # http://127.0.0.1:3021, embedded database
```
Development:
```bash
node scripts/db.mjs start
export DATABASE_URL=postgres://t21@127.0.0.1:55432/table21
pnpm migrate
pnpm dev              # server :3021 + Vite :5173
```
Tests: `pnpm test:unit`, `pnpm test:integration` (local Postgres), `pnpm test:e2e` (Chromium).
LAN: `pnpm lan`, see [docs/LAN_SETUP.md](docs/LAN_SETUP.md). Checkpoints: `pnpm export <label>`, restore with [RESTORE.md](RESTORE.md).

## Status
See [docs/TEST_REPORT.md](docs/TEST_REPORT.md) for what passed, failed or was not run. Physical iPhone, Android and real Wi-Fi tests are NOT_RUN until done on devices. Nothing is deployed.

## Docs
[PRD](docs/PRD.md) · [Rules](docs/RULES.md) · [Architecture](docs/ARCHITECTURE.md) · [Design system](docs/DESIGN_SYSTEM.md) · [Capability audit](docs/CAPABILITY_AUDIT.md) · [Assets](docs/ASSET_BRIEFS.md) · [LAN](docs/LAN_SETUP.md) · [Deployment](docs/DEPLOYMENT.md) · [Phone-only LAN research](docs/PHONE_LAN_RESEARCH.md) · [Next steps](docs/NEXT_STEPS.md)

## התחלה מהירה לעוז

**על המחשב (פעם אחת, עם אינטרנט):**
1. מתקינים Node.js 22 ואז `npm i -g pnpm@10`.
2. בתיקיית הפרויקט מריצים `pnpm install`.

**ב-Windows יש סקריפט שעושה את הכל (בודק Node, מתקין pnpm ותלויות, מפעיל מארח LAN):**
`powershell -ExecutionPolicy Bypass -File scripts\start-lan-windows.ps1`
כשמופיעה הודעת חומת אש, מאשרים "רשתות פרטיות". רשת ה-Wi-Fi צריכה להיות מוגדרת כ-Private.

**משחק עם שני חברים באותו Wi-Fi:**
1. מריצים `pnpm lan` (או את הסקריפט של Windows).
2. בטרמינל תופיע כתובת כמו `http://192.168.1.20:3021` וקוד QR.
3. כל אחד סורק את ה-QR בטלפון, בוחר שם ואווטאר.
4. אחד יוצר חדר ושולח את הקוד, השאר מצטרפים, כל אחד מתיישב ומניח קוינס.

**לבד או על טלפון אחד:** במסך הבית בוחרים "תרגול" או "העברת טלפון".

**חשוב לדעת:** הקוינס דמיוניים בלבד. מצב LAN נשמר רק על המחשב המארח ולא נכנס לשום דירוג אונליין. משחק בין טלפונים בלי מחשב עדיין לא זמין.
