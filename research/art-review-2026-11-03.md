# T04-art-review - Art Director report (read-only)

**Summary for Oz (Hebrew):** השולחן כבר נקי ומסודר, אבל הוא עדיין "משטח ירוק" ולא מועדון: אין עץ, האור שטוח, ולמטה יש פס כהה ריק שמקטין את הקלפים. הלובי מאבד את תמונת החדר בגלל באג CSS אחד. ההחלטות למטה הן קוד ועיבוד של תמונות שכבר יצרת (בלי יצירה חדשה), חוץ מהנעל ומתנות, שמסומנים "צריך את עוז".

Evidence class for everything below: existing emulated-browser screenshots (not re-captured), code read, one local image crop in scratchpad. No build, no device. Labels: [observed] = seen in a file, [code] = verified in source, [proposal] = my decision.

## Inputs checked
- All listed inputs present. DECISIONS.md, DESIGN_BIBLE.md, ART_PROMPTS.md, Oz mockup `6492330b-image.png`, incoming kit `table21_assets_incoming/trial1/` (table.png 2752x1536, room.png 1536x2752, cardback.png, chips.png, coffee.png), runtime `public/art/club/` (12 webp), `assets/manifest.json`, experience after/before, coach 360/390/844 sets.
- NOT REVIEWED (no screenshot exists): betting phase, deal in flight, hole-card reveal, natural blackjack, split, 3 to 5 seats.
- [code] Tokens live in `apps/web/src/theme/tokens.css :root`, not in `premium.css` (premium.css has no `:root`; only `.room` locals `--hud-h`, `--felt-art`, `--ctl-h`). CLAUDE.md says "premium.css :root"; `docs/DESIGN_SYSTEM.md` still lists Heebo/Libre Bodoni/Inter and pre-v5 hexes. Doc drift for the manager, not an art change.
- [observed] Light in the kit is overhead / top-centre (table.png beam, room.png pendants, felt-landscape pool). ART_PROMPTS.md says "top-left key light". The art already agrees with itself; the prompt file is the outlier.

---

## AD-1 Near rail: the table gets a wood/leather edge (scene, every in-game step)
- **Screen/size:** room, portrait 390x844 and 360x640 (bet, deal, decide, result).
- **Observed:** `experience/after/mid-hand-portrait-390x844.png` y 650-844 css and `coach/360x640-1-turn.jpg` y 470-640: felt fades into a near-black band (sampled rgb 8,31,23 then 8,19,20). No wood anywhere on the table except the shoe. The before set (`compare-mid-hand-portrait`) had a brass rim and room behind it; after removed both. The source `table.png` contains a finished leather rail with brass inlay that is not used at runtime.
- **Why:** "dark wood" and "room and table as one scene" are missing; the band reads as void, not as the player's side of the table.
- **Decision [proposal]:**
  1. Asset (asset-processor, no generation): crop `table21_assets_incoming/trial1/table.png` box (760,1352)-(1990,1434) (straight bottom rail: brass inlay at top, leather below, centre highlight from the overhead light), resize to **1170x78**, WebP q80, opaque, save as `apps/web/public/art/club/rail-near.webp` (test crop = 11.9 KB), add to `assets/manifest.json` (source: trial1/table.png crop). Prototype: `/tmp/claude-0/-home-claude/453f913c-4855-51b8-a5ed-f71127dd1abb/scratchpad/v/mock_rail.jpg`.
  2. CSS, `premium.css`, replace the `.room > .controls::before` background (portrait only; landscape keeps `display:none`):
     ```css
     .room > .controls::before {
       inset: -30px calc(-1 * max(10px, var(--safe-r))) calc(-1 * (var(--safe-b) + 8px)) calc(-1 * max(10px, var(--safe-l)));
       background:
         url(/art/club/rail-near.webp) center top / 100% 26px no-repeat,
         linear-gradient(180deg, transparent 26px, #140e0a 26px, var(--t-room) 75%);
     }
     ```
     Rail is never tiled (centre highlight would repeat), never mirrored in RTL.
- **Acceptance:** at 390x844 and 360x640 in turn, results and betting: rail element is 26 px tall, spans 0 to viewport width, top edge sits at least 4 px below the bottom of my bet row and above every button; no rail pixel overlaps a card, total, chip or button (bounding-box check); rail file ≤ 25 KB; screenshot pixel at (50%, rail top + 2 px) is brass-ish (R > 150).
- **New art:** no.

