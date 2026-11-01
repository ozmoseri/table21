# Social features

> **סיכום לעוז:** בענף הזה נוספו 6 מתנות חינמיות ו-8 תגובות מוכנות לשולחן.
> שולחים אותן בלחיצה על האווטאר של חבר. השרת שולט בהכל: יש הגבלת קצב, מתנה כפולה לא נשלחת פעמיים, ומתנה פגה אחרי 45 שניות.
> מתנה היא מחווה חזותית בלבד: אין לה ערך, היא לא עולה קוינס בשלב הזה, והמקבל לא מקבל קוינס.
> אפשר להשתיק שחקן מסוים או את כל המתנות והתגובות.
> צ׳אט חופשי וקול נדחים בכוונה, עד שיהיו כלים לדיווח, חסימה ומיתון.

## Implemented in this branch (Stage B)

### Avatar tray
Tap a seat avatar (another player) -> a tray with three groups: Gifts, Reactions, and Mute this player.
Tapping your own seat does nothing. The tray never covers the action buttons area permanently; it closes after sending
or on outside tap / Escape.

### Gifts (free, visual only)
- Six items: coffee, tea, cookie, rose, trophy, tissue (the tissue is a light joke for a lost hand, never auto-sent).
- Flow: tap avatar -> Gifts -> pick an item -> it shows the recipient's name -> send. The gift flies from the sender's
  seat to a fixed spot next to the recipient's avatar and stays there until it expires. It never hides cards, totals,
  stakes, the timer or action buttons.
- Server-authoritative over Socket.IO: client emits `gift` with `{ roomId, recipientId, giftId, eventId }`.
  The server checks that the sender and recipient are both members of the room, the gift id is in the catalog, and
  rate limits (1 gift per 6 s and 30 per hour per sender). It inserts into `gift_events` with a unique
  (sender_id, client_event_id); a retry with the same event id is ignored and not rebroadcast. Then it broadcasts
  `room:gift` to the room.
- Expiry: 45 s. Active gifts are part of the room snapshot, so a reconnecting or refreshing player sees the gifts that are
  still on the table without replaying the flight animation.
- Cost: none in this stage. No ledger rows, no coins charged, nothing credited to the recipient, no inventory, no resale.
- If the recipient has left the room the gift is rejected with a clear message.

### Reactions (8 presets)
`nice` יפה!, `card` איזה קלף!, `wow` וואו, `yourturn` תורך, `thanks` תודה, `again` עוד סיבוב?, `clap` מחיאות כפיים,
`wink` קריצה. Shown as a short bubble at the sender's seat (about 2.5 s). Server cooldown 2.5 s per sender.
No humiliating content and nothing triggered automatically after a loss.

### Mute
- Global toggle: hide all gifts and reactions on this device.
- Per participant: mute one player's gifts and reactions on this device (from the avatar tray).
- Mutes are client-side in Stage B. Server-side blocks (which also stop the sender) arrive in Stage C.

### LAN and local modes
On a LAN host gifts and reactions work inside that local server only (local identities, local database, nothing leaves the
network). Solo and pass-and-play have no gifts.

## Planned

- Coffee round for everyone: one action that sends coffee to every seated player, with the total cost shown before sending
  (when gifts can cost coins or inventory, debited atomically once on the server).
- Inventory gifts earned from missions and the season track (Stage D).
- Server-side blocks and reports (Stage C), applied to gifts, reactions, room entry and friend suggestions.
- Club features: a fixed table for a group that keeps the host's chosen theme, club leaderboard, club events board,
  shareable invite links (no automatic messages to contacts).
- Evening summary after a friends night: highlights and stats, never revealing information that was hidden during a hand.

## Deliberately not now

- Free-text chat and voice: need reporting, blocking, filtering, moderation operations and a policy first.
- Profile photos: need content moderation and storage policy.
- Public tables and matchmaking: private rooms first; no fake players presented as real people.

## Tests

Integration (planned in this branch): duplicate event id, rate limit, non-member sender or recipient, departed recipient,
expiry, snapshot includes only active gifts. E2E: two browsers send and see a gift and a reaction; mute hides them.
See docs/QA_MATRIX.md area 5 for status.
