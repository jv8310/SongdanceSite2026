// POST /api/admin/app-access — change one person's access in the member app
// from their People page ("App access", src/lib/admin/app-access.ts). One form
// field `action` picks the change; the app does it and logs it under the
// signed-in admin. Admin-gated; always redirects back to the person's page
// with a flash (app_ok / app_err + app_msg), anchored on the section.
import type { APIRoute } from 'astro';
import { getSessionEmail, readCookie, verifySession } from '../../../lib/registrations/auth';
import { askApp, type AppAnswer } from '../../../lib/admin/app-access';

export const prerender = false;

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export const POST: APIRoute = async ({ request, locals }) => {
  const env = locals.runtime.env;
  const cookie = readCookie(request);
  if (!(await verifySession(env.ADMIN_SESSION_SECRET, cookie))) return new Response('Unauthorized', { status: 401 });
  // A session from before the multi-user login carries no email; it still signs in.
  const actor = (await getSessionEmail(env.ADMIN_SESSION_SECRET, cookie)) ?? 'admin';

  const form = await request.formData().catch(() => null);
  const field = (k: string) => String(form?.get(k) ?? '').trim();
  const email = field('email').toLowerCase();
  if (!EMAIL_RE.test(email)) return back('/admin/people', { app_err: '1', app_msg: 'Invalid email address.' });
  const page = `/admin/people/${encodeURIComponent(email)}`;

  // A date field that was left on the form is sent ('' = clear it); one that
  // was not on the form (the activation date of a course that has none) is not.
  const dateField = (k: string): string | undefined => (form?.has(k) ? field(k) : undefined);

  // A number of months ('' = none). A field that is not a whole 1–36 is refused.
  const monthsField = (k: string): number | null | 'bad' => {
    const v = field(k);
    if (!v) return null;
    const n = Number(v);
    return Number.isInteger(n) && n >= 1 && n <= 36 ? n : 'bad';
  };

  const action = field('action');
  let result: AppAnswer<unknown>;
  let done = '';
  switch (action) {
    case 'grant-course': {
      const months = monthsField('live_months');
      if (months === 'bad') return back(page, { app_err: '1', app_msg: 'Months must be a whole number from 1 to 36.' });
      result = await askApp(env, (app) =>
        app.grantCourse({
          email,
          product: field('product'),
          startsAt: field('starts_at') || undefined,
          endsAt: field('ends_at') || undefined,
          ...(months ? { liveMonths: months } : {}),
          note: field('note'),
          actor,
        }),
      );
      done = months
        ? `Course added, with ${months} month${months === 1 ? '' : 's'} of live sessions from its start. It shows in the app the next time they open it.`
        : 'Course added. It shows in the app the next time they open it.';
      break;
    }
    case 'extend-course': {
      const months = monthsField('months');
      if (months === null || months === 'bad') return back(page, { app_err: '1', app_msg: 'Months must be a whole number from 1 to 36.' });
      const r = await askApp(env, (app) => app.extendCourse({ email, entitlementId: field('entitlement_id'), months, actor }));
      result = r;
      done = r.ok
        ? `${months} month${months === 1 ? '' : 's'} of live sessions added: they now run until ${r.data.liveSetByAdmin ?? r.data.liveUntil?.slice(0, 10)}.`
        : '';
      break;
    }
    case 'revoke-course': {
      result = await askApp(env, (app) => app.revokeCourse({ email, entitlementId: field('entitlement_id'), reason: field('reason'), actor }));
      done = 'Course revoked. No order, Drip tag or sync brings it back; add it again by hand to give it back.';
      break;
    }
    case 'course-dates': {
      result = await askApp(env, (app) =>
        app.setCourseDates({
          email,
          entitlementId: field('entitlement_id'),
          startsAt: dateField('starts_at'),
          activatedAt: dateField('activated_at'),
          endsAt: dateField('ends_at'),
          liveUntil: dateField('live_until'),
          actor,
        }),
      );
      done = 'Dates saved.';
      break;
    }
    case 'seat-space': {
      const r = await askApp(env, (app) => app.seatInSpace({ email, spaceKey: field('space'), note: field('note'), actor }));
      result = r;
      done = r.ok && !r.data.created ? 'Already seated in that space; nothing changed.' : 'Seated in the space.';
      break;
    }
    case 'unseat-space': {
      result = await askApp(env, (app) => app.unseatFromSpace({ email, spaceKey: field('space'), reason: field('reason'), actor }));
      done = 'Seat taken away.';
      break;
    }
    case 'add-host': {
      result = await askApp(env, (app) => app.addHost({ email, spaceKey: field('space'), actor }));
      done = 'Now a host of that space.';
      break;
    }
    case 'remove-host': {
      const r = await askApp(env, (app) => app.removeHost({ email, spaceKey: field('space'), actor }));
      result = r;
      done = r.ok && !r.data.removed ? 'Was not a host of that space; nothing changed.' : 'No longer a host of that space.';
      break;
    }
    default:
      return back(page, { app_err: '1', app_msg: 'Unknown change.' });
  }

  return result.ok ? back(page, { app_ok: '1', app_msg: done }) : back(page, { app_err: '1', app_msg: result.message });
};

function back(base: string, params: Record<string, string>): Response {
  const url = new URL(base, 'https://x');
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  return new Response(null, { status: 303, headers: { Location: `${url.pathname}${url.search}#app-access` } });
}
