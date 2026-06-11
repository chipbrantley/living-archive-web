/**
 * Contribution submission endpoint.
 * POST /api/suggest
 * {
 *   imageNumber: "1675427",
 *   people: [{ id?: "rec…", name: "Bayard Rustin" }],   // ≤ 10
 *   note: "free text",                                   // ≤ 5000 chars
 *   name: "Jane Doe",                                    // optional
 *   email: "jane@example.com",                           // optional
 *   website: ""                                          // honeypot — humans leave it empty
 * }
 *
 * People named -> Identifications records (Unverified).
 * Free text    -> a Pending Suggestions record (Editorial notes).
 * Submitter    -> found-or-created Users record.
 */
import type { APIRoute } from 'astro';
import { fetchImageByNumber } from '../../lib/airtable';
import {
  findOrCreateUser,
  createIdentification,
  createNoteSuggestion,
  type PersonSubmission,
} from '../../lib/airtableWrite';

const ok = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });

export const POST: APIRoute = async ({ request }) => {
  let body: any;
  try {
    const raw = await request.text();
    if (raw.length > 20_000) return ok({ error: 'Submission too large.' }, 413);
    body = JSON.parse(raw);
  } catch {
    return ok({ error: 'Invalid request.' }, 400);
  }

  // Honeypot: bots fill every field. Pretend success, write nothing.
  if (typeof body.website === 'string' && body.website.trim() !== '') {
    return ok({ ok: true });
  }

  const imageNumber = String(body.imageNumber ?? '').trim();
  const note = String(body.note ?? '').trim().slice(0, 5000);
  const submitterName = String(body.name ?? '').trim().slice(0, 200);
  const submitterEmail = String(body.email ?? '').trim().slice(0, 200);
  const peopleRaw = Array.isArray(body.people) ? body.people.slice(0, 10) : [];
  const people: PersonSubmission[] = peopleRaw
    .map((p: any) => ({
      id:
        typeof p?.id === 'string' && /^rec[A-Za-z0-9]{14}$/.test(p.id)
          ? p.id
          : undefined,
      name: String(p?.name ?? '').trim().slice(0, 200),
    }))
    .filter((p: PersonSubmission) => p.name !== '');

  if (!/^\d{7}$/.test(imageNumber)) {
    return ok({ error: 'Unknown image.' }, 400);
  }
  if (people.length === 0 && note === '') {
    return ok({ error: 'Nothing to submit.' }, 400);
  }

  try {
    const image = await fetchImageByNumber(imageNumber);
    if (!image) return ok({ error: 'Unknown image.' }, 404);

    const userRecId = await findOrCreateUser(submitterName, submitterEmail);
    const today = new Date().toISOString().slice(0, 10);

    for (const person of people) {
      await createIdentification(image.id, person, userRecId, today);
    }
    if (note) {
      await createNoteSuggestion(image.id, note, userRecId, today);
    }
    return ok({ ok: true, identifications: people.length, note: note !== '' });
  } catch (e) {
    console.error('suggest endpoint:', e);
    return ok({ error: 'Something went wrong saving your contribution.' }, 500);
  }
};
