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
  identificationIds: string[];
  placeIds: string[];
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
    identificationIds: r.fields['Identifications'] ?? [],
    placeIds: r.fields['Places'] ?? [],
  };
}

export interface PersonChip {
  name: string;
  verified: boolean;
}
export interface PlaceChip {
  name: string;
  slug: string;
}

/**
 * Chips for an image detail page: identified people (dashed = unverified,
 * per the design language) and linked places (each linking to its page).
 */
export async function fetchImageChips(
  identificationIds: string[],
  placeIds: string[]
): Promise<{ people: PersonChip[]; places: PlaceChip[] }> {
  const people: PersonChip[] = [];
  if (identificationIds.length > 0) {
    const formula = `OR(${identificationIds.slice(0, 50).map((id) => `RECORD_ID()='${id}'`).join(',')})`;
    const idData = await airtable('/Identifications', { filterByFormula: formula, pageSize: '100' });
    const personIds: { id: string; verified: boolean }[] = [];
    for (const r of idData.records ?? []) {
      const pid = (r.fields['Person'] ?? [])[0];
      if (pid) {
        personIds.push({ id: pid, verified: r.fields['Verification status'] === 'Verified' });
      }
    }
    if (personIds.length > 0) {
      const pFormula = `OR(${personIds.map((p) => `RECORD_ID()='${p.id}'`).join(',')})`;
      const pData = await airtable('/People', { filterByFormula: pFormula, pageSize: '100' });
      const namesById: Record<string, string> = {};
      for (const r of pData.records ?? []) namesById[r.id] = r.fields['Name'] ?? '';
      for (const p of personIds) {
        const name = namesById[p.id];
        if (name && !people.some((x) => x.name === name)) {
          people.push({ name, verified: p.verified });
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
  return { people, places };
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
