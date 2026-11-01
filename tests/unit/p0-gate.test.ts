import { describe, expect, it } from 'vitest';
import { STANDARD_RULES, applyAction, grossReturn, playDealer, seatReturn, seatStake, startRound, totals, type RoundState } from '@table21/game-engine';
import { unitsLabel } from '@table21/protocol';
import { oneSeat, stacked } from './helpers.ts';

/** P0 acceptance gate: blackjack rules that decide money (docs/QA_REPORT.md section 1). */
const BIG = 1_000_000;
const start = (shoe: ReturnType<typeof stacked>, stake = 200) =>
  startRound({ roundId: 'g', rules: STANDARD_RULES, shoe, seats: [{ seatId: 's0', playerId: 'p0', stake }] });
const hand = (s: RoundState, h = 0) => s.seats[0].hands[h];
/** Stand on every remaining hand, then let the dealer play. */
const finish = (s: RoundState) => {
  let x = s;
  for (let i = 0; i < 8 && x.phase === 'player_turns'; i++) x = applyAction(x, 'stand', BIG);
  return x.phase === 'dealer_turn' ? playDealer(x) : x;
};

describe('21 after a split is never a natural blackjack', () => {
  // K,K split; each hand draws an ace: two hands of A+K = 21 made after a split.
  const splitKings = (up: string, hole: string, dealerDraws: string[] = []) => {
    const s = start(oneSeat('K', up as any, 'K', hole as any, ['A', 'A', ...(dealerDraws as any)]), 100);
    expect(s.phase).toBe('player_turns');
    const sp = applyAction(s, 'split', BIG);
    expect(sp.seats[0].hands).toHaveLength(2);
    for (const h of sp.seats[0].hands) expect(h.status).not.toBe('blackjack');
    return finish(sp);
  };

  it('vs dealer 20: each 21 wins 1:1 (not 3:2)', () => {
    const done = splitKings('10', 'Q');
    expect(totals(done.dealer.cards).total).toBe(20);
    for (const h of done.seats[0].hands) {
      expect(h.outcome).toBe('win');
      expect(h.returned).toBe(200); // 50 coins staked, 100 back: 1:1, a natural would have been 125
    }
    expect(seatStake(done.seats[0])).toBe(200);
    expect(seatReturn(done.seats[0])).toBe(400);
  });

  it('vs dealer three-card 21: both hands push', () => {
    const done = splitKings('6', '5', ['10']);
    expect(done.dealer.cards).toHaveLength(3);
    expect(totals(done.dealer.cards).total).toBe(21);
    for (const h of done.seats[0].hands) {
      expect(h.outcome).toBe('push');
      expect(h.returned).toBe(100);
    }
  });

  it('vs dealer natural blackjack: the peek ends the round before any split, only the first stake is lost', () => {
    for (const [up, hole] of [
      ['A', 'K'],
      ['10', 'A'],
    ]) {
      const s = start(oneSeat('K', up as any, 'K', hole as any), 100);
      expect(s.phase, `${up}+${hole}`).not.toBe('player_turns');
      const done = s.phase === 'dealer_turn' ? playDealer(s) : s;
      expect(done.seats[0].hands).toHaveLength(1);
      expect(hand(done).outcome).toBe('lose');
      expect(seatStake(done.seats[0])).toBe(100);
      expect(seatReturn(done.seats[0])).toBe(0);
    }
  });
});

describe('natural blackjack', () => {
  it('beats a dealer three-card 21 and pays 3:2', () => {
    // seat 0 natural A+K; seat 1 9+8 stands so the dealer must play out 6+5+10 = 21 with three cards.
    const s = startRound({
      roundId: 'g2',
      rules: STANDARD_RULES,
      shoe: stacked(['A', '9', '6', 'K', '8', '5', '10'], 10),
      seats: [
        { seatId: 's0', playerId: 'p0', stake: 100 },
        { seatId: 's1', playerId: 'p1', stake: 100 },
      ],
    });
    expect(s.seats[0].hands[0].status).toBe('blackjack');
    const done = finish(s);
    expect(done.dealer.cards).toHaveLength(3);
    expect(totals(done.dealer.cards).total).toBe(21);
    expect(done.seats[0].hands[0].outcome).toBe('blackjack');
    expect(done.seats[0].hands[0].returned).toBe(250);
  });

  it('natural vs dealer natural is a push (stake back, net 0)', () => {
    const done = finish(start(oneSeat('A', 'A', 'K', 'Q'), 100));
    expect(hand(done).outcome).toBe('push');
    expect(hand(done).returned).toBe(100);
  });

  it('3:2 is exact for odd coin amounts (half-coin units, no rounding)', () => {
    for (const coins of [1, 3, 5, 7, 25, 99, 1001]) {
      const units = coins * 2;
      const gross = grossReturn(units, 'blackjack');
      expect(Number.isInteger(gross)).toBe(true);
      expect(gross).toBe(units * 2.5);
      expect(gross - units).toBe(coins * 3); // net 1.5 coins per coin = 3 units per coin
    }
    expect(unitsLabel(grossReturn(2, 'blackjack'))).toBe('2.5'); // 1 coin natural returns 2.5 coins
    expect(unitsLabel(grossReturn(50, 'blackjack'))).toBe('62.5'); // 25 coins returns 62.5
    const done = finish(start(oneSeat('A', '9', 'K', '7'), 50));
    expect(hand(done).returned).toBe(125);
  });
});
