// POST /api/admin/certification — every change made on /admin/certification
// (src/lib/certification/). One form field `action` picks it; admin-gated;
// always redirects back with a flash (msg, and err=1 when it failed).
//
//   certify   id, on, note, feedback, certificate (file), send_email   multipart
//   respond   id, feedback, send_email
//   status    id, status            a quiet change, no email
//   uncertify id, reason            the app's certification taken back, the row waits again
//   note      id, admin_note
//   edit      id, email, first_name, last_name, video_url
//   resend    id, which (received | outcome)
//   sync      id                    tell the app again
//   delete    id
//   add       email, first_name, last_name, video_url, admin_note, status
//   bulk-certify                    every set-aside row certified, except a note saying "not certified"
//   import    file (CSV) or text (pasted from the sheet)                multipart
import type { APIRoute } from 'astro';
import { getSessionEmail, readCookie, verifySession } from '../../../lib/registrations/auth';
import { MAX_CERTIFICATE_BYTES, askApp } from '../../../lib/admin/app-access';
import {
  bulkCertifyArchived,
  certifyApplication,
  importCertApplications,
  removeApplication,
  resendCertEmail,
  respondToApplication,
  setApplicationStatus,
  type ReviewResult,
} from '../../../lib/certification/actions';
import { syncCertStatusToApp } from '../../../lib/certification/app-sync';
import {
  CERT_STATUSES,
  getCertApplication,
  insertCertApplication,
  setCertAdminNote,
  setCertStatus,
  updateCertAnswers,
  type CertStatus,
} from '../../../lib/certification/db';
import { parseCertImport } from '../../../lib/certification/import';
import { logEventSafe } from '../../../lib/registrations/db';

export const prerender = false;

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const LIST = '/admin/certification';

function back(path: string, r: ReviewResult): Response {
  const url = new URL(path, 'https://x');
  url.searchParams.set('msg', r.message.slice(0, 900));
  if (!r.ok) url.searchParams.set('err', '1');
  return new Response(null, { status: 303, headers: { Location: `${url.pathname}${url.search}` } });
}

