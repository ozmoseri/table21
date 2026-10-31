import { type Card, type DrawnCard, isTenValue, totals } from './cards.ts';

export interface Rules {
  version: 'std-v1';
  decks: number;
  /** Reshuffle between rounds when fewer than this many cards remain. */
  cutRemaining: number;
  maxHands: number;
  doubleAfterSplit: boolean;
}

export const STANDARD_RULES: Rules = {
  version: 'std-v1',
  decks: 6,
  cutRemaining: 78,
  maxHands: 4,
  doubleAfterSplit: true,
};

export type Phase = 'player_turns' | 'dealer_turn' | 'settled' | 'voided';
export type HandStatus = 'active' | 'waiting' | 'stood' | 'bust' | 'blackjack';
export type Outcome = 'blackjack' | 'win' | 'push' | 'lose';
export type PlayerAction = 'hit' | 'stand' | 'double' | 'split';

export interface HandState {
  cards: DrawnCard[];
  /** Stake in half-coin units. */
  stake: number;
  doubled: boolean;
  fromSplit: boolean;
  splitAces: boolean;
  status: HandStatus;
  outcome?: Outcome;
  /** Gross return in half-coin units, including the stake. Set at settlement. */
  returned?: number;
}

export interface SeatState {
  seatId: string;
  playerId: string;
  hands: HandState[];
}

export type RoundEvent =
  | { type: 'deal'; slot: number; to: 'dealer' | { seat: number; hand: number }; faceDown?: boolean }
  | { type: 'reveal'; slot: number }
  | { type: 'split'; seat: number; hand: number }
  | { type: 'double'; seat: number; hand: number }
  | { type: 'stand'; seat: number; hand: number; auto?: boolean }
  | { type: 'bust'; seat: number; hand: number }
  | { type: 'peek'; dealerNatural: boolean }
  | { type: 'settle' }
  | { type: 'void'; reason: string };

export interface RoundState {
  roundId: string;
  rules: Rules;
  phase: Phase;
  seats: SeatState[];
  dealer: { cards: DrawnCard[]; holeRevealed: boolean };
  turn: { seat: number; hand: number } | null;
  /** Remaining shoe. Server-only. Never send to clients. */
  shoe: Card[];
  nextSlot: number;
  events: RoundEvent[];
  voidReason?: string;
}

export class ShoeExhaustedError extends Error {
  constructor() {
    super('shoe exhausted');
  }
}

export class RuleError extends Error {
  constructor(public code: string) {
    super(code);
  }
}

export interface StartSeat {
  seatId: string;
  playerId: string;
  /** Stake in half-coin units, already reserved by the caller. */
  stake: number;
}

function clone<T>(v: T): T {
  return structuredClone(v);
}

function draw(s: RoundState): DrawnCard {
  const c = s.shoe.shift();
  if (!c) throw new ShoeExhaustedError();
  return { ...c, slot: s.nextSlot++ };
}

export function isNaturalHand(h: Pick<HandState, 'cards' | 'fromSplit'>): boolean {
  return !h.fromSplit && h.cards.length === 2 && totals(h.cards).total === 21;
}

function voided(s: RoundState, reason: string): RoundState {
  s.phase = 'voided';
  s.turn = null;
  s.voidReason = reason;
  s.events.push({ type: 'void', reason });
  return s;
}

/**
 * Deals a new round. American hole-card game: the dealer peeks when the upcard is an ace or ten-value.
 * On shoe exhaustion the returned round is voided and every stake must be refunded by the caller.
 */
export function startRound(input: { roundId: string; rules: Rules; seats: StartSeat[]; shoe: Card[] }): RoundState {
  if (input.seats.length === 0) throw new RuleError('no_seats');
  for (const seat of input.seats) {
    if (!Number.isSafeInteger(seat.stake) || seat.stake <= 0 || seat.stake % 2 !== 0) throw new RuleError('bad_stake');
  }
  const s: RoundState = {
    roundId: input.roundId,
    rules: input.rules,
    phase: 'player_turns',
    seats: input.seats.map((x) => ({
      seatId: x.seatId,
      playerId: x.playerId,
      hands: [{ cards: [], stake: x.stake, doubled: false, fromSplit: false, splitAces: false, status: 'waiting' }],
    })),
    dealer: { cards: [], holeRevealed: false },
    turn: null,
    shoe: input.shoe.slice(),
    nextSlot: 0,
    events: [],
  };
  try {
    for (let pass = 0; pass < 2; pass++) {
      s.seats.forEach((seat, i) => {
        const c = draw(s);
        seat.hands[0].cards.push(c);
        s.events.push({ type: 'deal', slot: c.slot, to: { seat: i, hand: 0 } });
      });
      const d = draw(s);
      s.dealer.cards.push(d);
      s.events.push({ type: 'deal', slot: d.slot, to: 'dealer', faceDown: pass === 1 });
    }
  } catch (e) {
    if (e instanceof ShoeExhaustedError) return voided(s, 'shoe_exhausted');
    throw e;
  }
  for (const seat of s.seats) if (isNaturalHand(seat.hands[0])) seat.hands[0].status = 'blackjack';

  const up = s.dealer.cards[0];
  if (up.rank === 'A' || isTenValue(up.rank)) {
    const dealerNatural = totals(s.dealer.cards).total === 21;
    s.events.push({ type: 'peek', dealerNatural });
    if (dealerNatural) {
      s.dealer.holeRevealed = true;
      s.events.push({ type: 'reveal', slot: s.dealer.cards[1].slot });
      return settle(s);
    }
  }
  return advance(s, 0);
}

