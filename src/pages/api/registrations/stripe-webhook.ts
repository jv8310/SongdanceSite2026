import type { APIRoute } from 'astro';
import {
  eventExists,
  getRegistrationById,
  getRegistrationBySession,
  logEvent,
  markRegistrationPaid,
} from '../../../lib/registrations/db';
import { verifyStripeSignature } from '../../../lib/registrations/stripe';
import { recordEvent, upsertSubscriber } from '../../../lib/registrations/drip';

// Invoicing note: Quaderno is connected to Stripe via Quaderno's own Stripe
// integration, so invoices are created automatically by Quaderno when a
// Stripe payment completes (reading the Stripe customer's tax_id for B2B,
// and applying the configured 21% Belgian VAT for this physical event).
// We therefore do not call the Quaderno API from this webhook.

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
