# TABLE21 design system

Direction: a beautiful private card table among friends, not a casino floor and not a dashboard. The table is the one memorable element (deep felt, thin brass rail, shoe, dealt cards); everything around it stays quiet.

## Color tokens
| Token | Hex | Use |
|---|---|---|
| `--bg` | #080F14 | App background |
| `--panel` | #121D24 | Sheets, bars, dialogs |
| `--felt` | #0F513E | Table surface (CSS gradients, themeable) |
| `--gold` | #D8B46A | Brass rail, primary action, focus accents |
| `--text` | #F5F2EA | Primary text |
| `--muted` | #A6B5B0 | Secondary text |
| `--loss` | #F08A87 | Losses, errors |
| `--success` | #80D5AF | Wins, confirmations |

Table themes unlocked by play: emerald (default), sapphire, bordeaux. Card backs: classic, brass, midnight. Cosmetics never affect cards, odds or payouts. Contrast is checked for text on panel and felt.

## Typography
- Heebo: all UI text, Hebrew and Latin.
- Libre Bodoni: card rank indices (part of the card artwork).
- Inter with tabular numerals: coin amounts, totals, timers.
All fonts are bundled locally (@fontsource), so LAN and offline modes make no external requests.

## Layout
- Mobile portrait first, 360 to 430 CSS px. Dealer at top, compact opponent seats around, your large active hand and actions at the bottom. Seat detail sheet for small widths. Landscape and desktop get a wider table, not a shrunken oval.
- Action targets at least 48 px, safe-area padding, no horizontal overflow.
- Primary actions: "קלף" (hit), "עמוד" (stand), "הכפל" (double), "פצל" (split). Only legal actions are shown.
- Always visible: selected stake, available coins, active player and whose turn it is.

## RTL
Hebrew UI is `dir="rtl"`. Cards, the dealer shoe and seat geometry are LTR islands (`dir="ltr"`) so ranks, suits and seat order never mirror. Card artwork is never mirrored. English mode switches the document to LTR.

## Motion
- Cards travel from the shoe to their seat, staggered; hole card flips on reveal; chips slide into the stake area.
- Card motion 180 to 320 ms, micro-feedback 100 to 180 ms. Subtle active-seat halo and a readable timer. Restrained win and blackjack moments, no flashing, no endless confetti.
- Animations are driven by snapshot diffs with stable card ids; obsolete animations are skipped after reconnect. Game state never waits for animation callbacks.
- `prefers-reduced-motion` and the in-app motion setting remove travel and flips.

## Sound and haptics
Short WebAudio-synthesized card, chip and win sounds with a mute setting. `navigator.vibrate` where supported (Android); iOS Safari does not support it.

## Accessibility
Visible keyboard focus, labeled buttons, live region announcing turns and results (not every animation).

## Art
Original SVG/CSS only in v1 (`apps/web/public/art`). Card faces, ranks, suits, coin values, buttons and Hebrew text are always code/vector, never AI images. Provenance in `assets/manifest.json`; optional manual Higgsfield requests in `assets/higgsfield-requests.json` and `docs/ASSET_BRIEFS.md`.

## v3 Social Club additions (2026-11-01)

תקציר לעוז: שולחן קומפקטי שגדל לפי התוכן, מושבים על קשת, ידיים מפוצלות כשבבים ממוספרים, חפיסה מקורית עם סימן 21 בגב, צ׳יפים עם שוליים מחורצים וערך קריא, מתנות ותגובות ליד המושב. סגול אמטיסט משמש רק למשימות, למענקים ולאוספים.

- Tokens: `--amethyst #8C6BC8` (missions, rewards, collections only), `--charcoal #161C20`, `--brass` gradient for primary
  actions. Existing tokens unchanged.
- Table: height follows content (no stretched empty felt). Reserved minimum heights for the dealer row and the local
  hand keep the layout from jumping between betting and dealing. Opponents sit on a shallow arc (`--arc-y`), 1, 3 and
  6 player layouts reviewed in the lab fixtures (`#/lab/solo|three|six|split|result`, only in builds with `VITE_LAB=1`).
- Split hands: the hand in focus is large; all hands appear as numbered chips with total and state (44 px tall).
  Opponents with more than two hands show the active hand plus "+n".
- Deck: ranks and suits are text and vector paths drawn in code; J, Q, K use original court marks (plumed cap, tiara,
  crown) with a gold accent; card backs carry a code-drawn "21" medallion over the SVG back art.
- Chips: notched edge ring, value in a center disc, tier colors teal, violet, red, black, brass; the amount is always
  also shown as text next to stacks.
- Gifts: six original vector icons (coffee, tea, cookie, rose, small trophy, tissue). Badge at the recipient avatar,
  newest replaces older, never covers cards, totals, buttons or the timer.
- Reactions: eight presets as ivory bubbles above the sender's seat; global and per-person mute.
- Navigation: Home, Friends, Club, Profile. Club holds ranking, rewards and collection; settings open from Profile.
- Home: one primary action (play with friends), inline room-code join, online friends strip, equal tiles for friends
  night, practice, one phone, rewards.


## v4 Club Lounge (art direction A, chosen as the working direction on 2026-11-01)

Three directions were drawn as phone-size mockups with the same game data (canvas "TABLE21 Art Direction"): A Club
Lounge, B Clean Table, C Living Room Evening. A is implemented; B and C stay as references until Oz decides.

| Role | Token | Value |
|---|---|---|
| Room and background | `--room-0`, `--room-1`, `--room-lamp` | #050b09, #0b1a14, #1d4434 (lamp from the top) |
| Table rail | `--brass-hi/mid/lo` | #f3dc9e, #c9a35a, #6b5226 |
| Felt light | `--felt-lamp` | warm pool at the top of the felt |
| Main action | existing `.btn.primary` | brass gradient |
| Turn state | `--turn` | #f0d595 (halo, timer ring, chip selected) |
| Reward and progress | `--reward` | #e2c27a |
| Net gain / push / net loss | `--win`, `--push`, `--loss-soft` | #7fe0b0, #d7dfdb, #f19a96 (always with words) |
| Tap target | `--tap` | 48 px minimum for main actions |

Layouts:
- Portrait: the felt fills the height between header and actions; actions stay in the thumb zone; dealer top, friends in
  an arc, own hand large at the bottom; the bet spot sits where the hand will land.
- Landscape phone (height up to 560 px): tab bar becomes a side rail; home and profile use two columns; the felt takes the
  full height on the start side and status, actions and reactions sit in a side column; card sizes follow the height
  (`dvh`), friends' totals sit beside their cards.
- Result wording: Stake, Total returned, Net win/loss; tags "Natural blackjack", "Doubled", "21 after split".
