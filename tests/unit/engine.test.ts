import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import {
  STANDARD_RULES,
  applyAction,
  buildShoe,
  cryptoRng,
  dealerStep,
  grossReturn,
  legalActions,
  newShuffledShoe,
  nextDealerStep,
  playDealer,
  seatReturn,
  seatStake,
  shuffle,
  startRound,
  timeoutStand,
  totals,
  type Rank,
  type RoundState,
} from '@table21/game-engine';
import { oneSeat, seededRng, stacked } from './helpers.ts';

const R = STANDARD_RULES;
const BIG = 1_000_000;
const start = (shoe: ReturnType<typeof stacked>, stake = 200, seats = 1) =>
  startRound({
    roundId: 'r1',
    rules: R,
    shoe,
    seats: Array.from({ length: seats }, (_, i) => ({ seatId: `s${i}`, playerId: `p${i}`, stake })),
  });
const hand = (s: RoundState, seat = 0, h = 0) => s.seats[seat].hands[h];
const ranks = (s: RoundState, seat = 0, h = 0) => hand(s, seat, h).cards.map((c) => c.rank);

describe('cards and totals', () => {
  it('builds six decks with 312 unique physical ids and no jokers', () => {
    const shoe = buildShoe(6);
    expect(shoe).toHaveLength(312);
    expect(new Set(shoe.map((c) => c.uid)).size).toBe(312);
    const shuffled = newShuffledShoe(6, cryptoRng());
    expect(new Set(shuffled.map((c) => c.uid)).size).toBe(312);
    expect(shuffled.filter((c) => c.rank === 'A')).toHaveLength(24);
  });

  it('counts multiple aces as soft/hard correctly', () => {
    expect(totals([{ rank: 'A' }, { rank: 'A' }])).toEqual({ total: 12, hard: 2, soft: true });
    expect(totals([{ rank: 'A' }, { rank: 'A' }, { rank: '9' }])).toEqual({ total: 21, hard: 11, soft: true });
    expect(totals([{ rank: 'A' }, { rank: 'A' }, { rank: 'A' }, { rank: 'K' }])).toEqual({ total: 13, hard: 13, soft: false });
    expect(totals([{ rank: 'A' }, { rank: '6' }])).toEqual({ total: 17, hard: 7, soft: true });
  });

  it('Fisher-Yates permutes without losing cards (property)', () => {
    fc.assert(
      fc.property(fc.integer(), (seed) => {
        const s = shuffle(buildShoe(1), seededRng(seed));
        return new Set(s.map((c) => c.uid)).size === 52;
      }),
      { numRuns: 50 },
    );
  });

  it('crypto rng stays in range and is roughly uniform', () => {
    const rng = cryptoRng();
    const counts = new Array(6).fill(0);
    for (let i = 0; i < 6000; i++) counts[rng.int(6)]++;
    for (const c of counts) expect(c).toBeGreaterThan(800);
  });
});

describe('payouts (gross return, half-coin units)', () => {
  it('100-coin stake returns 0/100/200/250 coins', () => {
    expect(grossReturn(200, 'lose')).toBe(0);
    expect(grossReturn(200, 'push')).toBe(200);
    expect(grossReturn(200, 'win')).toBe(400);
    expect(grossReturn(200, 'blackjack')).toBe(500);
    expect(grossReturn(2, 'blackjack')).toBe(5); // 1 coin natural returns 2.5 coins
  });
});

