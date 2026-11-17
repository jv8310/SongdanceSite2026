// A live pass given free — no payment — by Jacob, with or without the "Extend
// my certification window" add-on. Two doors, this one function:
//   • the admin: /admin/people/<email> → "Give a free live pass"
//     (/api/admin/live-pass/grant), actor `site:<the admin's sign-in email>`;
//   • the member app: AppBridge.grantLivePass (src/worker-entrypoint.ts), for
//     its MCP tools, actor = the app's connection.
//
// It rides the course machinery exactly as a paid pass does, so everything that
// follows a paid pass follows this one by itself: a `course_registrations` row
// (`live-pass-<n>m`, full payment, a `cert-extension` row in `bumps` when the
// add-on is given), marked paid with the synthetic payment intent `comp-<id>`
// (as the 100%-off checkout stamps `free-100-<id>`), then the same paid side
// effects the admin's "Mark paid" runs:
//   • pushPaidCourseRegistrationToDrip — settles the pass's dates once
//     (settleLivePassPeriod: access_starts_at, which the member app counts its
//     sessions from), the Drip tags (prod_LivePass, prod_CertExtension), and the
//     certification window's Drip push when the add-on is given. Meta hears
//     nothing: its Purchase is only sent for an order worth more than 0.
//   • notifyCourseOrder — the internal SD-ORDER (its Notes say who gave it and
//     why; its Gateway reads "None (given free)") and "Your live pass is
//     confirmed" to the member. With notify false that email's claim is taken
//     first (`live-pass-confirmed-<id>`), so neither this call nor the hourly
//     reconcile ever sends it.
// The money reports count it at €0, as they count the row's amount.
//
// The rules are the checkout's: the add-on only for someone who holds the
// certification course in some form, and only when it reaches past the window
// they already have (extensionRefusal, the checkout's own words); passes queue
// (planLivePass). Who gave it and why is the `course.live_pass.granted` event,
// which is also the guard against a double click: the same grant (address,
// length, add-on) within two minutes gives back the first one's answer instead
// of a second pass.

import { logEventSafe } from '../registrations/db';
import { notifyCourseOrder, type OrderEnv } from '../orders/notification';
import { certWindowForEmail } from './cert-window';
import { createPendingCourseRegistration, getCourseRegistrationById, markCourseRegistrationPaid } from './db';
import { extensionRefusal, loadBuyerDetails, planLivePass } from './live-pass-plan';
import {
  CERT_EXTENSION_SLUG,
  listPaidLivePasses,
  livePassContents,
  livePassLabel,
  livePassSlug,
  parseLivePassMonths,
  type LivePassMonths,
} from './live-pass';
import { pushPaidCourseRegistrationToDrip, type CoursePaidHandlerEnv } from './paid-handler';

export type GrantEnv = CoursePaidHandlerEnv & OrderEnv;

export type GrantLivePassInput = {
  email: string;
  months: 1 | 3 | 6;
  extend: boolean;
  note: string;
  actor: string;
  // Send "Your live pass is confirmed" to the member (default true).
  notify?: boolean;
};

export type GrantLivePassAnswer =
  | {
      ok: true;
      orderNo: string; // "C-<id>"
      label: string; // "Live pass · 3 months"
      contents: string; // "12 Q&As and 3 deepening sessions"
      startsOn: string; // YYYY-MM-DD, Brussels
      endsOn: string; // YYYY-MM-DD: the end of the pass's months (the extension's reach)
      extendedTo: string | null; // the certification window's last day, when the add-on was given
      notified: boolean;
      // True when this answer is the earlier, identical grant's (a double click).
      repeated?: boolean;
    }
  | { ok: false; error: string; message: string };

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
export const GRANT_EVENT_KIND = 'course.live_pass.granted';
export const GRANT_REPEAT_WINDOW_MS = 2 * 60 * 1000;
const NOTE_MAX = 500;

const refuse = (error: string, message: string): GrantLivePassAnswer => ({ ok: false, error, message });

// The claim's key: one grant per (address, length, add-on) per two-minute slot.
// The look-back below covers a double click that straddles two slots.
export function grantKeyPrefix(email: string, months: LivePassMonths, extend: boolean): string {
  return `live-pass-grant:${email}:${months}:${extend ? 1 : 0}:`;
}
export function grantKey(email: string, months: LivePassMonths, extend: boolean, nowMs: number): string {
  return `${grantKeyPrefix(email, months, extend)}${Math.floor(nowMs / GRANT_REPEAT_WINDOW_MS)}`;
}

// Check and tidy what either door sends. Pure; the answer is a refusal or the
// cleaned input.
export function parseGrantInput(
  input: unknown,
): { ok: true; email: string; months: LivePassMonths; extend: boolean; note: string; actor: string; notify: boolean } | Extract<GrantLivePassAnswer, { ok: false }> {
  const i = (input ?? {}) as Record<string, unknown>;
  const email = String(i.email ?? '').trim().toLowerCase();
  if (!EMAIL_RE.test(email) || email.length > 254) return { ok: false, error: 'invalid-email', message: 'That is not a valid email address.' };
  const months = parseLivePassMonths(i.months);
  if (!months) return { ok: false, error: 'invalid-months', message: 'A live pass is 1, 3 or 6 months.' };
  const note = String(i.note ?? '').trim();
  if (!note) return { ok: false, error: 'note-required', message: 'Say why the pass is given (the note is kept with the order).' };
  if (note.length > NOTE_MAX) return { ok: false, error: 'note-too-long', message: `Keep the note under ${NOTE_MAX} characters.` };
  const actor = String(i.actor ?? '').trim().slice(0, 160) || 'unknown';
  return { ok: true, email, months, extend: i.extend === true, note, actor, notify: i.notify !== false };
}

