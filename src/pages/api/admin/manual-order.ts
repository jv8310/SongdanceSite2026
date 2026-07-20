import type { APIRoute } from 'astro';
import {
  readCookie,
  verifySession,
  getSessionEmail,
} from '../../../lib/registrations/auth';
import {
  createManualCourseOrder,
  isManualOrderProduct,
  MANUAL_ORDER_PRODUCTS,
  type ManualOrderInput,
} from '../../../lib/orders/manual-order';

export const prerender = false;

// Currencies the course products are priced in (see variant.ts / grief.ts /
// twelve-week.ts). The amount is entered by hand, so this is just a guard.
const ALLOWED_CURRENCIES = new Set([
  'EUR', 'USD', 'GBP', 'CAD', 'CHF', 'AUD', 'NZD', 'NOK', 'SEK', 'DKK',
]);

const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function redirect(location: string): Response {
  return new Response(null, { status: 302, headers: { Location: location } });
}

function fail(msg: string): Response {
  return redirect(`/admin/orders/new?error=${encodeURIComponent(msg)}`);
}

export const POST: APIRoute = async ({ request, locals }) => {
  const env = locals.runtime.env;
  const cookie = readCookie(request);
  if (!(await verifySession(env.ADMIN_SESSION_SECRET, cookie))) {
    return new Response('Unauthorized', { status: 401 });
  }
  const adminEmail = (await getSessionEmail(env.ADMIN_SESSION_SECRET, cookie)) ?? 'admin';

  const form = await request.formData();
  const str = (k: string) => String(form.get(k) ?? '').trim();

  // ── Validate ──
  const productSlug = str('product_slug');
  if (!isManualOrderProduct(productSlug)) {
    return fail('Pick a valid product.');
  }

  const email = str('email').toLowerCase();
  if (!EMAIL_RE.test(email)) {
    return fail('Enter a valid customer email.');
  }

  const currency = (str('currency') || 'EUR').toUpperCase();
  if (!ALLOWED_CURRENCIES.has(currency)) {
    return fail(`Unsupported currency "${currency}".`);
  }

  const amountMajor = parseFloat(str('amount').replace(/[,\s]/g, ''));
  if (!Number.isFinite(amountMajor) || amountMajor <= 0) {
    return fail('Enter a positive amount.');
  }
  const amountCents = Math.round(amountMajor * 100);

  let paidDate = str('paid_date');
  if (!paidDate) paidDate = new Date().toISOString().slice(0, 10);
  if (!DATE_RE.test(paidDate)) {
    return fail('Enter a valid payment date (YYYY-MM-DD).');
  }

  const countryRaw = str('country').toUpperCase();
  const country = /^[A-Z]{2}$/.test(countryRaw) ? countryRaw : null;

  const product = MANUAL_ORDER_PRODUCTS.find((p) => p.slug === productSlug)!;
  const activateRaw = str('activate_choice');
  const activate_choice = product.hasActivateChoice
    ? activateRaw === 'wait'
      ? 'wait'
      : 'now'
    : null;

  const input: ManualOrderInput = {
    email,
    first_name: str('first_name') || null,
    last_name: str('last_name') || null,
    country,
    phone: str('phone') || null,
    company_name: str('company_name') || null,
    vat_number: str('vat_number') || null,
    product_slug: productSlug,
    amount_cents: amountCents,
    currency,
    paid_date: paidDate,
    activate_choice,
    email_invoice: form.get('email_invoice') != null,
    admin_email: adminEmail,
  };

  // ── Fulfil ──
  let result;
  try {
    result = await createManualCourseOrder(env, input);
  } catch (err) {
    return fail(`Order failed: ${String(err)}`);
  }

  // ── Flash banner back on the orders list ──
  const money = `${currency} ${amountMajor.toFixed(2)}`;
  const who = input.first_name ? `${input.first_name} — ` : '';
  const base = `Manual order #${result.registrationId} created (${who}${product.label}, ${money}). Synced to Drip.`;

  let flash = 'order_ok';
  let msg = base;
  const inv = result.invoice;
  if (inv.ok === true) {
    const label = inv.number ? `#${inv.number}` : inv.id;
    msg = `${base} Quaderno invoice ${label} created & marked paid${inv.emailed ? ' and emailed to the customer' : ''}.`;
  } else if (inv.ok === false) {
    flash = 'order_warn';
    msg = `${base} But the Quaderno invoice FAILED — create it manually. (${inv.error})`;
  } else {
    flash = 'order_warn';
    msg = `${base} Quaderno is not configured, so no invoice was created.`;
  }

  return redirect(
    `/admin/orders?flash=${flash}&msg=${encodeURIComponent(msg)}`,
  );
};
