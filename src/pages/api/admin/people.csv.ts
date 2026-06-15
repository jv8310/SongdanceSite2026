// GET /api/admin/people.csv — the consolidated people list (same aggregation
// and filters as /admin/people) as a CSV download. Admin-gated.
import type { APIRoute } from 'astro';
import { readCookie, verifySession } from '../../../lib/registrations/auth';
import { listPeople, filterPeople, type PeopleFilter } from '../../../lib/admin/people';

export const prerender = false;

export const GET: APIRoute = async ({ request, locals, url }) => {
  const env = locals.runtime.env;
  if (!(await verifySession(env.ADMIN_SESSION_SECRET, readCookie(request)))) {
    return new Response('Unauthorized', { status: 401 });
  }

  const sub = url.searchParams.get('sub');
  const kind = url.searchParams.get('kind');
  const filter: PeopleFilter = {
    subscription: sub === 'subscribed' || sub === 'unsubscribed' ? sub : null,
    kind: kind === 'customer' || kind === 'lead' ? kind : null,
    pro: url.searchParams.get('pro') === '1' ? true : null,
    query: url.searchParams.get('q') ?? '',
  };

  const people = filterPeople(await listPeople(env.DB), filter);

  const headers = [
    'email', 'name', 'country', 'subscribed', 'unsubscribed_at', 'unsubscribe_source',
    'is_customer', 'is_pro',
    'workshops_secured', 'workshops_attended', 'workshops_no_show', 'workshops_unfinished',
    'bought_12week', 'bought_certification', 'retreats_bought', 'purchases',
    'emails_total', 'emails_marketing', 'emails_received',
    'first_seen', 'last_activity',
  ];
  const lines = [headers.join(',')];
  for (const p of people) {
    const emailsList = p.emailsReceived
      .map((e) => `${e.label}${e.count > 1 ? ` ×${e.count}` : ''}`)
      .join('; ');
    lines.push(
      [
        p.email, p.name, p.country,
        p.subscribed ? 'yes' : 'no', p.unsubscribedAt, p.unsubscribeSource,
        p.isCustomer ? 'yes' : 'no', p.isPro ? 'yes' : 'no',
        p.workshopsSecured, p.workshopsAttended, p.workshopsNoShow, p.workshopsAbandoned,
        p.bought12w ? 'yes' : 'no', p.boughtCert ? 'yes' : 'no', p.retreatsBought,
        p.purchases.join('; '),
        p.totalEmailsReceived, p.marketingEmailsReceived, emailsList,
        p.firstSeen, p.lastActivity,
      ]
        .map(csvField)
        .join(','),
    );
  }

  const filename = `people-${new Date().toISOString().slice(0, 10)}.csv`;
  return new Response(lines.join('\n'), {
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="${filename}"`,
    },
  });
};

function csvField(v: unknown) {
  if (v == null) return '';
  const s = String(v);
  if (/[",\n\r]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}
