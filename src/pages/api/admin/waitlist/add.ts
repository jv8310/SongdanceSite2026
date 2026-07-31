import type { APIRoute } from 'astro';
import { readCookie, verifySession } from '../../../../lib/registrations/auth';
import { getProductBySlug, logEventSafe } from '../../../../lib/registrations/db';
import { joinWaitlist } from '../../../../lib/registrations/waitlist';

export const prerender = false;

// Admin: put someone on a retreat's waiting list by hand — the ones who ask
// by email or in person rather than through the form. Same upsert as the
// public join (never duplicates an address), but silent: no confirmation
// email, since whoever added them is already in the conversation.
export const POST: APIRoute = async ({ request, locals }) => {
  const env = locals.runtime.env;
  if (!(await verifySession(env.ADMIN_SESSION_SECRET, readCookie(request)))) {
    return new Response('Unauthorized', { status: 401 });
  }

  const form = await request.formData();
  const productSlug = String(form.get('product_slug') ?? '').trim();
  const firstName = String(form.get('first_name') ?? '').trim();
  const lastName = String(form.get('last_name') ?? '').trim();
  const email = String(form.get('email') ?? '').trim().toLowerCase();
  const phone = String(form.get('phone') ?? '').trim();
  const tierIdRaw = parseInt(String(form.get('tier_id') ?? ''), 10);
  const notes = String(form.get('notes') ?? '').trim();
  const returnTo = safeReturnTo(String(form.get('return_to') ?? ''));

  const bail = (error: string) => {
    const sep = returnTo.includes('?') ? '&' : '?';
    return new Response(null, {
      status: 302,
      headers: { Location: `${returnTo}${sep}wl_failed=${encodeURIComponent(error)}#waiting-list` },
    });
  };

  if (!firstName || !email) return bail('name-and-email');
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return bail('bad-email');

  const product = await getProductBySlug(env.DB, productSlug);
  if (!product) return bail('unknown-retreat');

  const { entry, created } = await joinWaitlist(env.DB, {
    product_id: product.id,
    tier_id: Number.isFinite(tierIdRaw) && tierIdRaw > 0 ? tierIdRaw : null,
    first_name: firstName,
    last_name: lastName || null,
    email,
    phone: phone || null,
    phone_country: null,
    country: null,
    notes: notes || null,
    source: 'admin',
  });

  await logEventSafe(env.DB, {
    registration_id: null,
    kind: created ? 'waitlist.joined' : 'waitlist.rejoined',
    source: 'admin',
    payload: { waitlist_id: entry.id, product_slug: product.slug, email },
  });

  const sep = returnTo.includes('?') ? '&' : '?';
  return new Response(null, {
    status: 302,
    headers: { Location: `${returnTo}${sep}wl_added=1#waiting-list` },
  });
};

function safeReturnTo(raw: string): string {
  if (raw.startsWith('/admin/') || raw === '/admin') return raw;
  return '/admin';
}
