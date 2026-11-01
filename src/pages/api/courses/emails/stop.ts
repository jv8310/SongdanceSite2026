// RFC 8058 one-click target for the course sequence emails — the
// List-Unsubscribe header on every weekly Authentic Singing Journey email and
// every 12-week / certification onboarding note points here. A mail client's
// "Unsubscribe" POSTs (body "List-Unsubscribe=One-Click") with no UI, and that
// stops THIS series only — never an unsubscribe from Songdance, never the
// course. A human who GETs the URL is sent to the /courses/emails page.

import type { APIRoute } from 'astro';
import { SEQUENCE_STOP_PATH } from '../../../../lib/courses/emails/stop-link';
import { handleSequenceOneClick } from '../../../../lib/courses/emails/one-click';

export const prerender = false;

// In production the POST never reaches this file: src/worker-entrypoint.ts
// answers it first (Astro's origin check would 403 Gmail's Origin-less POST).
// Both run handleSequenceOneClick, so `astro dev` behaves the same way.
export const POST: APIRoute = async ({ request, locals }) => {
  return handleSequenceOneClick(request, locals.runtime.env);
};

export const GET: APIRoute = async ({ url }) => {
  const t = url.searchParams.get('t') ?? '';
  return new Response(null, {
    status: 302,
    headers: { Location: `${SEQUENCE_STOP_PATH}?t=${encodeURIComponent(t)}` },
  });
};
