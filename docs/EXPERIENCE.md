# Experience round (2026-11-02): one entry-to-result experience

תקציר לעוז:
- **הטלפון הריץ גרסה ישנה.** המחשב לא עודכן מאז 7261b87, ולכן הסרטון לא הראה שום דבר מהסבבים האחרונים. בהגדרות יש עכשיו מסך "אודות ואבחון" שמראה בדיוק איזו גרסה רצה, והוראות פתיחה ב-docs/OPEN_TESTED_VERSION.md.
- **כניסה ולובי:**
  - בפתיחה מופיע מסך מותג מיד, במקום עמוד ריק.
  - סדר הלובי: חזרה לשולחן, משחק עם חברים, קוד חדר, תרגול, ורק אחר כך כל השאר.
  - לוח בדיקת הצלילים יצא מההגדרות למצב פיתוח.
- **השולחן לא קופץ יותר.** היד שלי והכפתורים נשארים באותו מקום בהימור, בחלוקה, בתור ובתוצאה.
- **סוף יד מובן יותר:** הקלפים נאספים בסוף יד, וצ'יפים עוברים מהדילר אליך בניצחון. להפסד ולתיקו יש משוב שקט וקצר.
- **צליל:** נוסף לימיטר שמונע עיוות כשכמה צלילים חופפים.
- **סרטונים עם צליל:** בתיקייה docs/proof. הצליל מרונדר ממנוע הצליל של המשחק, לא הוקלט במיקרופון. אף אחד לא האזין לו כאן.

No engine rule, odds, server rule, wallet, idempotency or `PROTOCOL_VERSION` change. No credits, no payments, no public deploy.

Evidence and sources: `research/evidence.md` (both recordings, measurements, REA), `research/competitors.md`, `research/techniques.md`.

## What changed

| Area | Change | Files |
|---|---|---|
| Version identity | Every build records the commit (with `-dirty` for local changes), build time and build id. `/api/config` returns the served commit and build time. Settings > "אודות ואבחון" shows the client and server versions, protocol, origin, installed / browser mode, service worker and a match line. | `vite.config.ts`, `apps/server/src/app.ts`, `components/About.tsx`, `screens/Settings.tsx` |
| Dev tools | The sound board shows only in developer mode (`?dev=1`, remembered; `?dev=0` to leave). Test builds always have it. | `components/About.tsx` (`isDevMode`) |
| Entry | `index.html` paints a branded splash from the first byte (dark background, wordmark, "טוען את המשחק"). If the app has not started in 12 s, one line explains and a retry button appears (`public/boot.js`, same origin, CSP-safe). There are no invented percentages; waiting for a sleeping server keeps its own "waking" screen. | `index.html`, `public/boot.js` |
| Lobby | Order: resume (a 64 px brass tile, the strongest when a game is in progress), play with friends, room code, practice, friends night / one phone, then save account, install strip, art and bonus. | `screens/Home.tsx`, `premium.css` |
| Stable anchors | In portrait the controls area keeps one height (156 px) in every phase, content pinned to the bottom. The felt never resizes, so my hand stays put. The practice note moved into the controls area during betting. | `premium.css`, `screens/LocalPlay.tsx` |
| Round staging | End of a hand: the cards are swept to the discard corner in 300 ms, on copies in an overlay, so the next state is ready at once. A win pays 3 chips (4 for a natural) from the dealer to my stake in 400 ms. Loss: 220 ms calm settle. Push: 200 ms stake return. Neither shows a banner. | `presentation.ts` (`sweepOut`, `payout`), `fx/celebrate.ts`, `anim/timing.ts` |
| Audio | A limiter on the master bus, live and offline, so overlapping events cannot clip. Lab builds log every played sound with its time, and `__t21RenderEvents` renders any log through the same engine (proof video audio, headroom test). | `sound.ts`, `screens/Lab.tsx` |
| Proof | `scripts/proof-video.mjs` records a continuous take from a new device with the sound track rendered from the game's own log. | `docs/proof/` |

## Decisions where the brief and earlier decisions differ

| Topic | Brief | Kept | Why |
|---|---|---|---|
| Hole-card reveal | 450-600 ms | 770 ms (lift 120, pause 250, flip 320, land 80) | DECISIONS 2: Oz explicitly wants dealer suspense. GROKBOT confirmed it on 2026-11-01. |
| Card flight | 240-280 ms | 260 ms | in range |
| Deal stagger | 160-200 ms | 200 ms, plus an 80 ms draw beat before the first card | in range |
| Dealer draw beat | 220-300 ms | 300 ms | in range |
| Card sounds | variation | +-2% pitch, 3 variants | DECISIONS 10 |
| Recorded CC0 sounds | prepare an original or licensed set | synthesized set (original) kept | The workspace cannot download sample packs. Nobody listened; this is NOT a quality judgement. |
| New art (Higgsfield) | consistent kit after approval | none generated | Ultra plan with 2,333.75 credits. Oz runs generations by hand in the web UI. Any spend needs a list, cost and cap approved first. |
| Lobby features (tiers, Play Now, XP, challenges) | later | not built | "This round's goal is entry plus a polished round"; they need server rules (docs/NEXT_STEPS.md) |
