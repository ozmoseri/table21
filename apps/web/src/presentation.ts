import { createContext, useContext } from 'react';
import { reducedMotion } from './prefs.ts';
import { play, stopAll, type Sfx } from './sound.ts';

/**
 * TablePresentationController: one per table session (online room or local game instance).
 *
 * Modes
 * - hydrate: first render, reconnect, resume from background. Cards appear in place, no replay.
 * - live: new cards since the previous commit animate from the shoe, staggered by draw slot.
 *
 * The server never waits for animation. Every animation and delayed sound has a handle so a resync,
 * unmount, background/resume or a switch to reduced motion can finish or cancel it immediately.
 */
export class TablePresentation {
  private seen = new Set<string>();
  private mode: 'hydrate' | 'live' = 'hydrate';
  private batch: { el: HTMLElement; slot: number }[] = [];
  private anims = new Set<Animation>();
  private timers = new Set<ReturnType<typeof setTimeout>>();
  private sequenceEndsAt = 0;
  /** True when the latest commit only hydrated state (first render, reconnect, resume). Used to skip old celebrations. */
  hydratedLast = true;
  private onVisibility = () => {
    if (document.visibilityState === 'visible') this.resync();
  };

  constructor() {
    document.addEventListener('visibilitychange', this.onVisibility);
  }

  /** Next commit renders the current state without replaying old animations. */
  resync() {
    this.finishAll();
    this.mode = 'hydrate';
  }

  /** Called from a card's layout effect when it mounts. */
  register(el: HTMLElement, cardId: string) {
    if (this.seen.has(cardId)) return;
    this.seen.add(cardId);
    if (this.mode === 'live') this.batch.push({ el, slot: Number(cardId.split(':').pop() ?? 0) });
  }

  /** Called from the table's layout effect, after all cards of this commit registered. */
  commit(shoe: DOMRect | null) {
    const items = this.batch.sort((a, b) => a.slot - b.slot);
    this.batch = [];
    const wasHydrate = this.mode === 'hydrate';
    this.hydratedLast = wasHydrate;
    this.mode = 'live';
    if (wasHydrate || !items.length || reducedMotion()) return;
    // Card travel 280 ms (target 240 to 320), next card 90 to 120 ms later, so a full six-player deal (14 cards) takes
    // about 1.5 s and a solo deal (4 cards) about 0.6 s.
    const stagger = Math.max(90, Math.min(120, 1700 / items.length));
    const duration = 280;
    const start = Math.max(0, this.sequenceEndsAt - performance.now());
    items.forEach((it, i) => {
      const r = it.el.getBoundingClientRect();
      const dx = shoe ? shoe.left + shoe.width / 2 - (r.left + r.width / 2) : 0;
      const dy = shoe ? shoe.top + shoe.height / 2 - (r.top + r.height / 2) : -120;
      const delay = Math.min(start, 600) + i * stagger;
      const a = it.el.animate(
        [
          { transform: `translate(${dx}px, ${dy}px) rotate(-14deg) scale(.82)`, opacity: 0.4 },
          // a small settle at the end: the card lands, it does not stop dead
          { transform: 'translate(0, -3px) rotate(0.6deg) scale(1.03)', opacity: 1, offset: 0.82 },
          { transform: 'translate(0,0) rotate(0) scale(1)', opacity: 1 },
        ],
        { duration, delay, easing: 'cubic-bezier(.2,.75,.25,1)', fill: 'backwards' },
      );
      this.track(a);
      this.later(() => play('deal'), delay);
    });
    this.sequenceEndsAt = performance.now() + Math.min(start, 600) + (items.length - 1) * stagger + duration;
  }

  /** Runs after the visual sequence in progress (for example the result sound after the last card lands). */
  afterSequence(fn: () => void, extra = 0) {
    this.later(fn, Math.max(0, this.sequenceEndsAt - performance.now()) + extra);
  }

  sound(s: Sfx, afterSequence = true) {
    if (afterSequence) this.afterSequence(() => play(s), 60);
    else play(s);
  }

  track(a: Animation) {
    this.anims.add(a);
    a.finished.then(() => this.anims.delete(a)).catch(() => this.anims.delete(a));
  }

  later(fn: () => void, ms: number) {
    const t = setTimeout(() => {
      this.timers.delete(t);
      fn();
    }, ms);
    this.timers.add(t);
  }

  /** Jump every running animation to its end state and drop pending delayed effects. */
  finishAll() {
    for (const a of this.anims) {
      try {
        a.finish();
      } catch {
        a.cancel();
      }
    }
    this.anims.clear();
    for (const t of this.timers) clearTimeout(t);
    this.timers.clear();
    // Sounds already handed to WebAudio for the old sequence are silenced too.
    stopAll();
    this.sequenceEndsAt = 0;
    this.batch = [];
  }

  dispose() {
    this.finishAll();
    document.removeEventListener('visibilitychange', this.onVisibility);
  }
}

export const PresentationContext = createContext<TablePresentation | null>(null);
export const usePresentation = () => useContext(PresentationContext);
