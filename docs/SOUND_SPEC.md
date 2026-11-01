# Sound spec

> **סיכום לעוז:**
> - **מה בנוי:** 12 צלילים מקוריים שנוצרים בקוד, בלי קבצים ובלי שירות חיצוני.
> - **בלי עומס:** אין צליל שחוזר מהר מדי, ואין יותר מ-3 צלילים בבת אחת (DECISIONS 10). צליל ניצחון יכול לתפוס את המקום של הצליל הישן ביותר.
> - **שלב 4:** צליל קלף אחד לכל קלף, ברגע הנחיתה. גובה הצליל משתנה ב-±2% רק בקלפים. בזמן צליל ניצחון השאר יורד ב-4dB. אווירת חדר כבויה כברירת מחדל. רטט לפי פרק 7 בבייבל (רק באנדרואיד).
> - **ניקוי:** בחיבור מחדש, ביציאה לרקע ובסיבוב חדש, צלילים שכבר תוזמנו מתבטלים.
> - **הפסד ותיקו:** אין צליל עונשי להפסד. תיקו נשמע כמו החזרת צ׳יפים, לא כמו חגיגה.
> - **מה לא נבדק:** אני לא יכול להאזין, ולכן לא אומת אם הצלילים נעימים. מצורפת הדגמה של עשרה סיבובים, ויש בהגדרות לוח "בדיקת צלילים".

Code: `apps/web/src/sound.ts`. Demo: `scripts/render-sound-demo.mjs` renders `table21-sound-demo.wav` from the lab build
(`window.__t21RenderDemo`, the same synthesis and limits as live play).

## Set

| Sound | Trigger | Length (approx.) | Character |
|---|---|---|---|
| tap | secondary buttons in the table (reactions, hand chips) | 40 ms | very quiet click |
| chip | picking a stake chip; a push result (stake returned) | 100 ms | ceramic click |
| bet | the flying chip lands on the bet spot | 160 ms | two soft clacks, lower |
| deal | each card as it lands (84% of its flight, at the playback rate); three variants, pitch +-2% | 90 ms | slide tail into a soft place |
| flip | dealer hole card revealed | 120 ms | short flip |
| turn | my turn starts, after the deal sequence | 130 ms | gentle chime |
| payout | reserved for chip count-back (win includes it) | 360 ms | three quick clicks |
| win | net gain | 360 ms | clicks plus a rising two-note |
| blackjack | natural blackjack | 620 ms | four-note arpeggio |
| lose | net loss | 240 ms | low soft thud, no alarm |
| gift | a gift arrives at a seat | 500 ms | soft bell |
| reward | claiming a reward (daily, rescue) | 550 ms | three-note rise |

There is no background music. If music is added later, it gets its own volume and mute control, separate from effects.

## Rules

- One master gain. `stopAll()` disconnects it, which silences everything already scheduled. Called on resync,
  `finishAll()` (round change, reconnect, unmount, reduced motion switch) and when the page goes to the background.
- Same-sound minimum gaps (deal 50 ms, chip 40 ms, turn 400 ms, results 500 to 800 ms) and a budget of 4 overlapping
  voices; only win and blackjack may exceed it.
- Result sounds wait for the visual sequence (`presentation.afterSequence`), so the dealer's last card lands first.
- Audio starts only after a user gesture (browser autoplay rules). The sound switch in Settings mutes everything.
- Vibration uses `navigator.vibrate` only where it exists (Android Chrome); iPhone Safari has none and the UI never
  promises it.

## Measurements (no listening)

| Check | Method | Result |
|---|---|---|
| Ten-round demo, 60.5 s, 108 scheduled sounds | offline render in Chromium, same limiter | 108 played, 0 dropped |
| Peak level of the demo | ffmpeg volumedetect | max -4.1 dBFS (no clipping), mean -33.4 dB |
| Overlap in the demo | timeline with the lengths above | at most 1 sound at a time; smallest gap 100 ms |
| Deal ticks on Oz's iPhone recording (before this stage) | silence detection on the recording | 4 ticks 140 to 150 ms apart |

NOT VERIFIED: how the sounds feel, loudness balance on a phone speaker, ten real rounds with sound on a device.
