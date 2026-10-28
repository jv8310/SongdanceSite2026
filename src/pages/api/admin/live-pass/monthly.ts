import type { APIRoute } from 'astro';
import { getSessionEmail, readCookie } from '../../../../lib/registrations/auth';
import { getCourseRegistrationById } from '../../../../lib/courses/db';
import { isLivePassMonthlySlug } from '../../../../lib/courses/live-pass';
import { cancelMonthly, resumeMonthly } from '../../../../lib/courses/live-pass-monthly';

export const prerender = false;

// Cancel a monthly live pass for the buyer, or take that back, from the order
// page (/admin/orders/C-<id>). The same functions the buyer's own manage link
// runs (live-pass-monthly.ts): nothing more is charged, nothing is refunded,
// and the sessions stay open to the end of the month already paid for. Only
// the row id comes from the form; the gateway and its ids are read from the row.
export const POST: APIRoute = async ({ request, locals }) => {
  const env = locals.runtime.env;
  const admin = await getSessionEmail(env.ADMIN_SESSION_SECRET, readCookie(request));
  if (!admin) return new Response('Unauthorized', { status: 401 });

  const form = await request.formData();
  const id = parseInt(String(form.get('course_registration_id') ?? '').trim(), 10);
  const action = String(form.get('action') ?? '').trim();
  const returnTo = safeReturnTo(String(form.get('return_to') ?? ''), id);

  const reg = Number.isFinite(id) && id > 0 ? await getCourseRegistrationById(env.DB, id) : null;
  if (!reg || !isLivePassMonthlySlug(reg.product_slug)) {
    return redirect(returnTo, { flash: 'cancel_error', msg: 'That order is not a monthly live pass.' });
  }
  const who = [reg.first_name, reg.last_name].filter(Boolean).join(' ').trim() || reg.email;

  try {
    if (action === 'cancel') {
      if (reg.status !== 'paid') {
        return redirect(returnTo, { flash: 'cancel_error', msg: `This monthly is “${reg.status}”, so there is nothing to cancel.` });
      }
      const state = await cancelMonthly(env as any, reg, `admin:${admin}`);
      const until = state.kind === 'ending' && state.on ? ` Their sessions stay open until ${fmtDay(state.on)}.` : '';
      return redirect(returnTo, {
        flash: 'cancel_ok',
        msg: `${who}'s monthly is cancelled: nothing more will be charged and nothing was refunded.${until}`,
      });
    }
    if (action === 'resume') {
      const ok = await resumeMonthly(env as any, reg, `admin:${admin}`);
      return ok
        ? redirect(returnTo, { flash: 'cancel_ok', msg: `${who}'s monthly is running again and renews as before.` })
        : redirect(returnTo, {
            flash: 'cancel_error',
            msg: 'It could not be taken back: only a Stripe monthly whose paid month is still running can be.',
          });
    }
    return redirect(returnTo, { flash: 'cancel_error', msg: 'Unknown action.' });
  } catch (err) {
    return redirect(returnTo, {
      flash: 'cancel_error',
      msg: `Could not change the monthly: ${String(err).replace(/^Error:\s*/, '').slice(0, 160)}`,
    });
  }
};

function fmtDay(day: string): string {
  return new Date(`${day}T12:00:00Z`).toLocaleDateString('en-GB', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
    timeZone: 'UTC',
  });
}

function redirect(base: string, params: { flash: string; msg: string }): Response {
  const url = new URL(base, 'https://placeholder.local');
  url.searchParams.set('flash', params.flash);
  url.searchParams.set('msg', params.msg);
  return new Response(null, { status: 302, headers: { Location: url.pathname + url.search } });
}

// Only same-site /admin/* redirects (return_to is user-supplied); else the order.
function safeReturnTo(raw: string, id: number): string {
  if (raw.startsWith('/admin/')) return raw;
  return Number.isFinite(id) && id > 0 ? `/admin/orders/C-${id}` : '/admin/orders';
}
