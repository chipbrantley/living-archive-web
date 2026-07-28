/**
 * Admin review actions.
 * POST /api/review  { type: 'identification' | 'suggestion', id: 'rec…', action }
 *
 * identification actions:
 *   verify   -> Verified; links the Person (creating the People record from the
 *               proposed name if none exists yet)
 *   possible -> Possible (a candidate; kept for further research)
 *   reject   -> "Not this person" and unlink the Person (the name may be real,
 *               but this image isn't them)
 * suggestion actions: approve -> Approved, table -> Tabled, reject -> Rejected
 *
 * Gated to Admin / Verifier users. Phase 1: sets review status only — approving
 * a fact does not yet write the value onto the image.
 */
import type { APIRoute } from 'astro';
import {
  findOrCreatePerson,
  getIdentificationForReview,
  patchIdentification,
  patchSuggestion,
  getSuggestionForReview,
  applyApprovedSuggestion,
} from '../../lib/airtableWrite';

const ok = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

const REC = /^rec[A-Za-z0-9]{14}$/;

export const POST: APIRoute = async ({ request, locals }) => {
  const user = locals.user;
  if (!user?.id) return ok({ error: 'Please sign in.' }, 401);
  if (user.role !== 'Admin' && user.role !== 'Verifier') {
    return ok({ error: 'This action is for archive reviewers.' }, 403);
  }

  let body: any;
  try {
    body = JSON.parse(await request.text());
  } catch {
    return ok({ error: 'Invalid request.' }, 400);
  }

  const id = String(body.id ?? '');
  const type = String(body.type ?? '');
  const action = String(body.action ?? '');
  if (!REC.test(id)) return ok({ error: 'Unknown record.' }, 400);

  const today = new Date().toISOString().slice(0, 10);

  try {
    if (type === 'identification') {
      if (action === 'verify') {
        const { personId, proposedName } = await getIdentificationForReview(id);
        let pid = personId;
        if (!pid && proposedName) pid = await findOrCreatePerson(proposedName);
        const fields: Record<string, unknown> = {
          'Verification status': 'Verified',
          Reviewer: [user.id],
          'Reviewed on': today,
        };
        if (pid) fields.Person = [pid];
        await patchIdentification(id, fields);
      } else if (action === 'possible') {
        await patchIdentification(id, {
          'Verification status': 'Possible',
          Reviewer: [user.id],
          'Reviewed on': today,
        });
      } else if (action === 'reject') {
        await patchIdentification(id, {
          'Verification status': 'Not this person',
          Person: [],
          Reviewer: [user.id],
          'Reviewed on': today,
        });
      } else {
        return ok({ error: 'Unknown action.' }, 400);
      }
    } else if (type === 'suggestion') {
      const status =
        action === 'approve' ? 'Approved' : action === 'table' ? 'Tabled' : action === 'reject' ? 'Rejected' : null;
      if (!status) return ok({ error: 'Unknown action.' }, 400);
      await patchSuggestion(id, { Status: status, Reviewer: [user.id], 'Reviewed on': today });
      if (action === 'approve') {
        // Phase 2: write the approved value onto the image. Best-effort — the
        // approval stands even if the auto-apply can't place it.
        try {
          const s = await getSuggestionForReview(id);
          const res = await applyApprovedSuggestion(s.imageId ?? '', s.fieldName, s.value);
          return ok({ ok: true, applied: res.applied, detail: res.detail });
        } catch (e) {
          return ok({ ok: true, applied: false, detail: e instanceof Error ? e.message : 'Auto-apply failed.' });
        }
      }
    } else {
      return ok({ error: 'Unknown type.' }, 400);
    }
  } catch (e) {
    return ok({ error: e instanceof Error ? e.message : 'Write failed.' }, 500);
  }

  return ok({ ok: true });
};
