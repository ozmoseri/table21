import { z } from 'zod';
import { totals, type DrawnCard, type RoundState, type HandStatus, type Outcome, type PlayerAction } from '@table21/game-engine';

/* ------------------------------------------------------------------ */
/* Shared constants                                                    */
/* ------------------------------------------------------------------ */

export const AVATARS = ['amber', 'cobalt', 'sage', 'coral', 'plum', 'sand', 'slate', 'rose'] as const;
export type AvatarId = (typeof AVATARS)[number];

export const REACTIONS = ['nice', 'card', 'wow', 'yourturn', 'thanks', 'again', 'clap', 'wink'] as const;
export type ReactionId = (typeof REACTIONS)[number];

export const STAKE_OPTIONS = [10, 25, 50, 100, 250] as const;

/* ------------------------------------------------------------------ */
/* Client to server commands                                           */
/* ------------------------------------------------------------------ */

const id = z.string().min(8).max(64).regex(/^[A-Za-z0-9_-]+$/);

export const DisplayName = z
  .string()
  .transform((s) => s.normalize('NFKC').replace(/[\u0000-\u001f\u007f<>]/g, '').replace(/\s+/g, ' ').trim())
  .pipe(z.string().min(1).max(20));

export const SessionCreate = z.object({ name: DisplayName, avatar: z.enum(AVATARS), locale: z.enum(['he', 'en']).default('he') });

export const RoomSettingsInput = z.object({
  stakes: z.array(z.number().int().positive().max(100_000)).min(1).max(8).optional(),
  turnSeconds: z.number().int().min(10).max(90).optional(),
  dealerMode: z.enum(['auto', 'human']).optional(),
  rotateDealerEvery: z.union([z.literal(0), z.literal(5)]).optional(),
});

export const RoomCreate = z.object({
  mode: z.enum(['casual', 'match']).default('casual'),
  settings: RoomSettingsInput.default({}),
  matchStackCoins: z.number().int().min(100).max(100_000).default(1000),
  matchRounds: z.number().int().min(1).max(30).default(10),
  groupId: z.string().optional(),
});

const base = { commandId: id, roomId: id, roundId: id.nullable().optional(), expectedVersion: z.number().int().nonnegative() };

export const Command = z.discriminatedUnion('type', [
  z.object({ ...base, type: z.literal('sit') }),
  z.object({ ...base, type: z.literal('leave_seat') }),
  z.object({ ...base, type: z.literal('bet'), coins: z.number().int().positive().max(100_000) }),
  z.object({ ...base, type: z.literal('clear_bet') }),
  z.object({ ...base, type: z.literal('deal') }),
  z.object({ ...base, type: z.literal('action'), action: z.enum(['hit', 'stand', 'double', 'split']) }),
  z.object({ ...base, type: z.literal('dealer_step') }),
  z.object({ ...base, type: z.literal('claim_dealer') }),
  z.object({ ...base, type: z.literal('release_dealer') }),
  z.object({ ...base, type: z.literal('settings'), settings: RoomSettingsInput }),
  z.object({ ...base, type: z.literal('start_match') }),
]);
export type Command = z.infer<typeof Command>;
export type CommandType = Command['type'];

export const ReactionInput = z.object({ roomId: id, reaction: z.enum(REACTIONS) });

/** Table gifts are visual gestures only: no coin value, no credit to the recipient, not transferable. */
export const GIFTS = ['coffee', 'tea', 'cookie', 'rose', 'trophy', 'tissue'] as const;
export type GiftId = (typeof GIFTS)[number];
export const GIFT_TTL_MS = 45_000;
export const GiftInput = z.object({ roomId: id, recipientId: id, giftId: z.enum(GIFTS), eventId: id });

export interface GiftEvent {
  id: string;
  fromId: string;
  toId: string;
  giftId: GiftId;
  at: number;
  expiresAt: number;
}

