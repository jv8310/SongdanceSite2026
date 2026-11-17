// What happens to a certification submission (November 2026):
//
//   submitCertApplication   the form on /certification/apply: the row, the
//                           "your submission is in" email, SD-CERT to Jacob,
//                           the app told "submitted"
//   certifyApplication      Jacob certifies: the app's own certify (+ the
//                           certificate, + his feedback), the row 'certified',
//                           "Congratulations, you are certified"
//   respondToApplication    Jacob answers without certifying: the row
//                           'response' with his words, the app told, "please
//                           see my response"
//   setApplicationStatus    a quiet change (no email): set aside, back to
//                           waiting, certified earlier
//   importCertApplications  the old Google Sheet's rows; never an email
//
// The certification itself (the day, the certificate, the feedback the student
// reads beside it) stays the member app's record, written through APP_ADMIN as
// the People page always did. Email failures never undo a change: the row says
// whether the email went, and the admin page offers to send it again.

import { askApp, type AppCertified } from '../admin/app-access';
import { certWindowForEmail, type CertWindow } from '../courses/cert-window';
import { logEventSafe } from '../registrations/db';
import { sendEmail } from '../workshops/resend';
import { syncCertStatusToApp } from './app-sync';
import {
  certName,
  deleteCertApplication,
  getCertApplication,
  insertCertApplication,
  listCertApplications,
  setCertStatus,
  stampCertEmail,
  type CertApplication,
  type CertStatus,
} from './db';
import { certCertifiedEmail, certInternalEmail, certReceivedEmail, certResponseEmail } from './emails';
import type { ImportedCertRow } from './import';

export type CertEnv = {
  DB: D1Database;
  APP_ADMIN?: unknown;
  RESEND_API_KEY?: string;
  RESEND_REPLY_TO?: string;
  PUBLIC_BASE_URL?: string;
  CERT_NOTIFICATIONS_TO?: string;
};

export const CERT_APPLY_PATH = '/certification/apply';
const baseUrlOf = (env: CertEnv) => (env.PUBLIC_BASE_URL ?? 'https://songdance.co').replace(/\/+$/, '');

/** The form, filled in for this person (the response email's "send it again"). */
export function certApplyUrl(env: CertEnv, a: Pick<CertApplication, 'email' | 'first_name' | 'last_name'>): string {
  const q = new URLSearchParams({ email: a.email });
  if (a.first_name) q.set('first_name', a.first_name);
  if (a.last_name) q.set('last_name', a.last_name);
  return `${baseUrlOf(env)}${CERT_APPLY_PATH}?${q}`;
}

// New submissions go to Jacob (CERT_NOTIFICATIONS_TO overrides, comma/space separated).
function internalRecipients(env: CertEnv): string[] {
  const list = (env.CERT_NOTIFICATIONS_TO ?? '').split(/[\s,;]+/).map((s) => s.trim()).filter(Boolean);
  return list.length ? list : ['jacob@songdance.co'];
}

export function certWindowLine(w: CertWindow): string {
  if (!w.holdsCourse) return 'no certification course on record for this address';
  if (!w.mayCertify) return 'holds the course without the right to certify (CEEE 2025, no extension)';
  return w.open ? `open until ${w.endsOn}` : `closed on ${w.endsOn}`;
}

type Sent = { sent: boolean; error: string | null };

async function sendStudentEmail(
  env: CertEnv,
  a: CertApplication,
  which: 'received' | 'outcome',
  content: { subject: string; html: string; text: string },
  type: string,
): Promise<Sent> {
  if (!env.RESEND_API_KEY) return { sent: false, error: 'email is not configured' };
  try {
    await sendEmail({
      apiKey: env.RESEND_API_KEY,
      replyTo: env.RESEND_REPLY_TO,
      to: a.email,
      subject: content.subject,
      html: content.html,
      text: content.text,
      entityRefId: `cert-${type}-${a.id}-${Date.now()}`,
      track: { db: env.DB, type },
    });
    await stampCertEmail(env.DB, a.id, which);
    return { sent: true, error: null };
  } catch (err) {
    await logEventSafe(env.DB, { registration_id: null, kind: 'certification.email.error', source: 'system', payload: { id: a.id, type, error: String(err) } });
    return { sent: false, error: String(err) };
  }
}

// ── The form ────────────────────────────────────────────────────────────────

export type CertFormInput = {
  email: string;
  first_name: string;
  last_name: string;
  classes_confirmed: boolean;
  video_url: string | null;
  video_uploaded: boolean;
  course_feedback: string | null;
  testimonial: string | null;
  comments: string | null;
};

