# TABLE21 independent QA, integrated commit 78e7f8c (T08-qa-integrated)

Date: 2026-11-03. Tester: qa-independent. Build: `VITE_LAB=1` build of 78e7f8c served by `tests/e2e/server.mjs` on port 3122
(database `table21_e2e_b`). Browser: Chromium via Playwright, mobile emulation, DPR 1, he-IL unless stated.
Probes: `tests/e2e/qa-t08.spec.ts`, `tests/e2e/qa-t08b.spec.ts`, config `tests/e2e/qa.config.ts` (measure and screenshot only; no product code touched).
Screenshots: `docs/screenshots/qa-T08/` (JPEG, 1.5 MB).

Not re-run, reported by the manager only: typecheck, unit 79/79, integration 67/67, e2e 100/100.
Physical device and listening: NOT RUN for every row. Nothing here says "works on all phones" or any frame rate.

Classes: AUTO = automated test, EMU = emulated browser, PHYS = physical device, LISTEN = listened, NOT RUN.

## Summary

- 0 blockers. 1 medium bug (card back and avatars blank when `/art/**` fails), 2 low bugs.
- Core journey, join (valid and invalid), reload mid-round, mute, reduced motion, recovery restore, rules, update safety: PASS.
- Existing e2e fallback test blocks only `/art/club/**`; blocking all of `/art/**` finds B1.

## 1. Core journey (EMU, two contexts, 390x844 host and 360x640 guest)

| Check | Result | Evidence | Class |
|---|---|---|---|
| Onboarding -> lobby -> create room (sheet text, room code 6 chars) | PASS | 1-00 to 1-03 | EMU |
| Guest joins with invalid code ZZZZZZ: inline "לא מצאנו חדר עם הקוד הזה...", typed code kept, field focused, no navigation | PASS | 1-04-join-invalid-360.jpg | EMU |
| Guest joins with valid code (typed lower case, accepted) | PASS | 1-05-room-guest-360.jpg | EMU |
| Both sit, pick chip, confirm; auto deal when all bet | PASS | 1-06 to 1-09 | EMU |
| My turn, stand, dealer plays, result panel on both (same net, -10) | PASS | 1-11, 1-12, 1-13 | EMU |
| Next round: bet bar returns by itself about 3 s after result (no button online), previous result line stays "הפסדת בסיבוב הזה -10" | PASS | 1-14, 1-15 | EMU |
| Guest reload mid-round: same URL, back in the room, same 2 cards, hand continues to result | PASS | 1-10-after-reload-guest-360.jpg | EMU |
| Confusing / overlapping / jumping | NOTE: none seen. The felt print "BLACKJACK PAYS 3 TO 2" is English in the Hebrew UI (decorative, by design). Result data-net is in half-coin units (-20 = -10 coins), text is right | 1-12 | EMU |
| Console | NOTE: 401 on first /api/me (expected, no guest yet); `reading 'waiting'` page error, see B3 | - | EMU |

## 2. Sizes (EMU, practice table, coach on)

| Check | 360x640 | 390x844 | 844x390 | Evidence |
|---|---|---|---|---|
| Lobby: no horizontal scroll, nothing past right edge | PASS | PASS | PASS | 2-lobby-* |
| My turn: hand clear of controls, coach strip (36 / 32 px) inside controls above actions, controls inside viewport | PASS | PASS | PASS (hand and controls are side by side, x ranges disjoint; my vertical-only probe flagged it, false alarm) | 2-myturn-coach-* |
| Coach tip text names one move and the risk | PASS | PASS | PASS | 2-coach-tip-* |
| Why sheet readable, closable, fits screen | PASS | PASS | PASS (sheet opens over lower part of felt, bottom 391 px of 390: touches the edge) NOTE | 2-coach-why-* |
| Verdict chip above my hand, not covering it | PASS (verdict bottom 260, hand top 269) | PASS (444 vs 456) | PASS (different columns) | 2-verdict-* |
| Result panel inside viewport, no scroll | PASS | PASS | PASS | 2-result-* |

Card sizes at 844x390: mine 76x106, dealer 62x87 (>= 60 px). At 390x844: mine 101x142, dealer 74x104. At 360x640: mine 94x131, dealer 54x75.

## 3. English locale (EMU)