export async function grantLivePass(env: GrantEnv, input: GrantLivePassInput | Record<string, unknown>): Promise<GrantLivePassAnswer> {
  const parsed = parseGrantInput(input);
  if (!parsed.ok) return parsed;
  const { email, months, extend, note, actor, notify } = parsed;
  const db = env.DB;
  const now = Date.now();
  const prefix = grantKeyPrefix(email, months, extend);

  // A double click: the same grant in the last two minutes answers again.
  const recent = await db
    .prepare(
      `SELECT external_id, payload_json FROM events
        WHERE kind = ? AND created_at >= datetime('now', '-2 minutes')
        ORDER BY id DESC LIMIT 50`,
    )
    .bind(GRANT_EVENT_KIND)
    .all<{ external_id: string | null; payload_json: string | null }>()
    .then((r) => r.results ?? [])
    .catch(() => []);
  const earlier = recent.find((r) => r.external_id?.startsWith(prefix));
  if (earlier) return repeatOf(earlier.payload_json);

  // Claim it before anything is written, so two clicks at once make one pass.
  const key = grantKey(email, months, extend, now);
  const claim = await db
    .prepare(
      `INSERT OR IGNORE INTO events (registration_id, kind, source, external_id, payload_json)
       VALUES (NULL, ?, ?, ?, ?)`,
    )
    .bind(GRANT_EVENT_KIND, actor.startsWith('site:') ? 'admin' : 'app', key, JSON.stringify({ email, months, extend, note, actor, notify, state: 'claimed' }))
    .run();
  if ((claim.meta?.changes ?? 0) === 0) {
    const row = await db.prepare(`SELECT payload_json FROM events WHERE external_id = ?`).bind(key).first<{ payload_json: string | null }>();
    return repeatOf(row?.payload_json ?? null);
  }
  const release = () => db.prepare(`DELETE FROM events WHERE external_id = ?`).bind(key).run().catch(() => {});

  let regId: number | null = null;
  try {
    // The same rule the checkout enforces, in the same words.
    const plan = await planLivePass(db, email);
    if (extend) {
      const why = extensionRefusal(plan, months);
      if (why) {
        await release();
        return refuse(plan.window.holdsCourse ? 'extension-buys-nothing' : 'no-certification-course', why);
      }
    }

    const who = await loadBuyerDetails(db, email);
    regId = await createPendingCourseRegistration(db, {
      email,
      first_name: who.firstName,
      last_name: who.lastName,
      country: who.country,
      phone: null,
      phone_country: null,
      company_name: null,
      vat_number: null,
      product_slug: livePassSlug(months),
      activate_choice: null,
      language_choice: null,
      source_variant: 'comp',
      timezone: null,
      bumps: extend ? [{ slug: CERT_EXTENSION_SLUG, amount_cents: 0 }] : [],
      amount_cents: 0,
      currency: 'EUR',
      consent_terms: false,
      payment_plan: 'full',
      installments_total: 1,
    });
    await markCourseRegistrationPaid(db, regId, `comp-${regId}`);

    // No confirmation wanted: take its claim first, so nothing sends it later.
    if (!notify) {
      await db
        .prepare(
          `INSERT OR IGNORE INTO events (registration_id, kind, source, external_id, payload_json)
           VALUES (NULL, 'live_pass.confirmation.sent', 'system', ?, ?)`,
        )
        .bind(`live-pass-confirmed-${regId}`, JSON.stringify({ skipped: true, reason: 'free pass given without the email', actor }))
        .run();
    }
  } catch (err) {
    await release();
    await logEventSafe(db, {
      registration_id: null,
      kind: 'course.live_pass.grant_error',
      source: 'system',
      payload: { email, months, extend, actor, course_registration_id: regId, error: String(err) },
    });
    return refuse('failed', `The free pass could not be made: ${String(err).replace(/^Error:\s*/, '')}`);
  }

  // The paid side effects, as "Mark paid" runs them. Neither throws.
  await pushPaidCourseRegistrationToDrip(env, regId);
  const reg = await getCourseRegistrationById(db, regId);
  if (reg) {
    await notifyCourseOrder(env, reg, {
      stripePaymentIntent: reg.stripe_payment_intent,
      stripeSubscriptionId: null,
      notes: `Free live pass given by ${actor}: ${note}`,
    });
  }

  const mine = (await listPaidLivePasses(db, email)).find((p) => p.id === regId);
  const fallback = (await planLivePass(db, email, { onlyPassesBefore: regId })).periods[months];
  const window = extend ? await certWindowForEmail(db, email) : null;
  const answer: Extract<GrantLivePassAnswer, { ok: true }> = {
    ok: true,
    orderNo: `C-${regId}`,
    label: livePassLabel(months),
    contents: livePassContents(months),
    startsOn: mine?.startsOn ?? fallback.startsOn,
    endsOn: mine?.endsOn ?? fallback.endsOn,
    extendedTo: window?.endsOn ?? null,
    notified: notify,
  };
  await db
    .prepare(`UPDATE events SET payload_json = ? WHERE external_id = ?`)
    .bind(JSON.stringify({ email, months, extend, note, actor, notify, course_registration_id: regId, answer }), key)
    .run()
    .catch(() => {});
  return answer;
}

function repeatOf(payload: string | null): GrantLivePassAnswer {
  try {
    const p = JSON.parse(payload ?? '{}') as { answer?: Extract<GrantLivePassAnswer, { ok: true }> };
    if (p.answer?.ok) return { ...p.answer, repeated: true };
  } catch {
    /* fall through */
  }
  return refuse('in-progress', 'The same free pass was just given (or is being given) for this address. Look at their orders before giving another.');
}
