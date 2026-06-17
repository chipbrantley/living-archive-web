/**
 * POST /api/auth/signin — send a passwordless magic link.
 * (Chunk 1: no allowlist check yet; that arrives with the gate.)
 */
import type { APIRoute } from 'astro';
import { supabaseServer } from '../../../lib/supabase';

export const POST: APIRoute = async (ctx) => {
  const form = await ctx.request.formData();
  const email = String(form.get('email') ?? '').trim().toLowerCase();
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
    return ctx.redirect('/signin?error=' + encodeURIComponent('Please enter a valid email.'));
  }
  const supabase = supabaseServer(ctx);
  const { error } = await supabase.auth.signInWithOtp({
    email,
    options: {
      emailRedirectTo: new URL('/auth/callback', ctx.url.origin).toString(),
    },
  });
  if (error) {
    return ctx.redirect('/signin?error=' + encodeURIComponent(error.message));
  }
  return ctx.redirect('/signin?sent=' + encodeURIComponent(email));
};