export type ErrorCode =
  | 'bad_request'
  | 'unauthorized'
  | 'not_found'
  | 'room_full'
  | 'stale_version'
  | 'wrong_phase'
  | 'wrong_round'
  | 'not_your_turn'
  | 'not_seated'
  | 'already_seated_elsewhere'
  | 'insufficient_funds'
  | 'illegal_action'
  | 'bad_stake'
  | 'forbidden'
  | 'rate_limited'
  | 'cooldown'
  | 'match_locked'
  | 'timeout'
  | 'internal';

export interface CommandResult {
  ok: boolean;
  error?: ErrorCode;
  version: number;
  duplicate?: boolean;
}

/* ------------------------------------------------------------------ */
/* Server to client snapshots (allowlisted, redacted)                  */
/* ------------------------------------------------------------------ */

export type PublicCard = { id: string; rank: DrawnCard['rank']; suit: DrawnCard['suit'] } | { id: string; hidden: true };

export interface PublicHand {
  cards: PublicCard[];
  total: number;
  soft: boolean;
  stakeUnits: number;
  status: HandStatus;
  doubled: boolean;
  fromSplit: boolean;
  outcome: Outcome | null;
  returnedUnits: number | null;
}

export interface PublicRoundSeat {
  seatId: string;
  playerId: string;
  hands: PublicHand[];
}

export interface PublicRound {
  roundId: string;
  phase: RoundState['phase'];
  seats: PublicRoundSeat[];
  dealer: { cards: PublicCard[]; total: number | null; soft: boolean; revealed: boolean };
  turn: { seat: number; hand: number } | null;
  voidReason: string | null;
}

const pubCard = (roundId: string, c: DrawnCard): PublicCard => ({ id: `${roundId}:${c.slot}`, rank: c.rank, suit: c.suit });

/**
 * Builds the client view of a round from an explicit allowlist. Never spreads engine state:
 * the shoe, physical card ids and the unrevealed hole card are not representable in the output.
 */
export function toPublicRound(s: RoundState): PublicRound {
  const dealerVisible = s.dealer.holeRevealed ? s.dealer.cards : s.dealer.cards.slice(0, 1);
  const dt = dealerVisible.length ? totals(dealerVisible) : null;
  return {
    roundId: s.roundId,
    phase: s.phase,
    seats: s.seats.map((seat) => ({
      seatId: seat.seatId,
      playerId: seat.playerId,
      hands: seat.hands.map((h) => {
        const t = totals(h.cards);
        return {
          cards: h.cards.map((c) => pubCard(s.roundId, c)),
          total: t.total,
          soft: t.soft,
          stakeUnits: h.stake,
          status: h.status,
          doubled: h.doubled,
          fromSplit: h.fromSplit,
          outcome: h.outcome ?? null,
          returnedUnits: h.returned ?? null,
        };
      }),
    })),
    dealer: {
      cards: s.dealer.cards.map((c, i) =>
        i === 1 && !s.dealer.holeRevealed ? { id: `${s.roundId}:${c.slot}`, hidden: true as const } : pubCard(s.roundId, c),
      ),
      total: dt ? dt.total : null,
      soft: dt ? dt.soft : false,
      revealed: s.dealer.holeRevealed,
    },
    turn: s.turn ? { seat: s.turn.seat, hand: s.turn.hand } : null,
    voidReason: s.voidReason ?? null,
  };
}

export type RoomPhase = 'waiting' | 'betting' | 'player_turns' | 'dealer_turn' | 'results' | 'closed';

export interface RoomSettings {
  stakes: number[];
  turnSeconds: number;
  dealerMode: 'auto' | 'human';
  rotateDealerEvery: 0 | 5;
  maxSeats: number;
  betSeconds: number;
  resultSeconds: number;
}

export interface SeatView {
  index: number;
  userId: string;
  name: string;
  avatar: AvatarId;
  connected: boolean;
  betUnits: number;
  sittingOut: boolean;
}

export interface MemberView {
  userId: string;
  name: string;
  avatar: AvatarId;
  connected: boolean;
  role: 'player' | 'dealer' | 'spectator';
}

