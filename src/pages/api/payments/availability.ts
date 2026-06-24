import type { APIRoute } from 'astro';
import { paypalConfigured } from '../../../lib/payments/paypal';

export const prerender = false;

// Runtime check of whether to offer PayPal in the UI. The register forms live
// on statically-prerendered pages, so they can't read Cloudflare secrets at
// build time — they fetch this at runtime instead and reveal the "Pay with
// PayPal" button when it returns true. Gated on the secrets actually being
// present (paypalConfigured), with PAYPAL_ENABLED="false" as an explicit kill
// switch that hides the button without removing the credentials.
export const GET: APIRoute = ({ locals }) => {
  const env = locals.runtime.env as {
    PAYPAL_CLIENT_ID?: string;
    PAYPAL_CLIENT_SECRET?: string;
    PAYPAL_ENABLED?: string;
  };
  const paypal = paypalConfigured(env) && env.PAYPAL_ENABLED !== 'false';
  return new Response(JSON.stringify({ paypal }), {
    status: 200,
    headers: {
      'Content-Type': 'application/json',
      'Cache-Control': 'no-store',
    },
  });
};