export const POST: APIRoute = async ({ request, locals }) => {
  const env = locals.runtime.env;
  const cookie = readCookie(request);
  if (!(await verifySession(env.ADMIN_SESSION_SECRET, cookie))) return new Response('Unauthorized', { status: 401 });
  const actor = (await getSessionEmail(env.ADMIN_SESSION_SECRET, cookie)) ?? 'admin';

  const form = await request.formData().catch(() => null);
  const field = (k: string) => String(form?.get(k) ?? '').trim();
  const action = field('action');
  const id = Number(field('id'));
  const page = Number.isInteger(id) && id > 0 ? `${LIST}/${id}` : LIST;
  const needsRow = !['add', 'import', 'bulk-certify'].includes(action);
  if (needsRow && !(Number.isInteger(id) && id > 0)) return back(LIST, { ok: false, message: 'Which submission?' });

  try {
    switch (action) {
      case 'certify': {
        const f = form?.get('certificate');
        const file = f && typeof f !== 'string' && f.size > 0 ? f : null;
        if (file && file.size > MAX_CERTIFICATE_BYTES) {
          return back(page, { ok: false, message: `A certificate may be at most ${MAX_CERTIFICATE_BYTES / 1024 / 1024} MB. Nothing was changed.` });
        }
        return back(
          page,
          await certifyApplication(env, id, {
            on: field('on') || undefined,
            note: field('note') || undefined,
            // Kept as typed: its line breaks are its layout.
            feedback: String(form?.get('feedback') ?? ''),
            file: file ? { name: file.name, bytes: await file.arrayBuffer() } : null,
            email: form?.get('send_email') === 'on',
            actor,
          }),
        );
      }
      case 'respond':
        return back(page, await respondToApplication(env, id, { response: String(form?.get('feedback') ?? ''), email: form?.get('send_email') === 'on', actor }));
      case 'status': {
        const status = field('status') as CertStatus;
        if (!CERT_STATUSES.includes(status)) return back(page, { ok: false, message: 'Unknown status.' });
        return back(page, await setApplicationStatus(env, id, status, actor));
      }
      case 'uncertify': {
        const a = await getCertApplication(env.DB, id);
        if (!a) return back(LIST, { ok: false, message: 'That submission is no longer there.' });
        const reason = field('reason');
        if (!reason) return back(page, { ok: false, message: 'Say why: it is kept in the app\'s log.' });
        const r = await askApp(env, (app) => app.uncertify({ email: a.email, reason, actor }));
        if (!r.ok) return back(page, { ok: false, message: r.message });
        await setCertStatus(env.DB, id, { status: 'submitted', by: actor, reviewed: false });
        await logEventSafe(env.DB, { registration_id: null, kind: 'certification.uncertified', source: 'admin', payload: { id, email: a.email, by: actor, reason } });
        await syncCertStatusToApp(env, a.email, actor);
        return back(page, { ok: true, message: 'Certification taken back, the certificate and the feedback with it. This submission waits for review again. No email was sent.' });
      }
      case 'note':
        await setCertAdminNote(env.DB, id, String(form?.get('admin_note') ?? ''));
        return back(page, { ok: true, message: 'Note saved.' });
      case 'edit': {
        const a = await getCertApplication(env.DB, id);
        if (!a) return back(LIST, { ok: false, message: 'That submission is no longer there.' });
        const email = field('email').toLowerCase();
        if (!EMAIL_RE.test(email)) return back(page, { ok: false, message: 'That email address does not look right.' });
        await updateCertAnswers(env.DB, id, { email, first_name: field('first_name'), last_name: field('last_name'), video_url: field('video_url') });
        // A changed address: the app hears about both, each from its own rows.
        if (email !== a.email) await syncCertStatusToApp(env, a.email, actor);
        await syncCertStatusToApp(env, email, actor);
        return back(page, { ok: true, message: email !== a.email ? `Saved. The submission now belongs to ${email}; the app follows.` : 'Saved.' });
      }
      case 'resend':
        return back(page, await resendCertEmail(env, id, field('which') === 'received' ? 'received' : 'outcome'));
      case 'sync': {
        const a = await getCertApplication(env.DB, id);
        if (!a) return back(LIST, { ok: false, message: 'That submission is no longer there.' });
        const r = await syncCertStatusToApp(env, a.email, actor);
        return back(page, r.ok ? { ok: true, message: 'The app is up to date.' } : { ok: false, message: r.message ?? 'The app did not answer.' });
      }
      case 'delete':
        return back(LIST, await removeApplication(env, id, actor));
      case 'add': {
        const email = field('email').toLowerCase();
        if (!EMAIL_RE.test(email)) return back(LIST, { ok: false, message: 'That email address does not look right.' });
        const status = (CERT_STATUSES.includes(field('status') as CertStatus) ? field('status') : 'submitted') as CertStatus;
        const a = await insertCertApplication(env.DB, {
          email,
          first_name: field('first_name'),
          last_name: field('last_name'),
          video_url: field('video_url'),
          admin_note: field('admin_note'),
          classes_confirmed: false,
          source: 'admin',
          status: status === 'response' ? 'submitted' : status,
        });
        if (!a) return back(LIST, { ok: false, message: 'Not added.' });
        await logEventSafe(env.DB, { registration_id: null, kind: 'certification.added', source: 'admin', payload: { id: a.id, email, by: actor, status: a.status } });
        const sync = await syncCertStatusToApp(env, email, actor);
        return back(`${LIST}/${a.id}`, {
          ok: true,
          message: `Added by hand, without an email.${a.status === 'submitted' ? (sync.ok ? ' Their certification page in the app reads "waiting for review".' : ` The app has not followed yet (${sync.message}).`) : ''}`,
        });
      }
      case 'bulk-certify':
        return back(`${LIST}?status=certified`, await bulkCertifyArchived(env, actor));
      case 'import': {
        const f = form?.get('file');
        // Not trimmed: a pasted row that starts with an empty cell starts with a tab.
        const text = f && typeof f !== 'string' && f.size > 0 ? await f.text() : String(form?.get('text') ?? '');
        if (text.length > 5_000_000) return back(LIST, { ok: false, message: 'That is too much to import at once.' });
        const parsed = parseCertImport(text);
        if (parsed.problem) return back(LIST, { ok: false, message: parsed.problem });
        const r = await importCertApplications(env, parsed.rows, actor);
        const parts = [
          `${r.added} added${r.already ? `, ${r.already} already here` : ''}.`,
          r.added ? `Of the new ones: ${r.certified} certified (the app has them), ${r.waiting} waiting for review (sent in the last 90 days), ${r.aside} set aside as "outcome not recorded".` : '',
          parsed.skipped.length ? `${parsed.skipped.length} row${parsed.skipped.length === 1 ? '' : 's'} left out: ${parsed.skipped.map((s) => `line ${s.line} (${s.reason})`).join(', ')}.` : '',
          r.appAnswered ? '' : 'The app did not say who is certified, so nobody was marked certified: mark them by hand, or import again once the app answers (rows already here are left alone).',
          'No email was sent.',
        ];
        return back(LIST, { ok: true, message: parts.filter(Boolean).join(' ') });
      }
      default:
        return back(page, { ok: false, message: 'Unknown change.' });
    }
  } catch (err) {
    console.error('[admin/certification]', err);
    return back(page, { ok: false, message: `That did not work: ${String((err as Error)?.message ?? err)}` });
  }
};
