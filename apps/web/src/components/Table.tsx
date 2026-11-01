import { useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import type { GiftEvent, PublicHand, PublicRoundSeat, ReactionEvent, RoomSnapshot, SeatView } from '@table21/protocol';
import type { PlayerAction } from '@table21/game-engine';
import { Card } from './Card.tsx';
import { Avatar, ChipStack, Coins, TimerRing, announce, flyChip } from './bits.tsx';
import { GiftIcon, REACTION_GLYPH } from './gifts.tsx';
import { REACTION_TEXT, getLocale, t, type Key } from '../i18n.ts';
import { buzz, play } from '../sound.ts';
import { PresentationContext, TablePresentation } from '../presentation.ts';
import { reducedMotion, subscribePrefs } from '../prefs.ts';

export interface DealerInfo {
  name: string;
  avatar?: string;
  presenter: boolean;
  offline?: boolean;
  userId?: string;
}

/**
 * "8 / 18" only while the hand can still change. Once a hand is finished (stood, settled, doubled, bust) the final
 * best total is shown, so a settled A+7 reads 18 and not 8 / 18.
 */
export function totalLabel(h: Pick<PublicHand, 'total' | 'soft' | 'cards'> & Partial<Pick<PublicHand, 'status' | 'outcome'>>, finished = false) {
  const done = finished || h.outcome != null || (h.status != null && h.status !== 'active' && h.status !== 'waiting');
  if (!done && h.soft && h.total < 21 && h.cards.length < 6) return `${h.total - 10} / ${h.total}`;
  return String(h.total);
}

function outcomeKey(h: PublicHand): Key | null {
  if (h.outcome) return h.outcome as Key;
  if (h.status === 'bust') return 'bust';
  if (h.status === 'blackjack') return 'blackjack';
  return null;
}

const statusKey = (h: PublicHand): Key | null => outcomeKey(h) ?? (h.status === 'stood' ? 'stood' : h.status === 'active' ? 'playing' : null);

/** "Your turn · hand 2 of 3 · you have 17": the turn is stated in words, not only by the highlight. */
export function myTurnText(snap: RoomSnapshot, meId: string): string {
  const seat = snap.round?.seats.find((x) => x.playerId === meId);
  const idx = snap.round?.turn?.hand ?? 0;
  const h = seat?.hands[idx];
  if (!seat || !h) return t('yourTurn');
  const total = totalLabel(h);
  return seat.hands.length > 1 ? t('yourTurnHand', { n: idx + 1, m: seat.hands.length, total }) : t('yourTurnTotal', { total });
}

/** A+10-value after a split is an ordinary 21 under our rules, not a natural. The UI says so explicitly. */
export const isSplit21 = (h: Pick<PublicHand, 'fromSplit' | 'cards' | 'total'>) => h.fromSplit && h.cards.length === 2 && h.total === 21;

function HandView({ hand, back, size, active }: { hand: PublicHand; back: string; size: 'sm' | 'md' | 'lg'; active?: boolean }) {
  const ok = outcomeKey(hand);
  return (
    <div className={`hand hand-${size} ${active ? 'active' : ''} ${hand.outcome ? `out-${hand.outcome}` : ''} ${hand.status === 'bust' ? 'out-lose' : ''}`}>
      <div className="hand-cards">
        {hand.cards.map((c) => (
          <Card key={c.id} card={c} back={back} size={size} />
        ))}
      </div>
      <div className="hand-meta">
        <span className="total num">{totalLabel(hand)}</span>
        {size !== 'sm' && <ChipStack units={hand.stakeUnits} small />}
        {ok && <span className={`badge b-${ok}`}>{t(ok)}</span>}
        {hand.outcome === 'blackjack' || hand.status === 'blackjack' ? (
          <span className="natural-tag" data-testid="natural">
            {t('natural')}
          </span>
        ) : null}
        {hand.doubled && <span className="double-tag">{t('doubledTag')}</span>}
        {isSplit21(hand) && (
          <span className="split21-tag" data-testid="split21">
            {t('split21')}
            <span className="sr-only">. {t('split21Why')}</span>
          </span>
        )}
      </div>
    </div>
  );
}

/** Split hands: the hand in focus stays large; the others become numbered chips with total and state. */
function SplitHands({ hands, back, activeIndex }: { hands: PublicHand[]; back: string; activeIndex: number | null }) {
  const [picked, setPicked] = useState<number | null>(null);
  useEffect(() => setPicked(null), [activeIndex]);
  const focus = picked ?? activeIndex ?? Math.max(0, hands.findIndex((h) => h.status === 'active' || h.status === 'waiting'));
  return (
    <div className="split">
      <span className={`hand-label ${activeIndex === focus ? 'is-turn' : ''}`} data-testid="hand-label">
        {t('handOf', { n: focus + 1, m: hands.length })}
        {activeIndex === focus ? ` · ${t('playingNow')}` : ''}
      </span>
      <HandView hand={hands[focus]} back={back} size={hands.length > 2 ? 'md' : 'lg'} active={activeIndex === focus} />
      <div className="hand-chips" role="tablist" aria-label="hands">
        {hands.map((h, i) => {
          const k = statusKey(h);
          return (
            <button
              key={i}
              role="tab"
              aria-selected={i === focus}
              aria-current={i === activeIndex ? 'step' : undefined}
              aria-label={`${t('handOf', { n: i + 1, m: hands.length })}, ${totalLabel(h)}${k ? `, ${t(k)}` : ''}`}
              className={`hand-chip ${i === focus ? 'on' : ''} ${i === activeIndex ? 'turn' : ''} ${h.outcome ? `out-${h.outcome}` : ''}`}
              onClick={() => setPicked(i)}
            >
              <span className="hc-n num">{i + 1}</span>
              <span className="hc-t num">{totalLabel(h)}</span>
              {k && <span className="hc-s">{t(k)}</span>}
            </button>
          );
        })}
      </div>
    </div>
  );
}

function GiftBadges({ gifts }: { gifts: GiftEvent[] }) {
  if (!gifts.length) return null;
  return (
    <span className="gift-badges" aria-hidden="true">
      {[...gifts].sort((a, b) => b.at - a.at).slice(0, 1).map((g) => (
        <span key={g.id} className="gift-badge">
          <GiftIcon id={g.giftId} size={20} />
        </span>
      ))}
    </span>
  );
}

function ReactionBubble({ r }: { r?: ReactionEvent }) {
  if (!r) return null;
  return (
    <span className="react-bubble" key={`${r.userId}${r.at}`} role="status">
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <path d={REACTION_GLYPH[r.reaction]} />
      </svg>
      {REACTION_TEXT[r.reaction]?.[getLocale()]}
    </span>
  );
}

function SeatCompact({
  seat,
  rs,
  active,
  snap,
  back,
  offset,
  onTap,
  style,
  gifts,
  reaction,
}: {
  seat: SeatView;
  rs?: PublicRoundSeat;
  active: boolean;
  snap: RoomSnapshot;
  back: string;
  offset: number;
  onTap?: () => void;
  style?: CSSProperties;
  gifts: GiftEvent[];
  reaction?: ReactionEvent;
}) {
  const turnHand = active ? (snap.round?.turn?.hand ?? 0) : 0;
  const shown = rs ? (rs.hands.length > 2 ? [turnHand, ...rs.hands.map((_, i) => i).filter((i) => i !== turnHand)].slice(0, 1) : rs.hands.map((_, i) => i)) : [];
  return (
    <button className={`seat ${active ? 'is-active' : ''} ${!seat.connected ? 'is-offline' : ''}`} onClick={onTap} aria-label={seat.name} data-uid={seat.userId} style={style}>
      <ReactionBubble r={reaction} />
      <span className="seat-avatar">
        <Avatar id={seat.avatar} size={40} />
        {active && snap.deadline && <TimerRing deadline={snap.deadline} total={snap.settings.turnSeconds * 1000} offset={offset} />}
        <GiftBadges gifts={gifts} />
      </span>
      <bdi className="seat-name">{seat.name}</bdi>
      {!seat.connected && <span className="seat-flag">{t('offline')}</span>}
      {rs ? (
        <span className="seat-hands">
          {shown.map((i) => (
            <HandView key={i} hand={rs.hands[i]} back={back} size="sm" active={active && turnHand === i} />
          ))}
          {rs.hands.length > shown.length && <span className="more-hands num">+{rs.hands.length - shown.length}</span>}
        </span>
      ) : seat.betUnits > 0 ? (
        <ChipStack units={seat.betUnits} small />
      ) : (
        <span className="seat-idle" />
      )}
    </button>
  );
}

/** Seats sit on a shallow arc: outer seats a little lower, like chairs around a real table. */
function arcStyle(i: number, n: number): CSSProperties {
  if (n < 3) return {};
  const c = (n - 1) / 2;
  const d = (i - c) / c;
  return { ['--arc-y' as string]: `${Math.round(d * d * 22)}px` };
}

interface GiftFlight {
  id: string;
  giftId: GiftEvent['giftId'];
  from: { x: number; y: number };
  to: { x: number; y: number };
}

export function Table({
  snap,
  meId,
  back,
  theme,
  offset,
  dealer,
  sessionKey,
  resyncKey = 0,
  onSeatTap,
  onDealerTap,
  overlay,
  reactions = [],
  muted,
}: {
  snap: RoomSnapshot;
  meId: string;
  back: string;
  theme: string;
  offset: number;
  dealer: DealerInfo;
  /** One presentation controller per table session (room id or local game instance). */
  sessionKey: string;
  /** Increments on reconnect: the next render hydrates instead of replaying. */
  resyncKey?: number;
  onSeatTap?: (seat: SeatView) => void;
  onDealerTap?: () => void;
  overlay?: ReactNode;
  reactions?: ReactionEvent[];
  muted?: Set<string>;
}) {
  const presentation = useMemo(() => new TablePresentation(), [sessionKey]);
  useEffect(() => () => presentation.dispose(), [presentation]);
  const lastResync = useRef(resyncKey);
  if (lastResync.current !== resyncKey) {
    lastResync.current = resyncKey;
    presentation.resync();
  }
  useEffect(
    () =>
      subscribePrefs(() => {
        if (reducedMotion()) presentation.finishAll();
      }),
    [presentation],
  );

  const feltRef = useRef<HTMLElement>(null);
  useLayoutEffect(() => {
    presentation.commit(document.getElementById('shoe')?.getBoundingClientRect() ?? null);
  });

  const round = snap.round;
  const rsBy = new Map(round?.seats.map((s, i) => [s.playerId, { s, i }]) ?? []);
  const turnPlayer = round?.turn ? round.seats[round.turn.seat]?.playerId : null;
  const mySeat = snap.seats.find((s) => s.userId === meId);
  const others = snap.seats.filter((s) => s.userId !== meId);
  const mine = mySeat ? rsBy.get(mySeat.userId)?.s : undefined;
  const myTurn = turnPlayer === meId;
  const isMuted = (uid: string) => !!muted?.has(uid) || !!muted?.has('*');

  // Gifts: those present at hydrate show in place; new ones fly from sender to recipient first.
  const gifts = (snap.gifts ?? []).filter((g) => !isMuted(g.fromId));
  const seenGifts = useRef<{ key: string; ids: Set<string> } | null>(null);
  const [flights, setFlights] = useState<GiftFlight[]>([]);
  useLayoutEffect(() => {
    // New session or reconnect: gifts already on the table are shown in place, not flown again.
    if (!seenGifts.current || seenGifts.current.key !== `${sessionKey}:${resyncKey}`) {
      seenGifts.current = { key: `${sessionKey}:${resyncKey}`, ids: new Set(gifts.map((g) => g.id)) };
      setFlights([]);
      return;
    }
    const seen = seenGifts.current.ids;
    const fresh = gifts.filter((g) => !seen.has(g.id));
    if (!fresh.length) return;
    fresh.forEach((g) => seen.add(g.id));
    const felt = feltRef.current;
    if (!felt || reducedMotion()) return;
    const box = felt.getBoundingClientRect();
    const center = (uid: string) => {
      const el = (felt.querySelector(`[data-uid="${uid}"] .seat-avatar, [data-uid="${uid}"] .gift-anchor`) ??
        felt.querySelector(`[data-uid="${uid}"]`)) as HTMLElement | null;
      if (!el) return null;
      const r = el.getBoundingClientRect();
      return { x: r.left + r.width / 2 - box.left, y: r.top + r.height / 2 - box.top };
    };
    const add: GiftFlight[] = [];
    for (const g of fresh) {
      const to = center(g.toId);
      if (!to) continue;
      add.push({ id: g.id, giftId: g.giftId, from: center(g.fromId) ?? { x: box.width / 2, y: 0 }, to });
    }
    if (add.length) {
      setFlights((f) => [...f, ...add]);
      play('gift');
    }
  }, [gifts.map((g) => g.id).join(','), sessionKey, resyncKey]);

  const flying = new Set(flights.map((f) => f.id));
  const giftsFor = (uid: string) => gifts.filter((g) => g.toId === uid && !flying.has(g.id));
  const now = Date.now();
  const reactionOf = (uid: string) =>
    isMuted(uid) ? undefined : [...reactions].reverse().find((r) => r.userId === uid && now - r.at < 2800);

  const lastTurn = useRef<string | null>(null);
  useEffect(() => {
    const key = myTurn && round ? `${round.roundId}:${round.turn?.hand}` : null;
    if (key && key !== lastTurn.current) {
      presentation.afterSequence(() => {
        play('turn');
        buzz(20);
      });
      announce(t('yourTurn'));
    }
    lastTurn.current = key;
  }, [myTurn, round?.roundId, round?.turn?.hand]);

  const revealed = round?.dealer.revealed ?? false;
  const lastRevealed = useRef(revealed);
  useEffect(() => {
    if (revealed && !lastRevealed.current) presentation.sound('flip');
    lastRevealed.current = revealed;
  }, [revealed, round?.roundId]);

  const settledKey = round && (round.phase === 'settled' || round.phase === 'voided') ? round.roundId : null;
  const lastSettled = useRef<string | null>(null);
  const [celebrate, setCelebrate] = useState<null | 'bj' | 'win' | 'push' | 'lose'>(null);
  useEffect(() => {
    if (!settledKey || settledKey === lastSettled.current) return;
    lastSettled.current = settledKey;
    if (!mine) return;
    // A result that was already there when the table hydrated (reload, reconnect, resume) is shown, never re-celebrated.
    if (presentation.hydratedLast) return;
    const net = mine.hands.reduce((a, h) => a + (h.returnedUnits ?? 0) - h.stakeUnits, 0);
    const bj = mine.hands.some((h) => h.outcome === 'blackjack');
    // The result sound waits until the dealer's last card has landed.
    presentation.sound(bj ? 'blackjack' : net > 0 ? 'win' : net < 0 ? 'lose' : 'chip');
    presentation.afterSequence(() => announce(`${net > 0 ? t('resultUp') : net < 0 ? t('resultDown') : t('resultEven')} ${net / 2}`));
    // Celebration scale follows the event: natural blackjack 950 ms, win 600 ms, push none, loss a calm settle.
    const kind = bj ? 'bj' : net > 0 ? 'win' : net < 0 ? 'lose' : 'push';
    presentation.afterSequence(() => setCelebrate(kind));
  }, [settledKey]);
  useEffect(() => {
    if (!celebrate) return;
    const id = setTimeout(() => setCelebrate(null), celebrate === 'bj' ? 1100 : 750);
    return () => clearTimeout(id);
  }, [celebrate]);

  const myActiveHand = myTurn ? (round?.turn?.hand ?? null) : null;
  const seatCount = others.length;
  const layout = seatCount === 0 ? 'is-solo' : seatCount <= 2 ? 'few-seats' : 'many-seats';

  return (
    <PresentationContext.Provider value={presentation}>
      <section ref={feltRef} className={`felt theme-${theme} ${layout} ${round ? '' : 'no-round'} ${celebrate ? `celebrate-${celebrate}` : ''}`} aria-label="table" data-seats={seatCount + (mySeat ? 1 : 0)}>
        <div className="felt-lip" aria-hidden="true" />
        <div className="dealer-zone" dir="ltr">
          <button className="dealer-id" onClick={onDealerTap} data-uid={dealer.userId ?? 'dealer'} disabled={!onDealerTap}>
            <span className="seat-avatar">
              <Avatar id={dealer.avatar} dealer={!dealer.avatar} size={44} ring={snap.phase === 'dealer_turn'} />
              {dealer.userId && <GiftBadges gifts={giftsFor(dealer.userId)} />}
            </span>
            <span className="dealer-text">
              <bdi className="dealer-name">{dealer.name}</bdi>
              {round && round.dealer.total !== null && (
                <span className="total num">{round.dealer.revealed ? totalLabel({ total: round.dealer.total, soft: round.dealer.soft, cards: round.dealer.cards }, round.phase === 'settled' || snap.phase === 'dealer_turn') : round.dealer.total}</span>
              )}
            </span>
            {dealer.userId && <ReactionBubble r={reactionOf(dealer.userId)} />}
          </button>
          <div className="dealer-cards">
            {round?.dealer.cards.map((c) => (
              <Card key={c.id} card={c} back={back} size="md" />
            ))}
          </div>
          <div id="shoe" className="shoe" aria-hidden="true">
            <i style={{ backgroundImage: `url(/art/backs/${back}.svg)` }} />
          </div>
        </div>

        {others.length > 0 && (
          <div className="others" dir="ltr">
            {others.map((s, i) => (
              <SeatCompact
                key={s.userId}
                seat={s}
                rs={rsBy.get(s.userId)?.s}
                active={turnPlayer === s.userId}
                snap={snap}
                back={back}
                offset={offset}
                onTap={() => onSeatTap?.(s)}
                style={arcStyle(i, others.length)}
                gifts={giftsFor(s.userId)}
                reaction={reactionOf(s.userId)}
              />
            ))}
          </div>
        )}

        <div className={`me-zone ${myTurn ? 'is-active' : ''}`} dir="ltr" data-uid={meId}>
          <ReactionBubble r={reactionOf(meId)} />
          {mine ? (
            mine.hands.length > 1 ? (
              <SplitHands hands={mine.hands} back={back} activeIndex={myActiveHand} />
            ) : (
              <div className="my-hands">
                <HandView hand={mine.hands[0]} back={back} size="lg" />
              </div>
            )
          ) : mySeat ? (
            <div className={`bet-spot ${mySeat.betUnits > 0 ? 'has-bet' : ''}`} data-bet-spot data-testid="bet-spot">
              {mySeat.betUnits > 0 ? <ChipStack key={mySeat.betUnits} units={mySeat.betUnits} /> : <span className="bet-hint">{t('betHint')}</span>}
            </div>
          ) : null}
          <span className="gift-anchor">{mySeat && <GiftBadges gifts={giftsFor(meId)} />}</span>
          {mySeat && myTurn && snap.deadline && (
            <div className="my-timer">
              <TimerRing deadline={snap.deadline} total={snap.settings.turnSeconds * 1000} offset={offset} />
            </div>
          )}
        </div>

        {flights.map((f) => (
          <GiftFlightView key={f.id} f={f} track={(a) => presentation.track(a)} done={() => setFlights((x) => x.filter((y) => y.id !== f.id))} />
        ))}
        {overlay}
      </section>
    </PresentationContext.Provider>
  );
}

function GiftFlightView({ f, track, done }: { f: GiftFlight; track: (a: Animation) => void; done: () => void }) {
  const ref = useRef<HTMLSpanElement>(null);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const dx = f.to.x - f.from.x;
    const dy = f.to.y - f.from.y;
    const a = el.animate(
      [
        { transform: 'translate(-50%, -50%) scale(.6)', opacity: 0 },
        { transform: `translate(calc(-50% + ${dx * 0.5}px), calc(-50% + ${dy * 0.5 - 40}px)) scale(1.25)`, opacity: 1, offset: 0.5 },
        { transform: `translate(calc(-50% + ${dx}px), calc(-50% + ${dy}px)) scale(.8)`, opacity: 1 },
      ],
      { duration: 620, easing: 'cubic-bezier(.3,.7,.3,1)', fill: 'forwards' },
    );
    track(a);
    a.finished.then(done, done);
  }, []);
  return (
    <span ref={ref} className="gift-flight" style={{ left: f.from.x, top: f.from.y }} aria-hidden="true">
      <GiftIcon id={f.giftId} size={34} />
    </span>
  );
}

