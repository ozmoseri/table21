# Motion spec

תקציר לעוז: כל האנימציות בשולחן מנוהלות על ידי בקר תצוגה אחד לכל משחק. הוא מנפיש רק קלפים חדשים, לא מנגן מחדש מצב ישן אחרי ניתוק או רענון, וממתין לסוף החלוקה לפני צליל התוצאה. השרת לעולם לא מחכה לאנימציה. כל הזמנים כאן הם יעדי עיצוב לכוונון ולא ביצועים שנמדדו בטלפון.

## Controller

`apps/web/src/presentation.ts`: `TablePresentation`, one instance per table session (`sessionKey` = room id, or a unique id per local game).

| Mode | When | Behavior |
|---|---|---|
| hydrate | first render, reconnect (`resyncKey` increments), return from background (`visibilitychange`) | every card on screen is marked seen and rendered in place; running animations finish; pending delayed sounds are dropped |
| live | every later commit | cards whose stable id was not seen animate from the shoe, sorted by draw slot |

Card ids are `${roundId}:${slot}`. Slots are the draw order inside a round, so they reveal nothing about the shoe. Local
games use `local-<session>-<n>` round ids, so a new local game never inherits ids from an earlier one (this fixes the
earlier `local1` collision). The old global `seen` set and the "skip when more than 10 new cards" rule were removed: a
full six-player deal (14 cards) now animates with overlap.

## Timing (design targets)

| Element | Duration | Notes |
|---|---|---|
| Card travel shoe to seat | 230 ms | stagger `clamp(85, 1700 / n, 150)` ms so a full deal stays near 2 s |
| Hole card flip | 320 ms CSS transform | sound queued after the deal sequence |
| Chip settle | 320 ms, 40 ms per chip | |
| Gift flight | 620 ms arc from sender to recipient | then a badge at the recipient; the newest gift replaces the previous badge |
| Reaction bubble | 2.8 s total, fade in 0.28 s | anchored to the sender's seat |
| Result badge pop | 350 to 450 ms | blackjack gets one shimmer pass, no loops |
| Active seat halo | 2.4 s ease loop | opacity and shadow only |

## Rules

- Only `transform` and `opacity` animate on cards, chips, gifts and bubbles. No animated blur or filters on cards.
- Sounds: deal ticks follow each card's delay; turn chime and result sound wait for the visual sequence
  (`afterSequence`). WebAudio starts after a user gesture.
- Every animation is tracked; `finishAll()` jumps them to their end state on resync, unmount, background/resume, or a
  live switch to reduced motion.
- Reduced motion: `prefs.motion = 'system'` (default) follows the OS setting live; `reduced` disables movement
  (cards appear in place, CSS animations off); gestures still show as static badges.
- Game correctness never depends on animation end events or frame rate. Buttons are never blocked by a celebration.

## Verification

Automated (Chromium emulation): see docs/QA_MATRIX.md, section 2 and 4. Real-device smoothness (60 fps target) is NOT_RUN.
