import { totals } from '@table21/game-engine';
import type { PublicCard, PublicHand, PublicRound, RoomSnapshot } from '@table21/protocol';
import { TablePresentation } from '../presentation.ts';
import { getPrefs, reducedMotion } from '../prefs.ts';
import { BASE, CATCH_UP_FACTOR, SPEED_FACTOR, catchUpMode, isTenOrAce } from './timing.ts';

/** A hand as the table shows it while the queue plays: the total waits until its cards have landed and turned. */
export type ShownHand = PublicHand & { totalHidden?: boolean };

interface QueuedEvent {
  at: number;
  run: () => void;
}

const slotOf = (id: string) => Number(id.split(':').pop() ?? 0);
const faceUp = (c: PublicCard): c is Extract<PublicCard, { rank: string }> => !('hidden' in c);

/**
 * The visual event queue between the server's snapshots and what the table shows.
 *
 * The server sends state (possibly several cards at once, possibly the whole dealer turn in one go). The timeline
 * turns the difference into ordered visual events and plays them in the dealer's rhythm:
 *   opening deal, seat by seat then the dealer, overlapping (stagger 200, flight 260, flip 220)
 *   -> dealer peek (ace or ten up, no blackjack) -> each hit -> hole card reveal (lift, pause, slow flip, land)
 *   -> each dealer draw after a fixed 300 ms beat -> final state (results, outcomes, whose turn).
 * What the table shows is derived from that progress, so a total never appears before its card has landed and
 * turned, the dealer's cards come one by one, and buttons appear only when the queue has caught up.
 *
 * Speed: Elegant / Quick / Turbo (prefs.dealSpeed) scale every duration. When the server says it is this player's
 * turn while the queue is still playing, the rest plays at Turbo; a queue longer than 3 s is compressed, longer than
 * 6 s (reconnect, background) is snapped. Skip finishes everything now. Reduced motion shows state immediately.
 */
export class TableTimeline {
  readonly presentation = new TablePresentation();
  private target: RoomSnapshot | null = null;
  private display: RoomSnapshot | null = null;
  private lastFinal: RoomSnapshot | null = null;
  private roundId: string | null = null;
  private visible = new Set<string>();
  private counted = new Set<string>();
  private scheduled = new Set<string>();
  private revealed = false;
  private revealScheduled = false;
  private peeked = false;
  private final = true;
  private queue: QueuedEvent[] = [];
  private cursor = 0;
  private base0 = 0;
  private real0 = performance.now();
  private rate = 1;
  private catchingUp = false;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private subs = new Set<() => void>();
  /** Snapshot the timeline was last given (identity), so React can call setTarget on every render cheaply. */
  lastInput: RoomSnapshot | null = null;

  constructor(private meId: string) {}

  subscribe = (f: () => void) => {
    this.subs.add(f);
    return () => this.subs.delete(f);
  };
  getDisplay = () => this.display;
  get pending() {
    return this.queue.length > 0;
  }

  private emit() {
    this.display = this.derive();
    this.subs.forEach((f) => f());
  }

  private baseRate() {
    return 1 / SPEED_FACTOR[getPrefs().dealSpeed ?? 'elegant'];
  }
  private now() {
    return this.base0 + (performance.now() - this.real0) * this.rate;
  }
  private setRate(rate: number) {
    this.base0 = this.now();
    this.real0 = performance.now();
    this.rate = rate;
    this.presentation.setRate(rate);
    this.pump();
  }

  /** New server state. `hydrate` (first render, reconnect, resume) shows it at once, without replaying anything. */
  setTarget(snap: RoomSnapshot, hydrate = false) {
    this.lastInput = snap;
    const prev = this.target;
    this.target = snap;
    if (hydrate || !prev || reducedMotion()) return this.snapTo(snap, hydrate || !prev);
    const r = snap.round;
    if (!r) {
      // Between rounds: whatever was still playing finishes now, then the table clears with a short sweep of the old
      // cards toward the discard corner (drawn on copies, so the cleared table is ready at once).
      if (this.queue.length) this.skip();
      if (this.roundId) this.presentation.sweepOut();
      return this.snapTo(snap, false);
    }
    let opening = false;
    if (r.roundId !== this.roundId) {
      // A new round: if the previous one was still animating, it finishes first.
      if (this.queue.length) this.flushNow();
      if (this.roundId) this.presentation.sweepOut();
      this.roundId = r.roundId;
      this.visible.clear();
      this.counted.clear();
      this.scheduled.clear();
      this.revealed = false;
      this.revealScheduled = false;
      this.peeked = false;
      opening = true;
    }
    this.schedule(r, opening);
    this.final = false;
    this.scheduleFinal();
    // The server says it is this player's turn: catch up so the real turn timer is not eaten by animation.
    // Only when a real turn timer runs (online); local games have no timer and keep the dealer's rhythm.
    const turnSeat = r.turn ? r.seats[r.turn.seat]?.playerId : null;
    const lagMs = (this.cursor - this.now()) / this.rate;
    const mode = catchUpMode(lagMs, turnSeat === this.meId && !!snap.deadline);
    if (mode === 'snap') return this.skip();
    if (mode === 'turbo') this.catchUp();
    this.emit();
  }

