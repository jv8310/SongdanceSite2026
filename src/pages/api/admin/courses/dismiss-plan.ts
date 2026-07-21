import type { APIRoute } from 'astro';
import { readCookie, verifySession } from '../../../../lib/registrations/auth';
import { logEvent } from '../../../../lib/registrations/db';
import {
  deleteCourseRegistration,
  getCourseRegistrationById,
} from '../../../../lib/courses/db';
import {
  cancelSubscriptionIfPresent,
  getSubscription,
  paypalConfigured,
  PaypalApiError,
} from '../../../../lib/payments/paypal';
import {
  cancelSubscriptionNow,
  listSubscriptionInvoices,
  retrieveSubscriptionWithLatestInvoice,
} from '../../../../lib/registrations/stripe';

export const prerender = false;

// Remove a stranded *not-started* installment plan from the Future-revenue page:
// a row stuck at 0/N with no billing anchor whose gateway subscription no longer
// exists (or never activated) — so it can neither be paid nor cancelled the
// normal way, and just clutters the watch list.
//
// SAFETY. It removes ONLY a plan with zero recorded payments (installments_paid
// = 0, no paid_at) AND — the important guard — one the gateway confirms carries
// no money and isn't live. A not-started row can look identical to a genuinely
// ACTIVE-but-unrecorded plan (the exact bug the Stripe/PayPal reconciles fix), so
// before deleting we ask the gateway: any settled charge, or a live subscription
// → refuse and let the hourly reconcile record it instead. Only a subscription
// PayPal 404s on / reports terminal with 0 cycles (or a Stripe sub with no paid
// invoices and no active status) is deleted. A verification error refuses too
// (fail safe). A best-effort cancel kills any lingering approval first.
export const POST: APIRoute = async ({ request, locals }) => {
  const env = locals.runtime.env;
  if (!(await verifySession(env.ADMIN_SESSION_SECRET, readCookie(request)))) {
    return new Response('Unauthorized', { status: 401 });
  }

  const form = await request.formData();
  const id = parseInt(String(form.get('course_registration_id') ?? ''), 10);
  const returnTo = safeReturnTo(String(form.get('return_to') ?? ''));
  if (!Number.isFinite(id) || id <= 0) {
    return redirect(returnTo, { flash: 'cancel_error', msg: 'Bad registration id' });
  }

  const reg = await getCourseRegistrationById(env.DB, id);
  if (!reg) {
    return redirect(returnTo, { flash: 'cancel_ok', msg: 'That plan is already gone.' });
  }

  // Guard 1 (local): never touch a plan that has any recorded payment.
  const notStarted =
    reg.installments_total > 1 && reg.installments_paid === 0 && !reg.paid_at;
  const removableStatus =
    reg.status === 'pending' || reg.status === 'expired' || reg.status === 'cancelled';
  if (!notStarted || !removableStatus) {
    return redirect(returnTo, {
      flash: 'cancel_error',
      msg: 'Only a not-started plan (0 charges, no payments) can be removed. Use Cancel or Refund for an active plan.',
    });
  }

  // Guard 2 (gateway): confirm there's no money and it isn't live.
  if (reg.provider === 'paypal' && reg.paypal_subscription_id) {
    if (paypalConfigured(env)) {
      try {
        const sub = await getSubscription(env, reg.paypal_subscription_id);
        const status = (sub.status || '').toUpperCase();
        const live =
          status === 'ACTIVE' || status === 'APPROVED' || status === 'SUSPENDED';
        if (live || (sub.cyclesCompleted ?? 0) > 0) {
          return redirect(returnTo, {
            flash: 'cancel_error',
            msg: `Not removed — PayPal still shows this subscription as ${status || 'live'}${
              (sub.cyclesCompleted ?? 0) > 0 ? ` with ${sub.cyclesCompleted} charge(s)` : ''
            }. If it's charging, it will reconcile automatically.`,
          });
        }
        // APPROVAL_PENDING / CANCELLED / EXPIRED with 0 cycles → dead. Best-effort
        // cancel so a late approval can never activate it, then delete.
        await cancelSubscriptionIfPresent(
          env,
          reg.paypal_subscription_id,
          'Removed stranded plan (Songdance admin)',
        ).catch(() => {});
      } catch (err) {
        // 404 → the subscription is truly gone → safe to remove. Anything else →
        // fail safe: don't delete on a verification we couldn't complete.
        if (!(err instanceof PaypalApiError && err.status === 404)) {
          return redirect(returnTo, {
            flash: 'cancel_error',
            msg: `Not removed — couldn't verify with PayPal (${String(err).slice(0, 120)}). Try again.`,
          });
        }
      }
    }
    // PayPal unconfigured → can't verify; Guard 1 already proved 0 local payments.
  } else if (reg.provider === 'stripe' && reg.stripe_subscription_id) {
    if (env.STRIPE_SECRET_KEY) {
      try {
        const paid = await listSubscriptionInvoices(
          env.STRIPE_SECRET_KEY,
          reg.stripe_subscription_id,
          { status: 'paid' },
        );
        if (paid.length > 0) {
          return redirect(returnTo, {
            flash: 'cancel_error',
            msg: `Not removed — Stripe shows ${paid.length} paid invoice(s). Use “Sync from Stripe now” to record them.`,
          });
        }
        const sub = await retrieveSubscriptionWithLatestInvoice(
          env.STRIPE_SECRET_KEY,
          reg.stripe_subscription_id,
        );
        const st = (sub.status || '').toLowerCase();
        if (st === 'active' || st === 'trialing' || st === 'past_due') {
          return redirect(returnTo, {
            flash: 'cancel_error',
            msg: `Not removed — Stripe still shows this subscription as ${st}.`,
          });
        }
        // No paid invoices and not live → safe. Best-effort cancel, then delete.
        await cancelSubscriptionNow(env.STRIPE_SECRET_KEY, reg.stripe_subscription_id).catch(
          () => {},
        );
      } catch (err) {
        return redirect(returnTo, {
          flash: 'cancel_error',
          msg: `Not removed — couldn't verify with Stripe (${String(err).slice(0, 120)}). Try again.`,
        });
      }
    }
  }

  // Log a snapshot (the events table only FKs the retreat registrations table, so
  // registration_id stays NULL and the id rides in the payload — same pattern as
  // delete-course-registration), then delete.
  await logEvent(env.DB, {
    registration_id: null,
    kind: 'admin.dismiss_stranded_plan',
    source: 'admin',
    payload: {
      dismissed_at: new Date().toISOString(),
      snapshot: {
        course_registration_id: reg.id,
        email: reg.email,
        first_name: reg.first_name,
        last_name: reg.last_name,
        product_slug: reg.product_slug,
        status: reg.status,
        provider: reg.provider,
        payment_plan: reg.payment_plan,
        installments_paid: reg.installments_paid,
        installments_total: reg.installments_total,
        stripe_subscription_id: reg.stripe_subscription_id,
        paypal_subscription_id: reg.paypal_subscription_id,
        created_at: reg.created_at,
      },
    },
  });
  await deleteCourseRegistration(env.DB, reg.id);

  const who = [reg.first_name, reg.last_name].filter(Boolean).join(' ') || reg.email;
  return redirect(returnTo, {
    flash: 'cancel_ok',
    msg: `Removed ${who}’s not-started ${reg.installments_total}× plan.`,
  });
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
