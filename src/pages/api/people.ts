/**
 * Person-typeahead search for the contribution form.
 * GET /api/people?q=mar  ->  { results: [{ id, name, meta }] }
 *
 * The full People list (~800 records) is cached in module memory so
 * keystroke-by-keystroke searches don't hammer Airtable's rate limit.
 */
import type { APIRoute } from 'astro';

const PAT = import.meta.env.AIRTABLE_PAT;
const BASE_ID = import.meta.env.AIRTABLE_BASE_ID;
const CACHE_TTL_MS = 10 * 60 * 1000;

interface CachedPerson {
  id: string;
  name: string;
  aliases: string;
  meta: string;
}

let cache: { at: number; people: CachedPerson[] } | null = null;

async function loadPeople(): Promise<CachedPerson[]> {
  if (cache && Date.now() - cache.at < CACHE_TTL_MS) return cache.people;
  const people: CachedPerson[] = [];
  let offset: string | undefined;
  do {
    const url = new URL(`https://api.airtable.com/v0/${BASE_ID}/People`);
    url.searchParams.set('pageSize', '100');
    for (const f of ['Name', 'Aliases', 'Affiliation']) {
      url.searchParams.append('fields[]', f);
    }
    if (offset) url.searchParams.set('offset', offset);
    const res = await fetch(url.toString(), {
      headers: { Authorization: `Bearer ${PAT}` },
    });
    if (!res.ok) throw new Error(`Airtable ${res.status}`);
    const data = await res.json();
    for (const r of data.records ?? []) {
      people.push({
        id: r.id,
        name: r.fields['Name'] ?? '',
        aliases: r.fields['Aliases'] ?? '',
        meta: r.fields['Affiliation'] ?? '',
      });
    }
    offset = data.offset;
  } while (offset);
  cache = { at: Date.now(), people };
  return people;
}

export const GET: APIRoute = async ({ url }) => {
  const q = (url.searchParams.get('q') ?? '').trim().toLowerCase();
  if (q.length < 2) {
    return new Response(JSON.stringify({ results: [] }), {
      headers: { 'Content-Type': 'application/json' },
    });
  }
  const people = await loadPeople();
  const results = people
    .filter(
      (p) =>
        p.name.toLowerCase().includes(q) || p.aliases.toLowerCase().includes(q)
    )
    .slice(0, 8)
    .map((p) => ({ id: p.id, name: p.name, meta: p.meta }));
  return new Response(JSON.stringify({ results }), {
    headers: { 'Content-Type': 'application/json' },
  });
};
