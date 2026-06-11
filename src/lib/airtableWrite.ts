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

/**
 * Find a Users record by email (preferred) or exact name; create one if
 * missing. This is the no-auth bridge into the schema's Users-linked
 * Submitter / Suggested-by fields.
 */
export async function findOrCreateUser(name: string, email: string): Promise<string> {
  const esc = (s: string) => s.replace(/'/g, "\\'").toLowerCase();
  let formula = '';
  if (email) {
    formula = `LOWER({Email})='${esc(email)}'`;
  } else if (name) {
    formula = `AND(LOWER({Name})='${esc(name)}', {Email}=BLANK())`;
  }
  if (formula) {
    const found = await airtableWrite(`/${USERS_TABLE}`, 'GET', undefined, {
      filterByFormula: formula,
      maxRecords: '1',
    });
    if (found.records?.length) return found.records[0].id;
  }
  const created = await airtableWrite(`/${USERS_TABLE}`, 'POST', {
    fields: {
      Name: name || 'Anonymous contributor',
      ...(email ? { Email: email } : {}),
      Role: 'Contributor',
      Status: 'Active',
      Notes: 'Created automatically by the alivingarchive.org contribution form.',
    },
  });
  return created.id;
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
