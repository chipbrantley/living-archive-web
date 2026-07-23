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
  /**
   * Who grants permission to reproduce this photographer's work — shown on the
   * "Rights & reproductions" line. Distinct from the scan source (where the
   * digital file is held): a Herron image's file may live at Stanford or Take
   * Stock, but permission is granted by the Estate of Matt Herron.
   */
  rightsHolder: string;
  /**
   * The archive this photographer's work lives in at a holding repository.
   * This is the single source of truth for collection-level facts: the
   * repository page derives its "collections held here" list from these, and
   * the photographer page renders the reproductions guidance from them.
   * Omit for photographers whose work isn't deposited at a repository (e.g.
   * an estate that still holds its own negatives).
   */
  collection?: PhotographerCollection;
}

export interface PhotographerCollection {
  /** Slug of the holding repository (see repositories.ts). */
  repositorySlug: string;
  /** Formal name of the archive, e.g. "Matt Herron photography archive". */
  name: string;
  /** Collection call number, e.g. "M2866". */
  number?: string;
  /**
   * The repository's official credit line for this collection, VERBATIM — the
   * wording it supplies for media releases and publication (this is the form
   * the AP has used for Herron images). Per-collection, not per-repository:
   * one institution's other archives each carry their own citation.
   */
  citation?: string;
  /** Finding aid / catalog records for this specific collection. */
  links?: { label: string; url: string }[];
}

const PHOTOGRAPHERS: Record<string, Photographer> = {
  MH: {
    fullName: 'Matt Herron',
    credit: 'Matt Herron / Living Archive',
    rightsHolder: 'the Estate of Matt Herron',
    collection: {
      repositorySlug: 'stanford',
      name: 'Matt Herron photography archive',
      number: 'M2866',
      citation:
        'Matt Herron photography archive (M2866). Dept. of Special Collections and University Archives, Stanford University Libraries, Stanford, California',
      links: [
        { label: 'Finding aid (M2866)', url: 'https://archives.stanford.edu/catalog/m2866' },
        { label: 'Stanford University Libraries catalog record', url: 'https://searchworks.stanford.edu/view/14174773' },
      ],
    },
  },
  JM: { fullName: 'Jim Marshall', credit: 'Jim Marshall Photography LLC', rightsHolder: 'Jim Marshall Photography LLC' },
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

/** Who grants reproduction permission for a photographer's work (rights holder). */
export function rightsHolder(prefix: string | null | undefined): string | null {
  if (!prefix) return null;
  return PHOTOGRAPHERS[prefix]?.rightsHolder ?? null;
}

/** The archive a photographer's work is held in, or null if not deposited. */
export function collectionFor(prefix: string | null | undefined): PhotographerCollection | null {
  if (!prefix) return null;
  return PHOTOGRAPHERS[prefix]?.collection ?? null;
}

/**
 * Look a photographer's config up by their page slug (the photographer page
 * fetches its record from Airtable by slug, and needs the config to render
 * reproductions guidance).
 */
export function photographerConfigBySlug(
  slug: string | null | undefined,
): (Photographer & { prefix: string }) | null {
  if (!slug) return null;
  for (const [prefix, p] of Object.entries(PHOTOGRAPHERS)) {
    if (toSlug(p.fullName) === slug) return { ...p, prefix };
  }
  return null;
}

/**
 * Source of an image's verbatim "original" caption. Take Stock supplies the
 * original captions for Herron only; other photographers' captions are the
 * Living Archive's own, so they get no Take Stock attribution.
 */
export function captionSource(prefix: string | null | undefined): string | null {
  return prefix === 'MH' ? 'Take Stock' : null;
}
