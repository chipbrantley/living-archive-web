// Exhibitions the Living Archive has mounted. Each instance is keyed by a
// place+year slug (NOT the series name) — "Proof Positive" may recur for
// future Mississippi/Delta shows, so the slug is what stays unique. The slug
// also IS the exhibit's public URL scheme (/{slug} and /{slug}/{item number}),
// chosen to match the QR codes printed on the exhibit cards.
//
// One exhibit for now; when there's a second, this becomes an Airtable table.

export interface Exhibit {
  /** Place+year slug = URL scheme = printed QR scheme (e.g. "jackson26"). */
  slug: string;
  /** Display name — may repeat across instances. */
  name: string;
  venue: string;
  /** "City, State" for display. */
  city: string;
  /** Poster-style descriptive subtitle, shown under the title on the landing. */
  tagline: string;
  /** Run dates (ISO, inclusive). The wayfinding item number auto-hides after end. */
  start: string;
  end: string;
  /** One or more paragraphs (split on blank lines) for the landing page. */
  blurb: string;
  /** How many numbered items the exhibit has. */
  itemCount: number;
}

const PROOF_POSITIVE: Exhibit = {
  slug: 'jackson26',
  name: 'Proof Positive',
  venue: 'Smith Robertson Museum',
  city: 'Jackson, Mississippi',
  tagline:
    'Work by five photographers who documented the Civil Rights Movement in Mississippi between 1963 and 1966',
  start: '2026-10-26',
  end: '2026-12-31',
  itemCount: 51,
  blurb: `Proof Positive is the first Living Archive exhibit in Mississippi, featuring Bob Fitch, Matt Herron, Jim Marshall, Jim Peppler, and Tamio Wakayama. Most of these images have never been printed or publicly seen.

Click on an image below. If you recognize someone, please let us know using the short form. Every name, place, or story you add helps return these photographs to the people and communities who lived this history.`,
};

const EXHIBITS: Record<string, Exhibit> = {
  [PROOF_POSITIVE.slug]: PROOF_POSITIVE,
};

export function exhibitBySlug(slug: string | null | undefined): Exhibit | null {
  if (!slug) return null;
  return EXHIBITS[slug] ?? null;
}

/** The exhibit an image belongs to, if any (one exhibit for now). */
export function exhibitForImage(proofPositiveNumber: number | null | undefined): Exhibit | null {
  return proofPositiveNumber ? PROOF_POSITIVE : null;
}

/**
 * Whether to show the physical wayfinding number ("No. 32") on a page. It's
 * only meaningful to a visitor in the room during the run, so it auto-hides the
 * day after the exhibit ends — the permanent exhibition credit stays regardless.
 * Evaluated server-side at request time, so no manual edit is ever needed.
 */
export function showExhibitNumber(exhibit: Exhibit, nowISO = new Date().toISOString().slice(0, 10)): boolean {
  return nowISO <= exhibit.end;
}

export { PROOF_POSITIVE };