/**
 * The four decisions always keep the same slots (hit, stand, double, split), so a button never moves under the thumb
 * between turns; a decision that is not legal now stays visible but disabled. After one press every button locks until
 * the table answers (legal actions change) or 2.5 s pass, so a double tap cannot send two decisions. The server is
 * idempotent anyway (commandId + exact version).
 */
export function ActionButtons({ legal, disabled, onAction }: { legal: PlayerAction[]; disabled?: boolean; onAction: (a: PlayerAction) => void }) {
  const order: PlayerAction[] = ['hit', 'stand', 'double', 'split'];
  const [locked, setLocked] = useState(false);
  const legalKey = legal.join(',');
  useEffect(() => {
    setLocked(false);
  }, [legalKey]);
  useEffect(() => {
    if (!locked) return;
    const id = setTimeout(() => setLocked(false), 2500);
    return () => clearTimeout(id);
  }, [locked]);
  const fire = (a: PlayerAction) => {
    if (locked || disabled || !legal.includes(a)) return;
    setLocked(true);
    buzz(8);
    play('tap');
    onAction(a);
  };
  useEffect(() => {
    const keys: Record<string, PlayerAction> = { h: 'hit', s: 'stand', d: 'double', p: 'split' };
    const f = (e: KeyboardEvent) => {
      const a = keys[e.key.toLowerCase()];
      if (a && !e.repeat && !(e.target instanceof HTMLInputElement)) fire(a);
    };
    addEventListener('keydown', f);
    return () => removeEventListener('keydown', f);
  });
  return (
    <div className="actions" data-locked={locked || undefined}>
      {order.map((a) => (
        <button key={a} className={`btn act act-${a}`} disabled={disabled || locked || !legal.includes(a)} aria-disabled={!legal.includes(a) || undefined} onClick={() => fire(a)}>
          {t(a)}
        </button>
      ))}
    </div>
  );
}

