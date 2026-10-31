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