  private catchUp() {
    if (this.catchingUp) return;
    this.catchingUp = true;
    this.setRate(Math.max(this.rate, 1 / CATCH_UP_FACTOR));
  }

  private schedule(r: PublicRound, opening: boolean) {
    type Item = { card: PublicCard; dealerIndex: number | null };
    const items: Item[] = [];
    for (const s of r.seats) for (const h of s.hands) for (const c of h.cards) items.push({ card: c, dealerIndex: null });
    r.dealer.cards.forEach((c, i) => items.push({ card: c, dealerIndex: i }));
    const fresh = items.filter((it) => !this.scheduled.has(it.card.id)).sort((a, b) => slotOf(a.card.id) - slotOf(b.card.id));
    const hole = r.dealer.cards[1];
    let t = Math.max(this.now(), this.cursor);
    if (opening) {
      t += BASE.drawLead;
      // The opening deal overlaps: the next card leaves the shoe while the previous one is still in the air.
      let end = t;
      fresh.forEach((it, i) => {
        const start = t + i * BASE.stagger;
        const isHole = it.dealerIndex === 1;
        this.cardEvents(it.card.id, start, !isHole);
        end = Math.max(end, start + BASE.flight + (isHole ? 0 : BASE.flip + BASE.settle));
      });
      this.cursor = end;
      // Ace or ten up and no blackjack: the dealer looks under the hole card before anyone plays.
      if (hole && !r.dealer.revealed && isTenOrAce(faceUp(r.dealer.cards[0]) ? r.dealer.cards[0].rank : undefined) && !this.peeked) {
        this.peeked = true;
        const at = this.cursor;
        this.add(at, () => this.presentation.queue('peek', hole.id));
        this.cursor += BASE.peek;
      }
      if (r.dealer.revealed && hole) this.scheduleReveal(hole.id);
      return;
    }
    this.cursor = t;
    for (const it of fresh) {
      if (it.dealerIndex !== null && it.dealerIndex >= 2) {
        if (r.dealer.revealed && hole && !this.revealScheduled) this.scheduleReveal(hole.id);
        this.cursor += BASE.dealerPause; // the beat before each dealer draw, the same every time
      }
      const isHole = it.dealerIndex === 1;
      this.cardEvents(it.card.id, this.cursor, !isHole);
      this.cursor += BASE.flight + (isHole ? 0 : BASE.flip + BASE.settle);
    }
    if (r.dealer.revealed && hole && !this.revealScheduled) this.scheduleReveal(hole.id);
  }

  private cardEvents(id: string, start: number, up: boolean) {
    this.scheduled.add(id);
    this.add(start, () => this.visible.add(id));
    if (up) this.add(start + BASE.flight + BASE.flip + BASE.settle, () => this.counted.add(id));
  }

  private scheduleReveal(holeId: string) {
    this.revealScheduled = true;
    const at = Math.max(this.cursor, this.now());
    const dur = BASE.revealLift + BASE.revealPause + BASE.revealFlip + BASE.revealLand;
    this.add(at, () => {
      this.revealed = true;
      this.presentation.queue('reveal', holeId);
    });
    this.add(at + dur + BASE.settle, () => this.counted.add(holeId));
    this.cursor = at + dur + BASE.settle;
  }

  private scheduleFinal() {
    this.queue = this.queue.filter((e) => e.run !== this.finalize);
    this.add(Math.max(this.cursor, this.now()), this.finalize);
  }
  private finalize = () => {
    this.final = true;
    this.lastFinal = this.target;
  };

  private add(at: number, run: () => void) {
    this.queue.push({ at, run });
    this.queue.sort((a, b) => a.at - b.at);
    this.pump();
  }