| Check | Result | Evidence | Class |
|---|---|---|---|
| Lobby, create sheet, table, coach tip and why sheet, result, guide (full page), settings: no Hebrew text in the DOM; `dir=ltr`, `lang=en`; no horizontal scroll | PASS | 3-lobby-en, 3-create-sheet-en, 3-table-myturn-en, 3-coach-sheet-en, 3-result-en, 3-guide-en(-full), 3-settings-en | EMU |
| Numbers LTR in English (1,990, 20, +10, 92%) | PASS | 3-table-myturn-en.jpg | EMU |
| Settings: the only Hebrew is the language button label "עברית" (correct) | PASS | 3-settings-en.jpg | EMU |
| Unreachable-server screen in English after switching in Settings: online "The server is waking up", lan "The host computer is not answering", no Hebrew, no percentage, no overflow | PASS | 3b-unreachable-online-en, 3b-unreachable-lan-en | EMU |
| Unknown kind in English | NOTE: not reproduced in my probe (the device had already learned "online" from the real server before the outage, so the screen showed the online text). Unknown wording is covered in Hebrew by `entry-honesty.spec.ts`; English strings `wakingUnknownTitle/Body` exist in `i18n.ts` and were read, not rendered | 3b-unreachable-unknown-en | EMU / NOT RUN for the rendered English unknown screen |
| Language preference read from IndexedDB (`t21:prefs`), not localStorage: a first probe that set localStorage showed Hebrew, probe error, not a product bug | NOTE | - | EMU |

## 4. Mute and reduced motion (EMU)

| Check | Result | Evidence | Class |
|---|---|---|---|
| Baseline sound on: one hand logs 11 events (chip, deal x5, bet, turn, tap, flip, lose) | PASS | qa run output | EMU |
| Settings sound off: a full hand plus next round logs 0 events in `__t21soundLog`; game plays normally | PASS | 4-settings-muted, 4-muted-table | EMU |
| `prefers-reduced-motion: reduce` emulation: html `data-motion=reduced`, 0 CSS or Web animations during a deal (full motion: 19, longest 700 ms, none infinite); hand playable to result | PASS | 4-reduced-emulated-dealt, 4-reduced-emulated-result | EMU |
| In-app Reduced setting: `data-motion=reduced`, 0 animations during a deal, hand finishes | PASS | 4-settings-reduced | EMU |
| What it sounds like / feels like | NOT RUN | - | LISTEN / PHYS |

## 5. Failing assets (EMU)

Routes aborted: every `/art/**`, `.woff/.woff2` (Rubik), Google Fonts hosts. 47 to 48 requests failed per run.

| Check | Result | Evidence | Class |
|---|---|---|---|
| Hand playable to result at 390x844 and 844x390; actions visible with contrast (ivory on dark, dark on ivory), 56 px / 52 px tall; no horizontal scroll | PASS | 5-myturn-blocked-*, 5-result-blocked-* | EMU |
| Font falls back (computed `Rubik, system-ui, sans-serif`), text readable | PASS | 5-* | EMU |
| Face cards show rank and suit (code, not images) | PASS | 5-myturn-blocked-390x844.jpg | EMU |
| Dealer hole card (card back) | FAIL: empty outlined rectangle, no back pattern | B1 | EMU |
| Avatars (lobby chip, dealer) | FAIL: broken-image glyph | B1 | EMU |
| Lobby room art card (felt preview) | NOTE: card back blank there too | 5-lobby-blocked-390x844.jpg | EMU |

## 6. Natural vs 21 after split (AUTO, read)

PASS. `tests/unit/engine.test.ts`:
- line 209 "split aces get one card each, no hit, and 21 pays 1:1" (A,K after split pays `returned` 400 on a 200 stake: 1:1).
- line 220 regression "split aces A+Q vs dealer 6+5+10 is a 21 push, not a blackjack": `fromSplit` true, `status` not `blackjack`, outcome push.
- line 239 the same A+Q as the original two cards is a natural, pays 3:2 (returned 250 on 100) and beats a dealer three-card 21.
I read these; I did not re-run unit (manager reported 79/79).

## 7. Guest vs existing account (EMU)

| Check | Result | Evidence | Class |
|---|---|---|---|
| Guest creates 8 recovery codes, confirms saved; second context signs in with a code: same user id, name, balance (4,000 units) | PASS | 7-codes-guest, 7-signin-form, 7-restored-lobby | EMU |
| Re-using the same code in a third context, and a wrong code: inline "הקוד לא תקין, כבר נוצל או פג תוקפו", stays on sign-in, no account created | PASS | 7-code-reuse, 7-code-wrong | EMU |

## 8. PWA update safety (AUTO, read)

PASS. `apps/web/src/update.ts` read: the new worker waits (no skipWaiting on install); `updateVisible` is false while `busy`; `setBusy`/`useHandBusy` mark a hand in progress; reload happens only in `applyUpdate()` after the player's tap (`controllerchange` reloads only if `applying`); `maybeSilentSwap` never runs while busy. Test: `tests/e2e/updates.spec.ts:81` ("a release that lands mid-hand waits for the end of the hand, then asks; nothing reloads without a tap", portrait and landscape: no banner mid-hand, old worker still controls, `__samePage` marker survives) and `:146` (protocol mismatch mid online hand: actions refused, coins untouched, refresh returns to the same hand). Not re-run.

