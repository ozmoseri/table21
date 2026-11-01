import { IdempotencyConflict, idemReplay, idemSave, requestHash, withIdem, type Idem } from './idempotency.ts';
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
  timeoutStand,
  type Card,
  type RoundState,
} from '@table21/game-engine';
import {
  toPublicRound,
  type AvatarId,
  type Command,
  type CommandResult,
  type ErrorCode,
  type MatchView,
  type MemberView,
  type RoomPhase,
  type RoomSettings,
  type RoomSnapshot,
  type SeatView,
} from '@table21/protocol';
import type { Db, Q } from './db.ts';
import { ensureWallet, getWallet, lockWallet, move, FundsError, type Wallet } from './wallet.ts';
import { newCode, newId } from './util.ts';
import type { SessionUser } from './auth.ts';
import { activeGifts } from './gifts.ts';

export interface Timing {
  betSeconds: number;
  resultSeconds: number;
  dealerStepMs: number;
  humanDealerSeconds: number;
  reconnectGraceMs: number;
  autoDealDelayMs: number;
  /** First retry after a database error in a timed step; doubles up to dbRetryMaxMs. */
  dbRetryMs: number;
  dbRetryMaxMs: number;
}

export const DEFAULT_TIMING: Timing = {
  betSeconds: 20,
  resultSeconds: 6,
  dealerStepMs: 700,
  humanDealerSeconds: 15,
  reconnectGraceMs: 60_000,
  autoDealDelayMs: 1200,
  dbRetryMs: 500,
  dbRetryMaxMs: 10_000,
};

export const DEFAULT_SETTINGS: RoomSettings = {
  stakes: [10, 25, 50, 100, 250],
  turnSeconds: 25,
  dealerMode: 'auto',
  rotateDealerEvery: 0,
  maxSeats: 6,
  betSeconds: 20,
  resultSeconds: 6,
};

/** Ledger key for a coin movement made by a player's command: one movement per command, wallet and kind. */
const cmdKey = (commandId: string, walletId: string, kind: string) => `cmd:${commandId}:${walletId}:${kind}`;

export class CmdError extends Error {
  constructor(public code: ErrorCode) {
    super(code);
  }
}

interface RoomRow {
  id: string;
  code: string;
  owner_id: string;
  mode: 'casual' | 'match';
  status: 'open' | 'closed';
  settings: RoomSettings;
  dealer_user_id: string | null;
  version: number;
  round_number: number;
  completed_rounds: number;
  phase: RoomPhase;
  deadline_at: Date | null;
  shoe: Card[];
  group_id: string | null;
  match_id: string | null;
}

interface SeatRow {
  room_id: string;
  seat_index: number;
  user_id: string;
  bet_units: number;
  sitting_out: boolean;
}

interface RoundMeta {
  autoDealer: boolean;
  scope: string;
  mode: 'casual' | 'match';
  matchId: string | null;
}

interface RoundRecord {
  id: string;
  number: number;
  status: string;
  engine: RoundState;
  meta: RoundMeta;
}

export interface ManagerOptions {
  db: Db;
  emit: (roomId: string) => void | Promise<void>;
  now?: () => number;
  timing?: Partial<Timing>;
  /** Test hook only. Production never passes this, so shoes always come from the crypto RNG. */
  shoeFactory?: () => Card[];
}

const TURN_SENSITIVE = new Set<Command['type']>(['action', 'dealer_step', 'deal']);

export class RoomManager {
  readonly db: Db;
  readonly timing: Timing;
  private emit: ManagerOptions['emit'];
  private now: () => number;
  private shoeFactory: () => Card[];
  private queues = new Map<string, Promise<unknown>>();
  private timers = new Map<string, NodeJS.Timeout>();
  /** userId -> socket count and last time a socket was seen, per room. In memory by design. */
  readonly presence = new Map<string, Map<string, { sockets: number; lastSeen: number }>>();
  private closed = false;

  constructor(opts: ManagerOptions) {
    this.db = opts.db;
    this.emit = opts.emit;
    this.now = opts.now ?? Date.now;
    this.timing = { ...DEFAULT_TIMING, ...opts.timing };
    const rng = cryptoRng();
    this.shoeFactory = opts.shoeFactory ?? (() => newShuffledShoe(STANDARD_RULES.decks, rng));
  }

  /* ------------------------------ serialization ------------------------------ */

  private serial<T>(roomId: string, fn: () => Promise<T>): Promise<T> {
    const prev = this.queues.get(roomId) ?? Promise.resolve();
    const run = prev.then(fn, fn);
    const tail = run.catch(() => {});
    this.queues.set(roomId, tail);
    tail.then(() => {
      if (this.queues.get(roomId) === tail) this.queues.delete(roomId);
    });
    return run;
  }

  /** Waits until every queued room operation has finished. */
  async idle(): Promise<void> {
    while (this.queues.size) await Promise.all([...this.queues.values()]);
  }

  stop(): void {
    this.closed = true;
    for (const t of this.timers.values()) clearTimeout(t);
    this.timers.clear();
  }

  /* --------------------------------- loading --------------------------------- */

  private async lockRoom(q: Q, roomId: string): Promise<RoomRow | null> {
    const rows = await q.query<RoomRow>('select * from rooms where id = $1 for update', [roomId]);
    return rows[0] ?? null;
  }

  private async seats(q: Q, roomId: string): Promise<SeatRow[]> {
    return q.query<SeatRow>('select * from seats where room_id = $1 order by seat_index', [roomId]);
  }