/** Moves the turn to the next playable hand starting at seat `from`, dealing split second cards as needed. */
function advance(s: RoundState, from: number): RoundState {
  try {
    for (let i = from; i < s.seats.length; i++) {
      const seat = s.seats[i];
      for (let h = 0; h < seat.hands.length; h++) {
        const hand = seat.hands[h];
        if (hand.status !== 'waiting' && hand.status !== 'active') continue;
        if (hand.cards.length === 1) {
          const c = draw(s);
          hand.cards.push(c);
          s.events.push({ type: 'deal', slot: c.slot, to: { seat: i, hand: h } });
        }
        if (totals(hand.cards).total === 21) {
          hand.status = 'stood';
          s.events.push({ type: 'stand', seat: i, hand: h, auto: true });
          continue;
        }
        hand.status = 'active';
        s.turn = { seat: i, hand: h };
        return s;
      }
    }
  } catch (e) {
    if (e instanceof ShoeExhaustedError) return voided(s, 'shoe_exhausted');
    throw e;
  }
  s.turn = null;
  s.phase = 'dealer_turn';
  return s;
}

function currentHand(s: RoundState): HandState {
  if (s.phase !== 'player_turns' || !s.turn) throw new RuleError('not_player_turn');
  return s.seats[s.turn.seat].hands[s.turn.hand];
}

/** Legal actions for the hand whose turn it is, given the player's available half-coin units. */
export function legalActions(s: RoundState, availableUnits: number): PlayerAction[] {
  if (s.phase !== 'player_turns' || !s.turn) return [];
  const seat = s.seats[s.turn.seat];
  const hand = seat.hands[s.turn.hand];
  if (hand.status !== 'active') return [];
  const out: PlayerAction[] = ['stand'];
  if (hand.splitAces) return out;
  if (totals(hand.cards).total < 21) out.unshift('hit');
  if (hand.cards.length === 2) {
    const canAfford = availableUnits >= hand.stake;
    if (canAfford && (!hand.fromSplit || s.rules.doubleAfterSplit)) out.push('double');
    if (canAfford && hand.cards[0].rank === hand.cards[1].rank && seat.hands.length < s.rules.maxHands) out.push('split');
  }
  return out;
}

/** Extra stake (half-coin units) the action requires the caller to reserve before applying it. */
export function requiredStake(s: RoundState, action: PlayerAction): number {
  if (action !== 'double' && action !== 'split') return 0;
  return currentHand(s).stake;
}

/**
 * Applies a player action for the hand whose turn it is. The caller must have verified seat ownership
 * and reserved `requiredStake` from the player's funds. Returns a new state.
 */
export function applyAction(prev: RoundState, action: PlayerAction, availableUnits: number): RoundState {
  const s = clone(prev);
  const hand = currentHand(s);
  if (!legalActions(s, availableUnits).includes(action)) throw new RuleError('illegal_action');
  const { seat: si, hand: hi } = s.turn!;
  try {
    if (action === 'stand') {
      hand.status = 'stood';
      s.events.push({ type: 'stand', seat: si, hand: hi });
    } else if (action === 'hit' || action === 'double') {
      if (action === 'double') {
        hand.stake *= 2;
        hand.doubled = true;
        s.events.push({ type: 'double', seat: si, hand: hi });
      }
      const c = draw(s);
      hand.cards.push(c);
      s.events.push({ type: 'deal', slot: c.slot, to: { seat: si, hand: hi } });
      const t = totals(hand.cards).total;
      if (t > 21) {
        hand.status = 'bust';
        s.events.push({ type: 'bust', seat: si, hand: hi });
      } else if (action === 'double' || t === 21) {
        hand.status = 'stood';
        s.events.push({ type: 'stand', seat: si, hand: hi, auto: true });
      }
      if (hand.status === 'active') return s;
    } else {
      const seat = s.seats[si];
      const aces = hand.cards[0].rank === 'A';
      const second: HandState = {
        cards: [hand.cards[1]],
        stake: hand.stake,
        doubled: false,
        fromSplit: true,
        splitAces: aces,
        status: 'waiting',
      };
      hand.cards = [hand.cards[0]];
      hand.fromSplit = true;
      hand.splitAces = aces;
      seat.hands.splice(hi + 1, 0, second);
      s.events.push({ type: 'split', seat: si, hand: hi });
      if (aces) {
        for (const [idx, h] of [[hi, hand], [hi + 1, second]] as const) {
          const c = draw(s);
          h.cards.push(c);
          h.status = 'stood';
          s.events.push({ type: 'deal', slot: c.slot, to: { seat: si, hand: idx } });
          s.events.push({ type: 'stand', seat: si, hand: idx, auto: true });
        }
      } else {
        const c = draw(s);
        hand.cards.push(c);
        s.events.push({ type: 'deal', slot: c.slot, to: { seat: si, hand: hi } });
        if (totals(hand.cards).total === 21) {
          hand.status = 'stood';
          s.events.push({ type: 'stand', seat: si, hand: hi, auto: true });
        } else return s;
      }
    }
  } catch (e) {
    if (e instanceof ShoeExhaustedError) return voided(s, 'shoe_exhausted');
    throw e;
  }
  return advance(s, si);
}

