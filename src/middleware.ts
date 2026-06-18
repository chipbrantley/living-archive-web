/**
 * The gate. Every page/endpoint request passes through here:
 *  - public auth routes and static assets go straight through;
 *  - everything else requires a valid Supabase session whose email is on
 *    the Airtable allowlist. No session -> /signin. Signed in but not
 *    invited -> sign out + /signin?error=not-invited.
 *
 * The signed-in user (from the allowlist) is attached to locals.user.
 */
import { defineMiddleware } from 'astro:middleware';
import { supabaseServer } from './lib/supabase';
import { lookupAllowed } from './lib/allowlist';

const PUBLIC_PATHS = new Set([
  '/signin',
  '/auth/callback',
  '/api/auth/signin',
  '/api/auth/signout',
]);

function isPublic(pathname: string): boolean {
  if (PUBLIC_PATHS.has(pathname)) return true;
  // Static assets served by Netlify normally skip middleware, but guard anyway.
  return (
    pathname.startsWith('/_astro/') ||
    pathname.startsWith('/_image') ||
    pathname.startsWith('/favicon')
  );
}

export const onRequest = defineMiddleware(async (context, next) => {
  if (isPublic(context.url.pathname)) return next();

  const supabase = supabaseServer(context);
  const { data: { user } } = await supabase.auth.getUser();

  if (!user?.email) {
    return context.redirect('/signin');
  }

  const allowed = await lookupAllowed(user.email);
  if (!allowed) {
    await supabase.auth.signOut();
    return context.redirect('/signin?error=not-invited');
  }

  context.locals.user = {
    id: allowed.id,
    email: allowed.email,
    name: allowed.name,
    role: allowed.role,
  };
  return next();
});