## 9. New pieces of this round

| Check | Result | Evidence | Class |
|---|---|---|---|
| Unreachable wording lan / online / unknown: no percentage, honest elapsed seconds, retry and practice present | PASS (Hebrew and English, see section 3; Hebrew unknown covered by `entry-honesty.spec.ts`, not re-run) | 3b-unreachable-* | EMU / AUTO read |
| Join error inline | PASS (section 1) | 1-04 | EMU |
| Long names (20 x "מ") and 9,999,999 balance: lobby chip no horizontal scroll at three sizes; practice with 9,999,999 coins at 360x640 fits | PASS with B2 (chip starts at x = -1 at 360 wide, no gutter) | 9-lobby-longname-bigbal-*, 9-practice-bigbal-360x640 | EMU |
| Coach: tip, why sheet, verdict above hand | PASS (section 2) | 2-* | EMU |
| Gold only on confirm / continue: bet stage "לחלק" (btn confirm) is the only gold button; my turn none; result only "הסיבוב הבא" (practice) | PASS | probe output, 2-myturn-coach-390x844 | EMU |
| Rail under felt (brass and leather band above controls) | PASS visually at 390x844 and 360x640; not measured by me | 2-myturn-coach-390x844.jpg, 1-12 | EMU |
| Lobby room background shows behind the home screen | PASS | 9-lobby-longname-bigbal-360x640.jpg | EMU |
| Landscape card sizes | PASS (see section 2 numbers) | 2-myturn-coach-844x390.jpg | EMU |
| 6 players and 4 split hands, repeated input, rotation mid-animation | NOT RUN here (covered by existing specs reported by the manager) | - | NOT RUN |

## Bug list

| ID | Severity | Summary | Steps | Expected | Actual | Evidence | Suspected owner |
|---|---|---|---|---|---|---|---|
| B1 | Medium | Card back and avatars are blank when `/art/**` fails | Context with all `/art/**` and Rubik font requests aborted; onboard; open `/#/practice`; deal | Hole card shows a CSS fallback back (pattern or solid), avatars show initials or a shape; no broken-image glyph | Dealer hole card is an empty outlined rectangle; avatar slots show a broken-image glyph; lobby preview card back is blank. Buttons, face cards and results are fine and the hand finishes | docs/screenshots/qa-T08/5-myturn-blocked-390x844.jpg, 5-lobby-blocked-390x844.jpg, 5-myturn-blocked-844x390.jpg. `updates.spec.ts:207` blocks only `/art/club/**` and asserts the back's `background-image` string, which still points at the blocked `/art/backs/classic.svg`, so it cannot see this | frontend-ux (card-back CSS fallback, avatar img error handling), with asset-processor for the SVG fallback |
| B2 | Low | Header chip has no left gutter at 360 wide with a 20-char Hebrew name and 9,999,999 | Mobile 360x640, name `מ` x 20, balance 9,999,999, open lobby | Chip 16 px from the screen edge like at 390 | `.me-chip` left = -1 at 360x640 (224 wide), name text touches the edge; at 390 and 844 it is at 16 | docs/screenshots/qa-T08/9-lobby-longname-bigbal-360x640.jpg | frontend-ux |
| B3 | Low | Page error on every load when the service worker is unavailable | Playwright context with `serviceWorkers: 'block'`, load any page | No error | `Cannot read properties of undefined (reading 'waiting')` in `initUpdates` (`apps/web/src/update.ts`: `reg` is used after `register()` without a null check). Not shown to the player; real browsers return a registration, so likelihood low | console capture in the qa-t08 run (every test) | frontend-ux (update.ts) |

## Not done

- Physical iPhone / Android / Wi-Fi, listening to sound, real keyboard: NOT RUN.
- Rendering of the English "unknown server" screen: NOT RUN (strings read only).
- 6 players, 4 split hands, rotation mid-animation: not re-tested.

## Fix verification (integration manager, e4f96de)

| Bug | Fix | Check | Class |
|---|---|---|---|
| B1 | Card backs end with a CSS diagonal pattern under the raster and SVG layers (`art.ts`); avatars switch to an inline SVG figure on load error (`bits.tsx`) | `tests/e2e/fallbacks.spec.ts`: all `/art/**` blocked, back pattern present, every avatar on the inline figure with a decoded image, hand plays to the result | automated, emulated browser |
| B2 | `.home-head .me-chip` can shrink, name ellipsis | `fallbacks.spec.ts`: 20-character name, chip at least 8 px from both edges at 360x640 | automated, emulated browser |
| B3 | `initUpdates` returns when there is no registration | no page error with service workers blocked (fallbacks and entry-honesty specs run with them blocked) | automated, emulated browser |

The QA probes (`qa-t08*.spec.ts`) run only with `tests/e2e/qa.config.ts`, not in the main suite.
