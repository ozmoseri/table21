/**
 * The single feel configuration: every presentation number (motion timing, celebration, sound mix, haptics, coach
 * verdict) lives here and nowhere else. The modules that used to hold them (anim/timing.ts, fx/celebrate.ts,
 * sound.ts, haptics.ts, components/Coach.tsx) re-export from FEEL under their old names, so callers do not change.
 *
 * This file is presentation only. It has no imports, and rules, odds, payouts and packages/game-engine never read it.
 * The server never waits for any of these numbers. Values are the shipped ones; changing a value here changes how the
 * game feels, so tests/unit/feel.test.ts and tests/unit/motion.test.ts pin them.
 */

export type FeelDealSpeed = 'elegant' | 'quick' | 'turbo';
export type FeelSfx = 'tap' | 'chip' | 'bet' | 'deal' | 'flip' | 'turn' | 'payout' | 'win' | 'blackjack' | 'lose' | 'gift' | 'reward';
export type FeelHaptic = 'selection' | 'land' | 'bet' | 'bust' | 'turnWarning' | 'win' | 'blackjack';

function deepFreeze<T>(o: T): T {
  if (o && typeof o === 'object' && !Object.isFrozen(o)) {
    Object.freeze(o);
    for (const v of Object.values(o as Record<string, unknown>)) deepFreeze(v);
  }
  return o;
}

export const FEEL = deepFreeze({
  /** Dealing rhythm. All values are Elegant milliseconds; Quick and Turbo scale every one of them (speedFactor). */
  timing: {
    base: {
      /** the dealer's draw beat before the first card of a round; it also lets the deal tap's screen change finish */
      drawLead: 80,
      /** end of a hand: cards are collected toward the discard corner (copies; never delays the next state) */
      sweep: 300,
      /** a win is paid: chips travel from the dealer to my stake */
      payout: 400,
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
      /** fixed beat before each dealer draw */
      dealerPause: 300,
      /** natural blackjack celebration, skippable */
      natural: 900,
    },
    speedFactor: { elegant: 1, quick: 0.62, turbo: 0.35 } as Record<FeelDealSpeed, number>,
    /** the rest of a queue plays at Turbo when the server says it is my turn while cards are still flying... */
    catchUpFactor: 0.35,
    /** ...but only if more than this much (real ms) is still queued, so an ordinary deal keeps its rhythm */
    catchUpAfterMs: 1500,
    /** a queue longer than this (real ms) is compressed; much longer (reconnect, background) is snapped */
    maxLagMs: 3000,
    snapLagMs: 6000,
  },
  /** What a settled hand earns on screen. Loss and push get quiet feedback only. */
  celebrate: {
    ms: { win: 500, bj: 900, lose: 220, push: 200 },
    skippableAfterMs: 600,
    /** natural blackjack gold sparkles, CSS only, none with reduced motion */
    sparkles: 24,
  },
  /** Coach verdict after a decision, ms. The CSS animation `coach-pop 2.2s` in theme/premium.css must match this value. */
  coach: { verdictMs: 2200 },
  sound: {
    /** at most this many voices at once; a win or blackjack stinger may take the oldest, anything else is dropped */
    maxVoices: 3,
    /** card sounds only: a pitch between 1 - pitchRange and 1 + pitchRange */
    pitchRange: 0.02,
    /** the stinger ducks the other effects and the ambience by this many dB while it plays */
    duckDb: 4,
    /** master gain before the limiter */
    masterGain: 2.4,
    /** minimum seconds between two plays of the same sound */
    gap: { tap: 0.03, chip: 0.04, bet: 0.12, deal: 0.05, flip: 0.15, turn: 0.4, payout: 0.3, win: 0.6, blackjack: 0.8, lose: 0.5, gift: 0.5, reward: 0.6 } as Record<FeelSfx, number>,
    /** approximate length in seconds (the voice budget) */
    len: { tap: 0.04, chip: 0.1, bet: 0.16, deal: 0.09, flip: 0.12, turn: 0.13, payout: 0.36, win: 0.36, blackjack: 0.62, lose: 0.24, gift: 0.5, reward: 0.55 } as Record<FeelSfx, number>,
    /** per-sound layer levels, in the order the layers appear in synth() (sound.ts) */
    level: {
      tap: [0.025],
      chip: [0.07, 0.045],
      bet: [0.22, 0.18],
      deal: [0.24, 0.16],
      flip: [0.26, 0.18],
      turn: [0.045],
      payout: [0.05],
      win: [0.045, 0.06, 0.05],
      blackjack: [0.055],
      lose: [0.12],
      gift: [0.04, 0.025],
      reward: [0.045],
    } as Record<FeelSfx, readonly number[]>,
    /** output protection: a fast compressor used as a limiter, then a trim */
    limiter: { threshold: -9, knee: 6, ratio: 16, attack: 0.002, release: 0.12, trim: 0.85 },
    /** room tone: bus gain, source gain, and the low-pass frequency. Off by default (prefs.ambience). */
    ambience: { busGain: 0.5, sourceGain: 0.05, lowpassHz: 420 },
  },
  /** navigator.vibrate patterns (ms). Longer patterns are skipped with reduced motion. */
  haptics: {
    selection: 8,
    land: 12, // my own card lands
    bet: 10,
    bust: 30,
    turnWarning: [15, 90, 15] as readonly number[], // 5 s left on my turn
    win: [12, 60, 12] as readonly number[],
    blackjack: [20, 60, 20, 60, 40] as readonly number[],
  },
});
