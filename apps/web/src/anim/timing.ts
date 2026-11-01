/**
 * Dealing rhythm (DECISIONS.md 1-3, docs/MOTION_SPEC.md "v5"). All values are Elegant milliseconds; Quick and Turbo
 * scale every one of them. The server never waits for any of this: the client plays a queue of visual events and
 * compresses it when the player has to act.
 */
export const BASE = {
  /** next card of the opening deal leaves the shoe this long after the previous one (deals overlap) */
  stagger: 200,
  /** shoe to place, arc flight including the landing settle */
  flight: 260,
  /** a face-up card turns over right after it lands */
  flip: 220,
  /** small breath after a flip before its value counts in the total */
  settle: 60,
  /** hole card reveal: lift, pause, slow flip, land (about 770 ms) */
  revealLift: 120,
  revealPause: 250,
  revealFlip: 320,
  revealLand: 80,
  /** dealer peeks under the hole card when the up card is an ace or a ten */
  peek: 600,
  /** fixed beat before each dealer draw (never longer when the dealer is close to busting) */
  dealerPause: 300,
  /** natural blackjack celebration, skippable */
  natural: 900,
};

export type DealSpeed = 'elegant' | 'quick' | 'turbo';
/** Quick matches DECISIONS (stagger 120, flight 170); Turbo for players who just want the result. */
export const SPEED_FACTOR: Record<DealSpeed, number> = { elegant: 1, quick: 0.62, turbo: 0.35 };

/** When the server says it is the player's turn while the queue is still playing, the rest plays at Turbo. */
export const CATCH_UP_FACTOR = SPEED_FACTOR.turbo;
/** ...but only if more than this much (real time) is still queued, so an ordinary deal keeps its rhythm. */
export const CATCH_UP_AFTER_MS = 1500;
/** A queue longer than this (real time) is compressed; much longer (reconnect, background) is snapped. */
export const MAX_LAG_MS = 3000;
export const SNAP_LAG_MS = 6000;

export const isTenOrAce = (rank?: string) => rank === 'A' || rank === '10' || rank === 'J' || rank === 'Q' || rank === 'K';

/**
 * What the queue does when a snapshot arrives while it is still playing (DECISIONS 3).
 * lagMs: real milliseconds of animation still queued. myTimer: the server says it is this player's turn and a real
 * turn timer is running (online only; local games have no timer and keep the dealer's rhythm).
 */
export function catchUpMode(lagMs: number, myTimer: boolean): 'none' | 'turbo' | 'snap' {
  if (lagMs > SNAP_LAG_MS) return 'snap';
  if ((myTimer && lagMs > CATCH_UP_AFTER_MS) || lagMs > MAX_LAG_MS) return 'turbo';
  return 'none';
}
