import type { APIRoute } from 'astro';
import { readCookie, verifySession } from '../../../lib/registrations/auth';

export const prerender = false;

export const GET: APIRoute = async ({ request, locals, url }) => {
  const env = locals.runtime.env;
  if (!(await verifySession(env.ADMIN_SESSION_SECRET, readCookie(request)))) {
    return new Response('Unauthorized', { status: 401 });
  }
  const productSlug = url.searchParams.get('product') ?? 'ritual-of-belonging-2026';

  const product = await env.DB.prepare('SELECT id, slug FROM products WHERE slug = ?')
    .bind(productSlug)
    .first<{ id: number; slug: string }>();
  if (!product) return new Response('Unknown product', { status: 404 });

  const q = await env.DB.prepare(
    `SELECT r.id, r.name, r.email, r.phone, r.country, t.name AS tier_name,
            iu.name AS room_name, r.status, r.amount_cents, r.currency,
            r.roommate_pref, r.dietary, r.notes,
            r.stripe_session_id, r.quaderno_invoice_id,
            r.created_at, r.paid_at, r.cancelled_at
       FROM registrations r
       JOIN tiers t ON t.id = r.tier_id
       LEFT JOIN inventory_units iu ON iu.id = r.inventory_unit_id
      WHERE r.product_id = ?
      ORDER BY r.created_at ASC`,
  )
    .bind(product.id)
    .all<any>();

  const headers = [
    'id', 'name', 'email', 'phone', 'country', 'tier', 'room',
    'status', 'amount', 'currency', 'roommate_pref', 'dietary', 'notes',
    'stripe_session_id', 'quaderno_invoice_id',
    'created_at', 'paid_at', 'cancelled_at',
  ];
  const lines = [headers.join(',')];
  for (const r of q.results ?? []) {
    lines.push(
      [
        r.id, r.name, r.email, r.phone, r.country, r.tier_name, r.room_name,
        r.status, (r.amount_cents / 100).toFixed(2), r.currency,
        r.roommate_pref, r.dietary, r.notes,
        r.stripe_session_id, r.quaderno_invoice_id,
        r.created_at, r.paid_at, r.cancelled_at,
      ]
        .map(csvField)
        .join(','),
    );
  }

  const filename = `registrations-${product.slug}-${new Date().toISOString().slice(0, 10)}.csv`;
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
