import type { APIRoute } from 'astro';
import { readCookie, verifySession } from '../../../../lib/registrations/auth';
import { getWorkshopById, listRegistrationsForWorkshop } from '../../../../lib/workshops/db';

export const prerender = false;

// GET /api/admin/workshops/registrations.csv?id=<workshopId>&filter=all|attended|no_show
// → CSV of a workshop's registrations, admin-gated.
export const GET: APIRoute = async ({ request, url, locals }) => {
  const env = locals.runtime.env;
  if (!(await verifySession(env.ADMIN_SESSION_SECRET, readCookie(request)))) {
    return new Response('Unauthorized', { status: 401 });
  }

  const id = parseInt(url.searchParams.get('id') ?? '', 10);
  const workshop = Number.isFinite(id) ? await getWorkshopById(env.DB, id) : null;
  if (!workshop) return new Response('Workshop not found', { status: 404 });

  const filter = url.searchParams.get('filter') ?? 'all';
  let regs = await listRegistrationsForWorkshop(env.DB, workshop.id);
  if (filter === 'attended') regs = regs.filter((r) => r.attendance_status === 'attended');
  else if (filter === 'no_show') regs = regs.filter((r) => r.attendance_status === 'no_show');

  const header = [
    'id',
    'name',
    'email',
    'phone',
    'country',
    'timezone',
    'payment_status',
    'attendance_status',
    'amount',
    'currency',
    'settlement_eur',
    'has_bump',
    'bought_12w',
    'bought_cert',
    'registered_at',
  ];
  const rows = regs.map((r) =>
    [
      r.id,
      r.name ?? '',
      r.email,
      r.phone ?? '',
      r.country ?? '',
      r.timezone ?? '',
      r.payment_status,
      r.attendance_status,
      r.amount_minor != null ? (r.amount_minor / 100).toFixed(2) : '',
      r.pay_currency ?? '',
      r.settlement_amount_minor != null ? (r.settlement_amount_minor / 100).toFixed(2) : '',
      r.has_bump ? 'yes' : 'no',
      r.bought_12w ? 'yes' : 'no',
      r.bought_cert ? 'yes' : 'no',
      r.created_at,
    ]
      .map(csvCell)
      .join(','),
  );
  const csv = [header.join(','), ...rows].join('\n');

  const stamp = new Date().toISOString().slice(0, 10);
  const suffix = filter === 'attended' ? '-attended' : filter === 'no_show' ? '-no-show' : '';
  return new Response(csv, {
    status: 200,
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="${workshop.slug}-registrations${suffix}-${stamp}.csv"`,
      'Cache-Control': 'no-store',
    },
  });
};

// Quote a CSV cell when it contains a comma, quote, or newline.
function csvCell(v: string | number): string {
  const s = String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}
