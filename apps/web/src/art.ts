/**
 * Raster art from the Club Lounge kit (direction A, docs/ASSETS_CLUB.md). Every raster has a vector or CSS fallback:
 * card backs list the SVG as a second background layer, so a missing WebP still shows a designed back.
 */
export const CLUB_ART = '/art/club';
// P1: only the Club back's "21" medallion is kept, inside one solid brass ring, on a single low-contrast argyle of
// filled diamonds (no fine lines). Every back and every face share one 2px ivory frame and one 8 px radius from CSS
// (theme/premium.css), so back and face read as one card.
const RASTER_BACKS: Record<string, string> = { classic: `${CLUB_ART}/cardback-simple.webp` };

/** Drawn in CSS, no file: the last layer, so a back still reads as a card back when every image fails to load. */
export const BACK_PATTERN = 'repeating-linear-gradient(45deg, rgba(246, 241, 228, 0.1) 0 3px, transparent 3px 9px), repeating-linear-gradient(-45deg, rgba(246, 241, 228, 0.1) 0 3px, transparent 3px 9px)';

/** CSS background-image for a card back: raster first, the original SVG underneath, a CSS pattern last. */
export function backImage(back: string): string {
  const svg = `url(/art/backs/${back}.svg)`;
  return `${RASTER_BACKS[back] ? `url(${RASTER_BACKS[back]}), ` : ''}${svg}, ${BACK_PATTERN}`;
}

/** True when this back draws its own "21" emblem, so the CSS medallion is not stacked on top of it. */
export const backHasEmblem = (back: string) => back in RASTER_BACKS;

/** Single image URL for small previews (profile, club). */
export const backThumb = (back: string) => RASTER_BACKS[back] ?? `/art/backs/${back}.svg`;
export const backThumbFallback = (back: string) => `/art/backs/${back}.svg`;