## AD-2 Reclaim the dead band: bigger cards, same stable anchors
- **Screen/size:** room portrait 390x844 (and 360x640 cards).
- **Observed:** `mid-hand-portrait-390x844.png`: about 100 css px empty between my bet row (y≈655) and the action row (y≈780). `coach/360x640-1-turn.jpg`: 67 px empty between bet row (y 463) and coach bar (y 530). [code] `--ctl-h: 156px` (premium.css stable anchors) is sized for the result panel; the result panel + countdown measure about 121 px (panel 95 px in `results-portrait-390x844.png`).
- **Why:** direction says no empty areas that shrink cards; my hand is the hero but is 94 px wide at 390.
- **Decision [proposal]:** in the `@media not ((orientation: landscape) and (max-height: 560px))` block:
  - `.room > .controls { height: var(--ctl-h, 132px); min-height: var(--ctl-h, 132px); }` (was 156). 360x640 stays 128.
  - `.room .me-zone .card-lg { --w: clamp(84px, 26vw, 116px); }` (was `clamp(80px, 24vw, 112px)`): 101 px at 390, 94 px at 360.
- **Acceptance:** at 390x844: my card width ≥ 100 px; vertical gap between my bet row bottom and the first control (coach bar or actions) ≤ 48 px; result panel + countdown fit inside controls (no clipping, no scroll). At 360x640 with lab fixtures `#/lab/solo`, `#/lab/three`, `#/lab/six` (VITE_LAB=1): no overlap between dealer row, seats, my hand, bet row and controls; actions still 56 px tall. Betting phase (chips 56 + confirm 52 + gap 10 = 118) fits in 132 and 128.
- **New art:** no.

## AD-3 One light: an overhead pool, dark edges, consistent shadows
- **Screen/size:** room, all sizes.
- **Observed:** felt is flat: sampled luminance centre (38,103,76) vs upper-left (33,96,69) vs right edge (26,94,69), ratio 1.17 and 1.23 (`mid-hand-portrait-390x844.png`). [code] `.room` background uses a pool at alpha 0.09 at 50% 50% plus a 60% flat veil over the texture. Card, chip and shoe shadows already fall straight down (`0 6px 12px`, `0 10px 18px`), which matches an overhead light.
- **Why:** "warm light from one consistent direction" is not readable; the scene looks evenly printed.
- **Decision [proposal]:** `premium.css .room` background, first three layers become:
  ```css
  radial-gradient(60% 34% at 50% 40%, rgba(255, 214, 150, 0.12), transparent 72%),
  radial-gradient(120% 85% at 50% 40%, transparent 42%, rgba(6, 34, 26, 0.94) 100%),
  linear-gradient(rgba(18, 87, 67, 0.45), rgba(18, 87, 67, 0.45)),
  ```
  (pool moves to 40% height, between dealer and hands; edges darken; veil 0.6 -> 0.45 so the wool shows). Rule for all future CSS and art: key light overhead, top-centre; shadows have x-offset 0. Ask Oz to append to DECISIONS.md: "Key light: overhead, top-centre (replaces top-left in ART_PROMPTS)". **needs Oz** (decision file only on his PC).
- **Acceptance:** screenshot luminance ratio felt at (50%, 40%) vs (6%, 22%) between 1.8 and 3.0, achieved by darker corners; brightest felt pixel relative luminance ≤ 0.12 (keeps ivory text ≥ 4.5:1; I measured ivory on (55,125,95) = 4.37, too bright); dealer name, seat names, totals ≥ 4.5:1 against the felt sampled at their own position; no `box-shadow`/`drop-shadow` with non-zero x-offset inside `.room` (grep).
- **New art:** no.

