import { io, type Socket } from 'socket.io-client';
import { clientProtocol, markOutdated, CLIENT_BUILD } from './update.ts';
import type { Command, CommandResult, GiftEvent, GiftId, ReactionEvent, ReactionId, RoomSnapshot } from '@table21/protocol';

type DistributiveOmit<T, K extends keyof any> = T extends unknown ? Omit<T, K> : never;
export type Intent = DistributiveOmit<Command, 'commandId' | 'roomId' | 'expectedVersion' | 'roundId'>;

export interface RoomState {
  snapshot: RoomSnapshot | null;
  connection: 'connecting' | 'online' | 'reconnecting';
  pending: boolean;
  error: string | null;
  reactions: ReactionEvent[];
  restored: boolean;
  dupTab: boolean;
  /** Increments on every reconnect so the table hydrates instead of replaying old animations. */
  resyncKey: number;
}

const newCommandId = () => (crypto.randomUUID?.() ?? Math.random().toString(36).slice(2) + Date.now().toString(36)).replace(/-/g, '');

/**
 * Realtime room client. The server is authoritative: we only send intentions with a commandId and the
 * version we saw. Retries reuse the same commandId so a lost ack never double-applies. On every reconnect
 * we rejoin and take the full snapshot, discarding anything older than what we already rendered.
 */
export class RoomClient {
  private socket: Socket;
  private subs = new Set<() => void>();
  state: RoomState = { snapshot: null, connection: 'connecting', pending: false, error: null, reactions: [], restored: false, dupTab: false, resyncKey: 0 };
  private wasOnline = false;
  private bc: BroadcastChannel | null = null;

  constructor(public code: string) {
    // The protocol travels in the handshake: an outdated client can watch and resync, but the server refuses its actions.
    this.socket = io({ path: '/socket.io', transports: ['websocket', 'polling'], withCredentials: true, reconnectionDelayMax: 4000, auth: { protocol: clientProtocol(), build: CLIENT_BUILD } });
    this.socket.on('connect', () => void this.join());
    this.socket.on('disconnect', () => this.set({ connection: 'reconnecting' }));
    this.socket.on('connect_error', () => this.set({ connection: this.wasOnline ? 'reconnecting' : 'connecting' }));
    this.socket.on('room:state', (s: RoomSnapshot) => this.accept(s));
    this.socket.on('room:gift', (g: GiftEvent) => {
      const snap = this.state.snapshot;
      if (!snap) return;
      this.set({ snapshot: { ...snap, gifts: [g, ...(snap.gifts ?? []).filter((x) => x.id !== g.id)] } });
    });
    this.socket.on('room:reaction', (r: ReactionEvent) => {
      this.set({ reactions: [...this.state.reactions.filter((x) => Date.now() - x.at < 4000), r].slice(-6) });
    });
    try {
      this.bc = new BroadcastChannel(`t21-room-${code}`);
      this.bc.onmessage = (e) => {
        if (e.data === 'hello') this.bc?.postMessage('here');
        if (e.data === 'here' || e.data === 'hello') this.set({ dupTab: true });
      };
      this.bc.postMessage('hello');
    } catch {}
  }

  private set(p: Partial<RoomState>) {
    this.state = { ...this.state, ...p };
    this.subs.forEach((f) => f());
  }

  subscribe = (f: () => void) => {
    this.subs.add(f);
    return () => this.subs.delete(f);
  };
  getState = () => this.state;

  private accept(s: RoomSnapshot | undefined) {
    if (!s) return;
    const cur = this.state.snapshot;
    if (cur && cur.roomId === s.roomId && s.version < cur.version) return; // out of order
    this.set({ snapshot: s });
  }

  private async join() {
    const ack = await this.socket.timeout(6000).emitWithAck('room:join', { code: this.code }).catch(() => null);
    if (!ack) return;
    if (!ack.ok) {
      this.set({ error: ack.error ?? 'not_found', connection: 'online' });
      return;
    }
    const restored = this.wasOnline;
    this.wasOnline = true;
    this.set({ connection: 'online', error: null, restored, resyncKey: restored ? this.state.resyncKey + 1 : this.state.resyncKey });
    this.accept(ack.snapshot);
    if (restored) setTimeout(() => this.set({ restored: false }), 3000);
  }

  async send(intent: Intent): Promise<CommandResult> {
    const snap = this.state.snapshot;
    if (!snap) return { ok: false, error: 'not_found', version: 0 };
    const cmd = { ...intent, commandId: newCommandId(), roomId: snap.roomId, expectedVersion: snap.version, roundId: snap.round?.roundId ?? null } as Command;
    this.set({ pending: true });
    try {
      for (let attempt = 0; attempt < 3; attempt++) {
        const res: CommandResult | null = await this.socket.timeout(4000).emitWithAck('cmd', cmd).catch(() => null);
        if (res) {
          if (!res.ok && res.error === 'stale_version') await this.resync();
          if (!res.ok && res.error === 'client_outdated') markOutdated();
          return res;
        }
      }
      return { ok: false, error: 'timeout', version: snap.version };
    } finally {
      this.set({ pending: false });
    }
  }

  async resync() {
    const ack = await this.socket.timeout(4000).emitWithAck('room:sync', {}).catch(() => null);
    if (ack?.ok) this.accept(ack.snapshot);
  }

  /** Gifts are idempotent by event id: a retry after a lost ack is recorded and shown once. */
  async sendGift(recipientId: string, giftId: GiftId): Promise<{ ok: boolean; error?: string }> {
    const snap = this.state.snapshot;
    if (!snap) return { ok: false, error: 'not_found' };
    const payload = { roomId: snap.roomId, recipientId, giftId, eventId: newCommandId() };
    for (let attempt = 0; attempt < 3; attempt++) {
      const res = await this.socket.timeout(4000).emitWithAck('gift', payload).catch(() => null);
      if (res?.error === 'client_outdated') markOutdated();
      if (res) return res;
    }
    return { ok: false, error: 'timeout' };
  }

  react(reaction: ReactionId) {
    const snap = this.state.snapshot;
    if (snap) this.socket.emit('react', { roomId: snap.roomId, reaction });
  }

  close() {
    this.socket.emit('room:leave', {});
    this.socket.close();
    this.bc?.close();
  }
}
