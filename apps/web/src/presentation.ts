import { createContext, useContext } from 'react';
import { reducedMotion } from './prefs.ts';
import { play, stopAll, type Sfx } from './sound.ts';
import { haptic } from './haptics.ts';
import { BASE } from './anim/timing.ts';
import { EASING, arcKeyframes, flipAfterLanding, peekKeyframes, revealKeyframes } from './anim/flight.ts';

/**
 * TablePresentation: one per table session (online room or local game instance). It animates what the timeline
 * (anim/timeline.ts) puts on the table: a card that mounts in live mode flies from the shoe on an arc, lands and
 * turns face up; the hole card lifts, waits and turns; the dealer peeks.
 *
 * Modes
 * - hydrate: first render, reconnect, resume from background. Cards appear in place, no replay.
 * - live: cards that mount fly in. When they mount is decided by the timeline, not here.
 *
 * Every animation runs at the timeline's playback rate (Elegant 1, Quick, Turbo, catch-up), so changing speed or
 * skipping affects cards already in the air too. The server never waits for any of this.
 */
export class TablePresentation {
  private seen = new Set<string>();
  private mode: 'hydrate' | 'live' | 'settle' = 'hydrate';
  private batch: { el: HTMLElement; faceUp: boolean }[] = [];
  private anims = new Set<Animation>();
  private timers = new Set<ReturnType<typeof setTimeout>>();
  private pendingFx: { kind: 'reveal' | 'peek'; id: string }[] = [];
  private root: HTMLElement | null = null;
  /** Playback rate shared by all running animations (1 = Elegant). */
  rate = 1;
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

  /** Skip: the cards the next commit mounts appear in place, but it still counts as live (a result may celebrate). */
  settleNext() {
    this.finishAll(false);
    if (this.mode === 'live') this.mode = 'settle';
  }

  setRoot(el: HTMLElement | null) {
    this.root = el;
  }

  /** Called from a card's layout effect when it mounts. */
  register(el: HTMLElement, cardId: string, faceUp = true) {
    if (this.seen.has(cardId)) return;
    this.seen.add(cardId);
    if (this.mode === 'live') this.batch.push({ el, faceUp });
    // settle: seen, shown in place
  }

  /** Hole card reveal or dealer peek, run on the next commit (after the DOM shows the new face). */
  queue(kind: 'reveal' | 'peek', cardId: string) {
    this.pendingFx.push({ kind, id: cardId });
  }

  /** Called from the table's layout effect, after all cards of this commit registered. */
  commit(shoe: DOMRect | null) {
    const items = this.batch;
    this.batch = [];
    const fx = this.pendingFx;
    this.pendingFx = [];
    const wasHydrate = this.mode === 'hydrate';
    const settle = this.mode === 'settle';
    this.hydratedLast = wasHydrate;
    this.mode = 'live';
    if (wasHydrate || settle || reducedMotion()) return;
    for (const it of items) this.fly(it.el, it.faceUp, shoe);
    for (const f of fx) {
      const el = this.root?.querySelector<HTMLElement>(`[data-card-id="${CSS.escape(f.id)}"]`);
      if (el) (f.kind === 'reveal' ? this.reveal(el) : this.peek(el));
    }
  }

  private fly(el: HTMLElement, faceUp: boolean, shoe: DOMRect | null) {
    const r = el.getBoundingClientRect();
    const dx = shoe ? shoe.left + shoe.width / 2 - (r.left + r.width / 2) : 0;
    const dy = shoe ? shoe.top + shoe.height / 2 - (r.top + r.height / 2) : -160;
    const a = el.animate(arcKeyframes(dx, dy), { duration: BASE.flight, easing: EASING.deal, fill: 'backwards' });
    this.track(a);
    const inner = el.querySelector<HTMLElement>('.card-inner');
    if (inner && faceUp) {
      const f = flipAfterLanding(BASE.flight, BASE.flip);
      this.track(inner.animate(f.frames, { duration: f.duration, fill: 'backwards' }));
    }
    // One card sound, on the landing (84% of the flight), at the current playback rate; my own cards also tick.
    const land = (BASE.flight * 0.84) / this.rate;
    play('deal', land / 1000);
    if (el.closest('.me-zone')) this.later(() => haptic('land'), land);
  }

  private reveal(el: HTMLElement) {
    const k = revealKeyframes(BASE.revealLift, BASE.revealPause, BASE.revealFlip, BASE.revealLand);
    el.classList.add('is-revealing');
    const a = el.animate(k.outer, { duration: k.duration });
    this.track(a);
    a.finished.then(() => el.classList.remove('is-revealing')).catch(() => el.classList.remove('is-revealing'));
    const inner = el.querySelector<HTMLElement>('.card-inner');
    if (inner) this.track(inner.animate(k.inner, { duration: k.duration, fill: 'backwards' }));
    this.later(() => play('flip'), (BASE.revealLift + BASE.revealPause) / this.rate);
  }

