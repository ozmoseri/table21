import { describe, expect, it } from 'vitest';
import { BASE, SPEED_FACTOR, catchUpMode } from '../../apps/web/src/anim/timing.ts';
import { arcKeyframes, flipAfterLanding, revealKeyframes } from '../../apps/web/src/anim/flight.ts';

// The card engine's numbers come from DECISIONS.md (design round). These tests pin them so a later change is deliberate.
describe('motion spec (DECISIONS 1-3)', () => {
  it('pacing: stagger 200, flight 260, full opening deal for one player well under 3.2 s', () => {
    expect(BASE.stagger).toBe(200);
    expect(BASE.flight).toBe(260);
    // 4 cards: the last leaves at 3 * stagger, flies, turns and settles.
    const oneSeat = 3 * BASE.stagger + BASE.flight + BASE.flip + BASE.settle;
    expect(oneSeat).toBeLessThan(1500);
    // 6 seats + dealer = 14 cards: about 3.2 s at Elegant.
    const sixSeats = 13 * BASE.stagger + BASE.flight + BASE.flip + BASE.settle;
    expect(sixSeats).toBeGreaterThan(2900);
    expect(sixSeats).toBeLessThan(3500);
  });

  it('hole card tension: lift 120, pause 250, flip 320, land 80 (770 ms); dealer beat 300; natural 900', () => {
    expect(BASE.revealLift + BASE.revealPause + BASE.revealFlip + BASE.revealLand).toBe(770);
    expect(BASE.dealerPause).toBe(300);
    expect(BASE.natural).toBe(900);
    const k = revealKeyframes(BASE.revealLift, BASE.revealPause, BASE.revealFlip, BASE.revealLand);
    expect(k.duration).toBe(770);
    // The face stays down through lift and pause, and is up when the flip ends.
    const innerDownUntil = k.inner[1].offset as number;
    expect(innerDownUntil * 770).toBeCloseTo(370, 5);
    expect((k.inner[2].offset as number) * 770).toBeCloseTo(690, 5);
  });

  it('speeds: Elegant 1, Quick about 0.62 (stagger near 120, flight near 170), Turbo faster still', () => {
    expect(SPEED_FACTOR.elegant).toBe(1);
    expect(Math.round(BASE.stagger * SPEED_FACTOR.quick)).toBeGreaterThanOrEqual(115);
    expect(Math.round(BASE.stagger * SPEED_FACTOR.quick)).toBeLessThanOrEqual(130);
    expect(Math.round(BASE.flight * SPEED_FACTOR.quick)).toBeGreaterThanOrEqual(155);
    expect(Math.round(BASE.flight * SPEED_FACTOR.quick)).toBeLessThanOrEqual(175);
    expect(SPEED_FACTOR.turbo).toBeLessThan(SPEED_FACTOR.quick);
  });

  it('catch-up: only for my real turn timer after 1.5 s of queue; anything past 3 s is compressed, past 6 s snaps', () => {
    expect(catchUpMode(800, true)).toBe('none');
    expect(catchUpMode(1600, true)).toBe('turbo');
    expect(catchUpMode(1600, false)).toBe('none'); // someone else's turn, or a local game without a timer
    expect(catchUpMode(3200, false)).toBe('turbo');
    expect(catchUpMode(6500, false)).toBe('snap');
    expect(catchUpMode(6500, true)).toBe('snap');
  });

  it('arc flight starts at the shoe, rises above the straight line and lands at rest', () => {
    const f = arcKeyframes(200, -300);
    expect(f[0].transform).toContain('translate(200.0px, -300.0px)');
    expect(f.at(-1)!.transform).toBe('translate(0px, 0px) rotate(0deg) scale(1)');
    // Midpoint is above (more negative y than) the straight-line midpoint.
    const mid = f[6].transform as string;
    const y = Number(/translate\([^,]+, ([-\d.]+)px\)/.exec(mid)![1]);
    expect(y).toBeLessThan(-150);
    const flip = flipAfterLanding(BASE.flight, BASE.flip);
    expect(flip.duration).toBe(BASE.flight + BASE.flip);
    expect(flip.frames[1].offset).toBeCloseTo(BASE.flight / (BASE.flight + BASE.flip), 5);
  });
});
