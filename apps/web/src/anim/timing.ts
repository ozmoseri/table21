import { FEEL, type FeelDealSpeed } from '../feel.ts';

/**
 * Dealing rhythm (DECISIONS.md 1-3, docs/MOTION_SPEC.md "v5"). All values are Elegant milliseconds; Quick and Turbo
 * scale every one of them. The server never waits for any of this: the client plays a queue of visual events and
 * compresses it when the player has to act.
 */
export const BASE = FEEL.timing.base;

export type DealSpeed = FeelDealSpeed;
/** Quick matches DECISIONS (stagger 120, flight 170); Turbo for players who just want the result. */
export const SPEED_FACTOR: Record<DealSpeed, number> = FEEL.timing.speedFactor;

/** When the server says it is the player's turn while the queue is still playing, the rest plays at Turbo. */
export const CATCH_UP_FACTOR = FEEL.timing.catchUpFactor;
/** ...but only if more than this much (real time) is still queued, so an ordinary deal keeps its rhythm. */
export const CATCH_UP_AFTER_MS = FEEL.timing.catchUpAfterMs;
/** A queue longer than this (real time) is compressed; much longer (reconnect, background) is snapped. */
export const MAX_LAG_MS = FEEL.timing.maxLagMs;
export const SNAP_LAG_MS = FEEL.timing.snapLagMs;

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
