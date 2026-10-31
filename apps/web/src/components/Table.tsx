import { useEffect, useRef, type ReactNode } from 'react';
import type { PublicHand, PublicRoundSeat, RoomSnapshot, SeatView } from '@table21/protocol';
import type { PlayerAction } from '@table21/game-engine';
import { Card } from './Card.tsx';
import { Avatar, ChipStack, Coins, TimerRing, announce } from './bits.tsx';
import { t, type Key } from '../i18n.ts';
import { buzz, play } from '../sound.ts';

export interface DealerInfo {
  name: string;
  avatar?: string;
  presenter: boolean;
  offline?: boolean;
}

export function totalLabel(h: Pick<PublicHand, 'total' | 'soft' | 'cards'>) {
  if (h.soft && h.total < 21 && h.cards.length < 6) return `${h.total - 10} / ${h.total}`;
  return String(h.total);
}

function outcomeKey(h: PublicHand): Key | null {
  if (h.outcome) return h.outcome as Key;
  if (h.status === 'bust') return 'bust';
  if (h.status === 'blackjack') return 'blackjack';
  return null;
}

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
      </div>
    </div>
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
}: {
  seat: SeatView;
  rs?: PublicRoundSeat;
  active: boolean;
  snap: RoomSnapshot;
  back: string;
  offset: number;
  onTap?: () => void;
}) {
  return (
    <button className={`seat ${active ? 'is-active' : ''} ${!seat.connected ? 'is-offline' : ''}`} onClick={onTap} aria-label={seat.name}>
      <span className="seat-avatar">
        <Avatar id={seat.avatar} size={40} />
        {active && snap.deadline && <TimerRing deadline={snap.deadline} total={snap.settings.turnSeconds * 1000} offset={offset} />}
      </span>
      <bdi className="seat-name">{seat.name}</bdi>
      {!seat.connected && <span className="seat-flag">{t('offline')}</span>}
      {rs ? (
        <span className="seat-hands">
          {rs.hands.map((h, i) => (
            <HandView key={i} hand={h} back={back} size="sm" active={active && snap.round?.turn?.hand === i} />
          ))}
        </span>
      ) : seat.betUnits > 0 ? (
        <ChipStack units={seat.betUnits} small />
      ) : (
        <span className="seat-idle" />
      )}
    </button>
  );
}

