import type { APIRoute } from 'astro';
import { getSessionEmail, readCookie } from '../../../lib/registrations/auth';
import { logEventSafe } from '../../../lib/registrations/db';
import { saveSessionSettings, type SessionSettings } from '../../../lib/sessions/config';
import { cancelSession, rewriteCalendar } from '../../../lib/sessions/actions';
import { getBooking, setJoinLinkByAdmin } from '../../../lib/sessions/db';

export const prerender = false;

// Everything /admin/sessions changes: the settings (price, length, buffer,
// notice, horizon, the calendar title, the standard Zoom link, the move
// window), and per booking: cancel, set a Zoom link by hand, write it to the
// calendar again. Every change comes back to the page with a flash.
export const POST: APIRoute = async ({ request, locals }) => {
  const env = locals.runtime.env;
  const admin = await getSessionEmail(env.ADMIN_SESSION_SECRET, readCookie(request));
  if (!admin) return new Response('Unauthorized', { status: 401 });

  const form = await request.formData();
  const action = String(form.get('action') ?? '').trim();
  const str = (k: string) => String(form.get(k) ?? '').trim();
  const num = (k: string): number | undefined => {
    const v = str(k).replace(',', '.');
    if (v === '') return undefined;
    const n = Number(v);
    return Number.isFinite(n) ? n : undefined;
  };

  try {
    if (action === 'settings') {
      const priceEur = num('price_eur');
      const patch: Partial<SessionSettings> = {
        priceEurCents: priceEur === undefined ? 0 : Math.round(priceEur * 100),
        durationMin: num('duration_min'),
        bufferMin: num('buffer_min'),
        minNoticeHours: num('min_notice_hours'),
        horizonDays: num('horizon_days'),
        rescheduleHours: num('reschedule_hours'),
        calendarTitle: str('calendar_title') || 'Boekingen',
        standardJoinUrl: str('standard_join_url'),
        standardPasscode: str('standard_passcode'),
      };
      if (patch.standardJoinUrl && !/^https:\/\//i.test(patch.standardJoinUrl)) {
        return back({ flash: 'err', msg: 'The standard Zoom link must start with https://' });
      }
      await saveSessionSettings(env.DB, patch);
      await logEventSafe(env.DB, { registration_id: null, kind: 'session.settings.saved', source: 'admin', payload: { by: admin, ...patch } });
      return back({
        flash: 'ok',
        msg: patch.priceEurCents ? 'Settings saved. Booking is open.' : 'Settings saved. Booking stays closed until a price is set.',
      });
    }

    const id = parseInt(str('booking_id'), 10);
    const b = Number.isFinite(id) && id > 0 ? await getBooking(env.DB, id) : null;
    if (!b) return back({ flash: 'err', msg: 'Booking not found.' });
    const who = [b.first_name, b.last_name].filter(Boolean).join(' ').trim() || b.email;

    if (action === 'cancel') {
      const r = await cancelSession(env, b.id, {
        reason: str('reason') || 'cancelled by admin',
        emailClient: form.get('email_client') === 'on',
        message: str('message') || null,
        by: `admin:${admin}`,
      });
      const refundHint = r.ok && b.course_registration_id
        ? ` A refund is not automatic — refund it on order C-${b.course_registration_id} if you want to.`
        : '';
      return back({ flash: r.ok ? 'ok' : 'err', msg: `${who}: ${r.message}${refundHint}` });
    }
    if (action === 'set_link') {
      const url = str('join_url');
      if (!/^https:\/\//i.test(url)) return back({ flash: 'err', msg: 'A Zoom link starts with https://' });
      await setJoinLinkByAdmin(env.DB, b.id, url, str('passcode') || null);
      await logEventSafe(env.DB, { registration_id: null, kind: 'session.link.set', source: 'admin', payload: { booking_id: b.id, by: admin } });
      const cal = b.calendar_event_id ? await rewriteCalendar(env, b.id) : null;
      return back({
        flash: 'ok',
        msg: `${who}: Zoom link saved — the reminders carry it${cal ? (cal.ok ? ', and your calendar entry is updated' : `; the calendar entry was not updated (${cal.message})`) : ''}.`,
      });
    }
    if (action === 'calendar') {
      const r = await rewriteCalendar(env, b.id);
      return back({ flash: r.ok ? 'ok' : 'err', msg: `${who}: ${r.message}` });
    }
    return back({ flash: 'err', msg: 'Unknown action.' });
  } catch (err) {
    return back({ flash: 'err', msg: `Something went wrong: ${String(err).replace(/^Error:\s*/, '').slice(0, 200)}` });
  }
};

function back(p: { flash: 'ok' | 'err'; msg: string }): Response {
  const u = new URLSearchParams({ flash: p.flash, msg: p.msg });
  return new Response(null, { status: 302, headers: { Location: `/admin/sessions?${u.toString()}` } });
}
