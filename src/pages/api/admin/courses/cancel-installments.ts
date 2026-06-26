import type { APIRoute } from 'astro';
import { readCookie, verifySession } from '../../../../lib/registrations/auth';
import { scheduleInstallmentCancellation } from '../../../../lib/courses/installment-cancel';

export const prerender = false;

// Schedule (or clear) an early stop on a course installment plan from the
// Future-revenue page. `keep` is the number of charges still allowed before the
// plan stops: 0 = stop all upcoming now, remaining-1 = cancel only the last,
// remaining = keep the full plan (clears any earlier schedule). The orchestration
// lib re-derives everything from the DB row and drives Stripe / PayPal — we only
// pass the id + keep here, never amounts or gateway ids (can't be tampered with).
export const POST: APIRoute = async ({ request, locals }) => {
  const env = locals.runtime.env;
  if (!(await verifySession(env.ADMIN_SESSION_SECRET, readCookie(request)))) {
    return new Response('Unauthorized', { status: 401 });
  }

  const form = await request.formData();
  const idRaw = String(form.get('course_registration_id') ?? '').trim();
  const keepRaw = String(form.get('keep') ?? '').trim();
  const returnTo = safeReturnTo(String(form.get('return_to') ?? ''));

  const id = parseInt(idRaw, 10);
  if (!Number.isFinite(id) || id <= 0) {
    return redirect(returnTo, { flash: 'cancel_error', msg: 'Bad registration id' });
  }
  const keep = parseInt(keepRaw, 10);
  if (!Number.isFinite(keep) || keep < 0) {
    return redirect(returnTo, { flash: 'cancel_error', msg: 'Pick how many charges to keep' });
  }

  try {
    const result = await scheduleInstallmentCancellation(env as any, id, keep);
    if (!result.ok) {
      return redirect(returnTo, { flash: 'cancel_error', msg: result.reason });
    }
    const msg = result.cleared
      ? `Plan #${id} restored — billing the full schedule again`
      : result.immediate
        ? `Plan #${id} — all upcoming charges cancelled`
        : `Plan #${id} — will stop after ${result.target} total charge(s) (${result.keep} more)`;
    return redirect(returnTo, { flash: 'cancel_ok', msg });
  } catch (err) {
    return redirect(returnTo, {
      flash: 'cancel_error',
      msg: `Could not change the plan: ${String(err).slice(0, 140)}`,
    });
  }
};

function redirect(base: string, params: { flash: string; msg: string }): Response {
  const url = new URL(base, 'https://placeholder.local');
  url.searchParams.set('flash', params.flash);
  url.searchParams.set('msg', params.msg);
  const location = url.pathname + url.search;
  return new Response(null, { status: 302, headers: { Location: location } });
}

// Only allow same-site /admin/* redirects (return_to is user-supplied).
function safeReturnTo(raw: string): string {
  if (raw.startsWith('/admin/') || raw === '/admin') return raw;
  return '/admin/courses/future-revenue';
}
