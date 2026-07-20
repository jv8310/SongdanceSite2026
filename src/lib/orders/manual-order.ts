// Manual bank-transfer order — the admin enters an order for someone who paid
// by bank transfer (no Stripe, no PayPal). We run the exact paid-side effects a
// real checkout runs (create the course row, mark it paid, grant Drip access +
// record the Drip order, send the internal SD-ORDER notification), and — because
// no Stripe payment means the Stripe→Quaderno native connector never fires — we
// create the Quaderno invoice ourselves, marked paid via wire transfer.
//
// Mirrors src/lib/courses/free-checkout.ts (the €0 comp flow) closely: same
// synthetic-session trick, same fulfilment calls. The difference is a real
// amount, a real Quaderno invoice, and a backdated paid_at (the day the money
// actually landed) so the invoice and the Drip order both carry the true date.

import {
  createPendingCourseRegistration,
  attachStripeSessionToCourse,
  markCourseRegistrationPaid,
  setCoursePaidAt,
  attachQuadernoInvoiceToCourse,
  getCourseRegistrationById,
  type CourseProductSlug,
} from '../courses/db';
import { pushPaidCourseRegistrationToDrip } from '../courses/paid-handler';
import { notifyCourseOrder } from './notification';
import { logEventSafe } from '../registrations/db';
import {
  upsertContact,
  createInvoice,
  markInvoicePaid,
  sendInvoiceByEmail,
  type QuadernoConfig,
} from '../registrations/quaderno';
import { getTaxRate } from '../workshops/quaderno';

// The course products a manual order can be entered for — the high-ticket items
// people actually pay by bank transfer. Each flows cleanly through the course
// fulfilment (Drip tags + event + order, SD-ORDER notification). Journeys /
// workshops / retreats are intentionally out of scope (see the branch notes).
export const MANUAL_ORDER_PRODUCTS: {
  slug: CourseProductSlug;
  label: string;
  hasActivateChoice: boolean;
}[] = [
  { slug: 'cc-cert', label: 'SVH Certification Course', hasActivateChoice: true },
  { slug: 'cc-bundle', label: '12-Week Course + Certification Course', hasActivateChoice: true },
  { slug: 'svh-12week', label: '12-Week SVH Course', hasActivateChoice: false },
  { slug: 'grief-course', label: 'The Grief Course', hasActivateChoice: false },
];

const PRODUCT_LABELS: Record<string, string> = Object.fromEntries(
  MANUAL_ORDER_PRODUCTS.map((p) => [p.slug, p.label]),
);

export function isManualOrderProduct(slug: string): slug is CourseProductSlug {
  return MANUAL_ORDER_PRODUCTS.some((p) => p.slug === slug);
}

type ManualOrderEnv = {
  DB: D1Database;
  DRIP_API_TOKEN: string;
  DRIP_ACCOUNT_ID: string;
  DRIP_COURSE_EVENT?: string;
  QUADERNO_API_KEY?: string;
  QUADERNO_ACCOUNT?: string;
  QUADERNO_SANDBOX?: string;
  RESEND_API_KEY?: string;
  ORDER_NOTIFICATIONS_TO?: string;
  META_PIXEL_ID?: string;
  META_ACCESS_TOKEN?: string;
  PUBLIC_BASE_URL?: string;
};

export type ManualOrderInput = {
  email: string;
  first_name: string | null;
  last_name: string | null;
  country: string | null; // ISO-2, used for the Quaderno VAT lookup
  phone: string | null;
  product_slug: CourseProductSlug;
  amount_cents: number; // gross (tax-inclusive), the sum actually received
  currency: string;
  // The day the bank transfer landed, 'YYYY-MM-DD' (UTC). Drives both the
  // invoice payment date and the Drip order date.
  paid_date: string;
  activate_choice: 'now' | 'wait' | null; // cert / bundle only
  email_invoice: boolean; // also deliver the paid invoice to the customer
  admin_email: string; // who entered it (audit trail)
};

export type ManualOrderInvoiceResult =
  | { ok: true; id: string; number: string | null; permalink: string | null; emailed: boolean }
  | { ok: false; error: string }
  | { ok: null }; // Quaderno not configured — skipped

export type ManualOrderResult = {
  registrationId: number;
  invoice: ManualOrderInvoiceResult;
};

function quadernoConfig(env: ManualOrderEnv): QuadernoConfig | null {
  return env.QUADERNO_API_KEY && env.QUADERNO_ACCOUNT
    ? {
        apiKey: env.QUADERNO_API_KEY,
        account: env.QUADERNO_ACCOUNT,
        sandbox: env.QUADERNO_SANDBOX === '1',
      }
    : null;
}

