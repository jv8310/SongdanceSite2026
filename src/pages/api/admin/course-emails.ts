// /admin/emails/courses actions — moving course emails from Drip to the site.
//
//   action=switch    unit, on=1|0     Turn a course's site emails on or off
//                                    (handover.ts). On → orders paid from now
//                                    get the site's confirmation + sequence.
//   action=bring-in  sequence        Join buyers from before the switch at the
//                                    step their own schedule has reached
//                                    (sequences.ts → bringInEarlierBuyers).
//   action=stop|resume  id           Stop / restart one person's series.
//
// Form posts from the admin page; every action redirects back with a flash.
// Admin-gated.

import type { APIRoute } from 'astro';
import { readCookie, verifySession } from '../../../lib/registrations/auth';
import { isHandoverUnit, setHandover } from '../../../lib/courses/emails/handover';
import {
  bringInEarlierBuyers,
  getEnrolment,
  isSequenceKey,
  resumeEnrolment,
  stopEnrolment,
} from '../../../lib/courses/emails/sequences';
import { logEventSafe } from '../../../lib/registrations/db';

export const prerender = false;

const RETURN_TO = '/admin/emails/courses';

export const POST: APIRoute = async ({ request, locals }) => {
  const env = locals.runtime.env;
  if (!(await verifySession(env.ADMIN_SESSION_SECRET, readCookie(request)))) {
    return new Response('Unauthorized', { status: 401 });
  }
  const form = await request.formData();
  const action = String(form.get('action') ?? '').trim();
  const back = String(form.get('back') ?? '').trim();
  const returnTo = back.startsWith('/admin/') ? back : RETURN_TO;

  try {
    if (action === 'switch') {
      const unit = String(form.get('unit') ?? '');
      const on = String(form.get('on') ?? '') === '1';
      if (!isHandoverUnit(unit)) return flash(returnTo, 'err', 'Unknown course.');
      await setHandover(env.DB, unit, on);
      await logEventSafe(env.DB, {
        registration_id: null,
        kind: 'course.emails.handover',
        source: 'admin',
        payload: { unit, on },
      });
      return flash(
        returnTo,
        'ok',
        on
          ? 'Switched to the site. Orders paid from now on get the site’s emails — switch the matching Drip workflow off today.'
          : 'Switched back to Drip. The site sends nothing more for new orders of this course; series already running carry on.',
      );
    }

    if (action === 'bring-in') {
      const key = String(form.get('sequence') ?? '');
      if (!isSequenceKey(key)) return flash(returnTo, 'err', 'Unknown sequence.');
      const n = await bringInEarlierBuyers(env, key);
      await logEventSafe(env.DB, {
        registration_id: null,
        kind: 'course.emails.bring_in',
        source: 'admin',
        payload: { sequence: key, enrolled: n },
      });
      return flash(returnTo, 'ok', `${n} earlier buyer${n === 1 ? '' : 's'} joined, each at the step their own schedule has reached.`);
    }

    if (action === 'stop' || action === 'resume') {
      const id = parseInt(String(form.get('id') ?? ''), 10);
      const row = Number.isFinite(id) ? await getEnrolment(env.DB, id) : null;
      if (!row) return flash(returnTo, 'err', 'No such series.');
      const done =
        action === 'stop' ? await stopEnrolment(env.DB, row.id, 'admin') : await resumeEnrolment(env.DB, row.id);
      return flash(
        returnTo,
        done ? 'ok' : 'err',
        done
          ? `${action === 'stop' ? 'Stopped' : 'Restarted'} ${row.sequence} for ${row.email}.`
          : `Nothing changed — the series is already ${row.completed_at ? 'complete' : row.stopped_at ? 'stopped' : 'running'}.`,
      );
    }
  } catch (err) {
    return flash(returnTo, 'err', `That didn’t work: ${String(err)}`);
  }
  return flash(returnTo, 'err', 'Unknown action.');
};

function flash(to: string, kind: 'ok' | 'err', msg: string) {
  const u = new URL(to, 'https://x');
  u.searchParams.set(kind, msg);
  return new Response(null, { status: 303, headers: { Location: `${u.pathname}${u.search}` } });
}
