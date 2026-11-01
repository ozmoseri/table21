# Premium round, stages 4-6 and art-director fixes F1-F5

תקציר לעוז:
- **השולחן כהה ונקי יותר:** פחות טקסטורה, אור חם במרכז, וכפתורי הסרגל העליון כהים.
- **שני שחקנים:** החבר יושב בצד ולא באמצע.
- **הטיימר:** טבעת סביב הסכום שלך.
- **הקלפים:** גב פשוט יותר עם מסגרת שנהב אחת, זהה לפנים.
- **הכיתוב על הבד:** "BLACKJACK PAYS 3 TO 2" לא עובר יותר מתחת לקלפים או לשמות.
- **ניצחון וחגיגה:**
  - ניצחון: באנר קצר עם הסכום (500ms).
  - בלאק ג'ק: באנר עם ניצוצות (900ms).
  - תיקו או הפסד: בלי חגיגה.
  - היתרה עולה בהדרגה.
- **צליל:** עד 3 צלילים בבת אחת, וצליל קלף אחד ברגע הנחיתה. רטט באנדרואיד.
- **מסך הבית:** משחק עם חברים, קוד חדר ותרגול מופיעים בלי גלילה.
- **הגנות:** שער 18+, תזכורת אחרי שעת משחק, ושורת "דילר אוטומטי · 18+ · לקוינס אין ערך כספי".

Sources, in order of precedence:
1. GROKBOT's message of 2026-11-01 16:03 (F1-F5).
2. `table21_design/DECISIONS.md`.
3. `CLAUDE_BRIEF.md` stages 4-6 and `DESIGN_BIBLE.md` §5, §7, §8, §9.

Engine rules, odds, server rules, the idempotent coin flow and `PROTOCOL_VERSION` (1) are unchanged. No credits, no payments and no generation were used.

## F1-F5

| Fix | What changed | Where |
|---|---|---|
| F1 felt | The same felt art, with a 60% veil of flat #125743 over it (texture -60%), an edge to #082F25 and one warm light pool at the table centre. HUD buttons, balance and invite are #0B1218 at 90%. | `theme/premium.css` (`.room` background, v6 pass) |
| F2 composition | With two players the friend moves to a side seat. 32 px between card groups (portrait). My cards are 76 px wide in landscape (76x106 at the standard 1:1.4 card). The turn timer is a ring around my total (54 px when the total is soft, e.g. 10 / 20). | `Table.tsx` (`HandView ring`), `premium.css` |
| F3 one card language | The card back is derived from the same Club back: its own ivory margin is cropped and the fan field muted about 45%, keeping the "21" medallion. Face and back share one 2px ivory frame and one radius (9% of width). "BLACKJACK PAYS 3 TO 2" is now its own row between the dealer and the players, so it can never sit under a hand or a name. | `art/club/cardback-simple.webp`, `art.ts`, `Table.tsx` (`.felt-print`) |
| F4 home | The install card is a dismissible strip 56-64 px tall. The illustration is at most 80 px. Play with friends, the room code and a compact practice row are above the fold at 390x844. The room-code placeholder has no letter spacing. | `Home.tsx`, `InstallHint.tsx` |
| F5 results | The result headline is 20 px Rubik 600 and the net amount 28 px. Win 500 ms, natural 900 ms, a push is never celebrated, and nothing celebrates when net <= 0. One landing sound per card; at most 3 sounds at once. | `fx/celebrate.ts`, `Table.tsx`, `sound.ts` |

