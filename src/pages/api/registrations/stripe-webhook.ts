import type { APIRoute } from 'astro';
import {
  eventExists,
  getRegistrationById,
  getRegistrationBySession,
  logEvent,
  markRegistrationPaid,
} from '../../../lib/registrations/db';
import { verifyStripeSignature } from '../../../lib/registrations/stripe';
import { pushPaidRegistrationToDrip } from '../../../lib/registrations/paid-handler';

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
      customer_details?: {
        name?: string;
        email?: string;
        address?: { country?: string };
      };
      amount_total: number;
      currency: string;
      metadata?: Record<string, string>;
    };

    const registrationId = session.metadata?.registration_id
      ? parseInt(session.metadata.registration_id, 10)
      : null;
    const reg =
      (registrationId
        ? await getRegistrationById(env.DB, registrationId)
        : null) ??
      (await getRegistrationBySession(env.DB, session.id));

    if (!reg) {
      return new Response('Registration not found', { status: 200 });
    }

    if (reg.status !== 'paid' && session.payment_intent) {
      await markRegistrationPaid(env.DB, reg.id, session.payment_intent);
    }

    // Drip: upsert subscriber + fire the "Completed retreat registration"
    // event so the confirmation email (and any follow-up sequence) is sent
    // from Drip. Shared with the admin "Mark paid" fallback button.
    await pushPaidRegistrationToDrip(env, reg.id);
  }

  return new Response('OK', { status: 200 });
};