  /**
   * End of a hand: the cards on the table are collected toward the discard corner (top start of the table) in
   * 300 ms, 20 ms apart. Copies are animated in an overlay, so the next state renders immediately underneath and
   * nothing waits for the sweep. Skipped with reduced motion, after a hydrate, or when nothing is on the table.
   */
  sweepOut() {
    if (!this.root || reducedMotion() || this.mode !== 'live') return;
    const cards = [...this.root.querySelectorAll<HTMLElement>('.card')].filter((c) => !c.closest('.shoe'));
    if (!cards.length) return;
    const box = this.root.getBoundingClientRect();
    const rtl = getComputedStyle(this.root).direction === 'rtl';
    const tx = rtl ? box.right - 40 : box.left + 40;
    const ty = box.top + 40;
    const layer = document.createElement('div');
    layer.className = 'sweep-layer';
    layer.setAttribute('aria-hidden', 'true');
    document.body.append(layer);
    let left = cards.length;
    const done = () => {
      if (--left <= 0) layer.remove();
    };
    cards.forEach((c, i) => {
      const r = c.getBoundingClientRect();
      if (!r.width) return done();
      const clone = c.cloneNode(true) as HTMLElement;
      clone.removeAttribute('data-card-id');
      Object.assign(clone.style, { position: 'fixed', left: `${r.left}px`, top: `${r.top}px`, width: `${r.width}px`, height: `${r.height}px`, margin: '0' });
      clone.style.setProperty('--w', `${r.width}px`);
      layer.append(clone);
      const dx = tx - (r.left + r.width / 2);
      const dy = ty - (r.top + r.height / 2);
      const a = clone.animate(
        [
          { transform: 'translate(0, 0) rotate(0deg) scale(1)', opacity: 1 },
          { transform: `translate(${dx}px, ${dy}px) rotate(${rtl ? 8 : -8}deg) scale(0.7)`, opacity: 0 },
        ],
        { duration: BASE.sweep, delay: Math.min(i, 8) * 20, easing: 'cubic-bezier(.4, 0, .7, .2)', fill: 'both' },
      );
      a.finished.then(done, done);
    });
    this.later(() => layer.remove(), BASE.sweep + 400);
  }

  /**
   * A win is paid: a few chips travel from the dealer to my stake on a short arc (400 ms, 40 ms apart), so the
   * player sees where the coins came from. Visual only; the balance always comes from the snapshot.
   */
  payout(count = 3) {
    if (!this.root || reducedMotion()) return;
    const from = this.root.querySelector<HTMLElement>('.dealer-zone .seat-avatar, .dealer-zone');
    const to = this.root.querySelector<HTMLElement>('.me-zone .hand-meta .chips, .me-zone .my-hands, .me-zone');
    if (!from || !to) return;
    const a = from.getBoundingClientRect();
    const b = to.getBoundingClientRect();
    for (let i = 0; i < count; i++) {
      const el = document.createElement('i');
      el.className = 'chip fly-chip t3 payout-chip';
      el.setAttribute('aria-hidden', 'true');
      el.style.left = `${a.left + a.width / 2 - 14}px`;
      el.style.top = `${a.top + a.height / 2 - 14}px`;
      document.body.appendChild(el);
      const dx = b.left + 22 - (a.left + a.width / 2);
      const dy = b.top + b.height / 2 - (a.top + a.height / 2);
      const anim = el.animate(
        [
          { transform: 'translate(0, 0) scale(0.9)', opacity: 0 },
          { transform: `translate(${dx * 0.5}px, ${dy * 0.5 - 36}px) scale(1.05)`, opacity: 1, offset: 0.45 },
          { transform: `translate(${dx}px, ${dy}px) scale(0.85)`, opacity: 1, offset: 0.9 },
          { transform: `translate(${dx}px, ${dy}px) scale(0.8)`, opacity: 0 },
        ],
        { duration: BASE.payout, delay: i * 40, easing: 'cubic-bezier(.22,.8,.28,1)', fill: 'backwards' },
      );
      this.track(anim);
      const done = () => el.remove();
      anim.finished.then(done, done);
      this.later(done, BASE.payout + i * 40 + 300);
    }
  }

  private peek(el: HTMLElement) {
    this.track(el.animate(peekKeyframes, { duration: BASE.peek, easing: EASING.flip }));
  }

  /** Change the speed of everything in flight (Quick, Turbo, catch-up when it is the player's turn). */
  setRate(rate: number) {
    this.rate = rate;
    for (const a of this.anims) {
      try {
        a.updatePlaybackRate(rate);
      } catch {
        a.playbackRate = rate;
      }
    }
  }

  /** Kept for callers that used to wait for the deal: the timeline now runs them at the right moment. */
  afterSequence(fn: () => void, extra = 0) {
    this.later(fn, extra);
  }

  sound(s: Sfx, afterSequence = true) {
    if (afterSequence) this.afterSequence(() => play(s), 60);
    else play(s);
  }

  track(a: Animation) {
    if (this.rate !== 1) a.playbackRate = this.rate;
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

  /** Number of card animations still running (tests and the skip button read this). */
  get running() {
    return this.anims.size;
  }

  /** Jump every running animation to its end state and drop pending delayed effects. */
  finishAll(silence = true) {
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
    if (silence) stopAll();
    this.batch = [];
    this.pendingFx = [];
  }

  dispose() {
    this.finishAll();
    document.removeEventListener('visibilitychange', this.onVisibility);
  }
}

export const PresentationContext = createContext<TablePresentation | null>(null);
export const usePresentation = () => useContext(PresentationContext);
