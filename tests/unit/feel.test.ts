import { describe, expect, it } from 'vitest';
import { FEEL } from '../../apps/web/src/feel.ts';
import { BASE, SPEED_FACTOR, CATCH_UP_FACTOR, CATCH_UP_AFTER_MS, MAX_LAG_MS, SNAP_LAG_MS, catchUpMode } from '../../apps/web/src/anim/timing.ts';
import { CELEBRATE_MS, SKIPPABLE_AFTER_MS, SPARKLES } from '../../apps/web/src/fx/celebrate.ts';
import { HAPTICS } from '../../apps/web/src/haptics.ts';
import { MAX_VOICES, PITCH_RANGE, DUCK_DB, admit, cardPitch } from '../../apps/web/src/sound.ts';

// The old modules still export their old names; callers must see exactly the FEEL numbers, and those are the shipped ones.
describe('feel config', () => {
  it('is deeply frozen', () => {
    expect(Object.isFrozen(FEEL)).toBe(true);
    for (const g of [FEEL.timing, FEEL.timing.base, FEEL.timing.speedFactor, FEEL.celebrate, FEEL.celebrate.ms, FEEL.coach, FEEL.sound, FEEL.sound.gap, FEEL.sound.len, FEEL.sound.level, FEEL.sound.level.win, FEEL.sound.limiter, FEEL.sound.ambience, FEEL.haptics, FEEL.haptics.blackjack])
      expect(Object.isFrozen(g)).toBe(true);
    expect(() => {
      (FEEL.timing.base as { flight: number }).flight = 1;
    }).toThrow();
    expect(FEEL.timing.base.flight).toBe(260);
  });

  it('timing: old exports are the FEEL values', () => {
    expect(BASE).toBe(FEEL.timing.base);
    expect(SPEED_FACTOR).toEqual({ elegant: 1, quick: 0.62, turbo: 0.35 });
    expect(SPEED_FACTOR).toBe(FEEL.timing.speedFactor);
    expect(CATCH_UP_FACTOR).toBe(SPEED_FACTOR.turbo);
    expect(CATCH_UP_AFTER_MS).toBe(1500);
    expect(MAX_LAG_MS).toBe(3000);
    expect(SNAP_LAG_MS).toBe(6000);
    expect(BASE).toEqual({ drawLead: 80, sweep: 300, payout: 400, stagger: 200, flight: 260, flip: 220, settle: 60, revealLift: 120, revealPause: 250, revealFlip: 320, revealLand: 80, peek: 600, dealerPause: 300, natural: 900 });
    // callers see the same behavior
    expect(catchUpMode(7000, false)).toBe('snap');
    expect(catchUpMode(1600, true)).toBe('turbo');
    expect(catchUpMode(1600, false)).toBe('none');
    expect(catchUpMode(3100, false)).toBe('turbo');
  });

  it('celebration: old exports are the FEEL values', () => {
    expect(CELEBRATE_MS).toEqual({ win: 500, bj: 900, lose: 220, push: 200 });
    expect(CELEBRATE_MS).toBe(FEEL.celebrate.ms);
    expect(SKIPPABLE_AFTER_MS).toBe(600);
    expect(SPARKLES).toBe(24);
    expect(FEEL.coach.verdictMs).toBe(2200); // theme/premium.css coach-pop 2.2s must match
  });

  it('sound: old exports are the FEEL values and behave the same', () => {
    expect(MAX_VOICES).toBe(FEEL.sound.maxVoices);
    expect(MAX_VOICES).toBe(3);
    expect(PITCH_RANGE).toBe(0.02);
    expect(DUCK_DB).toBe(4);
    for (let i = 0; i < 200; i++) {
      const p = cardPitch();
      expect(p).toBeGreaterThanOrEqual(1 - FEEL.sound.pitchRange);
      expect(p).toBeLessThanOrEqual(1 + FEEL.sound.pitchRange);
    }
    const full = [
      { s: 'deal' as const, end: 1 },
      { s: 'flip' as const, end: 1 },
      { s: 'chip' as const, end: 1 },
    ];
    expect(admit(full, 'tap')).toBe(-2);
    expect(admit(full, 'win')).toBe(0);
    expect(FEEL.sound.limiter).toEqual({ threshold: -9, knee: 6, ratio: 16, attack: 0.002, release: 0.12, trim: 0.85 });
    expect(FEEL.sound.masterGain).toBe(2.4);
    expect(FEEL.sound.ambience).toEqual({ busGain: 0.5, sourceGain: 0.05, lowpassHz: 420 });
    // every sound has a gap, a length and at least one level
    for (const s of Object.keys(FEEL.sound.gap)) {
      expect(FEEL.sound.len[s as keyof typeof FEEL.sound.len]).toBeGreaterThan(0);
      expect(FEEL.sound.level[s as keyof typeof FEEL.sound.level].length).toBeGreaterThan(0);
    }
  });

  it('haptics: old export is the FEEL value', () => {
    expect(HAPTICS).toBe(FEEL.haptics);
    expect(HAPTICS.selection).toBe(8);
    expect(HAPTICS.land).toBe(12);
    expect(HAPTICS.bet).toBe(10);
    expect(HAPTICS.bust).toBe(30);
    expect([...HAPTICS.turnWarning]).toEqual([15, 90, 15]);
    expect([...HAPTICS.win]).toEqual([12, 60, 12]);
    expect([...HAPTICS.blackjack]).toEqual([20, 60, 20, 60, 40]);
  });
});
