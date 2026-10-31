import { useLayoutEffect, useRef } from 'react';
import type { PublicCard } from '@table21/protocol';
import { reducedMotion } from '../prefs.ts';
import { play } from '../sound.ts';

export const SUIT_PATHS: Record<string, string> = {
  S: 'M12 2C9 6.5 3.5 9.6 3.5 14a4.3 4.3 0 0 0 7.2 3.2L9.6 22h4.8l-1.1-4.8A4.3 4.3 0 0 0 20.5 14C20.5 9.6 15 6.5 12 2Z',
  H: 'M12 21.3S3 15.4 3 9.1A4.9 4.9 0 0 1 12 6.4a4.9 4.9 0 0 1 9 2.7c0 6.3-9 12.2-9 12.2Z',
  D: 'M12 2.2 19.2 12 12 21.8 4.8 12Z',
  C: 'M12 2.5a4.2 4.2 0 0 0-3.4 6.7A4.2 4.2 0 1 0 10.8 16l-1.2 6h4.8l-1.2-6a4.2 4.2 0 1 0 2.2-6.8A4.2 4.2 0 0 0 12 2.5Z',
};

export function Suit({ s, className }: { s: string; className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={className} aria-hidden="true">
      <path d={SUIT_PATHS[s]} fill="currentColor" />
    </svg>
  );
}

const SUIT_NAME: Record<string, string> = { S: 'spades', H: 'hearts', D: 'diamonds', C: 'clubs' };

/* ---- deal animation: batch cards mounted in the same frame, then stagger them by draw slot ---- */
const seen = new Set<string>();
let batch: { el: HTMLElement; slot: number }[] = [];
let scheduled = false;

function flush() {
  scheduled = false;
  const items = batch.sort((a, b) => a.slot - b.slot);
  batch = [];
  // Joining mid-round or reconnecting: skip obsolete animations instead of replaying the whole round.
  if (items.length > 10 || reducedMotion()) return;
  const shoe = document.getElementById('shoe')?.getBoundingClientRect();
  items.forEach((it, i) => {
    const r = it.el.getBoundingClientRect();
    const dx = shoe ? shoe.left + shoe.width / 2 - (r.left + r.width / 2) : 0;
    const dy = shoe ? shoe.top + shoe.height / 2 - (r.top + r.height / 2) : -120;
    const delay = i * 150;
    it.el.animate(
      [
        { transform: `translate(${dx}px, ${dy}px) rotate(-14deg) scale(.82)`, opacity: 0.4 },
        { transform: 'translate(0,0) rotate(0) scale(1)', opacity: 1 },
      ],
      { duration: 280, delay, easing: 'cubic-bezier(.2,.75,.25,1)', fill: 'backwards' },
    );
    play('deal', delay / 1000);
  });
}

export function Card({ card, back = 'classic', size = 'md' }: { card: PublicCard; back?: string; size?: 'sm' | 'md' | 'lg' }) {
  const ref = useRef<HTMLDivElement>(null);
  const hidden = 'hidden' in card;
  const prevHidden = useRef(hidden);

  useLayoutEffect(() => {
    if (seen.has(card.id) || !ref.current) return;
    seen.add(card.id);
    if (seen.size > 4000) seen.clear();
    batch.push({ el: ref.current, slot: Number(card.id.split(':')[1] ?? 0) });
    if (!scheduled) {
      scheduled = true;
      queueMicrotask(flush);
    }
  }, [card.id]);

  useLayoutEffect(() => {
    if (prevHidden.current && !hidden) play('flip');
    prevHidden.current = hidden;
  }, [hidden]);

  const red = !hidden && (card.suit === 'H' || card.suit === 'D');
  const label = hidden ? 'hidden card' : `${card.rank} of ${SUIT_NAME[card.suit]}`;
  return (
    <div ref={ref} className={`card card-${size} ${hidden ? 'is-down' : ''} ${red ? 'red' : ''}`} role="img" aria-label={label}>
      <div className="card-inner">
        <div className="card-face">
          {!hidden && (
            <>
              <span className="idx tl">
                <b>{card.rank}</b>
                <Suit s={card.suit} />
              </span>
              <span className="pip">
                {['J', 'Q', 'K'].includes(card.rank) ? <i className="court">{card.rank}</i> : <Suit s={card.suit} />}
              </span>
              <span className="idx br">
                <b>{card.rank}</b>
                <Suit s={card.suit} />
              </span>
            </>
          )}
        </div>
        <div className="card-back" style={{ backgroundImage: `url(/art/backs/${back}.svg)` }} />
      </div>
    </div>
  );
}
