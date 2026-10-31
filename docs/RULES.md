# TABLE21 ruleset `std-v1`

Implemented in `packages/game-engine/src/round.ts` (`STANDARD_RULES`) and tested in `tests/unit/engine.test.ts`.

## Shoe
- Six standard 52-card decks, no jokers, 312 physical cards with unique server-only `uid`s.
- Unbiased Fisher-Yates (`shuffle`) using `cryptoRng()`: 32-bit Web Crypto values with rejection sampling.
- The shoe persists across rounds in `rooms.shoe`. Between rounds, if fewer than `cutRemaining` (78) cards remain, the server reshuffles a fresh shoe before dealing.
- Shoe exhaustion during a round (rare): the whole unsettled round becomes `voided`, every stake (including doubles and splits) is refunded once, the reason is logged, and the room gets a fresh shoe. Cards are never added mid-hand and rounds are never partially settled.

## Deal and peek (American hole-card game)
- Order: one card to each seat in seat order, dealer upcard, second card to each seat, dealer hole card (face down).
- If the upcard is an ace or ten-value, the dealer checks for a natural before any player decision. A dealer natural is revealed and resolves the round immediately: player naturals push, all other hands lose. Without a natural, the hole card stays hidden.

## Totals
- Aces count 1 or 11. `totals()` returns the best total, the hard total and a `soft` flag shown in the UI.
- A natural (blackjack) is an original, unsplit two-card ace + ten-value hand.

## Player actions
| Action | Rule |
|---|---|
| `hit` | Allowed below 21, not on split aces. Bust ends the hand. Reaching 21 auto-stands. |
| `stand` | Always allowed on the active hand. |
| `double` | First two cards only (also after a non-ace split). Adds one equal stake, draws exactly one card, then stands. Never after a hit. Requires funds. |
| `split` | Identical ranks only (K+K yes, K+Q no). Up to 4 hands; non-ace resplits allowed. Requires funds. |

- Split aces receive one card each and stand. No hit, double or resplit. A split 21 is an ordinary 21 paying 1:1.
- Split hands play in stable order (left to right as stored). The active hand is highlighted.
- No insurance, surrender or side bets in v1, and no dead controls for them.
- Turn timeout (default 25 s): the active unresolved hand stands.

## Dealer
- Dealer stands on all 17s, including soft 17, and hits 16 or less.
- If no hand is still live (all busted or blackjack), the dealer reveals and settles without drawing.
- Presenter dealer (friend): may only trigger the next mandatory step (`nextDealerStep`: reveal, draw, settle). Cannot pick cards, peek, skip, stand early or touch wallets. On timeout or disconnect the automatic dealer finishes with identical cards.

## Settlement
- Equal totals push. A natural beats a multi-card 21. Both naturals push. A busted player loses even if the dealer busts.
- Money is integer half-coin units (2 units = 1 coin). Gross returns including the stake, for a 100-coin stake:

| Outcome | Return |
|---|---|
| lose | 0 |
| push | 100 |
| win | 200 |
| blackjack (3:2) | 250 |

## State machine
Room phases (`rooms.phase`): `waiting` -> `betting` -> `player_turns` -> `dealer_turn` -> `results` -> `waiting`.
Engine phases: `player_turns`, `dealer_turn`, `settled`, `voided`. Irrelevant states are skipped (for example a dealer natural goes straight from deal to `settled`).
Every action is checked for phase, seat ownership, round id, current hand, funds and room version. Rule or table setting changes are allowed only between rounds (`waiting`/`results`) and are visible before staking.
