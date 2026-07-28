/**
 * Write-side Airtable client for the contribution form.
 * Uses AIRTABLE_PAT_WRITE (a separate, write-scoped token) so the
 * read-only AIRTABLE_PAT stays read-only. Server-side only.
 */

const WRITE_PAT = import.meta.env.AIRTABLE_PAT_WRITE;
const BASE_ID = import.meta.env.AIRTABLE_BASE_ID;

const USERS_TABLE = 'Users';
const SUGGESTIONS_TABLE = 'Suggestions';
const IDENTIFICATIONS_TABLE = 'Identifications';
const PEOPLE_TABLE = 'People';

function assertConfigured(): void {
  if (!WRITE_PAT) {
    throw new Error(
      'AIRTABLE_PAT_WRITE is not set. The contribution form needs a write-scoped token.'
    );
  }
  if (!BASE_ID) throw new Error('AIRTABLE_BASE_ID is not set.');
}

async function airtableWrite(
  path: string,
  method: 'GET' | 'POST' | 'PATCH',
  payload?: unknown,
  params?: Record<string, string>
): Promise<any> {
  assertConfigured();
  const url = new URL(`https://api.airtable.com/v0/${BASE_ID}${path}`);
  if (params) {
    for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  }
  const res = await fetch(url.toString(), {
    method,
    headers: {
      Authorization: `Bearer ${WRITE_PAT}`,
      'Content-Type': 'application/json',
    },
    body: payload === undefined ? undefined : JSON.stringify(payload),
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Airtable ${res.status}: ${body}`);
  }
  return res.json();
}


export interface PersonSubmission {
  id?: string; // People record id when the contributor picked an existing person
  name: string;
}

/** One Identifications record per person named, Unverified until review. */
export async function createIdentification(
  imageRecId: string,
  person: PersonSubmission,
  userRecId: string,
  dateISO: string
): Promise<void> {
  await airtableWrite(`/${IDENTIFICATIONS_TABLE}`, 'POST', {
    fields: {
      Image: [imageRecId],
      ...(person.id ? { Person: [person.id] } : {}),
      // Always record the typed name so the row is legible during review even
      // when no People record is linked yet (a proposed new person). Without
      // this, a new-person identification shows a blank Person cell.
      'Proposed name': person.name,
      'Suggested by': [userRecId],
      'Suggested on': dateISO,
      'Verification status': 'Unverified',
      Notes: person.id
        ? 'Submitted via the public contribution form.'
        : `Proposed new person (not yet in People): "${person.name}". Submitted via the public contribution form.`,
    },
  });
}

/**
 * A field-level contribution -> a Pending Suggestions record.
 * fieldName must be one of the Suggestions table's "Field name" options
 * (State, County, City / Town, Neighborhood, Specific venue, Date taken,
 * Events, Organizations, Editorial notes, …).
 */
export async function createFieldSuggestion(
  imageRecId: string,
  fieldName: string,
  proposedValue: string,
  userRecId: string,
  dateISO: string
): Promise<void> {
  await airtableWrite(`/${SUGGESTIONS_TABLE}`, 'POST', {
    fields: {
      Image: [imageRecId],
      'Field name': fieldName,
      'Proposed value': proposedValue,
      Submitter: [userRecId],
      'Submitted on': dateISO,
      Status: 'Pending',
    },
  });
}

// ── Review actions (admin review page) ──────────────────────────────────────

/**
 * Find a People record by exact (case-insensitive) name, or create one.
 * Used when verifying an identification for a person not yet in the archive.
 * Matching on name keeps a repeated new-person name from spawning duplicates.
 */
export async function findOrCreatePerson(name: string): Promise<string> {
  const clean = name.trim();
  if (!clean) throw new Error('Cannot create a person with an empty name.');
  const safe = clean.replace(/'/g, "\\'");
  const found = await airtableWrite(`/${PEOPLE_TABLE}`, 'GET', undefined, {
    filterByFormula: `LOWER({Name})=LOWER('${safe}')`,
    maxRecords: '1',
  });
  if (found.records?.length) return found.records[0].id;
  const created = await airtableWrite(`/${PEOPLE_TABLE}`, 'POST', { fields: { Name: clean } });
  return created.id;
}

/** The current Person link + Proposed name for an identification. */
export async function getIdentificationForReview(
  id: string
): Promise<{ personId: string | null; proposedName: string | null }> {
  const rec = await airtableWrite(`/${IDENTIFICATIONS_TABLE}/${id}`, 'GET');
  return {
    personId: (rec.fields?.['Person'] ?? [])[0] ?? null,
    proposedName: rec.fields?.['Proposed name'] ?? null,
  };
}

export async function patchIdentification(
  id: string,
  fields: Record<string, unknown>
): Promise<void> {
  await airtableWrite(`/${IDENTIFICATIONS_TABLE}/${id}`, 'PATCH', { fields });
}

export async function patchSuggestion(
  id: string,
  fields: Record<string, unknown>
): Promise<void> {
  await airtableWrite(`/${SUGGESTIONS_TABLE}/${id}`, 'PATCH', { fields });
}

// ── Applying an approved suggestion onto the image (Phase 2) ─────────────────
//
// Mirrors the hand-curation pattern: location facts resolve into the Places
// vocabulary (link the specific place — city/venue/neighborhood/county — with
// its State/County as attributes; never a standalone "state" chip). Dates set
// the image's Date taken; Events/Organizations find-or-create and link. Purely
// curatorial fields (editorial notes, description, credit line, …) have no safe
// automatic target and stay Approved for a human to fold in.

const IMAGES_TABLE = 'Images';
const PLACES_TABLE = 'Places';
const EVENTS_TABLE = 'Events';
const ORGS_TABLE = 'Organizations';

// Suggestion "Field name" -> Places "Type" for the fields that become places.
const PLACE_TYPE_BY_FIELD: Record<string, string> = {
  'City / Town': 'City / Town',
  Neighborhood: 'Neighborhood',
  'Specific venue': 'Specific venue',
  County: 'County / Region',
};

async function airtableRecord(table: string, id: string): Promise<any> {
  return airtableWrite(`/${table}/${id}`, 'GET');
}

/** Find a record by exact (case-insensitive) Name, or create it. */
async function findOrCreateNamed(
  table: string,
  name: string,
  extraOnCreate: Record<string, unknown> = {}
): Promise<string> {
  const clean = name.trim();
  if (!clean) throw new Error('Empty name.');
  const safe = clean.replace(/'/g, "\\'");
  const found = await airtableWrite(`/${table}`, 'GET', undefined, {
    filterByFormula: `LOWER({Name})=LOWER('${safe}')`,
    maxRecords: '1',
  });
  if (found.records?.length) return found.records[0].id;
  const created = await airtableWrite(`/${table}`, 'POST', { fields: { Name: clean, ...extraOnCreate } });
  return created.id;
}

/** Union new links into an image's link field (never drops existing links). */
async function addImageLinks(imageId: string, field: string, addIds: string[]): Promise<void> {
  if (!addIds.length) return;
  const img = await airtableRecord(IMAGES_TABLE, imageId);
  const current = (img.fields?.[field] ?? []) as string[];
  const union = [...new Set([...current, ...addIds])];
  await airtableWrite(`/${IMAGES_TABLE}/${imageId}`, 'PATCH', { fields: { [field]: union } });
}

/** State/County already approved on this image, to fill a new place's attributes. */
async function approvedLocationAttrs(imageId: string): Promise<{ state?: string; county?: string }> {
  const img = await airtableRecord(IMAGES_TABLE, imageId);
  const sugIds = (img.fields?.['Suggestions'] ?? []) as string[];
  const out: { state?: string; county?: string } = {};
  for (let i = 0; i < sugIds.length; i += 50) {
    const chunk = sugIds.slice(i, i + 50);
    const f = `OR(${chunk.map((id) => `RECORD_ID()='${id}'`).join(',')})`;
    const data = await airtableWrite(`/${SUGGESTIONS_TABLE}`, 'GET', undefined, {
      filterByFormula: f,
      pageSize: '100',
    });
    for (const r of data.records ?? []) {
      if (r.fields?.['Status'] !== 'Approved') continue;
      const fn = r.fields?.['Field name'];
      const val = String(r.fields?.['Proposed value'] ?? '').trim();
      if (fn === 'State' && val) out.state = val;
      if (fn === 'County' && val) out.county = val; // raw county name, e.g. "Lowndes"
    }
  }
  return out;
}

const countyPlaceName = (v: string) => (/county|parish|region/i.test(v) ? v : `${v} County`);

/** Drop any State-type place from an image once a more specific place is linked. */
async function removeStatePlaceLinks(imageId: string): Promise<void> {
  const img = await airtableRecord(IMAGES_TABLE, imageId);
  const placeIds = (img.fields?.['Places'] ?? []) as string[];
  if (placeIds.length < 2) return;
  const keep: string[] = [];
  let removed = false;
  for (const pid of placeIds) {
    const place = await airtableRecord(PLACES_TABLE, pid);
    if (String(place.fields?.['Type'] ?? '') === 'State') {
      removed = true;
      continue;
    }
    keep.push(pid);
  }
  if (removed) await airtableWrite(`/${IMAGES_TABLE}/${imageId}`, 'PATCH', { fields: { Places: keep } });
}

/** Image id + field + value for an approved suggestion, so it can be applied. */
export async function getSuggestionForReview(
  id: string
): Promise<{ imageId: string | null; fieldName: string; value: string }> {
  const rec = await airtableWrite(`/${SUGGESTIONS_TABLE}/${id}`, 'GET');
  return {
    imageId: (rec.fields?.['Image'] ?? [])[0] ?? null,
    fieldName: rec.fields?.['Field name'] ?? '',
    value: rec.fields?.['Proposed value'] ?? '',
  };
}

/**
 * Write an approved suggestion's value onto the image. Best-effort: returns
 * {applied:false, detail} for fields with no safe automatic target rather than
 * throwing, so a fact can be approved even when it must be applied by hand.
 */
export async function applyApprovedSuggestion(
  imageId: string,
  fieldName: string,
  value: string
): Promise<{ applied: boolean; detail?: string }> {
  const v = value.trim();
  if (!imageId || !v) return { applied: false, detail: 'Nothing to apply.' };

  if (fieldName === 'Date taken') {
    const m = v.match(/\d{4}-\d{2}-\d{2}/);
    if (!m) return { applied: false, detail: 'Unrecognized date — set it by hand.' };
    await airtableWrite(`/${IMAGES_TABLE}/${imageId}`, 'PATCH', { fields: { 'Date taken': m[0] } });
    return { applied: true };
  }

  if (fieldName === 'Events' || fieldName === 'Organizations') {
    const table = fieldName === 'Events' ? EVENTS_TABLE : ORGS_TABLE;
    const ids: string[] = [];
    for (const n of v.split(';').map((s) => s.trim()).filter(Boolean)) {
      ids.push(await findOrCreateNamed(table, n));
    }
    await addImageLinks(imageId, fieldName, ids);
    return { applied: true };
  }

  if (PLACE_TYPE_BY_FIELD[fieldName]) {
    const type = PLACE_TYPE_BY_FIELD[fieldName];
    const attrs = await approvedLocationAttrs(imageId);
    const extra: Record<string, unknown> = { Type: type };
    if (attrs.state) extra.State = attrs.state;
    if (fieldName !== 'County' && attrs.county) extra.County = attrs.county;
    const placeName = fieldName === 'County' ? countyPlaceName(v) : v;
    const pid = await findOrCreateNamed(PLACES_TABLE, placeName, extra);
    await addImageLinks(imageId, 'Places', [pid]);
    // A specific place supersedes a bare state chip — the state now lives as
    // the place's attribute, so drop any State-type place from the image.
    await removeStatePlaceLinks(imageId);
    return { applied: true };
  }

  if (fieldName === 'State') {
    const img = await airtableRecord(IMAGES_TABLE, imageId);
    const placeIds = (img.fields?.['Places'] ?? []) as string[];
    let hasSpecific = false;
    for (const pid of placeIds) {
      const place = await airtableRecord(PLACES_TABLE, pid);
      const ptype = String(place.fields?.['Type'] ?? '');
      if (ptype && ptype !== 'State') {
        hasSpecific = true;
        // Fill an empty state; never overwrite (Places are shared vocabulary).
        if (!String(place.fields?.['State'] ?? '').trim()) {
          await airtableWrite(`/${PLACES_TABLE}/${pid}`, 'PATCH', { fields: { State: v } });
        }
      }
    }
    if (hasSpecific) return { applied: true };
    // No specific place yet — link a state-level place so the image is findable
    // by state (e.g. a "photos from Mississippi" view) before a town is known.
    const pid = await findOrCreateNamed(PLACES_TABLE, v, { Type: 'State', State: v });
    await addImageLinks(imageId, 'Places', [pid]);
    return { applied: true };
  }

  // Description, Editorial notes, Original caption, Date notes, Credit line,
  // Rights holder, Publication history — curatorial; fold in by hand.
  return { applied: false, detail: 'Approved — fold this one in by hand.' };
}