export function StakePicker({
  stakes,
  available,
  current,
  onPick,
  disabled,
}: {
  stakes: number[];
  available: number;
  current: number;
  onPick: (coins: number) => void;
  disabled?: boolean;
}) {
  return (
    <div className="stakes" dir="ltr" role="group" aria-label={t('stake')}>
      {stakes.map((c, i) => {
        const can = c * 2 <= available + current;
        return (
          <button
            key={c}
            className={`stake-chip tier-${Math.min(i + 1, 5)} ${current === c * 2 ? 'on' : ''}`}
            disabled={disabled || !can}
            onClick={(e) => {
              play('chip');
              buzz(6);
              flyChip(e.currentTarget, `t${Math.min(i + 1, 5)}`);
              onPick(c);
            }}
            aria-pressed={current === c * 2}
            aria-label={`${c}`}
          >
            <span className="num">{c}</span>
          </button>
        );
      })}
    </div>
  );
}

export function ResultPanel({ snap, meId }: { snap: RoomSnapshot; meId: string }) {
  const round = snap.round;
  if (!round) return null;
  if (round.phase === 'voided')
    return (
      <div className="result-panel">
        <p>{t('voided')}</p>
      </div>
    );
  const mine = round.seats.find((s) => s.playerId === meId);
  if (!mine) return null;
  const rows = mine.hands.map((h) => ({ h, stake: h.stakeUnits, ret: h.returnedUnits ?? 0, net: (h.returnedUnits ?? 0) - h.stakeUnits }));
  const stake = rows.reduce((a, r) => a + r.stake, 0);
  const ret = rows.reduce((a, r) => a + r.ret, 0);
  const net = ret - stake;
  const label = (h: PublicHand) => (h.outcome === 'blackjack' ? t('natural') : h.outcome === 'push' ? t('pushReturned') : t((h.outcome ?? 'push') as Key));
  const split = rows.length > 1;
  return (
    <div className={`result-panel ${net > 0 ? 'pos' : net < 0 ? 'neg' : 'even'}`} data-testid="result-panel" data-net={net}>
      <p className="result-head" data-testid="result-head">
        {net > 0 ? t('resultUp') : net < 0 ? t('resultDown') : t('resultEven')}
      </p>
      {split ? (
        <table className="result-table" data-testid="result-table">
          <thead>
            <tr>
              <th scope="col">{t('hand')}</th>
              <th scope="col">{t('outcome')}</th>
              <th scope="col">{t('stake')}</th>
              <th scope="col">{t('returned')}</th>
              <th scope="col">{t('netShort')}</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r, i) => (
              <tr key={i} className={`out-${r.h.outcome}`}>
                <th scope="row" className="num">
                  {i + 1}
                </th>
                <td>
                  <span className={`badge b-${r.h.outcome}`}>{label(r.h)}</span>
                  {isSplit21(r.h) && <span className="split21-tag">21</span>}
                </td>
                <td>
                  <Coins units={r.stake} />
                </td>
                <td>
                  <Coins units={r.ret} />
                </td>
                <td className="net">
                  <Coins units={r.net} sign />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : (
        <div className="result-hands">
          <span className={`badge b-${rows[0].h.outcome}`}>{label(rows[0].h)}</span>
        </div>
      )}
      {mine.hands.some(isSplit21) && (
        <p className="split21-note" data-testid="split21-note">
          <b>{t('split21')}.</b> {t('split21Why')}
        </p>
      )}
      <dl className="result-nums">
        <div>
          <dt>{split ? t('stakeTotal') : t('stake')}</dt>
          <dd>
            <Coins units={stake} />
          </dd>
        </div>
        <div>
          <dt>{t('returned')}</dt>
          <dd>
            <Coins units={ret} />
          </dd>
        </div>
        <div>
          <dt>{t('net')}</dt>
          <dd className="net">
            <Coins units={net} sign />
          </dd>
        </div>
      </dl>
    </div>
  );
}
