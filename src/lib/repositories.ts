// Source repositories — the institutions, agencies, and estates that hold the
// original negatives, prints, and high-resolution scans behind the images in
// the archive. Each repository is keyed to a "Scan source" value on the Images
// table, so a repository's page automatically gathers every image it holds.
//
// LEVELS (this matters): a repository is an INSTITUTION, and one institution
// can hold many collections — Stanford holds the Herron, Fitch, and Wakayama
// archives. So "how do I obtain a copy" splits in two:
//   - the FILE half is institutional and shared across every collection the
//     repository holds — it lives here;
//   - the RIGHTS half is collection-specific (which estate grants permission,
//     which call number, which finding aid) — it lives on the photographer,
//     in photographers.ts, since a collection maps 1:1 to a photographer.
// The repository page derives its "collections held here" list from the images
// it holds, so a new collection appears automatically once its images are in.
//
// To add a repository: add an entry whose `scanSource` exactly matches the
// Images "Scan source" option value.

export interface RepositoryLink {
  label: string;
  url: string;
}

export interface Repository {
  /** Must match the Images "Scan source" option value exactly (used to gather images). */
  scanSource: string;
  /** Display name / heading. */
  name: string;
  /** URL slug: /repository/{slug}. */
  slug: string;
  /** One-line role, shown under the heading. */
  kind: string;
  /** What the institution is and what it holds (paragraphs split on blank lines). */
  blurb: string;
  /** The institutional half: how this repository supplies a high-resolution file. */
  howToRequest: string;
  /** Institution-level links (general contact / reproductions page). Collection
   *  finding aids belong on the collection, not here. */
  links: RepositoryLink[];
}

const REPOSITORIES: Repository[] = [
  {
    scanSource: 'Stanford Special Collections',
    name: 'Stanford Libraries — Special Collections',
    slug: 'stanford',
    kind: 'Holding repository — high-resolution scans',
    blurb:
      "Stanford Libraries' Department of Special Collections & University Archives holds several of the photographic archives represented in A Living Archive, including the negatives, contact sheets, and high-resolution digital scans behind them.",
    howToRequest:
      'Stanford holds the high-resolution scans, so any request for a digital file needs to come to Stanford. Permission to reproduce an image is granted separately, by the rights holder of the particular collection — so a request generally needs to reach both. See the collection below for who grants permission for a given photographer’s work.',
    links: [],
  },
];

const bySlug = new Map(REPOSITORIES.map((r) => [r.slug, r]));
const byScanSource = new Map(REPOSITORIES.map((r) => [r.scanSource, r]));

/** Repository for a /repository/{slug} page, or null if none. */
export function repositoryBySlug(slug: string | null | undefined): Repository | null {
  if (!slug) return null;
  return bySlug.get(slug) ?? null;
}

/** Repository that holds a given scan source, or null if none has a page yet. */
export function repositoryByScanSource(scanSource: string | null | undefined): Repository | null {
  if (!scanSource) return null;
  return byScanSource.get(scanSource) ?? null;
}

export function allRepositories(): Repository[] {
  return REPOSITORIES;
}
