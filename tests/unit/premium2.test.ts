import { describe, expect, it } from 'vitest';
import { DUCK_DB, MAX_VOICES, PITCH_RANGE, admit, cardPitch } from '../../apps/web/src/sound.ts';
import { HAPTICS } from '../../apps/web/src/haptics.ts';
import { CELEBRATE_MS, SKIPPABLE_AFTER_MS, SPARKLES, celebrationFor } from '../../apps/web/src/fx/celebrate.ts';

describe('stage 4 audio (DECISIONS 10)', () => {
  it('at most 3 voices; a fourth ordinary sound is dropped', () => {
    expect(MAX_VOICES).toBe(3);
    const busy = [
      { s: 'deal' as const, end: 1 },
      { s: 'deal' as const, end: 1 },
      { s: 'chip' as const, end: 1 },
    ];
    expect(admit(busy.slice(0, 2), 'deal')).toBe(-1);
    expect(admit(busy, 'deal')).toBe(-2);
    expect(admit(busy, 'turn')).toBe(-2);
  });

  it('a win or blackjack stinger takes the oldest ordinary voice instead of making a fourth', () => {
    const busy = [
      { s: 'deal' as const, end: 1 },
      { s: 'flip' as const, end: 1 },
      { s: 'chip' as const, end: 1 },
    ];
    expect(admit(busy, 'win')).toBe(0);
    expect(admit(busy, 'blackjack')).toBe(0);
    const stingers = [
      { s: 'win' as const, end: 1 },
      { s: 'blackjack' as const, end: 1 },
      { s: 'win' as const, end: 1 },
    ];
    expect(admit(stingers, 'blackjack')).toBe(-2);
  });

  it('card pitch stays within +-2%; the stinger ducks the mix by 4 dB', () => {
    expect(PITCH_RANGE).toBe(0.02);
    for (let i = 0; i < 500; i++) {
      const p = cardPitch();
      expect(p).toBeGreaterThanOrEqual(0.98);
      expect(p).toBeLessThanOrEqual(1.02);
    }
    expect(DUCK_DB).toBe(4);
  });

  it('haptic patterns follow DESIGN_BIBLE 7', () => {
    expect(HAPTICS.selection).toBe(8);
    expect(HAPTICS.land).toBe(12);
    expect(HAPTICS.bet).toBe(10);
    expect(HAPTICS.bust).toBe(30);
    expect(HAPTICS.blackjack).toEqual([20, 60, 20, 60, 40]);
  });
});

describe('stage 5 celebrations by total net (DECISIONS 9, F5)', () => {
  it('never celebrates net <= 0: push, loss, or a natural inside a split that loses overall', () => {
    expect(celebrationFor(0, false)).toBeNull();
    expect(celebrationFor(-50, false)).toBeNull();
    expect(celebrationFor(0, true)).toBeNull();
    expect(celebrationFor(-25, true)).toBeNull();
    expect(celebrationFor(50, false)).toBe('win');
    expect(celebrationFor(75, true)).toBe('bj');
  });

  it('win 500 ms, natural 900 ms skippable after 600, at most 40 particles; no 10x big-win kind exists', () => {
    expect(CELEBRATE_MS.win).toBe(500);
    expect(CELEBRATE_MS.bj).toBe(900);
    expect(SKIPPABLE_AFTER_MS).toBe(600);
    expect(SPARKLES).toBeLessThanOrEqual(40);
    expect(Object.keys(CELEBRATE_MS).sort()).toEqual(['bj', 'lose', 'push', 'win']);
    expect(CELEBRATE_MS.lose).toBeGreaterThanOrEqual(150), expect(CELEBRATE_MS.lose).toBeLessThanOrEqual(250);
    expect(CELEBRATE_MS.push).toBeGreaterThanOrEqual(150), expect(CELEBRATE_MS.push).toBeLessThanOrEqual(250);
  });
});

describe('stage 6 ethics guardrails (DECISIONS 9, bible 9)', () => {
  it('no insurance action in the engine; gifts never move coins; the daily grant has no streak', async () => {
    const { readFileSync } = await import('node:fs');
    const engine = ['index.ts', 'round.ts', 'cards.ts'].map((f) => readFileSync(`packages/game-engine/src/${f}`, 'utf8')).join('\n');
    expect(engine).not.toMatch(/insurance/i);
    const wallet = readFileSync('apps/server/src/wallet.ts', 'utf8');
    const kinds = /export type LedgerKind =([\s\S]*?);/.exec(wallet)![1];
    expect(kinds).not.toMatch(/gift|transfer|streak/i);
    const social = readFileSync('apps/server/src/social.ts', 'utf8');
    expect(social).not.toMatch(/streak/i);
    const gifts = readFileSync('apps/server/src/gifts.ts', 'utf8');
    expect(gifts).not.toMatch(/\bmove\(|wallet/i);
  });
});