  private async currentRound(q: Q, room: RoomRow): Promise<RoundRecord | null> {
    if (!room.round_number) return null;
    const rows = await q.query('select id, number, status, state from rounds where room_id = $1 and number = $2', [room.id, room.round_number]);
    if (!rows[0]) return null;
    return { id: rows[0].id, number: rows[0].number, status: rows[0].status, engine: rows[0].state.engine, meta: rows[0].state.meta };
  }

  private async saveRound(q: Q, r: RoundRecord): Promise<void> {
    r.status = r.engine.phase;
    await q.query('update rounds set status = $2, state = $3 where id = $1', [r.id, r.status, JSON.stringify({ engine: r.engine, meta: r.meta })]);
  }

  private async saveRoom(q: Q, room: RoomRow): Promise<void> {
    const rows = await q.query<{ version: number }>(
      `update rooms set settings = $2, dealer_user_id = $3, round_number = $4, completed_rounds = $5, phase = $6,
         deadline_at = $7, shoe = $8, match_id = $9, version = version + 1 where id = $1 returning version`,
      [
        room.id,
        JSON.stringify(room.settings),
        room.dealer_user_id,
        room.round_number,
        room.completed_rounds,
        room.phase,
        room.deadline_at,
        JSON.stringify(room.shoe),
        room.match_id,
      ],
    );
    room.version = rows[0].version;
  }

  private deadline(ms: number): Date {
    return new Date(this.now() + ms);
  }

  private connected(roomId: string, userId: string): boolean {
    return (this.presence.get(roomId)?.get(userId)?.sockets ?? 0) > 0;
  }

  private async scopeFor(q: Q, room: RoomRow): Promise<string> {
    if (room.mode !== 'match' || !room.match_id) return 'casual';
    const m = await q.query('select status from matches where id = $1', [room.match_id]);
    return m[0]?.status === 'running' ? `match:${room.match_id}` : 'casual';
  }

  /* --------------------------------- creation -------------------------------- */

  async createRoom(
    user: SessionUser,
    input: { mode: 'casual' | 'match'; settings: Partial<RoomSettings>; matchStackCoins: number; matchRounds: number; groupId?: string },
    idem?: Idem,
  ): Promise<{ roomId: string; code: string }> {
    const settings = normalizeSettings({ ...DEFAULT_SETTINGS, ...input.settings });
    const roomId = newId('rm');
    return withIdem(this.db, idem, async (q) => {
      const prior = await idemReplay<{ roomId: string; code: string }>(q, idem);
      if (prior) return prior.response;
      let code = newCode();
      for (let i = 0; i < 8; i++) {
        const hit = await q.query(`select 1 from rooms where code = $1 and status = 'open'`, [code]);
        if (!hit.length) break;
        code = newCode();
      }
      let groupId: string | null = null;
      if (input.groupId) {
        const g = await q.query('select 1 from group_members where group_id = $1 and user_id = $2', [input.groupId, user.id]);
        if (g.length) groupId = input.groupId;
      }
      await q.query(
        `insert into rooms(id, code, owner_id, mode, settings, shoe, group_id) values ($1,$2,$3,$4,$5,$6,$7)`,
        [roomId, code, user.id, input.mode, JSON.stringify(settings), JSON.stringify(this.shoeFactory()), groupId],
      );
      if (input.mode === 'match') {
        const matchId = newId('mt');
        await q.query(`insert into matches(id, room_id, status, rounds_total, stack_units) values ($1,$2,'lobby',$3,$4)`, [
          matchId,
          roomId,
          input.matchRounds,
          coinsToUnits(input.matchStackCoins),
        ]);
        await q.query('update rooms set match_id = $2 where id = $1', [roomId, matchId]);
      }
      await idemSave(q, idem, { roomId, code }, user.id);
      return { roomId, code };
    });
  }

  async rotateCode(user: SessionUser, roomId: string): Promise<string> {
    const code = await this.serial(roomId, () =>
      this.db.tx(async (q) => {
        const room = await this.lockRoom(q, roomId);
        if (!room || room.status !== 'open') throw new CmdError('not_found');
        if (room.owner_id !== user.id) throw new CmdError('forbidden');
        const code = newCode();
        await q.query('update rooms set code = $2, version = version + 1 where id = $1', [roomId, code]);
        return code;
      }),
    );
    await this.afterCommit(roomId);
    return code;
  }

  async findByCode(code: string): Promise<{ id: string; mode: string; owner_id: string } | null> {
    const rows = await this.db.query<{ id: string; mode: string; owner_id: string }>(`select id, mode, owner_id from rooms where code = $1 and status = 'open'`, [code]);
    return rows[0] ?? null;
  }

  /* ---------------------------------- presence -------------------------------- */

  async connect(roomId: string, userId: string): Promise<void> {
    let m = this.presence.get(roomId);
    if (!m) this.presence.set(roomId, (m = new Map()));
    const p = m.get(userId) ?? { sockets: 0, lastSeen: this.now() };
    p.sockets++;
    p.lastSeen = this.now();
    m.set(userId, p);
    await this.afterCommit(roomId, false);
  }

  async disconnect(roomId: string, userId: string): Promise<void> {
    const p = this.presence.get(roomId)?.get(userId);
    if (!p) return;
    p.sockets = Math.max(0, p.sockets - 1);
    p.lastSeen = this.now();
    if (p.sockets === 0) {
      setTimeout(() => void this.sweep(roomId).catch(() => {}), this.timing.reconnectGraceMs + 250).unref?.();
      // A disconnected presenter dealer hands control to the automatic dealer for the rest of the round.
      void this.serial(roomId, async () => {
        const changed = await this.db.tx(async (q) => {
          const room = await this.lockRoom(q, roomId);
          if (!room || room.dealer_user_id !== userId || room.phase !== 'dealer_turn') return false;
          const r = await this.currentRound(q, room);
          if (!r || r.meta.autoDealer) return false;
          r.meta.autoDealer = true;
          await this.saveRound(q, r);
          room.deadline_at = this.deadline(this.timing.dealerStepMs);
          await this.saveRoom(q, room);
          return true;
        });
        if (changed) await this.afterCommit(roomId);
      });
    }
    await this.afterCommit(roomId, false);
  }

