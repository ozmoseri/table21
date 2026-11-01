/**
 * Keyframes for the card engine (WAAPI on DOM cards: crisp, accessible, cheap for < 20 moving objects).
 * Every card leaves the shoe, travels on an arc, lands with a small settle and only then turns face up.
 */
const EASE_DEAL = 'cubic-bezier(.22,.8,.28,1)';
const EASE_FLIP = 'cubic-bezier(.45,0,.2,1)';
export const EASING = { deal: EASE_DEAL, flip: EASE_FLIP };

/**
 * Arc from the shoe to the card's place. (dx, dy) is the shoe relative to the place. The path is a quadratic Bezier
 * whose control point sits above the straight line by 18% of the distance, sampled in 12 steps; the card turns from
 * the shoe angle (-20 deg) to rest and grows from 0.85 to 1, then lands with a 3 px settle.
 */
export function arcKeyframes(dx: number, dy: number): Keyframe[] {
  const dist = Math.hypot(dx, dy);
  const cx = dx / 2;
  const cy = dy / 2 - dist * 0.18;
  const steps = 12;
  const frames: Keyframe[] = [];
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    const u = 1 - t;
    const x = u * u * dx + 2 * u * t * cx;
    const y = u * u * dy + 2 * u * t * cy;
    frames.push({
      transform: `translate(${x.toFixed(1)}px, ${y.toFixed(1)}px) rotate(${(-20 * u).toFixed(2)}deg) scale(${(0.85 + 0.15 * t).toFixed(3)})`,
      offset: t * 0.84,
    });
  }
  frames.push({ transform: 'translate(0px, -3px) rotate(0.4deg) scale(1.025)', offset: 0.92 });
  frames.push({ transform: 'translate(0px, 0px) rotate(0deg) scale(1)', offset: 1 });
  return frames;
}

/** Face-down while flying, then a turn with a small lift at its middle. Durations in the same clock as the flight. */
export function flipAfterLanding(flight: number, flip: number): { frames: Keyframe[]; duration: number } {
  const total = flight + flip;
  const land = flight / total;
  return {
    duration: total,
    frames: [
      { transform: 'rotateY(180deg)', offset: 0 },
      { transform: 'rotateY(180deg)', offset: land, easing: EASE_FLIP },
      { transform: 'rotateY(90deg) scale(1.06)', offset: land + (1 - land) / 2, easing: EASE_FLIP },
      { transform: 'rotateY(0deg) scale(1)', offset: 1 },
    ],
  };
}

/** Hole card: the card lifts, holds (the beat of tension), turns slowly, lands. Returns outer and inner keyframes. */
export function revealKeyframes(lift: number, pause: number, flip: number, land: number) {
  const total = lift + pause + flip + land;
  const a = lift / total;
  const b = (lift + pause) / total;
  const c = (lift + pause + flip) / total;
  return {
    duration: total,
    outer: [
      { transform: 'translateY(0) scale(1)', offset: 0, easing: EASE_DEAL },
      { transform: 'translateY(-10px) scale(1.08)', offset: a },
      { transform: 'translateY(-10px) scale(1.08)', offset: c, easing: EASE_DEAL },
      { transform: 'translateY(0) scale(1)', offset: 1 },
    ] as Keyframe[],
    inner: [
      { transform: 'rotateY(180deg)', offset: 0 },
      { transform: 'rotateY(180deg)', offset: b, easing: EASE_FLIP },
      { transform: 'rotateY(0deg)', offset: c },
      { transform: 'rotateY(0deg)', offset: 1 },
    ] as Keyframe[],
  };
}

/** Dealer peek: the hole card's near edge lifts, holds, settles. */
export const peekKeyframes: Keyframe[] = [
  { transform: 'perspective(420px) rotateX(0deg)', offset: 0 },
  { transform: 'perspective(420px) rotateX(18deg) translateY(-2px)', offset: 0.3 },
  { transform: 'perspective(420px) rotateX(18deg) translateY(-2px)', offset: 0.75 },
  { transform: 'perspective(420px) rotateX(0deg)', offset: 1 },
];
