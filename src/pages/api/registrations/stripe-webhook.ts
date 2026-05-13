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
import { recordEvent, upsertSubscriber } from '../../../lib/registrations/drip';

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

    // Push to Drip: upsert subscriber + fire the registration event so the
    // confirmation email (and any follow-up sequence) is sent from Drip.
    try {
      const product = await env.DB.prepare(
        'SELECT name, slug, starts_at, ends_at, drip_tag FROM products WHERE id = ?',
      )
        .bind(reg.product_id)
        .first<{
          name: string;
          slug: string;
          starts_at: string | null;
          ends_at: string | null;
          drip_tag: string | null;
        }>();
      const tier = await env.DB.prepare('SELECT name, slug FROM tiers WHERE id = ?')
        .bind(reg.tier_id)
        .first<{ name: string; slug: string }>();

      const dripCfg = {
        apiToken: env.DRIP_API_TOKEN,
        accountId: env.DRIP_ACCOUNT_ID,
      };

      const tags: string[] = [];
      if (product) tags.push(`product:${product.slug}`);
      if (product?.drip_tag) tags.push(product.drip_tag);

      await upsertSubscriber(dripCfg, {
        email: reg.email,
        first_name: reg.first_name ?? reg.name.split(' ')[0],
        last_name:
          reg.last_name ??
          (reg.name.split(' ').slice(1).join(' ') || undefined),
        country: reg.country,
        phone: reg.phone,
        custom_fields: {
          last_product: product?.slug ?? '',
          last_tier: tier?.slug ?? '',
          last_amount_eur: (reg.amount_cents / 100).toFixed(2),
          phone_country: reg.phone_country,
          company_name: reg.company_name,
          vat_number: reg.vat_number,
          billing_address: reg.address,
          dietary: reg.dietary,
          registration_notes: reg.notes,
          consent_framework: reg.consent_framework ? 'yes' : 'no',
          consent_terms: reg.consent_terms ? 'yes' : 'no',
          consent_at: reg.consent_at,
        },
        tags: tags.length ? tags : undefined,
      });

      await recordEvent(
        dripCfg,
        reg.email,
        env.DRIP_REGISTRATION_EVENT || 'Completed retreat registration',
        {
          registration_id: reg.id,
          product_slug: product?.slug ?? '',
          product_name: product?.name ?? '',
          tier_slug: tier?.slug ?? '',
          tier_name: tier?.name ?? '',
          amount: (reg.amount_cents / 100).toFixed(2),
          currency: reg.currency,
          starts_at: product?.starts_at ?? '',
          ends_at: product?.ends_at ?? '',
          first_name: reg.first_name ?? '',
          last_name: reg.last_name ?? '',
          country: reg.country ?? '',
          phone: reg.phone ?? '',
          dietary: reg.dietary ?? '',
          notes: reg.notes ?? '',
          company_name: reg.company_name ?? '',
          vat_number: reg.vat_number ?? '',
        },
      );
    } catch (err) {
      await logEvent(env.DB, {
        registration_id: reg.id,
        kind: 'drip.error',
        source: 'system',
        payload: { error: String(err) },
      });
    }
  }

  return new Response('OK', { status: 200 });
};
