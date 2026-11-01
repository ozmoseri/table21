import { createContext, useContext } from 'react';
import { reducedMotion } from './prefs.ts';
import { play, type Sfx } from './sound.ts';

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
    this.mode = 'live';
    if (wasHydrate || !items.length || reducedMotion()) return;
    // A full six-player deal is 14 cards: overlap them so the whole deal stays under about 2 seconds.
    const stagger = Math.max(85, Math.min(150, 1700 / items.length));
    const duration = 230;
    const start = Math.max(0, this.sequenceEndsAt - performance.now());
    items.forEach((it, i) => {
      const r = it.el.getBoundingClientRect();
      const dx = shoe ? shoe.left + shoe.width / 2 - (r.left + r.width / 2) : 0;
      const dy = shoe ? shoe.top + shoe.height / 2 - (r.top + r.height / 2) : -120;
      const delay = Math.min(start, 600) + i * stagger;
      const a = it.el.animate(
        [
          { transform: `translate(${dx}px, ${dy}px) rotate(-14deg) scale(.82)`, opacity: 0.4 },
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
