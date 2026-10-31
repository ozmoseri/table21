export type Suit = 'S' | 'H' | 'D' | 'C';
export type Rank = 'A' | '2' | '3' | '4' | '5' | '6' | '7' | '8' | '9' | '10' | 'J' | 'Q' | 'K';

export const SUITS: Suit[] = ['S', 'H', 'D', 'C'];
export const RANKS: Rank[] = ['A', '2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K'];

/** A physical card in the shoe. `uid` is unique per physical card in a shoe and is server-only. */
export interface Card {
  uid: number;
  rank: Rank;
  suit: Suit;
}

/** A card that has been drawn in a round. `slot` is the draw order inside the round (public, opaque). */
export interface DrawnCard extends Card {
  slot: number;
}

/** Uniform integer source. `int(n)` must return an unbiased integer in [0, n). */
export interface Rng {
  int(maxExclusive: number): number;
}

/**
 * Cryptographic RNG using rejection sampling over 32-bit values from Web Crypto,
 * which is available in Node 22+ and in browsers. No seed can be injected.
 */
export function cryptoRng(): Rng {
  const buf = new Uint32Array(1);
  return {
    int(n: number) {
      if (!Number.isInteger(n) || n <= 0 || n > 2 ** 32) throw new RangeError('bad range');
      const limit = 2 ** 32 - (2 ** 32 % n);
      for (;;) {
        globalThis.crypto.getRandomValues(buf);
        const v = buf[0];
        if (v < limit) return v % n;
      }
    },
  };
}

export function buildShoe(decks: number): Card[] {
  const cards: Card[] = [];
  let uid = 0;
  for (let d = 0; d < decks; d++) {
    for (const suit of SUITS) for (const rank of RANKS) cards.push({ uid: uid++, rank, suit });
  }
  return cards;
}

/** Unbiased Fisher-Yates. Returns a new array. */
export function shuffle<T>(items: readonly T[], rng: Rng): T[] {
  const a = items.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = rng.int(i + 1);
    const t = a[i];
    a[i] = a[j];
    a[j] = t;
  }
  return a;
}

export function newShuffledShoe(decks: number, rng: Rng): Card[] {
  return shuffle(buildShoe(decks), rng);
}

export function isTenValue(rank: Rank): boolean {
  return rank === '10' || rank === 'J' || rank === 'Q' || rank === 'K';
}

export function rankValue(rank: Rank): number {
  if (rank === 'A') return 1;
  if (isTenValue(rank)) return 10;
  return Number(rank);
}

export interface Totals {
  /** Best total not exceeding 21 when possible. */
  total: number;
  /** Total counting every ace as 1. */
  hard: number;
  /** True when an ace is counted as 11 in `total`. */
  soft: boolean;
}

export function totals(cards: readonly Pick<Card, 'rank'>[]): Totals {
  let hard = 0;
  let aces = 0;
  for (const c of cards) {
    hard += rankValue(c.rank);
    if (c.rank === 'A') aces++;
  }
  if (aces > 0 && hard + 10 <= 21) return { total: hard + 10, hard, soft: true };
  return { total: hard, hard, soft: false };
}
