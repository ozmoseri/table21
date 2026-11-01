import { useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import { backImage } from '../art.ts';
import type { GiftEvent, PublicHand, PublicRoundSeat, ReactionEvent, RoomSnapshot, SeatView } from '@table21/protocol';
import type { PlayerAction } from '@table21/game-engine';
import { Card } from './Card.tsx';
import { Avatar, ChipStack, Coins, TimerRing, announce, flyChip } from './bits.tsx';
import { GiftIcon, REACTION_GLYPH } from './gifts.tsx';
import { REACTION_TEXT, getLocale, t, type Key } from '../i18n.ts';
import { ambience, play } from '../sound.ts';
import { haptic } from '../haptics.ts';
import { CELEBRATE_MS, SKIPPABLE_AFTER_MS, SPARKLES, celebrationFor, type CelebrationKind } from '../fx/celebrate.ts';
import { PresentationContext, TablePresentation } from '../presentation.ts';
import type { ShownHand } from '../anim/timeline.ts';
import { reducedMotion, subscribePrefs, usePrefs } from '../prefs.ts';

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
  // A bust stays a bust after settlement: it says why the hand lost.
  if (h.status === 'bust') return 'bust';
  if (h.outcome) return h.outcome as Key;
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

/**
 * Lab builds only (VITE_LAB=1, never production): screenshot scripts may stretch the banner (sessionStorage
 * t21:fx-slow, with --dur-win / --dur-celebrate stretched the same way) to freeze a frame inside the hold.
 */
const reviewSlow = () => {
  if (import.meta.env.VITE_LAB !== '1') return 1;
  try {
    return Math.max(1, Number(sessionStorage.getItem('t21:fx-slow')) || 1);
  } catch {
    return 1;
  }
};
interface Celebration {
  kind: CelebrationKind | 'lose';
  net: number;
  at: number;
}

function HandView({ hand, back, size, active, ring, mine }: { hand: PublicHand; back: string; size: 'sm' | 'md' | 'lg'; active?: boolean; ring?: ReactNode; mine?: boolean }) {
  const ok = outcomeKey(hand);
  // My own bust reads as a plain fact, "עברת 21"; friends' seats keep the short word.
  const okText = ok === 'bust' && mine ? t('bustMine') : ok ? t(ok) : '';
  return (
    <div className={`hand hand-${size} ${active ? 'active' : ''} ${hand.outcome ? `out-${hand.outcome}` : ''} ${hand.status === 'bust' ? 'out-lose is-bust' : ''}`}>
      <div className="hand-cards">
        {hand.cards.map((c) => (
          <Card key={c.id} card={c} back={back} size={size} />
        ))}
      </div>
      <div className="hand-meta">
        {!(hand as ShownHand).totalHidden && (
          <span className={`total num ${ring ? 'has-ring' : ''} ${totalLabel(hand).includes('/') ? 'is-soft' : ''}`}>
            {totalLabel(hand)}
            {ring}
          </span>
        )}
        {size !== 'sm' && <ChipStack units={hand.stakeUnits} small />}
        {ok && ok !== 'blackjack' && <span className={`badge b-${ok}`}>{okText}</span>}
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
function SplitHands({ hands, back, activeIndex, ring }: { hands: PublicHand[]; back: string; activeIndex: number | null; ring?: ReactNode }) {
  const [picked, setPicked] = useState<number | null>(null);
  useEffect(() => setPicked(null), [activeIndex]);
  const focus = picked ?? activeIndex ?? Math.max(0, hands.findIndex((h) => h.status === 'active' || h.status === 'waiting'));
  return (
    <div className="split">
      <span className={`hand-label ${activeIndex === focus ? 'is-turn' : ''}`} data-testid="hand-label">
        {t('handOf', { n: focus + 1, m: hands.length })}
        {activeIndex === focus ? ` · ${t('playingNow')}` : ''}
      </span>
      <HandView hand={hands[focus]} back={back} size={hands.length > 2 ? 'md' : 'lg'} active={activeIndex === focus} ring={activeIndex === focus ? ring : undefined} mine />
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
  presentation: external,
  pending,
  onSkip,
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
  /** From useTableTimeline: the same controller that plays the visual event queue. */
  presentation?: TablePresentation;
  /** The visual queue is still playing (shows the skip button). */
  pending?: boolean;
  onSkip?: () => void;
}) {
  const own = useMemo(() => (external ? null : new TablePresentation()), [sessionKey, !!external]);
  useEffect(() => () => own?.dispose(), [own]);
  const presentation = (external ?? own)!;
  const lastResync = useRef(resyncKey);
  if (!external && lastResync.current !== resyncKey) {
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
    presentation.setRoot(feltRef.current);
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

  // Room tone (off by default) plays while a table is open; it stops when the table closes.
  const prefs = usePrefs();
  useEffect(() => {
    ambience(true);
    return () => ambience(false);
  }, [prefs.ambience, prefs.sound]);

  const lastTurn = useRef<string | null>(null);
  useEffect(() => {
    const key = myTurn && round ? `${round.roundId}:${round.turn?.hand}` : null;
    if (key && key !== lastTurn.current) {
      presentation.afterSequence(() => {
        play('turn');
        haptic('selection');
      });
      announce(t('yourTurn'));
    }
    lastTurn.current = key;
  }, [myTurn, round?.roundId, round?.turn?.hand]);

  // 5 s left on my turn: two short pulses, once per turn (DESIGN_BIBLE 7).
  useEffect(() => {
    if (!myTurn || !snap.deadline) return;
    const left = snap.deadline - (Date.now() + offset) - 5000;
    if (left <= 0) return;
    const id = setTimeout(() => haptic('turnWarning'), left);
    return () => clearTimeout(id);
  }, [myTurn, snap.deadline]);

  // My hand busts: one firmer pulse; the hand dims and its total shakes (CSS .is-bust).
  const bustKey = mine?.hands.map((h) => h.status === 'bust').join(',');
  const lastBust = useRef(bustKey);
  useEffect(() => {
    if (bustKey && lastBust.current !== undefined && bustKey !== lastBust.current && bustKey.split(',').some((b, i) => b === 'true' && lastBust.current?.split(',')[i] !== 'true')) haptic('bust');
    lastBust.current = bustKey;
  }, [bustKey]);

  const settledKey = round && (round.phase === 'settled' || round.phase === 'voided') ? round.roundId : null;
  const lastSettled = useRef<string | null>(null);
  const [celebrate, setCelebrate] = useState<null | Celebration>(null);
  useEffect(() => {
    if (!settledKey || settledKey === lastSettled.current) return;
    lastSettled.current = settledKey;
    if (!mine) return;
    // A result that was already there when the table hydrated (reload, reconnect, resume) is shown, never re-celebrated.
    if (presentation.hydratedLast) return;
    const net = mine.hands.reduce((a, h) => a + (h.returnedUnits ?? 0) - h.stakeUnits, 0);
    const bj = mine.hands.some((h) => h.outcome === 'blackjack');
    // Celebration by total net (DECISIONS 9): never for net <= 0, so a natural on one split hand that loses overall
    // shows nothing. Push: no celebration, a plain chip sound. Loss: a calm settle, a neutral low sound.
    const kind = celebrationFor(net, bj);
    presentation.sound(kind === 'bj' ? 'blackjack' : kind === 'win' ? 'win' : net < 0 ? 'lose' : 'chip');
    presentation.afterSequence(() => announce(`${net > 0 ? t('resultUp') : net < 0 ? t('resultDown') : t('resultEven')} ${net / 2}`));
    if (kind === 'bj') haptic('blackjack');
    else if (kind === 'win') haptic('win');
    if (kind || net < 0) presentation.afterSequence(() => setCelebrate({ kind: kind ?? 'lose', net, at: performance.now() }));
  }, [settledKey]);
  useEffect(() => {
    if (!celebrate) return;
    const id = setTimeout(() => setCelebrate(null), CELEBRATE_MS[celebrate.kind] * reviewSlow());
    return () => clearTimeout(id);
  }, [celebrate]);
  // Skippable after 600 ms (a natural runs 900 ms).
  const dismissCelebration = () => {
    if (celebrate && performance.now() - celebrate.at >= SKIPPABLE_AFTER_MS) setCelebrate(null);
  };

  const myActiveHand = myTurn ? (round?.turn?.hand ?? null) : null;
  // The turn timer is a ring around my total (F2), not a separate floating dial.
  const myRing = mySeat && myTurn && snap.deadline ? <TimerRing deadline={snap.deadline} total={snap.settings.turnSeconds * 1000} offset={offset} /> : undefined;
  const seatCount = others.length;
  const layout = seatCount === 0 ? 'is-solo' : seatCount <= 2 ? 'few-seats' : 'many-seats';

  return (
    <PresentationContext.Provider value={presentation}>
      <section ref={feltRef} className={`felt theme-${theme} ${layout} ${round ? '' : 'no-round'} ${celebrate ? `celebrate-${celebrate.kind}` : ''}`} aria-label="table" data-seats={seatCount + (mySeat ? 1 : 0)}>
        <div className="felt-lip" aria-hidden="true" />
        <div className="dealer-zone" dir="ltr">
          <button className="dealer-id" onClick={onDealerTap} data-uid={dealer.userId ?? 'dealer'} disabled={!onDealerTap}>
            <span className="seat-avatar">
              <Avatar id={dealer.avatar} dealer={!dealer.avatar} size={44} ring={snap.phase === 'dealer_turn'} />
              {dealer.userId && <GiftBadges gifts={giftsFor(dealer.userId)} />}
            </span>
            <span className="dealer-text">
              <bdi className="dealer-name">{dealer.name}</bdi>
              {round && round.dealer.total !== null && round.dealer.cards.length > 0 && (
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
            <i style={{ backgroundImage: backImage(back) }} />
          </div>
        </div>

        <p className="felt-print" aria-hidden="true" dir="ltr">
          BLACKJACK PAYS 3 TO 2
        </p>

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
              <SplitHands hands={mine.hands} back={back} activeIndex={myActiveHand} ring={myRing} />
            ) : (
              <div className="my-hands">
                <HandView hand={mine.hands[0]} back={back} size="lg" ring={myRing} mine />
              </div>
            )
          ) : mySeat ? (
            <div className={`bet-spot ${mySeat.betUnits > 0 ? 'has-bet' : ''}`} data-bet-spot data-testid="bet-spot">
              {mySeat.betUnits > 0 ? <ChipStack key={mySeat.betUnits} units={mySeat.betUnits} /> : <span className="bet-hint">{t('betHint')}</span>}
            </div>
          ) : null}
          <span className="gift-anchor">{mySeat && <GiftBadges gifts={giftsFor(meId)} />}</span>
        </div>

        {flights.map((f) => (
          <GiftFlightView key={f.id} f={f} track={(a) => presentation.track(a)} done={() => setFlights((x) => x.filter((y) => y.id !== f.id))} />
        ))}
        {pending && onSkip && (
          <button className="skip-anim" onClick={onSkip} aria-label={t('skipAnim')} title={t('skipAnim')} data-testid="skip-anim">
            <svg viewBox="0 0 24 24" aria-hidden="true">
              <path d="M4 6l8 6-8 6zM12 6l8 6-8 6z" />
            </svg>
          </button>
        )}
        {celebrate && celebrate.kind !== 'lose' && (
          <div
            className={`celebration c-${celebrate.kind}`}
            data-testid="celebration"
            data-kind={celebrate.kind}
            role="status"
            onClick={dismissCelebration}
            style={reviewSlow() > 1 ? ({ ['--dur-win' as string]: `${CELEBRATE_MS.win * reviewSlow()}ms`, ['--dur-celebrate' as string]: `${CELEBRATE_MS.bj * reviewSlow()}ms` } as CSSProperties) : undefined}
          >
            {celebrate.kind === 'bj' && (
              <span className="sparkles" aria-hidden="true">
                {Array.from({ length: SPARKLES }, (_, i) => (
                  <i key={i} style={{ ['--a' as string]: `${(360 / SPARKLES) * i}deg`, ['--d' as string]: `${70 + ((i * 37) % 50)}px`, ['--t' as string]: `${(i % 5) * 24}ms` }} />
                ))}
              </span>
            )}
            <span className="cel-head">{t(celebrate.kind === 'bj' ? 'natural' : 'celebrateWin')}</span>
            <Coins units={celebrate.net} sign className="cel-amount" />
          </div>
        )}
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
 * The four decisions always keep the same slots, left to right Double, Split, Stand, Hit (DECISIONS 4: Hit and Stand
 * equal weight on the thumb edge; the left-handed setting mirrors the row), so a button never moves under the thumb
 * between turns; a decision that is not legal now stays visible but disabled. After one press every button locks until
 * the table answers (legal actions change) or 2.5 s pass, so a double tap cannot send two decisions. The server is
 * idempotent anyway (commandId + exact version).
 */
export function ActionButtons({ legal, disabled, onAction }: { legal: PlayerAction[]; disabled?: boolean; onAction: (a: PlayerAction) => void }) {
  const order: PlayerAction[] = ['double', 'split', 'stand', 'hit'];
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
    haptic('selection');
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
    <div className="actions" dir="ltr" data-locked={locked || undefined}>
      {order.map((a) => (
        <button key={a} className={`btn act act-${a}`} disabled={disabled || locked || !legal.includes(a)} aria-disabled={!legal.includes(a) || undefined} onClick={() => fire(a)}>
          {t(a)}
        </button>
      ))}
    </div>
  );
}

/**
 * Bet chips (DECISIONS 5): three chips in view, "more" for the rest of the table's stakes, and clear. The chip in use
 * (placed bet, or the one selected and not yet confirmed) is always among the three shown.
 */
export function StakePicker({
  stakes,
  available,
  current,
  selected = null,
  onPick,
  onClear,
  disabled,
}: {
  stakes: number[];
  available: number;
  /** placed bet in units */
  current: number;
  /** chosen but not yet confirmed (online), in coins */
  selected?: number | null;
  onPick: (coins: number) => void;
  onClear?: () => void;
  disabled?: boolean;
}) {
  const VISIBLE = 3;
  const [page2, setPage2] = useState(false);
  const inUse = selected ?? (current ? current / 2 : null);
  const idx = inUse != null ? stakes.indexOf(inUse) : -1;
  const firstPage = stakes.slice(0, VISIBLE);
  const showing = page2 ? stakes.slice(VISIBLE) : idx >= VISIBLE ? stakes.slice(idx - VISIBLE + 1, idx + 1) : firstPage;
  return (
    <div className="stakes" dir="ltr" role="group" aria-label={t('stake')}>
      {showing.map((c) => {
        const i = stakes.indexOf(c);
        const can = c * 2 <= available + current;
        return (
          <button
            key={c}
            className={`stake-chip tier-${Math.min(i + 1, 5)} ${current === c * 2 ? 'on' : ''} ${selected === c ? 'sel' : ''}`}
            disabled={disabled || !can}
            onClick={(e) => {
              play('chip');
              haptic('bet');
              flyChip(e.currentTarget, `t${Math.min(i + 1, 5)}`);
              setPage2(false);
              onPick(c);
            }}
            aria-pressed={current === c * 2 || selected === c}
            aria-label={`${c}`}
          >
            <span className="num">{c}</span>
          </button>
        );
      })}
      {stakes.length > VISIBLE && (
        <button className="stake-more" onClick={() => setPage2((v) => !v)} aria-expanded={page2} data-testid="stake-more" aria-label={t(page2 ? 'fewerStakes' : 'moreStakes')}>
          {page2 ? '‹' : '+'}
          <span className="sr-only">{t(page2 ? 'fewerStakes' : 'moreStakes')}</span>
        </button>
      )}
      {onClear && (
        <button className="stake-clear" onClick={onClear} disabled={disabled || (!current && selected == null)} data-testid="stake-clear" aria-label={t('clearBet')}>
          <svg viewBox="0 0 24 24" aria-hidden="true">
            <path d="M6 6l12 12M18 6L6 18" />
          </svg>
        </button>
      )}
    </div>
  );
}

/** The separate row under the chips: the amount, and the one gold button (confirm the bet, or deal). */
export function BetConfirm({ units, label, onConfirm, disabled, testId, note }: { units: number; label: string; onConfirm?: () => void; disabled?: boolean; testId: string; note?: string }) {
  return (
    <div className="bet-confirm-row">
      <span className="bet-amount">
        <span className="muted">{t('stake')}</span> <Coins units={units} />
      </span>
      {onConfirm ? (
        <button className="btn confirm" onClick={onConfirm} disabled={disabled} data-testid={testId}>
          {label}
        </button>
      ) : (
        note && <span className="bet-note">{note}</span>
      )}
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
      {/* The result, once (P1): one fixed line "ניצחת · +25", then stake and total return small. No badge here: the
          banner already celebrated, and per-hand outcomes appear only in the split table. */}
      <p className="result-line" data-testid="result-line">
        <span className="result-head" data-testid="result-head">
          {net > 0 ? (!split && rows[0].h.outcome === 'blackjack' ? t('natural') : t('celebrateWin')) : net < 0 ? t('youLost') : t('pushReturned')}
        </span>
        <span className="result-sep" aria-hidden="true">
          ·
        </span>
        <span className="net">
          <span className="sr-only">{t('net')} </span>
          <Coins units={net} sign />
        </span>
      </p>
      <p className="result-sub" data-testid="result-sub">
        <span>
          {split ? t('stakeTotal') : t('stake')} <Coins units={stake} />
        </span>
        <span aria-hidden="true">·</span>
        <span>
          {t('returned')} <Coins units={ret} />
        </span>
      </p>
      {split && (
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
                <td className="net-cell">
                  <Coins units={r.net} sign />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {mine.hands.some(isSplit21) && (
        <p className="split21-note" data-testid="split21-note">
          <b>{t('split21')}.</b> {t('split21Why')}
        </p>
      )}
    </div>
  );
}