  private pump() {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    const next = this.queue[0];
    if (!next) {
      if (this.catchingUp || this.rate !== this.baseRate()) {
        this.catchingUp = false;
        this.base0 = this.now();
        this.real0 = performance.now();
        this.rate = this.baseRate();
        this.presentation.setRate(this.rate);
      }
      return;
    }
    const delay = Math.max(0, (next.at - this.now()) / this.rate);
    this.timer = setTimeout(this.tick, delay);
  }

  private tick = () => {
    this.timer = null;
    const n = this.now() + 1;
    let ran = false;
    while (this.queue[0] && this.queue[0].at <= n) {
      this.queue.shift()!.run();
      ran = true;
    }
    if (ran) this.emit();
    this.pump();
  };

  /** Run everything that is queued, in order, right now. */
  private flushNow() {
    const q = this.queue;
    this.queue = [];
    for (const e of q) e.run();
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    this.cursor = this.now();
  }

  /** The skip button: the rest of this sequence lands at once (no replay), then the table is up to date. */
  skip() {
    // Cards that mount because of the flush appear in place: nothing new leaves the shoe after a skip.
    this.presentation.settleNext();
    this.flushNow();
    this.presentation.finishAll(false);
    this.catchingUp = false;
    this.rate = this.baseRate();
    this.presentation.setRate(this.rate);
    this.emit();
  }

  /** Reconnect, resume, first render: show the state as it is. */
  resync() {
    if (this.target) this.snapTo(this.target, true);
  }

  private snapTo(snap: RoomSnapshot, hydrate: boolean) {
    this.queue = [];
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    if (hydrate) this.presentation.resync();
    const r = snap.round;
    this.roundId = r?.roundId ?? null;
    this.visible.clear();
    this.counted.clear();
    this.scheduled.clear();
    if (r) {
      const all = [...r.seats.flatMap((s) => s.hands.flatMap((h) => h.cards)), ...r.dealer.cards];
      for (const c of all) {
        this.visible.add(c.id);
        this.counted.add(c.id);
        this.scheduled.add(c.id);
      }
      this.revealed = r.dealer.revealed;
      this.revealScheduled = r.dealer.revealed;
      this.peeked = true;
    }
    this.final = true;
    this.lastFinal = snap;
    this.cursor = this.now();
    this.emit();
  }

  /** Change of the player's speed preference while a sequence plays. */
  speedChanged() {
    if (!this.catchingUp) this.setRate(this.baseRate());
  }

  dispose() {
    if (this.timer) clearTimeout(this.timer);
    this.queue = [];
    this.presentation.dispose();
  }

  /** What the table shows right now. */
  private derive(): RoomSnapshot | null {
    const t = this.target;
    if (!t) return null;
    if (this.final || !t.round) return t;
    const r = t.round;
    const shownCards = (cards: PublicCard[]) => cards.filter((c) => this.visible.has(c.id));
    const countedTotal = (cards: PublicCard[]) => {
      const up = cards.filter((c) => this.counted.has(c.id) && faceUp(c)) as Extract<PublicCard, { rank: string }>[];
      return up.length ? totals(up) : null;
    };
    const seats = r.seats.map((s) => ({
      ...s,
      hands: s.hands.map((h): ShownHand => {
        const tt = countedTotal(h.cards);
        return {
          ...h,
          cards: shownCards(h.cards),
          total: tt?.total ?? 0,
          soft: tt?.soft ?? false,
          totalHidden: !tt,
          // Outcomes and bust or natural badges wait for the last card of the sequence.
          status: h.status === 'bust' || h.status === 'blackjack' ? 'active' : h.status,
          outcome: null,
          returnedUnits: null,
        };
      }),
    }));
    const hole = r.dealer.cards[1];
    const dealerCards = shownCards(r.dealer.cards).map((c) => (hole && c.id === hole.id && !this.revealed ? { id: c.id, hidden: true as const } : c));
    const dt = countedTotal(dealerCards);
    const settledNow = r.phase === 'settled' || r.phase === 'voided';
    const results = t.phase === 'results';
    return {
      ...t,
      phase: results ? 'dealer_turn' : t.phase,
      you: {
        ...t.you,
        legalActions: [],
        canDealerStep: false,
        availableUnits: results && this.lastFinal ? this.lastFinal.you.availableUnits : t.you.availableUnits,
      },
      round: {
        ...r,
        phase: settledNow ? 'dealer_turn' : r.phase,
        seats,
        turn: null,
        dealer: { cards: dealerCards, total: dt?.total ?? null, soft: dt?.soft ?? false, revealed: this.revealed },
      },
    };
  }
}
