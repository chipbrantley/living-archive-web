/**
 * Server-side Supabase client for Astro SSR.
 * Reads cookies from the request and writes session cookies back through
 * Astro's cookie API, so @supabase/ssr can manage the magic-link session.
 */
import { createServerClient } from '@supabase/ssr';
import type { AstroCookies } from 'astro';

const SUPABASE_URL = import.meta.env.SUPABASE_URL;
const SUPABASE_KEY = import.meta.env.SUPABASE_PUBLISHABLE_KEY;

export function supabaseServer(ctx: { request: Request; cookies: AstroCookies }) {
  return createServerClient(SUPABASE_URL, SUPABASE_KEY, {
    cookies: {
      getAll() {
        const header = ctx.request.headers.get('cookie') ?? '';
        return header
          .split(';')
          .map((c) => c.trim())
          .filter(Boolean)
          .map((c) => {
            const i = c.indexOf('=');
            return { name: c.slice(0, i), value: decodeURIComponent(c.slice(i + 1)) };
          });
      },
      setAll(cookiesToSet) {
        for (const { name, value, options } of cookiesToSet) {
          ctx.cookies.set(name, value, options as any);
        }
      },
    },
  });
}
