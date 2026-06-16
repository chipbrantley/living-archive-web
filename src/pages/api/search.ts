/**
 * Live search for the dropdown. GET /api/search?q=canton
 * Returns jump-to entities (people, places, events) and a count of
 * matching photographs. The full /search page renders the image grid.
 */
import type { APIRoute } from 'astro';
import { search } from '../../lib/airtable';

export const GET: APIRoute = async ({ url }) => {
  const q = url.searchParams.get('q') ?? '';
  try {
    const { entities, imageIds } = await search(q);
    return new Response(
      JSON.stringify({ entities, imageCount: imageIds.length }),
      { headers: { 'Content-Type': 'application/json' } }
    );
  } catch (e) {
    console.error('search endpoint:', e);
    return new Response(JSON.stringify({ entities: [], imageCount: 0 }), {
      headers: { 'Content-Type': 'application/json' },
    });
  }
};
