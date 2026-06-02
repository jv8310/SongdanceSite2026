import type { APIRoute } from 'astro';
import { readCookie, verifySession } from '../../../../lib/registrations/auth';
import { computeStats } from '../../../../lib/workshops/stats';

export const prerender = false;

// GET /api/admin/workshops/stats.csv?from=&to=&workshop_id= → daily stats CSV.
export const GET: APIRoute = async ({ request, url, locals }) => {
  const env = locals.runtime.env;
  if (!(await verifySession(env.ADMIN_SESSION_SECRET, readCookie(request)))) {
    return new Response('Unauthorized', { status: 401 });
  }

  const from = url.searchParams.get('from') || null;
  const to = url.searchParams.get('to') || null;
  const wid = parseInt(url.searchParams.get('workshop_id') ?? '', 10);
  const report = await computeStats(env.DB, {
    from,
    to,
    workshopId: Number.isFinite(wid) ? wid : null,
  });

  const eur = (minor: number) => (minor / 100).toFixed(2);
  const rows: string[] = ['date,gross_eur,net_eur,ad_spend_eur,roas'];
  for (const d of report.daily) {
    rows.push(
      [d.date, eur(d.grossEurMinor), eur(d.netEurMinor), eur(d.adSpendEurMinor), d.roas != null ? d.roas.toFixed(4) : ''].join(','),
    );
  }
  rows.push('');
  rows.push(`TOTAL,,${eur(report.totals.netEurMinor)},${eur(report.adSpendEurMinor)},${report.roas != null ? report.roas.toFixed(4) : ''}`);

  return new Response(rows.join('\n'), {
    status: 200,
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': 'attachment; filename="workshop-stats.csv"',
      'Cache-Control': 'no-store',
    },
  });
};
