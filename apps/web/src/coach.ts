/**
 * Coach: basic strategy for TABLE21's rules (6 decks, dealer stands on all 17s, peek, double on any two cards,
 * double after split, no surrender, no insurance). Pure and client side.
 *
 * Fairness: the advice uses only what the player already sees, their own cards and the dealer's up card. It never
 * reads the shoe, cards already played or the hole card, so it gives no edge beyond a printed strategy card.
 */
import type { PlayerAction } from '@table21/game-engine';

export type CoachRank = 'A' | '2' | '3' | '4' | '5' | '6' | '7' | '8' | '9' | '10' | 'J' | 'Q' | 'K';

/** Why the move is right, as an i18n key (coachWhy*) with its {total}/{up}/{pair} values. */
export type Reason =
  | 'safeHit'
  | 'softHit'
  | 'strongStand'
  | 'dealerWeakStand'
  | 'dealerStrongHit'
  | 'twelveHit'
  | 'doubleStrong'
  | 'doubleSoft'
  | 'softStand'
  | 'splitAces'
  | 'splitEights'
  | 'splitWeakDealer'
  | 'keepTwenty'
  | 'keepPair';

export interface Advice {
  /** Best legal move now. */
  best: PlayerAction;
  /** Best move if every action were allowed (differs when doubling is no longer possible). */
  ideal: PlayerAction;
  reason: Reason;
  total: number;
  soft: boolean;
  /** Dealer up card value, 2..11 (11 = ace). */
  up: number;
  /** Chance that one more card busts this hand (infinite-deck estimate, 0..1). */
  bustRisk: number;
}

export const cardValue = (r: CoachRank): number => (r === 'A' ? 11 : r === 'J' || r === 'Q' || r === 'K' ? 10 : Number(r));

export function handTotal(ranks: readonly CoachRank[]): { total: number; soft: boolean } {
  let hard = 0;
  let aces = 0;
  for (const r of ranks) {
    hard += r === 'A' ? 1 : cardValue(r);
    if (r === 'A') aces++;
  }
  if (aces && hard + 10 <= 21) return { total: hard + 10, soft: true };
  return { total: hard, soft: false };
}

/** Probability that the next card busts the hand, with ten-value cards at 4/13 (an infinite shoe). */
export function bustRisk(ranks: readonly CoachRank[]): number {
  const { total, soft } = handTotal(ranks);
  if (soft || total <= 11) return 0;
  const room = 21 - total; // largest card value that does not bust (ace counts 1)
  let bust = 0;
  for (let v = 2; v <= 10; v++) if (v > room) bust += v === 10 ? 4 : 1;
  return bust / 13;
}

type Ideal = { move: PlayerAction | 'doubleOrHit' | 'doubleOrStand'; reason: Reason };

function pairMove(v: number, up: number): Ideal | null {
  const weak = up >= 2 && up <= 6;
  switch (v) {
    case 11:
      return { move: 'split', reason: 'splitAces' };
    case 10:
      return { move: 'stand', reason: 'keepTwenty' };
    case 9:
      return up === 7 || up === 10 || up === 11 ? { move: 'stand', reason: 'keepPair' } : { move: 'split', reason: 'splitWeakDealer' };
    case 8:
      return { move: 'split', reason: 'splitEights' };
    case 7:
    case 3:
    case 2:
      return up <= 7 ? { move: 'split', reason: 'splitWeakDealer' } : null;
    case 6:
      return weak ? { move: 'split', reason: 'splitWeakDealer' } : null;
    case 4:
      return up === 5 || up === 6 ? { move: 'split', reason: 'splitWeakDealer' } : null;
    default:
      return null; // 5,5 plays as a hard 10
  }
}

function softMove(total: number, up: number): Ideal {
  if (total >= 19) return { move: 'stand', reason: 'strongStand' };
  if (total === 18) {
    if (up >= 3 && up <= 6) return { move: 'doubleOrStand', reason: 'doubleSoft' };
    if (up <= 8) return { move: 'stand', reason: 'softStand' };
    return { move: 'hit', reason: 'softHit' };
  }
  const from = total === 17 ? 3 : total >= 15 ? 4 : 5;
  if (up >= from && up <= 6) return { move: 'doubleOrHit', reason: 'doubleSoft' };
  return { move: 'hit', reason: 'softHit' };
}

function hardMove(total: number, up: number): Ideal {
  if (total >= 17) return { move: 'stand', reason: 'strongStand' };
  if (total >= 13) return up <= 6 ? { move: 'stand', reason: 'dealerWeakStand' } : { move: 'hit', reason: 'dealerStrongHit' };
  if (total === 12) return up >= 4 && up <= 6 ? { move: 'stand', reason: 'dealerWeakStand' } : { move: 'hit', reason: 'twelveHit' };
  if (total === 11) return up <= 10 ? { move: 'doubleOrHit', reason: 'doubleStrong' } : { move: 'hit', reason: 'safeHit' };
  if (total === 10) return up <= 9 ? { move: 'doubleOrHit', reason: 'doubleStrong' } : { move: 'hit', reason: 'safeHit' };
  if (total === 9) return up >= 3 && up <= 6 ? { move: 'doubleOrHit', reason: 'doubleStrong' } : { move: 'hit', reason: 'safeHit' };
  return { move: 'hit', reason: 'safeHit' };
}

/** Basic-strategy advice for one hand. `legal` is the list of moves the table allows right now. */
export function advise(ranks: readonly CoachRank[], dealerUp: CoachRank, legal: readonly PlayerAction[]): Advice {
  const { total, soft } = handTotal(ranks);
  const up = cardValue(dealerUp);
  let ideal: Ideal | null = null;
  if (ranks.length === 2 && cardValue(ranks[0]) === cardValue(ranks[1])) {
    const p = pairMove(cardValue(ranks[0]), up);
    if (p && (p.move !== 'split' || legal.includes('split'))) ideal = p;
  }
  ideal ??= soft ? softMove(total, up) : hardMove(total, up);
  const canDouble = legal.includes('double');
  let best: PlayerAction;
  let idealMove: PlayerAction;
  if (ideal.move === 'doubleOrHit' || ideal.move === 'doubleOrStand') {
    idealMove = 'double';
    best = canDouble ? 'double' : ideal.move === 'doubleOrHit' ? 'hit' : 'stand';
  } else {
    idealMove = ideal.move;
    best = ideal.move;
  }
  // Never recommend something the table does not allow; hit and stand are always allowed on a live hand.
  if (!legal.includes(best)) best = total >= 17 ? 'stand' : 'hit';
  let reason = ideal.reason;
  if (best !== idealMove && (reason === 'doubleStrong' || reason === 'doubleSoft')) reason = best === 'stand' ? 'softStand' : soft ? 'softHit' : 'safeHit';
  return { best, ideal: idealMove, reason, total, soft, up, bustRisk: bustRisk(ranks) };
}

/** Session record for the "how did I play" line (chess.com style accuracy), kept in memory on this device only. */
const session = { decisions: 0, correct: 0 };
export function recordDecision(advice: Advice, chosen: PlayerAction): boolean {
  const ok = chosen === advice.best;
  session.decisions++;
  if (ok) session.correct++;
  return ok;
}
export const coachSession = () => ({ ...session });
export function resetCoachSession() {
  session.decisions = 0;
  session.correct = 0;
}