export function Table({
  snap,
  meId,
  back,
  theme,
  offset,
  dealer,
  onSeatTap,
  overlay,
}: {
  snap: RoomSnapshot;
  meId: string;
  back: string;
  theme: string;
  offset: number;
  dealer: DealerInfo;
  onSeatTap?: (seat: SeatView) => void;
  overlay?: ReactNode;
}) {
  const round = snap.round;
  const rsBy = new Map(round?.seats.map((s, i) => [s.playerId, { s, i }]) ?? []);
  const turnPlayer = round?.turn ? round.seats[round.turn.seat]?.playerId : null;
  const mySeat = snap.seats.find((s) => s.userId === meId);
  const others = snap.seats.filter((s) => s.userId !== meId);
  const mine = mySeat ? rsBy.get(mySeat.userId)?.s : undefined;
  const myTurn = turnPlayer === meId;

  const lastTurn = useRef<string | null>(null);
  useEffect(() => {
    const key = myTurn && round ? `${round.roundId}:${round.turn?.hand}` : null;
    if (key && key !== lastTurn.current) {
      play('turn');
      buzz(20);
      announce(t('yourTurn'));
    }
    lastTurn.current = key;
  }, [myTurn, round?.roundId, round?.turn?.hand]);

  const settledKey = round && (round.phase === 'settled' || round.phase === 'voided') ? round.roundId : null;
  const lastSettled = useRef<string | null>(null);
  useEffect(() => {
    if (!settledKey || settledKey === lastSettled.current) return;
    lastSettled.current = settledKey;
    if (!mine) return;
    const net = mine.hands.reduce((a, h) => a + (h.returnedUnits ?? 0) - h.stakeUnits, 0);
    const bj = mine.hands.some((h) => h.outcome === 'blackjack');
    play(bj ? 'blackjack' : net > 0 ? 'win' : net < 0 ? 'lose' : 'chip', 0.25);
    announce(`${t(net > 0 ? 'win' : net < 0 ? 'lose' : 'push')} ${net / 2}`);
  }, [settledKey]);

  return (
    <section className={`felt theme-${theme}`} aria-label="table">
      <div className="felt-lip" aria-hidden="true" />
      <div className="dealer-zone" dir="ltr">
        <div className="dealer-id">
          <Avatar id={dealer.avatar} dealer={!dealer.avatar} size={44} ring={snap.phase === 'dealer_turn'} />
          <div className="dealer-text">
            <bdi className="dealer-name">{dealer.name}</bdi>
            {round && round.dealer.total !== null && (
              <span className="total num">{round.dealer.revealed ? totalLabel({ total: round.dealer.total, soft: round.dealer.soft, cards: round.dealer.cards }) : round.dealer.total}</span>
            )}
          </div>
        </div>
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
          {others.map((s) => (
            <SeatCompact
              key={s.userId}
              seat={s}
              rs={rsBy.get(s.userId)?.s}
              active={turnPlayer === s.userId}
              snap={snap}
              back={back}
              offset={offset}
              onTap={() => onSeatTap?.(s)}
            />
          ))}
        </div>
      )}

      <div className={`me-zone ${myTurn ? 'is-active' : ''}`} dir="ltr">
        {mine ? (
          <div className="my-hands">
            {mine.hands.map((h, i) => (
              <HandView key={i} hand={h} back={back} size={mine.hands.length > 2 ? 'md' : 'lg'} active={myTurn && round?.turn?.hand === i && mine.hands.length > 1} />
            ))}
          </div>
        ) : mySeat && mySeat.betUnits > 0 ? (
          <div className="my-bet">
            <ChipStack units={mySeat.betUnits} />
          </div>
        ) : null}
        {mySeat && myTurn && snap.deadline && (
          <div className="my-timer">
            <TimerRing deadline={snap.deadline} total={snap.settings.turnSeconds * 1000} offset={offset} />
          </div>
        )}
      </div>
      {overlay}
    </section>
  );
}

export function ActionButtons({ legal, disabled, onAction }: { legal: PlayerAction[]; disabled?: boolean; onAction: (a: PlayerAction) => void }) {
  const order: PlayerAction[] = ['hit', 'stand', 'double', 'split'];
  useEffect(() => {
    const keys: Record<string, PlayerAction> = { h: 'hit', s: 'stand', d: 'double', p: 'split' };
    const f = (e: KeyboardEvent) => {
      const a = keys[e.key.toLowerCase()];
      if (a && legal.includes(a) && !disabled && !(e.target instanceof HTMLInputElement)) onAction(a);
    };
    addEventListener('keydown', f);
    return () => removeEventListener('keydown', f);
  }, [legal, disabled, onAction]);
  return (
    <div className="actions">
      {order
        .filter((a) => legal.includes(a))
        .map((a) => (
          <button
            key={a}
            className={`btn act act-${a}`}
            disabled={disabled}
            onClick={() => {
              buzz(8);
              play('tap');
              onAction(a);
            }}
          >
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
      {stakes.map((c) => {
        const can = c * 2 <= available + current;
        return (
          <button
            key={c}
            className={`stake-chip ${current === c * 2 ? 'on' : ''}`}
            disabled={disabled || !can}
            onClick={() => {
              play('chip');
              buzz(6);
              onPick(c);
            }}
            aria-pressed={current === c * 2}
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
  const stake = mine.hands.reduce((a, h) => a + h.stakeUnits, 0);
  const ret = mine.hands.reduce((a, h) => a + (h.returnedUnits ?? 0), 0);
  const net = ret - stake;
  return (
    <div className={`result-panel ${net > 0 ? 'pos' : net < 0 ? 'neg' : ''}`} data-testid="result-panel">
      <div className="result-hands">
        {mine.hands.map((h, i) => (
          <span key={i} className={`badge b-${h.outcome}`}>
            {t((h.outcome ?? 'push') as Key)}
          </span>
        ))}
      </div>
      <dl className="result-nums">
        <div>
          <dt>{t('stake')}</dt>
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