export interface MatchView {
  id: string;
  status: 'lobby' | 'running' | 'finished';
  roundsTotal: number;
  roundsPlayed: number;
  stackUnits: number;
  standings: { userId: string; name: string; avatar: AvatarId; stackUnits: number; netUnits: number; rank: number; hands: number }[];
}

export interface RoomSnapshot {
  roomId: string;
  code: string;
  version: number;
  mode: 'casual' | 'match';
  ownerId: string;
  dealerUserId: string | null;
  settings: RoomSettings;
  phase: RoomPhase;
  roundNumber: number;
  deadline: number | null;
  serverTime: number;
  seats: SeatView[];
  members: MemberView[];
  round: PublicRound | null;
  match: MatchView | null;
  /** Unexpired gifts at the table, so a reconnect shows them without replaying the animation. */
  gifts: GiftEvent[];
  you: {
    userId: string;
    seatIndex: number | null;
    availableUnits: number;
    legalActions: PlayerAction[];
    isDealer: boolean;
    isOwner: boolean;
    canDealerStep: boolean;
  };
}

export interface ReactionEvent {
  userId: string;
  name: string;
  reaction: ReactionId;
  at: number;
}

/* ------------------------------------------------------------------ */
/* REST payloads                                                       */
/* ------------------------------------------------------------------ */

export interface MeResponse {
  userId: string;
  name: string;
  avatar: AvatarId;
  friendCode: string;
  locale: 'he' | 'en';
  cardBack: string;
  tableTheme: string;
  wallet: { availableUnits: number; reservedUnits: number };
  grants: { dailyAvailable: boolean; rescueAvailable: boolean; nextDailyAt: string | null; nextRescueAt: string | null };
  activeRoom: { roomId: string; code: string } | null;
  /** True once the account has a way back on another device (recovery codes or a linked provider). */
  crossDeviceRecovery: boolean;
  account: AccountSummary;
}

/* ------------------------------ identity (Stage C) ------------------------------ */

export const AUTH_PROVIDERS = ['google', 'facebook', 'apple', 'test'] as const;
export type AuthProviderId = (typeof AUTH_PROVIDERS)[number];

export interface AccountSummary {
  /** guest: no way back yet. saved: recovery codes or a linked provider. */
  kind: 'guest' | 'saved';
  identities: { provider: AuthProviderId; emailHint: string | null; linkedAt: string }[];
  recovery: { remaining: number; createdAt: string | null };
  sessions: number;
}

export interface ProviderStatus {
  id: AuthProviderId;
  state: 'ready' | 'not_configured' | 'planned';
  publicConfig?: Record<string, string>;
  missing?: string[];
  needsHttps?: boolean;
}

export const ProviderAuthInput = z.object({
  provider: z.enum(AUTH_PROVIDERS),
  credential: z.string().min(1).max(8192),
  nonce: z.string().max(100).nullable().default(null),
  intent: z.enum(['link', 'signin']),
  confirmSwitch: z.boolean().default(false),
});
export const CodeInput = z.object({ code: z.string().min(4).max(32), confirmSwitch: z.boolean().default(false) });
export const InviteCreate = z.object({
  kind: z.enum(['friend', 'club']),
  groupId: z.string().max(64).optional(),
  maxUses: z.number().int().min(1).max(50).optional(),
  ttlHours: z.number().int().min(1).max(720).optional(),
});
export const UserRef = z.object({ userId: z.string().min(1).max(64) });

export interface StatsResponse {
  hands: number;
  wins: number;
  losses: number;
  pushes: number;
  naturals: number;
  netUnits: number;
  level: number;
  nextLevelAt: number;
  unlocks: { id: string; kind: 'card_back' | 'table_theme'; unlocked: boolean; requirement: number }[];
}

export interface LeaderboardRow {
  userId: string;
  name: string;
  avatar: AvatarId;
  value: number;
  hands: number;
  eligible: boolean;
  rank: number | null;
}

export const unitsLabel = (units: number): string => {
  const c = units / 2;
  return Number.isInteger(c) ? c.toLocaleString('en-US') : c.toLocaleString('en-US', { minimumFractionDigits: 1, maximumFractionDigits: 1 });
};
