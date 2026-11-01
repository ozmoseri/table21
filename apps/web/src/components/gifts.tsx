import { useState, type ReactElement } from 'react';
import { CLUB_ART } from '../art.ts';
import type { GiftId, ReactionId } from '@table21/protocol';
import { getLocale } from '../i18n.ts';

/** Original vector gift icons (TABLE21 palette). Visual gestures only, with no coin value. */
const ICONS: Record<GiftId, ReactElement> = {
  coffee: (
    <>
      <path d="M7 13h15v7a6 6 0 0 1-6 6h-3a6 6 0 0 1-6-6z" fill="#F5F2EA" />
      <path d="M22 15h2.2a3 3 0 0 1 0 6H22" fill="none" stroke="#F5F2EA" strokeWidth="2" />
      <path d="M9 15h11v1.6H9z" fill="#6B4426" />
      <path d="M11 6c-1.4 1.6 1.4 2.4 0 4M15 5c-1.4 1.6 1.4 2.6 0 4.4M19 6c-1.4 1.6 1.4 2.4 0 4" stroke="#A6B5B0" strokeWidth="1.4" fill="none" strokeLinecap="round" />
      <path d="M5 27h20" stroke="#D8B46A" strokeWidth="2" strokeLinecap="round" />
    </>
  ),
  tea: (
    <>
      <path d="M8 14h14l-1.6 9.5A4 4 0 0 1 16.5 27h-3a4 4 0 0 1-3.9-3.5z" fill="#0F513E" stroke="#D8B46A" strokeWidth="1.4" />
      <path d="M22 16h1.8a2.6 2.6 0 0 1 0 5.2H21" fill="none" stroke="#D8B46A" strokeWidth="1.6" />
      <path d="M15 14V8" stroke="#A6B5B0" strokeWidth="1.2" />
      <rect x="13.4" y="5.4" width="3.2" height="3.2" rx=".6" fill="#D8B46A" />
      <path d="M11 18.5c1.2 1 2.6 1 4 0s2.8-1 4 0" stroke="#80D5AF" strokeWidth="1.3" fill="none" />
    </>
  ),
  cookie: (
    <>
      <circle cx="16" cy="16" r="10.5" fill="#C9944F" />
      <path d="M24.6 10.4a3 3 0 0 1-3.4-3.6A10.5 10.5 0 1 0 26.5 16a3 3 0 0 1-1.9-5.6z" fill="#B57F3E" opacity=".55" />
      {[
        [12, 12],
        [18, 14],
        [13, 19],
        [19, 20],
        [16, 9],
      ].map(([x, y]) => (
        <circle key={`${x}${y}`} cx={x} cy={y} r="1.5" fill="#3D2414" />
      ))}
    </>
  ),
  rose: (
    <>
      <path d="M16 15v12" stroke="#2E7A58" strokeWidth="2" strokeLinecap="round" />
      <path d="M16 22c-3-.4-5-2-5.5-4.2 3 .2 4.8 1.6 5.5 4.2zM16 20c2.4-.6 4.4-2.4 4.6-4.6-2.6.4-4.2 2-4.6 4.6z" fill="#3E9C70" />
      <path d="M16 5c3.8 0 6.6 2.6 6.6 5.8 0 3.4-2.9 5.4-6.6 5.4s-6.6-2-6.6-5.4C9.4 7.6 12.2 5 16 5z" fill="#C2404B" />
      <path d="M13 9.4c1.6-1.6 4.4-1.6 6 0-1 2.4-5 2.4-6 0z" fill="#E36A70" />
    </>
  ),
  trophy: (
    <>
      <path d="M10 6h12v6.5a6 6 0 0 1-12 0z" fill="#D8B46A" />
      <path d="M10 8H6.5a3.5 3.5 0 0 0 3.8 4.6M22 8h3.5a3.5 3.5 0 0 1-3.8 4.6" fill="none" stroke="#D8B46A" strokeWidth="1.6" />
      <path d="M14.5 18h3v4h-3z" fill="#B8914E" />
      <path d="M10.5 22h11v3.5h-11z" fill="#0F513E" stroke="#D8B46A" strokeWidth="1.2" />
      <path d="M13 8.5l1.2 2.4 2.6.4-1.9 1.8.5 2.6-2.4-1.3-2.3 1.3.4-2.6-1.8-1.8 2.6-.4z" fill="#F7E3B0" transform="translate(2.9 -.6) scale(.9)" />
    </>
  ),
  tissue: (
    <>
      <path d="M6 15h20v10a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2z" fill="#26475A" />
      <path d="M10 15c0-4 2-7 6-8 1 2.6 4.6 3 5.4 8z" fill="#F5F2EA" />
      <path d="M11 20h10" stroke="#A6B5B0" strokeWidth="1.4" strokeLinecap="round" />
      <path d="M23.5 6.5c-.9 1.4-.9 2.6 0 3.2.9-.6.9-1.8 0-3.2z" fill="#7FC3F0" />
    </>
  ),
};

export const GIFT_LABEL: Record<GiftId, Record<'he' | 'en', string>> = {
  coffee: { he: 'קפה', en: 'Coffee' },
  tea: { he: 'תה', en: 'Tea' },
  cookie: { he: 'עוגייה', en: 'Cookie' },
  rose: { he: 'ורד', en: 'Rose' },
  trophy: { he: 'גביע קטן', en: 'Small trophy' },
  tissue: { he: 'טישו', en: 'Tissue' },
};

/** Gifts with a raster from the Club Lounge kit; the vector icon above stays as the fallback. */
const GIFT_ART: Partial<Record<GiftId, string>> = { coffee: `${CLUB_ART}/coffee.webp` };

export function GiftIcon({ id, size = 28 }: { id: GiftId; size?: number }) {
  const [failed, setFailed] = useState(false);
  const art = GIFT_ART[id];
  if (art && !failed)
    return <img src={art} width={size} height={size} className="gift-icon gift-art" alt={GIFT_LABEL[id][getLocale()]} draggable={false} onError={() => setFailed(true)} />;
  return (
    <svg viewBox="0 0 32 32" width={size} height={size} className="gift-icon" role="img" aria-label={GIFT_LABEL[id][getLocale()]}>
      {ICONS[id]}
    </svg>
  );
}

/** Reaction glyphs: small original marks shown next to the text bubble. */
export const REACTION_GLYPH: Record<ReactionId, string> = {
  nice: 'M6 12.5 10 16.5 18 7.5',
  card: 'M7 4h10v16H7z M10 8h4',
  wow: 'M12 4v10 M12 18.5v.5',
  yourturn: 'M8 12h9 M13 8l4 4-4 4',
  thanks: 'M12 20s-7-4.4-7-9.4A3.6 3.6 0 0 1 12 8a3.6 3.6 0 0 1 7 2.6C19 15.6 12 20 12 20z',
  again: 'M17 7a7 7 0 1 0 2 5 M17 3v4h-4',
  clap: 'M8 13l5-6 M10 15l6-7 M12 17l5-6 M6 9l1-2 M17 4l1-1.5',
  wink: 'M8 10h2 M14 10.5c1-1 2-1 3 0 M8.5 15c2 2 5 2 7 0',
};