## AD-4 Gold discipline at the decide step (and a lost warning colour)
- **Screen/size:** room 390x844, 360x640, 844x390 (decide).
- **Observed:** gold #E5C77E appears on non-confirm elements during my turn: timer ring around my total (`mid-hand-portrait` y≈1305 @2x), active-seat ring, tip highlight on Double (`coach/390x844-2-tip`, `360x640-2-tip`: Double gets a 3 px gold frame + glow and reads like a CTA), tip pill border/fill, room code "XQEMJF" text, risk meter fill at 85% risk (orange-gold, `coach/844x390-1-turn.jpg`).
- [code] `premium.css:236 .total.has-ring .timer-ring .bar { stroke: var(--t-confirm) }` (4 classes) overrides `styles.css:215 .timer-ring.low .bar { stroke: var(--loss) }` (3 classes): the last-6-seconds warning colour never shows on my ring.
- **Why:** DECISIONS 4: gold only for Confirm bet / Continue. When the turn ring, the tip and Double are gold, the eye has no single "go" target.
- **Decision [proposal]:** `premium.css`
  - `.total.has-ring .timer-ring .bar { stroke: var(--t-ivory); }` and add `.total.has-ring .timer-ring.low .bar { stroke: var(--t-loss); }`
  - `.room .seat.is-active .avatar { box-shadow: 0 0 0 3px var(--t-ivory), 0 0 16px rgba(246, 241, 228, 0.45); }`
  - `.actions .act.coach-pick { outline: 3px solid var(--t-ivory); outline-offset: 3px; box-shadow: 0 0 16px rgba(246, 241, 228, 0.45); }`
  - `.coach-tip { border-color: rgba(246, 241, 228, 0.35); }` `.coach-tip.on { background: rgba(246, 241, 228, 0.10); border-color: rgba(246, 241, 228, 0.6); }`
  - `.hud-invite bdi { color: var(--t-ivory); }`
  - `Coach.tsx:82` meter fill: `risk < 0.5 ? 'var(--t-push)' : 'var(--t-loss)'` instead of the hsl ramp.
  - Brass #C9A24B stays for material accents (Double/Split outline, balance pill border, rail, avatar frames).
- **Acceptance:** during `player_turns` at all three sizes, a DOM scan of `.room` finds computed `rgb(229, 199, 126)` only in `.btn.confirm`, `[data-testid=next-round]`, `.c-bj` celebration and the coin icon; with < 6 s left the ring stroke is `rgb(229, 150, 156)`; coach-picked button outline is ivory.
- **New art:** no.

## AD-5 Result -> next round: countdown visible, hand does not move
- **Screen/size:** room results, 390x844 portrait (check 360x640).
- **Observed:** `results-portrait-390x844.png`: the "הסיבוב הבא N" countdown is not on screen (panel ends y≈835, countdown below the fold); landscape shows it (`results-landscape-844x390.png` y≈360). My hand moved: card top y 494 (mid-hand) -> 530 (results), bet row 652 -> 680 css, same hand 8♥ 2♦. [code] `Room.tsx:207` renders the countdown as `p.muted.small`; `premium.css:31 .room[data-phase='results'] { height: auto; min-height: 100dvh; overflow: visible; }` lets the room grow past the viewport (likely cause of both, proposal to confirm).
- **Why:** the next-round cue is the pacing anchor of the loop; a 36 px jump at settlement breaks the "stable anchors" rule and reads as a glitch right at the emotional moment.
- **Decision [proposal]:**
  - `premium.css`: `.room[data-phase='results']:not(:has(.session-end)) { height: 100dvh; overflow: hidden; }` (session-end standings keep scrolling).
  - `.room > .controls > p.muted.small { margin: 0; min-height: 20px; color: var(--t-ivory); opacity: 0.85; font-size: 15px; font-weight: 500; text-align: center; }` (countdown is quiet ivory text, not gold; no button, matches DECISIONS 3 server timer).
- **Acceptance:** at 390x844 and 360x640 results: countdown bbox bottom ≤ innerHeight - safe-b; `document.scrollingElement.scrollHeight === innerHeight`; my first card's top y in results equals its y in player_turns ±2 px; countdown contrast ≥ 4.5:1.
- **New art:** no.

## AD-6 Lobby: bring the room back (one-line bug) and stay in palette
- **Screen/size:** home, 390x844 and 844x390.
- **Observed:** `after/lobby-portrait-390x844.png` background is flat #0B1218 at every sampled point; `before-7261b87` lobby showed the room (pendant bokeh). The purple "מענקים" tile is the only cool-violet object in the app.
- [code] `tokens.css:73 html, body { ... background: var(--t-room); }` is imported after `styles.css` and gives `body` an opaque background, which paints over the fixed `body::before` room layer (`styles.css:864`, z-index -1). Purple comes from `styles.css:543 .club-tile` (amethyst), not in the DECISIONS 7 palette.
- **Why:** first screen of every session looks like a settings dashboard; lobby and table must be one world (DECISIONS 12).
- **Decision [proposal]:**
  - `tokens.css:73` split: `html { height: 100%; overscroll-behavior: none; background: var(--t-room); } body { height: 100%; overscroll-behavior: none; background: transparent; }` (room screens keep `body:has(.room)` felt-edge background from premium.css).
  - `premium.css`: `.home .club-tile { border-color: rgba(201, 162, 75, 0.35); background: var(--t-panel); }`
  - `premium.css`: `.home > .play.primary { background: linear-gradient(rgba(18, 87, 67, 0.55), rgba(8, 47, 37, 0.85)), url(/art/club/felt-portrait.webp) center / cover; border-color: rgba(201, 162, 75, 0.35); }` (the friends card is a piece of the same felt).
