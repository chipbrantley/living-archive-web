/**
 * Public contribution endpoint for the Proof Positive exhibit (/jackson26).
 * POST /api/exhibit-suggest
 * {
 *   n: 32,                         // the exhibit item (Proof Positive #), 1–51
 *   people: ["Jane Doe", ...],     // names a visitor recognizes, ≤ 10
 *   note: "free text",             // what else they can tell us, ≤ 5000
 *   visitorName: "...",            // optional — who's contributing
 *   visitorContact: "...",         // optional — phone or email
 *   website: ""                    // honeypot — humans leave it empty
 * }
 *
 * NO login required (museum visitors scan with their own phones). Scoped to the
 * 51 exhibit items only, so the public can't write against arbitrary images.
 * Everything lands as Unverified/Pending, attributed to the shared "Proof
 * Positive visitor" account, with the visitor's own name/contact kept in the
 * note — then reviewed in /review before anything shows.
 */
import type { APIRoute } from 'astro';
import { fetchExhibitItemByNumber } from '../../lib/airtable';
import { createIdentification, createFieldSuggestion } from '../../lib/airtableWrite';

const ok = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

// Shared Users record for anonymous exhibit contributions (Airtable).
const EXHIBIT_VISITOR = 'recW7et1BgvZPCrsG';

export const POST: APIRoute = async ({ request }) => {
  let body: any;
  try {
    const raw = await request.text();
    if (raw.length > 20_000) return ok({ error: 'That was a bit long — try trimming it.' }, 413);
    body = JSON.parse(raw);
  } catch {
    return ok({ error: 'Invalid request.' }, 400);
  }

  // Honeypot: bots fill every field. Pretend success, write nothing.
  if (typeof body.website === 'string' && body.website.trim() !== '') {
    return ok({ ok: true });
  }

  const n = Number(body.n);
  if (!Number.isInteger(n) || n < 1 || n > 51) return ok({ error: 'Unknown exhibit item.' }, 400);

  const people: string[] = (Array.isArray(body.people) ? body.people : [])
    .map((p: unknown) => String(p ?? '').trim())
    .filter(Boolean)
    .slice(0, 10);
  const note = String(body.note ?? '').trim().slice(0, 5000);
  const visitorName = String(body.visitorName ?? '').trim().slice(0, 200);
  const visitorContact = String(body.visitorContact ?? '').trim().slice(0, 200);

  if (people.length === 0 && note === '') {
    return ok({ error: 'Add a name or a note, then submit.' }, 400);
  }

  try {
    const image = await fetchExhibitItemByNumber(n);
    if (!image) return ok({ error: 'Unknown exhibit item.' }, 404);

    const today = new Date().toISOString().slice(0, 10);

    for (const name of people) {
      await createIdentification(image.id, { name }, EXHIBIT_VISITOR, today);
    }

    // Keep the free-text note and who sent it together, as an Editorial note.
    const attribution = [visitorName, visitorContact].filter(Boolean).join(' · ');
    const noteParts = [note, attribution ? `— submitted at Proof Positive by ${attribution}` : '']
      .filter(Boolean);
    if (noteParts.length) {
      await createFieldSuggestion(image.id, 'Editorial notes', noteParts.join('\n'), EXHIBIT_VISITOR, today);
    }

    return ok({ ok: true, people: people.length });
  } catch (e) {
    console.error('exhibit-suggest:', e);
    return ok({ error: 'Something went wrong saving your contribution.' }, 500);
  }
};