  /* --------------------------------- commands -------------------------------- */

  async command(user: SessionUser, cmd: Command): Promise<CommandResult> {
    const { commandId: _key, ...body } = cmd;
    const hash = requestHash(body);
    return this.serial(cmd.roomId, async () => {
      let changed = false;
      try {
        const res = await this.db.tx(async (q) => {
          // The commandId is this command's idempotency key. It is claimed first, inside the same transaction as
          // every coin it moves: a concurrent retry waits on this row, then replays the committed result; a
          // rollback removes the claim, so a retry is evaluated again from scratch.
          const claim = await q.query(
            `insert into commands(user_id, command_id, room_id, result, request_hash) values ($1,$2,$3,'{"pending":true}',$4)
             on conflict (user_id, command_id) do nothing returning command_id`,
            [user.id, cmd.commandId, cmd.roomId, hash],
          );
          if (!claim.length) {
            const dup = (await q.query('select result, request_hash from commands where user_id = $1 and command_id = $2', [user.id, cmd.commandId]))[0];
            if (dup?.request_hash && dup.request_hash !== hash) throw new CmdError('idempotency_conflict');
            return { ...(dup?.result as CommandResult), duplicate: true };
          }
          const room = await this.lockRoom(q, cmd.roomId);
          if (!room || room.status !== 'open') throw new CmdError('not_found');
          if (TURN_SENSITIVE.has(cmd.type) && cmd.expectedVersion !== room.version) throw new CmdError('stale_version');
          if (cmd.expectedVersion > room.version) throw new CmdError('stale_version');
          await this.handle(q, room, user, cmd);
          await this.saveRoom(q, room);
          const result: CommandResult = { ok: true, version: room.version };
          await q.query('update commands set result = $3 where user_id = $1 and command_id = $2', [user.id, cmd.commandId, JSON.stringify(result)]);
          return result;
        });
        changed = !res.duplicate;
        return res;
      } catch (e: any) {
        const code: ErrorCode =
          e instanceof IdempotencyConflict
            ? 'idempotency_conflict'
            : e instanceof CmdError
            ? e.code
            : e instanceof FundsError
              ? 'insufficient_funds'
              : e?.code === '23505' && String(e?.constraint ?? e?.message).includes('seats_one_per_user')
                ? 'already_seated_elsewhere'
                : e?.message === 'illegal_action'
                  ? 'illegal_action'
                  : 'internal';
        if (code === 'internal') console.error('[command]', cmd.type, e?.code ?? '', e?.message ?? e);
        // The database may be the thing that failed: answer without it; the client resyncs with a snapshot later.
        const v = await this.db.query<{ version: number }>('select version from rooms where id = $1', [cmd.roomId]).catch(() => []);
        return { ok: false, error: code, version: v[0]?.version ?? cmd.expectedVersion };
      } finally {
        if (changed) await this.afterCommit(cmd.roomId);
      }
    });
  }

