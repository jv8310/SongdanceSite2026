import type { APIRoute } from 'astro';
import { readCookie, verifySession } from '../../../../lib/registrations/auth';
import { reconcileStripeCourseOrders } from '../../../../lib/payments/stripe-reconcile';

export const prerender = false;

// Manual trigger for the Stripe course installment reconcile, from the
// Future-revenue page's "Sync from Stripe now" button. Same function the hourly
// cron runs — it just lets the owner recover a stuck plan on the spot (and prove
// the token/subscription resolve) instead of waiting for the next tick. Read-only
// against Stripe, idempotent (invoice-id guard), so re-clicking is harmless.
// A wider cap than the cron's default so a batch of stranded rows all clear at
// once.
export const POST: APIRoute = async ({ request, locals }) => {
  const env = locals.runtime.env;
  if (!(await verifySession(env.ADMIN_SESSION_SECRET, readCookie(request)))) {
    return new Response('Unauthorized', { status: 401 });
  }

  const form = await request.formData();
  const returnTo = safeReturnTo(String(form.get('return_to') ?? ''));

  if (!env.STRIPE_SECRET_KEY) {
    return redirect(returnTo, {
      flash: 'cancel_error',
      msg: 'Stripe is not configured in this environment.',
    });
  }

  try {
    const r = await reconcileStripeCourseOrders(env as any, {
      subDays: 120,
      cap: 100,
    });
    const msg =
      r.installments > 0
        ? `Synced from Stripe — recorded ${r.installments} installment(s) across ${r.subscriptions} plan(s).`
        : 'Synced from Stripe — nothing new to record (every plan is already up to date).';
    return redirect(returnTo, { flash: 'cancel_ok', msg });
  } catch (err) {
    return redirect(returnTo, {
      flash: 'cancel_error',
      msg: `Could not sync from Stripe: ${String(err).slice(0, 140)}`,
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