- **Acceptance:** lobby 390x844: at least 30% of sampled background pixels outside tiles differ from #0B1218 by ΔE > 3 (room art visible); all tile text ≥ 4.5:1 against its tile; no colour with hue 250-290 on the home screen; table screen background unchanged.
- **New art:** no.

## AD-7 Landscape: the dealer is smaller than the shoe
- **Screen/size:** room 844x390.
- **Observed:** `after/mid-hand-landscape-844x390.png`: dealer cards about 43-50 px wide, shoe 52x70, friend's cards ≈32 px with only the index visible; large empty felt right-middle (x 560-840, y 90-260 css). [code] landscape dealer `--w: 50px`, seats 32 px.
- **Why:** the dealer hand carries the suspense reveal (DECISIONS 2); it should be the second-largest thing after my hand.
- **Decision [proposal]:** inside `@media (orientation: landscape) and (max-height: 560px)`: `.room .dealer-cards .card { --w: clamp(52px, 16vh, 64px); }` `.room .seat .card-sm, .room .few-seats .seat .card-sm { --w: clamp(32px, 10vh, 40px); }`; shoe stays 54x70 (it is now smaller than a dealer card height).
- **Acceptance:** at 844x390: dealer card ≥ 60 px wide, seat cards ≥ 38 px; at 844x390 and 640x360 with `#/lab/solo`, `#/lab/three`, `#/lab/six`: no overlap between dealer row, HUD, seats, my hand, bet row; controls column unchanged.
- **New art:** no.

## AD-8 One art set: gift icon and shoe
- **Screen/size:** room (gift badges, shoe at every deal).
- **Observed:** `trial1/coffee.png` / runtime `coffee.webp` is a glossy clay-toy 3D render with cartoon steam; the rest of the kit (chips, card back, felt, rail) is photoreal brass/enamel. The CSS shoe reads as a framed picture (front-on, `mid-hand-portrait` top-right), not a shoe with a mouth.
- [code] `gifts.tsx:78 GIFT_ART = { coffee: .../coffee.webp }` overrides the original SVG for one of six gifts only.
- **Why:** DECISIONS 12 "one consistent art set (same lighting/material)".
- **Decision [proposal]:**
  - Code-only now: `GIFT_ART = {}` so all six gifts use their original SVGs; mark `coffee.webp` in manifest as `status: "retired"`.
  - **needs Oz** (Higgsfield Web, Unlimited, manual): dealer shoe brief: "Blackjack dealing shoe, 3/4 view from above, dark walnut body, smoked acrylic front, thin brushed brass trim, a few emerald-backed cards inside, mouth facing lower-left toward the table centre, single overhead top-centre warm key light, soft contact shadow, no text, no logo, transparent or solid #FF00FF background, 1024x1280." Runtime: 108x140 WebP (2x of 54x70), anchor top-right of felt, alpha keyed, ≤ 20 KB. Interim: keep current CSS shoe.
- **Acceptance:** no raster gift remains in `GIFT_ART`; manifest entry status updated; if the shoe lands: same brass hue as chips (ΔE < 6 on sampled trim), shadow straight down, file ≤ 20 KB.
- **New art:** shoe only, needs Oz; gifts no.

---

## Works well, must not regress
1. [observed + code] Action row: fixed order Double, Split, Stand, Hit (direction ltr), Hit and Stand equal ivory weight, 56 px tall, 68/68/88/88 ratio, no chat/utility row in the thumb band (compare before/after). Landscape 2x2 bottom-right, mirrored for left hand.
2. [observed + code] One card language: ivory 2 px frame, 8 px radius on faces and backs, simple "21" back that stays readable at seat size, Frank Ruhl indices, red suits on ivory.
3. [observed] HUD floats on the felt: 44 px round room-dark controls, one menu, one invite, one chat; nothing covers cards.
4. [observed + code] Calm results: one line "הפסדת · -50" with 28 px amount, loss rose #E5969C on panel (7.8:1 measured), no shake, push and loss without banners.
5. [observed] Coach "why" is one bottom sheet with a single close and 17 px body; verdict chip is short. (Note: at 360x640 and 390x844 the verdict chip "מהלך נכון" sits on top of my total/bet row and the skip button, `coach/360x640-4-verdict.jpg` y≈475, `390x844-4-verdict.jpg` y≈650; after AD-2 frees space, position it at least 8 px above the bet row: QA check no bbox overlap with `.me-zone .total` and `.skip-anim`.)
