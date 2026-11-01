// RFC 8058 one-click unsubscribe target — referenced from the
// List-Unsubscribe header on marketing-flavoured sends. Mail clients POST
// here (body: "List-Unsubscribe=One-Click") with no UI; humans who somehow
// GET this URL are sent to a confirm page instead.
//
// In production the POST never reaches this file: src/worker-entrypoint.ts
// answers it first, because Astro's origin check 403s a form POST that carries
// no Origin — which is what Gmail sends. Both run handleOneClickUnsubscribe
// (src/lib/email/one-click.ts), so `astro dev` behaves the same way (for a
// request that passes the origin check).

import type { APIRoute } from 'astro';
import { handleOneClickUnsubscribe } from '../../lib/email/one-click';

export const prerender = false;

export const POST: APIRoute = async ({ request, locals }) => {
  return handleOneClickUnsubscribe(request, locals.runtime.env);
};

// A person who opens the link: with a topic, the choices page (leave that topic,
// or anything else); without, the unsubscribe confirm page as before. Nothing
// changes on a GET (link scanners open these).
export const GET: APIRoute = async ({ url }) => {
  const e = encodeURIComponent(url.searchParams.get('e') ?? '');
  const t = encodeURIComponent(url.searchParams.get('t') ?? '');
  const topic = (url.searchParams.get('topic') ?? '').trim();
  const location = topic
    ? `/email-preferences?e=${e}&t=${t}&topic=${encodeURIComponent(topic)}`
    : `/unsubscribe?e=${e}&t=${t}`;
  return new Response(null, { status: 302, headers: { Location: location } });
};
