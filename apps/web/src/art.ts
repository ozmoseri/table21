/**
 * Raster art from the Club Lounge kit (direction A, docs/ASSETS_CLUB.md). Every raster has a vector or CSS fallback:
 * card backs list the SVG as a second background layer, so a missing WebP still shows a designed back.
 */
export const CLUB_ART = '/art/club';
const RASTER_BACKS: Record<string, string> = { classic: `${CLUB_ART}/cardback.webp` };

/** CSS background-image for a card back: raster first, the original SVG underneath as the fallback. */
export function backImage(back: string): string {
  const svg = `url(/art/backs/${back}.svg)`;
  return RASTER_BACKS[back] ? `url(${RASTER_BACKS[back]}), ${svg}` : svg;
}

/** True when this back draws its own "21" emblem, so the CSS medallion is not stacked on top of it. */
export const backHasEmblem = (back: string) => back in RASTER_BACKS;

/** Single image URL for small previews (profile, club). */
export const backThumb = (back: string) => RASTER_BACKS[back] ?? `/art/backs/${back}.svg`;
export const backThumbFallback = (back: string) => `/art/backs/${back}.svg`;
