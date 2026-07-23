// Source repositories — the institutions, agencies, and estates that hold the
// original negatives, prints, and high-resolution scans behind the images in
// the archive. Each repository is keyed to a "Scan source" value on the Images
// table, so a repository's page automatically gathers every image it holds.
//
// This is where a viewer who wants a high-resolution file or reproduction
// rights is sent (per Ben Stone / Stanford's request, July 2026). The narrative
// text here is a working draft meant to be refined with each repository.
//
// To add a repository: add an entry whose `scanSource` exactly matches the
// Images "Scan source" option value. The page and the image-page "Rights &
// reproductions" link light up automatically.

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
  /** What the repository is and what it holds (one or more paragraphs, split on blank lines). */
  blurb: string;
  /** How to obtain a high-resolution file or reproduction rights. */
  howToRequest: string;
  /** Catalog records, finding aids, agency pages, etc. */
  links: RepositoryLink[];
}

const REPOSITORIES: Repository[] = [
  {
    scanSource: 'Stanford Special Collections',
    name: 'Stanford Libraries — Special Collections',
    slug: 'stanford',
    kind: 'Holding repository — high-resolution scans',
    blurb:
      "Stanford Libraries' Department of Special Collections & University Archives holds the Matt Herron photography archive (collection M2866) — the negatives, contact sheets, and high-resolution digital scans behind many of the Herron images in A Living Archive.",
    howToRequest:
      'To obtain a high-resolution file or to reproduce a Matt Herron photograph, two parties are typically involved: permission to reproduce is granted by the Estate of Matt Herron, and the digital file is provided by Stanford Special Collections, which holds the scans. A request generally needs to reach both. Many Herron images are also available through Take Stock, the picture agency.',
    links: [
      { label: 'Matt Herron photography archive — finding aid (M2866)', url: 'https://archives.stanford.edu/catalog/m2866' },
      { label: 'Stanford Libraries catalog record', url: 'https://searchworks.stanford.edu/view/14174773' },
    ],
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