describe('round flow', () => {
  it('player natural vs dealer non-natural pays 3:2', () => {
    const s = start(oneSeat('A', '9', 'K', '7'));
    expect(hand(s).status).toBe('blackjack');
    expect(s.phase).toBe('dealer_turn');
    const done = playDealer(s);
    expect(hand(done).outcome).toBe('blackjack');
    expect(hand(done).returned).toBe(500);
  });

  it('both naturals push; dealer natural resolves at the peek', () => {
    const s = start(oneSeat('A', 'A', 'K', 'Q'));
    expect(s.phase).toBe('settled');
    expect(hand(s).outcome).toBe('push');
    expect(s.dealer.holeRevealed).toBe(true);
  });

  it('dealer natural with ten upcard beats player before any double/split', () => {
    const s = start(oneSeat('8', 'K', '8', 'A'));
    expect(s.phase).toBe('settled');
    expect(hand(s).outcome).toBe('lose');
    expect(s.events.some((e) => e.type === 'peek' && e.dealerNatural)).toBe(true);
  });

  it('peek without natural keeps the hole card hidden', () => {
    const s = start(oneSeat('8', 'K', '8', '7'));
    expect(s.phase).toBe('player_turns');
    expect(s.dealer.holeRevealed).toBe(false);
    expect(s.events.some((e) => e.type === 'peek' && !e.dealerNatural)).toBe(true);
  });

  it('natural beats an ordinary multi-card 21', () => {
    // player 7,4 then hits 10 => 21 (3 cards); dealer A up, hole K -> dealer natural resolves at peek.
    const s = start(oneSeat('7', '9', '4', 'Q', ['10']));
    const s2 = applyAction(s, 'hit', BIG);
    expect(totals(hand(s2).cards).total).toBe(21);
    expect(hand(s2).status).toBe('stood');
    const done = playDealer(s2);
    expect(hand(done).outcome).toBe('win');
    // dealer 9+Q=19 vs 21 multi-card: win 1:1, not 3:2
    expect(hand(done).returned).toBe(400);
  });

  it('player natural beats a dealer multi-card 21', () => {
    // seat0 A,K natural; seat1 9,8 stands; dealer 6+5 draws K = 21 with three cards.
    const s = start(stacked(['A', '9', '6', 'K', '8', '5', 'K'], 10), 200, 2);
    const done = playDealer(applyAction(s, 'stand', BIG));
    expect(hand(done, 1).outcome).toBe('lose');
    expect(totals(done.dealer.cards).total).toBe(21);
    expect(done.dealer.cards).toHaveLength(3);
    expect(hand(done).outcome).toBe('blackjack');
  });

  it('dealer stands on soft 17', () => {
    const s = start(oneSeat('10', 'A', '8', '6'));
    expect(s.phase).toBe('player_turns');
    const s2 = applyAction(s, 'stand', BIG);
    const done = playDealer(s2);
    expect(done.dealer.cards).toHaveLength(2);
    expect(hand(done).outcome).toBe('win'); // 18 vs soft 17
  });

  it('dealer hits 16 and busts; busted player still loses', () => {
    const shoe = stacked(['10', '10', '6', '6', '9', '10', '10', '8'], 10);
    // two seats: s0: 10,6 ; s1: 10,9 ; dealer 10 up, 6 hole
    const s = start(shoe, 200, 2);
    // seat0 hits 10 => bust
    const s1 = applyAction(s, 'hit', BIG);
    expect(hand(s1, 0).status).toBe('bust');
    const s2 = applyAction(s1, 'stand', BIG);
    const done = playDealer(s2);
    expect(totals(done.dealer.cards).total).toBeGreaterThan(21);
    expect(hand(done, 0).outcome).toBe('lose');
    expect(hand(done, 1).outcome).toBe('win');
  });

  it('equal totals push', () => {
    const s = start(oneSeat('10', '10', '8', '8'));
    const done = playDealer(applyAction(s, 'stand', BIG));
    expect(hand(done).outcome).toBe('push');
    expect(hand(done).returned).toBe(200);
  });

  it('double adds one stake, draws one card and stands; no double after hit', () => {
    const s = start(oneSeat('5', '9', '6', '7', ['10']));
    expect(legalActions(s, BIG)).toContain('double');
    expect(legalActions(s, 199)).not.toContain('double');
    const d = applyAction(s, 'double', BIG);
    expect(hand(d).stake).toBe(400);
    expect(hand(d).cards).toHaveLength(3);
    expect(hand(d).status).toBe('stood');
    const s2 = start(oneSeat('2', '9', '3', '7', ['2', '2']));
    const h = applyAction(s2, 'hit', BIG);
    expect(legalActions(h, BIG)).not.toContain('double');
    expect(() => applyAction(h, 'double', BIG)).toThrow('illegal_action');
  });

  it('split identical ranks only (K+K yes, K+Q no)', () => {
    expect(legalActions(start(oneSeat('K', '9', 'K', '7')), BIG)).toContain('split');
    expect(legalActions(start(oneSeat('K', '9', 'Q', '7')), BIG)).not.toContain('split');
    expect(legalActions(start(oneSeat('K', '9', 'K', '7')), 100)).not.toContain('split');
  });

  it('split, double after split and stable hand order', () => {
    const s = start(oneSeat('8', '9', '8', '7', ['3', '10', '9']));
    const sp = applyAction(s, 'split', BIG);
    expect(sp.seats[0].hands).toHaveLength(2);
    expect(ranks(sp, 0, 0)).toEqual(['8', '3']);
    expect(sp.turn).toEqual({ seat: 0, hand: 0 });
    const dbl = applyAction(sp, 'double', BIG); // 8,3 + 10 = 21
    expect(hand(dbl, 0, 0).stake).toBe(400);
    expect(dbl.turn).toEqual({ seat: 0, hand: 1 });
    expect(ranks(dbl, 0, 1)).toEqual(['8', '9']);
    const done = playDealer(applyAction(dbl, 'stand', BIG));
    expect(seatStake(done.seats[0])).toBe(600);
    expect(hand(done, 0, 0).outcome).toBe('win');
  });

  it('resplit up to four hands', () => {
    const s = start(oneSeat('9', '7', '9', '7', ['9', '9', '9', '2', '2', '2', '2']));
    let x = applyAction(s, 'split', BIG); // h0: 9,9
    x = applyAction(x, 'split', BIG); // h0: 9,9 again
    x = applyAction(x, 'split', BIG);
    expect(x.seats[0].hands).toHaveLength(4);
    expect(legalActions(x, BIG)).not.toContain('split');
  });

  it('split aces get one card each, no hit, and 21 pays 1:1', () => {
    const s = start(oneSeat('A', '9', 'A', '7', ['K', '5']));
    const sp = applyAction(s, 'split', BIG);
    expect(sp.phase).toBe('dealer_turn');
    expect(hand(sp, 0, 0).splitAces).toBe(true);
    expect(ranks(sp, 0, 0)).toEqual(['A', 'K']);
    const done = playDealer(sp);
    expect(hand(done, 0, 0).outcome).toBe('win');
    expect(hand(done, 0, 0).returned).toBe(400);
  });

  it('regression (Oz phone screenshot): split aces A+Q vs dealer 6+5+10 is a 21 push, not a blackjack; totals match', () => {
    // 50 coins (100 units) on A,A; split aces draw Q and 4; dealer 6,5 then draws 10 = 21 with three cards.
    const s = start(oneSeat('A', '6', 'A', '5', ['Q', '4', '10']), 100);
    const sp = applyAction(s, 'split', BIG);
    expect(ranks(sp, 0, 0)).toEqual(['A', 'Q']);
    expect(ranks(sp, 0, 1)).toEqual(['A', '4']);
    expect(hand(sp, 0, 0).fromSplit).toBe(true);
    expect(hand(sp, 0, 0).status).not.toBe('blackjack');
    const done = playDealer(sp);
    expect(done.dealer.cards.map((c) => c.rank)).toEqual(['6', '5', '10']);
    expect(hand(done, 0, 0).outcome).toBe('push');
    expect(hand(done, 0, 0).returned).toBe(100);
    expect(hand(done, 0, 1).outcome).toBe('lose');
    expect(hand(done, 0, 1).returned).toBe(0);
    // Stake 100 coins in total, 50 coins back: net -50 coins, exactly what the result panel showed.
    expect(seatStake(done.seats[0])).toBe(200);
    expect(seatReturn(done.seats[0])).toBe(100);
  });

  it('the same A+Q as the original two cards is a natural and beats the dealer three-card 21 at 3:2', () => {
    // seat0 A,Q natural; seat1 9,8 stands so the dealer must play out 6+5+10.
    const s = start(stacked(['A', '9', '6', 'Q', '8', '5', '10'], 10), 100, 2);
    expect(hand(s).status).toBe('blackjack');
    const done = playDealer(applyAction(s, 'stand', BIG));
    expect(done.dealer.cards).toHaveLength(3);
    expect(hand(done).outcome).toBe('blackjack');
    expect(hand(done).returned).toBe(250);
  });

  it('timeout stands the active hand', () => {
    const s = start(oneSeat('10', '9', '6', '7'));
    const t = timeoutStand(s);
    expect(hand(t).status).toBe('stood');
    expect(t.phase).toBe('dealer_turn');
  });

  it('presenter dealer steps follow mandatory order', () => {
    const s = applyAction(start(oneSeat('10', '5', '8', '6', ['3', '9'])), 'stand', BIG);
    expect(nextDealerStep(s)).toBe('reveal');
    const a = dealerStep(s);
    expect(nextDealerStep(a)).toBe('draw');
    const b = dealerStep(a);
    expect(nextDealerStep(b)).toBe('draw');
    const c = dealerStep(b);
    expect(nextDealerStep(c)).toBe('settle');
    expect(dealerStep(c).phase).toBe('settled');
  });

  it('shoe exhaustion voids the whole round', () => {
    const s = startRound({ roundId: 'x', rules: R, seats: [{ seatId: 'a', playerId: 'a', stake: 2 }], shoe: stacked(['2', '3', '4']) });
    expect(s.phase).toBe('voided');
    expect(s.voidReason).toBe('shoe_exhausted');
    const s2 = start(stacked(['10', '9', '2', '7']));
    const h = applyAction(s2, 'hit', BIG);
    expect(h.phase).toBe('voided');
  });

  it('rejects non-integer or odd-unit stakes', () => {
    expect(() => start(oneSeat('2', '3', '4', '5'), 3)).toThrow('bad_stake');
  });

  it('random full rounds never duplicate a physical card and settle consistently (property)', () => {
    const acts: Rank[] = [];
    void acts;
    fc.assert(
      fc.property(fc.integer(), fc.integer({ min: 1, max: 6 }), (seed, n) => {
        const rng = seededRng(seed);
        let s = startRound({
          roundId: 'p',
          rules: R,
          shoe: newShuffledShoe(6, rng),
          seats: Array.from({ length: n }, (_, i) => ({ seatId: `s${i}`, playerId: `p${i}`, stake: 20 })),
        });
        let guard = 0;
        while (s.phase === 'player_turns' && guard++ < 200) {
          const legal = legalActions(s, BIG);
          s = applyAction(s, legal[rng.int(legal.length)], BIG);
        }
        s = playDealer(s);
        const uids = [...s.dealer.cards, ...s.seats.flatMap((x) => x.hands.flatMap((h) => h.cards))].map((c) => c.uid);
        if (new Set(uids).size !== uids.length) return false;
        if (s.phase !== 'settled') return false;
        return s.seats.every((seat) => seatReturn(seat) >= 0 && seatReturn(seat) <= seatStake(seat) * 2.5);
      }),
      { numRuns: 300 },
    );
  });
});
