/**
 * Vocabulary autocomplete for the contribution form.
 * GET /api/options?type=<kind>&q=<query>[&state=<state>]
 *
 * Kinds:
 *   city / neighborhood / venue — Places table, filtered by Type (curated,
 *     growing vocabulary; the form offers "+ suggest new" for misses)
 *   event — Events table
 *   org   — Organizations table (matches name and acronym)
 *   state — static list (closed set, no suggest-new)
 *   county — static Census list, filtered by ?state= when given (closed set)
 *
 * Airtable-backed lists are cached in module memory (10 min TTL).
 */
import type { APIRoute } from 'astro';
import countiesByState from '../../data/counties.json';

const PAT = import.meta.env.AIRTABLE_PAT;
const BASE_ID = import.meta.env.AIRTABLE_BASE_ID;
const CACHE_TTL_MS = 10 * 60 * 1000;

const STATES = [
  'Alabama','Alaska','Arizona','Arkansas','California','Colorado','Connecticut',
  'Delaware','DC','Florida','Georgia','Hawaii','Idaho','Illinois','Indiana',
  'Iowa','Kansas','Kentucky','Louisiana','Maine','Maryland','Massachusetts',
  'Michigan','Minnesota','Mississippi','Missouri','Montana','Nebraska','Nevada',
  'New Hampshire','New Jersey','New Mexico','New York','North Carolina',
  'North Dakota','Ohio','Oklahoma','Oregon','Pennsylvania','Rhode Island',
  'South Carolina','South Dakota','Tennessee','Texas','Utah','Vermont',
  'Virginia','Washington','West Virginia','Wisconsin','Wyoming',
];

interface Option {
  name: string;
  meta?: string;
  search?: string; // extra matchable text (aliases, acronyms)
}

const tableCache: Record<string, { at: number; options: Option[] }> = {};

async function fetchTable(
  table: string,
  fields: string[],
  toOption: (f: Record<string, any>) => Option | null,
  cacheKey?: string
): Promise<Option[]> {
  // Cache must be keyed per filtered view, not just per table — the Places
  // table serves three kinds (city/neighborhood/venue) with different filters.
  const key = cacheKey ?? table;
  const cached = tableCache[key];
  if (cached && Date.now() - cached.at < CACHE_TTL_MS) return cached.options;
  const options: Option[] = [];
  let offset: string | undefined;
  do {
    const url = new URL(`https://api.airtable.com/v0/${BASE_ID}/${table}`);
    url.searchParams.set('pageSize', '100');
    for (const f of fields) url.searchParams.append('fields[]', f);
    if (offset) url.searchParams.set('offset', offset);
    const res = await fetch(url.toString(), {
      headers: { Authorization: `Bearer ${PAT}` },
    });
    if (!res.ok) throw new Error(`Airtable ${res.status}`);
    const data = await res.json();
    for (const r of data.records ?? []) {
      const opt = toOption(r.fields ?? {});
      if (opt) options.push(opt);
    }
    offset = data.offset;
  } while (offset);
  tableCache[key] = { at: Date.now(), options };
  return options;
}

async function getOptions(kind: string, state: string): Promise<Option[]> {
  switch (kind) {
    case 'state':
      return STATES.map((name) => ({ name }));
    case 'county': {
      const all = countiesByState as Record<string, string[]>;
      if (state && all[state]) return all[state].map((name) => ({ name }));
      return Object.entries(all).flatMap(([st, names]) =>
        names.map((name) => ({ name, meta: st }))
      );
    }
    case 'city':
    case 'neighborhood':
    case 'venue': {
      const typeByKind: Record<string, string> = {
        city: 'City / Town',
        neighborhood: 'Neighborhood',
        venue: 'Specific venue',
      };
      const places = await fetchTable(
        'Places',
        ['Name', 'Type', 'State', 'County'],
        (f) => {
          const t = typeof f['Type'] === 'object' ? f['Type']?.name : f['Type'];
          if (t !== typeByKind[kind]) return null;
          const metaParts = [f['County'], f['State']].filter(Boolean);
          return { name: f['Name'] ?? '', meta: metaParts.join(', ') };
        },
        `Places:${kind}`
      );
      return places;
    }
    case 'event':
      return fetchTable('Events', ['Name', 'Start date'], (f) => ({
        name: f['Name'] ?? '',
        meta: (f['Start date'] ?? '').slice(0, 4),
      }));
    case 'org':
      return fetchTable('Organizations', ['Name', 'Acronym'], (f) => ({
        name: f['Name'] ?? '',
        meta: f['Acronym'] ?? '',
        search: f['Acronym'] ?? '',
      }));
    default:
      return [];
  }
}

export const GET: APIRoute = async ({ url }) => {
  const kind = url.searchParams.get('type') ?? '';
  const q = (url.searchParams.get('q') ?? '').trim().toLowerCase();
  const state = (url.searchParams.get('state') ?? '').trim();
  if (!kind || q.length < 1) {
    return new Response(JSON.stringify({ results: [] }), {
      headers: { 'Content-Type': 'application/json' },
    });
  }
  try {
    const options = await getOptions(kind, state);
    const results = options
      .filter(
        (o) =>
          o.name.toLowerCase().includes(q) ||
          (o.search ?? '').toLowerCase().includes(q)
      )
      .slice(0, 8)
      .map(({ name, meta }) => ({ name, meta: meta ?? '' }));
    return new Response(JSON.stringify({ results }), {
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (e) {
    console.error('options endpoint:', e);
    return new Response(JSON.stringify({ results: [] }), {
      headers: { 'Content-Type': 'application/json' },
    });
  }
};
