# Feel tests

Automated feel scenarios in `tests/e2e/feel-bot.spec.ts`, plus the pinned numbers in `tests/unit/feel.test.ts`.
Test environment only (the e2e build has `VITE_LAB=1`, which exposes `window.__t21sound` and `window.__t21soundLog`).

## Single feel configuration

Every presentation number lives in `apps/web/src/feel.ts` (`FEEL`, deeply frozen): deal timing and speed factors,
catch-up thresholds, celebration times, sparkles, coach verdict duration, sound mix (voices, pitch, duck, gaps, lengths,
per-sound levels, limiter, ambience) and haptics. `anim/timing.ts`, `fx/celebrate.ts`, `sound.ts` and `haptics.ts`
re-export the same names. Rules, odds, payouts and `packages/game-engine` never import it.
The coach verdict is also a CSS animation (`coach-pop 2.2s` in `theme/premium.css`); the two must be changed together.

## Run

```bash
T21_E2E_PORT=3122 T21_E2E_DATABASE_URL=postgres://t21@127.0.0.1:55432/table21_e2e_b pnpm test:e2e feel-bot
T21_BOT_SEED=12345 ... pnpm test:e2e feel-bot      # reproduce a run
```

The seed (default 20261103) is printed as `[feel-bot] seed N` and stored as a `seed` annotation on every test. Each
scenario derives its own random stream from the seed and its name, so one scenario can be re-run alone with `-g`.
The whole file takes about 6 minutes (the long run is most of it).

## Scenarios

| # | Scenario | Checks |
|---|---|---|
| 1 | Fast player, 10 practice rounds, acts the moment actions enable | every Hit changes the table once, every Stand ends the round, unique card ids, no error toast, no page error |
| 2 | Slow player, seeded 1.5 to 4 s pauses | bet, hand and result wait for the player; nothing hits, stands or advances on its own |
| 3 | Double tap on Hit and Stand (two taps 40 ms apart at one point, plus a real mouse double click on Hit) | exactly one extra card for Hit; one result and no extra card for Stand; the next hand starts clean |
| 4 | Rotation mid-deal, 390x844 to 844x390 and back (both starting orientations, two flips per deal) | same cards, cards inside the felt, controls on screen, Stand usable, result reachable |
| 5 | Hidden then visible mid-deal (`visibilityState` + `visibilitychange`) | consistent cards, no duplicate card ids, card sounds not more than cards, at most one result sound, voices within the cap |
| 6 | Own room, offline during a turn, then online; again with a result on screen | same hand from the snapshot and Stand works; the shown result does not replay payout chips, celebration class or result/payout sounds |
| 7 | Six players and four split hands | not duplicated; the test asserts that the existing specs still cover it (`turn-fit.spec.ts`, `social.spec.ts`, `layout-v4.spec.ts`) |
| 8 | 30 practice rounds | no leftover `.sweep-layer` / `.payout-chip`, card nodes back to the baseline between rounds, max voices within `FEEL.sound.maxVoices`, pending timers (wrapper around setTimeout/clearTimeout) not growing |

## What the bot does not prove

- Fun, rhythm quality or sound quality. Nothing was listened to: NOT LISTENED.
- Physical phones, real touch latency, iOS Safari audio behavior or haptics: NOT RUN.
- Rotation and background are emulated (viewport resize, a faked `visibilityState`), not a real OS lifecycle.
- Rules, odds and payouts. The bot never tunes them and never joins a real room; scenario 6 uses its own room with the automatic dealer.
- Timers: only `setTimeout` is counted. Intervals, animation frames and CSS animations are not.
- Sounds are counted from the lab sound log (what the game scheduled), not from audio output.
