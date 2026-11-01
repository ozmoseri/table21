import { useLayoutEffect, useRef } from 'react';
import type { PublicCard } from '@table21/protocol';
import { usePresentation } from '../presentation.ts';

/** Suit and court marks are original vector shapes drawn in code; ranks are always real text. */
export const SUIT_PATHS: Record<string, string> = {
  S: 'M12 2C9 6.5 3.5 9.6 3.5 14a4.3 4.3 0 0 0 7.2 3.2L9.6 22h4.8l-1.1-4.8A4.3 4.3 0 0 0 20.5 14C20.5 9.6 15 6.5 12 2Z',
  H: 'M12 21.3S3 15.4 3 9.1A4.9 4.9 0 0 1 12 6.4a4.9 4.9 0 0 1 9 2.7c0 6.3-9 12.2-9 12.2Z',
  D: 'M12 2.2 19.2 12 12 21.8 4.8 12Z',
  C: 'M12 2.5a4.2 4.2 0 0 0-3.4 6.7A4.2 4.2 0 1 0 10.8 16l-1.2 6h4.8l-1.2-6a4.2 4.2 0 1 0 2.2-6.8A4.2 4.2 0 0 0 12 2.5Z',
};

/** Original court marks: a crown (K), a tiara with a jewel (Q), a plumed cap (J). */
const COURT: Record<string, { mark: string; accent: string }> = {
  K: { mark: 'M5 26h22l2-14-7 5-6-10-6 10-7-5z M5 28h22v3H5z', accent: 'M16 9.5a1.6 1.6 0 1 0 0 .1z M7 13a1.3 1.3 0 1 0 0 .1z M25 13a1.3 1.3 0 1 0 0 .1z' },
  Q: { mark: 'M4 26c3-9 7-14 12-14s9 5 12 14z M4 28h24v3H4z', accent: 'M16 6l2.6 4.2L16 14.4l-2.6-4.2z M9 17.5a1.2 1.2 0 1 0 0 .1z M23 17.5a1.2 1.2 0 1 0 0 .1z' },
  J: { mark: 'M5 27c0-7 5-12 12-12 4 0 7 1.6 9 4-3.6-.2-6 1.2-7 3.6 2.6.2 4 1.6 4.4 4.4z M5 29h18v2.4H5z', accent: 'M18 15c1-5 5-8.5 9.5-9-1.5 3.5-4.2 6.6-7.6 8.6z' },
};

export function Suit({ s, className }: { s: string; className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={className} aria-hidden="true">
      <path d={SUIT_PATHS[s]} fill="currentColor" />
    </svg>
  );
}

function CourtArt({ rank, suit }: { rank: string; suit: string }) {
  const c = COURT[rank];
  return (
    <span className="court" aria-hidden="true">
      <svg viewBox="0 0 32 34" className="court-mark">
        <path d={c.mark} fill="currentColor" />
        <path d={c.accent} fill="var(--gold)" />
      </svg>
      <Suit s={suit} className="court-suit" />
    </span>
  );
}

const SUIT_NAME: Record<string, string> = { S: 'spades', H: 'hearts', D: 'diamonds', C: 'clubs' };

export function Card({ card, back = 'classic', size = 'md' }: { card: PublicCard; back?: string; size?: 'sm' | 'md' | 'lg' }) {
  const ref = useRef<HTMLDivElement>(null);
  const presentation = usePresentation();
  const hidden = 'hidden' in card;

  useLayoutEffect(() => {
    if (ref.current && presentation) presentation.register(ref.current, card.id);
  }, [card.id, presentation]);

  const red = !hidden && (card.suit === 'H' || card.suit === 'D');
  const label = hidden ? 'hidden card' : `${card.rank} of ${SUIT_NAME[card.suit]}`;
  return (
    <div ref={ref} className={`card card-${size} ${hidden ? 'is-down' : ''} ${red ? 'red' : ''}`} role="img" aria-label={label} data-card-id={card.id}>
      <div className="card-inner">
        <div className="card-face">
          {!hidden && (
            <>
              <span className="idx tl">
                <b>{card.rank}</b>
                <Suit s={card.suit} />
              </span>
              <span className="pip">{COURT[card.rank] ? <CourtArt rank={card.rank} suit={card.suit} /> : <Suit s={card.suit} />}</span>
              <span className="idx br">
                <b>{card.rank}</b>
                <Suit s={card.suit} />
              </span>
            </>
          )}
        </div>
        <div className="card-back" style={{ backgroundImage: `url(/art/backs/${back}.svg)` }}>
          <span className="back-mark" aria-hidden="true">
            21
          </span>
        </div>
      </div>
    </div>
  );
}
