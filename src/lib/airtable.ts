/**
 * Thin Airtable REST client.
 * Reads the PAT from env at request time (server-side only).
 */

const PAT = import.meta.env.AIRTABLE_PAT;
const BASE_ID = import.meta.env.AIRTABLE_BASE_ID;

function assertConfigured(): void {
  if (!PAT) {
    throw new Error(
      'AIRTABLE_PAT is not set. Add it to .env.local (or to Netlify environment variables in production).'
    );
  }
  if (!BASE_ID) {
    throw new Error('AIRTABLE_BASE_ID is not set.');
  }
}

async function airtable(path: string, params?: Record<string, string>): Promise<any> {
  assertConfigured();
  const url = new URL(`https://api.airtable.com/v0/${BASE_ID}${path}`);
  if (params) {
    for (const [k, v] of Object.entries(params)) {
      url.searchParams.set(k, v);
    }
  }
  const res = await fetch(url.toString(), {
    headers: {
      Authorization: `Bearer ${PAT}`,
    },
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Airtable ${res.status}: ${body}`);
  }
  return res.json();
}

export interface AirtableImageFile {
  url: string;
  width?: number;
  height?: number;
  filename?: string;
  // Lo-res variant safe for public display.
  // Airtable's "large" thumbnail caps at ~1000px on the long side — plenty
  // for the browser, useless for any meaningful print. Falls back to the
  // original URL if Airtable hasn't generated the thumbnail yet.
  displayUrl: string;
  displayWidth?: number;
  displayHeight?: number;
}

export interface AirtableImage {
  id: string;
  imageNumber: string;
  photographerName: string | null;
  printIds: string[];
  title: string | null;
  caption: string | null;
  imageFile: AirtableImageFile | null;
  featured: boolean;
  identificationIds: string[];
  placeIds: string[];
  suggestionIds: string[];
  eventIds: string[];
  orgIds: string[];
  dateTaken: string | null;
  displayCaption: string | null;
  scanSource: string | null;
}

export interface AirtablePrint {
  id: string;
  ppNumber: string;
  size: string | null;
  mounting: string | null;
  authentication: string | null;
}

/**
 * Fetch a single Image by its photographer-assigned image number
 * (e.g., "1675427" for a Matt Herron image).
 */
export async function fetchImageByNumber(imageNumber: string): Promise<AirtableImage | null> {
  // Escape single quotes for the formula.
  const safe = imageNumber.replace(/'/g, "\\'");
  const data = await airtable('/Images', {
    filterByFormula: `{Image number}='${safe}'`,
    maxRecords: '1',
  });
  if (!data.records?.length) return null;
  return mapImageRecord(data.records[0]);
}

/**
 * Fetch Print records by record IDs.
 * Airtable's formula has a character limit; for very large lists we'd
 * batch this. For our small per-image counts it's fine.
 */
export async function fetchPrintsByIds(printIds: string[]): Promise<AirtablePrint[]> {
  if (printIds.length === 0) return [];
  const orClause = printIds.map((id) => `RECORD_ID()='${id}'`).join(',');
  const data = await airtable('/Prints', {
    filterByFormula: `OR(${orClause})`,
    pageSize: String(Math.min(printIds.length, 100)),
  });
  return (data.records ?? []).map((r: any) => ({
    id: r.id,
    ppNumber: r.fields['PP #'] ?? '',
    size: r.fields['Print size'] ?? null,
    mounting: r.fields['Mounting'] ?? null,
    authentication: r.fields['Authentication'] ?? null,
  }));
}

/**
 * Quick sanity check that the token works.
 * Returns null if the connection is fine, or an error message string.
 */
export async function pingAirtable(): Promise<string | null> {
  try {
    await airtable('/Images', { maxRecords: '1' });
    return null;
  } catch (e) {
    return e instanceof Error ? e.message : String(e);
  }
}

/**
 * Fetch all Image records that have an Image file attached.
 * Sorted by Image number ascending.
 */
export async function fetchImagesWithFiles(): Promise<AirtableImage[]> {
  const params: Record<string, string> = {
    filterByFormula: `NOT({Image file} = BLANK())`,
    pageSize: '100',
    'sort[0][field]': 'Image number',
    'sort[0][direction]': 'asc',
  };
  // Airtable returns at most 100 records per request; follow the offset
  // cursor until the listing is complete.
  const records: any[] = [];
  let offset: string | undefined;
  do {
    const data = await airtable('/Images', offset ? { ...params, offset } : params);
    records.push(...(data.records ?? []));
    offset = data.offset;
  } while (offset);
  return records.map(mapImageRecord);
}

function mapImageRecord(r: any): AirtableImage {
  const attachments = (r.fields['Image file'] ?? []) as any[];
  const firstAttachment = attachments[0];
  const large = firstAttachment?.thumbnails?.large;
  const imageFile: AirtableImageFile | null = firstAttachment
    ? {
        url: firstAttachment.url,
        width: firstAttachment.width,
        height: firstAttachment.height,
        filename: firstAttachment.filename,
        displayUrl: large?.url ?? firstAttachment.url,
        displayWidth: large?.width ?? firstAttachment.width,
        displayHeight: large?.height ?? firstAttachment.height,
      }
    : null;
  return {
    id: r.id,
    imageNumber: r.fields['Image number'] ?? '',
    photographerName: (r.fields['Photographer prefix'] ?? [])[0] ?? null,
    printIds: r.fields['Prints'] ?? [],
    title: r.fields['Title'] ?? null,
    caption: r.fields['Caption'] ?? null,
    imageFile,
    featured: r.fields['Featured'] === true,
    identificationIds: r.fields['Identifications'] ?? [],
    placeIds: r.fields['Places'] ?? [],
    suggestionIds: r.fields['Suggestions'] ?? [],
    eventIds: r.fields['Events'] ?? [],
    orgIds: r.fields['Organizations'] ?? [],
    dateTaken: r.fields['Date taken'] ?? null,
    displayCaption: r.fields['Display caption'] ?? null,
    scanSource: r.fields['Scan source'] ?? null,
  };
}

export interface PersonChip {
  name: string;
  slug: string;
  verified: boolean;
}
export interface PlaceChip {
  name: string;
  slug: string;
  via?: string; // contextual tag: place connected through a person in the image
}
export interface LogEntry {
  text: string;
  date: string | null; // ISO date
  by?: string | null; // contributor's name, once attribution exists
}
// Internal: a log entry still carrying the submitter's Users record id,
// before we resolve it to a name.
type RawLogEntry = LogEntry & { byUserId?: string | null };

const prettyDate = (iso: string | null): string | null => {
  if (!iso) return null;
  const d = new Date(iso + 'T00:00:00');
  return isNaN(d.getTime())
    ? iso
    : d.toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });
};

/**
 * The image page's connective tissue: person chips (dashed = unverified),
 * place chips (link to place pages), and the contribution log — Verified
 * identifications and Approved suggestions, displayed as the archive's
 * learning history. Pending material never appears publicly.
 */
export interface EventChip {
  name: string;
  slug: string;
}
export interface OrgChip {
  name: string;
  acronym: string | null;
}

export async function fetchImageChips(
  identificationIds: string[],
  placeIds: string[],
  suggestionIds: string[] = [],
  eventIds: string[] = [],
  orgIds: string[] = []
): Promise<{
  people: PersonChip[];
  places: PlaceChip[];        // taken-here — a map could trust these
  contextPlaces: PlaceChip[]; // connected through a person — context, not location
  events: EventChip[];
  orgs: OrgChip[];
  log: LogEntry[];
}> {
  const people: PersonChip[] = [];
  const contextPlaces: PlaceChip[] = [];
  const events: EventChip[] = [];
  const orgs: OrgChip[] = [];
  const log: RawLogEntry[] = [];
  if (eventIds.length > 0) {
    const formula = `OR(${eventIds.slice(0, 50).map((id) => `RECORD_ID()='${id}'`).join(',')})`;
    const data = await airtable('/Events', { filterByFormula: formula, pageSize: '100' });
    for (const r of data.records ?? []) {
      const name = r.fields['Name'] ?? '';
      if (name) events.push({ name, slug: slugifyPlace(name) });
    }
  }
  if (orgIds.length > 0) {
    const formula = `OR(${orgIds.slice(0, 50).map((id) => `RECORD_ID()='${id}'`).join(',')})`;
    const data = await airtable('/Organizations', { filterByFormula: formula, pageSize: '100' });
    for (const r of data.records ?? []) {
      const name = r.fields['Name'] ?? '';
      if (name) orgs.push({ name, acronym: r.fields['Acronym'] ?? null });
    }
  }
  if (identificationIds.length > 0) {
    const formula = `OR(${identificationIds.slice(0, 50).map((id) => `RECORD_ID()='${id}'`).join(',')})`;
    const idData = await airtable('/Identifications', { filterByFormula: formula, pageSize: '100' });
    const personIds: { id: string; verified: boolean; on: string | null; by: string | null }[] = [];
    for (const r of idData.records ?? []) {
      const pid = (r.fields['Person'] ?? [])[0];
      if (pid) {
        personIds.push({
          id: pid,
          verified: r.fields['Verification status'] === 'Verified',
          on: r.fields['Suggested on'] ?? null,
          by: (r.fields['Suggested by'] ?? [])[0] ?? null,
        });
      }
    }
    if (personIds.length > 0) {
      const pFormula = `OR(${personIds.map((p) => `RECORD_ID()='${p.id}'`).join(',')})`;
      const pData = await airtable('/People', { filterByFormula: pFormula, pageSize: '100' });
      const byId: Record<string, { name: string; homePlaceIds: string[] }> = {};
      for (const r of pData.records ?? []) {
        byId[r.id] = { name: r.fields['Name'] ?? '', homePlaceIds: r.fields['Places'] ?? [] };
      }
      // Resolve hometown names for "of Marion" chip context.
      const homeIds = [...new Set(Object.values(byId).flatMap((p) => p.homePlaceIds))];
      const homeNames: Record<string, string> = {};
      if (homeIds.length > 0) {
        const hFormula = `OR(${homeIds.slice(0, 50).map((id) => `RECORD_ID()='${id}'`).join(',')})`;
        const hData = await airtable('/Places', { filterByFormula: hFormula, pageSize: '100' });
        for (const r of hData.records ?? []) homeNames[r.id] = r.fields['Name'] ?? '';
      }
      for (const p of personIds) {
        const person = byId[p.id];
        if (person?.name && !people.some((x) => x.name === person.name)) {
          people.push({ name: person.name, slug: slugifyPlace(person.name), verified: p.verified });
          // A person's own places become contextual tags on the image —
          // "Marion is here because Doris is here," not a photo location.
          for (const hid of person.homePlaceIds) {
            const name = homeNames[hid];
            if (name && !contextPlaces.some((c) => c.name === name)) {
              contextPlaces.push({ name, slug: slugifyPlace(name), via: person.name });
            }
          }
          if (p.verified) {
            log.push({
              text: `${person.name} identified in this photograph`,
              date: p.on,
              byUserId: p.by,
            });
          }
        }
      }
    }
  }
  const places: PlaceChip[] = [];
  if (placeIds.length > 0) {
    const formula = `OR(${placeIds.slice(0, 50).map((id) => `RECORD_ID()='${id}'`).join(',')})`;
    const data = await airtable('/Places', { filterByFormula: formula, pageSize: '100' });
    for (const r of data.records ?? []) {
      const name = r.fields['Name'] ?? '';
      if (name) places.push({ name, slug: slugifyPlace(name) });
    }
    places.sort((a, b) => a.name.localeCompare(b.name));
  }
  if (suggestionIds.length > 0) {
    const formula = `OR(${suggestionIds.slice(0, 50).map((id) => `RECORD_ID()='${id}'`).join(',')})`;
    const data = await airtable('/Suggestions', { filterByFormula: formula, pageSize: '100' });
    for (const r of data.records ?? []) {
      if (r.fields['Status'] !== 'Approved') continue;
      const fieldName = r.fields['Field name'] ?? 'Context';
      const value = (r.fields['Proposed value'] ?? '').trim();
      if (!value) continue;
      const label = fieldName === 'Editorial notes' ? 'Community context' : fieldName;
      log.push({
        text: `${label}: ${value}`,
        date: r.fields['Submitted on'] ?? null,
        byUserId: (r.fields['Submitter'] ?? [])[0] ?? null,
      });
    }
  }

  // Resolve submitter ids -> names (skip the shared "Anonymous contributor").
  const byIds = [...new Set(log.map((e) => e.byUserId).filter(Boolean) as string[])];
  if (byIds.length > 0) {
    const formula = `OR(${byIds.slice(0, 50).map((id) => `RECORD_ID()='${id}'`).join(',')})`;
    const data = await airtable('/Users', { filterByFormula: formula, pageSize: '100' });
    const nameById: Record<string, string> = {};
    for (const r of data.records ?? []) nameById[r.id] = r.fields['Name'] ?? '';
    for (const e of log) {
      const name = e.byUserId ? nameById[e.byUserId] : '';
      e.by = name && name !== 'Anonymous contributor' ? name : null;
      delete e.byUserId;
    }
  }

  log.sort((a, b) => (b.date ?? '').localeCompare(a.date ?? ''));
  // Canonical chip order is rendered by the page; alphabetize within groups here.
  people.sort((a, b) => a.name.localeCompare(b.name));
  events.sort((a, b) => a.name.localeCompare(b.name));
  orgs.sort((a, b) => (a.acronym || a.name).localeCompare(b.acronym || b.name));
  const dedupedContext = contextPlaces
    .filter((c) => !places.some((p) => p.name === c.name))
    .sort((a, b) => a.name.localeCompare(b.name));
  return { people, places, contextPlaces: dedupedContext, events, orgs, log };
}

export { prettyDate };

// ----------------------------------------------------------------------
// Entity-aware search. A module-cached index across the navigable graph
// (people, places, events — each has a page) plus image text (number,
// title, caption). Entities become jump-to results; images become a grid.

export interface SearchEntity {
  type: 'person' | 'place' | 'event';
  name: string;
  url: string;
  meta: string;
}
export interface SearchResult {
  entities: SearchEntity[];
  imageIds: string[]; // ids of images whose text matches; fetch for display
}

interface SearchIndex {
  people: { name: string; aliases: string; slug: string; meta: string }[];
  places: { name: string; slug: string; meta: string }[];
  events: { name: string; slug: string }[];
  images: { id: string; number: string; text: string }[];
}

let searchIndexCache: { at: number; index: SearchIndex } | null = null;
const SEARCH_TTL_MS = 2 * 60 * 1000;

async function listAll(table: string, fields: string[]): Promise<any[]> {
  const out: any[] = [];
  let offset: string | undefined;
  do {
    const params: Record<string, string> = { pageSize: '100' };
    fields.forEach((f, i) => (params[`fields[${i}]`] = f));
    if (offset) params.offset = offset;
    const data = await airtable(`/${table}`, params);
    out.push(...(data.records ?? []));
    offset = data.offset;
  } while (offset);
  return out;
}

async function getSearchIndex(): Promise<SearchIndex> {
  if (searchIndexCache && Date.now() - searchIndexCache.at < SEARCH_TTL_MS) {
    return searchIndexCache.index;
  }
  const [people, places, events, images] = await Promise.all([
    listAll('People', ['Name', 'Aliases', 'Affiliation']),
    listAll('Places', ['Name', 'Type', 'State', 'County']),
    listAll('Events', ['Name', 'Start date']),
    listAll('Images', ['Image number', 'Title', 'Caption', 'Display caption', 'Image file']),
  ]);
  const index: SearchIndex = {
    people: people
      .filter((r) => r.fields['Name'])
      .map((r) => ({
        name: r.fields['Name'],
        aliases: (r.fields['Aliases'] ?? '').replace(/\n/g, ' '),
        slug: slugifyPlace(r.fields['Name']),
        meta: r.fields['Affiliation'] ?? '',
      })),
    places: places
      .filter((r) => r.fields['Name'])
      .map((r) => ({
        name: r.fields['Name'],
        slug: slugifyPlace(r.fields['Name']),
        meta: [r.fields['County'], r.fields['State']].filter(Boolean).join(', '),
      })),
    events: events
      .filter((r) => r.fields['Name'])
      .map((r) => ({ name: r.fields['Name'], slug: slugifyPlace(r.fields['Name']) })),
    images: images
      .filter((r) => (r.fields['Image file'] ?? []).length > 0)
      .map((r) => ({
        id: r.id,
        number: r.fields['Image number'] ?? '',
        text: [r.fields['Image number'], r.fields['Title'], r.fields['Display caption'], r.fields['Caption']]
          .filter(Boolean)
          .join(' ')
          .toLowerCase(),
      })),
  };
  searchIndexCache = { at: Date.now(), index };
  return index;
}

export async function search(query: string): Promise<SearchResult> {
  const q = query.trim().toLowerCase();
  if (q.length < 2) return { entities: [], imageIds: [] };
  const idx = await getSearchIndex();
  const entities: SearchEntity[] = [];
  for (const p of idx.places) {
    if (p.name.toLowerCase().includes(q)) {
      entities.push({ type: 'place', name: p.name, url: `/place/${p.slug}`, meta: p.meta });
    }
  }
  for (const e of idx.events) {
    if (e.name.toLowerCase().includes(q)) {
      entities.push({ type: 'event', name: e.name, url: `/event/${e.slug}`, meta: '' });
    }
  }
  for (const p of idx.people) {
    if (p.name.toLowerCase().includes(q) || p.aliases.toLowerCase().includes(q)) {
      entities.push({ type: 'person', name: p.name, url: `/person/${p.slug}`, meta: p.meta });
    }
  }
  // Exact-name matches first, then alphabetical; cap for the dropdown.
  entities.sort((a, b) => {
    const ax = a.name.toLowerCase() === q ? 0 : 1;
    const bx = b.name.toLowerCase() === q ? 0 : 1;
    return ax - bx || a.name.localeCompare(b.name);
  });
  const imageIds = idx.images.filter((im) => im.text.includes(q)).map((im) => im.id);
  return { entities: entities.slice(0, 12), imageIds };
}

export interface AirtablePerson {
  id: string;
  name: string;
  affiliation: string | null;
  lifespan: string | null;
  bio: string | null;
  bioSource: string | null;
  aliases: string[];
  backgroundLinks: string[];
  placeIds: string[];
  identificationIds: string[];
}

// Shared person index (id, name, slug) so person-page lookups don't refetch
// ~800 records per request. Module-level cache, same pattern as /api/people.
let peopleIndexCache: { at: number; index: { id: string; name: string; slug: string }[] } | null = null;
const PEOPLE_INDEX_TTL_MS = 2 * 60 * 1000;

async function peopleIndex(): Promise<{ id: string; name: string; slug: string }[]> {
  if (peopleIndexCache && Date.now() - peopleIndexCache.at < PEOPLE_INDEX_TTL_MS) {
    return peopleIndexCache.index;
  }
  const index: { id: string; name: string; slug: string }[] = [];
  let offset: string | undefined;
  do {
    const params: Record<string, string> = { 'fields[]': 'Name', pageSize: '100' };
    if (offset) params.offset = offset;
    const data = await airtable('/People', params);
    for (const r of data.records ?? []) {
      const name = r.fields['Name'] ?? '';
      if (name) index.push({ id: r.id, name, slug: slugifyPlace(name) });
    }
    offset = data.offset;
  } while (offset);
  peopleIndexCache = { at: Date.now(), index };
  return index;
}

export async function fetchPersonBySlug(slug: string): Promise<AirtablePerson | null> {
  const index = await peopleIndex();
  const hit = index.find((p) => p.slug === slug);
  if (!hit) return null;
  const r = (await airtable(`/People/${hit.id}`)) as any;
  const f = r.fields ?? {};
  const lines = (v: unknown): string[] =>
    String(v ?? '').split('\n').map((s: string) => s.trim()).filter(Boolean);
  return {
    id: r.id,
    name: f['Name'] ?? hit.name,
    affiliation: f['Affiliation'] ?? null,
    lifespan: f['Lifespan'] ?? null,
    bio: f['Bio'] ?? null,
    bioSource: f['Bio source'] ?? null,
    aliases: lines(f['Aliases']),
    backgroundLinks: lines(f['Background / context links']),
    placeIds: f['Places'] ?? [],
    identificationIds: f['Identifications'] ?? [],
  };
}

/** Image record ids from a person's identifications. */
export async function fetchIdentifiedImageIds(identificationIds: string[]): Promise<string[]> {
  const imageIds: string[] = [];
  for (let i = 0; i < identificationIds.length; i += 50) {
    const chunk = identificationIds.slice(i, i + 50);
    const formula = `OR(${chunk.map((id) => `RECORD_ID()='${id}'`).join(',')})`;
    const data = await airtable('/Identifications', { filterByFormula: formula, pageSize: '100' });
    for (const r of data.records ?? []) {
      for (const imgId of r.fields['Image'] ?? []) {
        if (!imageIds.includes(imgId)) imageIds.push(imgId);
      }
    }
  }
  return imageIds;
}

export interface AirtableEvent {
  id: string;
  name: string;
  type: string | null;
  startDate: string | null;
  endDate: string | null;
  location: string | null;
  bio: string | null;
  bioSource: string | null;
  backgroundLinks: string[];
  keyPeopleIds: string[];
  imageIds: string[];
  orgIds: string[];
}

export async function fetchEventBySlug(slug: string): Promise<AirtableEvent | null> {
  const records: any[] = [];
  let offset: string | undefined;
  do {
    const params: Record<string, string> = { pageSize: '100' };
    if (offset) params.offset = offset;
    const data = await airtable('/Events', params);
    records.push(...(data.records ?? []));
    offset = data.offset;
  } while (offset);
  const r = records.find((rec) => slugifyPlace(rec.fields['Name'] ?? '') === slug);
  if (!r) return null;
  const f = r.fields;
  const lines = (v: unknown): string[] =>
    String(v ?? '').split('\n').map((s: string) => s.trim()).filter(Boolean);
  return {
    id: r.id,
    name: f['Name'] ?? '',
    type: f['Type'] ?? null,
    startDate: f['Start date'] ?? null,
    endDate: f['End date'] ?? null,
    location: f['Location'] ?? null,
    bio: f['Bio'] ?? null,
    bioSource: f['Bio source'] ?? null,
    backgroundLinks: lines(f['Background / context links']),
    keyPeopleIds: f['Key people'] ?? [],
    imageIds: f['Images'] ?? [],
    orgIds: f['Organizations'] ?? [],
  };
}

export interface AirtablePhotographer {
  id: string;
  name: string;
  prefix: string | null;
  bio: string | null;
  activeDates: string | null;
  rightsHolder: string | null;
  portraitUrl: string | null;
  imageIds: string[];
}

/** Find a Photographer by URL slug (slugified name); imageIds = reverse link. */
export async function fetchPhotographerBySlug(slug: string): Promise<AirtablePhotographer | null> {
  const records: any[] = [];
  let offset: string | undefined;
  do {
    const params: Record<string, string> = { pageSize: '100' };
    if (offset) params.offset = offset;
    const data = await airtable('/Photographers', params);
    records.push(...(data.records ?? []));
    offset = data.offset;
  } while (offset);
  const r = records.find((rec) => slugifyPlace(rec.fields['Name'] ?? '') === slug);
  if (!r) return null;
  const f = r.fields;
  const portrait = (f['Portrait'] ?? [])[0];
  return {
    id: r.id,
    name: f['Name'] ?? '',
    prefix: f['Prefix'] ?? null,
    bio: f['Bio'] ?? null,
    activeDates: f['Active dates'] ?? null,
    rightsHolder: f['Estate / rights holder'] ?? null,
    portraitUrl: portrait ? (portrait.thumbnails?.large?.url ?? portrait.url) : null,
    imageIds: f['Images'] ?? [],
  };
}

/** Org chips for a set of Organizations record ids. */
export async function fetchOrgChipsByIds(ids: string[]): Promise<OrgChip[]> {
  if (ids.length === 0) return [];
  const formula = `OR(${ids.slice(0, 50).map((id) => `RECORD_ID()='${id}'`).join(',')})`;
  const data = await airtable('/Organizations', { filterByFormula: formula, pageSize: '100' });
  const chips: OrgChip[] = [];
  for (const r of data.records ?? []) {
    const name = r.fields['Name'] ?? '';
    if (name) chips.push({ name, acronym: r.fields['Acronym'] ?? null });
  }
  return chips;
}

/** Names + slugs for a set of People record ids (key-people rows, etc.). */
export async function fetchPeopleNamesByIds(ids: string[]): Promise<{ name: string; slug: string }[]> {
  if (ids.length === 0) return [];
  const out: { name: string; slug: string }[] = [];
  for (let i = 0; i < ids.length; i += 50) {
    const chunk = ids.slice(i, i + 50);
    const formula = `OR(${chunk.map((id) => `RECORD_ID()='${id}'`).join(',')})`;
    const data = await airtable('/People', { filterByFormula: formula, pageSize: '100' });
    for (const r of data.records ?? []) {
      const name = r.fields['Name'] ?? '';
      if (name) out.push({ name, slug: slugifyPlace(name) });
    }
  }
  out.sort((a, b) => a.name.localeCompare(b.name));
  return out;
}

/** Resolve Places record ids to chips. */
export async function fetchPlaceChipsByIds(placeIds: string[]): Promise<PlaceChip[]> {
  if (placeIds.length === 0) return [];
  const formula = `OR(${placeIds.slice(0, 50).map((id) => `RECORD_ID()='${id}'`).join(',')})`;
  const data = await airtable('/Places', { filterByFormula: formula, pageSize: '100' });
  const chips: PlaceChip[] = [];
  for (const r of data.records ?? []) {
    const name = r.fields['Name'] ?? '';
    if (name) chips.push({ name, slug: slugifyPlace(name) });
  }
  return chips;
}

export interface AirtablePlace {
  id: string;
  name: string;
  type: string | null;
  state: string | null;
  county: string | null;
  notes: string | null;
  imageIds: string[];
  peopleIds: string[];
}

export interface PersonWithImages {
  id: string;
  name: string;
  images: AirtableImage[];
}

export const slugifyPlace = (name: string): string =>
  name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');

/**
 * Find a Place by its URL slug. Fetches the (small) Places table and matches
 * on the slugified name; imageIds comes from the auto-created reverse link.
 */
export async function fetchPlaceBySlug(slug: string): Promise<AirtablePlace | null> {
  const records: any[] = [];
  let offset: string | undefined;
  do {
    const params: Record<string, string> = { pageSize: '100' };
    if (offset) params.offset = offset;
    const data = await airtable('/Places', params);
    records.push(...(data.records ?? []));
    offset = data.offset;
  } while (offset);
  const r = records.find((rec) => slugifyPlace(rec.fields['Name'] ?? '') === slug);
  if (!r) return null;
  return {
    id: r.id,
    name: r.fields['Name'] ?? '',
    type: r.fields['Type'] ?? null,
    state: r.fields['State'] ?? null,
    county: r.fields['County'] ?? null,
    notes: r.fields['Notes'] ?? null,
    imageIds: r.fields['Images'] ?? [],
    peopleIds: r.fields['People'] ?? [],
  };
}

/**
 * For "people of this place": fetch each person's identified images.
 * Person -> Identifications -> Images. Includes unverified identifications
 * (inner-circle phase; tighten to Verified-only when the site goes public).
 */
export async function fetchPeopleWithImages(peopleIds: string[]): Promise<PersonWithImages[]> {
  if (peopleIds.length === 0) return [];
  const people: { id: string; name: string; identificationIds: string[] }[] = [];
  for (let i = 0; i < peopleIds.length; i += 50) {
    const chunk = peopleIds.slice(i, i + 50);
    const formula = `OR(${chunk.map((id) => `RECORD_ID()='${id}'`).join(',')})`;
    const data = await airtable('/People', { filterByFormula: formula, pageSize: '100' });
    for (const r of data.records ?? []) {
      people.push({
        id: r.id,
        name: r.fields['Name'] ?? '',
        identificationIds: r.fields['Identifications'] ?? [],
      });
    }
  }
  const result: PersonWithImages[] = [];
  for (const person of people) {
    if (person.identificationIds.length === 0) {
      result.push({ id: person.id, name: person.name, images: [] });
      continue;
    }
    const imageIds: string[] = [];
    for (let i = 0; i < person.identificationIds.length; i += 50) {
      const chunk = person.identificationIds.slice(i, i + 50);
      const formula = `OR(${chunk.map((id) => `RECORD_ID()='${id}'`).join(',')})`;
      const data = await airtable('/Identifications', { filterByFormula: formula, pageSize: '100' });
      for (const r of data.records ?? []) {
        for (const imgId of r.fields['Image'] ?? []) {
          if (!imageIds.includes(imgId)) imageIds.push(imgId);
        }
      }
    }
    const images = imageIds.length ? (await fetchImagesByIds(imageIds)).filter((i) => i.imageFile) : [];
    result.push({ id: person.id, name: person.name, images });
  }
  result.sort((a, b) => b.images.length - a.images.length || a.name.localeCompare(b.name));
  return result;
}

/** Fetch Image records by record id, in chunks (formula length limits). */
export async function fetchImagesByIds(ids: string[]): Promise<AirtableImage[]> {
  const images: AirtableImage[] = [];
  for (let i = 0; i < ids.length; i += 50) {
    const chunk = ids.slice(i, i + 50);
    const formula = `OR(${chunk.map((id) => `RECORD_ID()='${id}'`).join(',')})`;
    let offset: string | undefined;
    do {
      const params: Record<string, string> = {
        filterByFormula: formula,
        pageSize: '100',
      };
      if (offset) params.offset = offset;
      const data = await airtable('/Images', params);
      images.push(...(data.records ?? []).map(mapImageRecord));
      offset = data.offset;
    } while (offset);
  }
  images.sort((a, b) => a.imageNumber.localeCompare(b.imageNumber));
  return images;
}