// Create the Quaderno invoice for a manual order and mark it paid. Best-effort:
// returns a result object rather than throwing, so a Quaderno hiccup never
// blocks the order/Drip (which are already committed). The gross amount is
// treated as tax-inclusive; the destination e-service VAT for the buyer country
// is looked up and passed so the invoice shows the correct net + VAT split
// (matching how the site prices — and its revenue stats — treat course prices).
async function createManualInvoice(
  env: ManualOrderEnv,
  input: ManualOrderInput,
): Promise<ManualOrderInvoiceResult> {
  const cfg = quadernoConfig(env);
  if (!cfg) return { ok: null };

  try {
    const grossMajor = input.amount_cents / 100;
    const name =
      [input.first_name, input.last_name].filter(Boolean).join(' ').trim() ||
      input.email.split('@')[0];

    // Destination e-service VAT for the buyer country (0 when unknown → no tax
    // line, net = gross). Same tax class the checkout/stats use.
    let taxRatePct = 0;
    if (input.country) {
      const rate = await getTaxRate(cfg, input.country, 'eservice');
      taxRatePct = Math.round(rate * 10000) / 100; // decimal → percentage
    }

    const contactId = await upsertContact(cfg, {
      name,
      email: input.email,
      country: input.country,
    });

    const invoice = await createInvoice(cfg, {
      contact_id: contactId,
      currency: input.currency,
      po_number: `manual-${input.product_slug}`,
      notes: 'Paid by bank transfer — manual order.',
      items: [
        {
          description: PRODUCT_LABELS[input.product_slug] ?? input.product_slug,
          unit_price: grossMajor,
          quantity: 1,
          ...(taxRatePct > 0
            ? { tax_1_name: 'VAT', tax_1_rate: taxRatePct }
            : {}),
        },
      ],
    });

    await markInvoicePaid(cfg, invoice.id, {
      amountMajor: grossMajor,
      date: input.paid_date,
      paymentMethod: 'wire_transfer',
    });

    let emailed = false;
    if (input.email_invoice) {
      try {
        await sendInvoiceByEmail(cfg, invoice.id);
        emailed = true;
      } catch (err) {
        // Invoice exists and is paid; only the delivery failed. Note it but
        // don't fail the whole invoice result.
        await logEventSafe(env.DB, {
          registration_id: null,
          kind: 'admin.manual_order.invoice_deliver_error',
          source: 'admin',
          payload: { invoice_id: invoice.id, error: String(err) },
        });
      }
    }

    return {
      ok: true,
      id: invoice.id,
      number: invoice.number ?? null,
      permalink: invoice.permalink ?? null,
      emailed,
    };
  } catch (err) {
    await logEventSafe(env.DB, {
      registration_id: null,
      kind: 'admin.manual_order.invoice_error',
      source: 'admin',
      payload: {
        product_slug: input.product_slug,
        email: input.email,
        error: String(err),
      },
    });
    return { ok: false, error: String(err) };
  }
}

// End-to-end fulfilment for a manual bank-transfer course order.
export async function createManualCourseOrder(
  env: ManualOrderEnv,
  input: ManualOrderInput,
): Promise<ManualOrderResult> {
  // 1) Create the course row and mark it paid (full payment, single "installment").
  const registrationId = await createPendingCourseRegistration(env.DB, {
    email: input.email,
    first_name: input.first_name,
    last_name: input.last_name,
    country: input.country,
    phone: input.phone,
    phone_country: null,
    company_name: null,
    vat_number: null,
    product_slug: input.product_slug,
    activate_choice: input.activate_choice,
    source_variant: 'manual',
    amount_cents: input.amount_cents,
    currency: input.currency,
    consent_terms: true, // agreed offline as part of the purchase
    payment_plan: 'full',
    installments_total: 1,
  });

  // Synthetic, unguessable stand-ins for the absent Stripe ids (same trick the
  // free-checkout flow uses so the row satisfies the UNIQUE columns + resolvers).
  const token = `manual_${registrationId}_${crypto.randomUUID().slice(0, 8)}`;
  await attachStripeSessionToCourse(env.DB, registrationId, token);
  await markCourseRegistrationPaid(env.DB, registrationId, `manual-${registrationId}`);

  // Backdate paid_at to the day the transfer landed (noon UTC to dodge any
  // day-shift), so the Quaderno invoice and the Drip order carry the true date.
  await setCoursePaidAt(env.DB, registrationId, `${input.paid_date} 12:00:00`);

  await logEventSafe(env.DB, {
    registration_id: null,
    kind: 'admin.manual_order.created',
    source: 'admin',
    external_id: `local-course-${registrationId}`,
    payload: {
      course_registration_id: registrationId,
      product_slug: input.product_slug,
      amount_cents: input.amount_cents,
      currency: input.currency,
      paid_date: input.paid_date,
      by: input.admin_email,
    },
  });

  // 2) Quaderno invoice (best-effort; captured in the result for the UI banner).
  const invoice = await createManualInvoice(env, input);
  if (invoice.ok === true) {
    await attachQuadernoInvoiceToCourse(env.DB, registrationId, invoice.id);
  }

  // 3) Drip: tags + course event + native Drip order (dated by paid_at). Same
  // idempotent push every paid course runs. Never throws.
  //
  // Manual back-office orders are NOT ad-driven conversions, so we strip the
  // Meta keys before the push — that suppresses the Meta CAPI Purchase event
  // (it would report a conversion Meta can't attribute and would skew ROAS)
  // while leaving every Drip side-effect untouched.
  const dripEnv = { ...env, META_PIXEL_ID: undefined, META_ACCESS_TOKEN: undefined };
  await pushPaidCourseRegistrationToDrip(dripEnv, registrationId);

  // 4) Internal SD-ORDER notification (idempotent). Re-fetch the up-to-date row.
  const paidReg = await getCourseRegistrationById(env.DB, registrationId);
  if (paidReg) {
    await notifyCourseOrder(env, paidReg, {
      stripePaymentIntent: paidReg.stripe_payment_intent,
      stripeSubscriptionId: null,
    });
  }

  return { registrationId, invoice };
}
