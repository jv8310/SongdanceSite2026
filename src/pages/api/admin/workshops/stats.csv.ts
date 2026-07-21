import type { APIRoute } from 'astro';
import { readCookie, verifySession } from '../../../../lib/registrations/auth';
import {
  computeStats,
  computeCourseSales,
  mergeDailyStreams,
  resolveMoneyOpts,
} from '../../../../lib/workshops/stats';

export const prerender = false;

// GET /api/admin/workshops/stats.csv?from=&to=&workshop_id= → daily stats CSV,
// split per revenue stream (workshops / masterclass / standalone courses).
// Course figures ride the same money context as /admin/stats (live FX, VAT
// netted when Quaderno is configured), so the export matches the page.
export const GET: APIRoute = async ({ request, url, locals }) => {
  const env = locals.runtime.env;
  if (!(await verifySession(env.ADMIN_SESSION_SECRET, readCookie(request)))) {
    return new Response('Unauthorized', { status: 401 });
  }

  const from = url.searchParams.get('from') || null;
  const to = url.searchParams.get('to') || null;
  const wid = parseInt(url.searchParams.get('workshop_id') ?? '', 10);
  const workshopId = Number.isFinite(wid) ? wid : null;

  const money = await resolveMoneyOpts(env.DB, env);
  const report = await computeStats(env.DB, { from, to, workshopId });
  const courses = await computeCourseSales(env.DB, { from, to, money });
  const days = mergeDailyStreams(report, courses, from, to);

  const eur = (minor: number) => (minor / 100).toFixed(2);
  const rows: string[] = [
    'date,workshops_net_eur,masterclass_net_eur,twelve_week_eur,certification_eur,other_courses_eur,total_eur,ad_spend_eur,roas',
  ];
  for (const d of days) {
    if (d.totalEurMinor === 0 && d.adSpendEurMinor === 0) continue;
    const roas = d.adSpendEurMinor > 0 ? d.totalEurMinor / d.adSpendEurMinor : null;
    rows.push(
      [
        d.date,
        eur(d.workshopsEurMinor),
        eur(d.masterclassEurMinor),
        eur(d.twelveWeekEurMinor),
        eur(d.certificationEurMinor),
        eur(d.otherCoursesEurMinor),
        eur(d.totalEurMinor),
        eur(d.adSpendEurMinor),
        roas != null ? roas.toFixed(4) : '',
      ].join(','),
    );
  }
  const workshopsNet = report.totals.netEurMinor - report.totals.masterclassNetEurMinor;
  const totalNet = report.totals.netEurMinor + courses.totalNetEurMinor;
  const blendedRoas = report.adSpendEurMinor > 0 ? totalNet / report.adSpendEurMinor : null;
  rows.push('');
  rows.push(
    [
      'TOTAL',
      eur(workshopsNet),
      eur(report.totals.masterclassNetEurMinor),
      eur(courses.twelveWeek.netEurMinor),
      eur(courses.certification.netEurMinor),
      eur(courses.other.netEurMinor),
      eur(totalNet),
      eur(report.adSpendEurMinor),
      blendedRoas != null ? blendedRoas.toFixed(4) : '',
    ].join(','),
  );

  return new Response(rows.join('\n'), {
    status: 200,
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': 'attachment; filename="workshop-stats.csv"',
      'Cache-Control': 'no-store',
    },
  });
};
