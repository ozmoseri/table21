import type { PublicCard, PublicHand, RoomSnapshot } from '@table21/protocol';
import { Table } from '../components/Table.tsx';
import { ActionButtons, ResultPanel } from '../components/Table.tsx';
import { renderTimeline, type Sfx } from '../sound.ts';

/**
 * Sound demo (lab builds only): ten rounds scheduled with the same timings as the table (bet, 4-card deal at the
 * presentation stagger, turn chime after the deal, reveal, dealer draws, result after the last card). Rendered offline
 * into a WAV so it can be listened to, and so overlap can be measured without a person listening.
 */
export function demoTimeline(): { events: { s: Sfx; t: number }[]; seconds: number } {
  const outcomes: Sfx[] = ['win', 'lose', 'chip', 'blackjack', 'win', 'win', 'lose', 'chip', 'win', 'blackjack'];
  const ev: { s: Sfx; t: number }[] = [];
  let t = 0.3;
  outcomes.forEach((result, r) => {
    ev.push({ s: 'chip', t }, { s: 'bet', t: t + 0.28 });
    const deal = t + 0.9;
    for (let i = 0; i < 4; i++) ev.push({ s: 'deal', t: deal + i * 0.15 });
    const afterDeal = deal + 3 * 0.15 + 0.23 + 0.06;
    let x = afterDeal;
    if (result !== 'blackjack') {
      ev.push({ s: 'turn', t: x });
      x += 1.1;
      if (r % 3 === 1) {
        ev.push({ s: 'tap', t: x }, { s: 'deal', t: x + 0.1 });
        x += 0.8;
      }
      ev.push({ s: 'tap', t: x });
      x += 0.35;
    }
    ev.push({ s: 'flip', t: x });
    x += 0.5;
    if (r % 2 === 0) {
      ev.push({ s: 'deal', t: x });
      x += 0.45;
    }
    ev.push({ s: result, t: x + 0.06 });
    if (r === 4) ev.push({ s: 'gift', t: x + 1.2 });
    t = x + 2.2;
  });
  return { events: ev, seconds: t + 0.5 };
}

function wav(buf: AudioBuffer): string {
  const d = buf.getChannelData(0);
  const out = new DataView(new ArrayBuffer(44 + d.length * 2));
  const w = (o: number, s: string) => [...s].forEach((ch, i) => out.setUint8(o + i, ch.charCodeAt(0)));
  w(0, 'RIFF'); out.setUint32(4, 36 + d.length * 2, true); w(8, 'WAVE'); w(12, 'fmt ');
  out.setUint32(16, 16, true); out.setUint16(20, 1, true); out.setUint16(22, 1, true); out.setUint32(24, buf.sampleRate, true);
  out.setUint32(28, buf.sampleRate * 2, true); out.setUint16(32, 2, true); out.setUint16(34, 16, true); w(36, 'data'); out.setUint32(40, d.length * 2, true);
  for (let i = 0; i < d.length; i++) out.setInt16(44 + i * 2, Math.max(-1, Math.min(1, d[i])) * 0x7fff, true);
  let bin = '';
  const bytes = new Uint8Array(out.buffer);
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(bin);
}

if (typeof window !== 'undefined')
  (window as any).__t21RenderDemo = async () => {
    const { events, seconds } = demoTimeline();
    const { buffer, played } = await renderTimeline(events, seconds);
    return { wav: wav(buffer), requested: events.length, played: played.length, seconds, timeline: played };
  };

/**
 * Design lab: static fixture snapshots for layout review and screenshots (1, 3 and 6 players, four split
 * hands, gifts, reactions). Only included in builds made with VITE_LAB=1 (the e2e build). It never talks
 * to the server, never touches the engine and holds no real game state.
 */
let slot = 0;
const c = (r: string, s: string): PublicCard => ({ id: `lab:${slot++}`, rank: r as any, suit: s as any });
const hidden = (): PublicCard => ({ id: `lab:${slot++}`, hidden: true });
function hand(cards: PublicCard[], total: number, extra: Partial<PublicHand> = {}): PublicHand {
  return { cards, total, soft: false, stakeUnits: 200, status: 'active', doubled: false, fromSplit: false, outcome: null, returnedUnits: null, ...extra };
}
const names = ['עוז', 'דניאל בן שושן', 'Maya', 'רוני אלמוג-כהן', 'Lior', 'נועה'];
const avatars = ['amber', 'cobalt', 'sage', 'coral', 'plum', 'rose'] as const;

