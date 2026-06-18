/**
 * GET /auth/callback — the magic-link lands here.
 * Exchanges the link for a session (sets cookies via the SSR client),
 * then sends the user to the signed-in confirmation.
 *
 * Supabase can deliver the link in two shapes depending on flow:
 *  - PKCE:  ?code=...            -> exchangeCodeForSession
 *  - OTP:   ?token_hash=&type=   -> verifyOtp
 * We handle both so we're not surprised by the email template's format.
 */
import type { APIRoute } from 'astro';
import { supabaseServer } from '../../lib/supabase';

export const GET: APIRoute = async (ctx) => {
  const url = ctx.url;
  const supabase = supabaseServer(ctx);

  const code = url.searchParams.get('code');
  const tokenHash = url.searchParams.get('token_hash');
  const type = url.searchParams.get('type');

  let error: string | null = null;
  if (code) {
    const { error: e } = await supabase.auth.exchangeCodeForSession(code);
    error = e?.message ?? null;
  } else if (tokenHash && type) {
    const { error: e } = await supabase.auth.verifyOtp({
      token_hash: tokenHash,
      type: type as any,
    });
    error = e?.message ?? null;
  } else {
    error = 'No sign-in token in the link.';
  }

  if (error) return ctx.redirect('/signin?error=' + encodeURIComponent(error));
  // Signed in — drop straight into the archive.
  return ctx.redirect('/');
};
