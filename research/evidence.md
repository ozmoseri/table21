# Evidence log: TABLE21 recording, Zynga Poker recording, and this round's checks

Date: 2026-11-02. Every row says how we know it:
- **Observed:** seen in a recording.
- **Verified:** checked in code or in a run, with the command or test named.
- **Reported:** said in earlier chats, not re-checked.
- **Design:** our own proposal.
- **Not checked:** not tested.

Recordings:
- **A, TABLE21:** `ScreenRecording_11-02-2026_16-56-59_1.mp4`, 1:51, 512x1112 portrait, AAC stereo. Frames from 0:03 on are in `research/frames/`. The 0:00 frame (phone control centre) is left out.
- **B, Zynga Poker:** `4BEA69D6-...mp4`, 3:44, 1112x512 landscape, AAC stereo. It is described in text only. None of Zynga's art is stored in this public repo.
- **Privacy:** recording B shows a Facebook login with an email address and a password field between about 0:10 and 0:30. No frame from that segment was saved or published.

Times are approximate, from frames sampled every 3 s (A) and 5 s (B).

## 1. Which version the phone was running

| # | What | How we know | Implication |
|---|---|---|---|
| 1.1 | A shows a thick gold-framed table, five stake chips (10/25/50/100/250), a gold "קלף" button and the older lobby. None of these exist in 6e7f9a2 or later. | Observed (A 0:03-0:54, 1:00) | The phone was not running the premium rounds |
| 1.2 | The game is open in Safari at `10.0.0.26`. Safari's compact bar shows only the host, so the port is not visible. Safari's bars are on screen throughout. | Observed (A, whole recording) | Browser tab, not the installed PWA |
| 1.3 | The PC copy `C:\Users\user\table21` is at **7261b87** (2026-11-01 08:16). Its `apps/web/dist/version.json` is `20261101-2099efbb`, older than every premium commit. | Verified (bridge: `git log -1`, `cat dist/version.json`) | The LAN host serves an old checkout and build |
| 1.4 | `scripts/start-lan-windows.ps1` runs `pnpm install --frozen-lockfile`. `scripts/lan.mjs` rebuilds when sources are newer than `dist` and keeps data in `.data\lan`. | Verified (code) | Updating the checkout and rerunning the launcher is enough; accounts stay |
| 1.5 | `git fetch` over the bridge kept dying partway (88 MB of partial packs). The cloud sandbox cannot see Windows processes, so the running LAN server process itself was not inspected. | Verified / Not checked | Update via a bundle file (docs/OPEN_TESTED_VERSION.md) |
| 1.6 | There was no way to tell from the phone which build it runs. | Verified (code) | Added: Settings > "אודות ואבחון" shows client commit, build, build time, protocol, server commit and build, origin, mode and service worker, plus a match / mismatch line |

## 2. TABLE21 recording (A)

| # | Time | Observed | Inference | Implication / action |
|---|---|---|---|---|
| 2.1 | whole | Safari bars visible; in landscape (1:42-1:48) they take a large share of the height | A browser tab cannot hide them; the installed PWA can | Keep the install strip; instructions to open from the home screen; device check NOT RUN |
| 2.2 | 0:03-0:54 | Large empty felt between the dealer and my hand; cards small for the space | Old layout (pre-premium) | Already changed in 6e7f9a2 and later (hero hand, 76 px landscape cards) |
| 2.3 | 1:42-1:48 | Landscape: the table is on one side, the controls in a separate area | Old landscape layout | Current landscape: one screen, 2x2 actions under the thumb (layout-v4, premium specs) |
| 2.4 | throughout | Room photo, gold frame, chips, avatars and cards look like different material and light | "AI look" | One card language: same back, frame and radius; flatter, darker felt; same brass |
| 2.5 | 1:00 | Lobby: big illustration, text cards, many equal actions | Weak hierarchy | Lobby order resume, friends, code, practice, then the rest (verified by `experience.spec` "lobby order") |
| 2.6 | 1:24-1:30 | Settings show the "בדיקת צלילים" board with English event names | Developer tool in the player's settings | Moved behind developer mode (`?dev=1`; always on in test builds) |
| 2.7 | 0:03-0:54 | Between betting, dealing, the turn and the result, the hand and buttons move | Controls change height per phase | Measured in today's build: my hand's bottom moved 649, 738, 613 px at 390x844. Fixed to one controls height in portrait; `experience.spec` "stable anchors" holds it at 390x844, 360x640 and 844x390 within 2 px |
| 2.8 | start | The recording starts with the game already open | Cold start not shown | Splash added; cold start on a device NOT RUN |
| 2.9 | audio | Integrated loudness -16.8 LUFS, LRA 7.6 LU (ffmpeg ebur128) | Level only | Not a quality judgement: nobody listened. Claude cannot listen |

