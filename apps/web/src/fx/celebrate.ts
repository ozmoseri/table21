import { FEEL } from '../feel.ts';

/** What a settled hand earns on screen (DECISIONS 9, GROKBOT F5): decided by total net only. */
export type CelebrationKind = 'bj' | 'win';

/** Natural blackjack banner when it nets a profit; a win when net > 0; nothing for a push or any net <= 0. */
export const celebrationFor = (net: number, natural: boolean): CelebrationKind | null => (net > 0 ? (natural ? 'bj' : 'win') : null);

/**
 * Win 500 ms, natural blackjack 900 ms (skippable after 600). Loss and push get quiet feedback only (220 / 200 ms):
 * a calm settle of the cards, the stake returning to the stack. Neither shows a banner.
 */
export const CELEBRATE_MS = FEEL.celebrate.ms;
export const SKIPPABLE_AFTER_MS = FEEL.celebrate.skippableAfterMs;

/** Natural blackjack: 24 gold sparkles (the bible allows up to 40), CSS only, none with reduced motion. */
export const SPARKLES = FEEL.celebrate.sparkles;