export async function submitCertApplication(env: CertEnv, input: CertFormInput): Promise<CertApplication> {
  const a = await insertCertApplication(env.DB, { ...input, source: 'site' });
  if (!a) throw new Error('the submission was not saved');
  await logEventSafe(env.DB, { registration_id: null, kind: 'certification.submitted', source: 'site', payload: { id: a.id, email: a.email } });

  // Each of the three is its own best effort: the submission stands whatever fails.
  await syncCertStatusToApp(env, a.email, 'form').catch(() => {});
  await sendStudentEmail(env, a, 'received', certReceivedEmail({ name: a.first_name, videoGiven: !!a.video_url }), 'cert_received');
  if (env.RESEND_API_KEY) {
    try {
      const window = await certWindowForEmail(env.DB, a.email);
      const c = certInternalEmail({
        name: certName(a),
        email: a.email,
        videoUrl: a.video_url,
        videoUploaded: !!a.video_uploaded,
        courseFeedback: a.course_feedback,
        testimonial: a.testimonial,
        comments: a.comments,
        windowLine: certWindowLine(window),
        adminUrl: `${baseUrlOf(env)}/admin/certification/${a.id}`,
      });
      await sendEmail({ apiKey: env.RESEND_API_KEY, to: internalRecipients(env), subject: c.subject, html: c.html, text: c.text, replyTo: a.email });
    } catch (err) {
      await logEventSafe(env.DB, { registration_id: null, kind: 'certification.internal_email.error', source: 'system', payload: { id: a.id, error: String(err) } });
    }
  }
  return (await getCertApplication(env.DB, a.id)) ?? a;
}

// ── The review ──────────────────────────────────────────────────────────────

export type ReviewResult = { ok: boolean; message: string };

export async function certifyApplication(
  env: CertEnv,
  id: number,
  v: { on?: string; feedback?: string; note?: string; file?: { name: string; bytes: ArrayBuffer } | null; email: boolean; actor: string },
): Promise<ReviewResult> {
  const a = await getCertApplication(env.DB, id);
  if (!a) return { ok: false, message: 'That submission is no longer there.' };
  const feedback = v.feedback?.trim() ? v.feedback : undefined;

  // The app first: it is the record of who is certified. Nothing here changes unless it took it.
  const r = await askApp(env, (app) => app.certify({ email: a.email, on: v.on || undefined, note: v.note || undefined, ...(feedback ? { feedback } : {}), actor: v.actor }));
  if (!r.ok) return { ok: false, message: `Not certified: ${r.message}` };
  let certified: AppCertified = r.data;
  let fileProblem: string | null = null;
  if (v.file) {
    const c = await askApp(env, (app) => app.addCertificate({ email: a.email, filename: v.file!.name, bytes: v.file!.bytes, actor: v.actor }));
    if (c.ok) certified = c.data;
    else fileProblem = c.message;
  }

  await setCertStatus(env.DB, id, { status: 'certified', response: feedback ?? a.response ?? null, by: v.actor });
  await logEventSafe(env.DB, { registration_id: null, kind: 'certification.certified', source: 'admin', payload: { id, email: a.email, by: v.actor, on: certified.on } });
  const sync = await syncCertStatusToApp(env, a.email, v.actor);

  let mail: Sent | null = null;
  if (v.email) {
    mail = await sendStudentEmail(
      env,
      a,
      'outcome',
      certCertifiedEmail({ name: a.first_name, hasCertificate: !!certified.certificate, feedback: certified.feedback?.text ?? feedback ?? null }),
      'cert_certified',
    );
  }
  const parts = [
    `${certName(a)} is certified${certified.certificate ? ', with the certificate' : ''}. The app shows "You are certified".`,
    fileProblem ? `The certificate was not added: ${fileProblem}` : '',
    mail ? (mail.sent ? 'The email has gone out.' : `The email did NOT go out (${mail.error}); send it again from this page.`) : 'No email was sent.',
    sync.ok ? '' : `The app has not cleared "waiting for review" yet (${sync.message}); it is tried again every hour.`,
  ];
  return { ok: true, message: parts.filter(Boolean).join(' ') };
}

export async function respondToApplication(env: CertEnv, id: number, v: { response: string; email: boolean; actor: string }): Promise<ReviewResult> {
  const a = await getCertApplication(env.DB, id);
  if (!a) return { ok: false, message: 'That submission is no longer there.' };
  const response = v.response.replace(/\r\n?/g, '\n').replace(/\s+$/, '');
  if (!response.trim()) return { ok: false, message: 'Write the response first: it is what they read.' };

  await setCertStatus(env.DB, id, { status: 'response', response, by: v.actor });
  await logEventSafe(env.DB, { registration_id: null, kind: 'certification.response', source: 'admin', payload: { id, email: a.email, by: v.actor, characters: response.length } });
  const sync = await syncCertStatusToApp(env, a.email, v.actor);
  let mail: Sent | null = null;
  if (v.email) {
    mail = await sendStudentEmail(env, a, 'outcome', certResponseEmail({ name: a.first_name, response, applyUrl: certApplyUrl(env, a) }), 'cert_response');
  }
  const parts = [
    'Response saved.',
    sync.ok ? 'Their certification page in the app shows it, with the way to send the form again.' : `The app does not show it yet (${sync.message}); it is tried again every hour.`,
    mail ? (mail.sent ? 'The email has gone out.' : `The email did NOT go out (${mail.error}); send it again from this page.`) : 'No email was sent.',
  ];
  return { ok: true, message: parts.join(' ') };
}