  private async handle(q: Q, room: RoomRow, user: SessionUser, cmd: Command): Promise<void> {
    const seats = await this.seats(q, room.id);
    const mySeat = seats.find((s) => s.user_id === user.id) ?? null;
    const between = room.phase === 'waiting' || room.phase === 'betting' || room.phase === 'results';
    const match = room.match_id ? (await q.query('select * from matches where id = $1', [room.match_id]))[0] : null;

    switch (cmd.type) {
      case 'sit': {
        if (mySeat) return;
        if (room.dealer_user_id === user.id) throw new CmdError('forbidden');
        if (match?.status === 'running') {
          const entry = await q.query('select 1 from match_entries where match_id = $1 and user_id = $2', [match.id, user.id]);
          if (!entry.length) throw new CmdError('match_locked');
        }
        const used = new Set(seats.map((s) => s.seat_index));
        let idx = -1;
        for (let i = 0; i < room.settings.maxSeats; i++) if (!used.has(i)) { idx = i; break; }
        if (idx < 0) throw new CmdError('room_full');
        await q.query('insert into seats(room_id, seat_index, user_id) values ($1,$2,$3)', [room.id, idx, user.id]);
        return;
      }
      case 'leave_seat': {
        if (!mySeat) throw new CmdError('not_seated');
        const r = await this.currentRound(q, room);
        const inRound = r && (r.engine.phase === 'player_turns' || r.engine.phase === 'dealer_turn') && r.engine.seats.some((s) => s.playerId === user.id);
        if (inRound) {
          // The staked round continues to its end; the seat is released afterwards.
          await q.query('update seats set sitting_out = true where room_id = $1 and seat_index = $2', [room.id, mySeat.seat_index]);
          return;
        }
        await this.releaseBet(q, room, mySeat, cmd.commandId);
        await q.query('delete from seats where room_id = $1 and seat_index = $2', [room.id, mySeat.seat_index]);
        await this.maybeBackToWaiting(q, room);
        return;
      }
      case 'bet': {
        if (!mySeat) throw new CmdError('not_seated');
        if (room.phase !== 'waiting' && room.phase !== 'betting') throw new CmdError('wrong_phase');
        if (room.mode === 'match' && match?.status !== 'running') throw new CmdError('match_locked');
        if (!room.settings.stakes.includes(cmd.coins)) throw new CmdError('bad_stake');
        const units = coinsToUnits(cmd.coins);
        const scope = await this.scopeFor(q, room);
        const w = await lockWallet(q, user.id, scope).catch(() => {
          throw new CmdError('insufficient_funds');
        });
        if (mySeat.bet_units > 0)
          await move(q, w, 'stake_release', mySeat.bet_units, -mySeat.bet_units, { roomId: room.id, commandId: cmd.commandId, idemKey: cmdKey(cmd.commandId, w.id, 'stake_release') });
        if (w.available_units < units) throw new CmdError('insufficient_funds');
        await move(q, w, 'stake_reserve', -units, units, { roomId: room.id, commandId: cmd.commandId, idemKey: cmdKey(cmd.commandId, w.id, 'stake_reserve') });
        await q.query('update seats set bet_units = $3, sitting_out = false where room_id = $1 and seat_index = $2', [room.id, mySeat.seat_index, units]);
        mySeat.bet_units = units;
        mySeat.sitting_out = false;
        if (room.phase === 'waiting') {
          room.phase = 'betting';
          room.deadline_at = this.deadline(room.settings.betSeconds * 1000);
        }
        // Players who cannot afford the minimum stake (e.g. a busted match stack) do not hold up the deal.
        const minUnits = coinsToUnits(Math.min(...room.settings.stakes));
        const funds = await q.query<{ user_id: string; available_units: number }>(
          'select user_id, available_units from wallets where scope = $1 and user_id = any($2)',
          [scope, seats.map((s) => s.user_id)],
        );
        const canBet = (s: SeatRow) => s.bet_units > 0 || (funds.find((f) => f.user_id === s.user_id)?.available_units ?? 0) >= minUnits;
        const active = seats.filter((s) => !s.sitting_out && canBet(s));
        // Early deal only when everyone seated has bet and nobody connected is still watching (they may want to sit).
        const watching = [...(this.presence.get(room.id)?.entries() ?? [])].some(
          ([uid, p]) => p.sockets > 0 && uid !== room.dealer_user_id && !seats.some((s) => s.user_id === uid),
        );
        if ((room.settings.dealerMode === 'auto' || !room.dealer_user_id) && !watching) {
          if (active.length && active.every((s) => s.bet_units > 0)) room.deadline_at = this.deadline(this.timing.autoDealDelayMs);
        }
        return;
      }
      case 'clear_bet': {
        if (!mySeat) throw new CmdError('not_seated');
        if (room.phase !== 'betting' && room.phase !== 'waiting') throw new CmdError('wrong_phase');
        await this.releaseBet(q, room, mySeat, cmd.commandId);
        await this.maybeBackToWaiting(q, room);
        return;
      }
      case 'deal': {
        if (room.phase !== 'betting') throw new CmdError('wrong_phase');
        const isPresenter = room.settings.dealerMode === 'human' && room.dealer_user_id === user.id;
        const ownerCanDeal = (room.settings.dealerMode === 'auto' || !room.dealer_user_id) && room.owner_id === user.id;
        if (!isPresenter && !ownerCanDeal) throw new CmdError('forbidden');
        if (!seats.some((s) => s.bet_units > 0)) throw new CmdError('wrong_phase');
        await this.deal(q, room);
        return;
      }
      case 'action': {
        if (room.phase !== 'player_turns') throw new CmdError('wrong_phase');
        const r = await this.currentRound(q, room);
        if (!r || r.engine.phase !== 'player_turns' || !r.engine.turn) throw new CmdError('wrong_phase');
        if (cmd.roundId && cmd.roundId !== r.id) throw new CmdError('wrong_round');
        const seat = r.engine.seats[r.engine.turn.seat];
        if (seat.playerId !== user.id) throw new CmdError('not_your_turn');
        const w = await lockWallet(q, user.id, r.meta.scope);
        if (!legalActions(r.engine, w.available_units).includes(cmd.action)) {
          const anyFunds = legalActions(r.engine, Number.MAX_SAFE_INTEGER).includes(cmd.action);
          throw new CmdError(anyFunds ? 'insufficient_funds' : 'illegal_action');
        }
        const extra = requiredStake(r.engine, cmd.action);
        const available = w.available_units;
        if (extra > 0) await move(q, w, 'stake_reserve', -extra, extra, { roomId: room.id, roundId: r.id, commandId: cmd.commandId, idemKey: cmdKey(cmd.commandId, w.id, 'stake_reserve') });
        r.engine = applyAction(r.engine, cmd.action, available);
        await this.saveRound(q, r);
        await this.onRoundChanged(q, room, r);
        return;
      }
      case 'dealer_step': {
        if (room.phase !== 'dealer_turn') throw new CmdError('wrong_phase');
        if (room.dealer_user_id !== user.id) throw new CmdError('forbidden');
        const r = await this.currentRound(q, room);
        if (!r || r.meta.autoDealer) throw new CmdError('forbidden');
        if (cmd.roundId && cmd.roundId !== r.id) throw new CmdError('wrong_round');
        r.engine = dealerStep(r.engine);
        await this.saveRound(q, r);
        await this.onRoundChanged(q, room, r);
        return;
      }
      case 'claim_dealer': {
        if (room.settings.dealerMode !== 'human') throw new CmdError('forbidden');
        if (!between || room.phase === 'betting') throw new CmdError('wrong_phase');
        if (room.dealer_user_id && room.dealer_user_id !== user.id && this.connected(room.id, room.dealer_user_id)) throw new CmdError('forbidden');
        if (mySeat) {
          if (mySeat.bet_units > 0) throw new CmdError('wrong_phase');
          await q.query('delete from seats where room_id = $1 and seat_index = $2', [room.id, mySeat.seat_index]);
        }
        room.dealer_user_id = user.id;
        return;
      }
      case 'release_dealer': {
        if (room.dealer_user_id !== user.id) throw new CmdError('forbidden');
        if (!between) throw new CmdError('wrong_phase');
        room.dealer_user_id = null;
        return;
      }
      case 'settings': {
        if (room.owner_id !== user.id) throw new CmdError('forbidden');
        if (room.phase !== 'waiting' && room.phase !== 'results') throw new CmdError('wrong_phase');
        if (match?.status === 'running') throw new CmdError('match_locked');
        room.settings = normalizeSettings({ ...room.settings, ...cmd.settings });
        if (room.settings.dealerMode === 'auto') room.dealer_user_id = null;
        return;
      }
      case 'start_match': {
        if (room.mode !== 'match') throw new CmdError('forbidden');
        if (room.owner_id !== user.id) throw new CmdError('forbidden');
        if (room.phase !== 'waiting') throw new CmdError('wrong_phase');
        if (match?.status === 'running') throw new CmdError('match_locked');
        if (!seats.length) throw new CmdError('not_seated');
        let matchId = match?.id as string | undefined;
        let stack = match?.stack_units as number;
        let total = match?.rounds_total as number;
        if (!match || match.status === 'finished') {
          matchId = newId('mt');
          stack = match?.stack_units ?? 2000;
          total = match?.rounds_total ?? 10;
          await q.query(`insert into matches(id, room_id, status, rounds_total, stack_units) values ($1,$2,'lobby',$3,$4)`, [matchId, room.id, total, stack]);
        }
        await q.query(`update matches set status = 'running', started_at = now() where id = $1`, [matchId]);
        for (const s of seats) {
          const w = await ensureWallet(q, s.user_id, `match:${matchId}`);
          await move(q, w, 'match_stack', stack, 0, { roomId: room.id, idemKey: `match:${matchId}:${s.user_id}` });
          await q.query('insert into match_entries(match_id, user_id, wallet_id) values ($1,$2,$3) on conflict do nothing', [matchId, s.user_id, w.id]);
        }
        room.match_id = matchId!;
        return;
      }
    }
  }

