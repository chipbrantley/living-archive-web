// Photographer attribution, keyed by the prefix code carried on each image
// (the "Photographer prefix" lookup from the Photographers table — e.g. "MH").
//
// Credit is per-photographer, not a single house style: each estate dictates how
// its work must be credited. Herron's images are credited to "Matt Herron / Living
// Archive"; Jim Marshall's estate requires "Jim Marshall Photography LLC". As more
// photographers are added (Bob Fitch, Tamio Wakayama, …), add them here.

export interface Photographer {
  /** Full display name, e.g. for the photographer pill and alt text. */
  fullName: string;
  /** The credit shown after "©" in the image watermark / attribution line. */
  credit: string;
}

const PHOTOGRAPHERS: Record<string, Photographer> = {
  MH: { fullName: 'Matt Herron', credit: 'Matt Herron / Living Archive' },
  JM: { fullName: 'Jim Marshall', credit: 'Jim Marshall Photography LLC' },
};

/** Full display name for a photographer prefix; falls back to the raw prefix. */
export function photographerFullName(prefix: string | null | undefined): string | null {
  if (!prefix) return null;
  return PHOTOGRAPHERS[prefix]?.fullName ?? prefix;
}

/** Watermark / credit line for an image, e.g. "© Matt Herron / Living Archive". */
export function watermarkLine(prefix: string | null | undefined): string {
  if (!prefix) return 'Living Archive';
  const p = PHOTOGRAPHERS[prefix];
  return p ? `© ${p.credit}` : `© ${prefix} / Living Archive`;
}

const toSlug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');

/** URL slug for a photographer's landing page (matches the page's name-based lookup). */
export function photographerSlug(prefix: string | null | undefined): string | null {
  if (!prefix) return null;
  const p = PHOTOGRAPHERS[prefix];
  return p ? toSlug(p.fullName) : null;
}

/**
 * Source of an image's verbatim "original" caption. Take Stock supplies the
 * original captions for Herron only; other photographers' captions are the
 * Living Archive's own, so they get no Take Stock attribution.
 */
export function captionSource(prefix: string | null | undefined): string | null {
  return prefix === 'MH' ? 'Take Stock' : null;
}
