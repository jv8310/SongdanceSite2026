import type { APIRoute } from 'astro';
import { readCookie, verifySession } from '../../../../lib/registrations/auth';
import { auditStripeInstallmentPlans } from '../../../../lib/payments/stripe-audit';

export const prerender = false;

// Read-only audit of every Stripe course installment plan against Stripe's own
// paid invoices, for the Future-revenue page's "Audit plans" panel. Reports
// three things our own data can't show: cycles Stripe charged but we never
// recorded, cycles Stripe charged for LESS than the plan's installment (a
// prorated final invoice — the cancel_at bug), and subscriptions whose stop
// isn't pinned to the right billing boundary. Plus whether the webhook endpoint
// is delivering `invoice.paid` at all.
//
// Nothing is written here — fixing is the "Sync from Stripe now" button's job
// (and the hourly cron's). Returns JSON; the page renders it client-side.
export const POST: APIRoute = async ({ request, locals }) => {
  const env = locals.runtime.env;
  if (!(await verifySession(env.ADMIN_SESSION_SECRET, readCookie(request)))) {
    return json({ error: 'Unauthorized' }, 401);
  }
  try {
    const audit = await auditStripeInstallmentPlans(env as any);
    return json(audit, 200);
  } catch (err) {
    return json({ error: String(err).slice(0, 300) }, 500);
  }
};

function json(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}