  private async releaseBet(q: Q, room: RoomRow, seat: SeatRow, commandId?: string): Promise<void> {
    if (seat.bet_units <= 0) return;
    const scope = await this.scopeFor(q, room);
    const w = await lockWallet(q, seat.user_id, scope);
    await move(q, w, 'stake_release', seat.bet_units, -seat.bet_units, { roomId: room.id, commandId, idemKey: commandId ? cmdKey(commandId, w.id, 'stake_release') : undefined });
    await q.query('update seats set bet_units = 0 where room_id = $1 and seat_index = $2', [room.id, seat.seat_index]);
    seat.bet_units = 0;
  }

  private async maybeBackToWaiting(q: Q, room: RoomRow): Promise<void> {
    if (room.phase !== 'betting') return;
    const rows = await q.query('select 1 from seats where room_id = $1 and bet_units > 0', [room.id]);
    if (!rows.length) {
      room.phase = 'waiting';
      room.deadline_at = null;
    }
  }

  /* ---------------------------------- rounds ---------------------------------- */

  private async deal(q: Q, room: RoomRow): Promise<void> {
    const seats = (await this.seats(q, room.id)).filter((s) => s.bet_units > 0);
    if (!seats.length) {
      room.phase = 'waiting';
      room.deadline_at = null;
      return;
    }
    if (room.shoe.length < STANDARD_RULES.cutRemaining) room.shoe = this.shoeFactory();
    const scope = await this.scopeFor(q, room);
    const number = room.round_number + 1;
    const roundId = newId('rd');
    const engine = startRound({
      roundId,
      rules: STANDARD_RULES,
      shoe: room.shoe,
      seats: seats.map((s) => ({ seatId: String(s.seat_index), playerId: s.user_id, stake: s.bet_units })),
    });
    const humanDealer = room.settings.dealerMode === 'human' && !!room.dealer_user_id && this.connected(room.id, room.dealer_user_id);
    const r: RoundRecord = {
      id: roundId,
      number,
      status: engine.phase,
      engine,
      meta: { autoDealer: !humanDealer, scope, mode: room.mode, matchId: scope.startsWith('match:') ? room.match_id : null },
    };
    await q.query(
      `insert into rounds(id, room_id, number, status, state, wallet_scope, rules_version, mode, match_id) values ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
      [roundId, room.id, number, engine.phase, JSON.stringify({ engine, meta: r.meta }), scope, STANDARD_RULES.version, room.mode, r.meta.matchId],
    );
    await q.query('update seats set bet_units = 0 where room_id = $1', [room.id]);
    room.round_number = number;
    await this.onRoundChanged(q, room, r);
  }

  /** Maps the engine phase onto the room phase, deadlines and settlement. */
  private async onRoundChanged(q: Q, room: RoomRow, r: RoundRecord): Promise<void> {
    const e = r.engine;
    if (e.phase === 'player_turns') {
      room.phase = 'player_turns';
      room.deadline_at = this.deadline(room.settings.turnSeconds * 1000);
    } else if (e.phase === 'dealer_turn') {
      room.phase = 'dealer_turn';
      if (!r.meta.autoDealer && room.dealer_user_id && !this.connected(room.id, room.dealer_user_id)) {
        r.meta.autoDealer = true;
        await this.saveRound(q, r);
      }
      room.deadline_at = this.deadline(r.meta.autoDealer ? this.timing.dealerStepMs : this.timing.humanDealerSeconds * 1000);
    } else if (e.phase === 'settled') {
      await this.settle(q, room, r);
    } else if (e.phase === 'voided') {
      await this.voidRound(q, room, r);
    }
  }

  private async settle(q: Q, room: RoomRow, r: RoundRecord): Promise<void> {
    const once = await q.query(`update rounds set finished_at = now() where id = $1 and finished_at is null returning id`, [r.id]);
    if (once.length) {
      const sorted = [...r.engine.seats].sort((a, b) => a.playerId.localeCompare(b.playerId));
      for (const seat of sorted) {
        const stake = seatStake(seat);
        const ret = seatReturn(seat);
        const w = await lockWallet(q, seat.playerId, r.meta.scope);
        await move(q, w, 'stake_return', ret, -stake, { roomId: room.id, roundId: r.id, idemKey: `settle:${r.id}:${seat.playerId}` });
        await q.query(
          `insert into settlements(round_id, user_id, kind, stake_units, return_units) values ($1,$2,'settle',$3,$4) on conflict do nothing`,
          [r.id, seat.playerId, stake, ret],
        );
        for (let i = 0; i < seat.hands.length; i++) {
          const h = seat.hands[i];
          await q.query(
            `insert into hand_results(round_id, room_id, user_id, hand_index, stake_units, return_units, net_units, outcome, is_natural, mode, rules_version, match_id)
             values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) on conflict do nothing`,
            [r.id, room.id, seat.playerId, i, h.stake, h.returned ?? 0, (h.returned ?? 0) - h.stake, h.outcome, h.outcome === 'blackjack', r.meta.mode, r.engine.rules.version, r.meta.matchId],
          );
        }
      }
      room.completed_rounds += 1;
      if (r.meta.matchId) {
        await q.query(
          `update matches set rounds_played = rounds_played + 1,
             status = case when rounds_played + 1 >= rounds_total then 'finished' else status end,
             finished_at = case when rounds_played + 1 >= rounds_total then now() else finished_at end
           where id = $1`,
          [r.meta.matchId],
        );
      }
    }
    room.shoe = r.engine.shoe;
    room.phase = 'results';
    room.deadline_at = this.deadline(room.settings.resultSeconds * 1000);
  }

  private async voidRound(q: Q, room: RoomRow, r: RoundRecord): Promise<void> {
    const once = await q.query(`update rounds set finished_at = now() where id = $1 and finished_at is null returning id`, [r.id]);
    if (once.length) {
      console.warn(`[round] voided ${r.id} in room ${room.id}: ${r.engine.voidReason}`);
      for (const seat of [...r.engine.seats].sort((a, b) => a.playerId.localeCompare(b.playerId))) {
        const stake = seatStake(seat);
        const w = await lockWallet(q, seat.playerId, r.meta.scope);
        await move(q, w, 'refund', stake, -stake, { roomId: room.id, roundId: r.id, idemKey: `void:${r.id}:${seat.playerId}` });
        await q.query(
          `insert into settlements(round_id, user_id, kind, stake_units, return_units) values ($1,$2,'void',$3,$3) on conflict do nothing`,
          [r.id, seat.playerId, stake],
        );
      }
    }
    room.shoe = this.shoeFactory();
    room.phase = 'results';
    room.deadline_at = this.deadline(room.settings.resultSeconds * 1000);
  }

  /** Between rounds: release seats of players who left or exceeded the reconnection window, rotate the presenter. */
  private async betweenRounds(q: Q, room: RoomRow): Promise<void> {
    const seats = await this.seats(q, room.id);
    const now = this.now();
    for (const s of seats) {
      const p = this.presence.get(room.id)?.get(s.user_id);
      const gone = !p || (p.sockets === 0 && now - p.lastSeen > this.timing.reconnectGraceMs);
      if (s.sitting_out || gone) {
        await this.releaseBet(q, room, s);
        await q.query('delete from seats where room_id = $1 and seat_index = $2', [room.id, s.seat_index]);
      }
    }
    if (room.dealer_user_id) {
      const p = this.presence.get(room.id)?.get(room.dealer_user_id);
      if (!p || (p.sockets === 0 && now - p.lastSeen > this.timing.reconnectGraceMs)) room.dealer_user_id = null;
    }
    const every = room.settings.rotateDealerEvery;
    if (every && room.settings.dealerMode === 'human' && room.dealer_user_id && room.completed_rounds > 0 && room.completed_rounds % every === 0) {
      const remaining = (await this.seats(q, room.id)).filter((s) => this.connected(room.id, s.user_id) && s.bet_units === 0);
      const next = remaining[0];
      if (next) {
        const prev = room.dealer_user_id;
        await q.query('delete from seats where room_id = $1 and seat_index = $2', [room.id, next.seat_index]);
        await q.query('insert into seats(room_id, seat_index, user_id) values ($1,$2,$3)', [room.id, next.seat_index, prev]);
        room.dealer_user_id = next.user_id;
      }
    }
  }

  /* ------------------------------ timers / ticks ------------------------------ */

  /** Runs the transition that is due when the current deadline passes. Fenced by version. */
  private async tick(roomId: string, version: number): Promise<void> {
    let changed = false;
    await this.serial(roomId, async () => {
      changed = await this.db.tx(async (q) => {
        const room = await this.lockRoom(q, roomId);
        if (!room || room.status !== 'open' || room.version !== version) return false;
        if (!room.deadline_at || room.deadline_at.getTime() > this.now() + 25) return false;
        if (room.phase === 'betting') {
          await this.deal(q, room);
        } else if (room.phase === 'player_turns') {
          const r = await this.currentRound(q, room);
          if (!r || r.engine.phase !== 'player_turns') return false;
          r.engine = timeoutStand(r.engine);
          await this.saveRound(q, r);
          await this.onRoundChanged(q, room, r);
        } else if (room.phase === 'dealer_turn') {
          const r = await this.currentRound(q, room);
          if (!r || r.engine.phase !== 'dealer_turn') return false;
          if (!r.meta.autoDealer) r.meta.autoDealer = true; // presenter timed out: automatic control, same outcome
          r.engine = dealerStep(r.engine);
          await this.saveRound(q, r);
          await this.onRoundChanged(q, room, r);
        } else if (room.phase === 'results') {
          await this.betweenRounds(q, room);
          room.phase = 'waiting';
          room.deadline_at = null;
        } else {
          room.deadline_at = null;
        }
        await this.saveRoom(q, room);
        return true;
      });
    });
    if (changed) await this.afterCommit(roomId);
  }

  /** Releases seats of players gone longer than the reconnection window while the room is idle. */
  async sweep(roomId: string): Promise<void> {
    let changed = false;
    await this.serial(roomId, async () => {
      changed = await this.db.tx(async (q) => {
        const room = await this.lockRoom(q, roomId);
        if (!room || (room.phase !== 'waiting' && room.phase !== 'betting')) return false;
        const before = await q.query('select count(*)::int as n from seats where room_id = $1', [roomId]);
        const dealer = room.dealer_user_id;
        await this.betweenRounds(q, room);
        await this.maybeBackToWaiting(q, room);
        const after = await q.query('select count(*)::int as n from seats where room_id = $1', [roomId]);
        if (before[0].n === after[0].n && dealer === room.dealer_user_id) return false;
        await this.saveRoom(q, room);
        return true;
      });
    });
    if (changed) await this.afterCommit(roomId);
  }

  /**
   * The database went away in the middle of a timed step (a payout, a dealer draw, a deal): that transaction rolled
   * back as a whole, so nothing was paid and the room is paused on its last committed state. Retry the same step
   * (fenced by the same version) with backoff until the database answers; settlement stays exactly once through the
   * finished_at guard and the ledger idem_key.
   */
  private retryLater(roomId: string, version: number | null, attempt: number): void {
    if (this.closed) return;
    const delay = Math.min(this.timing.dbRetryMs * 2 ** Math.min(attempt, 5), this.timing.dbRetryMaxMs);
    const old = this.timers.get(roomId);
    if (old) clearTimeout(old);
    const t = setTimeout(() => {
      this.timers.delete(roomId);
      const step = version === null ? this.afterCommit(roomId) : this.tick(roomId, version);
      void step.catch((e) => {
        console.error('[db-retry]', roomId, e?.code ?? e?.message);
        this.retryLater(roomId, version, attempt + 1);
      });
    }, delay);
    t.unref?.();
    this.timers.set(roomId, t);
  }

  private async afterCommit(roomId: string, reschedule = true): Promise<void> {
    if (this.closed) return;
    if (reschedule) {
      let rows: { version: number; deadline_at: Date | null; status: string }[];
      try {
        rows = await this.db.query<{ version: number; deadline_at: Date | null; status: string }>(
          'select version, deadline_at, status from rooms where id = $1',
          [roomId],
        );
      } catch (e: any) {
        // Committed, but the timer could not be read back: look again once the database answers.
        console.error('[after-commit]', roomId, e?.code ?? e?.message);
        this.retryLater(roomId, null, 0);
        return;
      }
      const r = rows[0];
      const old = this.timers.get(roomId);
      if (old) clearTimeout(old);
      this.timers.delete(roomId);
      if (r && r.status === 'open' && r.deadline_at) {
        const delay = Math.max(0, r.deadline_at.getTime() - this.now());
        const t = setTimeout(() => {
          this.timers.delete(roomId);
          void this.tick(roomId, r.version).catch((e) => {
            console.error('[tick]', roomId, e?.code ?? e?.message);
            this.retryLater(roomId, r.version, 0);
          });
        }, delay);
        t.unref?.();
        this.timers.set(roomId, t);
      }
    }
    try {
      await this.emit(roomId);
    } catch (e) {
      // Emission happens after the durable commit; clients recover by requesting a full snapshot.
      console.error('[emit]', e);
    }
  }

  /** After a process restart: resume every open room from its committed state. Never re-deals a started hand. */
  async recover(): Promise<number> {
    const rooms = await this.db.query<{ id: string }>(`select id from rooms where status = 'open' and deadline_at is not null`);
    const seated = await this.db.query<{ room_id: string; user_id: string }>(
      `select s.room_id, s.user_id from seats s join rooms r on r.id = s.room_id where r.status = 'open'`,
    );
    for (const s of seated) {
      let m = this.presence.get(s.room_id);
      if (!m) this.presence.set(s.room_id, (m = new Map()));
      if (!m.has(s.user_id)) m.set(s.user_id, { sockets: 0, lastSeen: this.now() });
    }
    for (const r of rooms) await this.afterCommit(r.id);
    return rooms.length;
  }

  /* --------------------------------- snapshots -------------------------------- */

  async snapshots(roomId: string, userIds: string[]): Promise<Map<string, RoomSnapshot>> {
    const q: Q = this.db;
    const out = new Map<string, RoomSnapshot>();
    const rows = await q.query<RoomRow>('select * from rooms where id = $1', [roomId]);
    const room = rows[0];
    if (!room) return out;
    const seatRows = await q.query<SeatRow & { name: string; avatar: AvatarId }>(
      `select s.*, u.name, u.avatar from seats s join users u on u.id = s.user_id where s.room_id = $1 order by s.seat_index`,
      [roomId],
    );
    const pres = this.presence.get(roomId) ?? new Map();
    const memberIds = new Set<string>([...seatRows.map((s) => s.user_id), ...[...pres.entries()].filter(([, p]) => p.sockets > 0).map(([u]) => u)]);
    if (room.dealer_user_id) memberIds.add(room.dealer_user_id);
    for (const u of userIds) memberIds.add(u);
    const users = memberIds.size
      ? await q.query<{ id: string; name: string; avatar: AvatarId }>('select id, name, avatar from users where id = any($1)', [[...memberIds]])
      : [];
    const byId = new Map(users.map((u) => [u.id, u]));
    const seats: SeatView[] = seatRows.map((s) => ({
      index: s.seat_index,
      userId: s.user_id,
      name: s.name,
      avatar: s.avatar,
      connected: this.connected(roomId, s.user_id),
      betUnits: s.bet_units,
      sittingOut: s.sitting_out,
    }));
    const members: MemberView[] = [...memberIds]
      .filter((id) => byId.has(id))
      .map((id) => ({
        userId: id,
        name: byId.get(id)!.name,
        avatar: byId.get(id)!.avatar,
        connected: this.connected(roomId, id),
        role: room.dealer_user_id === id ? 'dealer' : seatRows.some((s) => s.user_id === id) ? 'player' : 'spectator',
      }));

    let round: RoundRecord | null = null;
    if (room.phase === 'player_turns' || room.phase === 'dealer_turn' || room.phase === 'results') round = await this.currentRound(q, room);
    const publicRound = round ? toPublicRound(round.engine) : null;

    let match: MatchView | null = null;
    if (room.match_id) {
      const m = (await q.query('select * from matches where id = $1', [room.match_id]))[0];
      if (m) {
        const entries = await q.query(
          `select e.user_id, u.name, u.avatar, w.available_units + w.reserved_units as stack,
                  (select count(*)::int from hand_results h where h.match_id = e.match_id and h.user_id = e.user_id) as hands
             from match_entries e join users u on u.id = e.user_id join wallets w on w.id = e.wallet_id
            where e.match_id = $1`,
          [m.id],
        );
        const standings = entries
          .map((e) => ({ userId: e.user_id, name: e.name, avatar: e.avatar, stackUnits: e.stack, netUnits: e.stack - m.stack_units, hands: e.hands, rank: 0 }))
          .sort((a, b) => b.netUnits - a.netUnits);
        standings.forEach((s, i) => (s.rank = i > 0 && standings[i - 1].netUnits === s.netUnits ? standings[i - 1].rank : i + 1));
        match = { id: m.id, status: m.status, roundsTotal: m.rounds_total, roundsPlayed: m.rounds_played, stackUnits: m.stack_units, standings };
      }
    }

    const scope = round && round.engine.phase !== 'settled' && round.engine.phase !== 'voided' ? round.meta.scope : await this.scopeFor(q, room);
    const gifts = await activeGifts(this.db, roomId, this.now());
    for (const uid of userIds) {
      const w: Wallet | null = await getWallet(q, uid, scope);
      const available = w?.available_units ?? 0;
      const mine = seats.find((s) => s.userId === uid);
      const isTurn = !!round && round.engine.phase === 'player_turns' && !!round.engine.turn && round.engine.seats[round.engine.turn.seat].playerId === uid;
      out.set(uid, {
        roomId: room.id,
        code: room.code,
        version: room.version,
        mode: room.mode,
        ownerId: room.owner_id,
        dealerUserId: room.dealer_user_id,
        settings: room.settings,
        phase: room.phase,
        roundNumber: room.round_number,
        deadline: room.deadline_at ? room.deadline_at.getTime() : null,
        serverTime: this.now(),
        seats,
        members,
        round: publicRound,
        match,
        gifts,
        you: {
          userId: uid,
          seatIndex: mine ? mine.index : null,
          availableUnits: available,
          legalActions: isTurn ? legalActions(round!.engine, available) : [],
          isDealer: room.dealer_user_id === uid,
          isOwner: room.owner_id === uid,
          canDealerStep: room.phase === 'dealer_turn' && room.dealer_user_id === uid && !!round && !round.meta.autoDealer,
        },
      });
    }
    return out;
  }

  /** Server-only accessor used by tests to compare with what clients receive. Never exposed over the network. */
  async _engineState(roomId: string): Promise<RoundState | null> {
    const room = (await this.db.query<RoomRow>('select * from rooms where id = $1', [roomId]))[0];
    if (!room) return null;
    return (await this.currentRound(this.db, room))?.engine ?? null;
  }
}

export function normalizeSettings(s: RoomSettings): RoomSettings {
  const stakes = [...new Set(s.stakes.filter((x) => Number.isSafeInteger(x) && x > 0 && x <= 100_000))].sort((a, b) => a - b).slice(0, 8);
  return {
    stakes: stakes.length ? stakes : DEFAULT_SETTINGS.stakes,
    turnSeconds: Math.min(90, Math.max(10, Math.round(s.turnSeconds))),
    dealerMode: s.dealerMode === 'human' ? 'human' : 'auto',
    rotateDealerEvery: s.rotateDealerEvery === 5 ? 5 : 0,
    maxSeats: 6,
    betSeconds: Math.min(120, Math.max(5, Math.round(s.betSeconds ?? 20))),
    resultSeconds: Math.min(30, Math.max(2, Math.round(s.resultSeconds ?? 6))),
  };
}