/** Turn timeout: stand on the active unresolved hand. */
export function timeoutStand(prev: RoundState): RoundState {
  const s = clone(prev);
  const hand = currentHand(s);
  const { seat, hand: h } = s.turn!;
  hand.status = 'stood';
  s.events.push({ type: 'stand', seat, hand: h, auto: true });
  return advance(s, seat);
}

function hasLiveHand(s: RoundState): boolean {
  return s.seats.some((seat) => seat.hands.some((h) => h.status === 'stood'));
}

export type DealerStep = 'reveal' | 'draw' | 'settle';

/** What the next mandatory dealer step is. The dealer stands on all 17s. */
export function nextDealerStep(s: RoundState): DealerStep | null {
  if (s.phase !== 'dealer_turn') return null;
  if (!s.dealer.holeRevealed) return 'reveal';
  if (hasLiveHand(s) && totals(s.dealer.cards).total < 17) return 'draw';
  return 'settle';
}

/** Performs exactly the next mandatory dealer step. A presenter can trigger it but cannot choose it. */
export function dealerStep(prev: RoundState): RoundState {
  const s = clone(prev);
  const step = nextDealerStep(s);
  if (!step) throw new RuleError('not_dealer_turn');
  if (step === 'reveal') {
    s.dealer.holeRevealed = true;
    s.events.push({ type: 'reveal', slot: s.dealer.cards[1].slot });
    return s;
  }
  if (step === 'draw') {
    try {
      const c = draw(s);
      s.dealer.cards.push(c);
      s.events.push({ type: 'deal', slot: c.slot, to: 'dealer' });
    } catch (e) {
      if (e instanceof ShoeExhaustedError) return voided(s, 'shoe_exhausted');
      throw e;
    }
    return s;
  }
  return settle(s);
}

/** Runs the dealer to completion (automatic dealer). */
export function playDealer(prev: RoundState): RoundState {
  let s = prev;
  while (s.phase === 'dealer_turn') s = dealerStep(s);
  return s;
}

function settle(s: RoundState): RoundState {
  const dealerTotal = totals(s.dealer.cards).total;
  const dealerNatural = isNaturalHand({ cards: s.dealer.cards, fromSplit: false });
  for (const seat of s.seats) {
    for (const h of seat.hands) {
      const t = totals(h.cards).total;
      let outcome: Outcome;
      if (h.status === 'bust' || t > 21) outcome = 'lose';
      else if (h.status === 'blackjack') outcome = dealerNatural ? 'push' : 'blackjack';
      else if (dealerNatural) outcome = 'lose';
      else if (dealerTotal > 21 || t > dealerTotal) outcome = 'win';
      else if (t === dealerTotal) outcome = 'push';
      else outcome = 'lose';
      h.outcome = outcome;
      h.returned = grossReturn(h.stake, outcome);
    }
  }
  s.phase = 'settled';
  s.turn = null;
  s.events.push({ type: 'settle' });
  return s;
}

/** Gross return in half-coin units including the stake. */
export function grossReturn(stake: number, outcome: Outcome): number {
  switch (outcome) {
    case 'lose':
      return 0;
    case 'push':
      return stake;
    case 'win':
      return stake * 2;
    case 'blackjack': {
      const r = stake + (stake * 3) / 2;
      if (!Number.isSafeInteger(r)) throw new RuleError('non_integer_payout');
      return r;
    }
  }
}

/** Total stake (units) committed by a seat, including doubles and splits. */
export function seatStake(seat: SeatState): number {
  return seat.hands.reduce((a, h) => a + h.stake, 0);
}

export function seatReturn(seat: SeatState): number {
  return seat.hands.reduce((a, h) => a + (h.returned ?? 0), 0);
}
