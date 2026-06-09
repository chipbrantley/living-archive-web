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

export interface AirtableImage {
  id: string;
  imageNumber: string;
  photographerName: string | null;
  printIds: string[];
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
  const r = data.records[0];
  return {
    id: r.id,
    imageNumber: r.fields['Image number'] ?? imageNumber,
    photographerName: (r.fields['Photographer prefix'] ?? [])[0] ?? null,
    printIds: r.fields['Prints'] ?? [],
  };
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
