import {
  STANDARD_RULES,
  applyAction,
  coinsToUnits,
  cryptoRng,
  dealerStep,
  legalActions,
  newShuffledShoe,
  requiredStake,
  seatReturn,
  seatStake,
  startRound,
  type Card,
  type PlayerAction,
  type RoundState,
} from '@table21/game-engine';
import { toPublicRound, type AvatarId, type RoomPhase, type RoomSnapshot } from '@table21/protocol';
import { saveLocal } from './prefs.ts';

export interface LocalPlayer {
  id: string;
  name: string;
  avatar: AvatarId;
  units: number;
  betUnits: number;
}

/**
 * Offline game controller for solo practice and pass-and-play. Runs the same engine in the browser with
 * local practice/session coins. Nothing here is ever sent to the server or counted in rankings.
 */
export class LocalGame {
  private rng = cryptoRng();
  /** Unique per local session so card ids never collide with an earlier game in the same tab. */
  private session = Math.random().toString(36).slice(2, 8) + Date.now().toString(36);
  private shoe: Card[];
  private subs = new Set<() => void>();
  private timer: ReturnType<typeof setTimeout> | null = null;
  engine: RoundState | null = null;
  phase: RoomPhase = 'betting';
  version = 0;
  round = 0;
  /** Pass-and-play: the player who must confirm they hold the phone before acting. */
  handoff: string | null = null;
  private confirmed: string | null = null;
  view: RoomSnapshot;
  readonly sessionId: string;

  constructor(public mode: 'solo' | 'pass', public players: LocalPlayer[], public stakes = [10, 25, 50, 100, 250]) {
    this.shoe = newShuffledShoe(STANDARD_RULES.decks, this.rng);
    this.sessionId = `local-${this.session}`;
    this.view = this.build();
  }

  subscribe = (f: () => void) => {
    this.subs.add(f);
    return () => this.subs.delete(f);
  };
  getView = () => this.view;

  private changed() {
    this.version++;
    if (this.mode === 'solo') saveLocal({ practiceUnits: this.players[0].units });
    this.view = this.build();
    this.subs.forEach((f) => f());
  }

  destroy() {
    if (this.timer) clearTimeout(this.timer);
    this.subs.clear();
  }

  setBet(playerId: string, coins: number) {
    if (this.phase !== 'betting') return;
    const p = this.players.find((x) => x.id === playerId);
    if (!p) return;
    const units = coinsToUnits(coins);
    if (units > p.units + p.betUnits) return;
    p.units += p.betUnits - units;
    p.betUnits = units;
    this.changed();
  }

  clearBet(playerId: string) {
    const p = this.players.find((x) => x.id === playerId);
    if (!p || this.phase !== 'betting') return;
    p.units += p.betUnits;
    p.betUnits = 0;
    this.changed();
  }

  refill(playerId: string) {
    const p = this.players.find((x) => x.id === playerId);
    if (p && p.units < 20 && this.phase === 'betting') {
      p.units += 2000;
      this.changed();
    }
  }

  deal() {
    const seated = this.players.filter((p) => p.betUnits > 0);
    if (!seated.length || this.phase !== 'betting') return;
    if (this.shoe.length < STANDARD_RULES.cutRemaining) this.shoe = newShuffledShoe(STANDARD_RULES.decks, this.rng);
    this.round++;
    this.engine = startRound({
      roundId: `local-${this.session}-${this.round}`,
      rules: STANDARD_RULES,
      shoe: this.shoe,
      seats: seated.map((p) => ({ seatId: p.id, playerId: p.id, stake: p.betUnits })),
    });
    for (const p of seated) p.betUnits = 0;
    this.confirmed = null;
    this.afterEngine();
  }

  private turnPlayer(): LocalPlayer | null {
    const e = this.engine;
    if (!e || e.phase !== 'player_turns' || !e.turn) return null;
    return this.players.find((p) => p.id === e.seats[e.turn!.seat].playerId) ?? null;
  }

  private afterEngine() {
    const e = this.engine!;
    if (e.phase === 'player_turns') {
      this.phase = 'player_turns';
      const tp = this.turnPlayer()!;
      const many = this.players.length > 1 && this.mode === 'pass';
      this.handoff = many && this.confirmed !== tp.id ? tp.id : null;
    } else if (e.phase === 'dealer_turn') {
      this.phase = 'dealer_turn';
      this.handoff = null;
      this.timer = setTimeout(() => this.dealerTick(), 650);
    } else {
      this.settle();
    }
    this.changed();
  }

  confirmHandoff() {
    if (!this.handoff) return;
    this.confirmed = this.handoff;
    this.handoff = null;
    this.changed();
  }

  act(action: PlayerAction) {
    const tp = this.turnPlayer();
    if (!tp || this.handoff || !this.engine) return;
    if (!legalActions(this.engine, tp.units).includes(action)) return;
    const extra = requiredStake(this.engine, action);
    const available = tp.units;
    tp.units -= extra;
    this.engine = applyAction(this.engine, action, available);
    this.afterEngine();
  }

  private dealerTick() {
    this.timer = null;
    if (!this.engine || this.engine.phase !== 'dealer_turn') return;
    this.engine = dealerStep(this.engine);
    this.afterEngine();
  }

  private settle() {
    const e = this.engine!;
    for (const seat of e.seats) {
      const p = this.players.find((x) => x.id === seat.playerId)!;
      p.units += e.phase === 'voided' ? seatStake(seat) : seatReturn(seat);
    }
    this.shoe = e.phase === 'voided' ? newShuffledShoe(STANDARD_RULES.decks, this.rng) : e.shoe;
    this.phase = 'results';
    this.handoff = null;
  }

  nextRound() {
    if (this.phase !== 'results') return;
    this.phase = 'betting';
    this.engine = null;
    this.changed();
  }

  /** Builds the same snapshot shape the online table renders. */
  private build(): RoomSnapshot {
    const tp = this.turnPlayer();
    const viewer = tp ?? this.players[0];
    const e = this.engine;
    return {
      roomId: 'local',
      code: 'LOCAL',
      version: this.version,
      mode: 'casual',
      ownerId: this.players[0].id,
      dealerUserId: null,
      settings: { stakes: this.stakes, turnSeconds: 0, dealerMode: 'auto', rotateDealerEvery: 0, maxSeats: 6, betSeconds: 0, resultSeconds: 0 },
      phase: this.phase,
      roundNumber: this.round,
      deadline: null,
      serverTime: Date.now(),
      seats: this.players.map((p, i) => ({ index: i, userId: p.id, name: p.name, avatar: p.avatar, connected: true, betUnits: p.betUnits, sittingOut: false })),
      members: this.players.map((p) => ({ userId: p.id, name: p.name, avatar: p.avatar, connected: true, role: 'player' as const })),
      round: e ? toPublicRound(e) : null,
      match: null,
      gifts: [],
      you: {
        userId: viewer.id,
        seatIndex: this.players.indexOf(viewer),
        availableUnits: viewer.units,
        legalActions: tp && !this.handoff && e ? legalActions(e, tp.units) : [],
        isDealer: false,
        isOwner: true,
        canDealerStep: false,
      },
    };
  }
}
