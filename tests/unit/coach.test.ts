import { describe, expect, it } from 'vitest';
import { advise, bustRisk, handTotal, type CoachRank } from '../../apps/web/src/coach.ts';
import { STANDARD_RULES, applyAction, cryptoRng, legalActions, newShuffledShoe, playDealer, startRound, type PlayerAction } from '../../packages/game-engine/src/index.ts';

const ALL: PlayerAction[] = ['hit', 'stand', 'double', 'split'];
const UPS: CoachRank[] = ['2', '3', '4', '5', '6', '7', '8', '9', '10', 'A'];
const code = (a: PlayerAction) => ({ hit: 'H', stand: 'S', double: 'D', split: 'P' })[a];
const row = (cards: CoachRank[], legal = ALL) => UPS.map((u) => code(advise(cards, u, legal).best)).join('');

// Published basic strategy for 4-8 decks, dealer stands on soft 17, double after split, no surrender.
describe('coach: basic strategy chart (6 decks, S17, DAS)', () => {
  it('hard totals', () => {
    expect(row(['10', '7'])).toBe('SSSSSSSSSS'); // 17
    expect(row(['10', '6'])).toBe('SSSSSHHHHH'); // 16
    expect(row(['10', '3'])).toBe('SSSSSHHHHH'); // 13
    expect(row(['10', '2'])).toBe('HHSSSHHHHH'); // 12
    expect(row(['6', '5'])).toBe('DDDDDDDDDH'); // 11 (hit vs ace when the dealer stands on soft 17)
    expect(row(['6', '4'])).toBe('DDDDDDDDHH'); // 10
    expect(row(['5', '4'])).toBe('HDDDDHHHHH'); // 9
    expect(row(['5', '3'])).toBe('HHHHHHHHHH'); // 8
  });
  it('soft totals', () => {
    expect(row(['A', '9'])).toBe('SSSSSSSSSS');
    expect(row(['A', '8'])).toBe('SSSSSSSSSS');
    expect(row(['A', '7'])).toBe('SDDDDSSHHH');
    expect(row(['A', '6'])).toBe('HDDDDHHHHH');
    expect(row(['A', '5'])).toBe('HHDDDHHHHH');
    expect(row(['A', '4'])).toBe('HHDDDHHHHH');
    expect(row(['A', '3'])).toBe('HHHDDHHHHH');
    expect(row(['A', '2'])).toBe('HHHDDHHHHH');
  });
  it('pairs', () => {
    expect(row(['A', 'A'])).toBe('PPPPPPPPPP');
    expect(row(['K', 'Q'])).toBe('SSSSSSSSSS');
    expect(row(['9', '9'])).toBe('PPPPPSPPSS');
    expect(row(['8', '8'])).toBe('PPPPPPPPPP');
    expect(row(['7', '7'])).toBe('PPPPPPHHHH');
    expect(row(['6', '6'])).toBe('PPPPPHHHHH');
    expect(row(['5', '5'])).toBe('DDDDDDDDHH');
    expect(row(['4', '4'])).toBe('HHHPPHHHHH');
    expect(row(['3', '3'])).toBe('PPPPPPHHHH');
    expect(row(['2', '2'])).toBe('PPPPPPHHHH');
  });
  it('only recommends a legal move: no double after the second card, no split when not allowed', () => {
    const noDouble: PlayerAction[] = ['hit', 'stand'];
    expect(row(['3', '2', '6'], noDouble)).toBe('HHHHHHHHHH'); // hard 11 with three cards: hit
    expect(row(['A', '3', '4'], noDouble)).toBe('SSSSSSSHHH'); // soft 18, three cards: stand instead of double
    expect(row(['8', '8'], ['hit', 'stand', 'double'])).toBe('SSSSSHHHHH'); // no split left: plays as 16
    const a = advise(['3', '2', '6'], '6', noDouble);
    expect(a.ideal).toBe('double');
    expect(a.best).toBe('hit');
  });
  it('totals and bust risk shown on the meter', () => {
    expect(handTotal(['A', '6'])).toEqual({ total: 17, soft: true });
    expect(handTotal(['A', '6', '10'])).toEqual({ total: 17, soft: false });
    expect(bustRisk(['10', '2'])).toBeCloseTo(4 / 13); // 12 busts only on a ten-value card
    expect(bustRisk(['10', '6'])).toBeCloseTo(8 / 13); // 16 busts on 6 to K
    expect(bustRisk(['10', '9'])).toBeCloseTo(11 / 13); // 19 is safe only on an ace or a 2
    expect(bustRisk(['A', '7'])).toBe(0);
    expect(bustRisk(['6', '5'])).toBe(0);
  });
});

describe('coach: following the advice with the real engine', () => {
  it('plays to the known basic-strategy result (about -0.4% per bet, within noise)', () => {
    const rng = cryptoRng();
    let shoe = newShuffledShoe(STANDARD_RULES.decks, rng);
    let staked = 0;
    let net = 0;
    const N = 40_000;
    for (let i = 0; i < N; i++) {
      if (shoe.length < STANDARD_RULES.cutRemaining) shoe = newShuffledShoe(STANDARD_RULES.decks, rng);
      let s = startRound({ roundId: `r${i}`, rules: STANDARD_RULES, seats: [{ seatId: 'a', playerId: 'p', stake: 20 }], shoe });
      while (s.phase === 'player_turns') {
        const h = s.seats[0].hands[s.turn!.hand];
        const legal = legalActions(s, 1e9);
        s = applyAction(s, advise(h.cards.map((c) => c.rank as CoachRank), s.dealer.cards[0].rank as CoachRank, legal).best, 1e9);
      }
      if (s.phase === 'dealer_turn') s = playDealer(s);
      shoe = s.shoe;
      for (const h of s.seats[0].hands) net += (h.returned ?? h.stake) - h.stake;
      staked += 20;
    }
    // Standard deviation per hand is about 1.15 bets, so 40k hands give about +-0.6% at one sigma.
    expect((100 * net) / staked).toBeGreaterThan(-2.4);
    expect((100 * net) / staked).toBeLessThan(1.6);
  }, 60_000);
});
