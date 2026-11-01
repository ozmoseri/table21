# Gameplay reference: real social card game footage for TABLE21

## סיכום לעוז

1. בדקתי שלושה משחקים פעילים ב-2026: Zynga Poker, Blackjackist ו-WSOP (שהוסיף מצב בלאק ג'ק במרץ 2026), דרך סרטוני YouTube ציבוריים, בלי התחברות ובלי רכישה.
2. מדדתי מתוך פריימים: היפוך קלפי הפלופ ב-Zynga לוקח כ-0.2 שניות, ב-WSOP כל קלף מגיע כל כחצי שנייה ומתהפך תוך כ-0.3 שניות, וב-Blackjackist החלוקה איטית (כשנייה לקלף).
3. מה שעובד: קלפים גדולים ליד האווטאר, סכום היד תמיד מוצג, תווית ברורה על כל יד (BUST), שורת הודעה קטנה שמסבירה מי ניצח ולמה, וחוקי השולחן מודפסים על הבד.
4. מה שמעמיס: טיימרים על כל אריח בלובי, חלונות מבצע במסך מלא, שרשראות פרסים נעולות, וחגיגות "BIG WIN" על כל המסך. לשולחן של חברים זה לא מתאים.
5. בסוף המסמך יש 18 כללי עיצוב ל-TABLE21 (גדלים, זמנים, תוצאות, מתנות שלא מכסות קלפים, ותקציב צלילים לסיבוב). צלילים לא נשמעו בבדיקה, ולכן מסומנים כהשערה.

Accessed 2026-11-01. Written for design decisions, not as a copy source. No art, names, layouts or text from these games
should be reused. Companion docs: `docs/REFERENCE_RESEARCH.md` (earlier public-page research), `docs/MOTION_SPEC.md`
(current TABLE21 timings), `docs/DESIGN_SYSTEM.md`.

## Evidence labels

| Label | Meaning |
|---|---|
| OBSERVED | Seen in a video frame I paused on. Every OBSERVED item gives the video URL and timestamp (seconds). |
| DOCUMENTED | Stated in an official store listing, press release or publisher page (URL given). |
| HYPOTHESIS | My reasoning. Not a fact about the reference game and not measured. |

Nothing here says anything about server logic, odds, shuffle or RNG. Videos with titles that accuse a publisher of
cheating were skipped as sources for any claim. No claim is made that any feature changes purchases or retention.

## Method

- **Tools:** WebSearch and WebFetch for store pages and press releases; the built-in browser pane on Oz's computer for
  public YouTube videos. One tab opened with `preview_start`, closed at the end; viewport emulation reset.
  Nothing was signed in, accepted, bought, downloaded or installed. YouTube ads were skipped with the player's own
  skip control. No Zynga, Playtika or KamaGames account was opened.
- **Frame stepping:** video muted, `video.pause()`, the `<video>` element pinned full-viewport, `currentTime` set to a
  timestamp, wait for the `seeked` event plus 300 to 900 ms, then a screenshot or zoomed crop. Step size 0.1 s for
  measured motion, 0.2 to 0.6 s for locating events.
- **Measurement limits (important):**
  - All three reference videos show **landscape** play. TABLE21 is portrait first, so size ratios below are converted
    to rules by reasoning (HYPOTHESIS), not copied.
  - YouTube uploads are 30 fps or less and re-encoded; a 0.1 s step can miss a sub-100 ms motion.
  - In the Blackjackist and WSOP videos some seeks rendered a black frame in the pane (listed per measurement).
    Those frames were discarded, so those measurements have wider error bars.
  - The Zynga video is edited: hand starts are cut (hard cut at 792.6 to 792.8, cross dissolve at 207.4 to 207.5),
    so the Zynga **hole card deal could not be measured**.
  - **Sound: not observed for every game.** Videos were muted and I cannot judge audio by ear. Only documented sound
    facts are listed.

## Games chosen and live status

| Game | Why | Live in 2026 (DOCUMENTED) |
|---|---|---|
| Zynga Poker | Required reference. | Google Play "Updated on Oct 27, 2026", 50M+ downloads ([Play](https://play.google.com/store/apps/details?id=com.zynga.livepoker&hl=en)); App Store version 23.31.2273, 18+ ([App Store](https://apps.apple.com/us/app/-/id354902315)). |
| Blackjack 21: Blackjackist (KamaGames) | A blackjack-only social app with multiplayer tables, chat, gifts and tournaments: the closest genre match to TABLE21. | Google Play "Updated on Oct 29, 2026", 10M+ ([Play](https://play.google.com/store/apps/details?id=com.kamagames.blackjack&hl=en)); App Store 18+ ([App Store](https://apps.apple.com/app/id959038492)). |
| WSOP (Playtika) | A very large social casino card game that launched a blackjack mode on 2026-03-11, so it shows how a big studio presents blackjack results today. | Google Play "Updated on Oct 9, 2026", 50M+ ([Play](https://play.google.com/store/apps/details?id=com.playtika.wsop.gp&hl=en)); blackjack launch ([Playtika press release](https://news.playtika.com/2026-03-11-World-Series-of-Poker,-the-1-Free-to-Play-Poker-Game,-Launches-New-Blackjack-Game-Mode)). |

## Videos used

| ID | Game | URL | Upload (YouTube relative date on 2026-11-01) | Notes |
|---|---|---|---|---|
| Z1 | Zynga Poker | https://www.youtube.com/watch?v=MOQr2qaoqgI | about 2 months ago, 23:50 | Landscape client, channel banner overlays top and bottom; edited cuts. |
| B1 | Blackjackist | https://www.youtube.com/watch?v=IPzLvel84Vo | about 1 year ago, 6:49 | Blackjack table, landscape phone capture 1280x590. |
| B2 | Blackjackist app (slots) | https://www.youtube.com/watch?v=n0oBRDIFRYA | about 1 year ago | Slot inside the app; used only for celebration and exit-offer observations. |
| B3 | Blackjackist app (slots) | https://www.youtube.com/watch?v=K-95HOIX5Tg | about 6 months ago | Same as B2. |
| W1 | WSOP (incl. blackjack) | https://www.youtube.com/watch?v=2Pn_d3bNZzM | about 4 months ago, 14:39 | A phone screen filmed by a camera; blackjack table at 430 to 503. |
| W2 | WSOP | https://www.youtube.com/watch?v=y-ANhmhfcwY | about 2 weeks ago, 1:54 | Level system onboarding, rewards, sale pop-up. |

Not used: https://www.youtube.com/watch?v=fOTQgZaVm-M ("NEW WSOP BLACKJACK", 2026-03-14) shows a YouTube content-warning
gate; I did not click through it.

---

## 1. Zynga Poker

### Entry and lobby
- OBSERVED (Z1 t=20): top bar with avatar and level at left, two large central buttons for buying and specials,
  chip balance at right. Five large tiles across the middle (challenges, deals, a table picker, a league, tournaments),
  each roughly 18% of screen width. Bottom bar: a free bonus with a countdown ("Ready in 00:50:43"), a sale tag, mail.
- OBSERVED (Z1 t=40): a challenge hub with a pass track ("Claim 31 Challenges", 1/31) and two challenge cards
  ("Bet on 380 hands", "Win $17.6T chips"), each with a "Select a table" button.
- OBSERVED (Z1 t=150): a collection album with five item cards, each showing progress (5/10, 2/10, 1/10) and one large
  completion prize line.
- OBSERVED (Z1 t=60, t=100): a pick-a-box ladder mini game (15 levels, "safe levels", a cash-out button, rewards panel).
- Effective: the lobby has one obvious play path (table tile with stakes).
- Cluttered: at t=20 about ten tappable targets compete, several showing a timer or a sale tag.
- Fit for TABLE21 (HYPOTHESIS): a friends-only table needs one primary "sit with friends" action, not five tiles.

### Joining a table
- OBSERVED (Z1 t=200 to t=207.1): a player who sits mid-hand sees "PLEASE WAIT FOR THE NEXT HAND..." in a band at the
  bottom center while the current hand finishes in full view. A "Tip the dealer" control sits under the dealer (t=207.1).
- Effective: the newcomer watches instead of seeing an empty screen.

### Choosing a bet and the turn
- OBSERVED (Z1 t=1106.3, landscape frame 720 px wide): when it is your turn a prompt appears **in the middle of the felt**
  ("CHECK or BET?" with the amount under it). Three round action buttons at bottom right (fold red, check green,
  bet amber), each about 5.5% of screen width with a text label above. Your balance is printed under your avatar.
- OBSERVED (Z1 t=800): pre-action toggles (fold, check/fold, check, call any) when it is not your turn; an opponent's
  turn timer shows as a green pie wedge filling the avatar ring; "Next blind" and its countdown sit at top right.
- Sizes (OBSERVED, Z1 t=1106.3 and t=800, landscape): own avatar about 13% of width; opponent avatars about 9%;
  own hole cards about 6% of width each, overlapping the bottom of the avatar; board cards about 6%.
- Effective: the center prompt names the decision in words; colors map to meaning (red fold, green safe).

### Dealing (measured)
- **Flop reveal, OBSERVED and frame-stepped** (Z1, https://www.youtube.com/watch?v=MOQr2qaoqgI, step 0.1 s):
  - t=1106.4: bets still in front of seats, no board cards.
  - t=1106.5: bets already gathered into the pot under the dealer and three face-down cards already in place.
    The gather and the card travel finished inside one 0.1 s step, so their duration is **not measured** (under 0.1 s
    or cut).
  - t=1106.6: three cards face down. t=1106.7: all three edge-on. t=1106.8: all three face up.
  - Result: **flip about 0.2 s, all three cards flipped together, not staggered.** Easing: not measured.
- Hole card deal: **not measured** (edited cuts at 792.6 to 792.8 and 207.4 to 207.5).

### Win and loss
- OBSERVED (Z1 t=1102 to t=1103.5): at showdown a wide red ribbon across the table center names the hand ("TWO PAIR")
  with small card icons; the five winning cards stay bright and the rest dim. The ribbon was static for at least 1.5 s
  before the video cut. Chip award motion: not captured (cut).
- OBSERVED (Z1 t=1104): after the all-in win the next hand shows a much larger balance under the avatar; no profit
  figure was visible.
- Effective: dimming non-winning cards explains *why* someone won without reading text.
- Gap: the profit of the hand is never shown as a number in the frames I saw (only the new balance).

### Friends, gifts, chat, progress
- OBSERVED (Z1 t=1106.3): a small present icon at the top-right of an opponent avatar; a chat button with an unread
  badge ("6") at bottom left. The gift send flow itself: not observed.
- DOCUMENTED: App Store notes mention a "Buddy Bonus" upgrade where more buddies give bigger multipliers on a spin, a
  celebrity in-game voice, a 9-seat and a 5-seat table, multi-tabling and a "Poker Dash" mode
  ([App Store](https://apps.apple.com/us/app/-/id354902315)).
- DOCUMENTED (sound): the app has an in-game voice (App Store notes). Other sound behavior: not observed. One Google
  Play user review says lobby music cannot be turned off; that is a user claim, not official
  ([Play](https://play.google.com/store/apps/details?id=com.zynga.livepoker&hl=en)).

### Store
- OBSERVED: a buy button and a specials button dominate the lobby top bar (Z1 t=20). The store screen itself: not observed.

---

## 2. Blackjack 21: Blackjackist

### Table and choosing a bet
- OBSERVED (B1 t=28, frame 727 px wide, video area 335 px tall): 3D dealer at top, red felt. Five chip denominations
  in a row on the felt (each about 3% of width); the empty bet circle glows. A full-width bottom bar of four buttons
  (double, clear, repeat, deal), each about 17% of width and 9% of height. Your avatar at bottom center (about 6% of
  width) with name and balance. Empty seats show a "+" ring. Table limits on a small placard on the felt.
- OBSERVED (B1 t=48): after betting, the chip total ("3K") sits on the circle and a "READY" tag appears under the avatar.
- OBSERVED (B1 t=45): "Please wait for the next deal" band above the avatar.

### Dealing (measured, lower confidence)
- OBSERVED, frame-stepped (B1, https://www.youtube.com/watch?v=IPzLvel84Vo):
  - First card, step 0.1 s: dealer hand reaches the shoe at t=31.4, card resting at the player spot by t=31.9 to 32.1.
    **About 0.5 s per card travel.** Frames at 31.6 rendered black on one seek and inconsistent on another, so treat
    this as about 0.5 s plus or minus 0.2 s.
  - Cadence, step 0.6 s: dealer card seen in motion about 33.5, second player card by 34.4, dealer second card about
    35.0. **About 0.9 to 1.0 s between cards.**
  - Whole initial deal from first motion (31.4) to the action bar on screen (by 36.2): **about 4.5 to 5 s.**
  - The camera dollies in for the decision (wide at t=25 and t=42, close at t=36.2). Easing: not measured.
- Effective: a physical dealer arm reads as "real".
- Cluttered or slow (HYPOTHESIS): about 5 s before the first decision, plus camera moves, is long for a quick social round.

### A turn
- OBSERVED (B1 t=36.2): action bar split, stand, hit, double; unavailable actions are shown dimmed rather than hidden.
  Hand total in a pink circle beside the cards. Cards about 6% of width each, fanned with overlap.
- OBSERVED (B1 t=40.7): the table menu offers resume, leave table, stand up, invite friends, settings.

### Loss
- OBSERVED (B1 t=16.5): on bust a dark "BUST" tag appears beside the cards and the total circle turns dark ("22").
  No full-screen effect. The cards are cleared by t=22.
- Win at the blackjack table: **not observed** in the frames I checked.

### Celebrations elsewhere in the same app
- OBSERVED (B3 t=40 and t=70; B2 t=300): slot wins take over the full screen with very large "BIG WIN", "TOTAL WIN",
  "HUGE WIN" type headlines and a counting number.
- OBSERVED (B2 t=60): leaving a slot opens a dialog offering three times as many chips back, with a confirm and a quit
  button. This is an exit-moment offer.

### Friends, gifts, progress, competition
- OBSERVED (B1 t=16.5): a tournament side panel lists players with rank and stars, total players (739) and prize
  places (221); the same tournament widget at the left shows your rank and the next goal (t=28).
- DOCUMENTED: play with friends and invite them, exchange gifts, in-game chat, tournaments, "smooth card and chip
  animations" ([Play](https://play.google.com/store/apps/details?id=com.kamagames.blackjack&hl=en)); side bets, daily
  free chips, VIP tables ([App Store](https://apps.apple.com/app/id959038492)). The gift flow: not observed.
- Sound: not observed; the store pages do not describe sound.

### Store
- Not observed at the blackjack table. DOCUMENTED: chip offers in recent version notes (App Store).

---

## 3. WSOP (blackjack mode)

### Entry and lobby
- OBSERVED (W2 t=5 to t=40): an intro video for a new level system plays before the lobby. At t=60 a guide character
  points at a level panel with a "Next" button (guided onboarding).
- OBSERVED (W2 t=70): a full-screen sale pop-up with a countdown timer.
- OBSERVED (W2 t=93, t=100): a reward chain of six tiles with locks between them, mixing "FREE" tiles and a priced tile,
  under a countdown.
- OBSERVED (W1 t=60): lobby with five large tiles, most carrying the same countdown; bottom navigation with three
  unread badges (1, 4, 27).
- OBSERVED (W1 t=300, t=700): a season quest screen with a "QUEST COMPLETED" card, one big "CLAIM NOW" button and a
  long horizontal reward track.
- OBSERVED (W1 t=820): a collection reveal shows the new cards fanned in the center with star ratings and one
  confirm button.

### Table and choosing a bet
- OBSERVED (W1 t=450, t=478.5; phone screen filmed): the dealer at top center; the player plays **two boxes**, one on
  each side of a center avatar. Bet stepper at bottom right ("minus, amount, plus" over a "MAIN BET" label); a single
  DEAL pill at bottom center. Two side-bet diamonds on the felt. The felt itself prints the rules
  (blackjack pays 3 to 2, dealer hits soft 17, insurance pays 2 to 1). A vertical rail of feature icons on the left.
- OBSERVED (W1 t=478.5): a tooltip over the avatar shows a time-limited goal ("2d 1h", reach an amount).
- DOCUMENTED: side bet built from the first two cards and the dealer upcard; dealer character named in the release
  ([Playtika](https://news.playtika.com/2026-03-11-World-Series-of-Poker,-the-1-Free-to-Play-Poker-Game,-Launches-New-Blackjack-Game-Mode)).

### Dealing (measured)
- OBSERVED, frame-stepped (W1, https://www.youtube.com/watch?v=2Pn_d3bNZzM, step 0.1 s; frames 482.5 and 482.8 rendered
  black and were discarded):
  - t=482.4: first card arriving at box 1 (screen right), face down, tilted.
  - t=482.6 to 482.7: same card upright and edge-on (flipping). t=482.9: face up.
    **Flip about 0.3 s.**
  - t=482.9: second card in flight toward box 2 (screen left). t=483.1: landed face down. t=483.5: face up.
  - t=484.0: dealer upcard on the table; t=484.5: second cards on both boxes, totals shown.
  - **Card to card stagger about 0.5 s**; order box 1 (right), box 2 (left), dealer, then second round.
  - Easing: not measured.
- OBSERVED (W1 t=456, t=490): cards are large, about 13% of the phone screen width each, with a total badge under each
  hand.

### A turn, win and loss
- OBSERVED (W1 t=462): a speech bubble from the dealer says it is checking for blackjack.
- OBSERVED (W1 t=468, t=490 to t=497): the active hand is outlined; STAND and HIT pills sit at bottom center; the other
  hand waits.
- OBSERVED (W1 t=500): a busted hand gets a red "BUST" bar under its cards.
- OBSERVED (W1 t=503): a dealer bubble announces the house won both hands.
- OBSERVED (W1 t=478.5 and t=500): a small text log at bottom left explains each result in words (which box, which hand,
  which total).
- A player win: **not observed**. Payout motion: not observed.
- Sound: not observed; the release and store page do not describe sound.

### Friends and gifts
- Not observed at the blackjack table. DOCUMENTED: the Play listing mentions "social features", profile collectibles,
  an album and a season pass, but not gifts or chat
  ([Play](https://play.google.com/store/apps/details?id=com.playtika.wsop.gp&hl=en)).

---

## Cross-game comparison

| Topic | Zynga Poker | Blackjackist | WSOP blackjack | Takeaway (HYPOTHESIS unless marked) |
|---|---|---|---|---|
| Card size (landscape) | about 6% of width, overlapping avatar (OBSERVED) | about 6% (OBSERVED) | about 13% (OBSERVED) | WSOP cards read best at a glance; portrait needs proportionally larger cards. |
| Card reveal | flop flip about 0.2 s, simultaneous (measured) | travel about 0.5 s, about 1 s cadence (measured, lower confidence) | flip about 0.3 s, 0.5 s cadence (measured) | 0.2 to 0.3 s flips feel crisp; 1 s cadence feels slow. |
| Initial deal to first decision | not measured | about 4.5 to 5 s (measured, coarse) | about 2.1 s for 2 boxes plus dealer (482.4 to 484.5) | Aim near 2 s for a small friends table. |
| Turn explanation | words in the felt center plus colored buttons | action bar, unavailable actions dimmed | outline on the active hand, dealer bubble | Combine: highlight, one short sentence, only legal buttons. |
| Totals | n/a | badge beside hand | badge under each hand | Always show totals. |
| Result | hand-name ribbon, winners bright, others dimmed | BUST tag, badge turns dark | BUST bar, dealer bubble, text log | Label on the hand plus a one-line reason. |
| Profit shown | new balance only | not seen | not seen | None of the three show "net this round" clearly in the frames I saw. |
| Celebration | ribbon, at least 1.5 s | slots: full-screen takeovers | not seen | Scale celebration to event size; never full screen at a friends table. |
| Social at table | gift icon by avatar, chat badge | invite friends in table menu, tournament panel | log, guide character | Keep the social layer near seats, away from cards. |
| Lobby pressure | many tiles, timers, sale tag | n/a | timers on most tiles, sale pop-up, locked paid chain | Leave timers and paid chains out. |

---

## Decisions for TABLE21

Each rule is original to TABLE21 and names the findings behind it. Timings are design targets to tune on devices.
TABLE21 currently uses 230 ms card travel, 85 to 150 ms stagger and a 320 ms flip (`docs/MOTION_SPEC.md`); rules
D3 to D5 propose changes to that spec for the friends table.

1. **D1. Own cards are the largest object on the table.** Portrait 360 to 430 px: each card in the local player's
   hand is 18 to 21% of screen width (about 68 to 84 px at 390 px), other seats 11 to 13%, dealer 15 to 17%.
   Motivated by: WSOP cards at about 13% of a landscape width were the only ones readable at a glance (W1 t=456),
   while 6% cards in Zynga and Blackjackist depend on a wide landscape screen (Z1 t=1106.3, B1 t=36.2).
2. **D2. Totals are never hidden.** A total badge sits under every hand, minimum 22 px text, with soft totals written
   as both values. Bust turns the badge to the loss color and adds the word on the hand.
   Motivated by: total badges in both blackjack games (B1 t=36.2, W1 t=490) and the bust tag pattern (B1 t=16.5,
   W1 t=500).
3. **D3. Deal cadence 260 to 320 ms per card for 1 to 2 players, 180 to 220 ms at 4 to 5 seats.** Card travel
   220 to 260 ms with a fast-out ease (`cubic-bezier(0.2, 0.8, 0.2, 1)`), so a full initial deal lands in 1.8 to 2.4 s.
   Motivated by: WSOP about 0.5 s stagger and about 2.1 s to the first decision (measured, W1 t=482.4 to 484.5);
   Blackjackist about 1 s cadence and about 5 s to the first decision felt slow (measured, B1 t=31.4 to 36.2).
   The current 85 to 150 ms stagger is faster than any reference and may blur who got which card (HYPOTHESIS).
4. **D4. Flips take 200 to 260 ms; the dealer hole card gets one deliberate beat of 320 to 380 ms.**
   Motivated by: Zynga flop flip about 0.2 s (Z1 t=1106.6 to 1106.8) and WSOP about 0.3 s (W1 t=482.6 to 482.9). The
   hole card is the single suspense moment in blackjack, so it alone may be slower (HYPOTHESIS).
5. **D5. Deal order starts at the seat on screen right and moves left.** This matches the dealing order seen in WSOP
   (box 1 at right first, W1 t=482.4 to 483.1) and also matches Hebrew reading order, so the eye follows the cards.
6. **D6. One turn signal set, three layers.** The active seat gets the halo, a short Hebrew line on the felt center
   names the player and the choice (for example "תורך: קלף או עמוד?"), and only legal actions show as buttons.
   Motivated by: Zynga's words-on-felt prompt (Z1 t=1106.3), WSOP's active-hand outline (W1 t=468), and Blackjackist
   showing dimmed illegal actions (B1 t=36.2), which adds noise. Hiding illegal actions matches `DESIGN_SYSTEM.md`.
7. **D7. Action buttons: at most four, each at least 48 px tall and 22% of width, in one bottom row.** The primary
   button (hit) sits on the right, nearest the thumb in RTL. Motivated by: Blackjackist's full-width bottom bar of four
   (B1 t=28) versus Zynga's small round buttons at about 5.5% width (Z1 t=1106.3).
8. **D8. Every result shows three numbers in one place: stake, returned, net.** On the hand: the result word
   (ניצחון, הפסד, תיקו, בלאק ג'ק, עבר 21). Under the player's balance: a net delta chip (+20 or -20) for 2.5 s.
   In the round summary sheet: "הימור 20 · הוחזר 40 · נטו +20". Motivated by: none of the three references showed net
   profit in the frames I saw; Zynga only showed a new balance (Z1 t=1104).
9. **D9. Explain each result in one sentence in a small log.** A collapsible Hebrew log at the edge of the table keeps
   the last 5 results ("נועה: 20 מול 18 של הדילר, ניצחה"), readable by screen readers. Motivated by: WSOP's text log
   (W1 t=478.5, t=500) and dealer bubble (W1 t=503); Zynga's dimming of non-winning cards (Z1 t=1102).
10. **D10. Celebration scale follows event size, capped at the table.**
    - Push or small win (net up to 1x stake): result word plus delta chip, 300 to 400 ms pop, no particles.
    - Win (1x to 2x stake): add a chip flight from the bank to the seat, 450 to 600 ms.
    - Blackjack or a win of 3x stake or more: one shimmer pass on the hand plus a seat glow, up to 900 ms.
    - Rare table moment (for example a 5-round streak or everyone winning the same round): a ribbon across the
      **upper third of the felt**, up to 1.5 s, never covering hands or buttons.
    - Never full screen, never a counting-up number over 1 s, buttons never blocked.
    Motivated by: Zynga's table ribbon held at least 1.5 s (Z1 t=1102 to 1103.5) versus full-screen slot takeovers in
    Blackjackist (B2 t=300, B3 t=40, t=70).
11. **D11. Losses are quiet.** Loss color on the badge and the delta chip only, no sound beyond the shared result cue
    at low volume, no offer, no "try again" prompt. Motivated by: the exit-moment chip offer in Blackjackist
    (B2 t=60) is the pattern to avoid at a friends table; Blackjackist's plain bust tag (B1 t=16.5) is the pattern to keep.
12. **D12. Gifts live at the avatar corner and fly above the cards.** The gift badge sits on the outer top corner of the
    recipient's avatar (max 28 px), never over a card zone. The flight path arcs through the top third of the felt.
    Gifts sent while cards are moving wait in a queue and play after the deal or between rounds; one gift animation on
    screen at a time. Motivated by: Zynga's present icon beside the avatar, outside the card area (Z1 t=1106.3);
    current 620 ms gift flight in `MOTION_SPEC.md`.
13. **D13. Sound budget per round (HYPOTHESIS, no reference sound was observed).** At most one cue per dealt card
    (short tick under 80 ms, minimum 120 ms apart, merged when faster), one flip cue for the hole card, one turn chime
    only on the local player's device, one result cue per player (the strongest outcome wins if they have two hands),
    gift cues deferred to between rounds. At most two sounds at once; the result cue (under 900 ms) ducks the rest.
    Music off by default with its own toggle. Motivated by: a user review complaining music could not be turned off
    (Zynga Play listing, user claim) and the dense visual events seen in all three games.
14. **D14. Joining mid-round shows the current round live plus a seat note.** The new friend's seat shows
    "תצטרף בסיבוב הבא" while they watch. Motivated by: Zynga (Z1 t=200 to 207.1) and Blackjackist (B1 t=45).
15. **D15. Print the table rules on the felt, from engine config.** One short Hebrew arc of text, for example payout
    for blackjack and whether the dealer hits soft 17, rendered from the same config the server uses.
    Motivated by: WSOP's printed rules on the felt (W1 t=478.5). Never hard-code the text in the client.
16. **D16. No camera moves.** The table view stays fixed; focus is shown with highlight and scale (at most 1.04x on the
    active hand). Motivated by: Blackjackist's wide-to-close dolly and back between rounds (B1 t=25, t=36.2, t=42)
    makes seat positions jump (HYPOTHESIS).
17. **D17. Competition is among the friends at the table only.** A light "tonight" strip (rounds, blackjacks, best
    streak) with no prize places, no global ranks, no countdowns. Motivated by: Blackjackist's 739-player tournament
    panel with prize places (B1 t=16.5) and WSOP's timed goal tooltip (W1 t=478.5) are built for strangers, not a
    private table.
18. **D18. Lobby and rewards: one primary action, visible rewards, no timers or locked chains.** Home shows "שולחן
    החברים" as the one large button and at most three small entries. A reward is claimed in one tap and shows its
    contents before the tap. No countdown on tiles, no sale pop-ups, no chained locked tiles.
    Motivated by: Zynga lobby with about ten targets and timers (Z1 t=20); WSOP countdowns on most tiles and badges
    (W1 t=60), full-screen sale pop-up (W2 t=70) and the locked reward chain mixing free and priced tiles
    (W2 t=93, t=100). The single "claim" button on WSOP's quest card (W1 t=300) is the part worth keeping.

## Open items

- Re-measure D3 and D4 on real devices once tuned (physical iPhone and Android tests: NOT_RUN).
- Hole card deal in Zynga Poker, payout chip motion in all three games, and any player win at a blackjack table:
  not observed. A longer unedited capture would be needed.
- All sound behavior in all three games: not observed.
- WSOP blackjack showcase video behind a YouTube content-warning gate was not opened.
