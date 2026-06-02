import type { APIRoute } from 'astro';
import { listPublicEvents, type EventCategory, type EventLanguage } from '../../lib/events/db';

export const prerender = false;

// Public, read-only feed of upcoming events. Powers the homepage "Upcoming"
// strip and RetreatBand (fetched client-side so those pages stay static),
// and is available to the DE/NL sites via ?lang=.
//
//   /api/events.json                 → all published, upcoming events
//   /api/events.json?category=retreat
//   /api/events.json?lang=nl
//   /api/events.json?limit=3
export const GET: APIRoute = async ({ url, locals }) => {
  const env = locals.runtime.env;

  const categoryParam = url.searchParams.get('category');
  const langParam = url.searchParams.get('lang');
  const limitParam = url.searchParams.get('limit');

  const category =
    categoryParam === 'retreat' || categoryParam === 'online' || categoryParam === 'course'
      ? (categoryParam as EventCategory)
      : undefined;
  const language =
    langParam === 'en' || langParam === 'de' || langParam === 'nl'
      ? (langParam as EventLanguage)
      : undefined;

  let events = await listPublicEvents(env.DB, { category, language });

  const limit = limitParam ? parseInt(limitParam, 10) : NaN;
  if (Number.isFinite(limit) && limit > 0) events = events.slice(0, limit);

  return new Response(JSON.stringify({ events }), {
    headers: {
      'content-type': 'application/json; charset=utf-8',
      // Short edge cache; admin edits show within a minute.
      'cache-control': 'public, max-age=60',
    },
  });
};