/** The outcome email again (or for the first time), from what the row and the app hold now. */
export async function resendCertEmail(env: CertEnv, id: number, which: 'received' | 'outcome'): Promise<ReviewResult> {
  const a = await getCertApplication(env.DB, id);
  if (!a) return { ok: false, message: 'That submission is no longer there.' };
  let mail: Sent;
  if (which === 'received') {
    mail = await sendStudentEmail(env, a, 'received', certReceivedEmail({ name: a.first_name, videoGiven: !!a.video_url }), 'cert_received');
  } else if (a.status === 'response' && a.response?.trim()) {
    mail = await sendStudentEmail(env, a, 'outcome', certResponseEmail({ name: a.first_name, response: a.response, applyUrl: certApplyUrl(env, a) }), 'cert_response');
  } else if (a.status === 'certified') {
    const r = await askApp(env, (app) => app.member({ email: a.email }));
    const c = r.ok ? (r.data.certification?.certified ?? null) : null;
    if (!c) return { ok: false, message: r.ok ? 'The app does not have them as certified, so there is nothing to congratulate yet.' : r.message };
    mail = await sendStudentEmail(env, a, 'outcome', certCertifiedEmail({ name: a.first_name, hasCertificate: !!c.certificate, feedback: c.feedback?.text ?? null }), 'cert_certified');
  } else {
    return { ok: false, message: 'There is no outcome to write about yet.' };
  }
  return mail.sent ? { ok: true, message: `Sent to ${a.email}.` } : { ok: false, message: `The email did not go out: ${mail.error}` };
}

/** A change without an email: set aside, back to waiting, certified earlier. */
export async function setApplicationStatus(env: CertEnv, id: number, status: CertStatus, actor: string): Promise<ReviewResult> {
  const a = await getCertApplication(env.DB, id);
  if (!a) return { ok: false, message: 'That submission is no longer there.' };
  if (status === 'response' && !a.response?.trim()) return { ok: false, message: 'A response needs its words: use "Send a response".' };
  await setCertStatus(env.DB, id, { status, by: actor, reviewed: status !== 'submitted' });
  await logEventSafe(env.DB, { registration_id: null, kind: 'certification.status', source: 'admin', payload: { id, email: a.email, from: a.status, to: status, by: actor } });
  const sync = await syncCertStatusToApp(env, a.email, actor);
  return { ok: true, message: `Saved, without an email.${sync.ok ? '' : ` The app has not followed yet (${sync.message}); it is tried again every hour.`}` };
}

export async function removeApplication(env: CertEnv, id: number, actor: string): Promise<ReviewResult> {
  const a = await getCertApplication(env.DB, id);
  if (!a) return { ok: true, message: 'Already gone.' };
  await deleteCertApplication(env.DB, id);
  await logEventSafe(env.DB, {
    registration_id: null,
    kind: 'certification.deleted',
    source: 'admin',
    payload: { id, email: a.email, by: actor, status: a.status, submitted_at: a.submitted_at, video_url: a.video_url },
  });
  await syncCertStatusToApp(env, a.email, actor).catch(() => {});
  return { ok: true, message: `The submission of ${certName(a)} is deleted. A certification in the app is not touched by this.` };
}

// ── Set aside → certified, in one go ────────────────────────────────────────

/** A note that says no: these stay set aside. */
export const isNotCertifiedNote = (note: string | null) => /not\s+certified/i.test(note ?? '');

export type BulkCertifyPlan = { certify: CertApplication[]; stay: CertApplication[] };

/** Every set-aside row, split by its note: "not certified" (any case) stays, the rest would be certified. */
export async function planBulkCertify(db: D1Database): Promise<BulkCertifyPlan> {
  const rows = await listCertApplications(db, { status: 'archived' });
  return { certify: rows.filter((a) => !isNotCertifiedNote(a.admin_note)), stay: rows.filter((a) => isNotCertifiedNote(a.admin_note)) };
}

