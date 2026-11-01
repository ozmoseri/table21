# Premium round, stages 1-3 (full screen, layout and HUD, card engine)

תקציר לעוז: השולחן הוא עכשיו כל המסך. הקלפים יוצאים מהשו אחד אחד בקשת, נוחתים ורק אז מתהפכים, והסכום מופיע רק
אחרי שהקלף התהפך. הקלף הסגור של הדילר מתרומם, נעצר רגע ורק אז מתהפך לאט. יש שלוש מהירויות (אלגנטי, מהיר, טורבו)
וכפתור דילוג אחד. כשמגיע תורך באונליין והאנימציה מאחור, היא מאיצה כדי לא לאכול לך את הטיימר. הכפתורים בסדר קבוע:
הכפלה, פיצול, עמוד, קלף. "קלף" ו"עמוד" באותו משקל, זהב רק לאישור הימור ולהמשך. חוקי המשחק והסיכויים לא השתנו.

Source of truth: `C:\Users\user\table21_design\DECISIONS.md` (overrides DESIGN_BIBLE.md). Rules, odds, server
authority and wire protocol are unchanged (`PROTOCOL_VERSION` stays 1): everything here is client presentation.

## Stage 1: full screen PWA

| Item | Where |
|---|---|
| `display: fullscreen`, `display_override: [fullscreen, standalone]`, `orientation: any`, colors #0B1218 | `apps/web/public/manifest.webmanifest` |
| `viewport-fit=cover`, black-translucent status bar, `mobile-web-app-capable` | `apps/web/index.html` |
| Room is `100dvh`, no page scroll, safe-area padding on all four sides (`env(safe-area-inset-*)`) | `theme/tokens.css`, `theme/premium.css` |
| Full screen button + lock landscape (Fullscreen API, `screen.orientation.lock`, Android/Chromium only) | Settings > Table, `fullscreen.ts` |
| One-time card on Home: "Add to Home Screen" on iOS (Safari has no Fullscreen API), "Full screen" elsewhere | `components/InstallHint.tsx` |

Usable in a normal browser tab too: nothing depends on standalone mode.

## Stage 2: layout and HUD (DECISIONS 4-8, 11)

- HUD (one row, glass buttons 44 px): menu, balance with sync dot, invite chip (people icon, count, code), social tray.
  The utility row under the table and the separate members sheet are gone: members live in the invite sheet,
  reactions in the social tray, gifts from a player's avatar, speed / left hand / leave in the menu.
- Actions: fixed order Double, Split, Stand, Hit (left to right, Hit under the right thumb), grid `68fr 68fr 88fr 88fr`
  (68/68/88/88 px at 360), height 56. Hit and Stand ivory, same weight; Double and Split brass outline. Left-handed
  mirrors the row (and the landscape column). Landscape: 2x2 in a side column under the thumb.
- Bets: three visible chips + More (`+`) + Clear (`×`); a chip only selects (nothing is sent); a second row shows the
  amount and the gold Confirm. Gold is used only for Confirm bet / Deal / Continue (`#E5C77E`, text `#14161A`).
- Palette and type: `theme/tokens.css` (room #0B1218, panel #16222C, felt #125743 / edge #082F25, brass #C9A24B,
  ivory #F6F1E4, win #78C9A0, loss #E5969C, push #B6C1CA, red suits #B3202A). Frank Ruhl Libre 700 for titles only,
  Rubik 400/500/600 for UI, tabular numbers, amounts LTR. Fonts are bundled (`@fontsource`, pinned 5.3.0).
- Felt: the room itself is the table (full-bleed felt, printed "BLACKJACK PAYS 3 TO 2", arc line), shoe in walnut and brass.

Not in this round (stage 4+ of the brief): removing the 10x event, insurance UI, coin gifts and streak reset (DECISIONS 9),
sound budget changes (10), the new Home order (11) and the single art set (12).

## Stage 3: card engine with an animation queue (DECISIONS 1-3)

```
server snapshot ──> TableTimeline (anim/timeline.ts) ──> display snapshot ──> React table
                         │ ordered events, own clock (rate)        │
                         └──> TablePresentation (presentation.ts, WAAPI on DOM cards)
```

- The server never waits. The timeline turns each new snapshot into visual events and derives what the table shows:
  a card is in the DOM only when its event fires; a total counts a card only after it landed and turned; outcomes,
  whose turn, legal actions and results appear only when the queue has caught up.
- Card ids `${roundId}:${slot}` sorted by slot = casino order (seat by seat, then the dealer). The hole card keeps its id
  through the reveal.

| Event | Elegant (ms) | Source |
|---|---|---|
| Opening deal stagger (overlapping) | 200 | DECISIONS 1 |
| Flight from the shoe (arc, quadratic Bezier 12 samples, -20° to 0, 0.85 to 1, settle) | 260 | DECISIONS 1 |
| Flip after landing | 220 | |
| One player, opening deal ready | about 1.1 s | |
| Six players + dealer (14 cards) | about 3.1 s | DECISIONS 1 (about 3.2) |
| Peek (ace or ten up) | 600 | |
| Hole card: lift 120, pause 250, flip 320, land 80 | 770 | DECISIONS 2 |
| Dealer draw beat | 300 | DECISIONS 2 |
| Natural blackjack beat | 900 | DECISIONS 2 |

- Speeds: Elegant 1 (default), Quick 0.62, Turbo 0.35 of every duration; remembered on the device
  (`prefs.dealSpeed`). Changing speed also changes cards already in the air (`updatePlaybackRate`).
- Skip: one 48x48 button at the bottom of the felt while the queue plays (no tap-anywhere). It flushes the queue and
  finishes every animation and pending sound.
- Catch-up (`catchUpMode` in `anim/timing.ts`): when the server says it is my turn and a real turn timer runs, a queue
  longer than 1.5 s plays at Turbo; any queue longer than 3 s is compressed; longer than 6 s snaps. Local games have
  no timer and keep the dealer's rhythm. The turn timer shown is always the server's.
- Hydrate (first render, reconnect, back from background) shows the state in place, no replay. Reduced motion skips.

## Tests

| Suite | What |
|---|---|
| `tests/unit/motion.test.ts` | pins the DECISIONS numbers, speed factors, catch-up thresholds, arc and reveal keyframes |
| `tests/e2e/premium.spec.ts` | one-by-one deal, total after the flip, skip button (48 px, no tap-anywhere), Turbo remembered, action order and equal Hit/Stand, left-handed mirror, online pick + Confirm + Clear, one HUD, room = 100dvh without scroll at 390x844 / 844x390 / 360x640, install card once |
| `tests/e2e/turn-fit.spec.ts` | browser-measured: flights 260 ms, 170-280 ms apart, no total before the flip, hole reveal 770 ms |
| `tests/e2e/pwa.spec.ts` | manifest full screen / display_override / orientation, viewport-fit=cover |

Screenshots, frames and the full-hand video: `docs/screenshots/premium/` (made by `scripts/premium-shots.mjs`).
Physical iPhone / Android checks of full screen, safe areas, orientation lock and 60 fps are NOT RUN.
