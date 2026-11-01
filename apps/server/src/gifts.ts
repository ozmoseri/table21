import { GIFT_TTL_MS, type GiftEvent, type GiftId } from '@table21/protocol';
import type { Db } from './db.ts';
import { newId } from './util.ts';

export const GIFT_LIMITS = { minIntervalMs: 6_000, perHour: 30 };

export type GiftResult = { ok: true; event: GiftEvent; duplicate: boolean } | { ok: false; error: 'rate_limited' | 'forbidden' | 'not_found' };

interface Row {
  id: string;
  sender_id: string;
  recipient_id: string;
  gift_id: GiftId;
  created_at: Date;
  expires_at: Date;
}

const toEvent = (r: Row): GiftEvent => ({
  id: r.id,
  fromId: r.sender_id,
  toId: r.recipient_id,
  giftId: r.gift_id,
  at: new Date(r.created_at).getTime(),
  expiresAt: new Date(r.expires_at).getTime(),
});

/**
 * Records a gift once. The client event id makes retries idempotent: a repeated send returns the stored
 * event with duplicate=true and is not broadcast again. Rate limits are checked under a per-sender lock.
 */
export async function sendGift(
  db: Db,
  input: { roomId: string; senderId: string; recipientId: string; giftId: GiftId; eventId: string; now: number },
): Promise<GiftResult> {
  if (input.senderId === input.recipientId) return { ok: false, error: 'forbidden' };
  return db.tx(async (q) => {
    await q.query('select pg_advisory_xact_lock(hashtext($1))', [`gift:${input.senderId}`]);
    const dup = await q.query<Row>('select * from gift_events where sender_id = $1 and client_event_id = $2', [input.senderId, input.eventId]);
    if (dup[0]) return { ok: true as const, event: toEvent(dup[0]), duplicate: true };
    const now = new Date(input.now);
    const recent = await q.query<{ last: Date | null; hour: number }>(
      `select max(created_at) as last, count(*) filter (where created_at > $2)::int as hour from gift_events where sender_id = $1`,
      [input.senderId, new Date(input.now - 3600_000)],
    );
    const last = recent[0]?.last ? new Date(recent[0].last).getTime() : 0;
    if (input.now - last < GIFT_LIMITS.minIntervalMs || (recent[0]?.hour ?? 0) >= GIFT_LIMITS.perHour) return { ok: false as const, error: 'rate_limited' as const };
    const rows = await q.query<Row>(
      `insert into gift_events(id, room_id, sender_id, recipient_id, gift_id, client_event_id, created_at, expires_at)
       values ($1,$2,$3,$4,$5,$6,$7,$8) returning *`,
      [newId('gf'), input.roomId, input.senderId, input.recipientId, input.giftId, input.eventId, now, new Date(input.now + GIFT_TTL_MS)],
    );
    return { ok: true as const, event: toEvent(rows[0]), duplicate: false };
  });
}

export async function activeGifts(db: Db, roomId: string, now: number): Promise<GiftEvent[]> {
  const rows = await db.query<Row>('select * from gift_events where room_id = $1 and expires_at > $2 order by created_at desc limit 24', [roomId, new Date(now)]);
  return rows.map(toEvent);
}
