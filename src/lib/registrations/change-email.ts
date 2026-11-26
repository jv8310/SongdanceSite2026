// Correct the email address on a retreat booking (a typo at checkout, a
// stand-in address, a guest who asks to use another one).
//
// The booking keeps its id, so its payment, room, invoices and every link
// already sent stay as they were; only the address changes. The retreat's
// intake follows: the invitation, the intake the guest sent and their travel
// answers are keyed by address, so each moves to the new one — unless the new
// address already holds its own there, in which case that one is left alone.
// Drip: the subscriber is renamed in place when Drip knows the old address and
// not the new one (tags and history travel with it). Drip can't merge two
// subscribers, so otherwise nothing is changed there and the caller says so.

import { getRegistrationById, logEventSafe } from './db';
import { changeSubscriberEmail, getSubscriber } from './drip';

export type RetreatEmailChangeDrip = 'renamed' | 'both' | 'new_only' | 'unknown' | 'skipped' | 'error';

export type RetreatEmailChange =
  | { ok: false; error: 'not_found' | 'invalid' | 'same' }
  | { ok: true; oldEmail: string; newEmail: string; intakeMoved: boolean; drip: RetreatEmailChangeDrip };

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export async function changeRetreatEmail(
  env: { DB: D1Database; DRIP_API_TOKEN?: string; DRIP_ACCOUNT_ID?: string },
  registrationId: number,
  rawEmail: string,
  actor: string,
): Promise<RetreatEmailChange> {
  const reg = await getRegistrationById(env.DB, registrationId);
  if (!reg) return { ok: false, error: 'not_found' };
  const newEmail = rawEmail.trim().toLowerCase();
  if (!EMAIL_RE.test(newEmail) || /\.invalid$/.test(newEmail)) return { ok: false, error: 'invalid' };
  const oldEmail = reg.email.trim().toLowerCase();
  if (oldEmail === newEmail) return { ok: false, error: 'same' };

  await env.DB.prepare(`UPDATE registrations SET email = ? WHERE id = ?`).bind(newEmail, registrationId).run();

  // The intake linked to this retreat, if any. Each statement stands alone:
  // before migration 0085 some of these tables or columns are missing, and the
  // booking's own change must not depend on them.
  let intakeMoved = false;
  try {
    const intake = await env.DB
      .prepare(`SELECT slug FROM intake_retreats WHERE product_id = ?`)
      .bind(reg.product_id)
      .first<{ slug: string }>();
    if (intake) {
      const statements = [
        env.DB
          .prepare(`UPDATE OR IGNORE intake_invitations SET email = ? WHERE retreat_slug = ? AND lower(email) = ?`)
          .bind(newEmail, intake.slug, oldEmail),
        env.DB
          .prepare(`UPDATE intake_submissions SET email = ? WHERE event_code = ? AND lower(email) = ?`)
          .bind(newEmail, intake.slug, oldEmail),
        env.DB
          .prepare(`UPDATE OR IGNORE intake_transport_answers SET email = ? WHERE event_code = ? AND lower(email) = ?`)
          .bind(newEmail, intake.slug, oldEmail),
      ];
      for (const s of statements) {
        try {
          const r = await s.run();
          if ((r.meta?.changes ?? 0) > 0) intakeMoved = true;
        } catch {
          // Table not there yet: nothing of theirs to move.
        }
      }
    }
  } catch {
    // No intake link column yet.
  }

  let drip: RetreatEmailChangeDrip = 'skipped';
  // A stand-in address was never pushed to Drip as a person.
  if (env.DRIP_API_TOKEN && env.DRIP_ACCOUNT_ID && !/\.invalid$/.test(oldEmail)) {
    const cfg = { apiToken: env.DRIP_API_TOKEN, accountId: env.DRIP_ACCOUNT_ID };
    try {
      const [oldSub, newSub] = await Promise.all([getSubscriber(cfg, oldEmail), getSubscriber(cfg, newEmail)]);
      if (oldSub && !newSub) {
        await changeSubscriberEmail(cfg, oldEmail, newEmail);
        drip = 'renamed';
      } else if (oldSub && newSub) drip = 'both';
      else if (newSub) drip = 'new_only';
      else drip = 'unknown';
    } catch {
      drip = 'error';
    }
  }

  await logEventSafe(env.DB, {
    registration_id: registrationId,
    kind: 'registration.email_changed',
    source: 'admin',
    payload: { from: oldEmail, to: newEmail, intake_moved: intakeMoved, drip, by: actor },
  });
  return { ok: true, oldEmail, newEmail, intakeMoved, drip };
}
