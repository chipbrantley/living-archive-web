/**
 * The invite allowlist: the set of people permitted into the archive.
 * Source of truth is the Airtable Users table. An email is allowed if it
 * has a Users record whose Status is not "Disabled" — so adding a Users
 * record with an email grants access; setting Status to Disabled revokes it.
 *
 * Cached in module memory (short TTL) so the gate doesn't hit Airtable on
 * every request.
 */
const PAT = import.meta.env.AIRTABLE_PAT;
const BASE_ID = import.meta.env.AIRTABLE_BASE_ID;
const USERS_TABLE = 'tblIDt7OEm0W2e1yV';
const TTL_MS = 60 * 1000;

export interface AllowedUser {
  id: string;
  email: string;
  name: string;
  role: string;
}

let cache: { at: number; byEmail: Map<string, AllowedUser> } | null = null;

async function loadAllowlist(): Promise<Map<string, AllowedUser>> {
  if (cache && Date.now() - cache.at < TTL_MS) return cache.byEmail;
  const byEmail = new Map<string, AllowedUser>();
  let offset: string | undefined;
  do {
    const url = new URL(`https://api.airtable.com/v0/${BASE_ID}/${USERS_TABLE}`);
    url.searchParams.set('pageSize', '100');
    for (const f of ['Name', 'Email', 'Role', 'Status']) url.searchParams.append('fields[]', f);
    if (offset) url.searchParams.set('offset', offset);
    const res = await fetch(url.toString(), { headers: { Authorization: `Bearer ${PAT}` } });
    if (!res.ok) throw new Error(`Airtable Users ${res.status}`);
    const data = await res.json();
    for (const r of data.records ?? []) {
      const email = String(r.fields['Email'] ?? '').trim().toLowerCase();
      if (!email) continue;
      if (r.fields['Status'] === 'Disabled') continue;
      byEmail.set(email, {
        id: r.id,
        email,
        name: r.fields['Name'] ?? '',
        role: r.fields['Role'] ?? 'Contributor',
      });
    }
    offset = data.offset;
  } while (offset);
  cache = { at: Date.now(), byEmail };
  return byEmail;
}

export async function lookupAllowed(email: string): Promise<AllowedUser | null> {
  const map = await loadAllowlist();
  return map.get(email.trim().toLowerCase()) ?? null;
}