function fixture(kind: string): RoomSnapshot {
  slot = 0;
  const n = kind === 'solo' || kind === 'split21' ? 1 : kind === 'three' ? 3 : 6;
  const ids = Array.from({ length: n }, (_, i) => `user_lab_${i}`);
  const seatsHands: PublicHand[][] = ids.map((_, i) => {
    if (i === 0 && kind === 'split')
      return [
        hand([c('8', 'S'), c('3', 'H'), c('10', 'D')], 21, { status: 'stood', fromSplit: true, doubled: true, stakeUnits: 400 }),
        hand([c('8', 'H'), c('9', 'C')], 17, { status: 'stood', fromSplit: true }),
        hand([c('8', 'D'), c('A', 'S')], 19, { status: 'active', fromSplit: true, soft: true }),
        hand([c('8', 'C')], 8, { status: 'waiting', fromSplit: true }),
      ];
    if (i === 0 && kind === 'split21')
      // The hand from Oz's phone screenshot: split aces, A+Q is 21 (not a natural) and pushes the dealer's 6+5+10.
      return [
        hand([c('A', 'C'), c('Q', 'D')], 21, { status: 'stood', fromSplit: true, stakeUnits: 100 }),
        hand([c('A', 'S'), c('4', 'H')], 15, { status: 'stood', fromSplit: true, soft: true, stakeUnits: 100 }),
      ];
    if (i === 0) return [hand([c('K', 'H'), c('7', 'S')], 17)];
    const pairs: [string, string][][] = [
      [['Q', 'S'], ['J', 'D']],
      [['5', 'C'], ['6', 'H']],
      [['A', 'D'], ['K', 'C']],
      [['9', 'S'], ['9', 'H']],
      [['4', 'D'], ['7', 'C']],
    ];
    const p = pairs[(i - 1) % pairs.length];
    return [hand(p.map(([r, s]) => c(r, s)), 0, { status: 'waiting' })];
  });
  const at = Date.now();
  return {
    roomId: `lab-${kind}`,
    code: 'LAB000',
    version: 1,
    mode: 'casual',
    ownerId: ids[0],
    dealerUserId: null,
    settings: { stakes: [10, 25, 50, 100, 250], turnSeconds: 25, dealerMode: 'auto', rotateDealerEvery: 0, maxSeats: 6, betSeconds: 20, resultSeconds: 6 },
    phase: 'player_turns',
    roundNumber: 1,
    deadline: at + 18_000,
    serverTime: at,
    seats: ids.map((id, i) => ({ index: i, userId: id, name: names[i], avatar: avatars[i], connected: i !== 4, betUnits: 0, sittingOut: false })),
    members: ids.map((id, i) => ({ userId: id, name: names[i], avatar: avatars[i], connected: true, role: 'player' as const })),
    round: {
      roundId: 'lab',
      phase: 'player_turns',
      seats: ids.map((id, i) => ({ seatId: String(i), playerId: id, hands: seatsHands[i] })),
      dealer: { cards: [c('10', 'C'), hidden()], total: 10, soft: false, revealed: false },
      turn: { seat: 0, hand: kind === 'split' ? 2 : 0 },
      voidReason: null,
    },
    match: null,
    gifts:
      n > 1
        ? [
            { id: 'g1', fromId: ids[1], toId: ids[0], giftId: 'coffee', at, expiresAt: at + 45_000 },
            { id: 'g2', fromId: ids[0], toId: ids[1], giftId: 'rose', at, expiresAt: at + 45_000 },
          ]
        : [],
    you: { userId: ids[0], seatIndex: 0, availableUnits: 3600, legalActions: ['hit', 'stand', 'double'], isDealer: false, isOwner: true, canDealerStep: false },
  };
}

export function Lab({ kind }: { kind: string }) {
  const snap = fixture(kind === 'split' ? 'split' : kind);
  const settled: RoomSnapshot | null =
    kind === 'split21'
      ? {
          ...snap,
          phase: 'results',
          round: {
            ...snap.round!,
            phase: 'settled',
            turn: null,
            dealer: { cards: [c('6', 'D'), c('5', 'D'), c('10', 'C')], total: 21, soft: false, revealed: true },
            seats: snap.round!.seats.map((s) => ({
              ...s,
              hands: s.hands.map((h, j) => ({ ...h, outcome: j === 0 ? ('push' as const) : ('lose' as const), returnedUnits: j === 0 ? 100 : 0 })),
            })),
          },
        }
      : kind === 'result'
      ? {
          ...snap,
          phase: 'results',
          round: {
            ...snap.round!,
            phase: 'settled',
            turn: null,
            dealer: { cards: [c('10', 'C'), c('7', 'H')], total: 17, soft: false, revealed: true },
            seats: snap.round!.seats.map((s, i) => ({
              ...s,
              hands: s.hands.map((h) => ({ ...h, status: 'stood' as const, outcome: i % 2 ? ('lose' as const) : ('win' as const), returnedUnits: i % 2 ? 0 : h.stakeUnits * 2 })),
            })),
          },
        }
      : null;
  const view = settled ?? snap;
  const reactions = kind === 'six' ? [{ userId: 'user_lab_2', name: 'Maya', reaction: 'card' as const, at: Date.now() + 60_000 }] : [];
  return (
    <div className="room" data-testid={`lab-${kind}`}>
      <div className="status-line">
        <span className="phase-text">{settled ? '' : 'תורך'}</span>
      </div>
      <Table snap={view} meId="user_lab_0" back="classic" theme="emerald" offset={0} dealer={{ name: 'דילר אוטומטי', presenter: false }} sessionKey={`lab-${kind}`} reactions={reactions} />
      <div className="controls">{settled ? <ResultPanel snap={view} meId="user_lab_0" /> : <ActionButtons legal={view.you.legalActions} onAction={() => {}} />}</div>
    </div>
  );
}