The hole-card reveal stays at 770 ms (DECISIONS 2, Oz's dealer suspense).

## Stage 4: audio and haptics

- **Buses:** effects and ambience under one master. Ambience is a quiet synthesized room tone, **off by default** (DECISIONS 10 "music off by default"). It has its own toggle in Settings.
- **Voices:** at most 3 at once. A win or blackjack stinger may take the oldest ordinary voice; any other fourth sound is dropped. The stinger ducks the other voices and the ambience by 4 dB.
- **Card sounds only:** three variants and a pitch of +-2% (DECISIONS 10 overrides the bible's +-4%).
- **Timing:** one card sound per card, scheduled at the card's landing (84% of the flight, at the current playback rate). A skip or resync silences anything already scheduled.
- **iOS:** the audio session is `ambient` where Safari supports it (16.4+), so the silent switch mutes the game.
- **Haptics:** `haptics.ts` with the bible §7 patterns. Selection 8, own card land 12, chip bet 10, bust 30, 5 s turn warning 2x15, win [12,60,12], blackjack [20,60,20,60,40]. Off with the Haptics setting. With reduced motion only single pulses play. iOS Safari has no vibration (silent no-op).
- **Not done:** the brief's Kenney CC0 samples (ogg + m4a) could not be downloaded from the build workspace (network allowlist). The original synthesized set stays and follows the same event map. `public/CREDITS.txt` lists every source.

## Stage 5: celebrations and results

The rule is in `fx/celebrate.ts`: by total net only. `celebrationFor(net, natural)` returns `bj` or `win` only when net > 0, so a natural inside a split that loses overall shows nothing.

**Win (500 ms):**
- A banner with "ניצחת" and +amount (20 px / 28 px).
- One sheen across my cards.
- The win sound and a short haptic.

**Natural blackjack (900 ms):**
- The banner and 24 gold sparkles (the bible allows at most 40), plus the blackjack stinger and the bible haptic pattern.
- Tapping the banner dismisses it after 600 ms.
- Sparkles are off with reduced motion.

**Other outcomes:**
- **Loss:** a calm 450 ms settle and a neutral low sound, no banner.
- **Push:** nothing, a plain chip sound.
- **Bust:** the hand dims to 60%, the total turns rose and shakes twice (240 ms), and the phone gives one 30 ms pulse.

**Balance and reloads:**
- The HUD balance rolls up over 600 ms when a payout lands, in whole coins, ending on the exact snapshot value.
- A reload or reconnect never replays a celebration (`presentation.hydratedLast`).

**Not done, on purpose:**
- **10x big win:** removed (DECISIONS 9).
- **Chip payout flights (dealer to seat):** left for later.
- **Push wiggle:** F5 says a push gets no celebration.

## Stage 6: lobby, retention, art, ethics

**Lobby (DECISIONS 11 over bible §8):** resume room, play with friends, join by code, then practice (smaller), the install strip and the art. The tabs are already Home, Friends, Club, Profile.

**Not built, with the reasons:**
- **Daily streak:** DECISIONS 9 removes streak reset; the flat daily grant stays.
- **Coin gifts:** removed by DECISIONS 9. Gifts stay cosmetic and the ledger has no gift or transfer kind; a unit test checks this.
- **Insurance:** removed by DECISIONS 9. The engine has no insurance action; a test checks this.
- **10x big win:** removed by DECISIONS 9.
- **Play Now with strangers, table tiers, XP / levels and daily challenges:** these need new server data or rules. They stay out of this round under "no engine or server rule change" and are listed in NEXT_STEPS for Oz to decide.

**Ethics (bible §9):**
- **18+ gate:** on first launch on a device (`components/Guards.tsx`). "Under 18" stops there; confirming is remembered. The gate text says coins have no cash value.
- **Session reminder:** after every 60 minutes of visible play in a session. It waits for a safe point (the same busy marker that holds back updates, so never with a bet or hand in progress), never blocks, and closes with one tap.
- **Menu footer line:** "דילר אוטומטי · 18+ · לקוינס אין ערך כספי" in the room and practice menus. Home keeps the full no-cash-value note.

**Art:** no new art was generated (no credits). `table21_assets_incoming/trial1` holds only the five trial-1 sources already in the repo as the Club kit. The one art set is that kit, plus the derived simplified card back and the CSS card frame shared by every face and back.

## Tests

| Suite | What |
|---|---|
| `tests/unit/premium2.test.ts` | 3 voices, stinger takes the oldest voice, pitch +-2%, duck 4 dB, haptic patterns, celebration only for net > 0, 500 / 900 / skippable 600 / at most 40 particles, no insurance / coin-moving gift / streak in the code |
| `tests/e2e/premium2.spec.ts` | 18+ gate, session reminder at a safe point, celebration durations and nothing for net <= 0, F5 sizes, at most 3 voices over ten hands, haptic patterns, F4 lobby fold, F1 felt and HUD, F2 side seat and ring, F3 frame and felt print at 390x844 / 844x390 / 360x640, landscape card 76 px, menu footer |
| `tests/e2e/playwright.config.ts` | every context starts past the 18+ gate (`storageState`); the gate test opts out |

Screenshots (`scripts/premium2-shots.mjs`, portrait 390x844 and landscape 844x390):
- `docs/screenshots/premium2/before/` (6e7f9a2) and `after/`: home, table2 (two players), practice-turn, celebrate (banner mid-hold), results.
- `after/age-gate-*`, `after/session-reminder-*`, `after/menu-guardrails-*`, `after/settings-sound-*` (stages 4 and 6).
- `compare-*.jpg`: before and after side by side for F1-F5.
