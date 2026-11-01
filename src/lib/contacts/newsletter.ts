// The site's own newsletter signup — the "Stay in touch" form at the foot of
// every SiteLayout page (NewsletterFooter.astro → POST /api/newsletter).
//
// Until November 2026 that form showed "Thank you" and threw the address away
// (a placeholder waiting for a Drip endpoint), and /api/newsletter wrote only to
// Drip and had no caller. A signup now lands where everything else the site
// mails from lives:
//
//   • contacts row — created with source 'newsletter', or, for an address the
//     list already holds, left as it was except a missing name filled in;
//   • tag `newsletter` (plus `forgiveness course waitlist` for that source) —
//     additive, so nothing the contact already carries is touched, and never
//     the purchase mirror's `in-drip` marker: this person is mailed from the
//     site, so a broadcast excluding `in-drip` still reaches them. The contacts
//     import leaves `newsletter` alone when it rewrites a row's tags;
//   • newsletter_signups row (migration 0096) — when, on which page, from which
//     form, how many times. It is its own table, not keys in contacts.custom,
//     because that JSON belongs to the CSV import and a re-import replaced it
//     whole. This row is what puts the person on /admin/people.
//
// A NAME is kept only when it looks like one (letters, marks, spaces,
// apostrophes, dots, hyphens). Anyone can type any address into the form, and
// the name is what our broadcasts greet that inbox with — so a "name" carrying
// a link or markup is dropped, not stored (broadcast rendering also escapes it).
//
// A signup never lifts an unsubscribe. An address on email_suppressions stays
// there — only the person who unsubscribed should be able to undo it — so the
// contact is recorded (it shows on People as unsubscribed, with the signup date)
// and an admin can Resubscribe it after hearing from them. The caller is told,
// so it can log it; the visitor is not, since that would say whether an address
// is on our list.
//
// An ERASED address (src/lib/contacts/erase.ts) writes nothing at all: no
// contact, no tag, no signup row, and the event that records the attempt
// carries a hash of the address, not the address. The visitor sees the same
// thank-you as anyone else.

import { logEventSafe } from '../registrations/db';
import { addContactTagStatements, normalizeContactTags } from './mirror';
import { emailHash } from './erase';

export const NEWSLETTER_TAG = 'newsletter';
export const NEWSLETTER_SOURCE = 'newsletter';

// Extra tag per `source` a form may post. Anything else is kept only as the
// signup's source, never as a tag, so a caller can't mint tags.
const SOURCE_TAGS = new Map<string, string>([['forgiveness-course', 'forgiveness course waitlist']]);

export type NewsletterSignupInput = {
  email: string;
  firstName?: string | null;
  // Which form or campaign, e.g. 'footer' or 'forgiveness-course'.
  source?: string | null;
  // location.pathname of the page the form was on.
  page?: string | null;
};

export type NewsletterSignupResult = {
  email: string;
  isNew: boolean; // the address was not on the contacts list before
  suppressed: boolean; // on email_suppressions: recorded, but not mailed
};

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const NAME_RE = /^[\p{L}\p{M}][\p{L}\p{M}' .\-]{0,79}$/u;

export function normalizeSignupEmail(raw: unknown): string | null {
  const email = String(raw ?? '').trim().toLowerCase();
  if (email.length > 254 || !EMAIL_RE.test(email)) return null;
  return email;
}

// A plausible first name, or null (see the header).
export function normalizeSignupName(raw: unknown): string | null {
  const name = String(raw ?? '').trim().replace(/\s+/g, ' ');
  return NAME_RE.test(name) ? name : null;
}

// A same-site path only: leading '/', no scheme or host, query and hash dropped
// (they carry discounts, referral ids and, on some links, the address itself).
export function normalizeSignupPage(raw: unknown): string | null {
  const s = String(raw ?? '').trim();
  if (!s.startsWith('/') || s.startsWith('//')) return null;
  const path = s.split(/[?#]/)[0].slice(0, 200);
  return /^\/[\w\-./%~]*$/.test(path) ? path : null;
}

function normalizeSource(raw: unknown): string {
  const s = String(raw ?? '').trim().toLowerCase().slice(0, 60);
  return /^[a-z0-9][a-z0-9\-_:]*$/.test(s) ? s : 'footer';
}

export async function recordNewsletterSignup(
  db: D1Database,
  input: NewsletterSignupInput,
): Promise<NewsletterSignupResult> {
  const email = normalizeSignupEmail(input.email);
  if (!email) throw new Error('recordNewsletterSignup: invalid email');
  const firstName = normalizeSignupName(input.firstName);
  const source = normalizeSource(input.source);
  const page = normalizeSignupPage(input.page);

  const before = await db
    .prepare(
      `SELECT EXISTS (SELECT 1 FROM contacts WHERE email = ?1) AS existing,
              EXISTS (SELECT 1 FROM email_suppressions WHERE email = ?1) AS suppressed,
              EXISTS (SELECT 1 FROM email_suppressions WHERE email = ?1 AND reason = 'erased') AS erased`,
    )
    .bind(email)
    .first<{ existing: number; suppressed: number; erased: number }>();

  if (before?.erased) {
    await logEventSafe(db, {
      registration_id: null,
      kind: 'newsletter.signup_erased',
      source: 'web',
      payload: { email_sha256: await emailHash(email), source, page },
    });
    return { email, isNew: false, suppressed: true };
  }

  const tags = normalizeContactTags([NEWSLETTER_TAG, SOURCE_TAGS.get(source) ?? '']);

  // The contact and its tags: what broadcasts read. One batch (a transaction).
  await db.batch([
    db
      .prepare(
        `INSERT INTO contacts (email, name, source)
           VALUES (?1, ?2, ?3)
         ON CONFLICT(email) DO UPDATE SET
           name = COALESCE(contacts.name, excluded.name),
           updated_at = datetime('now')`,
      )
      .bind(email, firstName, NEWSLETTER_SOURCE),
    ...addContactTagStatements(db, email, tags),
  ]);

  // The signup record (migration 0096). Separate, so the contact above is never
  // lost to it: a preview runs on the live database before the migration is
  // applied, and there this write fails on its own and is logged.
  let recorded = true;
  try {
    await db
      .prepare(
        `INSERT INTO newsletter_signups (email, page, source)
           VALUES (?1, ?2, ?3)
         ON CONFLICT(email) DO UPDATE SET
           signed_up_at = datetime('now'),
           page = COALESCE(excluded.page, newsletter_signups.page),
           source = excluded.source,
           signups = newsletter_signups.signups + 1`,
      )
      .bind(email, page, source)
      .run();
  } catch (err) {
    recorded = false;
    console.error(`[newsletter] signup row not written (migration 0096?): ${String(err)}`);
  }

  const result: NewsletterSignupResult = {
    email,
    isNew: !before?.existing,
    suppressed: !!before?.suppressed,
  };

  await logEventSafe(db, {
    registration_id: null,
    kind: result.suppressed ? 'newsletter.signup_suppressed' : 'newsletter.signup',
    source: 'web',
    payload: { email, source, page, new_contact: result.isNew, recorded },
  });

  return result;
}
