import type { APIRoute } from 'astro';
import {
  eventExists,
  getRegistrationById,
  getRegistrationBySession,
  logEvent,
  markRegistrationPaid,
  setQuadernoInvoice,
} from '../../../lib/registrations/db';
import { verifyStripeSignature } from '../../../lib/registrations/stripe';
import {
  createPaidInvoice,
  sendInvoiceByEmail,
  upsertContact,
} from '../../../lib/registrations/quaderno';
import {
  bookingConfirmationHtml,
  sendEmail,
} from '../../../lib/registrations/email';

export const prerender = false;

export const POST: APIRoute = async ({ request, locals }) => {
  const env = locals.runtime.env;
  const sig = request.headers.get('Stripe-Signature');
  const body = await request.text();
  if (!sig) return new Response('Missing signature', { status: 400 });

  const ok = await verifyStripeSignature(body, sig, env.STRIPE_WEBHOOK_SECRET);
  if (!ok) return new Response('Bad signature', { status: 400 });

  const event = JSON.parse(body) as {
    id: string;
    type: string;
    data: { object: any };
  };

  // Idempotency: skip if we've seen this event id before.
  if (await eventExists(env.DB, event.id)) {
    return new Response('OK (duplicate)', { status: 200 });
  }

  await logEvent(env.DB, {
    registration_id: null,
    kind: event.type,
    source: 'stripe',
    external_id: event.id,
    payload: event.data.object,
  });

  if (event.type === 'checkout.session.completed') {
    const session = event.data.object as {
      id: string;
      payment_intent: string | null;
      customer_details?: { name?: string; email?: string; address?: { country?: string } };
      amount_total: number;
      currency: string;
      metadata?: Record<string, string>;
    };

    const registrationId = session.metadata?.registration_id
      ? parseInt(session.metadata.registration_id, 10)
      : null;
    const reg =
      (registrationId ? await getRegistrationById(env.DB, registrationId) : null) ??
      (await getRegistrationBySession(env.DB, session.id));

    if (!reg) {
      return new Response('Registration not found', { status: 200 });
    }

    if (reg.status !== 'paid' && session.payment_intent) {
      await markRegistrationPaid(env.DB, reg.id, session.payment_intent);
    }

    // Quaderno invoice (best-effort — failures don't break the flow).
    try {
      const contactId = await upsertContact(
        { apiKey: env.QUADERNO_API_KEY, account: env.QUADERNO_ACCOUNT },
        {
          name: session.customer_details?.name ?? reg.name,
          email: session.customer_details?.email ?? reg.email,
          country: session.customer_details?.address?.country ?? reg.country,
        },
      );
      const invoice = await createPaidInvoice(
        { apiKey: env.QUADERNO_API_KEY, account: env.QUADERNO_ACCOUNT },
        {
          contact_id: contactId,
          currency: reg.currency,
          po_number: `REG-${reg.id}`,
          items: [
            {
              description: `Registration #${reg.id}`,
              unit_price: reg.amount_cents / 100,
              quantity: 1,
            },
          ],
          payment_method: 'credit_card',
          paid_at: new Date().toISOString(),
          notes: `Stripe session ${session.id}`,
        },
      );
      await setQuadernoInvoice(env.DB, reg.id, invoice.id);
      await sendInvoiceByEmail(
        { apiKey: env.QUADERNO_API_KEY, account: env.QUADERNO_ACCOUNT },
        invoice.id,
      );
      await logEvent(env.DB, {
        registration_id: reg.id,
        kind: 'quaderno.invoice.created',
        source: 'system',
        external_id: `quaderno-${invoice.id}`,
        payload: { invoice_id: invoice.id, permalink: invoice.permalink },
      });
    } catch (err) {
      await logEvent(env.DB, {
        registration_id: reg.id,
        kind: 'quaderno.invoice.error',
        source: 'system',
        payload: { error: String(err) },
      });
    }

    // Booking confirmation email.
    try {
      const product = await env.DB.prepare(
        'SELECT name, starts_at, ends_at FROM products WHERE id = ?',
      )
        .bind(reg.product_id)
        .first<{ name: string; starts_at: string | null; ends_at: string | null }>();
      const tier = await env.DB.prepare('SELECT name FROM tiers WHERE id = ?')
        .bind(reg.tier_id)
        .first<{ name: string }>();
      await sendEmail(
        { apiKey: env.RESEND_API_KEY, from: env.RESEND_FROM },
        reg.email,
        `Your place at ${product?.name ?? 'the retreat'} is confirmed`,
        bookingConfirmationHtml({
          name: reg.name,
          productName: product?.name ?? '',
          tierName: tier?.name ?? '',
          amountCents: reg.amount_cents,
          currency: reg.currency,
          startsAt: product?.starts_at ?? null,
          endsAt: product?.ends_at ?? null,
        }),
      );
    } catch (err) {
      await logEvent(env.DB, {
        registration_id: reg.id,
        kind: 'email.confirmation.error',
        source: 'system',
        payload: { error: String(err) },
      });
    }
  }

  return new Response('OK', { status: 200 });
};
