import type { Card, Rank, Rng, Suit } from '@table21/game-engine';

/** Test-only seeded RNG (mulberry32). Never imported by production code. */
export function seededRng(seed: number): Rng {
  let a = seed >>> 0;
  return {
    int(n: number) {
      a = (a + 0x6d2b79f5) >>> 0;
      let t = a;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      const r = ((t ^ (t >>> 14)) >>> 0) / 4294967296;
      return Math.floor(r * n);
    },
  };
}

/** Builds a stacked shoe from ranks in draw order. Suits rotate so cards stay distinct. */
export function stacked(ranks: Rank[], filler = 0): Card[] {
  const suits: Suit[] = ['S', 'H', 'D', 'C'];
  const out: Card[] = ranks.map((rank, i) => ({ uid: 1000 + i, rank, suit: suits[i % 4] }));
  for (let i = 0; i < filler; i++) out.push({ uid: 5000 + i, rank: '2', suit: 'C' });
  return out;
}

/**
 * Deal order for N seats: seat1..seatN first card, dealer up, seat1..seatN second card, dealer hole.
 * Helper returns the shoe for one seat: [p1, d-up, p2, d-hole, ...rest].
 */
export function oneSeat(p1: Rank, up: Rank, p2: Rank, hole: Rank, rest: Rank[] = []): Card[] {
  return stacked([p1, up, p2, hole, ...rest], 20);
}