## 3. Zynga Poker recording (B): lessons, not copying

| # | Time | Observed | What we take | What we do not take |
|---|---|---|---|---|
| 3.1 | 0:05 | Entry screen with a place, a character and warm light | The world starts at the entrance | No characters or casino-front art |
| 3.2 | 0:10-0:30 | Facebook login prompt, then a white "מאשר..." wait | Login and waiting cost the first 30 s | TABLE21 enters as a guest at once; no third-party gate before play |
| 3.3 | 0:50-1:35 | Lobby of illustrated game tiles; pop-ups for boosts, passes, suits and sales | Tiles say "what" through image plus title | Pop-up chains, passes, store pressure (DECISIONS 9; no purchases in TABLE21) |
| 3.4 | 1:40-2:00 | "Lucky bonus" slot with streak meter and coin shower | | Streaks and slot-style bonuses (DECISIONS 9) |
| 3.5 | 2:05-2:10 | Store with chip packs and prices | | Any purchase flow |
| 3.6 | 2:30-2:50 | Table inside a room, players around, dealer at the top | Room, table and seats share one space and light | Their room, dealer and table art |
| 3.7 | 2:40 | "Table Items" drawer: gifts sent to a person or to the table | Social action is tied to a seat | Coin-priced gifts (ours stay cosmetic and free) |
| 3.8 | 2:55, 3:35 | Hand result named at the table ("THREE OF A KIND", "PAIR") next to the cards | Feedback next to what it explains | |
| 3.9 | 3:00-3:40 | Fixed action row (FOLD / CHECK / BET) bottom right; the active player highlighted | Fixed action slots; clear active seat | |
| 3.10 | 2:25, 3:15 | "CONNECTING..." screen and a full-screen transition | Waiting is visible | Our splash and "waking" screens say what is happening without fake percentages |
| 3.11 | audio | -16.4 LUFS integrated, LRA 14.2 LU | Level only | No samples taken from the recording |

The recording does not show how Zynga implements any of this, and proves nothing about revenue or retention.

## 4. Checks made in this round

| # | Check | Result | Evidence |
|---|---|---|---|
| 4.1 | Anchors before the fix (390x844, practice) | hand bottom 649 / 738 / 613 px; controls top 683 / 772 / 647 px across bet / deal / result | scratch measurement script, reproduced in `experience.spec` |
| 4.2 | Anchors after | hand bottom 646 px, controls 680-836 px in every phase; 360x640 and 844x390 also fixed | `experience.spec` (PASS, Chromium) |
| 4.3 | Audio headroom, worst case (both stingers over five card and chip sounds) | peak 0.4-0.6 of full scale after the new limiter, no clipping | `experience.spec` "audio"; proof video logs (`docs/proof/*-sounds.json`) |
| 4.4 | REA | `rea-agents` 6.8.0. `rea doctor`: Node OK; the binary analysis engines (Hopper, Ghidra, IDA) are missing and not needed here. Web capture works against TABLE21 through a Chromium debugging port: `list-browser-targets` found the practice page, and `capture-web-screenshot` returned evidence `ev_3edeb5897df74cfaf7f4938b043037d0d7b873138b0a7c70b5d2fcb415082732` with a PNG whose sha256 `0ef17292be1d1323048e955da7666419fead0fd375fc810ee6a151486896334a` matched on export (`research/frames/rea-practice-capture.png`, viewport 500x701, completeness "complete_within_window"). Limits stated by REA: viewport only, no scrolling or scripted steps. The scripted phase-by-phase flows (anchors, staging, video) therefore use Playwright on the same Chromium. | `npx rea doctor`, `npx rea list-browser-targets`, `npx rea capture-web-screenshot` |
