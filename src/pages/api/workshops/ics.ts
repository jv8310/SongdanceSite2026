import type { APIRoute } from 'astro';
import { getRegistrationById, getWorkshopById } from '../../../lib/workshops/db';
import { buildICS } from '../../../lib/workshops/ics';
import { successUrl } from '../../../lib/workshops/paid-handler';

export const prerender = false;

// GET /api/workshops/ics?rid=<registration_id> → downloadable .ics
export const GET: APIRoute = async ({ url, locals }) => {
  const env = locals.runtime.env;
  const rid = parseInt(url.searchParams.get('rid') ?? '', 10);
  if (!Number.isFinite(rid)) return new Response('Bad request', { status: 400 });

  const reg = await getRegistrationById(env.DB, rid);
  if (!reg) return new Response('Not found', { status: 404 });
  const workshop = await getWorkshopById(env.DB, reg.workshop_id);
  if (!workshop || workshop.is_replay === 1) return new Response('Not found', { status: 404 });

  const base = env.PUBLIC_BASE_URL.replace(/\/$/, '');
  const ics = buildICS({
    title: workshop.title,
    startsAtUtc: workshop.starts_at_utc,
    endsAtUtc: workshop.ends_at_utc,
    description: `Your place in ${workshop.title}. Join from your countdown page.`,
    url: successUrl(base, reg.id),
    uid: `workshop-${workshop.id}-reg-${reg.id}@songdance.co`,
  });

  return new Response(ics, {
    status: 200,
    headers: {
      'Content-Type': 'text/calendar; charset=utf-8',
      'Content-Disposition': 'attachment; filename="workshop.ics"',
      'Cache-Control': 'no-store',
    },
  });
};
