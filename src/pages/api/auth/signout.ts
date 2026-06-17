/** POST /api/auth/signout — clear the session. */
import type { APIRoute } from 'astro';
import { supabaseServer } from '../../../lib/supabase';

export const POST: APIRoute = async (ctx) => {
  const supabase = supabaseServer(ctx);
  await supabase.auth.signOut();
  return ctx.redirect('/signin');
};