/**
 * The old submissions whose outcome the sheet never recorded, marked certified
 * together: each person is certified in the app on the day they sent the form
 * (someone the app already has as certified keeps their day), the row becomes
 * 'certified'. Never an email. A person the app did not take stays set aside
 * and is named, so pressing again finishes the job.
 */
export async function bulkCertifyArchived(env: CertEnv, actor: string): Promise<ReviewResult> {
  const plan = await planBulkCertify(env.DB);
  if (!plan.certify.length) return { ok: true, message: 'Nothing to certify: every set-aside submission says "not certified" in its note, or there are none.' };
  const list = await askApp(env, async (app) =>
    app.certifiedList ? app.certifiedList() : { ok: false as const, error: 'not-deployed', message: 'The member app has not been deployed with certification submissions yet.' },
  );
  if (!list.ok) return { ok: false, message: `Nothing was changed: ${list.message}` };
  const already = new Set(list.data.map((c) => c.email.toLowerCase()));
  const brusselsDay = (iso: string) => new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Brussels' }).format(new Date(iso));

  let done = 0;
  const failed: string[] = [];
  const handled = new Set<string>();
  // Oldest first, so someone with two submissions is certified on the day of the first.
  for (const a of [...plan.certify].reverse()) {
    if (!already.has(a.email) && !handled.has(a.email)) {
      const r = await askApp(env, (app) => app.certify({ email: a.email, on: brusselsDay(a.submitted_at), note: 'Certified before submissions were kept on the site', actor }));
      if (!r.ok) {
        failed.push(`${certName(a)} (${r.message})`);
        continue;
      }
    }
    handled.add(a.email);
    await setCertStatus(env.DB, a.id, { status: 'certified', by: actor });
    done++;
  }
  for (const email of handled) await syncCertStatusToApp(env, email, actor).catch(() => {});
  await logEventSafe(env.DB, { registration_id: null, kind: 'certification.bulk_certified', source: 'admin', payload: { by: actor, certified: done, stayed: plan.stay.length, failed: failed.length } });
  const parts = [
    `${done} submission${done === 1 ? '' : 's'} marked certified, without an email. In the app they read "You are certified", dated the day the form was sent.`,
    plan.stay.length ? `${plan.stay.length} stay set aside (their note says "not certified").` : '',
    failed.length ? `Not done, still set aside: ${failed.join('; ')}. Press again to retry.` : '',
  ];
  return { ok: failed.length === 0, message: parts.filter(Boolean).join(' ') };
}

// ── The Google Sheet ────────────────────────────────────────────────────────

const RECENT_DAYS = 90;

/**
 * The sheet's rows. Each lands as: certified when the app has that address as
 * certified; waiting when it was sent in the last 90 days (the review promise);
 * otherwise set aside, "outcome not recorded", for Jacob to mark by hand. No
 * email is ever sent for an imported row.
 */
export async function importCertApplications(
  env: CertEnv,
  rows: ImportedCertRow[],
  actor: string,
): Promise<{ added: number; already: number; certified: number; waiting: number; aside: number; appAnswered: boolean }> {
  const list = await askApp(env, async (app) =>
    app.certifiedList ? app.certifiedList() : { ok: false as const, error: 'not-deployed', message: 'not deployed' },
  );
  const certifiedEmails = new Set(list.ok ? list.data.map((c) => c.email.toLowerCase()) : []);
  const cutoff = Date.now() - RECENT_DAYS * 86_400_000;
  const out = { added: 0, already: 0, certified: 0, waiting: 0, aside: 0, appAnswered: list.ok };
  const toSync = new Set<string>();
  for (const r of rows) {
    const recent = !!r.submitted_at && Date.parse(r.submitted_at) >= cutoff;
    const status: CertStatus = certifiedEmails.has(r.email) ? 'certified' : recent ? 'submitted' : 'archived';
    const a = await insertCertApplication(env.DB, {
      email: r.email,
      first_name: r.first_name,
      last_name: r.last_name,
      classes_confirmed: r.classes_confirmed,
      video_url: r.video_url,
      course_feedback: r.course_feedback,
      testimonial: r.testimonial,
      comments: r.comments,
      admin_note: r.admin_note,
      source: 'google-form',
      import_key: r.import_key,
      submitted_at: r.submitted_at ?? new Date().toISOString(),
      status,
    });
    if (!a) {
      out.already++;
      continue;
    }
    out.added++;
    if (status === 'certified') out.certified++;
    else if (status === 'submitted') {
      out.waiting++;
      toSync.add(r.email);
    } else out.aside++;
  }
  for (const email of toSync) await syncCertStatusToApp(env, email, actor).catch(() => {});
  await logEventSafe(env.DB, { registration_id: null, kind: 'certification.imported', source: 'admin', payload: { by: actor, ...out } });
  return out;
}
